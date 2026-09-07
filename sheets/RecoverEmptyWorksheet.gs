/**
 * Owner-editor workaround ONLY for an original worksheet confirmed to have no records.
 * Keep Code.gs installed and enable Advanced Drive v3; keep the drive.file-only scope.
 * Run prepareEmptyWorksheetRecovery, then activateEmptyWorksheetRecovery separately.
 * The original worksheet is never read, changed, or deleted. No token is replaced.
 */
function prepareEmptyWorksheetRecovery() { return emptyRecoveryRun_(false); }
function activateEmptyWorksheetRecovery() { return emptyRecoveryRun_(true); }

function emptyRecoveryRun_(activate) {
  let lock;
  let locked = false;
  let redactToken = '';
  let redactSourceId = '';
  let redactCandidateId = '';
  try {
    lock = LockService.getScriptLock();
    locked = lock.tryLock(10000);
    if (!locked) emptyRecoveryFail_('busy');
    emptyRecoveryDependencies_();
    const properties = PropertiesService.getScriptProperties();
    redactToken = properties.getProperty('INVENTORY_TOKEN') || '';
    redactSourceId = properties.getProperty('INVENTORY_SHEET_ID') || '';
    const source = emptyRecoverySource_(properties);
    const raw = properties.getProperty('INVENTORY_EMPTY_RECOVERY');
    let state;
    if (raw === null) {
      if (activate) emptyRecoveryFail_('notReady');
      state = {version: 1, sourceId: source.id, sourceUrl: source.url,
        sourceAccessModel: source.model, stage: 'creating', candidateId: null};
      emptyRecoverySave_(properties, state);
      // Metadata-only creation is non-idempotent. Persist intent before making this call.
      const created = Drive.Files.create({name: 'Lab chemical inventory (recovered empty setup)',
        mimeType: 'application/vnd.google-apps.spreadsheet'});
      redactCandidateId = created && typeof created.id === 'string' ? created.id : '';
      if (!created || !validSheetId_(created.id) || created.id === state.sourceId) emptyRecoveryFail_('pending');
      state.candidateId = created.id;
      state.stage = 'created';
      emptyRecoverySave_(properties, state);
    } else {
      state = emptyRecoveryState_(raw);
    }
    redactSourceId = state.sourceId;
    redactCandidateId = state.candidateId || '';

    if (state.stage === 'activated') {
      emptyRecoveryAssertSource_(properties, state, true);
      console.log('Empty-worksheet recovery is already complete. No new file or changes were made.');
      return {stage: 'activated', candidateUrl: sheetUrl_(state.candidateId)};
    }
    emptyRecoveryAssertSource_(properties, state, false);
    if (state.stage === 'creating') emptyRecoveryFail_('pending');
    if (activate && state.stage !== 'ready') emptyRecoveryFail_('notReady');

    let spreadsheet = emptyRecoveryCandidate_(state);
    if (!activate && state.stage === 'created') {
      emptyRecoveryInitialize_(state, spreadsheet);
      spreadsheet = emptyRecoveryCandidate_(state);
      emptyRecoveryVerifyEmpty_(spreadsheet);
      emptyRecoveryAssertSource_(properties, state, false);
      state.stage = 'ready';
      emptyRecoverySave_(properties, state);
    } else {
      emptyRecoveryVerifyEmpty_(spreadsheet);
    }
    if (!activate) {
      console.log('Replacement verified; the app still points to the original worksheet.');
      console.log('Candidate worksheet: ' + sheetUrl_(state.candidateId));
      console.log('Run activateEmptyWorksheetRecovery separately to recheck access and switch this empty setup.');
      return {stage: 'ready', candidateUrl: sheetUrl_(state.candidateId)};
    }

    emptyRecoveryAssertSource_(properties, state, false);
    state.stage = 'activated';
    // One write call, not an assumed transaction. Inconsistent partial results fail closed on retry.
    properties.setProperties({INVENTORY_SHEET_ID: state.candidateId,
      INVENTORY_SHEET_URL: sheetUrl_(state.candidateId), INVENTORY_EMPTY_RECOVERY: JSON.stringify(state)});
    console.log('Empty-worksheet recovery activated. The connection token and deployment URL are unchanged.');
    console.log('Lab worksheet: ' + sheetUrl_(state.candidateId));
    return {stage: 'activated', candidateUrl: sheetUrl_(state.candidateId)};
  } catch (error) {
    const messages = {
      busy: 'The connector is busy. Try this recovery step again later.',
      dependencies: 'Install the complete Code.gs and enable Advanced Drive v3 and Sheets v4 before recovery. Keep drive.file as the only OAuth scope.',
      configuration: 'The existing connector properties are missing or inconsistent. Preserve them and the original worksheet; recovery stopped.',
      state: 'The saved recovery record is inconsistent. Do not clear it or initialize another file; recovery stopped to prevent duplicate files.',
      changed: 'The active connection differs from the saved recovery record. No further changes were made. Preserve the recovery record and ask the maintainer to review it.',
      pending: 'A worksheet creation could not be confirmed. Do not clear INVENTORY_EMPTY_RECOVERY or retry creation manually; ask the maintainer to recover the existing candidate.',
      notReady: 'Run prepareEmptyWorksheetRecovery successfully before activation. No active connection was changed.',
      candidate: 'The replacement file could not be verified as an editable Google Sheet authorized for this app. The active connection was not switched.',
      content: 'The replacement has unexpected tabs, cell values, formulas, or settings. Recovery will not overwrite them or switch the connection.',
      google: 'Google could not complete this recovery step. Preserve the recovery record and worksheet files. Preparation never switches the active connection; after an uncertain activation, rerun activation to check the saved state.'
    };
    const code = error && typeof error.emptyRecoveryCode === 'string' ? error.emptyRecoveryCode : 'google';
    const known = code !== 'google' && Object.prototype.hasOwnProperty.call(messages, code);
    throw new Error(known ? messages[code] : messages.google + ' Detail: ' +
      emptyRecoveryRedact_(error, [redactToken, redactSourceId, redactCandidateId]));
  } finally {
    if (locked) lock.releaseLock();
  }
}

