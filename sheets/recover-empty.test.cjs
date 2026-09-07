const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

const connectorSource = fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8');
const recoverySource = fs.readFileSync(path.join(__dirname, 'RecoverEmptyWorksheet.gs'), 'utf8');
const SOURCE_ID = 'old_empty_sheet_abcdefghijklmnopqrstuvwxyz';
const CANDIDATE_ID = 'recovered_sheet_abcdefghijklmnopqrstuvwxyz';
const SOURCE_URL = `https://docs.google.com/spreadsheets/d/${SOURCE_ID}/edit`;
const CANDIDATE_URL = `https://docs.google.com/spreadsheets/d/${CANDIDATE_ID}/edit`;
const TOKEN = 'recovery_private_token_abcdefghijklmnopqrstuvwxyz_123456789';
const STATE_KEY = 'INVENTORY_EMPTY_RECOVERY';
const clone = value => JSON.parse(JSON.stringify(value));

function fixture(options = {}) {
  const state = {
    lockHeld: false, lockAvailable: true, releases: 0, creates: 0, batches: 0,
    propertyWrites: [], calls: [], logs: [], denied: [], tabs: [], timeZone: 'Etc/UTC',
    driveResult: {id: CANDIDATE_ID, mimeType: 'application/vnd.google-apps.spreadsheet',
      isAppAuthorized: true, trashed: false, capabilities: {canEdit: true}},
    ...options
  };
  const properties = {
    INVENTORY_ACCESS_MODEL: 'drive.file.v1', INVENTORY_SHEET_ID: SOURCE_ID,
    INVENTORY_SHEET_URL: SOURCE_URL, INVENTORY_TOKEN: TOKEN, ...options.properties
  };
  const assertCandidate = id => {
    assert.notEqual(id, SOURCE_ID, 'The inaccessible original file must never be read, changed, or deleted');
    assert.equal(id, CANDIDATE_ID);
  };
  const denied = name => () => { state.denied.push(name); throw new Error(`Forbidden recovery operation ${name}`); };
  function writeProperties(values) {
    assert.equal(state.lockHeld, true, 'Property writes require the script lock');
    state.propertyWrites.push(clone(values));
    assert.ok(!Object.hasOwn(values, 'INVENTORY_TOKEN'), 'Recovery must never replace or rotate the connection token');
    assert.ok(!Object.hasOwn(values, 'INVENTORY_ACCESS_MODEL'), 'The existing access model must remain unchanged');
    for (const [key, value] of Object.entries(values)) {
      assert.equal(typeof value, 'string');
      if (key === STATE_KEY) assert.ok(!value.includes(TOKEN), 'Recovery state must not copy the token');
    }
    if (state.propertyErrorAt === state.propertyWrites.length) throw new Error(`Private property error ${TOKEN}`);
    Object.assign(properties, values);
    if (state.activationResponseLost && Object.hasOwn(values, 'INVENTORY_SHEET_ID')) {
      state.activationResponseLost = false;
      throw new Error(`Private lost property response ${TOKEN}`);
    }
  }
  function decodeRows(rows) {
    return rows.map(row => (row.values || []).map(cell => {
      const value = cell.userEnteredValue;
      if (!value) return '';
      assert.equal(Object.hasOwn(value, 'formulaValue'), false, 'Recovery must never create executable cell formulas');
      assert.equal(Object.keys(value).length, 1, 'Every written cell has an explicit value type');
      return value.stringValue ?? value.numberValue ?? value.boolValue ?? '';
    }));
  }
  const metadata = () => ({
    spreadsheetId: state.sheetsReturnedId || CANDIDATE_ID, properties: {timeZone: state.timeZone},
    sheets: state.tabs.map(tab => ({properties: {sheetId: tab.id, title: tab.title,
      sheetType: tab.sheetType || 'GRID', gridProperties: {rowCount: tab.rowCount, columnCount: tab.columnCount}}}))
  });
  const drive = {Files: {
    create(...args) {
      assert.equal(state.lockHeld, true);
      assert.equal(args.length, 1, 'Native spreadsheet creation uses only a metadata object');
      const resource = args[0];
      assert.equal(resource.mimeType, 'application/vnd.google-apps.spreadsheet');
      assert.equal(typeof resource.name, 'string');
      assert.ok(resource.name.length > 0);
      assert.ok(!JSON.stringify(resource).includes(TOKEN));
      assert.ok(!JSON.stringify(resource).includes(SOURCE_ID));
      assert.deepEqual(Object.keys(resource).sort(), ['mimeType', 'name']);
      const recovery = JSON.parse(properties[STATE_KEY]);
      assert.equal(recovery.stage, 'creating', 'Persist uncertainty marker before non-idempotent creation');
      assert.equal(recovery.candidateId, null);
      assert.equal(recovery.sourceId, SOURCE_ID);
      state.creates++;
      state.calls.push('create');
      if (state.createError) throw new Error(`Private Drive 403 ${TOKEN}`);
      state.tabs = [{id: 0, title: 'Sheet1', rowCount: 1000, columnCount: 26, rows: []}];
      if (state.onCreate) state.onCreate();
      if (state.createResponseLost) throw new Error(`Private lost create response ${TOKEN}`);
      return Object.hasOwn(state, 'createResponse') ? state.createResponse : {id: CANDIDATE_ID};
    },
    get(id, args) {
      assertCandidate(id);
      state.calls.push('drive');
      assert.equal(args.fields, 'id,mimeType,isAppAuthorized,trashed,capabilities(canEdit)');
      assert.equal(args.supportsAllDrives, true);
      if (state.driveError) throw state.driveError instanceof Error ? state.driveError : new Error(`Private Drive 403 ${TOKEN}`);
      return clone(state.driveResult);
    },
    update: denied('Drive update'), delete: denied('Drive delete'), copy: denied('Drive copy'), list: denied('Drive list')
  }};
  const sheets = {Spreadsheets: {
    create: denied('Sheets create'),
    get(id, args) {
      assertCandidate(id);
      state.calls.push('metadata');
      assert.equal(args.fields, 'spreadsheetId,properties(timeZone),sheets(properties)');
      if (state.sheetsError) throw new Error(`Private Sheets 404 ${TOKEN}`);
      return metadata();
    },
    Values: {
      get(id, range, args) {
        assertCandidate(id);
        state.calls.push('values');
        assert.equal(args.valueRenderOption, 'FORMULA', 'Blank-result formulas must not look like empty cells');
        assert.equal(args.dateTimeRenderOption, 'FORMATTED_STRING');
        const match = /^'((?:[^']|'')+)'!1:([0-9]+)$/.exec(range);
        assert.ok(match, `Recovery must inspect every column across the full tab: ${range}`);
        const tab = state.tabs.find(value => value.title === match[1].replace(/''/g, "'"));
        assert.ok(tab, 'Requested tab must exist');
        assert.equal(Number(match[2]), tab.rowCount, 'Range must inspect the full allocated row count');
        if (state.valuesError) throw new Error(`Private cell-read error ${TOKEN}`);
        const values = clone(tab.rows);
        for (const row of values) while (row.length && (row.at(-1) === '' || row.at(-1) === null)) row.pop();
        while (values.length && !values.at(-1).length) values.pop();
        if (state.onRead) state.onRead(tab.title);
        return {values};
      },
      append: denied('Values append'), update: denied('Values update'), clear: denied('Values clear')
    },
    batchUpdate(body, id) {
      assertCandidate(id);
      assert.equal(state.lockHeld, true, 'Spreadsheet writes require the script lock');
      const recovery = JSON.parse(properties[STATE_KEY]);
      assert.equal(recovery.stage, 'created');
      assert.equal(recovery.candidateId, CANDIDATE_ID, 'Persist candidate ID before attempting setup writes');
      assert.equal(properties.INVENTORY_SHEET_ID, SOURCE_ID, 'Preparation must not activate the candidate');
      if (state.batchError) throw new Error(`Private batch failure ${TOKEN}`);
      state.batches++;
      state.calls.push('batch');
      const tabs = clone(state.tabs);
      let timeZone = state.timeZone;
      for (const request of body.requests) {
        if (request.updateSpreadsheetProperties) {
          timeZone = request.updateSpreadsheetProperties.properties.timeZone;
        } else if (request.updateSheetProperties) {
          const fields = request.updateSheetProperties.properties;
          const tab = tabs.find(value => value.id === fields.sheetId);
          assert.ok(tab);
          if (fields.title) tab.title = fields.title;
          if (fields.gridProperties?.rowCount) tab.rowCount = fields.gridProperties.rowCount;
          if (fields.gridProperties?.columnCount) tab.columnCount = fields.gridProperties.columnCount;
        } else if (request.addSheet) {
          const fields = request.addSheet.properties;
          assert.ok(!tabs.some(value => value.title === fields.title || value.id === fields.sheetId));
          tabs.push({id: fields.sheetId, title: fields.title, rowCount: fields.gridProperties?.rowCount || 1000,
            columnCount: fields.gridProperties?.columnCount || 26, rows: []});
        } else if (request.updateCells) {
          const action = request.updateCells;
          const position = action.start || action.range;
          const tab = tabs.find(value => value.id === position.sheetId);
          assert.ok(tab);
          const startRow = position.rowIndex ?? position.startRowIndex ?? 0;
          const startColumn = position.columnIndex ?? position.startColumnIndex ?? 0;
          decodeRows(action.rows).forEach((row, r) => {
            tab.rows[startRow + r] ||= [];
            row.forEach((value, c) => { tab.rows[startRow + r][startColumn + c] = value; });
          });
        } else assert.ok(request.repeatCell || request.updateDimensionProperties || request.autoResizeDimensions,
          `Unexpected setup request: ${Object.keys(request)}`);
      }
      state.tabs = tabs;
      state.timeZone = timeZone;
      if (state.batchResponseLost) { state.batchResponseLost = false; throw new Error(`Private lost batch response ${TOKEN}`); }
      return {};
    }
  }};
  const context = vm.createContext({
    PropertiesService: {getScriptProperties: () => ({
      getProperty: key => properties[key] ?? null,
      setProperty: (key, value) => writeProperties({[key]: value}), setProperties: writeProperties,
      deleteProperty: denied('delete property'), deleteAllProperties: denied('delete properties')
    })},
    LockService: {getScriptLock: () => ({
      tryLock() { if (!state.lockAvailable) return false; assert.equal(state.lockHeld, false); state.lockHeld = true; return true; },
      releaseLock() { assert.equal(state.lockHeld, true); state.lockHeld = false; state.releases++; }
    })},
    Drive: Object.hasOwn(options, 'drive') ? options.drive : drive,
    Sheets: Object.hasOwn(options, 'sheets') ? options.sheets : sheets,
    Utilities: {newBlob: value => ({getBytes: () => Buffer.from(value, 'utf8')}), getUuid: denied('generate token')},
    ContentService: {MimeType: {JSON: 'application/json'},
      createTextOutput: value => ({value, setMimeType() { return this; }})},
    UrlFetchApp: {fetch: denied('remote fetch')},
    SpreadsheetApp: {openById: denied('broad spreadsheet API')},
    ScriptApp: {getOAuthToken: denied('read OAuth token'), requireScopes: denied('change scopes')},
    console: {log: (...args) => state.logs.push(args.map(String).join(' '))}
  });
  vm.runInContext(connectorSource, context, {filename: 'Code.gs'});
  vm.runInContext(recoverySource, context, {filename: 'RecoverEmptyWorksheet.gs'});
  const headers = clone(vm.runInContext('INVENTORY_HEADERS', context));
  const settingsRows = clone(vm.runInContext('EXPORT_SETTINGS_ROWS', context));
  const recovery = () => JSON.parse(properties[STATE_KEY]);
  const run = action => {
    try { return context[action](); }
    finally { assert.equal(state.lockHeld, false, 'Release the lock even on error'); assert.deepEqual(state.denied, []); }
  };
  const prepare = () => run('prepareEmptyWorksheetRecovery');
  const activate = () => run('activateEmptyWorksheetRecovery');
  const tab = title => state.tabs.find(value => value.title === title);
  return {state, properties, context, headers, settingsRows, recovery, prepare, activate, tab};
}

