// onboarding/onboarding.js

var currentStep    = 1;
var selectedProvider = 'gemini';
var apiKeyVerified = false;
var googleAuthed   = false;
var sheetCreated   = false;
var spreadsheetId  = null;

var PROVIDER_HINTS = {
  gemini: { placeholder: 'AIzaSy···············', hint: 'Get a free key at aistudio.google.com', link: 'https://aistudio.google.com/app/apikey' },
  claude: { placeholder: 'sk-ant-api03-···············', hint: 'Get a key at console.anthropic.com', link: 'https://console.anthropic.com/keys' },
  openai: { placeholder: 'sk-proj-···············', hint: 'Get a key at platform.openai.com', link: 'https://platform.openai.com/api-keys' }
};

// ─── STEP NAVIGATION ──────────────────────────────────────────────────

function goToStep(n) {
  currentStep = n;
  [1,2,3,4].forEach(function(i) {
    var card = document.getElementById('card' + i);
    card.classList.remove('active','done');
    if (i < n) card.classList.add('done');
    if (i === n) card.classList.add('active');

    var sc = document.getElementById('sc' + i);
    if (!sc) return;
    sc.className = 'step-circle ' + (i < n ? 'step-done' : i === n ? 'step-active' : 'step-todo');
    if (i < n) sc.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6l2.5 2.5 4.5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    else sc.textContent = i;

    if (i < 4) {
      var line = document.getElementById('sl' + i);
      if (line) line.className = 'step-line' + (i < n ? ' done' : '');
    }
  });
}

function showError(id, msg) {
  var el = document.getElementById(id);
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function hideError(id) {
  var el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

// ─── STEP 1: Provider ────────────────────────────────────────────────

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

function updateStep2Hints() {
  var hints = PROVIDER_HINTS[selectedProvider] || PROVIDER_HINTS.gemini;
  document.getElementById('api-key-input').placeholder = hints.placeholder;
  document.getElementById('step2-hint').innerHTML =
    'Get a free key at <a href="' + hints.link + '" target="_blank">' + hints.hint.split(' at ')[1] + '</a>';
}

// ─── STEP 2: API Key ─────────────────────────────────────────────────

var keyInput = document.getElementById('api-key-input');

keyInput.addEventListener('input', function() {
  var val = keyInput.value.trim();
  document.getElementById('btn-step2').disabled = val.length < 10;
  hideError('err2');
});

document.getElementById('show-key-btn').addEventListener('click', function() {
  var inp = document.getElementById('api-key-input');
  var btn = document.getElementById('show-key-btn');
  if (inp.type === 'password') { inp.type = 'text'; btn.textContent = 'Hide'; }
  else { inp.type = 'password'; btn.textContent = 'Show'; }
});

document.getElementById('btn-step2').addEventListener('click', async function() {
  var btn = document.getElementById('btn-step2');
  var key = keyInput.value.trim();
  hideError('err2');
  btn.disabled = true;
  btn.textContent = 'Verifying…';

  try {
    await verifyApiKey(key, selectedProvider);
    chrome.storage.local.set({ aiApiKey: key });
    apiKeyVerified = true;
    document.getElementById('badge2').style.display = 'flex';
    document.getElementById('btn-step3').disabled = false;
    goToStep(3);
  } catch (e) {
    showError('err2', 'Key verification failed: ' + e.message + '. Check your key and try again.');
    btn.disabled = false;
    btn.textContent = 'Verify key →';
  }
});

async function verifyApiKey(key, provider) {
  var testPrompt = 'Reply with the word "ok" only.';
  if (provider === 'gemini') {
    var res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + key,
      { method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ contents: [{ parts: [{ text: testPrompt }] }] }) }
    );
    if (!res.ok) { var d = await res.json(); throw new Error(d.error && d.error.message || res.status); }
  } else if (provider === 'claude') {
    var res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01' },
      body: JSON.stringify({ model:'claude-haiku-4-5-20251001', max_tokens:10, messages:[{role:'user',content:testPrompt}] })
    });
    if (!res.ok) { var d = await res.json(); throw new Error(d.error && d.error.message || res.status); }
  } else if (provider === 'openai') {
    var res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type':'application/json','Authorization':'Bearer '+key },
      body: JSON.stringify({ model:'gpt-4o-mini', max_tokens:5, messages:[{role:'user',content:testPrompt}] })
    });
    if (!res.ok) { var d = await res.json(); throw new Error(d.error && d.error.message || res.status); }
  }
}

// ─── STEP 3: Google Auth ─────────────────────────────────────────────

document.getElementById('btn-google').addEventListener('click', function() {
  hideError('err3');
  chrome.identity.getAuthToken({ interactive: true }, function(token) {
    if (chrome.runtime.lastError || !token) {
      showError('err3', 'Google sign-in failed: ' + (chrome.runtime.lastError && chrome.runtime.lastError.message || 'unknown error'));
      return;
    }
    googleAuthed = true;
    document.getElementById('badge3').style.display = 'flex';
    document.getElementById('btn-step4').disabled = false;
    goToStep(4);
  });
});

