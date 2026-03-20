// lib/auth.js
// OAuth token management via Chrome Identity API.
// All functions declared as var so importScripts() exposes them globally.

var getValidToken = function() {
  return new Promise(function(resolve, reject) {
    chrome.identity.getAuthToken({ interactive: false }, function(token) {
      if (chrome.runtime.lastError || !token) {
        chrome.identity.getAuthToken({ interactive: true }, function(token2) {
          if (chrome.runtime.lastError || !token2) {
            reject(new Error('Auth failed: ' + (chrome.runtime.lastError && chrome.runtime.lastError.message)));
          } else {
            resolve(token2);
          }
        });
      } else {
        resolve(token);
      }
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
