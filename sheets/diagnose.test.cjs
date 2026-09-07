const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'Diagnose.gs'), 'utf8');
const connectorSource = fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8');
const SHEET_ID = 'diagnostic_sheet_fixture_123456789';
const TOKEN = 'diagnostic_private_token_abcdefghijklmnopqrstuvwxyz_987654321';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;
const HEADERS = [
  'Record ID', 'Created at', 'Principal investigator', 'Room', 'Chemical name',
  'Amount per container', 'Unit', 'Physical state', 'Container count', 'CAS number',
  'CAS unavailable reason', 'Concentration', 'Supplier', 'Catalog number',
  'Expiry date', 'Notes', 'Label text', 'CAS source', 'Reviewed', 'Sync state', 'Synced at'
];

function fixture(options = {}) {
  const properties = {
    INVENTORY_ACCESS_MODEL: 'drive.file.v1', INVENTORY_SHEET_ID: SHEET_ID,
    INVENTORY_SHEET_URL: SHEET_URL, INVENTORY_TOKEN: TOKEN,
    ...options.properties
  };
  const reads = [];
  const logs = [];
  const mutationAttempts = [];
  const denied = name => () => { mutationAttempts.push(name); throw new Error(`Unexpected mutation: ${name}`); };
  const sheets = {
    Spreadsheets: {
      get(id, args) {
        reads.push('metadata');
        assert.equal(id, SHEET_ID);
        assert.equal(args.fields, 'spreadsheetId,properties(timeZone),sheets(properties)');
        if (options.metadataError) throw options.metadataError;
        return options.metadata || {spreadsheetId: id, sheets: [{properties: {title: 'Chemical inventory', sheetId: 0}}]};
      },
      Values: {
        get(id, range, args) {
          reads.push('headers');
          assert.equal(id, SHEET_ID);
          assert.equal(range, "'Chemical inventory'!1:1");
          assert.equal(args.valueRenderOption, 'UNFORMATTED_VALUE');
          assert.equal(args.dateTimeRenderOption, 'FORMATTED_STRING');
          if (options.headerError) throw options.headerError;
          return {values: [options.headers || HEADERS]};
        },
        append: denied('values.append'), update: denied('values.update'), clear: denied('values.clear')
      },
      create: denied('create'), batchUpdate: denied('batchUpdate')
    }
  };
  const context = vm.createContext({
    console: {log: message => logs.push(String(message))},
    PropertiesService: {getScriptProperties: () => ({
      getProperty: key => properties[key] ?? null,
      setProperty: denied('setProperty'), setProperties: denied('setProperties'), deleteProperty: denied('deleteProperty')
    })},
    Sheets: Object.hasOwn(options, 'sheets') ? options.sheets : sheets,
    UrlFetchApp: {fetch: denied('remote fetch')},
    doPost: options.noConnector ? undefined : event => {
      reads.push('local ping');
      assert.equal(event.postData.type, 'application/json');
      assert.deepEqual(JSON.parse(event.postData.contents), {action: 'ping', token: TOKEN});
      if (options.localError) throw options.localError;
      return {getContent: () => options.localText ?? JSON.stringify(options.localResponse ?? {ok: true, sheetUrl: SHEET_URL})};
    }
  });
  vm.runInContext(source, context);
  return {context, properties, reads, logs,
    run: () => {
      const result = context.diagnoseInventoryConnection();
      assert.deepEqual(mutationAttempts, [], 'A diagnostic must not attempt writes or remote requests');
      return result;
    }};
}

test('read-only checks succeed, match protocol, and do not claim deployed verification', () => {
  const f = fixture();
  const before = JSON.stringify(f.properties);
  const result = f.run();
  assert.equal(result.ok, true);
  assert.equal(result.code, 'EDITOR_OK');
  assert.deepEqual(f.reads, ['metadata', 'headers', 'local ping']);
  assert.equal(JSON.stringify(f.properties), before);
  assert.match(result.message, /does not verify the deployed/);
  assert.equal(f.logs.filter(line => / — PASS:/.test(line)).length, 5);
  assert.doesNotMatch(f.logs.join('\n'), new RegExp(TOKEN));
  assert.doesNotMatch(f.logs.join('\n'), new RegExp(SHEET_ID));
});

test('diagnostic headings stay aligned with the installed connector', () => {
  const context = vm.createContext({});
  vm.runInContext(connectorSource, context);
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(INVENTORY_HEADERS)', context)), HEADERS);
});

test('diagnostic integrates with the actual connector ping without any writes', () => {
  const f = fixture();
  f.context.Utilities = {newBlob: value => ({getBytes: () => [...Buffer.from(value, 'utf8')]})};
  f.context.ContentService = {
    MimeType: {JSON: 'application/json'},
    createTextOutput: content => ({setMimeType() { return this; }, getContent: () => content})
  };
  vm.runInContext(connectorSource, f.context);
  const before = JSON.stringify(f.properties);
  assert.equal(f.run().code, 'EDITOR_OK');
  assert.equal(JSON.stringify(f.properties), before);
  assert.deepEqual(f.reads, ['metadata', 'headers', 'metadata', 'headers']);
  assert.ok(!f.logs.join('').includes(TOKEN));
});

