if (!globalThis.GMAIL_SEARCH_QUERY) {
  globalThis.GMAIL_SEARCH_QUERY = [
    "subject:(application received)",
    "subject:(thank you for applying)",
    "subject:(we received your application)",
    "subject:(application submitted)",
    "subject:(your application)",
    "subject:(application update)",
    "subject:(application status)",
    "subject:(interview invitation)",
    "subject:(interview request)",
    "subject:(interview scheduled)",
    "subject:(phone screen)",
    "subject:(technical interview)",
    "subject:(final interview)",
    "subject:(next steps)",
    "subject:(unfortunately)",
    "subject:(we regret to inform)",
    "subject:(offer letter)",
    "subject:(job offer)",
    "subject:(congratulations)",
    "subject:(moving forward)",
    "from:(greenhouse.io)",
    "from:(lever.co)",
    "from:(workday.com)",
    "from:(myworkdayjobs.com)",
    "from:(taleo.net)",
    "from:(icims.com)",
    "from:(smartrecruiters.com)",
    "from:(jobvite.com)",
    "from:(ashbyhq.com)",
    "from:(workablemail.com)",
    "from:(recruiting)",
    "from:(careers)",
    "from:(talent@)",
    "from:(noreply@)"
  ].join(" OR ");
}

const GMAIL_SEARCH_QUERY = globalThis.GMAIL_SEARCH_QUERY;

function getAuthHeaders(accessToken) {
  return { "Authorization": `Bearer ${accessToken}` };
}

