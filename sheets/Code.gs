/**
 * Per-lab Chemical Inventory connector. Install as a standalone Apps Script project.
 * See docs/GOOGLE_SHEETS_SETUP.md. No credentials belong in this source file.
 * The HTTP interface only checks readiness and appends reviewed records.
 */
const INVENTORY_TAB = 'Chemical inventory';
const INVENTORY_HEADERS = [
  'Record ID', 'Created at', 'Principal investigator', 'Room', 'Chemical name',
  'Amount per container', 'Unit', 'Physical state', 'Container count', 'CAS number',
  'CAS unavailable reason', 'Concentration', 'Supplier', 'Catalog number',
  'Expiry date', 'Notes', 'Label text', 'CAS source', 'Reviewed', 'Sync state', 'Synced at'
];
const RECORD_FIELDS = [
  'id', 'createdAt', 'pi', 'room', 'chemicalName', 'amount', 'unit', 'physicalState',
  'containerCount', 'cas', 'casUnavailableReason', 'concentration', 'supplier',
  'catalogNumber', 'expiryDate', 'notes', 'labelText', 'casSource', 'reviewed',
  'syncState', 'syncedAt'
];
const INVENTORY_UNITS = ['mg', 'g', 'kg', 'µL', 'mL', 'L', 'oz', 'lb', 'fl oz', 'gal', 'ft³', 'm³'];
const INVENTORY_STATES = ['Solid', 'Liquid', 'Gas'];
const MAX_REQUEST_BYTES = 65536;
// Exact human labels and machine keys in the official MIT EHSA template, A1:AA2.
// Source and code mappings are documented in docs/EHSA_EXPORT_MAPPING.md.
const EHSA_LABELS = ['PI CODE', 'PI Last Name', 'PI First Name', 'Bldg Code', 'LAB',
  'Location Type', 'In-Lab Location', 'Chemical Name', 'Physical State', '# of Containers',
  'Amount per Container', 'Unit of Measure', 'CAS #', 'Vendor', 'Catalog #', 'Receipt Date',
  'Expiration Date', 'Contact', 'Comments', 'Date Entered', 'BARCODE', 'Private/Share',
  'LAST_CHANGED', 'CONCENTRATION', 'CHEMICAL #', 'LOT #', 'SDS URL'];
const EHSA_KEYS = ['researcher', 'last_name', 'first_name', 'building', 'lab', 'storage_device',
  'storage_location', 'chemical_description', 'physical_state', 'receipt_quantity', 'unit',
  'chemical_unit', 'cas_num', 'vendor', 'catalog_number', 'receipt_date', 'expiration_date',
  'contact', 'comments', 'date_entered', 'ship_code', 'private_share', 'last_update',
  'concentration', 'chemical_number', 'lot_number', 'msds_url'];
const EHSA_UNIT_CODES = {
  'mg': ['mg', 'mg (L)', 'mg (G)'],
  'g': ['G', 'G (L)', 'G (G)'],
  'kg': ['KG', 'KG (L)', 'KG (G)'],
  'µL': ['µL (S)', 'µL', 'µL (G)'],
  'mL': ['mL (S)', 'mL', 'mL (G)'],
  'L': ['Liters (S)', 'Liters', 'Liters (G)'],
  'oz': ['Ounces', 'Ounces (L)', 'Ounces (G)'],
  'lb': ['LB (S)', 'LB (L)', 'LB'],
  'ft³': ['CU.FT.(S)', 'CU.FT.(L)', 'CU.FT.'],
  'fl oz': ['Fluid Ounces', 'Fluid Ounces', 'Fluid Ounces'],
  'gal': ['Gal', 'Gal', 'Gal']
};

const ACCESS_MODEL = 'drive.file.v1';
const EXPORT_SETTINGS_TAB = 'Export settings';
const EXPORT_REVIEW_TAB = 'Export review';
const EXPORT_REVIEW_HEADERS = ['Confirmed', 'Warning key', 'Record ID', 'Chemical name',
  'Reason / required confirmation', 'Fingerprint'];
const EXPORT_SETTINGS_ROWS = [
  ['EHSA export settings', 'Value'],
  ['PI Kerberos username (without @mit.edu)', ''],
  ['PI last name', ''],
  ['PI first name', ''],
  ['', ''],
  ['How to prepare a snapshot', 'Fill B2:B4, then run prepareEhsaImport in the script editor.'],
  ['Missing CAS or generic units', 'Read Export review, resolve issues, and individually confirm applicable warnings. Run prepareEhsaImport again.'],
  ['No CAS exists', 'Confirm only when no CAS exists for the substance. An unreadable or missing label is unresolved.'],
  ['Review before import', 'Each export is a new snapshot for EHS review. Nothing is submitted to MIT.'],
  ['Keep private', 'Never put connection tokens or Parley API keys in any spreadsheet tab.']
];

