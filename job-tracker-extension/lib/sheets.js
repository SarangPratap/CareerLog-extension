function getAuthHeaders(accessToken) {
  return {
    "Authorization": `Bearer ${accessToken}`,
    "Content-Type": "application/json"
  };
}

function isoDateToday() {
  return new Date().toISOString().split("T")[0];
}

function generateAppId(company, role, date) {
  return `${company.toLowerCase().replace(/\s+/g, "-")}_${role.toLowerCase().replace(/\s+/g, "-")}_${date}`;
}

async function createJobTrackerSheet(accessToken) {
  const year = new Date().getFullYear();

  const createRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    headers: getAuthHeaders(accessToken),
    body: JSON.stringify({
      properties: { title: `Job Tracker ${year}` },
      sheets: [
        { properties: { title: "Applications", sheetId: 0 } },
        { properties: { title: "Interview Log", sheetId: 1 } }
      ]
    })
  });

  if (!createRes.ok) {
    throw new Error(`Failed to create sheet: ${createRes.status}`);
  }

  const sheet = await createRes.json();
  const sheetId = sheet.spreadsheetId;

  const applicationsHeadersRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Applications!A1:H1?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: getAuthHeaders(accessToken),
      body: JSON.stringify({
        values: [[
          "Company",
          "Role",
          "Applied Date",
          "Current Status",
          "Last Updated",
          "Total Rounds",
          "Job URL",
          "Notes"
        ]]
      })
    }
  );

  if (!applicationsHeadersRes.ok) {
    throw new Error(`Failed to write Applications headers: ${applicationsHeadersRes.status}`);
  }

  const interviewHeadersRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Interview Log!A1:G1?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: getAuthHeaders(accessToken),
      body: JSON.stringify({
        values: [["App ID", "Company", "Round #", "Round Type", "Date", "Outcome", "Notes"]]
      })
    }
  );

  if (!interviewHeadersRes.ok) {
    throw new Error(`Failed to write Interview Log headers: ${interviewHeadersRes.status}`);
  }

  const formatRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
    method: "POST",
    headers: getAuthHeaders(accessToken),
    body: JSON.stringify({
      requests: [
        {
          repeatCell: {
            range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: "userEnteredFormat.textFormat.bold"
          }
        },
        {
          updateSheetProperties: {
            properties: { sheetId: 0, gridProperties: { frozenRowCount: 1 } },
            fields: "gridProperties.frozenRowCount"
          }
        },
        {
          repeatCell: {
            range: { sheetId: 1, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: "userEnteredFormat.textFormat.bold"
          }
        },
        {
          updateSheetProperties: {
            properties: { sheetId: 1, gridProperties: { frozenRowCount: 1 } },
            fields: "gridProperties.frozenRowCount"
          }
        }
      ]
    })
  });

  if (!formatRes.ok) {
    throw new Error(`Failed to format headers: ${formatRes.status}`);
  }

  await chrome.storage.local.set({ sheetId });
  return sheetId;
}

async function findApplicationRow(sheetId, company, role, accessToken) {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Applications!A:B`,
    { headers: { "Authorization": `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    throw new Error(`Failed to read applications: ${res.status}`);
  }

  const data = await res.json();
  const rows = data.values || [];

  for (let i = 1; i < rows.length; i += 1) {
    const rowCompany = rows[i][0]?.toLowerCase().trim();
    const rowRole = rows[i][1]?.toLowerCase().trim();
    const targetCompany = company.toLowerCase().trim();
    const targetRole = role.toLowerCase().trim();

    if (
      rowCompany === targetCompany ||
      rowCompany?.includes(targetCompany) ||
      targetCompany.includes(rowCompany)
    ) {
      if (
        rowRole === targetRole ||
        rowRole?.includes(targetRole) ||
        targetRole.includes(rowRole)
      ) {
        return i + 1;
      }
    }
  }

  return null;
}

async function addApplicationRow(sheetId, jobData, accessToken) {
  const today = isoDateToday();
  const values = [[
    jobData.company,
    jobData.role,
    jobData.appliedDate || today,
    jobData.status || "🔵 Applied",
    today,
    jobData.roundNumber || 0,
    jobData.jobUrl || "",
    jobData.notes || ""
  ]];

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Applications!A:H:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: getAuthHeaders(accessToken),
      body: JSON.stringify({ values })
    }
  );

  if (!res.ok) {
    throw new Error(`Failed to add application row: ${res.status}`);
  }
}

async function updateApplicationStatus(sheetId, rowNumber, newStatus, roundNumber, accessToken) {
  const today = isoDateToday();
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Applications!D${rowNumber}:F${rowNumber}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: getAuthHeaders(accessToken),
      body: JSON.stringify({ values: [[newStatus, today, roundNumber]] })
    }
  );

  if (!res.ok) {
    throw new Error(`Failed to update application row ${rowNumber}: ${res.status}`);
  }
}

async function addInterviewLogEntry(sheetId, appId, company, roundData, accessToken) {
  const values = [[
    appId,
    company,
    roundData.roundNumber,
    roundData.roundType,
    roundData.interviewDate || isoDateToday(),
    roundData.outcome || "⏳ Pending",
    roundData.notes || ""
  ]];

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Interview Log!A:G:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: getAuthHeaders(accessToken),
      body: JSON.stringify({ values })
    }
  );

  if (!res.ok) {
    throw new Error(`Failed to add interview log row: ${res.status}`);
  }
}

async function processAndUpdateSheet(jobData, sheetId, accessToken) {
  const existingRow = await findApplicationRow(sheetId, jobData.company, jobData.role, accessToken);

  if (existingRow) {
    await updateApplicationStatus(sheetId, existingRow, jobData.status, jobData.roundNumber, accessToken);

    if (jobData.roundNumber && jobData.roundType) {
      const appId = generateAppId(jobData.company, jobData.role, jobData.appliedDate || isoDateToday());
      await addInterviewLogEntry(sheetId, appId, jobData.company, jobData, accessToken);
    }

    return;
  }

  await addApplicationRow(sheetId, jobData, accessToken);
}

globalThis.generateAppId = generateAppId;
globalThis.createJobTrackerSheet = createJobTrackerSheet;
globalThis.findApplicationRow = findApplicationRow;
globalThis.addApplicationRow = addApplicationRow;
globalThis.updateApplicationStatus = updateApplicationStatus;
globalThis.addInterviewLogEntry = addInterviewLogEntry;
globalThis.processAndUpdateSheet = processAndUpdateSheet;
