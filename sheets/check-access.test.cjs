const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'CheckAccess.gs'), 'utf8');
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const SHEET_ID = 'access_fixture_sheet_abcdefghijklmnopqrstuvwxyz';
const TOKEN = 'access_fixture_private_token_abcdefghijklmnopqrstuvwxyz';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;

function fixture(options = {}) {
  const properties = {
    INVENTORY_ACCESS_MODEL: 'drive.file.v1', INVENTORY_SHEET_ID: SHEET_ID,
    INVENTORY_SHEET_URL: SHEET_URL, INVENTORY_TOKEN: TOKEN,
    ...options.properties
  };
  const reads = [];
  const logs = [];
  const deniedCalls = [];
  const denied = name => () => { deniedCalls.push(name); throw new Error(`Forbidden action ${name}`); };
  const scriptApp = {
    AuthMode: {FULL: 'FULL'}, AuthorizationStatus: {REQUIRED: 'REQUIRED', NOT_REQUIRED: 'NOT_REQUIRED'},
    getAuthorizationInfo(mode, scopes) {
      reads.push('scope');
      assert.equal(mode, 'FULL');
      assert.deepEqual(Array.from(scopes), [SCOPE]);
      if (options.scopeError) throw options.scopeError;
      return {
        getAuthorizationStatus() { return options.authStatus ?? 'NOT_REQUIRED'; },
        getAuthorizedScopes() { return Object.hasOwn(options, 'authorizedScopes') ? options.authorizedScopes : [SCOPE]; },
        getAuthorizationUrl: denied('authorization URL')
      };
    },
    requireScopes(mode, scopes) {
      if (!options.allowAuthorization) return denied('requireScopes')();
      reads.push('requireScopes');
      assert.equal(mode, 'FULL');
      assert.deepEqual(Array.from(scopes), [SCOPE]);
      if (options.authorizationError) throw options.authorizationError;
    },
    getOAuthToken: denied('OAuth token'), invalidateAuth: denied('invalidate authorization'),
    newTrigger: denied('trigger')
  };
  const drive = {Files: {
    get(id, args) {
      reads.push('drive');
      assert.equal(id, SHEET_ID);
      assert.equal(args.fields, 'id,mimeType,isAppAuthorized,trashed,capabilities(canEdit)');
      assert.equal(args.supportsAllDrives, true);
      if (options.driveError) throw options.driveError;
      return Object.hasOwn(options, 'driveResult') ? options.driveResult : {
        id, mimeType: 'application/vnd.google-apps.spreadsheet', isAppAuthorized: true,
        trashed: false, capabilities: {canEdit: true}
      };
    },
    create: denied('Drive create'), update: denied('Drive update'), delete: denied('Drive delete'),
    copy: denied('Drive copy'), list: denied('Drive list')
  }};
  const sheets = {Spreadsheets: {
    get(id, args) {
      reads.push('sheets');
      assert.equal(id, SHEET_ID);
      assert.equal(args.fields, 'spreadsheetId,properties(timeZone),sheets(properties)');
      if (options.sheetsError) throw options.sheetsError;
      return Object.hasOwn(options, 'sheetsResult') ? options.sheetsResult : {
        spreadsheetId: id, properties: {timeZone: 'America/New_York'},
        sheets: [{properties: {sheetId: 0, title: 'Chemical inventory'}}]
      };
    },
    create: denied('Sheets create'), batchUpdate: denied('Sheets batchUpdate'),
    Values: {get: denied('read cell values'), append: denied('append'), update: denied('update'), clear: denied('clear')}
  }};
  const context = vm.createContext({
    console: {log: message => logs.push(String(message))},
    PropertiesService: {getScriptProperties: () => ({
      getProperty: key => properties[key] ?? null,
      setProperty: denied('set property'), setProperties: denied('set properties'),
      deleteProperty: denied('delete property'), deleteAllProperties: denied('delete properties')
    })},
    ScriptApp: Object.hasOwn(options, 'scriptApp') ? options.scriptApp : scriptApp,
    Drive: Object.hasOwn(options, 'drive') ? options.drive : drive,
    Sheets: Object.hasOwn(options, 'sheets') ? options.sheets : sheets,
    UrlFetchApp: {fetch: denied('remote fetch'), fetchAll: denied('remote fetch all')},
    SpreadsheetApp: {openById: denied('broad spreadsheet access'), getActive: denied('bound sheet')},
    doPost: denied('connector POST'), initializeInventory: denied('initialization'),
    rotateConnectionToken: denied('token rotation')
  });
  vm.runInContext(source, context);
  const run = (authorize = false) => {
    const before = JSON.stringify(properties);
    const result = authorize ? context.authorizeInventoryFileAccess() : context.checkInventoryFileAccess();
    assert.deepEqual(deniedCalls, [], 'Access diagnostics must never attempt writes, prompts, or token retrieval');
    assert.equal(JSON.stringify(properties), before, 'Existing setup must remain untouched');
    return result;
  };
  return {context, logs, reads, properties, deniedCalls, run};
}