function assertOriginal(h) {
  assert.equal(h.properties.INVENTORY_SHEET_ID, SOURCE_ID);
  assert.equal(h.properties.INVENTORY_SHEET_URL, SOURCE_URL);
  assert.equal(h.properties.INVENTORY_ACCESS_MODEL, 'drive.file.v1');
  assert.equal(h.properties.INVENTORY_TOKEN, TOKEN);
}

function failure(h, action = h.prepare) {
  let caught;
  assert.throws(action, error => {
    caught = error;
    assert.equal(typeof error.message, 'string');
    assert.ok(error.message.length > 0);
    assert.ok(!error.message.includes(TOKEN));
    assert.ok(!error.message.includes(SOURCE_ID));
    assert.ok(!error.message.includes(CANDIDATE_ID));
    return true;
  });
  assert.equal(h.state.lockHeld, false);
  assert.ok(!h.state.logs.join('\n').includes(TOKEN));
  return caught;
}

test('preparation creates one native candidate, journals first, and keeps the active connection', () => {
  const h = fixture();
  h.prepare();
  assertOriginal(h);
  assert.equal(h.state.creates, 1);
  assert.equal(h.state.batches, 1);
  assert.equal(h.recovery().stage, 'ready');
  assert.equal(h.recovery().candidateId, CANDIDATE_ID);
  assert.equal(h.recovery().sourceId, SOURCE_ID);
  assert.equal(h.recovery().sourceUrl, SOURCE_URL);
  assert.equal(h.recovery().sourceAccessModel, 'drive.file.v1');
  assert.equal(h.recovery().version, 1);
  assert.deepEqual(h.state.tabs.map(value => value.title).sort(), ['Chemical inventory', 'Export settings']);
  assert.deepEqual(h.tab('Chemical inventory').rows, [h.headers]);
  assert.deepEqual(h.tab('Export settings').rows, h.settingsRows);
  assert.equal(h.state.timeZone, 'America/New_York');
  assert.ok(h.state.propertyWrites.every(write => Object.keys(write).every(key => key === STATE_KEY)));
});

