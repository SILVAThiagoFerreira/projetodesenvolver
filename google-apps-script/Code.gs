const SPREADSHEET_ID = '11w-mZWjTo08bHfAQ-HCG4BrnzG4WexJV8r1FZ6xbjZA';
const SHEET_NAME = 'Registros';

function doPost(e) {
  const body = JSON.parse(e.postData.contents || '{}');
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME)
    || SpreadsheetApp.openById(SPREADSHEET_ID).insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) sheet.appendRow(['timestamp', 'tipo', 'desmonte', 'dados_json']);
  const rows = Array.isArray(body.rows) ? body.rows : [body];
  rows.forEach(row => sheet.appendRow([new Date(), body.tipo || 'desmonte', body.desmonte || '', JSON.stringify(row)]));
  return ContentService.createTextOutput(JSON.stringify({ ok: true, count: rows.length }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'flyrock-database' }))
    .setMimeType(ContentService.MimeType.JSON);
}