// ─── STEP 4: Sheet + Sync ────────────────────────────────────────────

// Date range selection visual
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

  // Get selected date range
  var dateRange = 'last30';
  document.querySelectorAll('input[name="dateRange"]').forEach(function(r) {
    if (r.checked) dateRange = r.value;
  });

  // 1. Create sheet
  btn.textContent = 'Creating sheet…';
  try {
    chrome.identity.getAuthToken({ interactive: false }, async function(token) {
      try {
        // Create the Google Sheet
        var sheetRes = await createSheetViaAPI(token);
        spreadsheetId = sheetRes;
        await new Promise(function(r) { chrome.storage.local.set({ sheetId: spreadsheetId }, r); });

        // 2. Start initial sync
        document.getElementById('date-options').style.display  = 'none';
        document.getElementById('progress-wrap').style.display = 'block';
        btn.textContent = 'Syncing…';

        // Poll progress
        var pollTimer = setInterval(function() {
          chrome.runtime.sendMessage({ type: 'GET_STATUS' }, function(s) {
            if (!s) return;
            var pct = s.syncProgress || 0;
            document.getElementById('prog-fill').style.width = pct + '%';
            document.getElementById('prog-txt').textContent =
              'Found ' + (s.totalProcessed || 0) + ' applications… ' + pct + '%';

            if (!s.syncInProgress && s.initialSyncDone) {
              clearInterval(pollTimer);
              document.getElementById('progress-wrap').style.display = 'none';
              document.getElementById('done-wrap').style.display = 'block';
              document.getElementById('done-count').textContent = s.totalProcessed || 0;
              btn.style.display = 'none';
            }
          });
        }, 1500);

        chrome.runtime.sendMessage({ type: 'START_INITIAL_SYNC', dateRange: dateRange }, function(resp) {
          if (resp && !resp.success) {
            clearInterval(pollTimer);
            showError('err4', 'Sync failed: ' + (resp.error || 'unknown error'));
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

// Create sheet using Sheets API directly from onboarding page
async function createSheetViaAPI(token) {
  var year = new Date().getFullYear();
  var res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: { title: 'Careerlog ' + year },
      sheets: [
        { properties: { title: 'Applications', sheetId: 0 } },
        { properties: { title: 'Interview Log', sheetId: 1 } }
      ]
    })
  });
  if (!res.ok) { var e = await res.json(); throw new Error(JSON.stringify(e)); }
  var data = await res.json();
  var sid = data.spreadsheetId;

  // Add headers
  await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + sid + '/values/Applications!A1:H1?valueInputOption=RAW', {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [['Company','Role','Applied Date','Current Status','Last Updated','Total Rounds','Job URL','Notes']] })
  });
  await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + sid + '/values/Interview%20Log!A1:G1?valueInputOption=RAW', {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [['App ID','Company','Round #','Round Type','Interview Date','Outcome','Notes']] })
  });

  // Bold + freeze
  await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + sid + ':batchUpdate', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [
      { repeatCell: { range:{sheetId:0,startRowIndex:0,endRowIndex:1}, cell:{userEnteredFormat:{textFormat:{bold:true}}}, fields:'userEnteredFormat.textFormat.bold' }},
      { updateSheetProperties: { properties:{sheetId:0,gridProperties:{frozenRowCount:1}}, fields:'gridProperties.frozenRowCount' }},
      { repeatCell: { range:{sheetId:1,startRowIndex:0,endRowIndex:1}, cell:{userEnteredFormat:{textFormat:{bold:true}}}, fields:'userEnteredFormat.textFormat.bold' }},
      { updateSheetProperties: { properties:{sheetId:1,gridProperties:{frozenRowCount:1}}, fields:'gridProperties.frozenRowCount' }}
    ]})
  });

  return sid;
}

// Init — check if already set up
chrome.storage.local.get(['sheetId','aiApiKey','aiProvider','initialSyncDone'], function(d) {
  if (d.sheetId && d.aiApiKey && d.initialSyncDone) {
    // Already set up — show a "you're good" message
    document.querySelector('.cards').innerHTML =
      '<div class="card" style="text-align:center;padding:32px;">' +
      '<div style="font-family:Manrope,sans-serif;font-size:18px;font-weight:600;color:#0D0D0D;margin-bottom:8px;">Already set up!</div>' +
      '<div style="font-size:12px;color:#7A7A80;margin-bottom:20px;">Provider: ' + (d.aiProvider || '') + '</div>' +
      '<button class="btn btn-blue" style="margin-bottom:10px;" onclick="chrome.tabs.create({url:\'https://docs.google.com/spreadsheets/d/'+d.sheetId+'\'})">Open my sheet →</button>' +
      '<button class="btn btn-ghost" style="margin-top:8px;" onclick="chrome.storage.local.clear(function(){location.reload();})">Reset setup</button>' +
      '</div>';
    document.getElementById('progress-track').style.display = 'none';
  }
});

updateStep2Hints();
