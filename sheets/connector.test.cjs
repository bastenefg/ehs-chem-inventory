// Offline Apps Script boundary tests. Run: node --test sheets/connector.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID, createHash } = require('node:crypto');

const SOURCE = fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8');
const SHEET_ID = 'sheet_abcdefghijklmnopqrstuvwxyz_12345';
const TOKEN = 'b'.repeat(128);

function harness(options = {}) {
  const state = { writes: 0, opens: 0, creates: 0, lockHeld: false, releases: 0,
    uuidCalls: 0, logs: [], requests: [], sheets: [], tabExists: true, lockAvailable: true, ...options };
  const properties = { INVENTORY_SHEET_ID: SHEET_ID, INVENTORY_TOKEN: TOKEN,
    INVENTORY_SHEET_URL: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
    INVENTORY_ACCESS_MODEL: 'drive.file.v1', ...options.properties };
  const clone = value => JSON.parse(JSON.stringify(value));
  const decode = cell => {
    if (!cell.userEnteredValue) return '';
    const value = cell.userEnteredValue;
    assert.equal('formulaValue' in value, false, 'connector must never create executable formulas');
    assert.equal(Object.keys(value).length, 1, 'every entered cell has one explicit value type');
    if (typeof value.stringValue === 'string') assert.ok(value.stringValue.length <= 50000, 'text must fit Google Sheets cell limits');
    return value.stringValue ?? value.numberValue ?? value.boolValue ?? '';
  };
  const writeCells = (sheet, row, column, rowData) => {
    rowData.forEach((entry, r) => {
      sheet.rows[row + r] ??= [];
      (entry.values || []).forEach((cell, c) => { sheet.rows[row + r][column + c] = decode(cell); });
    });
    sheet.maxRows = Math.max(sheet.maxRows, row + rowData.length);
  };
  const addSheet = resource => {
    const p = resource.properties;
    assert.equal(state.sheets.some(s => s.name === p.title), false, 'never replace an existing sheet');
    const sheet = { id: p.sheetId ?? 100 + state.sheets.length, name: p.title, rows: [],
      maxRows: p.gridProperties?.rowCount || 1000, maxColumns: p.gridProperties?.columnCount || 26 };
    state.sheets.push(sheet);
    for (const data of resource.data || []) writeCells(sheet, data.startRow || 0, data.startColumn || 0, data.rowData || []);
    return sheet;
  };
  const metadata = () => ({ spreadsheetId: SHEET_ID, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
    properties: { timeZone: 'America/New_York' },
    sheets: state.sheets.filter(s => s.name !== 'Chemical inventory' || state.tabExists).map(s => ({ properties: {
      sheetId: s.id, title: s.name, gridProperties: { rowCount: s.maxRows, columnCount: s.maxColumns }
    } })) });
  const read = (id, a1, opts) => {
    state.opens++;
    if (state.openError) throw new Error(`Sensitive exception ${TOKEN}`);
    assert.equal(id, SHEET_ID);
    assert.ok(['UNFORMATTED_VALUE', 'FORMULA'].includes(opts.valueRenderOption));
    const match = a1.match(/^(?:'((?:[^']|'')+)'|([^!]+))(?:!(.*))?$/);
    assert.ok(match, `valid A1 range: ${a1}`);
    const sheet = state.sheets.find(s => s.name === (match[1]?.replace(/''/g, "'") || match[2]));
    assert.ok(sheet, `existing tab: ${a1}`);
    const range = match[3] || '';
    const parts = range.split(':');
    const coordinate = value => {
      const m = value.match(/^([A-Z]*)(\d*)$/);
      assert.ok(m, `supported A1 coordinate: ${value}`);
      const col = [...m[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
      return { col: col ? col - 1 : undefined, row: m[2] ? Number(m[2]) - 1 : undefined };
    };
    const start = coordinate(parts[0]);
    const end = coordinate(parts[1] ?? parts[0]);
    const values = sheet.rows.slice(start.row || 0, end.row === undefined ? sheet.rows.length : end.row + 1)
      .map(row => row.slice(start.col || 0, end.col === undefined ? row.length : end.col + 1));
    for (const row of values) while (row.length && (row.at(-1) === '' || row.at(-1) == null)) row.pop();
    while (values.length && !values.at(-1).length) values.pop();
    const result = { range: a1, majorDimension: 'ROWS', values: clone(values) };
    if (state.onRead) state.onRead(a1);
    return result;
  };
  const log = (...args) => state.logs.push(args.map(String).join(' '));
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => properties[key] ?? null,
      setProperties: values => {
        assert.equal(state.lockHeld, true, 'configuration writes require the script lock');
        if (state.onSetProperties) state.onSetProperties(values, properties);
        Object.assign(properties, values);
      },
      setProperty: (key, value) => {
        assert.equal(state.lockHeld, true, 'configuration writes require the script lock');
        if (state.onSetProperty) state.onSetProperty(key, value, properties);
        properties[key] = value;
      },
      getProperties: () => ({ ...properties })
    }) },
    Drive: { Files: {
      create(resource) {
        assert.equal(state.lockHeld, true);
        assert.equal(arguments.length, 1, 'native file creation needs no blob or credentials argument');
        assert.equal(resource.name, 'Lab chemical inventory');
        assert.equal(resource.mimeType, 'application/vnd.google-apps.spreadsheet');
        assert.equal(JSON.parse(properties.INVENTORY_CREATE_PENDING).stage, 'creating');
        state.creates++;
        if (state.createError) throw new Error(`Sensitive create exception ${TOKEN}`);
        state.requests.push(clone(resource));
        state.sheets = [];
        state.tabExists = true;
        addSheet({ properties: { title: 'Sheet1', sheetId: 0 } });
        state.writes++;
        if (state.onCreate) state.onCreate(state);
        if (state.createResponseLost) throw new Error(`Lost create response ${TOKEN}`);
        return state.createResult ?? { id: SHEET_ID };
      },
      get(id, options) {
        state.driveReads = (state.driveReads || 0) + 1;
        assert.equal(id, SHEET_ID);
        assert.equal(options.fields, 'id,mimeType,isAppAuthorized,trashed,capabilities(canEdit)');
        assert.equal(options.supportsAllDrives, true);
        if (state.driveError) throw state.driveError;
        return state.driveResult ?? { id, mimeType: 'application/vnd.google-apps.spreadsheet',
          isAppAuthorized: true, trashed: false, capabilities: { canEdit: true } };
      }
    } },
    Sheets: { Spreadsheets: {
      create() { assert.fail('normal setup must create native sheets through Drive'); },
      get(id, options) {
        state.opens++;
        if (state.openError) throw new Error(`Sensitive exception ${TOKEN}`);
        assert.equal(id, SHEET_ID);
        assert.equal(options.fields, 'spreadsheetId,properties(timeZone),sheets(properties)');
        return metadata();
      },
      Values: { get: read, batchGet: (id, args) => ({ valueRanges: args.ranges.map(a1 => read(id, a1, args)) }) },
      batchUpdate(body, id) {
        assert.equal(id, SHEET_ID);
        assert.equal(state.lockHeld, true, 'every write must hold the script lock');
        if (state.writeError) throw new Error(`Sensitive write exception ${TOKEN}`);
        state.requests.push(clone(body));
        const replies = body.requests.map(request => {
          if (request.addSheet) return { addSheet: { properties: { sheetId: addSheet(request.addSheet).id } } };
          const action = request.appendCells || request.updateCells;
          if (action) {
            const sheet = state.sheets.find(s => s.id === (action.sheetId ?? action.start?.sheetId ?? action.range?.sheetId));
            assert.ok(sheet, 'cell writes must address an existing sheet ID');
            if (action.range) {
              for (let r = action.range.startRowIndex || 0; r < (action.range.endRowIndex ?? sheet.rows.length); r++) {
                for (let c = action.range.startColumnIndex || 0; c < (action.range.endColumnIndex ?? sheet.maxColumns); c++) {
                  if (sheet.rows[r]) sheet.rows[r][c] = '';
                }
              }
            }
            writeCells(sheet, request.appendCells ? sheet.rows.length : (action.start?.rowIndex ?? action.range?.startRowIndex ?? 0),
              action.start?.columnIndex ?? action.range?.startColumnIndex ?? 0, action.rows || []);
          } else if (request.updateSheetProperties) {
            const p = request.updateSheetProperties.properties;
            const sheet = state.sheets.find(s => s.id === p.sheetId);
            if (p.title) sheet.name = p.title;
            if (p.gridProperties?.rowCount) sheet.maxRows = p.gridProperties.rowCount;
            if (p.gridProperties?.columnCount) sheet.maxColumns = p.gridProperties.columnCount;
          } else {
            assert.ok(request.updateSpreadsheetProperties || request.repeatCell || request.updateDimensionProperties || request.setDataValidation || request.autoResizeDimensions,
              `unmocked Sheets operation: ${Object.keys(request)}`);
          }
          return {};
        });
        state.writes++;
        if (state.writeResponseLost) { state.writeResponseLost = false; throw new Error(`Lost write response ${TOKEN}`); }
        return { replies };
      }
    } },
    LockService: { getScriptLock: () => ({
      tryLock() {
        if (!state.lockAvailable) return false;
        assert.equal(state.lockHeld, false);
        state.lockHeld = true;
        if (state.onLock) state.onLock();
        return true;
      },
      releaseLock() { assert.equal(state.lockHeld, true); state.lockHeld = false; state.releases++; }
    }) },
    Utilities: {
      getUuid() { state.uuidCalls++; return randomUUID(); },
      formatDate: date => date.toISOString().slice(0, 10),
      newBlob: body => ({ getBytes: () => Buffer.from(body, 'utf8') }),
      DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
      computeDigest(algorithm, value, charset) {
        assert.equal(algorithm, 'SHA_256');
        assert.equal(charset, 'UTF_8');
        return [...createHash('sha256').update(value, 'utf8').digest()].map(n => n > 127 ? n - 256 : n);
      }
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: value => ({ value, setMimeType(type) { this.type = type; return this; } })
    },
    Logger: { log }, console: { log, info: log, warn: log, error: log }
  });
  vm.runInContext(SOURCE, context, { filename: 'Code.gs' });
  const headers = Array.from(vm.runInContext('INVENTORY_HEADERS', context));
  const fields = Array.from(vm.runInContext('RECORD_FIELDS', context));
  const inventory = addSheet({ properties: { title: 'Chemical inventory', sheetId: 0,
    gridProperties: { rowCount: options.maxRows || 1000 } } });
  if (!options.emptySheet) inventory.rows = [headers];
  const settings = addSheet({ properties: { title: 'Export settings', sheetId: 1 } });
  settings.rows = clone(vm.runInContext('EXPORT_SETTINGS_ROWS', context));
  Object.defineProperties(state, {
    rows: { get: () => state.sheets.find(s => s.name === 'Chemical inventory').rows },
    maxRows: { get: () => state.sheets.find(s => s.name === 'Chemical inventory').maxRows },
    exports: { get: () => state.sheets.filter(s => s.name.startsWith('EHSA export ')) }
  });
  const post = payload => {
    const result = context.doPost({ postData: { contents: JSON.stringify(payload), type: 'application/json; charset=utf-8' } });
    assert.equal(result.type, 'application/json');
    return JSON.parse(result.value);
  };
  return { state, context, properties, headers, fields, post, metadata,
    tab: name => state.sheets.find(s => s.name === name) };
}

