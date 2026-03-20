// background.js — Careerlog Service Worker
// Uses importScripts (NOT import) for Manifest V3 compatibility.

importScripts(
  'lib/auth.js',
  'lib/gmail.js',
  'lib/filter.js',
  'lib/ai.js',
  'lib/sheets.js'
);

// ─── WAKE UP TRIGGERS ────────────────────────────────────────────────

chrome.runtime.onStartup.addListener(function() {
  console.log('[Careerlog] Chrome started — running catch-up poll');
  catchUpMissedEmails();
});

chrome.runtime.onInstalled.addListener(function(details) {
  setupPolling();
  if (details.reason === 'update') {
    catchUpMissedEmails();
  }
  // Fresh install: do nothing — wait for user to complete onboarding
});

chrome.windows.onFocusChanged.addListener(function(windowId) {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    catchUpMissedEmails();
  }
});

// ─── POLLING ─────────────────────────────────────────────────────────

function setupPolling() {
  chrome.alarms.create('pollGmail', { periodInMinutes: 5 });
}

chrome.alarms.onAlarm.addListener(function(alarm) {
  if (alarm.name === 'pollGmail') {
    catchUpMissedEmails();
  }
});

// ─── MESSAGE HANDLER ─────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.type === 'START_INITIAL_SYNC') {
    runInitialSync(msg.dateRange)
      .then(function()    { sendResponse({ success: true }); })
      .catch(function(e)  { sendResponse({ success: false, error: e.message }); });
    return true; // async response
  }

  if (msg.type === 'SYNC_NOW') {
    catchUpMissedEmails()
      .then(function()    { sendResponse({ success: true }); })
      .catch(function(e)  { sendResponse({ success: false, error: e.message }); });
    return true;
  }

  if (msg.type === 'GET_STATUS') {
    chrome.storage.local.get(
      ['lastSyncTime','lastError','syncInProgress','syncProgress','totalProcessed','initialSyncDone','sheetId','aiProvider'],
      function(data) { sendResponse(data); }
    );
    return true;
  }

  if (msg.type === 'OPEN_DASHBOARD') {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
    sendResponse({ success: true });
    return true;
  }
});

// ─── INITIAL SYNC ─────────────────────────────────────────────────────
// Called once from onboarding after user picks date range.

async function runInitialSync(dateRange) {
  await chrome.storage.local.set({ syncInProgress: true, syncProgress: 0, totalProcessed: 0 });

  try {
    var stored = await storageGet(['sheetId','aiApiKey','aiProvider']);
    if (!stored.sheetId || !stored.aiApiKey || !stored.aiProvider) {
      throw new Error('Setup incomplete');
    }

    var accessToken    = await getValidToken();
    var emails         = await fetchInitialEmails(accessToken, dateRange);

    console.log('[Careerlog] Initial sync — found ' + emails.length + ' candidate emails');

    var processed = 0;
    for (var i = 0; i < emails.length; i++) {
      var email      = emails[i];
      var filterResult = await shouldProcessEmail(email, stored.aiApiKey, stored.aiProvider);
      if (!filterResult.process) continue;

      var jobData = await parseJobEmail(email.subject, email.body, stored.aiApiKey, stored.aiProvider);
      if (!jobData) continue;

      await processAndUpdateSheet(jobData, stored.sheetId, accessToken);
      processed++;

      var pct = Math.round(((i + 1) / emails.length) * 100);
      await chrome.storage.local.set({ syncProgress: pct, totalProcessed: processed });
    }

    // Save historyId AFTER sync so ongoing polling starts from now
    var historyId = await getLatestHistoryId(accessToken);

    await chrome.storage.local.set({
      lastHistoryId:    historyId,
      lastSyncTime:     Date.now(),
      syncInProgress:   false,
      syncProgress:     100,
      totalProcessed:   processed,
      initialSyncDone:  true,
      lastError:        null
    });

    console.log('[Careerlog] Initial sync complete — ' + processed + ' applications');

  } catch (err) {
    console.error('[Careerlog] Initial sync failed:', err);
    await chrome.storage.local.set({
      syncInProgress: false,
      lastError:      err.message,
      lastErrorTime:  Date.now()
    });
    throw err;
  }
}

// ─── ONGOING CATCH-UP ─────────────────────────────────────────────────
// Runs every 5 min and on Chrome wake-up. Uses historyId.

async function catchUpMissedEmails() {
  try {
    var stored = await storageGet([
      'sheetId','aiApiKey','aiProvider',
      'lastHistoryId','initialSyncDone','syncInProgress'
    ]);

    if (!stored.sheetId || !stored.aiApiKey || !stored.aiProvider) return;
    if (!stored.initialSyncDone) return;
    if (stored.syncInProgress)   return;

    var accessToken = await getValidToken();
    var result      = await getMissedEmails(accessToken, stored.lastHistoryId);

    if (!result.emails || result.emails.length === 0) {
      await chrome.storage.local.set({ lastSyncTime: Date.now() });
      return;
    }

    console.log('[Careerlog] Poll: checking ' + result.emails.length + ' emails');

    var processed = 0;
    for (var i = 0; i < result.emails.length; i++) {
      var email = result.emails[i];
      var filterResult = await shouldProcessEmail(email, stored.aiApiKey, stored.aiProvider);
      if (!filterResult.process) continue;

      var jobData = await parseJobEmail(email.subject, email.body, stored.aiApiKey, stored.aiProvider);
      if (!jobData) continue;

      await processAndUpdateSheet(jobData, stored.sheetId, accessToken);
      processed++;
      console.log('[Careerlog] ✅ ' + jobData.company + ' — ' + jobData.role + ' — ' + jobData.status);
    }

    await chrome.storage.local.set({
      lastHistoryId: result.latestHistoryId,
      lastSyncTime:  Date.now(),
      lastError:     null
    });

    if (processed > 0) {
      console.log('[Careerlog] Catch-up done — ' + processed + ' new entries');
    }

  } catch (err) {
    console.error('[Careerlog] catchUpMissedEmails error:', err);
    await chrome.storage.local.set({
      lastError:     err.message,
      lastErrorTime: Date.now()
    });
  }
}

// ─── UTIL ─────────────────────────────────────────────────────────────

function storageGet(keys) {
  return new Promise(function(resolve) {
    chrome.storage.local.get(keys, resolve);
  });
}