test('read-only access checks report independent scope, Drive and Sheets evidence', () => {
  const f = fixture();
  const report = f.run();
  assert.equal(report.configuration, 'ok');
  assert.equal(report.scope, 'notRequired');
  assert.equal(report.scopeStatus, 'notRequired');
  assert.equal(report.scopeAuthorized, true);
  assert.equal(report.drive, 'ok');
  assert.equal(report.sheets, 'ok');
  assert.equal(report.idMatched, true);
  assert.equal(report.mimeSheets, true);
  assert.equal(report.appAuthorized, true);
  assert.equal(report.trashed, false);
  assert.equal(report.canEdit, true);
  assert.equal(report.sheetsIdMatched, true);
  assert.deepEqual(f.reads, ['scope', 'drive', 'sheets']);
  const summaries = f.logs.filter(line => /^RESULT ACCESS /.test(line));
  assert.equal(summaries.length, 1);
  for (const key of ['configuration', 'scope', 'scopeStatus', 'scopeAuthorized', 'drive', 'sheets', 'idMatched', 'mimeSheets', 'appAuthorized', 'trashed', 'canEdit', 'sheetsIdMatched', 'errors']) {
    assert.ok(summaries[0].includes(key), `Summary must include ${key}`);
  }
  for (const secret of [TOKEN, SHEET_ID, SHEET_URL]) {
    assert.ok(!JSON.stringify(report).includes(secret));
    assert.ok(!f.logs.join('\n').includes(secret));
  }
});

test('scope status uses both authorization requirement and granted scopes', async t => {
  for (const [authStatus, authorizedScopes, expected] of [
    ['NOT_REQUIRED', [SCOPE], 'notRequired'],
    ['REQUIRED', [], 'missing'],
    ['NOT_REQUIRED', [], 'inconsistent'],
    ['REQUIRED', [SCOPE], 'inconsistent'],
    ['NOT_REQUIRED', null, 'unknown'],
    ['REQUIRED', null, 'missing'],
    ['OTHER', [SCOPE], 'unknown']
  ]) {
    await t.test(`${authStatus} / ${JSON.stringify(authorizedScopes)}`, () => {
      const f = fixture({authStatus, authorizedScopes});
      const report = f.run();
      assert.equal(report.scope, expected);
      assert.equal(report.scopeStatus, authStatus === 'REQUIRED' ? 'required' : authStatus === 'NOT_REQUIRED' ? 'notRequired' : 'unknown');
      assert.equal(report.scopeAuthorized, authorizedScopes === null ? 'unknown' : authorizedScopes.includes(SCOPE));
      assert.equal(report.sheets, 'ok');
      assert.ok(f.reads.includes('drive'));
      assert.ok(f.reads.includes('sheets'));
    });
  }
});

test('scope inspection failures and unavailable ScriptApp still allow metadata reads', async t => {
  for (const [options, expected] of [
    [{scriptApp: undefined}, 'unavailable'],
    [{scriptApp: {}}, 'unavailable'],
    [{scopeError: new Error('Authorization status unavailable')}, 'error']
  ]) {
    await t.test(expected, () => {
      const f = fixture(options);
      const report = f.run();
      assert.equal(report.scope, expected);
      assert.equal(report.drive, 'ok');
      assert.equal(report.sheets, 'ok');
    });
  }
});

