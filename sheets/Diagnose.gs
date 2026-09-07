/**
 * Optional owner-only diagnostics. Add this as a separate Apps Script file and run
 * diagnoseInventoryConnection in the editor. No deployment is needed to run it.
 * This helper only reads configuration and spreadsheet metadata/headings, then
 * invokes the installed connector's read-only ping path. It never writes a row.
 */
function diagnoseInventoryConnection() {
  let stage = '01';
  let token = '';
  let sheetId = '';
  const expectedHeaders = [
    'Record ID', 'Created at', 'Principal investigator', 'Room', 'Chemical name',
    'Amount per container', 'Unit', 'Physical state', 'Container count', 'CAS number',
    'CAS unavailable reason', 'Concentration', 'Supplier', 'Catalog number',
    'Expiry date', 'Notes', 'Label text', 'CAS source', 'Reviewed', 'Sync state', 'Synced at'
  ];
  try {
    console.log('01 — Checking script configuration; property values will not be printed.');
    const properties = PropertiesService.getScriptProperties();
    token = properties.getProperty('INVENTORY_TOKEN') || '';
    sheetId = properties.getProperty('INVENTORY_SHEET_ID') || '';
    const marker = properties.getProperty('INVENTORY_ACCESS_MODEL');
    const storedUrl = properties.getProperty('INVENTORY_SHEET_URL');
    if (marker !== 'drive.file.v1') {
      diagnosticStop_('configuration_error', 'The per-file connector access marker is missing or incompatible. Confirm this is the initialized standalone connector project.');
    }
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(sheetId) || !token || token.length > 512 ||
        storedUrl !== 'https://docs.google.com/spreadsheets/d/' + sheetId + '/edit') {
      diagnosticStop_('configuration_error', 'Required script properties are missing or inconsistent. Do not replace properties or initialize another worksheet to troubleshoot this result.');
    }
    console.log('01 — PASS: required configuration is present and consistent.');

    stage = '02';
    console.log('02 — Checking the Advanced Sheets service.');
    if (typeof Sheets === 'undefined' || !Sheets.Spreadsheets ||
        typeof Sheets.Spreadsheets.get !== 'function' || !Sheets.Spreadsheets.Values ||
        typeof Sheets.Spreadsheets.Values.get !== 'function') {
      diagnosticStop_('service_missing', 'Enable Google Sheets API v4 under Services with the identifier Sheets. Keep the supplied manifest and drive.file scope.');
    }
    console.log('02 — PASS: the required Advanced Sheets read methods are available.');

    stage = '03';
    console.log('03 — Reading spreadsheet metadata with the same request as the connector.');
    const spreadsheet = Sheets.Spreadsheets.get(sheetId, {
      fields: 'spreadsheetId,properties(timeZone),sheets(properties)'
    });
    if (!spreadsheet || spreadsheet.spreadsheetId !== sheetId) {
      diagnosticStop_('metadata_invalid', 'The metadata response did not identify the configured spreadsheet.');
    }
    const inventory = (spreadsheet.sheets || []).some(function (entry) {
      return entry && entry.properties && entry.properties.title === 'Chemical inventory';
    });
    if (!inventory) diagnosticStop_('inventory_tab_missing', 'The Chemical inventory tab is missing. Restore its original name without deleting inventory.');
    console.log('03 — PASS: this editor account can read the configured inventory spreadsheet.');

    stage = '04';
    console.log('04 — Reading and checking the exact 21 inventory headings.');
    const headerResponse = Sheets.Spreadsheets.Values.get(sheetId, "'Chemical inventory'!1:1", {
      valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING'
    });
    const headers = headerResponse && headerResponse.values && headerResponse.values[0] || [];
    if (headers.length !== expectedHeaders.length || expectedHeaders.some(function (header, i) { return headers[i] !== header; })) {
      diagnosticStop_('headers_changed', 'The inventory headings differ from the expected 21 columns. Restore the original headings and order, preserving existing rows and Record IDs.');
    }
    console.log('04 — PASS: inventory headings match the connector contract.');

    stage = '05';
    console.log('05 — Checking the installed connector locally with a read-only ping.');
    if (typeof doPost !== 'function') {
      diagnosticStop_('connector_code_missing', 'The doPost connector function is missing. Confirm the complete Code.gs is installed in this same project.');
    }
    const output = doPost({postData: {type: 'application/json', contents: JSON.stringify({action: 'ping', token: token})}});
    if (!output || typeof output.getContent !== 'function') {
      diagnosticStop_('protocol_error', 'The local ping did not return a JSON text response compatible with the Android app.');
    }
    let response;
    try { response = JSON.parse(output.getContent()); }
    catch (_) { diagnosticStop_('protocol_error', 'The local ping did not return parseable JSON.'); }
    if (!response || response.ok !== true) {
      const knownCodes = ['unauthorized', 'validation_error', 'busy', 'configuration_error', 'internal_error'];
      const code = response && knownCodes.indexOf(response.code) !== -1 ? response.code : 'protocol_error';
      const detail = response && typeof response.error === 'string' ? response.error : 'The installed connector did not confirm its local ping.';
      diagnosticStop_(code, detail);
    }
    if (response.sheetUrl !== storedUrl) {
      diagnosticStop_('protocol_error', 'The local ping returned a different or invalid worksheet link.');
    }
    console.log('05 — PASS: the installed editor code returns a successful, compatible ping.');
    const message = 'Editor checks passed. This does not verify the deployed /exec URL, deployed version, execution identity, or Android request. Compare the saved app URL with this project’s active deployment and its version/settings.';
    console.log('RESULT EDITOR_OK — ' + message);
    return {ok: true, code: 'EDITOR_OK', stage: stage, message: message};
  } catch (error) {
    const knownDiagnosticCodes = ['configuration_error', 'service_missing', 'metadata_invalid', 'inventory_tab_missing',
      'headers_changed', 'connector_code_missing', 'protocol_error', 'unauthorized', 'validation_error', 'busy', 'internal_error'];
    const code = error && knownDiagnosticCodes.indexOf(error.inventoryDiagnosticCode) !== -1 ?
      error.inventoryDiagnosticCode : 'google_or_runtime_error';
    const message = diagnosticRedact_(error && typeof error.message === 'string' ? error.message :
      typeof error === 'string' ? error : 'The check failed without a readable error message.', token, sheetId);
    const resultCode = 'D' + stage + '_' + code.toUpperCase();
    console.log('RESULT ' + resultCode + ' — ' + message);
    console.log('No configuration, worksheet data, tokens, or deployments were changed by this diagnostic. Share only the RESULT line; do not share Script properties.');
    return {ok: false, code: resultCode, stage: stage, message: message};
  }
}

function diagnosticStop_(code, message) {
  const error = new Error(message);
  error.inventoryDiagnosticCode = code;
  throw error;
}

/** Format a single bounded message, never a raw Google exception or response object. */
function diagnosticRedact_(message, token, sheetId) {
  let safe = message;
  [token, sheetId].forEach(function (secret) {
    if (secret) safe = safe.split(secret).join('[redacted]');
  });
  safe = safe.replace(/Bearer\s+[^\s,;"'<>]+/gi, 'Bearer [redacted]')
    .replace(/https?:\/\/[^\s<>"']+/gi, '[URL redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email redacted]')
    .replace(/[A-Za-z0-9_=-]{32,}/g, '[opaque value redacted]')
    .replace(/[\u0000-\u001F\u007F]/g, ' ');
  return safe.length > 700 ? safe.slice(0, 700) + '…' : safe;
}
