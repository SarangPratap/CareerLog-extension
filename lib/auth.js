// lib/auth.js
// OAuth token management via Chrome Identity API.
// All functions declared as var so importScripts() exposes them globally.

var getOAuthClientIdFromManifest = function() {
  try {
    var oauth2 = (chrome.runtime.getManifest() && chrome.runtime.getManifest().oauth2) || {};
    return oauth2.client_id || '';
  } catch (e) {
    return '';
  }
};

var hasValidOAuthClientId = function(clientId) {
  return !!clientId &&
    clientId.indexOf('YOUR_') === -1 &&
    clientId.indexOf('{0}') === -1 &&
    clientId.indexOf('apps.googleusercontent.com') !== -1;
};

var AUTH_INTERACTIVE_COOLDOWN_MS = 120000;
var AUTH_INTERACTIVE_RETRY_GUARD_MS = 60000;
var authLastInteractiveCancelAt = 0;
var authInteractiveInFlight = null;
var AUTH_SUPPRESS_UNTIL_KEY = 'authSuppressUntil';
var AUTH_INTERACTIVE_LOCK_UNTIL_KEY = 'authInteractiveLockUntil';
var AUTH_LAST_INTERACTIVE_ATTEMPT_KEY = 'authLastInteractiveAttemptAt';
var AUTH_INTERACTIVE_LOCK_OWNER_KEY = 'authInteractiveLockOwner';

var isAuthCancelError = function(message) {
  var msg = String(message || '').toLowerCase();
  return msg.indexOf('did not approve') !== -1 ||
    msg.indexOf('cancel') !== -1 ||
    msg.indexOf('closed by user') !== -1 ||
    msg.indexOf('access_denied') !== -1 ||
    msg.indexOf('not granted') !== -1 ||
    msg.indexOf('warning') !== -1 ||
    msg.indexOf('signin/oauth/warning') !== -1 ||
    msg.indexOf('access blocked') !== -1;
};

var getNonInteractiveToken = function() {
  return new Promise(function(resolve, reject) {
    chrome.identity.getAuthToken({ interactive: false }, function(token) {
      if (chrome.runtime.lastError || !token) {
        reject(new Error((chrome.runtime.lastError && chrome.runtime.lastError.message) || 'No cached auth token'));
      } else {
        resolve(token);
      }
    });
  });
};

var clearCachedTokens = function() {
  return new Promise(function(resolve) {
    if (chrome.identity.clearAllCachedAuthTokens) {
      chrome.identity.clearAllCachedAuthTokens(function() { resolve(); });
      return;
    }

    chrome.identity.getAuthToken({ interactive: false }, function(token) {
      if (token) {
        chrome.identity.removeCachedAuthToken({ token: token }, function() { resolve(); });
      } else {
        resolve();
      }
    });
  });
};

var readAuthControlState = function() {
  return new Promise(function(resolve) {
    chrome.storage.local.get([
      AUTH_SUPPRESS_UNTIL_KEY,
      AUTH_INTERACTIVE_LOCK_UNTIL_KEY,
      AUTH_LAST_INTERACTIVE_ATTEMPT_KEY,
      AUTH_INTERACTIVE_LOCK_OWNER_KEY
    ], function(d) {
      resolve(d || {});
    });
  });
};

var writeAuthControlState = function(partial) {
  return new Promise(function(resolve) {
    chrome.storage.local.set(partial, function() { resolve(); });
  });
};

var clearInteractiveLock = function() {
  return writeAuthControlState((function() {
    var obj = {};
    obj[AUTH_INTERACTIVE_LOCK_UNTIL_KEY] = 0;
    obj[AUTH_INTERACTIVE_LOCK_OWNER_KEY] = '';
    return obj;
  })());
};