/** Run in this standalone script editor. Re-running preserves data and credentials. */
function initializeInventory() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('The connector is busy. Please try again.');
  let token = '';
  let sheetId = '';
  try {
    const properties = PropertiesService.getScriptProperties();
    const configuredId = properties.getProperty('INVENTORY_SHEET_ID');
    sheetId = configuredId || '';
    token = properties.getProperty('INVENTORY_TOKEN') || '';
    const pending = properties.getProperty('INVENTORY_CREATE_PENDING');
    const bootstrap = !!pending || (!configuredId && !properties.getProperty('INVENTORY_ACCESS_MODEL'));
    if (bootstrap) {
      if (!pending && ['INVENTORY_SHEET_ID', 'INVENTORY_SHEET_URL', 'INVENTORY_TOKEN',
        'INVENTORY_ACCESS_MODEL', 'INVENTORY_CREATE_PENDING', 'INVENTORY_EMPTY_RECOVERY'].some(function (key) {
          return properties.getProperty(key) !== null;
        })) {
        fail_('Some inventory setup properties remain, but the connection is incomplete. Preserve the properties and original worksheet; restore the existing setup before initializing. No replacement file was created.', 'configuration_error');
      }
      requireCreationServices_();
      let receipt;
      if (pending) {
        receipt = createdInventoryReceipt_(pending);
      } else {
        // A metadata-only Drive creation explicitly creates the native Sheet for this app.
        // Keep intent and the returned ID in a separate receipt before later setup writes.
        properties.setProperty('INVENTORY_CREATE_PENDING', JSON.stringify({version: 1, stage: 'creating', id: null}));
        const created = Drive.Files.create({name: 'Lab chemical inventory', mimeType: 'application/vnd.google-apps.spreadsheet'});
        if (!created || !validSheetId_(created.id)) fail_('Google did not return a valid new worksheet. Preserve INVENTORY_CREATE_PENDING and ask the maintainer to recover the creation; do not create another file.', 'configuration_error');
        sheetId = created.id;
        receipt = {version: 1, stage: 'created', id: sheetId};
        properties.setProperty('INVENTORY_CREATE_PENDING', JSON.stringify(receipt));
      }
      sheetId = receipt.id;
      const expected = {INVENTORY_SHEET_ID: sheetId, INVENTORY_SHEET_URL: sheetUrl_(sheetId), INVENTORY_ACCESS_MODEL: ACCESS_MODEL};
      Object.keys(expected).forEach(function (key) {
        const current = properties.getProperty(key);
        if (current && current !== expected[key]) fail_('The saved creation receipt and active configuration disagree. Preserve the properties and worksheet; initialization stopped without replacing the connection.', 'configuration_error');
      });
      token = properties.getProperty('INVENTORY_TOKEN') || createToken_();
      properties.setProperties({
        INVENTORY_ACCESS_MODEL: ACCESS_MODEL,
        INVENTORY_SHEET_ID: sheetId,
        INVENTORY_SHEET_URL: sheetUrl_(sheetId),
        INVENTORY_TOKEN: token
      });
      initializeCreatedInventory_(createdInventorySpreadsheet_(sheetId));
    }
    const source = configuredSpreadsheet_();
    assertHeaders_(source.spreadsheetId, INVENTORY_TAB, INVENTORY_HEADERS);
    const inventory = requireTab_(source, INVENTORY_TAB);
    const settings = requireTab_(source, EXPORT_SETTINGS_TAB);
    // Formatting is safe to resume after a successful creation followed by a network failure.
    Sheets.Spreadsheets.batchUpdate({requests: [
      columnWidth_(inventory.sheetId, 0, INVENTORY_HEADERS.length, 165),
      columnWidth_(inventory.sheetId, 4, 5, 260),
      columnWidth_(inventory.sheetId, 16, 17, 300),
      {updateDimensionProperties: {range: {sheetId: inventory.sheetId, dimension: 'COLUMNS',
        startIndex: 0, endIndex: 1}, properties: {hiddenByUser: true}, fields: 'hiddenByUser'}},
      columnWidth_(settings.sheetId, 0, 1, 300),
      columnWidth_(settings.sheetId, 1, 2, 650)
    ]}, source.spreadsheetId);
    if (bootstrap) properties.setProperty('INVENTORY_CREATE_PENDING', '');
  } catch (error) {
    throw new Error(safeAdminMessage_(error,
      'Initialization could not complete. Preserve the worksheet and Script properties. Detail: ' + setupErrorDetail_(error, token, sheetId)));
  } finally {
    lock.releaseLock();
  }
  showConnectionDetails();
}

function requireCreationServices_() {
  if (typeof Drive === 'undefined' || !Drive || !Drive.Files || typeof Drive.Files.create !== 'function' || typeof Drive.Files.get !== 'function') {
    fail_('Enable the Drive API v3 service with the identifier Drive before initialization. Keep drive.file as the only OAuth scope.', 'configuration_error');
  }
  if (typeof Sheets === 'undefined' || !Sheets || !Sheets.Spreadsheets || typeof Sheets.Spreadsheets.get !== 'function' ||
      typeof Sheets.Spreadsheets.batchUpdate !== 'function' || !Sheets.Spreadsheets.Values || typeof Sheets.Spreadsheets.Values.get !== 'function') {
    fail_('Enable the Google Sheets API v4 service with the identifier Sheets before initialization.', 'configuration_error');
  }
}

function createdInventoryReceipt_(raw) {
  let receipt;
  try { receipt = JSON.parse(raw); } catch (_) { receipt = null; }
  if (!receipt || receipt.version !== 1 || receipt.stage !== 'created' || !validSheetId_(receipt.id) ||
      Object.keys(receipt).sort().join(',') !== 'id,stage,version') {
    fail_('An earlier worksheet creation did not finish conclusively. Preserve INVENTORY_CREATE_PENDING and ask the maintainer to recover the existing file; initialization will not create a possible duplicate.', 'configuration_error');
  }
  return receipt;
}

function createdInventorySpreadsheet_(id) {
  const file = Drive.Files.get(id, {fields: 'id,mimeType,isAppAuthorized,trashed,capabilities(canEdit)', supportsAllDrives: true});
  if (!file || file.id !== id || file.mimeType !== 'application/vnd.google-apps.spreadsheet' ||
      file.isAppAuthorized !== true || file.trashed !== false || !file.capabilities || file.capabilities.canEdit !== true) {
    fail_('Google has not confirmed that this app can edit its newly created Sheet. Preserve the saved creation receipt and retry initialization later; no other file will be created.', 'configuration_error');
  }
  const spreadsheet = Sheets.Spreadsheets.get(id, {fields: 'spreadsheetId,properties(timeZone),sheets(properties)'});
  if (!spreadsheet || spreadsheet.spreadsheetId !== id || !Array.isArray(spreadsheet.sheets)) fail_('The newly created Sheet could not be verified. Preserve its saved creation receipt.', 'configuration_error');
  return spreadsheet;
}

