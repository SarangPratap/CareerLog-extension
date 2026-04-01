// onboarding/onboarding.js

var currentStep = 1;
var selectedProvider = 'gemini';
var apiKeyVerified = false;
var googleAuthed = false;
var sheetCreated = false;
var spreadsheetId = null;
var onboardingRedirectDone = false;

function openDashboardAfterSetup() {
  if (onboardingRedirectDone) return;
  onboardingRedirectDone = true;
  setTimeout(function() {
    window.location.href = chrome.runtime.getURL('dashboard/dashboard.html');
  }, 700);
}

var PROVIDER_HINTS = {
  gemini: { placeholder: 'AIzaSy···············', hint: 'Get a free key at aistudio.google.com', link: 'https://aistudio.google.com/app/apikey' },
  claude: { placeholder: 'sk-ant-api03-···············', hint: 'Get a key at console.anthropic.com', link: 'https://console.anthropic.com/keys' },
  openai: { placeholder: 'sk-proj-···············', hint: 'Get a key at platform.openai.com', link: 'https://platform.openai.com/api-keys' },
  custom: { placeholder: 'Optional for custom/local endpoints', hint: 'Use custom API base URL and model below', link: '#' }
};

var keyInput = document.getElementById('api-key-input');
var customConfigEl = document.getElementById('custom-config');
var customApiTypeInputEl = document.getElementById('custom-api-type-input');
var customApiBaseInputEl = document.getElementById('custom-api-base-input');
var customModelInputEl = document.getElementById('custom-model-input');
var verifyCustomBtnEl = document.getElementById('verify-custom-btn');
var verifyCustomStatusEl = document.getElementById('verify-custom-status');

function goToStep(n) {
  currentStep = n;
  [1, 2, 3, 4].forEach(function(i) {
    var card = document.getElementById('card' + i);
    card.classList.remove('active', 'done');
    if (i < n) card.classList.add('done');
    if (i === n) card.classList.add('active');

    var sc = document.getElementById('sc' + i);
    if (!sc) return;
    sc.className = 'step-circle ' + (i < n ? 'step-done' : i === n ? 'step-active' : 'step-todo');
    if (i < n) {
      sc.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6l2.5 2.5 4.5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    } else {
      sc.textContent = i;
    }

    if (i < 4) {
      var line = document.getElementById('sl' + i);
      if (line) line.className = 'step-line' + (i < n ? ' done' : '');
    }
  });
}

function showError(id, msg) {
  var el = document.getElementById(id);
  if (el) {
    el.textContent = msg;
    el.style.display = 'block';
  }
}

