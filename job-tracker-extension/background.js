importScripts("./lib/auth.js", "./lib/ai.js", "./lib/filter.js", "./lib/sheets.js", "./lib/gmail.js");

function setupPolling() {
  chrome.alarms.create("pollGmail", { periodInMinutes: 5 });
}

let syncInProgress = false;
const SYNC_STALE_MS = 5 * 60 * 1000;

async function appendSyncLog(level, message, meta = {}) {
  const { syncLogs } = await chrome.storage.local.get(["syncLogs"]);
  const next = [{ ts: Date.now(), level, message, meta }, ...(syncLogs || [])].slice(0, 30);
  await chrome.storage.local.set({ syncLogs: next });
}

async function recoverStaleSyncState() {
  const { syncInProgress: persistedInProgress, lastAttemptAt, syncHeartbeatAt } =
    await chrome.storage.local.get(["syncInProgress", "lastAttemptAt", "syncHeartbeatAt"]);

  if (!persistedInProgress) {
    return;
  }

  const lastTouch = Math.max(Number(lastAttemptAt || 0), Number(syncHeartbeatAt || 0));
  if (!lastTouch || Date.now() - lastTouch > SYNC_STALE_MS) {
    syncInProgress = false;
    await chrome.storage.local.set({
      syncInProgress: false,
      syncHeartbeatAt: 0,
      lastRunState: "stalled_recovered",
      lastError: "Previous sync stalled and was reset. Please run Sync now again.",
      lastErrorTime: Date.now()
    });
    await appendSyncLog("warn", "Recovered stale sync state", { lastTouch });
  }
}

async function isSyncCurrentlyRunning() {
  const state = await chrome.storage.local.get(["syncInProgress", "lastAttemptAt", "syncHeartbeatAt"]);
  const persisted = Boolean(state.syncInProgress);
  const local = Boolean(syncInProgress);

  if (!persisted && !local) {
    return false;
  }

  const lastTouch = Math.max(Number(state.lastAttemptAt || 0), Number(state.syncHeartbeatAt || 0));
  const stale = !lastTouch || Date.now() - lastTouch > SYNC_STALE_MS;

  if (stale) {
    syncInProgress = false;
    await chrome.storage.local.set({
      syncInProgress: false,
      syncHeartbeatAt: 0,
      lastRunState: "stalled_recovered",
      lastError: "Previous sync stalled and was reset. Please run Sync now again.",
      lastErrorTime: Date.now()
    });
    await appendSyncLog("warn", "Recovered stale sync lock during sync request", { lastTouch });
    return false;
  }

  syncInProgress = true;
  return true;
}

function extractRetryAfterMs(error) {
  const message = String(error?.message || "");
  const match = message.match(/retry_after_ms=(\d+)/i);
  if (!match) {
    return 0;
  }

  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function clampCooldownMs(ms) {
  const minMs = 30 * 1000;
  const maxMs = 15 * 60 * 1000;
  return Math.max(minMs, Math.min(maxMs, ms));
}

function isRateLimitError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("429") || message.includes("rate limit");
}

function mergeUniqueEmails(primaryEmails, secondaryEmails) {
  const map = new Map();
  for (const email of primaryEmails || []) {
    if (email?.id) {
      map.set(email.id, email);
    }
  }

  for (const email of secondaryEmails || []) {
    if (email?.id && !map.has(email.id)) {
      map.set(email.id, email);
    }
  }

  return [...map.values()];
}

function looksJobRelatedHeuristic(email) {
  const text = `${email?.subject || ""} ${email?.body || ""}`.toLowerCase();
  const terms = [
    "application",
    "interview",
    "recruiter",
    "talent acquisition",
    "hiring",
    "offer",
    "unfortunately",
    "thank you for applying"
  ];
  return terms.some((term) => text.includes(term));
}

function inferCompanyFromFromHeader(fromHeader) {
  const emailMatch = String(fromHeader || "").match(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/i);
  const domain = emailMatch?.[1] || "";
  const parts = domain.split(".").filter(Boolean);
  if (parts.length === 0) {
    return "Unknown Company";
  }

  const base = parts[0].replace(/[-_]/g, " ");
  return base.replace(/\b\w/g, (c) => c.toUpperCase());
}

