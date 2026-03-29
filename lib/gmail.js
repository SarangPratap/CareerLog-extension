// lib/gmail.js
// Gmail API integration. Uses var throughout for importScripts() compatibility.

var GMAIL_JOB_QUERY = [
  'subject:(application received)',
  'subject:(thank you for applying)',
  'subject:(we received your application)',
  'subject:(your application for)',
  'subject:(application submitted)',
  'subject:(interview invitation)',
  'subject:(interview request)',
  'subject:(interview scheduled)',
  'subject:(next steps)',
  'subject:(unfortunately)',
  'subject:(we regret to inform)',
  'subject:(offer letter)',
  'subject:(job offer)',
  'subject:(congratulations)',
  'subject:(moving forward)',
  'subject:(not selected)',
  'subject:(position has been filled)',
  'from:(greenhouse.io)',
  'from:(lever.co)',
  'from:(workday.com)',
  'from:(myworkdayjobs.com)',
  'from:(taleo.net)',
  'from:(icims.com)',
  'from:(jobvite.com)',
  'from:(smartrecruiters.com)',
  'from:(ashbyhq.com)',
  'from:(bamboohr.com)',
  'from:(workable.com)',
  'from:(recruiting@)',
  'from:(careers@)',
  'from:(talent@)',
  'from:(jobs@)'
].join(' OR ');

// Build Gmail after: date query string
var buildAfterDate = function(dateRange) {
  var now = new Date();
  var daysBack = 0;

  switch (dateRange) {
    case 'last15': daysBack = 15;  break;
    case 'last30': daysBack = 30;  break;
    case 'all':    return '';
    default:       daysBack = 30;
  }

  var d = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
  var yyyy = d.getFullYear();
  var mm   = String(d.getMonth() + 1).padStart(2, '0');
  var dd   = String(d.getDate()).padStart(2, '0');
  return 'after:' + yyyy + '/' + mm + '/' + dd;
};

// ─── INITIAL SYNC ─────────────────────────────────────────────────────
// Fetches all matching emails for chosen date range.
// Paginates through all results (Gmail returns max 500 per page).

var fetchInitialEmails = async function(accessToken, dateRange) {
  var afterDate = buildAfterDate(dateRange);
  var query = afterDate ? (GMAIL_JOB_QUERY + ' ' + afterDate) : GMAIL_JOB_QUERY;

  var allMessageIds = [];
  var pageToken = null;

  do {
    var url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages'
      + '?q=' + encodeURIComponent(query)
      + '&maxResults=500'
      + (pageToken ? '&pageToken=' + pageToken : '');

    var res = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    });

    if (!res.ok) {
      console.error('[Careerlog] Gmail list error:', res.status);
      break;
    }

    var data = await res.json();
    if (data.messages) {
      data.messages.forEach(function(m) { allMessageIds.push(m.id); });
    }
    pageToken = data.nextPageToken || null;

    console.log('[Careerlog] Paginating... total so far: ' + allMessageIds.length);

  } while (pageToken);

  console.log('[Careerlog] Total candidate emails: ' + allMessageIds.length);

  // Fetch full content in parallel batches of 10
  return await fetchEmailsBatch(allMessageIds, accessToken);
};

// ─── ONGOING SYNC ─────────────────────────────────────────────────────
// Uses historyId — only fetches emails since last check.
// Falls back to last-7-days query if historyId expired (>30 days).

