/**
 * Optional owner-editor check. Keep drive.file as the only OAuth scope.
 * Advanced Drive v3 is optional; enabling it permits one additional metadata read.
 * No file, properties, tokens, deployments, or authorization grants are changed.
 */
function checkInventoryFileAccess() {
  const report = {
    configuration: 'ok', scope: 'notChecked', scopeStatus: 'unknown', scopeAuthorized: 'unknown',
    drive: 'notChecked', sheets: 'notChecked', idMatched: 'unknown',
    mimeSheets: 'unknown', appAuthorized: 'unknown', trashed: 'unknown',
    canEdit: 'unknown', sheetsIdMatched: 'unknown', errors: {}
  };
  let token = '';
  let sheetId = '';
  console.log('Read-only access check: no worksheet, configuration, token, deployment, or authorization changes.');
  try {
    const properties = PropertiesService.getScriptProperties();
    token = properties.getProperty('INVENTORY_TOKEN') || '';
    sheetId = properties.getProperty('INVENTORY_SHEET_ID') || '';
    if (properties.getProperty('INVENTORY_ACCESS_MODEL') !== 'drive.file.v1' ||
        !/^[A-Za-z0-9_-]{10,200}$/.test(sheetId) || !token || token.length > 512 ||
        properties.getProperty('INVENTORY_SHEET_URL') !==
          'https://docs.google.com/spreadsheets/d/' + sheetId + '/edit') {
      throw new Error('Required standalone connector properties are missing or inconsistent; preserve the existing worksheet and properties.');
    }
  } catch (error) {
    report.configuration = 'error';
    report.errors.configuration = inventoryAccessRedact_(error, token, sheetId);
    return inventoryAccessReport_(report);
  }

  try {
    if (typeof ScriptApp === 'undefined' || !ScriptApp || !ScriptApp.AuthMode ||
        !ScriptApp.AuthorizationStatus || typeof ScriptApp.getAuthorizationInfo !== 'function') {
      report.scope = 'unavailable';
    } else {
      const scope = 'https://www.googleapis.com/auth/drive.file';
      const info = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL, [scope]);
      const status = info.getAuthorizationStatus();
      const required = status === ScriptApp.AuthorizationStatus.REQUIRED;
      const notRequired = status === ScriptApp.AuthorizationStatus.NOT_REQUIRED;
      report.scopeStatus = required ? 'required' : notRequired ? 'notRequired' : 'unknown';
      const scopes = info.getAuthorizedScopes();
      report.scopeAuthorized = Array.isArray(scopes) ? scopes.indexOf(scope) !== -1 : 'unknown';
      report.scope = required ? (report.scopeAuthorized === true ? 'inconsistent' : 'missing') :
        notRequired ? (report.scopeAuthorized === false ? 'inconsistent' :
          report.scopeAuthorized === true ? 'notRequired' : 'unknown') : 'unknown';
    }
  } catch (error) {
    report.scope = 'error';
    report.errors.scope = inventoryAccessRedact_(error, token, sheetId);
  }

  try {
    if (typeof Drive === 'undefined' || !Drive || !Drive.Files || typeof Drive.Files.get !== 'function') {
      report.drive = 'unavailable';
    } else {
      const file = Drive.Files.get(sheetId, {
        fields: 'id,mimeType,isAppAuthorized,trashed,capabilities(canEdit)', supportsAllDrives: true
      });
      report.drive = 'ok';
      report.idMatched = file && typeof file.id === 'string' ? file.id === sheetId : 'unknown';
      report.mimeSheets = file && typeof file.mimeType === 'string' ?
        file.mimeType === 'application/vnd.google-apps.spreadsheet' : 'unknown';
      report.appAuthorized = inventoryAccessBoolean_(file && file.isAppAuthorized);
      report.trashed = inventoryAccessBoolean_(file && file.trashed);
      report.canEdit = inventoryAccessBoolean_(file && file.capabilities && file.capabilities.canEdit);
    }
  } catch (error) {
    report.drive = 'error';
    report.errors.drive = inventoryAccessRedact_(error, token, sheetId);
  }

  // Keep this independent of Drive so a Drive error cannot hide the Sheets result.
  try {
    if (typeof Sheets === 'undefined' || !Sheets || !Sheets.Spreadsheets ||
        typeof Sheets.Spreadsheets.get !== 'function') {
      report.sheets = 'unavailable';
    } else {
      const spreadsheet = Sheets.Spreadsheets.get(sheetId, {
        fields: 'spreadsheetId,properties(timeZone),sheets(properties)'
      });
      report.sheets = 'ok';
      report.sheetsIdMatched = spreadsheet && typeof spreadsheet.spreadsheetId === 'string' ?
        spreadsheet.spreadsheetId === sheetId : 'unknown';
    }
  } catch (error) {
    report.sheets = 'error';
    report.errors.sheets = inventoryAccessRedact_(error, token, sheetId);
  }
  return inventoryAccessReport_(report);
}

/** Run separately only when the read-only check reports missing scope consent. */
function authorizeInventoryFileAccess() {
  ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, ['https://www.googleapis.com/auth/drive.file']);
  return checkInventoryFileAccess();
}

function inventoryAccessBoolean_(value) {
  return typeof value === 'boolean' ? value : 'unknown';
}

function inventoryAccessReport_(report) {
  console.log('RESULT ACCESS ' + JSON.stringify(report));
  console.log('This checks the current editor execution, not the deployed version or execution identity. Share only the RESULT ACCESS line.');
  return report;
}

/** Sanitize only a bounded message; never serialize an exception or API response. */
function inventoryAccessRedact_(error, token, sheetId) {
  let safe = error && typeof error.message === 'string' ? error.message :
    typeof error === 'string' ? error : 'The check failed without a readable error message.';
  [token, sheetId].forEach(function (secret) {
    if (secret) safe = safe.split(secret).join('[redacted]');
  });
  safe = safe.replace(/Bearer\s+[^\s,;"'<>]+/gi, 'Bearer [redacted]')
    .replace(/https?:\/\/[^\s<>"']+/gi, '[URL redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email redacted]')
    .replace(/[A-Za-z0-9_=-]{32,}/g, '[opaque value redacted]')
    .replace(/[\u0000-\u001F\u007F]/g, ' ');
  return safe.length > 350 ? safe.slice(0, 350) + '…' : safe;
}
