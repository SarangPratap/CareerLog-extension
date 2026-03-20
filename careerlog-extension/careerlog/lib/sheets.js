// lib/sheets.js
// Google Sheets API — create, read, write job tracker sheet.

var generateAppId = function(company, role, date) {
  var c = (company || 'unknown').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  var r = (role    || 'unknown').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  var d = (date    || new Date().toISOString().split('T')[0]);
  return c + '_' + r + '_' + d;
};

// ─── CREATE SHEET ─────────────────────────────────────────────────────

var createJobTrackerSheet = async function(accessToken) {
  var year = new Date().getFullYear();

  // 1. Create spreadsheet
  var createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      properties: { title: 'Careerlog ' + year },
      sheets: [
        { properties: { title: 'Applications', sheetId: 0 } },
        { properties: { title: 'Interview Log', sheetId: 1 } }
      ]
    })
  });

  if (!createRes.ok) {
    var err = await createRes.json().catch(function() { return {}; });
    throw new Error('Failed to create sheet: ' + JSON.stringify(err));
  }

  var sheet = await createRes.json();
  var spreadsheetId = sheet.spreadsheetId;

  // 2. Add headers — Applications
  await sheetsRequest(spreadsheetId, 'PUT',
    'values/Applications!A1:H1?valueInputOption=RAW',
    { values: [['Company','Role','Applied Date','Current Status','Last Updated','Total Rounds','Job URL','Notes']] },
    accessToken
  );

  // 3. Add headers — Interview Log
  await sheetsRequest(spreadsheetId, 'PUT',
    'values/Interview%20Log!A1:G1?valueInputOption=RAW',
    { values: [['App ID','Company','Round #','Round Type','Interview Date','Outcome','Notes']] },
    accessToken
  );

  // 4. Format — bold headers + freeze rows
  await sheetsRequest(spreadsheetId, 'POST', ':batchUpdate', {
    requests: [
      { repeatCell: { range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
          cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.95, green: 0.95, blue: 0.96 } } },
          fields: 'userEnteredFormat.textFormat.bold,userEnteredFormat.backgroundColor' } },
      { updateSheetProperties: { properties: { sheetId: 0, gridProperties: { frozenRowCount: 1 } },
          fields: 'gridProperties.frozenRowCount' } },
      { repeatCell: { range: { sheetId: 1, startRowIndex: 0, endRowIndex: 1 },
          cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.95, green: 0.95, blue: 0.96 } } },
          fields: 'userEnteredFormat.textFormat.bold,userEnteredFormat.backgroundColor' } },
      { updateSheetProperties: { properties: { sheetId: 1, gridProperties: { frozenRowCount: 1 } },
          fields: 'gridProperties.frozenRowCount' } }
    ]
  }, accessToken);

  return spreadsheetId;
};

// ─── READ ─────────────────────────────────────────────────────────────

var findApplicationRow = async function(spreadsheetId, company, role, accessToken) {
  var res = await sheetsRequest(spreadsheetId, 'GET', 'values/Applications!A:C', null, accessToken);
  var rows = (res && res.values) || [];

  var targetCompany = (company || '').toLowerCase().trim();
  var targetRole    = (role    || '').toLowerCase().trim();

  for (var i = 1; i < rows.length; i++) {
    var rowCompany = (rows[i][0] || '').toLowerCase().trim();
    var rowRole    = (rows[i][1] || '').toLowerCase().trim();

    var companyMatch = rowCompany === targetCompany
      || rowCompany.indexOf(targetCompany) !== -1
      || targetCompany.indexOf(rowCompany) !== -1;

    var roleMatch = rowRole === targetRole
      || rowRole.indexOf(targetRole) !== -1
      || targetRole.indexOf(rowRole) !== -1;

    if (companyMatch && roleMatch) return i + 1; // 1-indexed, +1 for header
  }

  return null;
};

