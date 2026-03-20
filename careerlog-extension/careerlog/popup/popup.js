// popup/popup.js

function formatTime(ts) {
  if (!ts) return '';
  var diff = Date.now() - ts;
  var mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return mins + 'm ago';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24)  return hrs + 'h ago';
  return Math.floor(hrs / 24) + 'd ago';
}

function setActivity(feed, items) {
  if (!items || items.length === 0) {
    feed.innerHTML = '<div class="feed-empty">No activity yet — click Sync now</div>';
    return;
  }
  feed.innerHTML = '';
  items.slice(0, 4).forEach(function(item) {
    var dot = item.type === 'offer'     ? '#8BD6B4'
             : item.type === 'rejected'  ? '#F2C2C2'
             : item.type === 'interview' ? '#F2D6B3'
             : '#9BCAF2';
    var el = document.createElement('div');
    el.className = 'feed-item';
    el.innerHTML =
      '<div class="feed-dot" style="background:' + dot + '"></div>' +
      '<div class="feed-text"><b>' + (item.company || '') + '</b> · ' + (item.label || '') + '</div>' +
      '<div class="feed-time">' + formatTime(item.ts) + '</div>';
    feed.appendChild(el);
  });
}

async function init() {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, function(status) {
    var setup  = document.getElementById('state-setup');
    var active = document.getElementById('state-active');

    if (!status || !status.sheetId) {
      setup.style.display  = 'block';
      active.style.display = 'none';
      return;
    }

    setup.style.display  = 'none';
    active.style.display = 'block';

    // Provider label
    var providerMap = { claude: 'Claude · Haiku', gemini: 'Gemini · free tier', openai: 'GPT-4o Mini' };
    document.getElementById('footer-provider').textContent =
      providerMap[status.aiProvider] || status.aiProvider || '–';

    // Sync state label
    var syncEl = document.getElementById('sync-state');
    if (status.syncInProgress) {
      syncEl.textContent = 'Syncing… ' + (status.syncProgress || 0) + '%';
    } else if (status.lastSyncTime) {
      syncEl.textContent = 'Last synced ' + formatTime(status.lastSyncTime);
    }

    // Error banner
    var errEl = document.getElementById('error-banner');
    if (status.lastError) {
      errEl.textContent = '⚠ ' + status.lastError;
      errEl.style.display = 'block';
    }

    // Stats from sheet
    if (status.sheetId) {
      document.getElementById('stat-applied').textContent    = status.totalProcessed || '–';
      document.getElementById('stat-interviews').textContent = '–';
      document.getElementById('stat-offers').textContent     = '–';
    }

    // Activity feed from storage
    chrome.storage.local.get(['activityLog'], function(d) {
      setActivity(document.getElementById('activity-feed'), d.activityLog || []);
    });
  });
}

// Buttons
document.getElementById('btn-go-setup').addEventListener('click', function() {
  chrome.runtime.openOptionsPage();
});

document.getElementById('btn-settings').addEventListener('click', function() {
  chrome.runtime.openOptionsPage();
});

document.getElementById('btn-open-sheet').addEventListener('click', function() {
  chrome.storage.local.get(['sheetId'], function(d) {
    if (d.sheetId) {
      chrome.tabs.create({ url: 'https://docs.google.com/spreadsheets/d/' + d.sheetId });
    }
  });
});

document.getElementById('btn-sync-now').addEventListener('click', function() {
  var btn = document.getElementById('btn-sync-now');
  btn.disabled = true;
  btn.textContent = 'Syncing…';
  chrome.runtime.sendMessage({ type: 'SYNC_NOW' }, function() {
    btn.disabled = false;
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M10.5 6A4.5 4.5 0 1 1 6 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M6 1.5l1.5 1.5L6 4.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg> Sync now';
    init();
  });
});

document.getElementById('btn-open-dashboard').addEventListener('click', function() {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
});

init();
