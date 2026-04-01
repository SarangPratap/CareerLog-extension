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
  if (msg.type === 'VERIFY_CUSTOM_PROVIDER') {
    verifyCustomProviderInBackground(msg.payload || {})
      .then(function(result) { sendResponse({ success: true, result: result }); })
      .catch(function(e) { sendResponse({ success: false, error: e.message }); });
    return true;
  }

  if (msg.type === 'START_INITIAL_SYNC') {
    runInitialSync(msg.dateRange)
      .then(function()    { sendResponse({ success: true }); })
      .catch(function(e)  { sendResponse({ success: false, error: e.message }); });
    return true; // async response
  }

  if (msg.type === 'SYNC_NOW') {
    catchUpMissedEmailsInternal(true)
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
  var normalizedDateRange = (dateRange === 'last15') ? 'last15' : 'last30';
  await chrome.storage.local.set({ syncInProgress: true, syncProgress: 0, totalProcessed: 0 });

  try {
    var stored = await storageGet([
      'sheetId','aiApiKey','aiProvider',
      'customApiBaseUrl','customModel','accountSheetMap','currentGoogleEmail'
    ]);
    if (!stored.aiProvider) {
      throw new Error('Setup incomplete: AI provider is missing. Complete onboarding Step 1 and select a provider.');
    }
    if (providerNeedsApiKey(stored.aiProvider) && !stored.aiApiKey) {
      throw new Error('Setup incomplete: selected provider requires an API key.');
    }
    if (stored.aiProvider === 'custom' && (!stored.customApiBaseUrl || !stored.customModel)) {
      throw new Error('Setup incomplete: custom provider requires API base URL and model in Settings.');
    }

    var accessToken    = await getValidToken({ interactive: false });
    var sheetBinding   = await ensureAccountSheetBinding(stored, accessToken);
    var emails         = await fetchInitialEmails(accessToken, normalizedDateRange);

    console.log('[Careerlog] Initial sync — found ' + emails.length + ' candidate emails');

    var processed = 0;
    for (var i = 0; i < emails.length; i++) {
      var email      = emails[i];
      var filterResult = await shouldProcessEmail(email, stored.aiApiKey, stored.aiProvider);
      if (!filterResult.process) continue;

      var jobData = await parseJobEmail(email.subject, email.body, stored.aiApiKey, stored.aiProvider);
      if (!jobData) continue;
      jobData.sourceEmailDate = email.date || '';

      await processAndUpdateSheet(jobData, sheetBinding.sheetId, accessToken);
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
  return await catchUpMissedEmailsInternal(false);
}

async function catchUpMissedEmailsInternal(isManualSync) {
  var stored;
  try {
    stored = await storageGet([
      'sheetId','aiApiKey','aiProvider',
      'lastHistoryId','initialSyncDone','syncInProgress',
      'customApiBaseUrl','customModel','accountSheetMap','currentGoogleEmail'
    ]);

    if (!stored.aiProvider) {
      if (isManualSync) throw new Error('Setup incomplete: please complete onboarding and create/select a sheet first.');
      return;
    }

    if (providerNeedsApiKey(stored.aiProvider) && !stored.aiApiKey) {
      if (isManualSync) throw new Error('Sync blocked: API key is missing. Add your key in Settings.');
      return;
    }

    if (stored.aiProvider === 'custom' && (!stored.customApiBaseUrl || !stored.customModel)) {
      if (isManualSync) throw new Error('Sync blocked: custom provider requires API base URL and model in Settings.');
      return;
    }

    if (!stored.initialSyncDone) {
      if (isManualSync) {
        // If user manually triggers sync from dashboard/settings, bootstrap setup by
        // running a first-pass sync instead of hard-failing on missing setup flag.
        await runInitialSync('last30');
        return;
      }
      return;
    }
    if (stored.syncInProgress) {
      if (isManualSync) throw new Error('Sync is already in progress.');
      return;
    }

    var accessToken = await getValidToken({ interactive: false });
    var sheetBinding = await ensureAccountSheetBinding(stored, accessToken);
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
      jobData.sourceEmailDate = email.date || '';

      await processAndUpdateSheet(jobData, sheetBinding.sheetId, accessToken);
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
    if (isManualSync) throw err;
  }
}

// ─── UTIL ─────────────────────────────────────────────────────────────

function storageGet(keys) {
  return new Promise(function(resolve) {
    chrome.storage.local.get(keys, resolve);
  });
}

function providerNeedsApiKey(provider) {
  return provider === 'gemini' || provider === 'claude' || provider === 'openai';
}

function getCustomCompletionsUrl(baseUrl) {
  var cleaned = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(cleaned)) {
    return cleaned;
  }
  if (/\/v\d+(\/.*)?$/i.test(cleaned)) {
    return cleaned + '/chat/completions';
  }
  return cleaned + '/v1/chat/completions';
}

function getOllamaChatUrl(baseUrl) {
  var cleaned = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (/\/api\/chat$/i.test(cleaned)) {
    return cleaned;
  }
  return cleaned + '/api/chat';
}

function getOllamaGenerateUrl(baseUrl) {
  var cleaned = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (/\/api\/generate$/i.test(cleaned)) {
    return cleaned;
  }
  return cleaned + '/api/generate';
}

function isAllowedCustomBaseUrl(baseUrl) {
  var parsed;
  try {
    parsed = new URL(baseUrl);
  } catch (e) {
    return false;
  }

  if (parsed.protocol === 'https:') return true;
  if (parsed.protocol !== 'http:') return false;

  var host = (parsed.hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function isLikelyOllamaBaseUrl(baseUrl) {
  var parsed;
  try {
    parsed = new URL(baseUrl);
  } catch (e) {
    return false;
  }

  var host = (parsed.hostname || '').toLowerCase();
  var port = String(parsed.port || '');
  var path = (parsed.pathname || '').toLowerCase();
  var isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';

  if (!isLocal) return false;
  if (port === '11434') return true;
  if (path.indexOf('/api/chat') !== -1 || path.indexOf('/api/generate') !== -1) return true;
  return false;
}

async function verifyCustomProviderInBackground(payload) {
  var baseUrl = (payload.baseUrl || '').trim();
  var model = (payload.model || '').trim();
  var apiType = payload.apiType || 'openai';
  if (apiType !== 'ollama' && isLikelyOllamaBaseUrl(baseUrl)) {
    apiType = 'ollama';
  }
  var apiKey = (payload.apiKey || '').trim();

  if (!baseUrl || !model) {
    throw new Error('Custom verification needs API base URL and model.');
  }
  if (!isAllowedCustomBaseUrl(baseUrl)) {
    throw new Error('Custom API base URL must be https://, or http://localhost/127.0.0.1 for local models.');
  }

  var endpoint = '';
  var res;
  try {
    if (apiType === 'ollama') {
      endpoint = getOllamaChatUrl(baseUrl);
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model,
          stream: false,
          messages: [{ role: 'user', content: 'Reply with OK only.' }]
        })
      });

      // Some local runtimes only expose /api/generate.
      if (!res.ok && (res.status === 404 || res.status === 405)) {
        endpoint = getOllamaGenerateUrl(baseUrl);
        res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: model,
            stream: false,
            prompt: 'Reply with OK only.'
          })
        });
      }
    } else {
      endpoint = getCustomCompletionsUrl(baseUrl);
      var headers = {
        'Content-Type': 'application/json'
      };
      if (apiKey) {
        headers.Authorization = 'Bearer ' + apiKey;
      }
      res = await fetch(endpoint, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          model: model,
          max_tokens: 8,
          temperature: 0,
          messages: [{ role: 'user', content: 'Reply with OK only.' }]
        })
      });
    }
  } catch (e) {
    throw new Error('Custom API network failure at ' + endpoint + ': ' + (e && e.message ? e.message : 'Unknown fetch error'));
  }

  if (!res.ok) {
    var rawBody = await res.text().catch(function() { return ''; });
    var err = {};
    if (rawBody) {
      try {
        err = JSON.parse(rawBody);
      } catch (e) {
        err = {};
      }
    }

    var msg = (err.error && err.error.message) || err.error || err.message || rawBody || ('HTTP ' + res.status);
    if (typeof msg === 'string' && msg.length > 280) {
      msg = msg.slice(0, 280) + '...';
    }

    var allowOrigin = res.headers.get('access-control-allow-origin') || 'missing';
    throw new Error(
      'Custom API verification failed (' + res.status + ' ' + res.statusText + ') at ' + endpoint +
      '. allow-origin=' + allowOrigin + '. Details: ' + msg
    );
  }

  var data = await res.json();
  if (apiType === 'ollama') {
    var hasResponse = data && ((data.message && data.message.content) || data.response);
    if (!hasResponse) {
      throw new Error('Custom API responded, but response format is not Ollama-compatible (/api/chat).');
    }
  } else {
    var hasChoice = data && data.choices && data.choices.length > 0;
    if (!hasChoice) {
      throw new Error('Custom API responded, but response format is not OpenAI-compatible chat completions.');
    }
  }

  return { endpoint: endpoint };
}