async function listMessageIdsByQuery(accessToken, query, maxToFetch = 250) {
  const ids = [];
  let pageToken = null;

  while (ids.length < maxToFetch) {
    const pageSize = Math.min(100, maxToFetch - ids.length);
    const params = new URLSearchParams({
      q: query,
      maxResults: String(pageSize)
    });

    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`,
      { headers: getAuthHeaders(accessToken) }
    );

    if (!res.ok) {
      throw new Error(`Failed to list Gmail messages: ${res.status}`);
    }

    const data = await res.json();
    for (const msg of data.messages || []) {
      ids.push(msg.id);
      if (ids.length >= maxToFetch) {
        break;
      }
    }

    pageToken = data.nextPageToken || null;
    if (!pageToken) {
      break;
    }
  }

  return ids;
}

async function fetchEmailsByIdsBatched(ids, accessToken, batchSize = 10) {
  const emails = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const results = await Promise.all(batch.map((id) => fetchEmailById(id, accessToken)));
    for (const email of results) {
      if (email) {
        emails.push(email);
      }
    }
  }
  return emails;
}

function buildRecentHoursQuery(hours) {
  const safeHours = Math.max(1, Number(hours || 4));
  return `(${GMAIL_SEARCH_QUERY}) newer_than:${safeHours}h`;
}

function formatDateForGmail(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function buildFirstSyncDateQuery(firstSyncWindowDays) {
  if (firstSyncWindowDays === "all") {
    return GMAIL_SEARCH_QUERY;
  }

  const days = Number(firstSyncWindowDays);
  if (!Number.isFinite(days) || days <= 0) {
    return GMAIL_SEARCH_QUERY;
  }

  const start = new Date();
  start.setDate(start.getDate() - days);
  return `(${GMAIL_SEARCH_QUERY}) after:${formatDateForGmail(start)}`;
}

function decodeBase64Url(data) {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return atob(padded);
}

function extractBodyFromPayload(payload) {
  if (!payload) {
    return "";
  }

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  for (const part of payload.parts || []) {
    const extracted = extractBodyFromPayload(part);
    if (extracted) {
      return extracted;
    }
  }

  return "";
}

// Fetch a single email by ID and extract key fields.
async function fetchEmailById(messageId, accessToken) {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: getAuthHeaders(accessToken) }
  );

  if (!res.ok) {
    return null;
  }

  const data = await res.json();
  const headers = data.payload?.headers || [];

  const subject = headers.find((h) => h.name === "Subject")?.value || "";
  const from = headers.find((h) => h.name === "From")?.value || "";
  const date = headers.find((h) => h.name === "Date")?.value || "";
  const body = extractBodyFromPayload(data.payload);

  return { id: messageId, subject, from, date, body };
}

// Get all emails missed since lastHistoryId.
async function getMissedEmails(accessToken, lastHistoryId, options = {}) {
  const firstSyncWindowDays = options.firstSyncWindowDays;
  const emails = [];
  let latestHistoryId = lastHistoryId || null;
  let syncSource = "initial";

  if (lastHistoryId) {
    syncSource = "history";
    let pageToken = null;
    const messageIds = new Set();
    let historyNotFound = false;

    while (true) {
      const params = new URLSearchParams({
        startHistoryId: String(lastHistoryId),
        historyTypes: "messageAdded",
        maxResults: "100"
      });

      if (pageToken) {
        params.set("pageToken", pageToken);
      }

      const historyRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/history?${params.toString()}`,
        { headers: getAuthHeaders(accessToken) }
      );

      if (!historyRes.ok) {
        if (historyRes.status === 404) {
          // startHistoryId can expire; recover with a bounded backfill query.
          historyNotFound = true;
          break;
        }

        throw new Error(`Failed to fetch Gmail history: ${historyRes.status}`);
      }

      const historyData = await historyRes.json();
      for (const entry of historyData.history || []) {
        for (const added of entry.messagesAdded || []) {
          if (added.message?.id) {
            messageIds.add(added.message.id);
          }
        }
      }

      if (historyData.historyId) {
        latestHistoryId = historyData.historyId;
      }

      pageToken = historyData.nextPageToken || null;
      if (!pageToken) {
        break;
      }
    }

    if (historyNotFound) {
      syncSource = "history_fallback";
      const fallbackQuery = `(${GMAIL_SEARCH_QUERY}) newer_than:7d`;
      const fallbackIds = await listMessageIdsByQuery(accessToken, fallbackQuery, 250);
      for (const id of fallbackIds) {
        messageIds.add(id);
      }

      const profileRes = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        { headers: getAuthHeaders(accessToken) }
      );
      if (profileRes.ok) {
        const profile = await profileRes.json();
        latestHistoryId = profile.historyId || latestHistoryId;
      }
    }
    const historyEmails = await fetchEmailsByIdsBatched([...messageIds], accessToken, 10);
    emails.push(...historyEmails);
  } else {
    const firstSyncQuery = buildFirstSyncDateQuery(firstSyncWindowDays);
    const ids = await listMessageIdsByQuery(accessToken, firstSyncQuery, 2500);
    const initialEmails = await fetchEmailsByIdsBatched(ids, accessToken, 10);
    emails.push(...initialEmails);

    const profileRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      { headers: getAuthHeaders(accessToken) }
    );

    if (profileRes.ok) {
      const profile = await profileRes.json();
      latestHistoryId = profile.historyId || latestHistoryId;
    }
  }

  return { emails, latestHistoryId, syncSource };
}

async function getLatestHistoryId(accessToken) {
  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    { headers: getAuthHeaders(accessToken) }
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch Gmail profile: ${res.status}`);
  }

  const data = await res.json();
  return data.historyId;
}

async function getRecentEmails(accessToken, hours = 4, maxToFetch = 250) {
  const query = buildRecentHoursQuery(hours);
  const ids = await listMessageIdsByQuery(accessToken, query, maxToFetch);
  return fetchEmailsByIdsBatched(ids, accessToken, 10);
}

globalThis.GMAIL_SEARCH_QUERY = GMAIL_SEARCH_QUERY;
globalThis.fetchEmailById = fetchEmailById;
globalThis.getMissedEmails = getMissedEmails;
globalThis.getLatestHistoryId = getLatestHistoryId;
globalThis.getRecentEmails = getRecentEmails;