function emptyRecoveryDependencies_() {
  if (typeof ACCESS_MODEL === 'undefined' || typeof INVENTORY_HEADERS === 'undefined' ||
      typeof INVENTORY_TAB === 'undefined' || typeof EXPORT_SETTINGS_TAB === 'undefined' ||
      typeof EXPORT_SETTINGS_ROWS === 'undefined' || typeof typedRows_ !== 'function' ||
      typeof sheetDefinition_ !== 'function' || typeof headerFormat_ !== 'function' ||
      typeof columnWidth_ !== 'function' || typeof validSheetId_ !== 'function' || typeof sheetUrl_ !== 'function' ||
      typeof Drive === 'undefined' || !Drive || !Drive.Files ||
      typeof Drive.Files.create !== 'function' || typeof Drive.Files.get !== 'function' ||
      typeof Sheets === 'undefined' || !Sheets || !Sheets.Spreadsheets ||
      typeof Sheets.Spreadsheets.get !== 'function' || typeof Sheets.Spreadsheets.batchUpdate !== 'function' ||
      !Sheets.Spreadsheets.Values || typeof Sheets.Spreadsheets.Values.get !== 'function') emptyRecoveryFail_('dependencies');
}

function emptyRecoverySource_(properties) {
  const id = properties.getProperty('INVENTORY_SHEET_ID');
  const url = properties.getProperty('INVENTORY_SHEET_URL');
  const model = properties.getProperty('INVENTORY_ACCESS_MODEL');
  const token = properties.getProperty('INVENTORY_TOKEN');
  if (!validSheetId_(id) || url !== sheetUrl_(id) || model !== ACCESS_MODEL ||
      !token || token.length > 512) emptyRecoveryFail_('configuration');
  return {id: id, url: url, model: model};
}