async function getGoogleEmailFromToken(accessToken) {
  var res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { 'Authorization': 'Bearer ' + accessToken }
  });
  if (!res.ok) {
    throw new Error('Unable to read signed-in Google account profile (' + res.status + ').');
  }
  var data = await res.json();
  if (!data || !data.emailAddress) {
    throw new Error('Unable to determine signed-in Google account email.');
  }
  return data.emailAddress;
}

async function ensureAccountSheetBinding(stored, accessToken) {
  var email = await getGoogleEmailFromToken(accessToken);
  var currentEmail = stored.currentGoogleEmail || '';
  var currentSheetId = stored.sheetId || '';
  var map = stored.accountSheetMap || {};

  // Persist previous active account->sheet relation before switching accounts.
  if (currentEmail && currentSheetId && !map[currentEmail]) {
    map[currentEmail] = currentSheetId;
  }

  if (currentEmail === email && currentSheetId) {
    if (!map[email]) {
      map[email] = currentSheetId;
      await chrome.storage.local.set({ accountSheetMap: map });
    }
    return { email: email, sheetId: currentSheetId, created: false };
  }

  if (map[email]) {
    await chrome.storage.local.set({
      sheetId: map[email],
      currentGoogleEmail: email,
      accountSheetMap: map,
      lastError: null
    });
    return { email: email, sheetId: map[email], created: false };
  }

  // First time on this account: create its default sheet.
  var newSheetId = await createJobTrackerSheet(accessToken);
  map[email] = newSheetId;
  await chrome.storage.local.set({
    sheetId: newSheetId,
    currentGoogleEmail: email,
    accountSheetMap: map,
    lastHistoryId: null,
    initialSyncDone: false,
    lastError: null
  });
  return { email: email, sheetId: newSheetId, created: true };
}
