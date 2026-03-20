function formatMonthYear(ts) {
  const date = ts ? new Date(ts) : new Date();
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function formatStatusBadge(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("offer")) {
    return "Offer";
  }
  if (s.includes("interview") || s.includes("phone") || s.includes("final")) {
    return "Interview";
  }
  if (s.includes("reject") || s.includes("unfortunately")) {
    return "Rejected";
  }
  return "Applied";
}

async function fetchApplications(sheetId, accessToken) {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Applications!A:H`,
    { headers: { "Authorization": `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    throw new Error(`Failed to read applications: ${res.status}`);
  }

  const data = await res.json();
  const rows = data.values || [];
  return rows.slice(1).map((r) => ({
    company: r[0] || "",
    role: r[1] || "",
    appliedDate: r[2] || "",
    status: r[3] || "Applied",
    updatedAt: r[4] || "",
    rounds: Number(r[5] || 0)
  }));
}

function renderTable(rows) {
  const body = document.getElementById("applications-body");
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="5" class="empty">No applications found.</td></tr>';
    return;
  }

  body.innerHTML = rows
    .slice(0, 60)
    .map((row) => `
      <tr>
        <td>${row.company}</td>
        <td>${row.role}</td>
        <td>${row.appliedDate}</td>
        <td>${formatStatusBadge(row.status)}</td>
        <td>${row.updatedAt}</td>
      </tr>
    `)
    .join("");
}

function renderPipeline(rows) {
  const stages = [
    { key: "Applied", count: 0 },
    { key: "Under Review", count: 0 },
    { key: "Interview", count: 0 },
    { key: "Final Round", count: 0 },
    { key: "Offer", count: 0 },
    { key: "Rejected", count: 0 }
  ];

  for (const row of rows) {
    const status = String(row.status || "").toLowerCase();
    if (status.includes("offer")) {
      stages[4].count += 1;
    } else if (status.includes("reject") || status.includes("unfortunately")) {
      stages[5].count += 1;
    } else if (status.includes("final")) {
      stages[3].count += 1;
    } else if (status.includes("interview") || status.includes("phone")) {
      stages[2].count += 1;
    } else if (status.includes("review")) {
      stages[1].count += 1;
    } else {
      stages[0].count += 1;
    }
  }

  const max = Math.max(1, ...stages.map((s) => s.count));
  const pipeline = document.getElementById("pipeline");
  pipeline.innerHTML = stages
    .map((stage) => {
      const width = Math.floor((stage.count / max) * 100);
      return `
        <div class="pipe-row">
          <span>${stage.key}</span>
          <div class="pipe-track"><div class="pipe-fill" style="width:${width}%"></div></div>
          <strong>${stage.count}</strong>
        </div>
      `;
    })
    .join("");
}

async function loadDashboard() {
  const state = await chrome.storage.local.get([
    "sheetId",
    "aiProvider",
    "statTotal",
    "statInterviews",
    "statOffers",
    "lastAttemptAt",
    "lastRunState",
    "lastFetchedCount",
    "lastProcessedCount"
  ]);

  document.getElementById("provider-chip").textContent = `${state.aiProvider || "gemini"} - active`;
  document.getElementById("month-label").textContent = formatMonthYear(state.lastAttemptAt);

  const statTotal = Number(state.statTotal || 0);
  const statInterviews = Number(state.statInterviews || 0);
  const statOffers = Number(state.statOffers || 0);
  const conversion = statTotal > 0 ? Math.round((statInterviews / statTotal) * 100) : 0;

  document.getElementById("stat-total").textContent = String(statTotal);
  document.getElementById("stat-interviews").textContent = String(statInterviews);
  document.getElementById("stat-conversion").textContent = `${conversion}%`;
  document.getElementById("stat-offers").textContent = String(statOffers);

  const activity = document.getElementById("activity-list");
  activity.innerHTML = `
    <li>State: ${state.lastRunState || "unknown"}</li>
    <li>Fetched: ${Number(state.lastFetchedCount || 0)}</li>
    <li>Written: ${Number(state.lastProcessedCount || 0)}</li>
  `;

  if (!state.sheetId) {
    renderTable([]);
    renderPipeline([]);
    activity.innerHTML += "<li>No sheet configured.</li>";
    return;
  }

  const token = await getValidToken();
  const rows = await fetchApplications(state.sheetId, token);
  renderTable(rows);
  renderPipeline(rows);
}

document.getElementById("btn-sync").addEventListener("click", async () => {
  const btn = document.getElementById("btn-sync");
  btn.disabled = true;
  btn.textContent = "Syncing...";
  try {
    await chrome.runtime.sendMessage({ type: "SYNC_NOW" });
    await loadDashboard();
  } finally {
    btn.disabled = false;
    btn.textContent = "Sync";
  }
});

document.getElementById("btn-open-sheet").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "OPEN_SHEET" });
});

document.getElementById("btn-open-settings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById("btn-open-log").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "OPEN_SHEET" });
});

loadDashboard().catch((error) => {
  const activity = document.getElementById("activity-list");
  activity.innerHTML = `<li>Dashboard load error: ${error?.message || "Unknown error"}</li>`;
});