test('Drive and Sheets failures are independent and neither prevents the other check', async t => {
  for (const [options, expectedDrive, expectedSheets] of [
    [{driveError: new Error('Google Drive 404: File not found')}, 'error', 'ok'],
    [{sheetsError: new Error('Google Sheets 404: Requested entity was not found')}, 'ok', 'error'],
    [{driveError: new Error('Google Drive 404: File not found'), sheetsError: new Error('Google Sheets 404: Requested entity was not found')}, 'error', 'error']
  ]) {
    await t.test(`${expectedDrive} / ${expectedSheets}`, () => {
      const f = fixture(options);
      const report = f.run();
      assert.equal(report.drive, expectedDrive);
      assert.equal(report.sheets, expectedSheets);
      assert.deepEqual(f.reads, ['scope', 'drive', 'sheets']);
      if (expectedDrive === 'error') assert.match(report.errors.drive, /404/);
      if (expectedSheets === 'error') assert.match(report.errors.sheets, /404/);
    });
  }
});

test('non-spreadsheet MIME, wrong IDs, revoked app access and trash flags stay visible', () => {
  const f = fixture({driveResult: {
    id: 'different-private-file-id', mimeType: 'application/pdf', isAppAuthorized: false,
    trashed: true, capabilities: {canEdit: false}
  }, sheetsResult: {spreadsheetId: 'different-private-file-id'}});
  const report = f.run();
  assert.equal(report.idMatched, false);
  assert.equal(report.mimeSheets, false);
  assert.equal(report.appAuthorized, false);
  assert.equal(report.trashed, true);
  assert.equal(report.canEdit, false);
  assert.equal(report.sheetsIdMatched, false);
  assert.ok(!JSON.stringify(report).includes('different-private-file-id'));
  assert.ok(!f.logs.join('\n').includes('different-private-file-id'));
});

test('missing or nonboolean Drive fields remain unknown rather than becoming false', async t => {
  for (const driveResult of [{}, {id: SHEET_ID, mimeType: 'application/vnd.google-apps.spreadsheet', isAppAuthorized: 'true', trashed: 0, capabilities: {canEdit: 'false'}}]) {
    await t.test(JSON.stringify(driveResult), () => {
      const report = fixture({driveResult, sheetsResult: {}}).run();
      assert.equal(report.appAuthorized, 'unknown');
      assert.equal(report.trashed, 'unknown');
      assert.equal(report.canEdit, 'unknown');
      assert.equal(report.sheetsIdMatched, 'unknown');
      if (!driveResult.id) assert.equal(report.idMatched, 'unknown');
      if (!driveResult.mimeType) assert.equal(report.mimeSheets, 'unknown');
    });
  }
});

test('optional Drive API absence does not prevent Sheets or request extra scopes', async t => {
  for (const drive of [undefined, {}, {Files: {}}]) {
    await t.test(JSON.stringify(drive) ?? 'missing', () => {
      const f = fixture({drive});
      const report = f.run();
      assert.equal(report.drive, 'unavailable');
      assert.equal(report.sheets, 'ok');
      assert.equal(report.appAuthorized, 'unknown');
      assert.deepEqual(f.reads, ['scope', 'sheets']);
    });
  }
});

test('missing Sheets service is identified after available scope and Drive checks', async t => {
  for (const sheets of [undefined, {}, {Spreadsheets: {}}]) {
    await t.test(JSON.stringify(sheets) ?? 'missing', () => {
      const f = fixture({sheets});
      const report = f.run();
      assert.equal(report.sheets, 'unavailable');
      assert.equal(report.drive, 'ok');
      assert.deepEqual(f.reads, ['scope', 'drive']);
    });
  }
});