function inferStatusFromText(subject, body) {
  const text = `${subject || ""} ${body || ""}`.toLowerCase();
  if (text.includes("offer")) {
    return "Offer";
  }
  if (text.includes("interview") || text.includes("phone screen") || text.includes("final round")) {
    return "Interview";
  }
  if (text.includes("unfortunately") || text.includes("regret to inform") || text.includes("not moving forward")) {
    return "Rejected";
  }
  return "Applied";
}

function inferRoleFromSubject(subject) {
  const text = String(subject || "");
  const direct = text.match(/for\s+(.+?)(?:\sat\s|\swith\s|$)/i);
  if (direct?.[1]) {
    return direct[1].trim();
  }

  const quoted = text.match(/["'“”]([^"'“”]{3,80})["'“”]/);
  if (quoted?.[1]) {
    return quoted[1].trim();
  }

  return "Unknown Role";
}

function buildHeuristicJobData(email) {
  const parsedDate = Date.parse(email?.date || "");
  const appliedDate = Number.isNaN(parsedDate)
    ? new Date().toISOString().split("T")[0]
    : new Date(parsedDate).toISOString().split("T")[0];

  return {
    company: inferCompanyFromFromHeader(email?.from),
    role: inferRoleFromSubject(email?.subject),
    appliedDate,
    status: inferStatusFromText(email?.subject, email?.body),
    roundNumber: null,
    roundType: null,
    interviewDate: null,
    jobUrl: null,
    notes: "Heuristic fallback (AI temporarily unavailable)",
    isUpdate: false
  };
}