function hideError(id) {
  var el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

function storageSetAsync(values) {
  return new Promise(function(resolve) {
    chrome.storage.local.set(values, function() { resolve(); });
  });
}

function storageGetAsync(keys) {
  return new Promise(function(resolve) {
    chrome.storage.local.get(keys, function(data) { resolve(data || {}); });
  });
}

function setCustomVerifyStatus(message, isError) {
  verifyCustomStatusEl.textContent = message || '';
  verifyCustomStatusEl.classList.toggle('err', !!isError);
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
  var path = String(parsed.pathname || '').toLowerCase();
  var isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';

  if (!isLocal) return false;
  if (port === '11434') return true;
  return path.indexOf('/api/chat') !== -1 || path.indexOf('/api/generate') !== -1;
}

async function verifyCustomProviderConfig() {
  var baseUrl = customApiBaseInputEl.value.trim();
  var model = customModelInputEl.value.trim();
  var apiType = customApiTypeInputEl.value || 'openai';
  var apiKey = keyInput.value.trim();

  if (!baseUrl || !model) {
    throw new Error('Custom verification needs API base URL and model.');
  }
  if (!isAllowedCustomBaseUrl(baseUrl)) {
    throw new Error('Custom API base URL must be https://, or http://localhost/127.0.0.1 for local models.');
  }

  var response = await chrome.runtime.sendMessage({
    type: 'VERIFY_CUSTOM_PROVIDER',
    payload: {
      baseUrl: baseUrl,
      model: model,
      apiType: apiType,
      apiKey: apiKey
    }
  });

  if (!response || !response.success) {
    throw new Error((response && response.error) || 'Custom API verification failed.');
  }
}

async function saveCustomProviderConfig() {
  var baseUrl = customApiBaseInputEl.value.trim();
  var model = customModelInputEl.value.trim();
  var selectedType = customApiTypeInputEl.value || 'openai';
  var effectiveType = selectedType !== 'ollama' && isLikelyOllamaBaseUrl(baseUrl)
    ? 'ollama'
    : selectedType;

  await storageSetAsync({
    aiProvider: 'custom',
    customApiBaseUrl: baseUrl,
    customModel: model,
    customApiType: effectiveType,
    aiApiKey: keyInput.value.trim()
  });

  customApiTypeInputEl.value = effectiveType;
}

function updateStep2Hints() {
  var hints = PROVIDER_HINTS[selectedProvider] || PROVIDER_HINTS.gemini;
  keyInput.placeholder = hints.placeholder;
  customConfigEl.classList.toggle('on', selectedProvider === 'custom');

  if (selectedProvider === 'custom') {
    document.getElementById('step2-hint').textContent = 'Provide base URL and model here. API key is optional for local runtimes.';
    updateStep2ActionState();
    return;
  }

  document.getElementById('step2-hint').innerHTML =
    'Get a free key at <a href="' + hints.link + '" target="_blank">' + hints.hint.split(' at ')[1] + '</a>';
  setCustomVerifyStatus('', false);
  updateStep2ActionState();
}

function updateStep2ActionState() {
  var val = keyInput.value.trim();
  var btn = document.getElementById('btn-step2');
  btn.disabled = false;

  if (selectedProvider === 'custom') {
    btn.textContent = 'Save custom provider →';
    return;
  }

  btn.textContent = val.length >= 10 ? 'Verify key →' : 'Skip for now →';
}

// Step 1

document.querySelectorAll('.provider-card').forEach(function(card) {
  card.addEventListener('click', function() {
    document.querySelectorAll('.provider-card').forEach(function(c) { c.classList.remove('sel'); });
    card.classList.add('sel');
    selectedProvider = card.getAttribute('data-provider');
    updateStep2Hints();
  });
});

document.getElementById('btn-step1').addEventListener('click', function() {
  chrome.storage.local.set({ aiProvider: selectedProvider });
  goToStep(2);
  document.getElementById('badge2').style.display = 'none';
  document.getElementById('card2').classList.remove('done');
  updateStep2Hints();
});

// Step 2

keyInput.addEventListener('input', function() {
  updateStep2ActionState();
  hideError('err2');
});

customApiBaseInputEl.addEventListener('input', function() { hideError('err2'); setCustomVerifyStatus('', false); });
customModelInputEl.addEventListener('input', function() { hideError('err2'); setCustomVerifyStatus('', false); });
customApiTypeInputEl.addEventListener('change', function() { setCustomVerifyStatus('', false); });

document.getElementById('show-key-btn').addEventListener('click', function() {
  var inp = document.getElementById('api-key-input');
  var btn = document.getElementById('show-key-btn');
  if (inp.type === 'password') {
    inp.type = 'text';
    btn.textContent = 'Hide';
  } else {
    inp.type = 'password';
    btn.textContent = 'Show';
  }
});

verifyCustomBtnEl.addEventListener('click', async function() {
  verifyCustomBtnEl.disabled = true;
  setCustomVerifyStatus('Verifying custom API...', false);
  try {
    await verifyCustomProviderConfig();
    await saveCustomProviderConfig();
    setCustomVerifyStatus('Custom API verified and saved.', false);
  } catch (e) {
    setCustomVerifyStatus(e && e.message ? e.message : 'Custom API verification failed.', true);
  } finally {
    verifyCustomBtnEl.disabled = false;
  }
});

document.getElementById('btn-step2').addEventListener('click', async function() {
  var btn = document.getElementById('btn-step2');
  var key = keyInput.value.trim();
  hideError('err2');

  await storageSetAsync({ aiProvider: selectedProvider });

  if (selectedProvider === 'custom') {
    try {
      btn.disabled = true;
      btn.textContent = 'Verifying…';
      setCustomVerifyStatus('Verifying custom API...', false);
      await verifyCustomProviderConfig();
      await saveCustomProviderConfig();
      setCustomVerifyStatus('Custom API verified and saved.', false);
      document.getElementById('badge2').style.display = 'flex';
      goToStep(3);
      return;
    } catch (e) {
      setCustomVerifyStatus(e && e.message ? e.message : 'Custom API verification failed.', true);
      showError('err2', 'Cannot continue: verify custom API base URL/model first.');
      btn.disabled = false;
      btn.textContent = 'Save custom provider →';
      return;
    }
  }

  if (!key) {
    await storageSetAsync({ aiApiKey: '' });
    apiKeyVerified = false;
    document.getElementById('badge2').style.display = 'flex';
    goToStep(3);
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Verifying…';

  try {
    await verifyApiKey(key, selectedProvider);
    await storageSetAsync({ aiApiKey: key, aiProvider: selectedProvider });
    apiKeyVerified = true;
    document.getElementById('badge2').style.display = 'flex';
    goToStep(3);
  } catch (e) {
    var msg = String((e && e.message) || 'Unknown verification error');
    var quota = msg.toLowerCase().indexOf('quota exceeded') !== -1 || msg.toLowerCase().indexOf('resource_exhausted') !== -1;
    if (quota) {
      if (selectedProvider === 'gemini') {
        showError('err2', 'Gemini quota exceeded for this key/project. Enable billing in Google AI Studio/Cloud, wait for quota reset, or switch provider (OpenAI/Claude).');
      } else if (selectedProvider === 'openai') {
        showError('err2', 'OpenAI quota/rate limit reached for this key or project. Check billing/usage limits, wait for reset, or switch provider.');
      } else if (selectedProvider === 'claude') {
        showError('err2', 'Claude quota/rate limit reached for this key or workspace. Check Anthropic usage/billing, wait for reset, or switch provider.');
      } else {
        showError('err2', 'Provider quota/rate limit reached. Check billing/usage limits or switch provider.');
      }
    } else {
      showError('err2', 'Key verification failed: ' + msg + '. Check your key and try again.');
    }
    btn.disabled = false;
    updateStep2ActionState();
  }
});

async function verifyApiKey(key, provider) {
  var testPrompt = 'Reply with the word "ok" only.';
  if (provider === 'gemini') {
    var modelPaths = [
      'v1/models/gemini-2.0-flash',
      'v1beta/models/gemini-2.0-flash',
      'v1/models/gemini-1.5-flash',
      'v1beta/models/gemini-1.5-flash'
    ];

    var verified = false;
    var lastErr = null;
    for (var i = 0; i < modelPaths.length; i += 1) {
      var res = await fetch('https://generativelanguage.googleapis.com/' + modelPaths[i] + ':generateContent?key=' + key, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: testPrompt }] }] })
      });

      if (res.ok) {
        verified = true;
        break;
      }

      var d = await res.json().catch(function() { return {}; });
      var msg = String((d.error && d.error.message) || '').toLowerCase();
      var quotaExceeded = msg.indexOf('quota exceeded') !== -1 || msg.indexOf('resource_exhausted') !== -1;
      if (quotaExceeded) {
        throw new Error('Gemini quota exceeded for this key/project. Enable billing or use a different provider key.');
      }

      var modelMissing = msg.indexOf('not found') !== -1 || msg.indexOf('api version') !== -1 || msg.indexOf('unsupported') !== -1;
      if (modelMissing) {
        lastErr = d;
        continue;
      }

      throw new Error((d.error && d.error.message) || res.status);
    }

    if (!verified) {
      throw new Error('Gemini model not available for this key/project. Create a new Google AI Studio key or switch provider. ' + JSON.stringify(lastErr || {}));
    }
  } else if (provider === 'claude') {
    var claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 10, messages: [{ role: 'user', content: testPrompt }] })
    });
    if (!claudeRes.ok) {
      var claudeErr = await claudeRes.json();
      throw new Error((claudeErr.error && claudeErr.error.message) || claudeRes.status);
    }
  } else if (provider === 'openai') {
    var openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 5, messages: [{ role: 'user', content: testPrompt }] })
    });
    if (!openaiRes.ok) {
      var openaiErr = await openaiRes.json();
      throw new Error((openaiErr.error && openaiErr.error.message) || openaiRes.status);
    }
  } else if (provider === 'custom') {
    return;
  }
}