var signInWithGoogle = function(options) {
  var opts = options || {};
  var forceAccountChooser = !!opts.forceAccountChooser;
  var attemptId = String(Date.now()) + '-' + Math.random().toString(36).slice(2);

  if (authInteractiveInFlight) {
    return authInteractiveInFlight;
  }

  if (Date.now() - authLastInteractiveCancelAt < AUTH_INTERACTIVE_COOLDOWN_MS) {
    return Promise.reject(new Error('Sign-in canceled recently. Use Reconnect Google when you are ready.'));
  }

  authInteractiveInFlight = readAuthControlState().then(function(state) {
    var now = Date.now();
    var suppressUntil = Number(state[AUTH_SUPPRESS_UNTIL_KEY] || 0);
    var lockUntil = Number(state[AUTH_INTERACTIVE_LOCK_UNTIL_KEY] || 0);
    var lastAttemptAt = Number(state[AUTH_LAST_INTERACTIVE_ATTEMPT_KEY] || 0);

    if (suppressUntil > now) {
      throw new Error('Sign-in canceled recently. Use Reconnect Google when you are ready.');
    }

    if (lastAttemptAt && (now - lastAttemptAt) < AUTH_INTERACTIVE_RETRY_GUARD_MS) {
      throw new Error('Sign-in was just attempted. Please wait a minute before trying again.');
    }

    if (lockUntil > now) {
      throw new Error('Sign-in already in progress.');
    }

    var newLock = {};
    newLock[AUTH_INTERACTIVE_LOCK_UNTIL_KEY] = now + 30000;
    newLock[AUTH_LAST_INTERACTIVE_ATTEMPT_KEY] = now;
    newLock[AUTH_INTERACTIVE_LOCK_OWNER_KEY] = attemptId;
    return writeAuthControlState(newLock).then(function() {
      // Verify ownership after write; if another context replaced owner, abort.
      return readAuthControlState().then(function(afterWrite) {
        if ((afterWrite[AUTH_INTERACTIVE_LOCK_OWNER_KEY] || '') !== attemptId) {
          throw new Error('Sign-in already in progress.');
        }
      });
    });
  }).then(function() {
    return new Promise(function(resolve, reject) {
      var clientId = getOAuthClientIdFromManifest();
      if (!hasValidOAuthClientId(clientId)) {
        reject(new Error('OAuth client_id is not configured in manifest.json. Replace the placeholder with your Chrome Extension OAuth Client ID.'));
        return;
      }

      var runInteractive = function() {
        chrome.identity.getAuthToken({ interactive: true }, function(token) {
          if (chrome.runtime.lastError || !token) {
            var errMsg = (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'unknown auth error';
            if (isAuthCancelError(errMsg)) {
              authLastInteractiveCancelAt = Date.now();
              var suppress = {};
              suppress[AUTH_SUPPRESS_UNTIL_KEY] = Date.now() + AUTH_INTERACTIVE_COOLDOWN_MS;
              writeAuthControlState(suppress).finally(function() {
                reject(new Error('Auth failed: ' + errMsg));
              });
              return;
            }
            // Any interactive failure gets a short suppress window to stop reopen loops.
            var shortSuppress = {};
            shortSuppress[AUTH_SUPPRESS_UNTIL_KEY] = Date.now() + AUTH_INTERACTIVE_RETRY_GUARD_MS;
            writeAuthControlState(shortSuppress).finally(function() {
              reject(new Error('Auth failed: ' + errMsg));
            });
            return;
          } else {
            resolve(token);
          }
        });
      };

      if (forceAccountChooser) {
        clearCachedTokens().then(runInteractive).catch(function(err) {
          reject(err);
        });
      } else {
        runInteractive();
      }
    });
  });

  return authInteractiveInFlight.finally(function() {
    clearInteractiveLock().finally(function() {
      authInteractiveInFlight = null;
    });
  });
};

var getValidToken = function(options) {
  var opts = options || {};
  var interactive = !!opts.interactive;

  return new Promise(function(resolve, reject) {
    var clientId = getOAuthClientIdFromManifest();
    if (!hasValidOAuthClientId(clientId)) {
      reject(new Error('OAuth client_id is not configured in manifest.json. Replace the placeholder with your Chrome Extension OAuth Client ID.'));
      return;
    }

    getNonInteractiveToken().then(function(token) {
      resolve(token);
    }).catch(function(nonInteractiveErr) {
      if (!interactive) {
        reject(new Error('Auth required: ' + nonInteractiveErr.message));
        return;
      }

      if (Date.now() - authLastInteractiveCancelAt < AUTH_INTERACTIVE_COOLDOWN_MS) {
        reject(new Error('Sign-in canceled recently. Use Reconnect Google when you are ready.'));
        return;
      }

      signInWithGoogle({ forceAccountChooser: false }).then(resolve).catch(reject);
    });
  });
};

var isAuthenticated = function() {
  return new Promise(function(resolve) {
    chrome.identity.getAuthToken({ interactive: false }, function(token) {
      resolve(!!token && !chrome.runtime.lastError);
    });
  });
};

var revokeAuth = function() {
  return new Promise(function(resolve) {
    chrome.identity.getAuthToken({ interactive: false }, function(token) {
      if (token) {
        chrome.identity.removeCachedAuthToken({ token: token }, function() {
          fetch('https://accounts.google.com/o/oauth2/revoke?token=' + token).catch(function() {});
        });
      }
      resolve();
    });
  });
};