test('missing configuration, service, or lock stops before non-idempotent creation', async t => {
  for (const options of [
    {properties: {INVENTORY_ACCESS_MODEL: ''}}, {properties: {INVENTORY_SHEET_ID: ''}},
    {properties: {INVENTORY_SHEET_URL: 'https://example.invalid/other'}}, {properties: {INVENTORY_TOKEN: ''}},
    {drive: undefined}, {drive: {Files: {}}}, {sheets: undefined}, {sheets: {Spreadsheets: {}}},
    {lockAvailable: false}
  ]) {
    await t.test(JSON.stringify(options), () => {
      const h = fixture(options);
      failure(h);
      assert.equal(h.state.creates, 0);
      assert.equal(h.state.batches, 0);
      assert.equal(h.state.propertyWrites.length, 0);
    });
  }
});

test('an ambiguous Drive create is never blindly retried', async t => {
  for (const options of [{createError: true}, {createResponseLost: true}, {createResponse: {}}]) {
    await t.test(JSON.stringify(options), () => {
      const h = fixture(options);
      failure(h);
      assert.equal(h.recovery().stage, 'creating');
      assertOriginal(h);
      failure(h);
      assert.equal(h.state.creates, 1);
      assert.equal(h.state.batches, 0);
    });
  }
});