// Step 3

function getOAuthClientIdFromManifest() {
  try {
    var oauth2 = (chrome.runtime.getManifest() && chrome.runtime.getManifest().oauth2) || {};
    return oauth2.client_id || '';
  } catch (e) {
    return '';
  }
}

function hasValidOAuthClientId(clientId) {
  return !!clientId &&
    clientId.indexOf('YOUR_') === -1 &&
    clientId.indexOf('{0}') === -1 &&
    clientId.indexOf('apps.googleusercontent.com') !== -1;
}

document.getElementById('btn-google').addEventListener('click', function() {
  hideError('err3');
  var btn = document.getElementById('btn-google');
  var originalLabel = btn.innerHTML;
  btn.disabled = true;
  btn.style.opacity = '0.7';

  var clientId = getOAuthClientIdFromManifest();
  if (!hasValidOAuthClientId(clientId)) {
    showError('err3', 'Google sign-in failed: manifest oauth2.client_id is not set. Add your Chrome Extension OAuth Client ID in manifest.json and reload the extension.');
    btn.disabled = false;
    btn.style.opacity = '1';
    return;
  }

  Promise.resolve().then(function() {
    return signInWithGoogle({ forceAccountChooser: true });
  }).then(function() {
    googleAuthed = true;
    document.getElementById('badge3').style.display = 'flex';
    document.getElementById('btn-step4').disabled = false;
    goToStep(4);
  }).catch(function(err) {
    showError('err3', 'Google sign-in failed: ' + ((err && err.message) || 'unknown error'));
  }).finally(function() {
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.innerHTML = originalLabel;
  });
});