async function catchUpMissedEmails(options = {}) {
  const forceRecentHours = Number(options.forceRecentHours || 0);

  if (syncInProgress) {
    return;
  }

  syncInProgress = true;
  const runStartedAt = Date.now();
  const heartbeatTimer = setInterval(() => {
    chrome.storage.local.set({ syncHeartbeatAt: Date.now() }).catch(() => {});
  }, 15000);

  await chrome.storage.local.set({
    syncInProgress: true,
    lastAttemptAt: runStartedAt,
    syncHeartbeatAt: runStartedAt,
    lastRunState: "running"
  });
  await appendSyncLog("info", "Sync started", { forceRecentHours });

  try {
    const { sheetId, aiApiKey, aiProvider, lastHistoryId, aiCooldownUntil, firstSyncWindowDays } =
      await chrome.storage.local.get(["sheetId", "aiApiKey", "aiProvider", "lastHistoryId", "aiCooldownUntil", "firstSyncWindowDays"]);

    const counters = await chrome.storage.local.get(["statTotal", "statInterviews", "statOffers"]);
    let statTotal = Number(counters.statTotal || 0);
    let statInterviews = Number(counters.statInterviews || 0);
    let statOffers = Number(counters.statOffers || 0);

    if (!sheetId || !aiApiKey || !aiProvider) {
      console.log("Extension not set up yet - skipping sync");
      await chrome.storage.local.set({
        lastRunState: "not_configured",
        lastError: "Extension setup is incomplete.",
        lastFetchedCount: 0,
        lastFilteredOutCount: 0,
        lastProcessedCount: 0
      });
      await appendSyncLog("warn", "Sync skipped: setup incomplete");
      return;
    }

    const cooldownUntil = Number(aiCooldownUntil || 0);
    if (Date.now() < cooldownUntil) {
      const remainingMins = Math.max(1, Math.ceil((cooldownUntil - Date.now()) / 60000));
      await chrome.storage.local.set({
        lastRunState: "cooldown",
        lastError: `AI rate-limited. Retrying automatically in ~${remainingMins}m.`,
        lastFetchedCount: 0,
        lastFilteredOutCount: 0,
        lastProcessedCount: 0
      });
      await appendSyncLog("warn", "Sync skipped: AI cooldown active", { cooldownUntil });
      return;
    }

    const accessToken = await getValidToken();
    await chrome.storage.local.set({
      syncProgress: {
        stage: "fetching",
        current: 0,
        total: 0,
        processed: 0,
        filtered: 0,
        failed: 0
      }
    });

    const { emails: missedEmails, latestHistoryId, syncSource } = await getMissedEmails(accessToken, lastHistoryId, {
      firstSyncWindowDays
    });
    const recentEmails = forceRecentHours > 0
      ? await getRecentEmails(accessToken, forceRecentHours, 250)
      : [];
    const emails = mergeUniqueEmails(missedEmails, recentEmails);
    let rateLimitHits = 0;
    let failedEmailCount = 0;
    let processedCount = 0;
    let filteredOutCount = 0;
    let progressUpdatedAt = 0;
    const sampleFailures = [];

    console.log(`Checking ${emails.length} new emails since last sync`);

    for (let i = 0; i < emails.length; i += 1) {
      const email = emails[i];
      try {
        const filterResult = await shouldProcessEmail(email, aiApiKey, aiProvider);
        if (!filterResult.process) {
          filteredOutCount += 1;
          continue;
        }

        const jobData = await parseJobEmail(email.subject, email.body, aiApiKey, aiProvider);
        if (!jobData || !jobData.company) {
          continue;
        }

        await processAndUpdateSheet(jobData, sheetId, accessToken);
        console.log(`Processed: ${jobData.company} - ${jobData.role} - ${jobData.status}`);

        statTotal += 1;
        processedCount += 1;
        const status = (jobData.status || "").toLowerCase();
        if (status.includes("interview") || status.includes("phone") || status.includes("final")) {
          statInterviews += 1;
        }
        if (status.includes("offer")) {
          statOffers += 1;
        }
      } catch (emailError) {
        if (isRateLimitError(emailError)) {
          rateLimitHits += 1;

          const retryAfterMs = extractRetryAfterMs(emailError);
          const cooldownMs = clampCooldownMs(retryAfterMs || 60 * 1000);
          await chrome.storage.local.set({
            aiCooldownUntil: Date.now() + cooldownMs
          });

          // Manual forced-recent sync should still write likely job emails even when AI is rate-limited.
          if (forceRecentHours > 0 && looksJobRelatedHeuristic(email)) {
            try {
              const heuristicData = buildHeuristicJobData(email);
              await processAndUpdateSheet(heuristicData, sheetId, accessToken);
              processedCount += 1;
              statTotal += 1;
            } catch (fallbackError) {
              failedEmailCount += 1;
              if (sampleFailures.length < 3) {
                sampleFailures.push({
                  id: email?.id || "unknown",
                  message: String(fallbackError?.message || "Heuristic fallback failed")
                });
              }
            }
          }

          continue;
        }

        failedEmailCount += 1;
        if (sampleFailures.length < 3) {
          sampleFailures.push({
            id: email?.id || "unknown",
            message: String(emailError?.message || "Unknown email processing error")
          });
        }
      }

      if (Date.now() - progressUpdatedAt >= 1500) {
        progressUpdatedAt = Date.now();
        await chrome.storage.local.set({
          syncProgress: {
            stage: "processing",
            current: i + 1,
            total: emails.length,
            processed: processedCount,
            filtered: filteredOutCount,
            failed: failedEmailCount
          }
        });
      }
    }

    if (failedEmailCount > 0) {
      console.warn("Email processing skipped some items", {
        failedEmailCount,
        sampleFailures
      });
    }

    await chrome.storage.local.set({
      lastAttemptAt: runStartedAt,
      lastSyncAt: runStartedAt,
      lastSuccessAt: processedCount > 0 ? runStartedAt : (await chrome.storage.local.get(["lastSuccessAt"])).lastSuccessAt,
      lastRunState: processedCount > 0
        ? "success_written"
        : (emails.length === 0 ? "no_matches" : "no_writes"),
      lastError: rateLimitHits > 0
        ? `AI rate limit hit on ${rateLimitHits} email(s).`
        : (failedEmailCount > 0 ? `Skipped ${failedEmailCount} email(s) due to parse/provider errors.` : null),
      aiCooldownUntil: rateLimitHits > 0 ? (await chrome.storage.local.get(["aiCooldownUntil"])).aiCooldownUntil : 0,
      lastFetchedCount: emails.length,
      lastFilteredOutCount: filteredOutCount,
      lastProcessedCount: processedCount,
      lastSyncSource: syncSource || "unknown",
      lastHistoryId: latestHistoryId || lastHistoryId || null,
      syncProgress: {
        stage: "done",
        current: emails.length,
        total: emails.length,
        processed: processedCount,
        filtered: filteredOutCount,
        failed: failedEmailCount
      },
      statTotal,
      statInterviews,
      statOffers
    });

    await appendSyncLog("info", "Sync finished", {
      source: syncSource || "unknown",
      fetched: emails.length,
      written: processedCount,
      filtered: filteredOutCount,
      failed: failedEmailCount,
      rateLimited: rateLimitHits
    });
  } catch (error) {
    if (isRateLimitError(error)) {
      const retryAfterMs = extractRetryAfterMs(error);
      const cooldownMs = clampCooldownMs(retryAfterMs || 60 * 1000);
      await chrome.storage.local.set({
        aiCooldownUntil: Date.now() + cooldownMs
      });

      console.warn("catchUpMissedEmails warning:", error?.message || "AI rate-limited");
      await chrome.storage.local.set({
        lastRunState: "rate_limited",
        lastError: "AI rate-limited. Retrying automatically soon.",
        lastErrorTime: Date.now(),
        syncProgress: {
          stage: "rate_limited",
          current: 0,
          total: 0,
          processed: 0,
          filtered: 0,
          failed: 0
        }
      });
      await appendSyncLog("warn", "Sync rate-limited", { message: error?.message || "rate-limited" });
    } else {
      console.error("catchUpMissedEmails error:", error);
      await chrome.storage.local.set({
        lastRunState: "failed",
        lastError: error?.message || "Unknown sync error",
        lastErrorTime: Date.now(),
        syncProgress: {
          stage: "failed",
          current: 0,
          total: 0,
          processed: 0,
          filtered: 0,
          failed: 1
        }
      });
      await appendSyncLog("error", "Sync failed", { message: error?.message || "Unknown sync error" });
    }
  } finally {
    clearInterval(heartbeatTimer);
    syncInProgress = false;
    await chrome.storage.local.set({ syncInProgress: false, syncHeartbeatAt: 0, lastRunFinishedAt: Date.now() });
  }
}

