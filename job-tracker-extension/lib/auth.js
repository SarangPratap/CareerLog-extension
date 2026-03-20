const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file"
];

function validateOauthClientId() {
  const clientId = chrome.runtime.getManifest()?.oauth2?.client_id || "";
  const isPlaceholder = clientId === "YOUR_GOOGLE_OAUTH_CLIENT_ID";
  const looksLikeGoogleClientId = /\.apps\.googleusercontent\.com$/i.test(clientId);

  if (!clientId || isPlaceholder || !looksLikeGoogleClientId) {
    throw new Error(
      "OAuth is not configured. Set oauth2.client_id in manifest.json to your real Google OAuth Client ID (ends with .apps.googleusercontent.com), then reload the extension."
    );
  }
}

function getAuthToken(interactive) {
  validateOauthClientId();

  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive, scopes: SCOPES }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error("Authentication failed: " + (chrome.runtime.lastError?.message || "No token returned")));
        return;
      }
      resolve(token);
    });
  });
}

// Returns a valid OAuth token and prompts only when silent refresh fails.
async function getValidToken() {
  try {
    return await getAuthToken(false);
  } catch {
    return getAuthToken(true);
  }
}

// Revokes cached Google token and clears it from Chrome identity cache.
async function revokeAuth() {
  const token = await new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: false, scopes: SCOPES }, (cachedToken) => {
      if (chrome.runtime.lastError || !cachedToken) {
        resolve(null);
        return;
      }
      resolve(cachedToken);
    });
  });

  if (!token) {
    return;
  }

  await new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, resolve);
  });

  try {
    await fetch("https://accounts.google.com/o/oauth2/revoke?token=" + encodeURIComponent(token));
  } catch {
    // Ignore revoke network errors; cached token has already been removed.
  }
}

// Returns true when a non-interactive auth token is available.
async function isAuthenticated() {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: false, scopes: SCOPES }, (token) => {
      resolve(Boolean(token) && !chrome.runtime.lastError);
    });
  });
}

globalThis.SCOPES = SCOPES;
globalThis.getValidToken = getValidToken;
globalThis.revokeAuth = revokeAuth;
globalThis.isAuthenticated = isAuthenticated;