/** Only a saved creation receipt can reach this bootstrap. Existing records are never reset. */
function initializeCreatedInventory_(spreadsheet) {
  const tabs = spreadsheet.sheets;
  const inventoryTabs = tabs.filter(function (tab) { return tab.properties && tab.properties.title === INVENTORY_TAB; });
  const settingsTabs = tabs.filter(function (tab) { return tab.properties && tab.properties.title === EXPORT_SETTINGS_TAB; });
  if (inventoryTabs.length === 1 && settingsTabs.length === 1) {
    assertHeaders_(spreadsheet.spreadsheetId, INVENTORY_TAB, INVENTORY_HEADERS);
    const settings = getValues_(spreadsheet.spreadsheetId, EXPORT_SETTINGS_TAB, 'A1:B4');
    if (EXPORT_SETTINGS_ROWS.slice(0, 4).some(function (row, i) { return !settings[i] || settings[i][0] !== row[0]; })) {
      fail_('The Export settings labels changed. Restore their original labels; initialization will preserve all cell values.', 'configuration_error');
    }
    return;
  }
  if (tabs.length > 1 || (tabs.length && !initialInventoryTabEmpty_(spreadsheet.spreadsheetId, tabs[0].properties))) {
    fail_('The newly created file has unexpected tabs, values, or formulas. Initialization will not overwrite them. Preserve the worksheet and creation receipt.', 'configuration_error');
  }
  const inventoryId = tabs.length ? tabs[0].properties.sheetId : 0;
  const settingsId = inventoryId === 0 ? 1 : 0;
  const inventory = sheetDefinition_(INVENTORY_TAB, [INVENTORY_HEADERS], 1, INVENTORY_HEADERS.length).properties;
  inventory.sheetId = inventoryId;
  const settings = sheetDefinition_(EXPORT_SETTINGS_TAB, EXPORT_SETTINGS_ROWS, 1, 2).properties;
  settings.sheetId = settingsId;
  Sheets.Spreadsheets.batchUpdate({requests: [
    {updateSpreadsheetProperties: {properties: {timeZone: 'America/New_York'}, fields: 'timeZone'}},
    tabs.length ? {updateSheetProperties: {properties: inventory, fields: 'title,gridProperties'}} : {addSheet: {properties: inventory}},
    {addSheet: {properties: settings}},
    {updateCells: {start: {sheetId: inventoryId, rowIndex: 0, columnIndex: 0}, rows: typedRows_([INVENTORY_HEADERS]), fields: 'userEnteredValue'}},
    {updateCells: {start: {sheetId: settingsId, rowIndex: 0, columnIndex: 0}, rows: typedRows_(EXPORT_SETTINGS_ROWS), fields: 'userEnteredValue'}},
    headerFormat_(inventoryId, 1, INVENTORY_HEADERS.length), headerFormat_(settingsId, 1, 2)
  ]}, spreadsheet.spreadsheetId);
}