test('missing or inconsistent configuration stops before touching Sheets', async t => {
  for (const changes of [
    {INVENTORY_ACCESS_MODEL: ''}, {INVENTORY_TOKEN: ''}, {INVENTORY_SHEET_ID: ''},
    {INVENTORY_SHEET_URL: 'https://example.invalid/other'}
  ]) {
    await t.test(Object.keys(changes)[0], () => {
      const f = fixture({properties: changes});
      const result = f.run();
      assert.equal(result.code, 'D01_CONFIGURATION_ERROR');
      assert.deepEqual(f.reads, []);
    });
  }
});

test('missing service gives an actionable result without setting properties', async t => {
  for (const sheets of [undefined, {}, {Spreadsheets: {}}, {Spreadsheets: {get() {}, Values: {}}}]) {
    await t.test(JSON.stringify(sheets) || 'undefined', () => {
      const f = fixture({sheets});
      const before = JSON.stringify(f.properties);
      const result = f.run();
      assert.equal(result.code, 'D02_SERVICE_MISSING');
      assert.match(result.message, /Google Sheets API v4/);
      assert.equal(JSON.stringify(f.properties), before);
      assert.deepEqual(f.reads, []);
    });
  }
});

test('metadata authorization error retains its useful cause while redacting sensitive strings', () => {
  const email = 'someone@lab.example.edu';
  const opaque = 'opaque_refresh_value_123456789abcdefghijklmnopqrstuvwxyz';
  const error = new Error(`Google 403: Request had insufficient authentication scopes. token=${TOKEN}; spreadsheet=${SHEET_ID}; ${SHEET_URL}; user=${email}; Bearer short.secret; ${opaque}`);
  const f = fixture({metadataError: error});
  const result = f.run();
  assert.equal(result.code, 'D03_GOOGLE_OR_RUNTIME_ERROR');
  assert.match(result.message, /403.*insufficient authentication scopes/);
  const exposed = JSON.stringify(result) + f.logs.join('\n');
  for (const secret of [TOKEN, SHEET_ID, SHEET_URL, email, opaque, 'short.secret']) assert.ok(!exposed.includes(secret));
  assert.deepEqual(f.reads, ['metadata']);
});

test('header read errors identify the exact failing stage', () => {
  const f = fixture({headerError: new Error('Unable to parse range: https://example.invalid/private')});
  const result = f.run();
  assert.equal(result.code, 'D04_GOOGLE_OR_RUNTIME_ERROR');
  assert.match(result.message, /Unable to parse range/);
  assert.ok(!result.message.includes('example.invalid'));
  assert.deepEqual(f.reads, ['metadata', 'headers']);
});

test('changed headers and missing inventory tab are distinguished without revealing data', () => {
  const changed = fixture({headers: ['PRIVATE LAB HEADER', ...HEADERS.slice(1)]});
  assert.equal(changed.run().code, 'D04_HEADERS_CHANGED');
  assert.ok(!changed.logs.join('').includes('PRIVATE LAB HEADER'));
  assert.deepEqual(changed.reads, ['metadata', 'headers']);
  const missing = fixture({metadata: {spreadsheetId: SHEET_ID, sheets: []}});
  assert.equal(missing.run().code, 'D03_INVENTORY_TAB_MISSING');
});

test('local ping errors, malformed responses, and missing connector remain read-only', async t => {
  for (const [options, code] of [
    [{noConnector: true}, 'D05_CONNECTOR_CODE_MISSING'],
    [{localResponse: {ok: false, code: 'internal_error', error: `Google unavailable, ${TOKEN}`}}, 'D05_INTERNAL_ERROR'],
    [{localResponse: {ok: false, code: TOKEN, error: SHEET_ID}}, 'D05_PROTOCOL_ERROR'],
    [{localResponse: {ok: true, sheetUrl: 'https://example.invalid/different'}}, 'D05_PROTOCOL_ERROR'],
    [{localText: `<html>${TOKEN}</html>`}, 'D05_PROTOCOL_ERROR'],
    [{localError: new Error(`Unexpected ${TOKEN}`)}, 'D05_GOOGLE_OR_RUNTIME_ERROR']
  ]) {
    await t.test(code, () => {
      const f = fixture(options);
      const before = JSON.stringify(f.properties);
      const result = f.run();
      assert.equal(result.code, code);
      assert.equal(JSON.stringify(f.properties), before);
      assert.ok(!JSON.stringify(result).includes(TOKEN));
      assert.ok(!f.logs.join('').includes(TOKEN));
    });
  }
});

test('exception objects are never dumped and text remains bounded', () => {
  const f = fixture({metadataError: {message: 'Transient failure\n' + 'x '.repeat(1000), inventoryDiagnosticCode: TOKEN, secret: TOKEN, toString() { throw new Error('Do not serialize me'); }}});
  const result = f.run();
  assert.ok(result.message.length <= 701);
  assert.ok(!result.message.includes('\n'));
  assert.ok(!JSON.stringify(result).includes(TOKEN));
});

test('diagnostic source calls no remote fetch or mutation API', () => {
  assert.doesNotMatch(source, /\.(?:setPropert(?:y|ies)|deletePropert(?:y|ies)|batchUpdate|append|create|insertSheet|setValues|fetch)\s*\(/);
  assert.doesNotMatch(source, /(?:initializeInventory|rotateConnectionToken)\s*\(/);
});
