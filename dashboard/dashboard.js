var PROVIDER_LABELS = { claude: 'Claude · Haiku', gemini: 'Gemini · free tier', openai: 'GPT-4o Mini', custom: 'Custom provider' };
var STAGE_COLORS = ['#9BCAF2', '#C2DCF2', '#F2D6B3', '#D4A070', '#8BD6B4', '#F2C2C2'];
var STAGE_NAMES = ['Applied', 'Reviewing', 'Interview', 'Finals', 'Offer', 'Rejected'];

function formatTime(ts) {
  if (!ts) return '–';
  var diff = Date.now() - ts;
  var m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  var h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

function renderFunnel(apps) {
  var counts = [0, 0, 0, 0, 0, 0];
  apps.forEach(function(a) {
    var s = (a.status || '').toLowerCase();
    if (s.indexOf('review') !== -1) counts[1]++;
    else if (s.indexOf('interview') !== -1 || s.indexOf('phone') !== -1 || s.indexOf('technical') !== -1) counts[2]++;
    else if (s.indexOf('final') !== -1) counts[3]++;
    else if (s.indexOf('offer') !== -1) counts[4]++;
    else if (s.indexOf('reject') !== -1) counts[5]++;
    else counts[0]++;
  });
  var max = Math.max.apply(null, counts) || 1;
  var html = '';
  STAGE_NAMES.forEach(function(name, i) {
    html += '<div class="stage">' +
      '<div class="stage-num">' + counts[i] + '</div>' +
      '<div class="stage-name">' + name + '</div>' +
      '<div class="stage-bar"><div class="stage-fill" style="background:' + STAGE_COLORS[i] + ';width:' + Math.round(counts[i] / max * 100) + '%;"></div></div>' +
      '</div>';
  });
  document.getElementById('funnel-stages').innerHTML = html;
}

function getStatusClass(status) {
  if (!status) return 'st-review';
  var s = status.toLowerCase();
  if (s.indexOf('offer') !== -1) return 'st-offer';
  if (s.indexOf('reject') !== -1) return 'st-rejected';
  if (s.indexOf('interview') !== -1 || s.indexOf('phone') !== -1 || s.indexOf('technical') !== -1 || s.indexOf('round') !== -1) return 'st-interview';
  if (s.indexOf('applied') !== -1) return 'st-applied';
  return 'st-review';
}

function getStatusLabel(status) {
  if (!status) return 'Unknown';
  return status.replace(/^[^\w]+/, '');
}

function hasInterviewSignal(app) {
  var status = String(app.status || '').toLowerCase();
  var rounds = parseInt(app.rounds, 10) || 0;
  if (rounds > 0) return true;
  return status.indexOf('interview') !== -1
    || status.indexOf('phone') !== -1
    || status.indexOf('technical') !== -1
    || status.indexOf('final') !== -1
    || status.indexOf('round') !== -1;
}

function renderApps(apps, filter) {
  var filtered = apps;
  if (filter === 'active') {
    filtered = apps.filter(function(a) { return a.status && a.status.toLowerCase().indexOf('reject') === -1; });
  } else if (filter === 'offer') {
    filtered = apps.filter(function(a) { return a.status && a.status.toLowerCase().indexOf('offer') !== -1; });
  }

  var list = document.getElementById('job-list');
  if (!filtered.length) {
    list.innerHTML = '<div class="no-apps"><strong>No applications</strong>Try a different filter.</div>';
    return;
  }

  var html = '';
  filtered.slice(0, 20).forEach(function(app) {
    var initial = (app.company || '?')[0].toUpperCase();
    var colors = ['#EEF6FF:#1A4A7A', '#F5EDD8:#7A4A1A', '#F0F1F2:#3A3A3C', '#D6F2E8:#1A6A48', '#F2C2C2:#7A2A2A'];
    var pick = colors[initial.charCodeAt(0) % colors.length].split(':');
    var badge = '';
    if (app.status && app.status.toLowerCase().indexOf('offer') !== -1) {
      badge = '<div class="ai-badge"><div class="ai-badge-dot"></div>ai · offer detected</div>';
    } else if (app.status && app.status.toLowerCase().indexOf('reject') !== -1) {
      badge = '<div class="ai-badge danger"><div class="ai-badge-dot"></div>ai · rejection detected</div>';
    } else if (app.status && (app.status.toLowerCase().indexOf('interview') !== -1 || app.status.toLowerCase().indexOf('round') !== -1)) {
      badge = '<div class="ai-badge"><div class="ai-badge-dot"></div>ai · interview detected</div>';
    }

    var rounds = parseInt(app.rounds, 10) || 0;
    var pips = '';
    for (var i = 0; i < Math.max(rounds, 3); i++) {
      var col = i < rounds ? 'var(--tertiary)' : 'var(--surface3)';
      pips += '<div class="rpip" style="background:' + col + ';"></div>';
    }

    html += '<div class="jcard">' + badge +
      '<div class="jcard-top">' +
      '<div class="jcard-co">' +
      '<div class="co-mark" style="background:' + pick[0] + ';color:' + pick[1] + ';">' + initial + '</div>' +
      '<div><div class="co-name">' + (app.company || '–') + '</div><div class="co-role">' + (app.role || '–') + '</div></div>' +
      '</div>' +
      '<div class="jcard-right">' +
      '<span class="jcard-date">' + (app.date || '') + '</span>' +
      '<span class="status-tag ' + getStatusClass(app.status) + '">' + getStatusLabel(app.status) + '</span>' +
      '</div></div>' +
      '<div class="jcard-bot">' + pips +
      '<span class="round-lbl">' + (rounds > 0 ? rounds + ' round' + (rounds !== 1 ? 's' : '') : 'no rounds yet') + '</span>' +
      '</div></div>';
  });

  list.innerHTML = html;
}

function renderActivity(log) {
  var feed = document.getElementById('activity-feed');
  if (!log || !log.length) {
    feed.innerHTML = '<div class="act-item"><div class="act-body" style="color:var(--on4);">No activity yet</div></div>';
    return;
  }
  var html = '';
  log.slice(0, 5).forEach(function(item) {
    var bgCol = item.type === 'offer' ? 'var(--tert-bg)' : item.type === 'rejected' ? 'var(--danger-bg)' : 'var(--c2)';
    var icoCol = item.type === 'offer' ? 'var(--tert-text)' : item.type === 'rejected' ? 'var(--danger-txt)' : '#1A4A7A';
    var icon = item.type === 'rejected'
      ? '<path d="M3 3l4 4M7 3L3 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'
      : '<path d="M2 5l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>';
    html += '<div class="act-item">' +
      '<div class="act-ico" style="background:' + bgCol + ';color:' + icoCol + ';">' +
      '<svg width="10" height="10" viewBox="0 0 10 10" fill="none">' + icon + '</svg></div>' +
      '<div><div class="act-body"><b>' + (item.company || '') + '</b> · ' + (item.label || '') + '</div>' +
      '<div class="act-time">' + formatTime(item.ts) + '</div></div>' +
      '</div>';
  });
  feed.innerHTML = html;
}

function toSortableDate(value) {
  if (!value) return 0;
  var trimmed = String(value).trim();
  var iso = /^\d{4}-\d{2}-\d{2}$/;
  if (iso.test(trimmed)) {
    return new Date(trimmed + 'T00:00:00Z').getTime();
  }
  var parsed = new Date(trimmed).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function getAppsFromSheet(sheetId, token, callback) {
  fetch('https://sheets.googleapis.com/v4/spreadsheets/' + sheetId + '/values/Applications!A:H', {
    headers: { 'Authorization': 'Bearer ' + token }
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var rows = (data.values || []).slice(1);
      var apps = rows.map(function(r) {
        return {
          company: r[0],
          role: r[1],
          date: r[2],
          status: r[3],
          lastUpdated: r[4],
          rounds: r[5]
        };
      });

      apps.sort(function(a, b) {
        var bTs = toSortableDate(b.lastUpdated) || toSortableDate(b.date);
        var aTs = toSortableDate(a.lastUpdated) || toSortableDate(a.date);
        return bTs - aTs;
      });

      callback(null, apps);
    })
    .catch(function(e) { callback(e); });
}

function loadDashboard() {
  chrome.storage.local.get(
    ['sheetId', 'aiProvider', 'lastSyncTime', 'totalProcessed', 'activityLog'],
    function(d) {
      var prov = PROVIDER_LABELS[d.aiProvider] || d.aiProvider || '–';
      document.getElementById('top-provider').textContent = prov;
      document.getElementById('usage-provider').textContent = prov;
      document.getElementById('usage-parsed').textContent = d.totalProcessed || 0;
      document.getElementById('usage-sync').textContent = formatTime(d.lastSyncTime);

      var now = new Date();
      document.getElementById('page-date').textContent = now.toLocaleString('default', { month: 'long' }) + ' ' + now.getFullYear();

      renderActivity(d.activityLog || []);

      if (!d.sheetId) {
        document.getElementById('stat-total').textContent = '–';
        document.getElementById('stat-interviews').textContent = '–';
        document.getElementById('stat-offers').textContent = '–';
        document.getElementById('funnel-stages').innerHTML = '';
        return;
      }

      chrome.identity.getAuthToken({ interactive: false }, function(token) {
        if (!token) return;
        getAppsFromSheet(d.sheetId, token, function(err, apps) {
          if (err) {
            console.error('Sheet fetch error', err);
            return;
          }
          document.getElementById('stat-total').textContent = apps.length;
          var interviews = apps.filter(function(a) {
            return hasInterviewSignal(a);
          }).length;
          var offers = apps.filter(function(a) {
            return a.status && a.status.indexOf('Offer') !== -1;
          }).length;
          document.getElementById('stat-interviews').textContent = interviews;
          document.getElementById('stat-offers').textContent = offers;

          renderFunnel(apps);
          renderApps(apps, 'all');
        });
      });
    }
  );
}

document.querySelectorAll('.fpill').forEach(function(pill) {
  pill.addEventListener('click', function() {
    document.querySelectorAll('.fpill').forEach(function(p) { p.classList.remove('on'); });
    pill.classList.add('on');
    chrome.identity.getAuthToken({ interactive: false }, function(token) {
      chrome.storage.local.get(['sheetId'], function(d) {
        if (!token || !d.sheetId) return;
        getAppsFromSheet(d.sheetId, token, function(err, apps) {
          if (err) {
            console.error('Filter fetch error', err);
            return;
          }
          renderApps(apps, pill.getAttribute('data-filter'));
        });
      });
    });
  });
});

document.getElementById('nav-open-sheet').addEventListener('click', function() {
  chrome.storage.local.get(['sheetId'], function(d) {
    if (d.sheetId) chrome.tabs.create({ url: 'https://docs.google.com/spreadsheets/d/' + d.sheetId });
  });
});

document.getElementById('nav-settings').addEventListener('click', function() {
  chrome.tabs.create({ url: chrome.runtime.getURL('settings/settings.html') });
});

function doSync(btn) {
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Syncing…';
  }
  chrome.runtime.sendMessage({ type: 'SYNC_NOW' }, function(resp) {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M10.5 6A4.5 4.5 0 1 1 6 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M6 1.5l1.5 1.5L6 4.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg> Sync now';
    }

    var errEl = document.getElementById('activity-feed');
    if (chrome.runtime.lastError) {
      console.error('SYNC_NOW messaging error:', chrome.runtime.lastError.message);
      if (errEl) {
        errEl.innerHTML = '<div class="act-item"><div class="act-body" style="color:var(--danger-txt);">Sync failed: ' + chrome.runtime.lastError.message + '</div></div>';
      }
      return;
    }

    if (!resp || !resp.success) {
      var msg = (resp && resp.error) || 'Unknown sync error';
      if (errEl) {
        errEl.innerHTML = '<div class="act-item"><div class="act-body" style="color:var(--danger-txt);">Sync failed: ' + msg + '</div></div>';
      }
      return;
    }

    loadDashboard();
  });
}

document.getElementById('btn-sync').addEventListener('click', function() { doSync(this); });
document.getElementById('nav-sync-now').addEventListener('click', function() { doSync(document.getElementById('btn-sync')); });

loadDashboard();