function emptyRecoveryState_(raw) {
  let state;
  try { state = JSON.parse(raw); } catch (_) { emptyRecoveryFail_('state'); }
  const keys = ['version', 'sourceId', 'sourceUrl', 'sourceAccessModel', 'stage', 'candidateId'];
  if (!state || typeof state !== 'object' || Array.isArray(state) ||
      Object.keys(state).length !== keys.length || Object.keys(state).some(function (key) { return keys.indexOf(key) < 0; }) ||
      state.version !== 1 || !validSheetId_(state.sourceId) || state.sourceUrl !== sheetUrl_(state.sourceId) ||
      state.sourceAccessModel !== ACCESS_MODEL || ['creating', 'created', 'ready', 'activated'].indexOf(state.stage) < 0 ||
      (state.stage === 'creating' ? state.candidateId !== null :
        !validSheetId_(state.candidateId) || state.candidateId === state.sourceId)) emptyRecoveryFail_('state');
  return state;
}

function emptyRecoveryAssertSource_(properties, state, activated) {
  const source = emptyRecoverySource_(properties);
  const id = activated ? state.candidateId : state.sourceId;
  if (source.id !== id || source.url !== sheetUrl_(id) || source.model !== state.sourceAccessModel) emptyRecoveryFail_('changed');
}

function emptyRecoverySave_(properties, state) {
  properties.setProperty('INVENTORY_EMPTY_RECOVERY', JSON.stringify(state));
}

function emptyRecoveryCandidate_(state) {
  const id = state.candidateId;
  if (!validSheetId_(id) || id === state.sourceId) emptyRecoveryFail_('candidate');
  const file = Drive.Files.get(id, {fields: 'id,mimeType,isAppAuthorized,trashed,capabilities(canEdit)', supportsAllDrives: true});
  if (!file || file.id !== id || file.mimeType !== 'application/vnd.google-apps.spreadsheet' ||
      file.isAppAuthorized !== true || file.trashed !== false || !file.capabilities || file.capabilities.canEdit !== true) emptyRecoveryFail_('candidate');
  const spreadsheet = Sheets.Spreadsheets.get(id, {fields: 'spreadsheetId,properties(timeZone),sheets(properties)'});
  if (!spreadsheet || spreadsheet.spreadsheetId !== id || !Array.isArray(spreadsheet.sheets)) emptyRecoveryFail_('candidate');
  return spreadsheet;
}

function emptyRecoveryInitialize_(state, spreadsheet) {
  const tabs = spreadsheet.sheets;
  if (tabs.length === 2) { emptyRecoveryVerifyEmpty_(spreadsheet); return; }
  if (tabs.length > 1) emptyRecoveryFail_('content');
  if (tabs.length && !emptyRecoveryRowsEqual_(emptyRecoveryRead_(spreadsheet.spreadsheetId, tabs[0].properties), [])) emptyRecoveryFail_('content');
  const inventoryId = tabs.length ? tabs[0].properties.sheetId : 0;
  const settingsId = inventoryId === 0 ? 1 : 0;
  const inventory = sheetDefinition_(INVENTORY_TAB, [INVENTORY_HEADERS], 1, INVENTORY_HEADERS.length).properties;
  inventory.sheetId = inventoryId;
  const settings = sheetDefinition_(EXPORT_SETTINGS_TAB, EXPORT_SETTINGS_ROWS, 1, 2).properties;
  settings.sheetId = settingsId;
  const requests = [
    {updateSpreadsheetProperties: {properties: {timeZone: 'America/New_York'}, fields: 'timeZone'}},
    tabs.length ? {updateSheetProperties: {properties: inventory, fields: 'title,gridProperties'}} : {addSheet: {properties: inventory}},
    {addSheet: {properties: settings}},
    {updateCells: {start: {sheetId: inventoryId, rowIndex: 0, columnIndex: 0}, rows: typedRows_([INVENTORY_HEADERS]), fields: 'userEnteredValue'}},
    {updateCells: {start: {sheetId: settingsId, rowIndex: 0, columnIndex: 0}, rows: typedRows_(EXPORT_SETTINGS_ROWS), fields: 'userEnteredValue'}},
    headerFormat_(inventoryId, 1, INVENTORY_HEADERS.length), headerFormat_(settingsId, 1, 2),
    columnWidth_(inventoryId, 0, INVENTORY_HEADERS.length, 165), columnWidth_(inventoryId, 4, 5, 260),
    columnWidth_(inventoryId, 16, 17, 300), columnWidth_(settingsId, 0, 1, 300), columnWidth_(settingsId, 1, 2, 650),
    {updateDimensionProperties: {range: {sheetId: inventoryId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1},
      properties: {hiddenByUser: true}, fields: 'hiddenByUser'}}
  ];
  Sheets.Spreadsheets.batchUpdate({requests: requests}, state.candidateId);
}