// Step 4

document.querySelectorAll('input[name="dateRange"]').forEach(function(radio) {
  radio.addEventListener('change', function() {
    document.querySelectorAll('.date-opt').forEach(function(o) { o.classList.remove('sel'); });
    radio.closest('.date-opt').classList.add('sel');
  });
});

document.getElementById('btn-step4').addEventListener('click', async function() {
  var btn = document.getElementById('btn-step4');
  btn.disabled = true;
  hideError('err4');

  var setup = await storageGetAsync(['aiProvider', 'customApiBaseUrl', 'customModel']);
  var effectiveProvider = setup.aiProvider || selectedProvider;
  if (!setup.aiProvider && effectiveProvider) {
    await storageSetAsync({ aiProvider: effectiveProvider });
  }
  if (!effectiveProvider) {
    showError('err4', 'Setup incomplete: select an AI provider in Step 1.');
    btn.disabled = false;
    btn.textContent = 'Create sheet & start syncing →';
    return;
  }
  if (effectiveProvider === 'custom' && (!setup.customApiBaseUrl || !setup.customModel)) {
    showError('err4', 'Custom provider needs API base URL and model before syncing.');
    btn.disabled = false;
    btn.textContent = 'Create sheet & start syncing →';
    return;
  }

  var dateRange = 'last30';
  document.querySelectorAll('input[name="dateRange"]').forEach(function(r) {
    if (r.checked) dateRange = r.value;
  });
  if (dateRange !== 'last15' && dateRange !== 'last30') {
    dateRange = 'last30';
  }

  btn.textContent = 'Creating sheet…';
  try {
    chrome.identity.getAuthToken({ interactive: false }, async function(token) {
      try {
        var sheetRes = await createSheetViaAPI(token);
        spreadsheetId = sheetRes;
        await new Promise(function(r) { chrome.storage.local.set({ sheetId: spreadsheetId }, r); });

        var setupState = await new Promise(function(resolve) {
          chrome.storage.local.get(['aiApiKey'], resolve);
        });

        if (!setupState.aiApiKey && effectiveProvider !== 'custom') {
          await new Promise(function(r) {
            chrome.storage.local.set({
              syncInProgress: false,
              syncProgress: 0,
              totalProcessed: 0,
              initialSyncDone: true,
              lastError: null
            }, r);
          });

          document.getElementById('date-options').style.display = 'none';
          document.getElementById('progress-wrap').style.display = 'none';
          document.getElementById('done-wrap').style.display = 'block';
          document.getElementById('done-count').textContent = 0;
          document.querySelector('.done-desc').innerHTML = 'Setup complete. Add your AI API key in Settings to enable automatic parsing.';
          btn.style.display = 'none';
          openDashboardAfterSetup();
          return;
        }

        document.getElementById('date-options').style.display = 'none';
        document.getElementById('progress-wrap').style.display = 'block';
        btn.textContent = 'Syncing…';

        var pollTimer = setInterval(function() {
          chrome.runtime.sendMessage({ type: 'GET_STATUS' }, function(s) {
            if (!s) return;
            var pct = s.syncProgress || 0;
            document.getElementById('prog-fill').style.width = pct + '%';
            document.getElementById('prog-txt').textContent =
              'Parsed ' + (s.totalProcessed || 0) + ' email events… ' + pct + '%';

            if (!s.syncInProgress && s.initialSyncDone) {
              clearInterval(pollTimer);
              document.getElementById('progress-wrap').style.display = 'none';
              document.getElementById('done-wrap').style.display = 'block';
              document.getElementById('done-count').textContent = s.totalProcessed || 0;
              btn.style.display = 'none';
              openDashboardAfterSetup();
            }
          });
        }, 1500);

        chrome.runtime.sendMessage({ type: 'START_INITIAL_SYNC', dateRange: dateRange }, function(resp) {
          if (resp && !resp.success) {
            clearInterval(pollTimer);
            showError('err4', 'Sync failed: ' + ((resp && resp.error) || 'unknown error'));
            btn.disabled = false;
            btn.textContent = 'Try again';
          }
        });
      } catch (e) {
        showError('err4', 'Failed to create sheet: ' + e.message);
        btn.disabled = false;
        btn.textContent = 'Try again';
      }
    });
  } catch (e) {
    showError('err4', e.message);
    btn.disabled = false;
    btn.textContent = 'Try again';
  }
});