test('failure to journal uncertainty prevents creation, while losing the ID journal prevents a duplicate', () => {
  const before = fixture({propertyErrorAt: 1});
  failure(before);
  assert.equal(before.state.creates, 0);
  assertOriginal(before);
  const after = fixture({propertyErrorAt: 2});
  failure(after);
  assert.equal(after.state.creates, 1);
  assert.equal(after.recovery().stage, 'creating');
  after.state.propertyErrorAt = null;
  failure(after);
  assert.equal(after.state.creates, 1);
});

test('captured candidate resumes after setup failure without creating another file', () => {
  const h = fixture({batchError: true});
  failure(h);
  assertOriginal(h);
  assert.equal(h.recovery().stage, 'created');
  assert.equal(h.recovery().candidateId, CANDIDATE_ID);
  h.state.batchError = false;
  h.prepare();
  assert.equal(h.state.creates, 1);
  assert.equal(h.state.batches, 1);
  assert.equal(h.recovery().stage, 'ready');
});

test('a committed setup with a lost response is verified without replaying writes', () => {
  const h = fixture({batchResponseLost: true});
  failure(h);
  assert.equal(h.recovery().stage, 'created');
  assert.equal(h.state.batches, 1);
  const content = clone(h.state.tabs);
  h.prepare();
  assert.deepEqual(h.state.tabs, content);
  assert.equal(h.state.batches, 1);
  assert.equal(h.state.creates, 1);
  assert.equal(h.recovery().stage, 'ready');
});