function record(overrides = {}) {
  return {
    id: '3f333e9e-1e11-4f44-8555-d688fd24d878', createdAt: '2026-09-06T20:30:00.000Z',
    pi: 'Example PI', room: '66-347', chemicalName: 'Ethanol',
    amount: '500', unit: 'mL', physicalState: 'Liquid', containerCount: '1', cas: '64-17-5',
    casUnavailableReason: '', concentration: '95%', supplier: 'Example supplier', catalogNumber: 'EX-100',
    expiryDate: '2027-01-31', notes: '', labelText: 'Ethanol\n500 mL', casSource: 'Label',
    reviewed: true, syncState: 'pending', syncedAt: '', ...overrides
  };
}

function append(h, overrides = {}) { return h.post({ action: 'append', token: TOKEN, record: record(overrides) }); }

test('manifest requests only per-file access and source uses no broad or HTML services', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'appsscript.json'), 'utf8'));
  assert.deepEqual(manifest.oauthScopes, ['https://www.googleapis.com/auth/drive.file']);
  assert.ok(manifest.dependencies.enabledAdvancedServices.some(service =>
    service.userSymbol === 'Sheets' && service.serviceId === 'sheets' && service.version === 'v4'));
  assert.ok(manifest.dependencies.enabledAdvancedServices.some(service =>
    service.userSymbol === 'Drive' && service.serviceId === 'drive' && service.version === 'v3'));
  assert.doesNotMatch(SOURCE, /Sheets\.Spreadsheets\.create\s*\(/);
  assert.doesNotMatch(SOURCE, /\b(?:SpreadsheetApp|HtmlService|DriveApp|UrlFetchApp)\s*\./);
});

