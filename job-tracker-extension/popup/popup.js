function showState(stateId) {
  ["state-setup", "state-active", "state-error"].forEach((id) => {
    document.getElementById(id).classList.toggle("hidden", id !== stateId);
  });
}

function formatRelativeTime(timestamp) {
  if (!timestamp) {
    return "never";
  }

  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) {
    return "now";
  }

  if (mins < 60) {
    return `${mins}m`;
  }

  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return `${hours}h`;
  }

  return `${Math.floor(hours / 24)}d`;
}

function isRateLimitError(message) {
  const text = String(message || "").toLowerCase();
  return text.includes("429") || text.includes("rate limit");
}

function setSyncUi(isSyncing) {
  const syncBtn = document.getElementById("btn-sync");
  const syncStatus = document.getElementById("sync-status");

  if (!syncBtn || !syncStatus) {
    return;
  }

  syncBtn.disabled = isSyncing;
  syncBtn.textContent = isSyncing ? "Syncing now..." : "Sync now";
  syncStatus.classList.toggle("hidden", !isSyncing);
}

function isStaleSync(syncInProgress, lastAttemptAt, syncHeartbeatAt) {
  if (!syncInProgress) {
    return false;
  }

  const lastTouch = Math.max(Number(lastAttemptAt || 0), Number(syncHeartbeatAt || 0));
  if (!lastTouch) {
    return true;
  }

  return Date.now() - lastTouch > 5 * 60 * 1000;
}

async function loadPopupState() {
  const {
    sheetId,
    aiProvider,
    setupComplete,
    syncInProgress,
    syncHeartbeatAt,
    lastRunState,
    lastError,
    lastAttemptAt,
    lastSuccessAt,
    lastFetchedCount,
    lastFilteredOutCount,
    lastProcessedCount,
    lastSyncSource,
    syncLogs,
    lastSyncAt,
    statTotal,
    statInterviews,
    statOffers
  } = await chrome.storage.local.get([
    "sheetId",
    "aiProvider",
    "setupComplete",
    "syncInProgress",
    "syncHeartbeatAt",
    "lastRunState",
    "lastError",
    "lastAttemptAt",
    "lastSuccessAt",
    "lastFetchedCount",
    "lastFilteredOutCount",
    "lastProcessedCount",
    "lastSyncSource",
    "syncLogs",
    "lastSyncAt",
    "statTotal",
    "statInterviews",
    "statOffers"
  ]);

  if (lastError && !isRateLimitError(lastError)) {
    document.getElementById("error-message").textContent = lastError;
    showState("state-error");
    return;
  }

  if (!setupComplete || !sheetId) {
    showState("state-setup");
    setSyncUi(false);
    return;
  }

  showState("state-active");
  const stale = isStaleSync(syncInProgress, lastAttemptAt, syncHeartbeatAt);
  setSyncUi(Boolean(syncInProgress) && !stale);

  if (stale) {
    await chrome.runtime.sendMessage({ type: "RESET_STALE_SYNC" }).catch(() => {});
  }

  document.getElementById("footer-text").textContent = `${(aiProvider || "gemini")} - active`;

  const list = document.getElementById("activity-list");
  const latestLog = Array.isArray(syncLogs) && syncLogs.length > 0 ? syncLogs[0] : null;
  const latestLogText = latestLog
    ? `${latestLog.level || "info"}: ${latestLog.message || "Sync event"}`
    : "No sync logs yet";
  list.innerHTML = `
    <li><span class="dot neutral"></span><span>Last sync attempt</span><time>${formatRelativeTime(lastAttemptAt || lastSyncAt)}</time></li>
    <li><span class="dot neutral"></span><span>Last successful write</span><time>${formatRelativeTime(lastSuccessAt)}</time></li>
    <li><span class="dot neutral"></span><span>Sync state: ${String(lastRunState || "unknown")}</span><time>state</time></li>
    <li><span class="dot neutral"></span><span>Run stats: fetched ${Number(lastFetchedCount || 0)}, filtered ${Number(lastFilteredOutCount || 0)}, written ${Number(lastProcessedCount || 0)}</span><time>run</time></li>
    <li><span class="dot neutral"></span><span>Sync source: ${String(lastSyncSource || "unknown")}</span><time>source</time></li>
    <li><span class="dot neutral"></span><span>${latestLogText}</span><time>log</time></li>
  `;

  if (stale) {
    list.innerHTML += `<li><span class="dot neutral"></span><span>Detected stale sync and reset it. Please click Sync now again.</span><time>now</time></li>`;
  }

  if (isRateLimitError(lastError)) {
    list.innerHTML += `<li><span class="dot neutral"></span><span>AI rate limited. Retrying automatically.</span><time>now</time></li>`;
  }

  document.getElementById("stat-total").textContent = String(statTotal || 0);
  document.getElementById("stat-interviews").textContent = String(statInterviews || 0);
  document.getElementById("stat-offers").textContent = String(statOffers || 0);
}

document.getElementById("btn-setup").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/onboarding.html") });
});

document.getElementById("btn-fix").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById("btn-settings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById("btn-dashboard").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard/dashboard.html") });
});

document.getElementById("btn-sync").addEventListener("click", async () => {
  setSyncUi(true);
  try {
    const result = await chrome.runtime.sendMessage({ type: "SYNC_NOW" });
    if (result?.inProgress) {
      await loadPopupState();
    } else {
      setSyncUi(false);
      await loadPopupState();
    }
  } catch {
    setSyncUi(false);
    await loadPopupState();
  }
});

document.getElementById("btn-open-sheet").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "OPEN_SHEET" });
});

loadPopupState();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") {
    return;
  }

  const telemetryKeys = [
    "syncInProgress",
    "syncHeartbeatAt",
    "lastRunState",
    "lastError",
    "lastAttemptAt",
    "lastSuccessAt",
    "lastFetchedCount",
    "lastFilteredOutCount",
    "lastProcessedCount",
    "lastSyncSource",
    "syncLogs",
    "statTotal",
    "statInterviews",
    "statOffers"
  ];

  const shouldRefresh = telemetryKeys.some((key) => Object.prototype.hasOwnProperty.call(changes, key));
  if (changes.syncInProgress) {
    setSyncUi(Boolean(changes.syncInProgress.newValue));
  }

  if (shouldRefresh) {
    loadPopupState();
  }
});