recoverStaleSyncState().catch(() => {});

chrome.runtime.onStartup.addListener(() => {
  console.log("Chrome started - catching up on missed emails");
  catchUpMissedEmails();
});

chrome.runtime.onInstalled.addListener((details) => {
  setupPolling();
  if (details.reason === "update") {
    catchUpMissedEmails();
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    catchUpMissedEmails();
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "pollGmail") {
    catchUpMissedEmails();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) {
    return;
  }

  if (message?.type === "SYNC_NOW") {
    (async () => {
      const running = await isSyncCurrentlyRunning();
      if (running) {
        sendResponse({ ok: true, inProgress: true, message: "Sync already running" });
        return;
      }

      await catchUpMissedEmails({ forceRecentHours: 4 });
      sendResponse({ ok: true, inProgress: false });
    })().catch((error) => sendResponse({ ok: false, error: error?.message || "Sync failed" }));
    return true;
  }

  if (message?.type === "RESET_STALE_SYNC") {
    syncInProgress = false;
    chrome.storage.local
      .set({ syncInProgress: false, syncHeartbeatAt: 0, lastRunState: "idle" })
      .then(() => appendSyncLog("warn", "Manual stale-sync reset from popup"))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Reset failed" }));
    return true;
  }

  if (message?.type === "SYNC_INITIAL") {
    (async () => {
      const running = await isSyncCurrentlyRunning();
      if (running) {
        sendResponse({ ok: true, inProgress: true, message: "Sync already running" });
        return;
      }

      await catchUpMissedEmails({ forceRecentHours: 0 });
      sendResponse({ ok: true, inProgress: false });
    })().catch((error) => sendResponse({ ok: false, error: error?.message || "Sync failed" }));
    return true;
  }

  if (message?.type === "GET_STATUS") {
    chrome.storage.local
      .get(["sheetId", "aiProvider", "lastSyncAt", "lastError", "lastErrorTime"])
      .then((state) => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Status failed" }));
    return true;
  }

  if (message?.type === "OPEN_SHEET") {
    chrome.storage.local
      .get(["sheetId"])
      .then(({ sheetId }) => {
        if (!sheetId) {
          sendResponse({ ok: false, error: "No sheet configured" });
          return;
        }

        chrome.tabs.create({ url: `https://docs.google.com/spreadsheets/d/${sheetId}` });
        sendResponse({ ok: true });
      })
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Open sheet failed" }));
    return true;
  }

  return false;
});