test('authenticated ping checks readiness without mutating worksheet or creating tabs', () => {
  const h = harness();
  assert.deepEqual(h.post({ action: 'ping', token: TOKEN }), {
    ok: true, sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`
  });
  assert.equal(h.state.writes, 0);
  assert.equal(h.state.releases, 0);
  h.state.tabExists = false;
  assert.match(h.post({ action: 'ping', token: TOKEN }).error, /tab is missing/);
  assert.equal(h.state.tabExists, false);
});

test('invalid authentication never opens spreadsheet or leaks the expected token', () => {
  const h = harness();
  for (const token of ['', 'wrong', TOKEN.slice(1), TOKEN + 'b', null, 42]) {
    const response = h.post({ action: 'ping', token });
    assert.equal(response.ok, false);
    assert.equal(response.code, 'unauthorized');
    assert.equal(JSON.stringify(response).includes(TOKEN), false);
  }
  assert.equal(h.state.opens, 0);
  assert.equal(h.state.writes, 0);
});

test('append writes one reviewed row with numbers and server-authoritative sync metadata', () => {
  const h = harness();
  const result = append(h, { containerCount: '3', syncedAt: 'untrusted time' });
  assert.deepEqual(result, {
    ok: true, sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`, recordId: record().id
  });
  assert.equal(h.state.rows.length, 2);
  assert.equal(h.state.rows[1][h.fields.indexOf('amount')], 500);
  assert.equal(h.state.rows[1][h.fields.indexOf('containerCount')], 3);
  assert.equal(h.state.rows[1][h.fields.indexOf('reviewed')], true);
  assert.equal(h.state.rows[1][h.fields.indexOf('syncState')], 'synced');
  assert.match(h.state.rows[1][h.fields.indexOf('syncedAt')], /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(h.state.lockHeld, false);
  assert.equal(h.state.releases, 1);
});

test('duplicate retry preserves every original value, including container count', () => {
  const h = harness();
  const first = append(h);
  const originalRow = h.state.rows[1].slice();
  const retry = append(h);
  assert.deepEqual(retry, first);
  assert.deepEqual(h.state.rows[1], originalRow);
  assert.equal(h.state.rows.length, 2);
  assert.equal(h.state.writes, 1);
  assert.equal(h.state.releases, 2);
  append(h, { id: 'a-new-record-id' });
  assert.equal(h.state.rows.length, 3);
});

test('a lost response after a successful append can be retried without adding a second row', () => {
  const h = harness({ writeResponseLost: true });
  assert.equal(append(h).ok, false);
  assert.equal(h.state.rows.length, 2, 'the service committed before the response was lost');
  const original = h.state.rows[1].slice();
  assert.equal(append(h).ok, true);
  assert.equal(h.state.rows.length, 2);
  assert.deepEqual(h.state.rows[1], original);
  assert.equal(h.state.writes, 1);
});

test('an existing ID with different reviewed content returns conflict without acknowledging or changing it', () => {
  const changes = {createdAt: '2026-09-07T20:30:00.000Z', pi: 'Another PI', room: '66-348',
    chemicalName: 'Different chemical', amount: '501', unit: 'L', physicalState: 'Solid',
    containerCount: '99', cas: '67-56-1', casUnavailableReason: 'Changed reason',
    concentration: '99%', supplier: 'Another supplier', catalogNumber: 'EX-200', expiryDate: '2028-01-31',
    notes: 'Changed notes', labelText: 'Changed transcription', casSource: 'Changed source'};
  for (const [field, value] of Object.entries(changes)) {
    const h = harness();
    assert.equal(append(h).ok, true);
    const original = h.state.rows[1].slice();
    const result = append(h, {[field]: value});
    assert.equal(result.ok, false, field);
    assert.equal(result.code, 'id_conflict', field);
    assert.equal(result.recordId, undefined, 'conflicts must not acknowledge a saved record');
    assert.equal(JSON.stringify(result).includes(TOKEN), false);
    assert.equal(JSON.stringify(result).includes(value), false, 'conflicts do not return record data');
    assert.deepEqual(h.state.rows[1], original);
    assert.equal(h.state.rows.length, 2);
    assert.equal(h.state.writes, 1);
    assert.equal(h.state.lockHeld, false);
  }
});

test('a changed retry after a lost successful response conflicts while the exact retry remains safe', () => {
  const h = harness({writeResponseLost: true});
  assert.equal(append(h).ok, false);
  const original = h.state.rows[1].slice();
  assert.equal(append(h, {containerCount: '99'}).code, 'id_conflict');
  assert.equal(append(h).ok, true);
  assert.deepEqual(h.state.rows[1], original);
  assert.equal(h.state.rows.length, 2);
  assert.equal(h.state.writes, 1);
});

test('retry comparison normalizes numeric quantities and text while ignoring only server sync fields', () => {
  const h = harness();
  assert.equal(append(h, {id: '123', amount: '0500.00', containerCount: '01', notes: '  Reviewed notes  '}).ok, true);
  h.state.rows[1][h.fields.indexOf('id')] = 123;
  h.state.rows[1][h.fields.indexOf('amount')] = '500.0';
  h.state.rows[1][h.fields.indexOf('syncState')] = 'owner annotation';
  h.state.rows[1][h.fields.indexOf('syncedAt')] = 'owner annotation';
  const original = h.state.rows[1].slice();
  assert.equal(append(h, {id: '123', amount: '5e2', notes: 'Reviewed notes',
    syncState: 'syncing', syncedAt: 'different client metadata'}).ok, true);
  assert.deepEqual(h.state.rows[1], original);
  assert.equal(h.state.writes, 1);
});

test('manual worksheet edits, malformed existing records and duplicate IDs cannot be acknowledged as the original', () => {
  const mutations = [h => { h.state.rows[1][h.fields.indexOf('notes')] = 'Administrator correction'; },
    h => { h.state.rows[1][h.fields.indexOf('reviewed')] = false; },
    h => { h.state.rows[1][h.fields.indexOf('amount')] = 'invalid'; },
    h => { h.state.rows[1][h.fields.indexOf('chemicalName')] = ''; },
    h => { h.state.rows.push(h.state.rows[1].slice()); }];
  for (const mutate of mutations) {
    const h = harness();
    append(h);
    mutate(h);
    const original = JSON.stringify(h.state.rows);
    assert.equal(append(h).code, 'id_conflict');
    assert.equal(JSON.stringify(h.state.rows), original);
    assert.equal(h.state.writes, 1);
    assert.equal(h.state.lockHeld, false);
  }
});

test('credentials are rechecked after waiting for the append lock', () => {
  const h = harness();
  h.state.onLock = () => { h.properties.INVENTORY_TOKEN = 'c'.repeat(128); };
  assert.equal(append(h).code, 'unauthorized');
  assert.equal(h.state.writes, 0);
  assert.equal(h.state.lockHeld, false);
});

test('HTTP callers cannot invoke owner setup, export, credential display, or rotation', () => {
  const h = harness();
  for (const action of ['initializeInventory', 'initialize', 'showConnectionDetails', 'rotateConnectionToken',
    'rotate', 'prepareEhsaImport', 'export']) {
    assert.equal(h.post({ action, token: TOKEN }).ok, false);
  }
  assert.equal(h.properties.INVENTORY_TOKEN, TOKEN);
  assert.equal(h.state.writes, 0);
  assert.equal(h.state.creates, 0);
});

test('formula-like untrusted text is stored as literal typed strings across unconstrained fields', () => {
  const h = harness();
  const dangerousFields = ['pi', 'chemicalName', 'casUnavailableReason', 'concentration',
    'supplier', 'catalogNumber', 'notes', 'labelText', 'casSource'];
  const values = ['=IMPORTXML("https://example.invalid", "x")', '+1+1', '-2+1', '@SUM(A1)', '\t=1+1', '\r\n =1+1'];
  values.forEach((value, index) => {
    const changes = Object.fromEntries(dangerousFields.map(field => [field, value]));
    const result = append(h, { ...changes, id: `formula-test-${index}` });
    assert.equal(result.ok, true);
    const row = h.state.rows.at(-1);
    dangerousFields.forEach(field => assert.equal(row[h.fields.indexOf(field)], value.trim(), field));
  });
});

test('server validates required fields, review, numeric bounds, CAS, dates, enums, and schema', async t => {
  const invalid = [
    { id: '=1+1' }, { id: '' }, { pi: '' }, { room: ' ' }, { room: 'Building 1 / Room 101' }, { chemicalName: '' },
    { reviewed: false }, { reviewed: 'true' }, { amount: '0' }, { amount: '-1' }, { amount: 'NaN' },
    { amount: 'Infinity' }, { amount: '1e999' }, { amount: '=2+2' }, { amount: '500 mL' }, { amount: 500 },
    { containerCount: '0' }, { containerCount: '1.5' }, { containerCount: '1000001' },
    { unit: 'bottle' }, { physicalState: 'Unknown' }, { physicalState: 'liquid' },
    { cas: '64-17-6' }, { cas: '64175' }, { cas: '', casUnavailableReason: '' },
    { createdAt: 'yesterday' }, { createdAt: '2026-02-30T12:00:00Z' },
    { expiryDate: '2027-02-30' }, { expiryDate: '01/31/2027' },
    { labelText: 'x'.repeat(16001) }, { notes: '\u0000=1+1' }, { unrecognizedField: 'x' }
  ];
  for (const changes of invalid) {
    await t.test(JSON.stringify(changes).slice(0, 100), () => {
      const h = harness();
      assert.equal(append(h, changes).ok, false);
      assert.equal(append(h, changes).code, 'validation_error');
      assert.equal(h.state.rows.length, 1);
      assert.equal(h.state.writes, 0);
    });
  }
});

test('valid missing CAS reason, supported units, decimals, and scientific quantities are accepted', () => {
  const h = harness();
  assert.equal(append(h, { cas: '', casUnavailableReason: 'Mixture; verify ingredients on SDS', amount: '1e-3' }).ok, true);
  for (const [i, unit] of ['mg', 'g', 'kg', 'µL', 'mL', 'L', 'oz', 'lb', 'fl oz', 'gal', 'ft³', 'm³'].entries()) {
    assert.equal(append(h, { id: `unit-${i}`, unit, amount: '.25' }).ok, true);
  }
});

test('header drift, reordering, and extra columns reject ping and append without writing', () => {
  for (const change of [
    row => { row[0] = 'Renamed record ID'; },
    row => { [row[4], row[5]] = [row[5], row[4]]; },
    row => row.push('Extra column')
  ]) {
    const h = harness();
    change(h.state.rows[0]);
    assert.equal(h.post({ action: 'ping', token: TOKEN }).ok, false);
    assert.equal(append(h).ok, false);
    assert.equal(h.state.writes, 0);
    assert.equal(h.state.lockHeld, false);
  }
});

test('malformed, oversized, unknown-action, unknown-schema, and wrong-MIME requests are rejected', () => {
  const h = harness();
  for (const event of [
    null, {}, { postData: { contents: '{broken', type: 'application/json' } },
    { postData: { contents: ' '.repeat(65537), type: 'application/json' } },
    { postData: { contents: JSON.stringify({ action: 'ping', token: '界'.repeat(22000) }), type: 'application/json' } },
    { postData: { contents: JSON.stringify({ action: 'ping', token: TOKEN }), type: 'text/plain' } }
  ]) assert.equal(JSON.parse(h.context.doPost(event).value).ok, false);
  for (const payload of [[], null, { action: 'delete', token: TOKEN },
    { action: 'ping', token: TOKEN, sheetId: SHEET_ID },
    { action: 'ping', token: TOKEN, record: record() },
    { action: 'append', token: TOKEN }, { action: 'append', token: TOKEN, record: [] }
  ]) assert.equal(h.post(payload).ok, false);
  assert.equal(h.state.writes, 0);
});

test('busy lock rejects append without writing and release occurs after service failures', () => {
  const busy = harness({ lockAvailable: false });
  assert.match(append(busy).error, /busy/);
  assert.equal(append(busy).code, 'busy');
  assert.equal(busy.state.writes, 0);
  assert.equal(busy.state.releases, 0);
  const failing = harness({ openError: true });
  const response = append(failing);
  assert.equal(response.ok, false);
  assert.equal(response.code, 'internal_error');
  assert.equal(JSON.stringify(response).includes(TOKEN), false);
  assert.equal(failing.state.lockHeld, false);
  assert.equal(failing.state.releases, 1);
});

function freshHarness(options = {}) {
  return harness({ ...options, properties: { INVENTORY_SHEET_ID: null, INVENTORY_TOKEN: null,
    INVENTORY_ACCESS_MODEL: null, INVENTORY_SHEET_URL: null, ...options.properties } });
}

test('partial inventory properties never start another worksheet creation, including empty saved markers', () => {
  const remnants = {INVENTORY_SHEET_ID: SHEET_ID, INVENTORY_TOKEN: TOKEN,
    INVENTORY_SHEET_URL: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
    INVENTORY_ACCESS_MODEL: 'drive.file.v1', INVENTORY_CREATE_PENDING: '',
    INVENTORY_EMPTY_RECOVERY: JSON.stringify({stage: 'activated', candidateId: SHEET_ID})};
  for (const [key, value] of Object.entries(remnants)) {
    for (const remaining of [value, '']) {
      const h = freshHarness({properties: {[key]: remaining}});
      const original = {...h.properties};
      for (let attempt = 0; attempt < 2; attempt++) {
        assert.throws(() => h.context.initializeInventory(), error => !error.message.includes(TOKEN), key);
        assert.deepEqual(h.properties, original, key);
      }
      assert.equal(h.state.creates, 0, key);
      assert.equal(h.state.writes, 0, key);
      assert.equal(h.state.opens, 0, key);
      assert.equal(h.state.driveReads || 0, 0, key);
      assert.equal(h.state.uuidCalls, 0, key);
      assert.equal(h.state.lockHeld, false, key);
    }
  }
});

test('unrelated project properties do not prevent a genuinely new inventory setup', () => {
  const h = freshHarness({properties: {LAB_CONTACT_LABEL: 'Example lab contact'}});
  h.context.initializeInventory();
  assert.equal(h.state.creates, 1);
  assert.equal(h.properties.LAB_CONTACT_LABEL, 'Example lab contact');
  assert.equal(h.properties.INVENTORY_ACCESS_MODEL, 'drive.file.v1');
});

test('initializer creates its own spreadsheet and token once, preserving rows and credentials on rerun', () => {
  const h = freshHarness();
  h.context.initializeInventory();
  assert.deepEqual(h.state.rows[0], h.headers);
  assert.equal(h.state.uuidCalls, 4);
  assert.equal(h.state.creates, 1);
  assert.equal(h.properties.INVENTORY_ACCESS_MODEL, 'drive.file.v1');
  assert.equal(h.properties.INVENTORY_SHEET_URL, `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`);
  assert.match(h.properties.INVENTORY_TOKEN, /^[a-f0-9]{128}$/);
  const originalToken = h.properties.INVENTORY_TOKEN;
  h.post({ action: 'append', token: originalToken, record: record() });
  const originalRow = h.state.rows[1].slice();
  h.context.initializeInventory();
  assert.equal(h.properties.INVENTORY_TOKEN, originalToken);
  assert.deepEqual(h.state.rows[1], originalRow);
  assert.equal(h.state.uuidCalls, 4);
  assert.equal(h.state.creates, 1);
  assert.equal(h.state.logs.join('\n').includes(originalToken), false);
  assert.equal(JSON.stringify(h.state.sheets).includes(originalToken), false);
  assert.ok(h.tab('Export settings'), 'creates owner-editable export metadata in the same file');
});

test('old manually configured sheet IDs cannot be adopted without the script-created access marker', () => {
  for (const marker of [null, '', 'spreadsheets', 'drive.file.v0']) {
    const h = harness({ properties: { INVENTORY_ACCESS_MODEL: marker } });
    assert.throws(() => h.context.initializeInventory(), /new worksheet|fresh standalone/);
    assert.equal(h.post({ action: 'ping', token: TOKEN }).code, 'configuration_error');
    assert.equal(append(h).code, 'configuration_error');
    assert.equal(h.state.opens, 0);
    assert.equal(h.state.writes, 0);
    assert.equal(h.state.creates, 0);
    assert.equal(h.state.lockHeld, false);
  }
});

test('changing the configured ID without its canonical URL is rejected before any Google request', () => {
  const h = harness({ properties: { INVENTORY_SHEET_ID: 'another-lab-sheet' } });
  assert.equal(append(h).code, 'configuration_error');
  assert.equal(h.state.opens, 0);
  assert.equal(h.state.writes, 0);
});

test('creation failures are sanitized and ambiguous retries cannot create duplicate workbooks', () => {
  for (const failure of [{ createError: true }, { createResponseLost: true }]) {
    const h = freshHarness(failure);
    assert.throws(() => h.context.initializeInventory(), error => !error.message.includes(TOKEN));
    assert.equal(h.state.creates, 1);
    assert.ok(h.properties.INVENTORY_CREATE_PENDING);
    if (failure.createResponseLost) assert.deepEqual(h.tab('Sheet1').rows, [], 'native file creation committed before headers could be written');
    h.state.createError = false;
    h.state.createResponseLost = false;
    assert.throws(() => h.context.initializeInventory(), /earlier worksheet creation|possible duplicate/);
    assert.equal(h.state.creates, 1);
    assert.equal(h.state.lockHeld, false);
  }
});

test('missing Advanced Sheets service fails before pending creation or credential changes', () => {
  for (const missingService of [undefined, {}, { Spreadsheets: {} }, { Spreadsheets: { create: null } }]) {
    const h = freshHarness();
    h.context.Sheets = missingService;
    const originalProperties = { ...h.properties };
    assert.throws(() => h.context.initializeInventory(), /Enable.*Sheets|Sheets.*service/);
    assert.deepEqual(h.properties, originalProperties);
    assert.equal(h.state.creates, 0);
    assert.equal(h.state.writes, 0);
    assert.equal(h.state.lockHeld, false);
  }
});

test('missing Advanced Drive service fails before any creation receipt or credential change', () => {
  for (const service of [undefined, {}, { Files: {} }, { Files: { create: null, get() {} } }]) {
    const h = freshHarness();
    h.context.Drive = service;
    const before = { ...h.properties };
    assert.throws(() => h.context.initializeInventory(), /Enable the Drive API v3/);
    assert.deepEqual(h.properties, before);
    assert.equal(h.state.creates, 0);
    assert.equal(h.state.lockHeld, false);
  }
});

test('captured native file ID survives a configuration-write failure and resumes without another create', () => {
  const h = freshHarness();
  h.state.onSetProperties = () => { throw new Error('Configuration write temporarily unavailable'); };
  assert.throws(() => h.context.initializeInventory(), /temporarily unavailable/);
  assert.equal(JSON.parse(h.properties.INVENTORY_CREATE_PENDING).id, SHEET_ID);
  assert.equal(h.properties.INVENTORY_SHEET_ID, null);
  h.state.onSetProperties = null;
  h.context.initializeInventory();
  assert.equal(h.state.creates, 1);
  assert.equal(h.properties.INVENTORY_SHEET_ID, SHEET_ID);
  assert.equal(h.properties.INVENTORY_CREATE_PENDING, '');
});

test('a captured receipt never overwrites a conflicting active connection', () => {
  const h = harness({ properties: { INVENTORY_CREATE_PENDING: JSON.stringify({version: 1, stage: 'created', id: 'different_sheet_id_123456789'}) } });
  const before = { ...h.properties };
  assert.throws(() => h.context.initializeInventory(), /receipt and active configuration disagree/);
  assert.deepEqual(h.properties, before);
  assert.equal(h.state.creates, 0);
  assert.equal(h.state.opens, 0);
  assert.equal(h.state.writes, 0);
});

test('new setup requires its Drive file grant and retains the candidate for safe retry', () => {
  const h = freshHarness({ driveResult: { id: SHEET_ID, mimeType: 'application/vnd.google-apps.spreadsheet',
    isAppAuthorized: false, trashed: false, capabilities: { canEdit: true } } });
  assert.throws(() => h.context.initializeInventory(), /not confirmed.*can edit/);
  const token = h.properties.INVENTORY_TOKEN;
  assert.equal(JSON.parse(h.properties.INVENTORY_CREATE_PENDING).id, SHEET_ID);
  assert.deepEqual(h.tab('Sheet1').rows, []);
  h.state.driveResult = null;
  h.context.initializeInventory();
  assert.equal(h.state.creates, 1);
  assert.equal(h.properties.INVENTORY_TOKEN, token);
});

test('new setup refuses unexpected data, blank-result formulas, or extra tabs without overwriting', () => {
  for (const change of [
    state => { state.sheets[0].rows = [[], ['', '', 'Existing chemical']]; },
    state => { state.sheets[0].rows = [['=""']]; },
    state => { state.sheets.push({ id: 9, name: 'Unexpected', rows: [], maxRows: 1000, maxColumns: 26 }); }
  ]) {
    const h = freshHarness({ onCreate: change });
    assert.throws(() => h.context.initializeInventory(), /unexpected tabs, values, or formulas/);
    const before = JSON.stringify(h.state.sheets);
    assert.throws(() => h.context.initializeInventory(), /unexpected tabs, values, or formulas/);
    assert.equal(JSON.stringify(h.state.sheets), before);
    assert.equal(h.state.creates, 1);
    assert.equal(h.state.writes, 1, 'only initial file creation may have committed');
  }
});

test('lost bootstrap response preserves later rows, PI settings, and exports when initialization resumes', () => {
  const h = freshHarness({ writeResponseLost: true });
  assert.throws(() => h.context.initializeInventory(), /Lost write response/);
  assert.deepEqual(h.state.rows[0], h.headers);
  const token = h.properties.INVENTORY_TOKEN;
  h.post({ action: 'append', token, record: record() });
  setPi(h);
  h.context.prepareEhsaImport();
  const before = JSON.stringify(h.state.sheets);
  h.context.initializeInventory();
  assert.equal(JSON.stringify(h.state.sheets), before, 'resume may format but cannot reset any values or tabs');
  assert.equal(h.state.creates, 1);
  assert.equal(h.properties.INVENTORY_TOKEN, token);
  assert.equal(h.properties.INVENTORY_CREATE_PENDING, '');
});

test('working or recovered connections never invoke Drive creation or require empty data', () => {
  const h = harness({ properties: { INVENTORY_EMPTY_RECOVERY: JSON.stringify({ stage: 'activated' }) } });
  append(h);
  setPi(h);
  h.context.prepareEhsaImport();
  const before = JSON.stringify(h.state.sheets);
  h.context.Drive = undefined;
  h.context.initializeInventory();
  assert.equal(JSON.stringify(h.state.sheets), before);
  assert.equal(h.properties.INVENTORY_TOKEN, TOKEN);
  assert.equal(h.state.creates, 0);
});

test('initialization retains Google error reasons while redacting credentials and file identifiers', () => {
  const email = 'private.person@example.edu';
  const h = freshHarness({ driveError: new Error(`Drive.Files.get failed: File not found ${SHEET_ID}; ${TOKEN}; https://example.invalid/private; ${email}; Bearer short.secret`) });
  assert.throws(() => h.context.initializeInventory(), error => {
    assert.match(error.message, /Drive\.Files\.get failed: File not found/);
    for (const secret of [SHEET_ID, TOKEN, email, 'example.invalid', 'short.secret']) assert.equal(error.message.includes(secret), false);
    return true;
  });
  assert.equal(h.state.lockHeld, false);
});

test('failure after workbook creation retains its ID and token so reinitialization does not create another', () => {
  const h = freshHarness({ writeError: true });
  assert.throws(() => h.context.initializeInventory(), error => !error.message.includes(TOKEN));
  const id = h.properties.INVENTORY_SHEET_ID;
  const token = h.properties.INVENTORY_TOKEN;
  assert.equal(id, SHEET_ID);
  assert.ok(token);
  assert.equal(JSON.parse(h.properties.INVENTORY_CREATE_PENDING).id, id);
  h.state.writeError = false;
  h.context.initializeInventory();
  assert.equal(h.properties.INVENTORY_SHEET_ID, id);
  assert.equal(h.properties.INVENTORY_TOKEN, token);
  assert.equal(h.state.creates, 1);
  assert.equal(h.state.uuidCalls, 4);
  assert.equal(h.properties.INVENTORY_CREATE_PENDING, '');
});

test('owner-run rotation immediately revokes the previous token without writing or logging credentials', () => {
  const h = harness();
  h.context.rotateConnectionToken();
  assert.notEqual(h.properties.INVENTORY_TOKEN, TOKEN);
  assert.equal(h.post({ action: 'ping', token: TOKEN }).ok, false);
  assert.equal(h.post({ action: 'ping', token: h.properties.INVENTORY_TOKEN }).ok, true);
  assert.equal(h.state.rows.length, 1);
  assert.equal(h.state.writes, 0);
  h.context.showConnectionDetails();
  assert.equal(h.state.logs.join('\n').includes(TOKEN), false);
  assert.equal(h.state.logs.join('\n').includes(h.properties.INVENTORY_TOKEN), false);
  assert.equal(JSON.stringify(h.state.sheets).includes(h.properties.INVENTORY_TOKEN), false);
});

test('owner operations sanitize underlying service errors and release locks', () => {
  for (const name of ['initializeInventory', 'showConnectionDetails', 'prepareEhsaImport']) {
    const h = harness({ openError: true });
    assert.throws(() => h.context[name](), error => !error.message.includes(TOKEN) &&
      (name === 'initializeInventory' || !error.message.includes('Sensitive')));
    assert.equal(h.state.lockHeld, false);
    assert.equal(h.state.logs.join('\n').includes(TOKEN), false);
  }
});

test('token rotation works during a Google outage and rejects the old token after access recovers', () => {
  const h = harness({openError: true, driveError: new Error('File not found')});
  const configuration = {...h.properties};
  h.context.rotateConnectionToken();
  const replacement = h.properties.INVENTORY_TOKEN;
  assert.notEqual(replacement, TOKEN);
  assert.match(replacement, /^[a-f0-9]{128}$/);
  assert.deepEqual(h.properties, {...configuration, INVENTORY_TOKEN: replacement});
  assert.equal(h.state.opens, 0);
  assert.equal(h.state.driveReads || 0, 0);
  assert.equal(h.state.writes, 0);
  assert.equal(h.state.creates, 0);
  assert.equal(h.state.lockHeld, false);
  assert.equal(h.state.logs.join('\n').includes(TOKEN), false);
  assert.equal(h.state.logs.join('\n').includes(replacement), false);
  h.state.openError = false;
  h.state.driveError = null;
  assert.equal(append(h).code, 'unauthorized');
  assert.equal(h.state.opens, 0, 'revoked credentials fail before Google is called');
  assert.equal(h.post({action: 'append', token: replacement, record: record()}).ok, true);
  assert.equal(h.state.rows.length, 2);
});

test('token rotation rejects inconsistent local configuration without touching services or properties', () => {
  for (const properties of [{INVENTORY_SHEET_ID: ''}, {INVENTORY_SHEET_URL: ''},
    {INVENTORY_ACCESS_MODEL: 'old-access-model'}, {INVENTORY_TOKEN: ''}]) {
    const h = harness({properties});
    const before = {...h.properties};
    assert.throws(() => h.context.rotateConnectionToken());
    assert.deepEqual(h.properties, before);
    assert.equal(h.state.opens, 0);
    assert.equal(h.state.driveReads || 0, 0);
    assert.equal(h.state.uuidCalls, 0);
    assert.equal(h.state.lockHeld, false);
  }
});

test('token rotation sanitizes local persistence errors and releases its lock', () => {
  const h = harness({onSetProperty() { throw new Error(`Private property failure ${TOKEN}`); }});
  assert.throws(() => h.context.rotateConnectionToken(), error =>
    !error.message.includes(TOKEN) && !error.message.includes('Private'));
  assert.equal(h.properties.INVENTORY_TOKEN, TOKEN);
  assert.equal(h.state.lockHeld, false);
  assert.equal(h.state.opens, 0);
  assert.equal(h.state.logs.join('\n').includes(TOKEN), false);
});

test('GET reveals no configuration and performs no write', () => {
  const h = harness();
  const response = JSON.parse(h.context.doGet().value);
  assert.equal(response.ok, false);
  assert.equal(JSON.stringify(response).includes(TOKEN), false);
  assert.equal(h.state.opens, 0);
  assert.equal(h.state.writes, 0);
});

function setPi(h, answers = ['pikerberos', 'Last name', 'First name']) {
  answers.forEach((value, i) => { h.tab('Export settings').rows[i + 1][1] = value; });
}

function exportSnapshot(h, answers = ['pikerberos', 'Last name', 'First name']) {
  setPi(h, answers);
  h.context.prepareEhsaImport();
}

function warnings(h) { return h.tab('Export review').rows.slice(1).filter(row => row[1]); }
function confirmWarnings(h) { warnings(h).forEach(row => { row[0] = true; }); }
function reviewText(h) { return JSON.stringify(h.tab('Export review')?.rows || []); }

test('append expands a full worksheet grid without changing earlier rows', () => {
  const h = harness({ maxRows: 1 });
  assert.equal(append(h).ok, true);
  assert.equal(h.state.maxRows, 2);
  assert.deepEqual(h.state.rows[0], h.headers);
});

test('EHSA maps every verified state-specific unit code exactly and rejects cubic meters', () => {
  const h = harness();
  const expected = {
    mg: ['mg', 'mg (L)', 'mg (G)'], g: ['G', 'G (L)', 'G (G)'], kg: ['KG', 'KG (L)', 'KG (G)'],
    'µL': ['µL (S)', 'µL', 'µL (G)'], mL: ['mL (S)', 'mL', 'mL (G)'],
    L: ['Liters (S)', 'Liters', 'Liters (G)'], oz: ['Ounces', 'Ounces (L)', 'Ounces (G)'],
    lb: ['LB (S)', 'LB (L)', 'LB'], 'ft³': ['CU.FT.(S)', 'CU.FT.(L)', 'CU.FT.'],
    'fl oz': ['Fluid Ounces', 'Fluid Ounces', 'Fluid Ounces'], gal: ['Gal', 'Gal', 'Gal']
  };
  for (const [unit, codes] of Object.entries(expected)) {
    ['Solid', 'Liquid', 'Gas'].forEach((state, i) => assert.equal(h.context.ehsaUnitCode_(unit, state), codes[i]));
  }
  assert.equal(h.context.ehsaUnitCode_('m³', 'Gas'), null);
  assert.equal(h.context.ehsaUnitCode_('L', 'unknown'), null);
  assert.equal(h.context.ehsaUnitCode_('toString', 'Gas'), null);
});

test('EHSA snapshot uses exact 27-column headers, worksheet PI settings, rooms, amounts, dates, and supplier comments', () => {
  const h = harness();
  append(h, { room: 'NW14-4104', containerCount: '3', amount: '2.5', unit: 'g', physicalState: 'Liquid' });
  const original = h.state.rows.map(row => row.slice());
  exportSnapshot(h);
  assert.equal(h.state.exports.length, 1);
  const snapshot = h.state.exports[0];
  assert.match(snapshot.name, /^EHSA export \d{8} \d{6}/);
  assert.equal(snapshot.maxColumns, 27);
  assert.equal(snapshot.rows.length, 3);
  assert.deepEqual(snapshot.rows[0], Array.from(vm.runInContext('EHSA_LABELS', h.context)));
  assert.deepEqual(snapshot.rows[1], ['researcher', 'last_name', 'first_name', 'building', 'lab',
    'storage_device', 'storage_location', 'chemical_description', 'physical_state', 'receipt_quantity',
    'unit', 'chemical_unit', 'cas_num', 'vendor', 'catalog_number', 'receipt_date', 'expiration_date',
    'contact', 'comments', 'date_entered', 'ship_code', 'private_share', 'last_update', 'concentration',
    'chemical_number', 'lot_number', 'msds_url']);
  const output = snapshot.rows[2];
  assert.equal(output.length, 27);
  assert.deepEqual(output.slice(0, 5), ['pikerberos', 'Last name', 'First name', 'NW14', 'NW14-4104']);
  assert.deepEqual(output.slice(9, 12), [3, 2.5, 'G (L)']);
  assert.equal(output[13], '', 'free supplier name is never assigned to a vendor code');
  assert.equal(output[15], '', 'capture date is not a receipt date');
  assert.equal(output[16], '01/31/2027');
  assert.match(output[18], /Supplier: Example supplier/);
  assert.match(output[18], new RegExp(record().id));
  assert.equal(output[19], '09/06/2026');
  assert.equal(output[20], '', 'record ID is not an EHSA barcode');
  assert.deepEqual(h.state.rows, original);
  assert.match(h.state.logs.at(-1), /Nothing has been submitted to MIT/);
});

test('each EHSA export is a new snapshot, including colliding timestamps', () => {
  const h = harness();
  append(h, { room: '66-347' });
  exportSnapshot(h);
  const firstRows = h.state.exports[0].rows.map(row => row.slice());
  exportSnapshot(h);
  assert.equal(h.state.exports.length, 2);
  assert.notEqual(h.state.exports[0].name, h.state.exports[1].name);
  assert.deepEqual(h.state.exports[0].rows, firstRows);
  const stamp = new Date('2026-09-06T12:34:56.000Z');
  const baseName = h.context.uniqueExportName_(h.metadata(), stamp);
  h.state.sheets.push({ id: 999, name: baseName, rows: [], maxRows: 1000, maxColumns: 27 });
  assert.equal(h.context.uniqueExportName_(h.metadata(), stamp), baseName + ' (2)');
});

test('missing or invalid PI settings prevent all export writes and never alter script properties', () => {
  for (const answers of [[], ['pikerberos'], ['pikerberos', 'Last'], ['pi@mit.edu'], ['pikerberos', '']]) {
    const h = harness();
    append(h, { room: '66-347' });
    const properties = { ...h.properties };
    const writes = h.state.writes;
    assert.throws(() => exportSnapshot(h, answers), /Enter valid PI/);
    assert.equal(h.state.exports.length, 0);
    assert.equal(h.state.writes, writes);
    assert.deepEqual(h.properties, properties);
  }
});

test('renamed PI setting labels block export even if the values look valid', () => {
  const h = harness();
  append(h);
  setPi(h);
  h.tab('Export settings').rows[1][0] = 'Incorrect label';
  assert.throws(() => h.context.prepareEhsaImport(), /labels changed/);
  assert.equal(h.state.exports.length, 0);
});

test('EHSA export refuses the entire snapshot when any row has unsupported units or invalid room/review', () => {
  for (const change of [
    { unit: 'm³', physicalState: 'Gas' }, { room: 'Room 347' }, { reviewed: false },
    { cas: '', casUnavailableReason: '' }
  ]) {
    const h = harness();
    append(h, { room: '66-347' });
    append(h, { room: '66-348', id: 'second-record' });
    for (const [field, value] of Object.entries(change)) h.state.rows[2][h.fields.indexOf(field)] = value;
    const original = h.state.rows.map(row => row.slice());
    exportSnapshot(h);
    assert.equal(h.state.exports.length, 0);
    assert.deepEqual(h.state.rows, original);
    assert.match(reviewText(h), /Row 3:/);
  }
});

test('missing CAS requires separate explicit no-CAS confirmation, preserves the reason, and records EHS follow-up', () => {
  const h = harness();
  append(h, { room: '66-347', cas: '', casUnavailableReason: 'No single CAS for this mixture' });
  const original = h.state.rows.map(row => row.slice());
  exportSnapshot(h);
  assert.equal(h.state.exports.length, 0);
  assert.deepEqual(h.state.rows, original);
  const confirmation = warnings(h)[0];
  assert.equal(confirmation[0], false);
  assert.equal(confirmation[2], record().id);
  assert.equal(confirmation[3], 'Ethanol');
  assert.match(confirmation[4], /No single CAS for this mixture/);
  assert.match(confirmation[4], /unreadable or missing label is unresolved/);
  confirmWarnings(h);
  exportSnapshot(h);
  assert.equal(h.state.exports.length, 1);
  assert.equal(h.state.exports[0].rows[2][12], '');
  assert.match(h.state.exports[0].rows[2][18], /No single CAS for this mixture/);
  assert.match(h.state.exports[0].rows[2][18], /explicitly confirmed that no CAS exists/);
  assert.match(reviewText(h), /cannot be matched by CAS/);
});

test('an inventory edited during preparation is caught by the second read', () => {
  const h = harness();
  append(h);
  let inventoryReads = 0;
  h.state.onRead = a1 => {
    if (a1 === "'Chemical inventory'!A2:U" && ++inventoryReads === 1) {
      h.state.rows[1][h.fields.indexOf('chemicalName')] = 'A changed material';
    }
  };
  assert.throws(() => exportSnapshot(h), /changed during preparation/);
  assert.equal(h.state.exports.length, 0);
  assert.equal(h.state.lockHeld, false);
});

test('EHSA export uses literal typed strings for manually edited values and PI settings', () => {
  const h = harness();
  append(h, { room: '66-347' });
  h.state.rows[1][h.fields.indexOf('chemicalName')] = '=1+1';
  h.state.rows[1][h.fields.indexOf('notes')] = '@SUM(A1)';
  h.state.rows[1][h.fields.indexOf('catalogNumber')] = '+2+2';
  h.state.rows[1][h.fields.indexOf('concentration')] = '-1+1';
  exportSnapshot(h, ['pikerberos', '=malicious', '+name']);
  const row = h.state.exports[0].rows[2];
  assert.equal(row[1], '=malicious');
  assert.equal(row[2], '+name');
  assert.equal(row[7], '=1+1');
  assert.equal(row[14], '+2+2');
  assert.ok(row[18].startsWith('@SUM(A1)'));
  assert.equal(row[23], '-1+1');
});

test('duplicate Record IDs and multiple worksheet PIs block an export rather than merging rows', () => {
  for (const change of [{ id: record().id }, { pi: 'Another PI' }]) {
    const h = harness();
    append(h, { room: '66-347' });
    append(h, { room: '66-348', id: 'second-record' });
    for (const [field, value] of Object.entries(change)) h.state.rows[2][h.fields.indexOf(field)] = value;
    exportSnapshot(h);
    assert.equal(h.state.exports.length, 0);
    assert.match(reviewText(h), /duplicated|Multiple PI/);
  }
});

test('generic source units require individual checkbox confirmation and preserve exact unit codes', () => {
  for (const [unit, code] of [['fl oz', 'Fluid Ounces'], ['gal', 'Gal']]) {
    const h = harness();
    append(h, { room: '66-347', unit });
    exportSnapshot(h);
    assert.equal(h.state.exports.length, 0);
    const warning = warnings(h)[0];
    assert.equal(warning[0], false);
    assert.equal(warning[3], 'Ethanol');
    assert.match(warning[4], /check acceptance.*EHS before importing/);
    confirmWarnings(h);
    exportSnapshot(h);
    assert.equal(h.state.exports[0].rows[2][11], code);
    assert.match(h.state.exports[0].rows[2][18], /Generic EHSA unit code/);
    assert.match(h.state.exports[0].rows[2][18], /confirm live importer acceptance/);
  }
});

test('each warning needs its own boolean confirmation, including new records and multiple warnings per record', () => {
  const h = harness();
  append(h, { cas: '', casUnavailableReason: 'No CAS exists', unit: 'gal' });
  exportSnapshot(h);
  assert.equal(warnings(h).length, 2);
  warnings(h)[0][0] = true;
  warnings(h)[1][0] = 'true';
  exportSnapshot(h);
  assert.equal(h.state.exports.length, 0);
  assert.deepEqual(warnings(h).map(row => row[0]), [true, false]);
  confirmWarnings(h);
  append(h, { id: 'new-warning-record', cas: '', casUnavailableReason: 'No CAS exists' });
  exportSnapshot(h);
  assert.equal(h.state.exports.length, 0);
  assert.equal(warnings(h).find(row => row[2] === 'new-warning-record')[0], false);
  confirmWarnings(h);
  exportSnapshot(h);
  assert.equal(h.state.exports.length, 1);
});

test('record or PI metadata changes invalidate old warning fingerprints', () => {
  for (const changes of [
    { chemicalName: 'Changed chemical' }, { amount: 250 }, { containerCount: 2 },
    { casUnavailableReason: 'Changed reason' }, { room: '66-348' }, { notes: 'Changed note' },
    { labelText: 'New label text' }, { piMetadata: true }
  ]) {
    const h = harness();
    append(h, { cas: '', casUnavailableReason: 'No CAS exists' });
    exportSnapshot(h);
    confirmWarnings(h);
    const previousFingerprint = warnings(h)[0][5];
    if (changes.piMetadata) setPi(h, ['anotherpi', 'Last name', 'First name']);
    else for (const [field, value] of Object.entries(changes)) h.state.rows[1][h.fields.indexOf(field)] = value;
    h.context.prepareEhsaImport();
    assert.equal(h.state.exports.length, 0, JSON.stringify(changes));
    assert.equal(warnings(h)[0][0], false);
    assert.notEqual(warnings(h)[0][5], previousFingerprint);
  }
});

test('maximal escaped record text uses a bounded fingerprint and fits worksheet cells', () => {
  const h = harness();
  const escaped = '\\'.repeat(512);
  const changes = { id: 'a'.repeat(128), pi: escaped, room: 'A'.repeat(255) + '-' + '1'.repeat(256),
    chemicalName: escaped, amount: '0'.repeat(511) + '1', containerCount: '0'.repeat(511) + '1',
    cas: '', casUnavailableReason: escaped, concentration: escaped, supplier: escaped, catalogNumber: escaped,
    notes: '\\'.repeat(4000), labelText: '\\'.repeat(16000), casSource: escaped,
    syncState: escaped, syncedAt: escaped };
  const normalized = h.context.validateRecord_(record(changes));
  const metadata = { kerberos: 'pikerberos', lastName: '\\'.repeat(128), firstName: '\\'.repeat(128) };
  assert.ok(JSON.stringify([normalized, metadata]).length > 50000, 'fixture exceeds one cell as raw JSON');
  const fingerprint = h.context.recordFingerprint_(normalized, metadata);
  assert.match(fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(h.context.recordFingerprint_(normalized, metadata), fingerprint);
  assert.equal(append(h, changes).ok, true);
  for (const field of ['amount', 'containerCount', 'syncState', 'syncedAt']) {
    h.state.rows[1][h.fields.indexOf(field)] = changes[field];
  }
  exportSnapshot(h, [metadata.kerberos, metadata.lastName, metadata.firstName]);
  assert.equal(warnings(h)[0][5], fingerprint);
  confirmWarnings(h);
  h.context.prepareEhsaImport();
  assert.equal(h.state.exports.length, 1);
});

test('tampered warning details or duplicate confirmed keys cannot authorize export', () => {
  for (const mutate of [
    rows => { rows[0][2] = 'wrong-record'; },
    rows => { rows[0][3] = 'Wrong chemical'; },
    rows => { rows[0][4] = 'Misleading confirmation'; },
    rows => { rows[0][5] = 'stale-fingerprint'; },
    (rows, h) => { h.tab('Export review').rows.push(rows[0].slice()); }
  ]) {
    const h = harness();
    append(h, { cas: '', casUnavailableReason: 'No CAS exists' });
    exportSnapshot(h);
    confirmWarnings(h);
    mutate(warnings(h), h);
    exportSnapshot(h);
    assert.equal(h.state.exports.length, 0);
    assert.equal(warnings(h)[0][0], false);
  }
});

test('a checkbox revoked during export preparation blocks the snapshot', () => {
  const h = harness();
  append(h, { cas: '', casUnavailableReason: 'No CAS exists' });
  exportSnapshot(h);
  confirmWarnings(h);
  let inventoryReads = 0;
  h.state.onRead = a1 => {
    if (a1 === "'Chemical inventory'!A2:U" && ++inventoryReads === 2) warnings(h)[0][0] = false;
  };
  assert.throws(() => exportSnapshot(h), /confirmations changed/);
  assert.equal(h.state.exports.length, 0);
  assert.equal(h.state.lockHeld, false);
});

test('review details and completed snapshots never receive connection credentials', () => {
  const h = harness();
  append(h, { cas: '', casUnavailableReason: 'No CAS exists' });
  exportSnapshot(h);
  confirmWarnings(h);
  exportSnapshot(h);
  assert.equal(JSON.stringify(h.state.sheets).includes(TOKEN), false);
  assert.equal(JSON.stringify(h.state.requests).includes(TOKEN), false);
  assert.equal(h.state.logs.join('\n').includes(TOKEN), false);
});