function initialInventoryTabEmpty_(id, tab) {
  if (!tab || (tab.sheetType && tab.sheetType !== 'GRID') || !Number.isInteger(tab.sheetId) ||
      typeof tab.title !== 'string' || !tab.gridProperties || !Number.isInteger(tab.gridProperties.rowCount) || tab.gridProperties.rowCount < 1) return false;
  const response = Sheets.Spreadsheets.Values.get(id, "'" + tab.title.replace(/'/g, "''") + "'!1:" + tab.gridProperties.rowCount,
    {valueRenderOption: 'FORMULA', dateTimeRenderOption: 'FORMATTED_STRING'});
  return !!response && (response.values === undefined || (Array.isArray(response.values) && response.values.every(function (row) {
    return Array.isArray(row) && row.every(function (value) { return value === '' || value === null; });
  })));
}

function setupErrorDetail_(error, token, sheetId) {
  let message = error && typeof error.message === 'string' ? error.message : 'Google did not return a readable error message.';
  [token, sheetId].forEach(function (secret) { if (secret) message = message.split(secret).join('[redacted]'); });
  message = message.replace(/Bearer\s+[^\s,;"'<>]+/gi, 'Bearer [redacted]')
    .replace(/https?:\/\/[^\s<>"']+/gi, '[URL redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email redacted]')
    .replace(/[A-Za-z0-9_=-]{32,}/g, '[opaque value redacted]')
    .replace(/[\u0000-\u001F\u007F]/g, ' ');
  return message.length > 350 ? message.slice(0, 350) + '…' : message;
}

/** The token is available only in Project Settings > Script properties. */
function showConnectionDetails() {
  try {
    const source = configuredSpreadsheet_();
    console.log('Lab worksheet: ' + sheetUrl_(source.spreadsheetId));
    console.log('Copy INVENTORY_TOKEN from Project Settings > Script properties into the app. Never put it in the spreadsheet.');
    console.log('Find the deployment URL under Deploy > Manage deployments. Use the web app URL ending in /exec.');
  } catch (error) {
    throw new Error(safeAdminMessage_(error, 'Initialize the lab worksheet before viewing setup details.'));
  }
}

/** Running this function intentionally invalidates the token on all lab phones. */
function rotateConnectionToken() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('The connector is busy. Please try again.');
  try {
    // Revocation must work even when Google Sheets or its file grant is unavailable.
    configuredSheetId_();
    PropertiesService.getScriptProperties().setProperty('INVENTORY_TOKEN', createToken_());
  } catch (error) {
    throw new Error(safeAdminMessage_(error, 'The token could not be replaced. Check the script configuration and try again.'));
  } finally {
    lock.releaseLock();
  }
  console.log('The token was replaced. Copy INVENTORY_TOKEN from Project Settings > Script properties to every lab phone.');
}

function doGet() {
  return json_({ok: false, code: 'validation_error', error: 'Use the app to test this connection. Requests must use POST.'});
}

function doPost(event) {
  let lock;
  let locked = false;
  try {
    const payload = parseRequest_(event);
    const properties = PropertiesService.getScriptProperties();
    const expectedToken = properties.getProperty('INVENTORY_TOKEN');
    if (!expectedToken || !constantTimeEqual_(payload.token, expectedToken)) {
      fail_('Connection token is invalid. Check your lab connection settings.', 'unauthorized');
    }
    const record = payload.action === 'append' ? validateRecord_(payload.record) : null;
    if (record) {
      lock = LockService.getScriptLock();
      locked = lock.tryLock(10000);
      if (!locked) fail_('The worksheet is busy. Please retry; your record will not be duplicated.', 'busy');
      if (!constantTimeEqual_(payload.token, properties.getProperty('INVENTORY_TOKEN') || '')) {
        fail_('Connection token is invalid. Check your lab connection settings.', 'unauthorized');
      }
    }
    const source = configuredSpreadsheet_();
    const inventory = requireTab_(source, INVENTORY_TAB);
    assertHeaders_(source.spreadsheetId, INVENTORY_TAB, INVENTORY_HEADERS);
    if (!record) return json_({ok: true, sheetUrl: sheetUrl_(source.spreadsheetId)});
    const ids = getValues_(source.spreadsheetId, INVENTORY_TAB, 'A2:A');
    const matches = [];
    ids.forEach(function (row, index) {
      if (row[0] != null && String(row[0]).trim() === record.id) matches.push(index + 2);
    });
    if (matches.length) {
      const existing = matches.length === 1 ? getValues_(source.spreadsheetId, INVENTORY_TAB,
        'A' + matches[0] + ':U' + matches[0])[0] : null;
      if (!existing || !sameStoredRecord_(existing, record)) {
        fail_('This record ID already belongs to different or inconsistent worksheet data. Ask the lab administrator to reconcile it; no row was changed.', 'id_conflict');
      }
    } else {
      const row = RECORD_FIELDS.map(function (field) {
        if (field === 'syncState') return 'synced';
        if (field === 'syncedAt') return new Date().toISOString();
        if (field === 'reviewed') return true;
        if (field === 'amount' || field === 'containerCount') return Number(record[field]);
        return record[field];
      });
      Sheets.Spreadsheets.batchUpdate({requests: [{appendCells: {
        sheetId: inventory.sheetId, rows: typedRows_([row]), fields: 'userEnteredValue'
      }}]}, source.spreadsheetId);
    }
    return json_({ok: true, sheetUrl: sheetUrl_(source.spreadsheetId), recordId: record.id});
  } catch (error) {
    return json_({ok: false, code: error && error.inventoryErrorCode || 'internal_error',
      error: error && error.inventorySafeMessage ||
      'The worksheet could not be reached. Ask your lab administrator to check the deployment, then retry.'});
  } finally {
    if (locked) lock.releaseLock();
  }
}

/** A retry confirms the same reviewed data; it must not acknowledge different content. */
function sameStoredRecord_(values, record) {
  try {
    const input = {};
    RECORD_FIELDS.forEach(function (field, index) {
      const value = values[index];
      input[field] = field === 'syncState' || field === 'syncedAt' ? '' :
        field === 'reviewed' ? value : value == null ? '' : String(value);
    });
    const stored = validateRecord_(input);
    return RECORD_FIELDS.every(function (field) {
      if (field === 'syncState' || field === 'syncedAt') return true;
      return field === 'amount' || field === 'containerCount' ?
        Number(stored[field]) === Number(record[field]) : stored[field] === record[field];
    });
  } catch (_) {
    return false;
  }
}

/** Owner-run export. Checkbox review occurs in the sheet, with no script dialogs. */
function prepareEhsaImport() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('The worksheet is busy. Please try again.');
  try {
    const preview = readExportSource_();
    const candidate = buildEhsaRows_(preview.values, preview.metadata, preview.timeZone);
    const warnings = exportWarnings_(candidate);
    const review = writeExportReview_(preview.spreadsheet, warnings, candidate.issues);
    if (candidate.issues.length) {
      console.log('No export was created. Resolve all inventory issues listed in Export review, then run prepareEhsaImport again.');
      return;
    }
    if (!candidate.rows.length) {
      console.log('No export was created because there are no reviewed inventory rows.');
      return;
    }
    if (!review.allConfirmed) {
      console.log('No export was created. Read Export review and confirm each applicable warning individually, then run prepareEhsaImport again.');
      return;
    }
    // The script lock serializes app writes; this second read also detects ordinary Sheet edits.
    const current = readExportSource_();
    if (preview.sheetId !== current.sheetId || JSON.stringify(preview.values) !== JSON.stringify(current.values) ||
        JSON.stringify(preview.metadata) !== JSON.stringify(current.metadata)) {
      fail_('The inventory or PI settings changed during preparation. No export was created. Run prepareEhsaImport again.');
    }
    if (!reviewStillConfirmed_(current.sheetId, warnings)) {
      fail_('Export confirmations changed during preparation. No export was created. Check Export review and run again.');
    }
    const name = uniqueExportName_(current.spreadsheet, new Date());
    const outputId = nextSheetId_(current.spreadsheet);
    const allRows = [EHSA_LABELS, EHSA_KEYS].concat(candidate.rows);
    // A single atomic batch creates and fills a fresh snapshot; prior tabs are untouched.
    Sheets.Spreadsheets.batchUpdate({requests: [
      {addSheet: {properties: {sheetId: outputId, title: name,
        gridProperties: {rowCount: Math.max(100, allRows.length), columnCount: EHSA_KEYS.length, frozenRowCount: 2}}}},
      {appendCells: {sheetId: outputId, rows: typedRows_(allRows), fields: 'userEnteredValue'}},
      headerFormat_(outputId, 2, EHSA_KEYS.length),
      columnWidth_(outputId, 0, EHSA_KEYS.length, 145),
      columnWidth_(outputId, 7, 8, 250),
      columnWidth_(outputId, 18, 19, 350)
    ]}, current.sheetId);
    console.log('Created a new EHSA review snapshot with ' + candidate.rows.length +
      ' record(s). Check the newest EHSA export tab. Nothing has been submitted to MIT.');
  } catch (error) {
    throw new Error(safeAdminMessage_(error,
      'The snapshot could not be prepared. Check the worksheet setup and permissions, then try again.'));
  } finally {
    lock.releaseLock();
  }
}

/** Local configuration only: safe to use for revocation during a Google outage. */
function configuredSheetId_() {
  const properties = PropertiesService.getScriptProperties();
  const id = properties.getProperty('INVENTORY_SHEET_ID');
  if (properties.getProperty('INVENTORY_ACCESS_MODEL') !== ACCESS_MODEL) {
    fail_('This connector needs a new worksheet created by initializeInventory. For an older connector, create a fresh standalone script; keep the original worksheet and migrate its rows manually.', 'configuration_error');
  }
  if (!validSheetId_(id) || !properties.getProperty('INVENTORY_TOKEN') ||
      properties.getProperty('INVENTORY_SHEET_URL') !== sheetUrl_(id)) {
    fail_('The lab administrator must initialize the worksheet first. Restore the original script properties if they were changed.', 'configuration_error');
  }
  return id;
}

function configuredSpreadsheet_() {
  const id = configuredSheetId_();
  const spreadsheet = Sheets.Spreadsheets.get(id, {fields: 'spreadsheetId,properties(timeZone),sheets(properties)'});
  if (!spreadsheet || spreadsheet.spreadsheetId !== id) fail_('The configured worksheet could not be verified.', 'configuration_error');
  return spreadsheet;
}

function requireTab_(spreadsheet, title) {
  const sheet = (spreadsheet.sheets || []).filter(function (entry) { return entry.properties.title === title; })[0];
  if (!sheet) fail_('A required worksheet tab is missing. Restore the original Chemical inventory and Export settings tabs.', 'configuration_error');
  return sheet.properties;
}

function readExportSource_() {
  const spreadsheet = configuredSpreadsheet_();
  requireTab_(spreadsheet, INVENTORY_TAB);
  requireTab_(spreadsheet, EXPORT_SETTINGS_TAB);
  assertHeaders_(spreadsheet.spreadsheetId, INVENTORY_TAB, INVENTORY_HEADERS);
  const settings = getValues_(spreadsheet.spreadsheetId, EXPORT_SETTINGS_TAB, 'A1:B4');
  for (let i = 0; i < 4; i++) {
    if (!settings[i] || settings[i][0] !== EXPORT_SETTINGS_ROWS[i][0]) {
      fail_('The Export settings labels changed. Restore the original labels and enter PI details in B2:B4.', 'configuration_error');
    }
  }
  const metadata = validateEhsaMetadata_({kerberos: settings[1][1], lastName: settings[2][1], firstName: settings[3][1]});
  return {spreadsheet: spreadsheet, sheetId: spreadsheet.spreadsheetId,
    timeZone: spreadsheet.properties && spreadsheet.properties.timeZone || 'America/New_York', metadata: metadata,
    values: getValues_(spreadsheet.spreadsheetId, INVENTORY_TAB, 'A2:U')};
}

function validateEhsaMetadata_(input) {
  const metadata = {};
  ['kerberos', 'lastName', 'firstName'].forEach(function (field) {
    const value = typeof input[field] === 'string' ? input[field].trim() : '';
    if (!value || value.length > 128 || /[\u0000-\u001F\u007F]/.test(value) ||
        (field === 'kerberos' && !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value))) {
      fail_('Enter valid PI Kerberos, last name, and first name in Export settings B2:B4. No export was created.');
    }
    metadata[field] = field === 'kerberos' ? value.toLowerCase() : value;
  });
  return metadata;
}

function exportWarnings_(candidate) {
  return candidate.missingCas.map(function (entry) {
    return {key: 'no_cas:' + entry.id, id: entry.id, name: entry.name, fingerprint: entry.fingerprint,
      reason: 'Confirm only that no CAS exists for this substance. An unreadable or missing label is unresolved and must not be confirmed. Recorded reason: ' + entry.reason +
        '. CAS-free records require EHS review and cannot be matched by CAS to annual reporting lists.'};
  }).concat(candidate.unitWarnings.map(function (entry) {
    return {key: 'generic_unit:' + entry.id, id: entry.id, name: entry.name, fingerprint: entry.fingerprint,
      reason: 'Review generic EHSA unit mapping ' + entry.unit + ' / ' + entry.state + ' → ' + entry.code +
        '. Confirm this review snapshot may include the generic code; check acceptance for this physical state with EHS before importing.'};
  }));
}

function confirmedWarnings_(rows) {
  const confirmations = Object.create(null);
  rows.forEach(function (row) {
    if (row[0] === true && typeof row[1] === 'string') {
      const key = row[1];
      if (!confirmations[key]) confirmations[key] = [];
      confirmations[key].push({id: row[2], name: row[3], reason: row[4], fingerprint: row[5]});
    }
  });
  return confirmations;
}

function warningConfirmed_(warning, confirmations) {
  const matches = confirmations[warning.key] || [];
  return matches.length === 1 && matches[0].id === warning.id && matches[0].name === warning.name &&
    matches[0].reason === warning.reason && matches[0].fingerprint === warning.fingerprint;
}

function writeExportReview_(spreadsheet, warnings, issues) {
  const existing = (spreadsheet.sheets || []).filter(function (sheet) {
    return sheet.properties.title === EXPORT_REVIEW_TAB;
  })[0];
  let existingRows = [];
  if (existing) {
    const header = getValues_(spreadsheet.spreadsheetId, EXPORT_REVIEW_TAB, 'A1:F1')[0] || [];
    if (EXPORT_REVIEW_HEADERS.every(function (value, i) { return header[i] === value; })) {
      existingRows = getValues_(spreadsheet.spreadsheetId, EXPORT_REVIEW_TAB, 'A2:F');
    }
  }
  const confirmations = confirmedWarnings_(existingRows);
  const rows = warnings.map(function (warning) {
    return [warningConfirmed_(warning, confirmations), warning.key, warning.id, warning.name, warning.reason, warning.fingerprint];
  });
  const instructions = [
    ['Export review instructions', ''],
    ['1. Resolve all issues', 'Every nonempty inventory record must pass validation. No records are silently dropped.'],
    ['2. Check each warning', 'Tick only the Confirmed checkbox for that exact record after reading its reason.'],
    ['No CAS exists', 'Do not confirm an unreadable, missing, or unresolved CAS. Confirm only after establishing that no CAS exists for the substance.'],
    ['Generic unit codes', 'Confirmation creates a review snapshot; EHS must still check live importer acceptance.'],
    ['Changes reset confirmation', 'Record identity, PI settings, or relevant inventory changes invalidate prior confirmations.'],
    ['3. Run prepareEhsaImport again', 'A new snapshot appears only after every record is valid and every warning is confirmed.'],
    ['Never edit warning details', 'They are rebuilt from the inventory. Only the Confirmed checkboxes are for your edits.'],
    ['Inventory issues', issues.length ? issues.length + ' issue(s) to resolve' : 'None']
  ].concat(issues.map(function (issue) { return ['Resolve in Chemical inventory', issue]; }));
  const sheetId = existing ? existing.properties.sheetId : nextSheetId_(spreadsheet);
  const rowCount = Math.max(100, rows.length + 1, instructions.length);
  const requests = [];
  if (!existing) {
    requests.push({addSheet: {properties: {sheetId: sheetId, title: EXPORT_REVIEW_TAB,
      gridProperties: {rowCount: rowCount, columnCount: 9, frozenRowCount: 1}}}});
  } else {
    requests.push({updateSheetProperties: {properties: {sheetId: sheetId,
      gridProperties: {rowCount: Math.max(rowCount, existing.properties.gridProperties.rowCount),
        columnCount: Math.max(9, existing.properties.gridProperties.columnCount), frozenRowCount: 1}},
      fields: 'gridProperties.rowCount,gridProperties.columnCount,gridProperties.frozenRowCount'}});
  }
  // Explicit bounded ranges clear stale warnings and validation from older runs.
  const clearRows = existing ? Math.max(rowCount, existing.properties.gridProperties.rowCount) : rowCount;
  requests.push({updateCells: {range: {sheetId: sheetId, startRowIndex: 0, endRowIndex: clearRows,
    startColumnIndex: 0, endColumnIndex: 6}, rows: typedRows_([EXPORT_REVIEW_HEADERS].concat(rows)),
    fields: 'userEnteredValue,dataValidation'}});
  requests.push({updateCells: {range: {sheetId: sheetId, startRowIndex: 0, endRowIndex: clearRows,
    startColumnIndex: 7, endColumnIndex: 9}, rows: typedRows_(instructions), fields: 'userEnteredValue'}});
  if (rows.length) requests.push({repeatCell: {range: {sheetId: sheetId, startRowIndex: 1,
    endRowIndex: rows.length + 1, startColumnIndex: 0, endColumnIndex: 1},
    cell: {dataValidation: {condition: {type: 'BOOLEAN'}, strict: true, showCustomUi: true}}, fields: 'dataValidation'}});
  requests.push(headerFormat_(sheetId, 1, 9), columnWidth_(sheetId, 0, 1, 110),
    columnWidth_(sheetId, 1, 4, 190), columnWidth_(sheetId, 4, 5, 650),
    columnWidth_(sheetId, 5, 6, 180), columnWidth_(sheetId, 7, 8, 260), columnWidth_(sheetId, 8, 9, 650));
  requests.push({repeatCell: {range: {sheetId: sheetId}, cell: {userEnteredFormat: {wrapStrategy: 'WRAP'}},
    fields: 'userEnteredFormat.wrapStrategy'}});
  Sheets.Spreadsheets.batchUpdate({requests: requests}, spreadsheet.spreadsheetId);
  return {allConfirmed: rows.every(function (row) { return row[0] === true; })};
}

function reviewStillConfirmed_(spreadsheetId, warnings) {
  if (!warnings.length) return true;
  const confirmations = confirmedWarnings_(getValues_(spreadsheetId, EXPORT_REVIEW_TAB, 'A2:F'));
  return warnings.every(function (warning) { return warningConfirmed_(warning, confirmations); });
}

function recordFingerprint_(record, metadata) {
  const normalized = JSON.stringify([metadata.kerberos, metadata.lastName, metadata.firstName,
    RECORD_FIELDS.map(function (field) { return record[field]; })]);
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, normalized, Utilities.Charset.UTF_8);
  return 'sha256:' + bytes.map(function (value) {
    return ('0' + ((value + 256) % 256).toString(16)).slice(-2);
  }).join('');
}

function getValues_(spreadsheetId, title, range) {
  const result = Sheets.Spreadsheets.Values.get(spreadsheetId, "'" + title.replace(/'/g, "''") + "'!" + range,
    {valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING'});
  return result.values || [];
}

function assertHeaders_(spreadsheetId, title, expected) {
  const values = getValues_(spreadsheetId, title, '1:1')[0] || [];
  if (values.length !== expected.length || expected.some(function (header, i) { return values[i] !== header; })) {
    fail_('The inventory column headers have changed. Ask your lab administrator to restore the original columns.', 'configuration_error');
  }
}

function typedRows_(rows) {
  return rows.map(function (row) {
    return {values: row.map(function (value) {
      if (typeof value === 'boolean') return {userEnteredValue: {boolValue: value}};
      if (typeof value === 'number' && Number.isFinite(value)) return {userEnteredValue: {numberValue: value}};
      // Explicit stringValue keeps OCR and user text literal, even when it starts with '='.
      return {userEnteredValue: {stringValue: value == null ? '' : String(value)}};
    })};
  });
}

function sheetDefinition_(title, rows, frozenRows, columns) {
  const data = typedRows_(rows);
  for (let i = 0; i < frozenRows; i++) {
    data[i].values.forEach(function (cell) { cell.userEnteredFormat = headingStyle_(); });
  }
  return {properties: {title: title, gridProperties: {rowCount: Math.max(1000, rows.length),
    columnCount: Math.max(columns, 9), frozenRowCount: frozenRows}},
    data: [{startRow: 0, startColumn: 0, rowData: data}]};
}

function headingStyle_() {
  return {backgroundColor: {red: 0.043, green: 0.278, blue: 0.333},
    textFormat: {bold: true, foregroundColor: {red: 1, green: 1, blue: 1}}, wrapStrategy: 'WRAP'};
}
function headerFormat_(sheetId, rows, columns) {
  return {repeatCell: {range: {sheetId: sheetId, startRowIndex: 0, endRowIndex: rows,
    startColumnIndex: 0, endColumnIndex: columns}, cell: {userEnteredFormat: headingStyle_()}, fields: 'userEnteredFormat'}};
}
function columnWidth_(sheetId, start, end, width) {
  return {updateDimensionProperties: {range: {sheetId: sheetId, dimension: 'COLUMNS', startIndex: start, endIndex: end},
    properties: {pixelSize: width}, fields: 'pixelSize'}};
}
function nextSheetId_(spreadsheet) {
  const ids = (spreadsheet.sheets || []).map(function (sheet) { return sheet.properties.sheetId; });
  let id = 1;
  while (ids.indexOf(id) !== -1) id++;
  return id;
}
function uniqueExportName_(spreadsheet, timestamp) {
  const base = 'EHSA export ' + timestamp.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', ' ');
  const titles = (spreadsheet.sheets || []).map(function (sheet) { return sheet.properties.title; });
  let name = base;
  let number = 2;
  while (titles.indexOf(name) !== -1) name = base + ' (' + number++ + ')';
  return name;
}
function validSheetId_(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(value); }
function safeAdminMessage_(error, fallback) { return error && error.inventorySafeMessage || fallback; }
function textCell_(value) { return value; } // All writes use typedRows_; text remains unchanged.
function buildEhsaRows_(values, metadata, timeZone) {
  const rows = [];
  const issues = [];
  const missingCas = [];
  const unitWarnings = [];
  const seenIds = Object.create(null);
  const piNames = Object.create(null);
  values.forEach(function (valuesRow, index) {
    const sheetRow = index + 2;
    if (valuesRow.every(function (value) { return value === '' || value == null; })) return;
    try {
      const input = {};
      RECORD_FIELDS.forEach(function (field, column) {
        const cell = valuesRow[column];
        if (field === 'reviewed') input[field] = cell;
        else if (cell instanceof Date) {
          input[field] = field === 'expiryDate' ? Utilities.formatDate(cell, timeZone, 'yyyy-MM-dd') : cell.toISOString();
        } else input[field] = cell == null ? '' : String(cell);
      });
      const record = validateRecord_(input);
      if (seenIds[record.id]) fail_('Record ID is duplicated; preserve one ID per reviewed inventory row.');
      seenIds[record.id] = true;
      piNames[record.pi.toLowerCase()] = true;
      const dash = record.room.indexOf('-');
      const building = dash > 0 ? record.room.slice(0, dash).trim() : '';
      if (!/^[A-Za-z0-9]+$/.test(building) || !record.room.slice(dash + 1).trim()) {
        fail_('Room must include an MIT building-room value, for example 66-347.');
      }
      if (!record.cas) {
        missingCas.push({id: record.id, row: sheetRow, name: record.chemicalName,
          reason: record.casUnavailableReason, fingerprint: recordFingerprint_(record, metadata)});
      }
      const unitCode = ehsaUnitCode_(record.unit, record.physicalState);
      if (!unitCode) fail_('No verified EHSA unit code for ' + record.unit + ' / ' + record.physicalState +
        '. Review the quantity/unit with EHS before exporting; the app does not guess a conversion.');
      if (record.unit === 'fl oz' || record.unit === 'gal') {
        unitWarnings.push({id: record.id, row: sheetRow, name: record.chemicalName, unit: record.unit,
          state: record.physicalState, code: unitCode, fingerprint: recordFingerprint_(record, metadata)});
      }
      const comments = [record.notes, record.supplier ? 'Supplier: ' + record.supplier : '',
        record.casUnavailableReason ? 'CAS note: ' + record.casUnavailableReason : '',
        !record.cas ? 'Exporter explicitly confirmed that no CAS exists; EHS review required.' : '',
        record.unit === 'fl oz' || record.unit === 'gal' ? 'Generic EHSA unit code ' + unitCode +
          '; confirm live importer acceptance for ' + record.physicalState + ' with EHS.' : '',
        'Inventory Record ID: ' + record.id].filter(function (value) { return !!value; }).join('\n');
      const row = [metadata.kerberos, metadata.lastName, metadata.firstName, building, record.room,
        '', '', record.chemicalName, record.physicalState, Number(record.containerCount), Number(record.amount),
        unitCode, record.cas, '', record.catalogNumber, '', ehsaDate_(record.expiryDate), '', comments,
        ehsaDate_(record.createdAt.slice(0, 10)), '', '', '', record.concentration, '', '', ''];
      rows.push(row.map(function (value) { return typeof value === 'string' ? textCell_(value) : value; }));
    } catch (error) {
      issues.push('Row ' + sheetRow + ': ' + (error && error.inventorySafeMessage || 'The row could not be validated.'));
    }
  });
  if (Object.keys(piNames).length > 1) {
    issues.push('Multiple PI values appear in the working inventory. Review and separate them before applying one PI CODE to this snapshot.');
  }
  return {rows: rows, issues: issues, missingCas: missingCas, unitWarnings: unitWarnings};
}

function ehsaUnitCode_(unit, physicalState) {
  const stateIndex = INVENTORY_STATES.indexOf(physicalState);
  return stateIndex >= 0 && Object.prototype.hasOwnProperty.call(EHSA_UNIT_CODES, unit) ?
    EHSA_UNIT_CODES[unit][stateIndex] : null;
}

function ehsaDate_(date) { return date ? date.slice(5, 7) + '/' + date.slice(8, 10) + '/' + date.slice(0, 4) : ''; }

function parseRequest_(event) {
  if (!event || !event.postData || typeof event.postData.contents !== 'string') {
    fail_('A JSON request body is required.');
  }
  const body = event.postData.contents;
  if (!body || body.length > MAX_REQUEST_BYTES ||
      Utilities.newBlob(body).getBytes().length > MAX_REQUEST_BYTES) fail_('The request is too large.');
  const mimeType = String(event.postData.type || '').split(';')[0].trim().toLowerCase();
  if (mimeType !== 'application/json') fail_('Use an application/json request.');
  let payload;
  try { payload = JSON.parse(body); } catch (_) { fail_('The request is not valid JSON.'); }
  if (!isObject_(payload) || (payload.action !== 'ping' && payload.action !== 'append')) {
    fail_('Unknown connector action.');
  }
  const allowed = payload.action === 'ping' ? ['action', 'token'] : ['action', 'token', 'record'];
  if (Object.keys(payload).some(function (key) { return allowed.indexOf(key) === -1; })) {
    fail_('Unknown request field. Update the app and connector together.');
  }
  if (typeof payload.token !== 'string' || payload.token.length > 512) fail_('A connection token is required.', 'unauthorized');
  return payload;
}

function validateRecord_(input) {
  if (!isObject_(input) || Object.keys(input).some(function (key) { return RECORD_FIELDS.indexOf(key) === -1; })) {
    fail_('Invalid record fields. Update the app and connector together.');
  }
  const record = {};
  RECORD_FIELDS.forEach(function (field) {
    if (field === 'reviewed') return;
    const value = input[field] == null ? '' : input[field];
    const maxLength = field === 'labelText' ? 16000 : field === 'notes' ? 4000 : 512;
    if (typeof value !== 'string' || value.length > maxLength || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) {
      fail_('A record field is invalid or too long. Review the record in the app.');
    }
    record[field] = value.trim();
  });
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(record.id)) fail_('The record needs a stable ID.');
  if (!isIsoTimestamp_(record.createdAt)) fail_('The record creation date is invalid.');
  if (!record.pi || !record.room || !record.chemicalName) fail_('PI, room, and chemical name are required.');
  if (!/^[A-Za-z0-9]+-[A-Za-z0-9-]+$/.test(record.room)) {
    fail_('Room must use MIT building-room format, for example 66-347.');
  }
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(record.amount) ||
      !Number.isFinite(Number(record.amount)) || Number(record.amount) <= 0) {
    fail_('Amount per container must be a positive number.');
  }
  if (!/^\d+$/.test(record.containerCount) || !Number.isSafeInteger(Number(record.containerCount)) ||
      Number(record.containerCount) < 1 || Number(record.containerCount) > 1000000) {
    fail_('Container count must be a whole number from 1 to 1000000.');
  }
  if (INVENTORY_UNITS.indexOf(record.unit) === -1) fail_('Choose a supported amount unit.');
  if (INVENTORY_STATES.indexOf(record.physicalState) === -1) fail_('Choose Solid, Liquid, or Gas.');
  if (record.cas && !validCas_(record.cas)) fail_('The CAS number format or checksum is invalid.');
  if (!record.cas && !record.casUnavailableReason) fail_('Provide a CAS number or explain why it is unavailable.');
  if (record.expiryDate && !isCalendarDate_(record.expiryDate)) fail_('Expiry date must use YYYY-MM-DD.');
  if (input.reviewed !== true) fail_('Review and confirm the record before syncing.');
  record.reviewed = true;
  return record;
}

function validCas_(cas) {
  if (!/^\d{2,7}-\d{2}-\d$/.test(cas)) return false;
  const digits = cas.replace(/-/g, '');
  let sum = 0;
  for (let i = digits.length - 2, weight = 1; i >= 0; i--, weight++) sum += Number(digits[i]) * weight;
  return sum % 10 === Number(digits[digits.length - 1]);
}

function isCalendarDate_(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isIsoTimestamp_(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    isCalendarDate_(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}

function createToken_() {
  // getUuid is backed by java.util.UUID.randomUUID: 4 × 122 random bits, over 256 bits.
  return [Utilities.getUuid(), Utilities.getUuid(), Utilities.getUuid(), Utilities.getUuid()]
    .join('').replace(/-/g, '');
}

function constantTimeEqual_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let difference = a.length ^ b.length;
  const size = Math.max(a.length, b.length);
  for (let i = 0; i < size; i++) difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
}

function sheetUrl_(id) { return 'https://docs.google.com/spreadsheets/d/' + id + '/edit'; }
function isObject_(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function fail_(message, code) {
  const error = new Error(message);
  error.inventorySafeMessage = message;
  error.inventoryErrorCode = code || 'validation_error';
  throw error;
}
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