document.getElementById('btn-open-sheet').addEventListener('click', function() {
  chrome.storage.local.get(['sheetId'], function(d) {
    if (d.sheetId) {
      chrome.tabs.create({ url: 'https://docs.google.com/spreadsheets/d/' + d.sheetId });
    }
  });
});

async function createSheetViaAPI(token) {
  var now = new Date();
  var year = now.getFullYear();
  var y = String(now.getFullYear());
  var m = String(now.getMonth() + 1).padStart(2, '0');
  var d = String(now.getDate()).padStart(2, '0');
  var hh = String(now.getHours()).padStart(2, '0');
  var mm = String(now.getMinutes()).padStart(2, '0');
  var ss = String(now.getSeconds()).padStart(2, '0');
  var title = 'Careerlog ' + year + ' ' + y + m + d + '-' + hh + mm + ss;

  var res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: { title: title },
      sheets: [
        { properties: { title: 'Applications', sheetId: 0 } },
        { properties: { title: 'Interview Log', sheetId: 1 } }
      ]
    })
  });

  if (!res.ok) {
    var e = await res.json();
    throw new Error(JSON.stringify(e));
  }

  var data = await res.json();
  var sid = data.spreadsheetId;

  await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + sid + '/values/Applications!A1:H1?valueInputOption=RAW', {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [['Company', 'Role', 'Applied Date', 'Current Status', 'Last Updated', 'Total Rounds', 'Job URL', 'Notes']] })
  });

  await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + sid + '/values/Interview%20Log!A1:G1?valueInputOption=RAW', {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [['App ID', 'Company', 'Round #', 'Round Type', 'Interview Date', 'Outcome', 'Notes']] })
  });

  await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + sid + ':batchUpdate', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [
      { repeatCell: { range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } },
      { updateSheetProperties: { properties: { sheetId: 0, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
      { repeatCell: { range: { sheetId: 1, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } },
      { updateSheetProperties: { properties: { sheetId: 1, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } }
    ] })
  });

  return sid;
}

chrome.storage.local.get(['sheetId', 'aiApiKey', 'aiProvider', 'initialSyncDone'], function(d) {
  if (d.sheetId && d.aiApiKey && d.initialSyncDone) {
    document.querySelector('.cards').innerHTML =
      '<div class="card" style="text-align:center;padding:32px;">' +
      '<div style="font-family:Manrope,sans-serif;font-size:18px;font-weight:600;color:#0D0D0D;margin-bottom:8px;">Already set up!</div>' +
      '<div style="font-size:12px;color:#7A7A80;margin-bottom:20px;">Provider: ' + (d.aiProvider || '') + '</div>' +
      '<button id="btn-open-existing-sheet" class="btn btn-blue" style="margin-bottom:10px;">Open my sheet →</button>' +
      '<button id="btn-reset-existing-setup" class="btn btn-ghost" style="margin-top:8px;">Reset setup</button>' +
      '</div>';

    document.getElementById('progress-track').style.display = 'none';

    var openBtn = document.getElementById('btn-open-existing-sheet');
    if (openBtn) {
      openBtn.addEventListener('click', function() {
        chrome.tabs.create({ url: 'https://docs.google.com/spreadsheets/d/' + d.sheetId });
      });
    }

    var resetBtn = document.getElementById('btn-reset-existing-setup');
    if (resetBtn) {
      resetBtn.addEventListener('click', function() {
        chrome.storage.local.clear(function() { location.reload(); });
      });
    }
  }
});

storageGetAsync(['aiProvider', 'customApiBaseUrl', 'customModel', 'customApiType']).then(function(cfg) {
  if (cfg.aiProvider) {
    selectedProvider = cfg.aiProvider;
    document.querySelectorAll('.provider-card').forEach(function(c) {
      c.classList.toggle('sel', c.getAttribute('data-provider') === selectedProvider);
    });
  }
  if (cfg.customApiBaseUrl) customApiBaseInputEl.value = cfg.customApiBaseUrl;
  if (cfg.customModel) customModelInputEl.value = cfg.customModel;
  if (cfg.customApiType) customApiTypeInputEl.value = cfg.customApiType;
  updateStep2Hints();
  updateStep2ActionState();
});

updateStep2Hints();
updateStep2ActionState();