var getMissedEmails = async function(accessToken, lastHistoryId) {
  if (!lastHistoryId) {
    return await getMissedEmailsFallback(accessToken);
  }

  var historyRes = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/history'
      + '?startHistoryId=' + lastHistoryId
      + '&historyTypes=messageAdded',
    { headers: { 'Authorization': 'Bearer ' + accessToken } }
  );

  // 404 = historyId expired (Gmail only keeps ~30 days)
  if (historyRes.status === 404) {
    console.warn('[Careerlog] historyId expired — falling back to last 7 days');
    return await getMissedEmailsFallback(accessToken);
  }

  if (!historyRes.ok) {
    throw new Error('Gmail history API error: ' + historyRes.status);
  }

  var historyData = await historyRes.json();
  var latestHistoryId = historyData.historyId || lastHistoryId;

  if (!historyData.history || historyData.history.length === 0) {
    return { emails: [], latestHistoryId: latestHistoryId };
  }

  // Collect all new message IDs, deduplicated
  var seen = {};
  var messageIds = [];
  historyData.history.forEach(function(h) {
    (h.messagesAdded || []).forEach(function(m) {
      if (!seen[m.message.id]) {
        seen[m.message.id] = true;
        messageIds.push(m.message.id);
      }
    });
  });

  var emails = await fetchEmailsBatch(messageIds, accessToken);
  return { emails: emails, latestHistoryId: latestHistoryId };
};

// Fallback when historyId is missing or expired
var getMissedEmailsFallback = async function(accessToken) {
  var d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  var afterDate = 'after:' + d.getFullYear() + '/'
    + String(d.getMonth() + 1).padStart(2, '0') + '/'
    + String(d.getDate()).padStart(2, '0');

  var emails = await fetchInitialEmails(accessToken, 'last7');
  var historyId = await getLatestHistoryId(accessToken);
  return { emails: emails, latestHistoryId: historyId };
};

// ─── BATCH FETCHER ────────────────────────────────────────────────────
// Fetches email content in parallel batches of 10.

var fetchEmailsBatch = async function(messageIds, accessToken) {
  var results = [];
  var BATCH = 10;

  for (var i = 0; i < messageIds.length; i += BATCH) {
    var batch = messageIds.slice(i, i + BATCH);
    var batchResults = await Promise.all(
      batch.map(function(id) { return fetchEmailById(id, accessToken); })
    );
    batchResults.forEach(function(email) {
      if (email) results.push(email);
    });
  }

  return results;
};

// ─── SINGLE EMAIL FETCH ───────────────────────────────────────────────

var fetchEmailById = async function(messageId, accessToken) {
  try {
    var res = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/' + messageId + '?format=full',
      { headers: { 'Authorization': 'Bearer ' + accessToken } }
    );

    if (!res.ok) return null;
    var data = await res.json();

    var headers = data.payload.headers || [];
    var getHeader = function(name) {
      var h = headers.find(function(h) { return h.name === name; });
      return h ? h.value : '';
    };

    return {
      id:      messageId,
      subject: getHeader('Subject'),
      from:    getHeader('From'),
      date:    getHeader('Date'),
      body:    extractBody(data.payload)
    };

  } catch (err) {
    console.warn('[Careerlog] fetchEmailById failed:', messageId, err.message);
    return null;
  }
};

// ─── BODY EXTRACTION ──────────────────────────────────────────────────

var extractBody = function(payload) {
  // Simple non-multipart
  if (payload.body && payload.body.data) {
    return decodeBase64Url(payload.body.data);
  }

  var parts = payload.parts || [];

  // Prefer text/plain
  var plain = findPartByMime(parts, 'text/plain');
  if (plain && plain.body && plain.body.data) {
    return decodeBase64Url(plain.body.data);
  }

  // Fall back to text/html stripped
  var html = findPartByMime(parts, 'text/html');
  if (html && html.body && html.body.data) {
    var decoded = decodeBase64Url(html.body.data);
    return decoded.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  return '';
};

var findPartByMime = function(parts, mimeType) {
  for (var i = 0; i < parts.length; i++) {
    if (parts[i].mimeType === mimeType) return parts[i];
    if (parts[i].parts) {
      var found = findPartByMime(parts[i].parts, mimeType);
      if (found) return found;
    }
  }
  return null;
};

var decodeBase64Url = function(data) {
  try {
    var base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    return decodeURIComponent(escape(atob(base64)));
  } catch (e) {
    try {
      return atob(data.replace(/-/g, '+').replace(/_/g, '/'));
    } catch (e2) {
      return '';
    }
  }
};

var getLatestHistoryId = async function(accessToken) {
  var res = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/profile',
    { headers: { 'Authorization': 'Bearer ' + accessToken } }
  );
  var data = await res.json();
  return data.historyId;
};