function emptyRecoveryVerifyEmpty_(spreadsheet) {
  if (spreadsheet.sheets.length !== 2) emptyRecoveryFail_('content');
  [INVENTORY_TAB, EXPORT_SETTINGS_TAB].forEach(function (title, i) {
    const tabs = spreadsheet.sheets.filter(function (tab) { return tab.properties && tab.properties.title === title; });
    if (tabs.length !== 1 || !emptyRecoveryRowsEqual_(emptyRecoveryRead_(spreadsheet.spreadsheetId, tabs[0].properties),
        i === 0 ? [INVENTORY_HEADERS] : EXPORT_SETTINGS_ROWS)) emptyRecoveryFail_('content');
  });
}

function emptyRecoveryRead_(id, tab) {
  if (!tab || (tab.sheetType && tab.sheetType !== 'GRID') || !Number.isInteger(tab.sheetId) ||
      typeof tab.title !== 'string' || !tab.gridProperties || !Number.isInteger(tab.gridProperties.rowCount) ||
      tab.gridProperties.rowCount < 1) emptyRecoveryFail_('content');
  const response = Sheets.Spreadsheets.Values.get(id, "'" + tab.title.replace(/'/g, "''") + "'!1:" + tab.gridProperties.rowCount,
    {valueRenderOption: 'FORMULA', dateTimeRenderOption: 'FORMATTED_STRING'});
  if (!response || (response.values !== undefined && !Array.isArray(response.values))) emptyRecoveryFail_('content');
  return response.values || [];
}

function emptyRecoveryRowsEqual_(actual, expected) {
  for (let row = 0; row < Math.max(actual.length, expected.length); row++) {
    const a = actual[row] || [];
    const b = expected[row] || [];
    if (!Array.isArray(a)) return false;
    for (let col = 0; col < Math.max(a.length, b.length); col++) {
      const av = a[col] == null ? '' : a[col];
      const bv = b[col] == null ? '' : b[col];
      if (av !== bv) return false;
    }
  }
  return true;
}

function emptyRecoveryFail_(code) {
  const error = new Error('Empty-worksheet recovery stopped.');
  error.emptyRecoveryCode = code;
  throw error;
}

function emptyRecoveryRedact_(error, secrets) {
  let message = error && typeof error.message === 'string' ? error.message :
    typeof error === 'string' ? error : 'The operation failed without a readable error message.';
  secrets.forEach(function (secret) {
    if (secret) message = message.split(secret).join('[redacted]');
  });
  message = message.replace(/Bearer\s+[^\s,;"'<>]+/gi, 'Bearer [redacted]')
    .replace(/https?:\/\/[^\s<>"']+/gi, '[URL redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email redacted]')
    .replace(/[A-Za-z0-9_=-]{32,}/g, '[opaque value redacted]')
    .replace(/[\u0000-\u001F\u007F]/g, ' ');
  return message.length > 350 ? message.slice(0, 350) + '…' : message;
}