test('returned source ID or malformed candidate ID is refused before any file read or setup write', async t => {
  for (const id of [SOURCE_ID, 'short', 'unsafe/id']) {
    await t.test(id, () => {
      const h = fixture({createResponse: {id}});
      failure(h);
      assertOriginal(h);
      assert.deepEqual(h.state.calls, ['create']);
      assert.equal(h.state.batches, 0);
    });
  }
});

test('preparation never clears unexpected data or formulas from a newly returned candidate', async t => {
  for (const rows of [[['Existing data']], [['=""']], [[], ['', '', '', 'Private stray cell']]]) {
    await t.test(JSON.stringify(rows), () => {
      const h = fixture();
      h.state.onCreate = () => { h.state.tabs[0].rows = clone(rows); };
      failure(h);
      assert.equal(h.state.batches, 0);
      assert.deepEqual(h.state.tabs[0].rows, rows);
      assertOriginal(h);
    });
  }
});

test('ready preparation is verification only and cannot reset edits', () => {
  const h = fixture();
  h.prepare();
  const writes = h.state.propertyWrites.length;
  h.prepare();
  assert.equal(h.state.creates, 1);
  assert.equal(h.state.batches, 1);
  assert.equal(h.state.propertyWrites.length, writes);
  h.tab('Chemical inventory').rows.push(['new-record']);
  const data = clone(h.state.tabs);
  failure(h);
  assert.deepEqual(h.state.tabs, data);
  assertOriginal(h);
});

test('activation validates candidate and switches only ID, URL and journal in one property call', () => {
  const h = fixture();
  h.prepare();
  const writes = h.state.propertyWrites.length;
  h.activate();
  assert.equal(h.properties.INVENTORY_SHEET_ID, CANDIDATE_ID);
  assert.equal(h.properties.INVENTORY_SHEET_URL, CANDIDATE_URL);
  assert.equal(h.properties.INVENTORY_TOKEN, TOKEN);
  assert.equal(h.properties.INVENTORY_ACCESS_MODEL, 'drive.file.v1');
  assert.equal(h.recovery().stage, 'activated');
  assert.equal(h.recovery().sourceId, SOURCE_ID);
  assert.equal(h.recovery().sourceUrl, SOURCE_URL);
  assert.equal(h.state.propertyWrites.length, writes + 1);
  assert.deepEqual(Object.keys(h.state.propertyWrites.at(-1)).sort(),
    [STATE_KEY, 'INVENTORY_SHEET_ID', 'INVENTORY_SHEET_URL'].sort());
});

test('activation requires ready state and cannot initialize or create files itself', () => {
  const h = fixture();
  failure(h, h.activate);
  assert.equal(h.state.creates, 0);
  assert.equal(h.state.propertyWrites.length, 0);
  const pending = fixture({batchError: true});
  failure(pending);
  failure(pending, pending.activate);
  assert.equal(pending.state.creates, 1);
  assertOriginal(pending);
});