var getSheetStats = async function(spreadsheetId, accessToken) {
  try {
    var res = await sheetsRequest(spreadsheetId, 'GET', 'values/Applications!A:D', null, accessToken);
    var rows = (res && res.values) || [];
    if (rows.length <= 1) return { total: 0, interviews: 0, offers: 0 };

    var data = rows.slice(1);
    var total      = data.length;
    var interviews = data.filter(function(r) { return r[3] && (r[3].indexOf('Interview') !== -1 || r[3].indexOf('Phone') !== -1 || r[3].indexOf('Round') !== -1); }).length;
    var offers     = data.filter(function(r) { return r[3] && r[3].indexOf('Offer') !== -1; }).length;

    return { total: total, interviews: interviews, offers: offers };
  } catch (e) {
    return { total: 0, interviews: 0, offers: 0 };
  }
};

// ─── WRITE ────────────────────────────────────────────────────────────

var addApplicationRow = async function(spreadsheetId, jobData, accessToken) {
  var today = new Date().toISOString().split('T')[0];
  var statusEmoji = mapStatusToEmoji(jobData.status);

  await sheetsRequest(spreadsheetId, 'POST',
    'values/Applications!A:H:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS',
    { values: [[
      jobData.company    || '',
      jobData.role       || '',
      jobData.appliedDate || today,
      statusEmoji,
      today,
      jobData.roundNumber || 0,
      jobData.jobUrl     || '',
      jobData.notes      || ''
    ]] },
    accessToken
  );
};

var updateApplicationStatus = async function(spreadsheetId, rowNumber, jobData, accessToken) {
  var today = new Date().toISOString().split('T')[0];
  var statusEmoji = mapStatusToEmoji(jobData.status);

  await sheetsRequest(spreadsheetId, 'PUT',
    'values/Applications!D' + rowNumber + ':F' + rowNumber + '?valueInputOption=USER_ENTERED',
    { values: [[ statusEmoji, today, jobData.roundNumber || 0 ]] },
    accessToken
  );
};

var addInterviewLogEntry = async function(spreadsheetId, appId, company, jobData, accessToken) {
  var today = new Date().toISOString().split('T')[0];

  await sheetsRequest(spreadsheetId, 'POST',
    'values/Interview%20Log!A:G:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS',
    { values: [[
      appId,
      company,
      jobData.roundNumber  || '',
      jobData.roundType    || '',
      jobData.interviewDate || today,
      '⏳ Pending',
      jobData.notes        || ''
    ]] },
    accessToken
  );
};

// ─── ORCHESTRATOR ─────────────────────────────────────────────────────

var processAndUpdateSheet = async function(jobData, spreadsheetId, accessToken) {
  var existingRow = await findApplicationRow(spreadsheetId, jobData.company, jobData.role, accessToken);

  if (existingRow) {
    await updateApplicationStatus(spreadsheetId, existingRow, jobData, accessToken);

    if (jobData.roundNumber && jobData.roundType) {
      var appId = generateAppId(jobData.company, jobData.role, jobData.appliedDate);
      await addInterviewLogEntry(spreadsheetId, appId, jobData.company, jobData, accessToken);
    }
  } else {
    await addApplicationRow(spreadsheetId, jobData, accessToken);
  }
};

// ─── HELPERS ──────────────────────────────────────────────────────────

var mapStatusToEmoji = function(status) {
  var map = {
    'Applied':              '🔵 Applied',
    'Under Review':         '🟡 Under Review',
    'Phone Screen':         '📞 Phone Screen',
    'Technical Interview':  '💻 Technical Interview',
    'Final Round':          '👥 Final Round',
    'Offer':                '🎉 Offer Received',
    'Rejected':             '❌ Rejected',
    'Unknown':              '⚪ Unknown'
  };
  return map[status] || ('⚪ ' + (status || 'Unknown'));
};

var sheetsRequest = async function(spreadsheetId, method, path, body, accessToken) {
  var base = 'https://sheets.googleapis.com/v4/spreadsheets/' + spreadsheetId;
  var url  = path.startsWith(':') ? base + path : base + '/' + path;

  var opts = {
    method: method,
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type': 'application/json'
    }
  };

  if (body && method !== 'GET') opts.body = JSON.stringify(body);

  var res = await fetch(url, opts);
  if (!res.ok) {
    var errBody = await res.json().catch(function() { return {}; });
    throw new Error('Sheets API ' + res.status + ': ' + JSON.stringify(errBody));
  }

  if (method === 'POST' && path.indexOf(':batchUpdate') !== -1) return await res.json();
  if (method === 'GET') return await res.json();
  return await res.json().catch(function() { return {}; });
};