test('bad configuration stops before scope and file reads', async t => {
  for (const changes of [
    {INVENTORY_ACCESS_MODEL: ''}, {INVENTORY_ACCESS_MODEL: 'different-model'},
    {INVENTORY_SHEET_ID: ''}, {INVENTORY_SHEET_ID: 'short'}, {INVENTORY_SHEET_ID: 'x'.repeat(201)},
    {INVENTORY_SHEET_ID: 'unacceptable/id'}, {INVENTORY_TOKEN: ''}, {INVENTORY_TOKEN: 'x'.repeat(513)},
    {INVENTORY_SHEET_URL: `${SHEET_URL}?secret=${TOKEN}`},
    {INVENTORY_SHEET_URL: 'https://docs.google.com/spreadsheets/d/different_sheet_id/edit'}
  ]) {
    await t.test(JSON.stringify(changes).slice(0, 80), () => {
      const f = fixture({properties: changes});
      const report = f.run();
      assert.equal(report.configuration, 'error');
      assert.equal(report.scope, 'notChecked');
      assert.equal(report.drive, 'notChecked');
      assert.equal(report.sheets, 'notChecked');
      assert.deepEqual(f.reads, []);
      assert.ok(!JSON.stringify(report).includes(TOKEN));
      assert.ok(!f.logs.join('\n').includes(TOKEN));
      assert.equal(f.logs.filter(line => /^RESULT ACCESS /.test(line)).length, 1);
    });
  }
});

test('errors retain useful status text while redacting credentials and file identity', () => {
  const email = 'rep@lab.example.edu';
  const opaque = 'opaque_value_abcdefghijklmnopqrstuvwxyz1234567890';
  const body = `Google 403: Insufficient authentication scopes. token=${TOKEN}; id=${SHEET_ID}; ${SHEET_URL}; ${email}; Bearer short.secret; ${opaque}`;
  const f = fixture({scopeError: new Error(body), driveError: new Error(body), sheetsError: new Error(body)});
  const report = f.run();
  for (const key of ['scope', 'drive', 'sheets']) assert.match(report.errors[key], /403.*Insufficient authentication scopes/);
  const exposed = JSON.stringify(report) + f.logs.join('\n');
  for (const secret of [TOKEN, SHEET_ID, SHEET_URL, email, opaque, 'short.secret']) assert.ok(!exposed.includes(secret), `Leaked ${secret}`);
});

test('exception text is bounded and exception objects are never dumped', () => {
  const error = {message: 'Transient failure\n' + 'x '.repeat(2000), secret: TOKEN, toString() { throw new Error('Do not stringify this exception'); }};
  const f = fixture({driveError: error, sheetsError: error});
  const report = f.run();
  for (const key of ['drive', 'sheets']) {
    assert.ok(report.errors[key].length <= 351);
    assert.ok(!report.errors[key].includes('\n'));
  }
  assert.ok(!JSON.stringify(report).includes(TOKEN));
  assert.ok(!f.logs.join('\n').includes(TOKEN));
});

test('explicit authorization helper requests only drive.file then runs read-only checks', () => {
  const f = fixture({allowAuthorization: true});
  const report = f.run(true);
  assert.equal(report.configuration, 'ok');
  assert.equal(report.sheets, 'ok');
  assert.deepEqual(f.reads, ['requireScopes', 'scope', 'drive', 'sheets']);
});

test('authorization prompt interruption stops the explicit helper before any checks or file reads', () => {
  const prompt = new Error('Authorization required');
  const f = fixture({allowAuthorization: true, authorizationError: prompt});
  const before = JSON.stringify(f.properties);
  assert.throws(() => f.run(true), error => error === prompt);
  assert.deepEqual(f.reads, ['requireScopes']);
  assert.deepEqual(f.deniedCalls, []);
  assert.equal(JSON.stringify(f.properties), before);
  assert.deepEqual(f.logs, []);
});

test('access helper coexists with connector and prior diagnostics without calling their operations', () => {
  const f = fixture();
  const connector = fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8');
  const diagnose = fs.readFileSync(path.join(__dirname, 'Diagnose.gs'), 'utf8');
  vm.runInContext(connector, f.context);
  vm.runInContext(diagnose, f.context);
  const report = f.run();
  assert.equal(report.sheets, 'ok');
  assert.deepEqual(f.reads, ['scope', 'drive', 'sheets']);
});

test('helper source contains no token retrieval, connector call, network fetch or file mutation', () => {
  assert.doesNotMatch(source, /\.(?:setPropert(?:y|ies)|deletePropert(?:y|ies)|deleteAllProperties|batchUpdate|append|create|update|delete|copy|fetch|fetchAll|getOAuthToken)\s*\(/);
  assert.doesNotMatch(source, /(?:initializeInventory|rotateConnectionToken|doPost)\s*\(/);
  assert.doesNotMatch(source, /https:\/\/www\.googleapis\.com\/auth\/(?:spreadsheets|drive)(?:["'])/);
});