test('Drive authorization, edit capability, MIME, trash and identity must all pass before activation', async t => {
  for (const changes of [
    {isAppAuthorized: false}, {isAppAuthorized: undefined}, {capabilities: {canEdit: false}},
    {capabilities: {}}, {mimeType: 'application/pdf'}, {trashed: true}, {trashed: undefined},
    {id: 'other_candidate_file_abcdefghijklmnopqrstuvwxyz'}
  ]) {
    await t.test(JSON.stringify(changes), () => {
      const h = fixture();
      h.prepare();
      h.state.driveResult = {...h.state.driveResult, ...changes};
      const before = h.state.propertyWrites.length;
      failure(h, h.activate);
      assertOriginal(h);
      assert.equal(h.state.propertyWrites.length, before);
    });
  }
});

test('Drive or Sheets errors during activation preserve the source, token and staged candidate', async t => {
  for (const key of ['driveError', 'sheetsError', 'valuesError']) {
    await t.test(key, () => {
      const h = fixture();
      h.prepare();
      h.state[key] = true;
      failure(h, h.activate);
      assertOriginal(h);
      assert.equal(h.recovery().stage, 'ready');
      assert.equal(h.state.batches, 1);
      assert.equal(h.state.creates, 1);
    });
  }
});

test('populated candidates, changed headers/settings, stray columns and blank-result formulas block activation', async t => {
  const cases = {
    'inventory row': h => h.tab('Chemical inventory').rows.push(['record-id']),
    'changed header': h => { h.tab('Chemical inventory').rows[0][4] = 'Altered header'; },
    'PI entered': h => { h.tab('Export settings').rows[1][1] = 'privatePI'; },
    'stray inventory column': h => { h.tab('Chemical inventory').rows[0][25] = 'Private note'; },
    'stray settings column': h => { h.tab('Export settings').rows[1][25] = 'Private note'; },
    'formula': h => h.tab('Chemical inventory').rows.push(['=""']),
    'extra tab': h => h.state.tabs.push({id: 9, title: 'Notes', rowCount: 100, columnCount: 26, rows: []}),
    'wrong Sheets ID': h => { h.state.sheetsReturnedId = 'other_candidate_file_abcdefghijklmnopqrstuvwxyz'; }
  };
  for (const [name, change] of Object.entries(cases)) {
    await t.test(name, () => {
      const h = fixture();
      h.prepare();
      change(h);
      const content = clone(h.state.tabs);
      const writes = h.state.propertyWrites.length;
      failure(h, h.activate);
      assertOriginal(h);
      assert.deepEqual(clone(h.state.tabs), content);
      assert.equal(h.state.propertyWrites.length, writes);
      assert.equal(h.state.batches, 1);
    });
  }
});

test('external active configuration changes are checked before and again after candidate validation', async t => {
  for (const duringRead of [false, true]) {
    await t.test(duringRead ? 'change during validation' : 'change before activation', () => {
      const h = fixture();
      h.prepare();
      const change = () => {
        h.properties.INVENTORY_SHEET_ID = 'externally_changed_sheet_abcdefghijklmnopqrstuvwxyz';
        h.properties.INVENTORY_SHEET_URL = `https://docs.google.com/spreadsheets/d/${h.properties.INVENTORY_SHEET_ID}/edit`;
      };
      if (duringRead) h.state.onRead = change;
      else change();
      failure(h, h.activate);
      assert.equal(h.properties.INVENTORY_SHEET_ID, 'externally_changed_sheet_abcdefghijklmnopqrstuvwxyz');
      assert.equal(h.properties.INVENTORY_TOKEN, TOKEN);
      assert.equal(h.recovery().stage, 'ready');
    });
  }
});

test('activation failure before property commit keeps the old connection and can retry safely', () => {
  const h = fixture();
  h.prepare();
  h.state.propertyErrorAt = h.state.propertyWrites.length + 1;
  failure(h, h.activate);
  assertOriginal(h);
  h.state.propertyErrorAt = null;
  h.activate();
  assert.equal(h.properties.INVENTORY_SHEET_ID, CANDIDATE_ID);
  assert.equal(h.state.creates, 1);
  assert.equal(h.state.batches, 1);
});

test('repeated activation and preparation preserve later inventory records without rewrites', () => {
  const h = fixture();
  h.prepare();
  h.activate();
  h.tab('Chemical inventory').rows.push(['later-phone-record']);
  h.tab('Export settings').rows[1][1] = 'laterPI';
  const before = {tabs: clone(h.state.tabs), properties: clone(h.properties), calls: h.state.calls.length,
    writes: h.state.propertyWrites.length};
  h.activate();
  h.prepare();
  assert.deepEqual(h.state.tabs, before.tabs);
  assert.deepEqual(h.properties, before.properties);
  assert.equal(h.state.calls.length, before.calls);
  assert.equal(h.state.propertyWrites.length, before.writes);
  assert.equal(h.state.creates, 1);
  assert.equal(h.state.batches, 1);
});

test('lost activation response can be retried without resetting a subsequently populated worksheet', () => {
  const h = fixture();
  h.prepare();
  h.state.activationResponseLost = true;
  failure(h, h.activate);
  assert.equal(h.recovery().stage, 'activated');
  h.tab('Chemical inventory').rows.push(['later-phone-record']);
  h.activate();
  assert.equal(h.tab('Chemical inventory').rows.length, 2);
  assert.equal(h.state.creates, 1);
  assert.equal(h.state.batches, 1);
  assert.equal(h.properties.INVENTORY_TOKEN, TOKEN);
});

test('malformed or edited recovery journal never triggers another creation', async t => {
  for (const serialized of ['bad JSON', '{}', '[]', JSON.stringify({version: 1, stage: 'unknown'}),
    JSON.stringify({version: 1, sourceId: SOURCE_ID, sourceUrl: SOURCE_URL, sourceAccessModel: 'drive.file.v1', stage: 'ready', candidateId: SOURCE_ID})]) {
    await t.test(serialized, () => {
      const h = fixture({properties: {[STATE_KEY]: serialized}});
      failure(h);
      assertOriginal(h);
      assert.equal(h.state.creates, 0);
      assert.equal(h.state.propertyWrites.length, 0);
    });
  }
});

test('HTTP callers cannot invoke either recovery helper even with a valid lab token', () => {
  const h = fixture();
  for (const action of ['prepareEmptyWorksheetRecovery', 'activateEmptyWorksheetRecovery', 'recover', 'recovery']) {
    const response = h.context.doPost({postData: {type: 'application/json', contents: JSON.stringify({action, token: TOKEN})}});
    const payload = JSON.parse(response.value);
    assert.equal(payload.ok, false);
    assert.equal(payload.code, 'validation_error');
  }
  assertOriginal(h);
  assert.equal(h.state.creates, 0);
  assert.equal(h.state.batches, 0);
  assert.equal(h.state.propertyWrites.length, 0);
  assert.deepEqual(h.state.calls, []);
});

test('Google failure detail preserves the failing method and reason while redacting secrets', () => {
  const h = fixture();
  const email = 'rep@lab.example.edu';
  const opaque = 'opaque_value_abcdefghijklmnopqrstuvwxyz1234567890';
  h.state.driveError = new Error(`Drive.Files.get failed: File not found; ${TOKEN}; ${SOURCE_ID}; ${CANDIDATE_ID}; ${CANDIDATE_URL}; ${email}; Bearer short.secret; ${opaque}`);
  const error = failure(h);
  assert.match(error.message, /Drive\.Files\.get failed: File not found/);
  for (const secret of [TOKEN, SOURCE_ID, CANDIDATE_ID, CANDIDATE_URL, email, opaque, 'short.secret']) {
    assert.ok(!error.message.includes(secret));
  }
  assert.ok(error.message.split('Detail: ')[1].length <= 351);
  assertOriginal(h);
  assert.equal(h.recovery().stage, 'created');
  assert.equal(h.state.creates, 1);
});
