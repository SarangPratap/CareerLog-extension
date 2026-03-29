const providerEl = document.getElementById("provider");
const apiKeyEl = document.getElementById("api-key");
const sensitivityEl = document.getElementById("sensitivity");
const sheetIdEl = document.getElementById("sheet-id");
const trackOutreachEl = document.getElementById("track-outreach");
const notificationsEl = document.getElementById("notifications");
const customConfigEl = document.getElementById("custom-config");
const customApiBaseEl = document.getElementById("custom-api-base");
const customModelEl = document.getElementById("custom-model");
const customApiTypeEl = document.getElementById("custom-api-type");
const verifyCustomButton = document.getElementById("verify-custom");
const customVerifyStatusEl = document.getElementById("custom-verify-status");
const toggleKeyButton = document.getElementById("toggle-key");
const connectGoogleButton = document.getElementById("connect-google");
const signOutGoogleButton = document.getElementById("sign-out-google");
const openOnboardingButton = document.getElementById("open-onboarding");
const resetSyncStateButton = document.getElementById("reset-sync-state");
const clearRuntimeErrorsButton = document.getElementById("clear-runtime-errors");
const saveSettingsButton = document.getElementById("save-settings");
const goHomeButton = document.getElementById("go-home");
const openDashboardButton = document.getElementById("open-dashboard");
const statusEl = document.getElementById("status");
const authStateEl = document.getElementById("auth-state");
const diagSyncStateEl = document.getElementById("diag-sync-state");
const diagLastSyncEl = document.getElementById("diag-last-sync");
const diagLastErrorEl = document.getElementById("diag-last-error");
const diagLastErrorTimeEl = document.getElementById("diag-last-error-time");
const diagRefreshButton = document.getElementById("diag-refresh");
const diagSyncNowButton = document.getElementById("diag-sync-now");
const diagInitialRangeEl = document.getElementById("diag-initial-range");
const diagRunInitialButton = document.getElementById("diag-run-initial");
const diagStatusEl = document.getElementById("diag-status");

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function setCustomVerifyStatus(message, isError = false) {
  customVerifyStatusEl.textContent = message;
  customVerifyStatusEl.classList.toggle("error", isError);
}

function setDiagStatus(message, isError = false) {
  diagStatusEl.textContent = message;
  diagStatusEl.classList.toggle("error", isError);
}

function formatTime(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

function updateProviderUi() {
  customConfigEl.style.display = providerEl.value === "custom" ? "grid" : "none";
}

function getCustomCompletionsUrl(baseUrl) {
  const cleaned = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(cleaned)) {
    return cleaned;
  }
  if (/\/v\d+(\/.*)?$/i.test(cleaned)) {
    return `${cleaned}/chat/completions`;
  }
  return `${cleaned}/v1/chat/completions`;
}

function getOllamaChatUrl(baseUrl) {
  const cleaned = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (/\/api\/chat$/i.test(cleaned)) {
    return cleaned;
  }
  return `${cleaned}/api/chat`;
}

function isAllowedCustomBaseUrl(baseUrl) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return false;
  }

  if (parsed.protocol === "https:") return true;
  if (parsed.protocol !== "http:") return false;

  const host = (parsed.hostname || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function isLikelyOllamaBaseUrl(baseUrl) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return false;
  }

  const host = (parsed.hostname || "").toLowerCase();
  const port = String(parsed.port || "");
  const path = String(parsed.pathname || "").toLowerCase();
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";

  if (!isLocal) return false;
  if (port === "11434") return true;
  return path.includes("/api/chat") || path.includes("/api/generate");
}

async function verifyCustomProviderConfig() {
  const baseUrl = customApiBaseEl.value.trim();
  const model = customModelEl.value.trim();
  const apiType = customApiTypeEl.value || "openai";
  const apiKey = apiKeyEl.value.trim();

  if (!baseUrl || !model) {
    throw new Error("Custom verification needs API base URL and model.");
  }
  if (!isAllowedCustomBaseUrl(baseUrl)) {
    throw new Error("Custom API base URL must be https://, or http://localhost/127.0.0.1 for local models.");
  }

  const response = await chrome.runtime.sendMessage({
    type: "VERIFY_CUSTOM_PROVIDER",
    payload: {
      baseUrl,
      model,
      apiType,
      apiKey
    }
  });

  if (!response || !response.success) {
    console.error("[Careerlog] Custom verification error", response?.error || response);
    throw new Error(response?.error || "Custom API verification failed. Check background logs for details.");
  }
}

async function onVerifyCustomClicked() {
  verifyCustomButton.disabled = true;
  setCustomVerifyStatus("Verifying custom API...");
  try {
    await verifyCustomProviderConfig();

    const baseUrl = customApiBaseEl.value.trim();
    const model = customModelEl.value.trim();
    const selectedType = customApiTypeEl.value || "openai";
    const effectiveType = selectedType !== "ollama" && isLikelyOllamaBaseUrl(baseUrl)
      ? "ollama"
      : selectedType;

    // Persist immediately so reload reflects what was just verified.
    await chrome.storage.local.set({
      aiProvider: "custom",
      customApiBaseUrl: baseUrl,
      customModel: model,
      customApiType: effectiveType
    });

    providerEl.value = "custom";
    customApiTypeEl.value = effectiveType;
    updateProviderUi();
    setCustomVerifyStatus("Custom API verified and saved.");
  } catch (error) {
    setCustomVerifyStatus(error?.message || "Custom API verification failed.", true);
  } finally {
    verifyCustomButton.disabled = false;
  }
}

function isValidKeyForProvider(provider, apiKey) {
  const validFormats = {
    claude: /^sk-ant-/,
    gemini: /^AIza/,
    openai: /^sk-/
  };

  if (!validFormats[provider]) {
    return true;
  }

  return validFormats[provider].test(apiKey);
}

async function saveSettings() {
  const provider = providerEl.value;
  const aiApiKey = apiKeyEl.value.trim();
  const sensitivity = sensitivityEl.value;
  const sheetId = sheetIdEl.value.trim();
  const customApiBaseUrl = customApiBaseEl.value.trim();
  const customModel = customModelEl.value.trim();
  const customApiType = customApiTypeEl.value || "openai";
  const trackOutreach = trackOutreachEl.checked;
  const notificationsEnabled = notificationsEl.checked;

  if (aiApiKey && !isValidKeyForProvider(provider, aiApiKey)) {
    setStatus(`This does not look like a valid ${provider} API key.`, true);
    return;
  }

  if (sheetId && !/^[A-Za-z0-9-_]{20,}$/.test(sheetId)) {
    setStatus("Sheet ID format looks invalid.", true);
    return;
  }

  if (provider === "custom" && (customApiBaseUrl || customModel || aiApiKey)) {
    if (!customApiBaseUrl) {
      setStatus("For custom provider, please enter API base URL.", true);
      return;
    }
    if (!isAllowedCustomBaseUrl(customApiBaseUrl)) {
      setStatus("Custom API base URL must be https://, or http://localhost/127.0.0.1 for local models.", true);
      return;
    }
    if (!customModel) {
      setStatus("For custom provider, please enter model name.", true);
      return;
    }

    try {
      await verifyCustomProviderConfig();
      setCustomVerifyStatus("Custom API verified successfully.");
    } catch (error) {
      setCustomVerifyStatus(error?.message || "Custom API verification failed.", true);
      setStatus("Cannot save custom provider: verification failed.", true);
      return;
    }
  }

  await chrome.storage.local.set({
    aiProvider: provider,
    aiApiKey,
    customApiBaseUrl,
    customModel,
    customApiType,
    sheetId,
    sensitivity,
    trackOutreach,
    notificationsEnabled
  });

  setStatus(aiApiKey ? "Settings saved." : "Settings saved. Add an API key later to enable AI parsing.");
}

async function reconnectGoogle() {
  connectGoogleButton.disabled = true;
  try {
    await signInWithGoogle({ forceAccountChooser: true });
    setStatus("Google account connected.");
    await refreshAuthState();
  } catch (error) {
    setStatus(error?.message || "Google auth failed.", true);
  } finally {
    connectGoogleButton.disabled = false;
  }
}

async function signOutGoogle() {
  try {
    const before = await chrome.storage.local.get(["currentGoogleEmail", "accountSheetMap"]);
    await revokeAuth();
    const currentGoogleEmail = before.currentGoogleEmail || "";
    const accountSheetMap = before.accountSheetMap || {};
    if (currentGoogleEmail && accountSheetMap[currentGoogleEmail]) {
      delete accountSheetMap[currentGoogleEmail];
    }

    await chrome.storage.local.set({ accountSheetMap });
    await chrome.storage.local.remove([
      "sheetId",
      "currentGoogleEmail",
      "lastHistoryId",
      "initialSyncDone",
      "syncInProgress",
      "syncProgress",
      "totalProcessed",
      "lastSyncTime",
      "lastError",
      "lastErrorTime"
    ]);

    setStatus("Signed out from Google for this extension.");
    await refreshAuthState();
    await refreshDiagnostics();
  } catch (error) {
    setStatus(error?.message || "Google sign out failed.", true);
  }
}

async function refreshAuthState() {
  try {
    const authed = await isAuthenticated();
    authStateEl.textContent = authed
      ? "Google account status: Connected"
      : "Google account status: Not connected";
    authStateEl.classList.toggle("error", !authed);
  } catch (error) {
    authStateEl.textContent = "Google account status: Unknown";
    authStateEl.classList.add("error");
  }
}

async function resetSyncState() {
  await chrome.storage.local.remove([
    "lastHistoryId",
    "initialSyncDone",
    "syncInProgress",
    "syncProgress",
    "totalProcessed",
    "lastSyncTime",
    "lastError",
    "lastErrorTime"
  ]);
  setStatus("Sync state reset. Run setup wizard or trigger a fresh sync.");
}

async function clearRuntimeErrors() {
  await chrome.storage.local.remove(["lastError", "lastErrorTime"]);
  setStatus("Runtime errors cleared.");
  await refreshDiagnostics();
}

async function refreshDiagnostics() {
  const state = await chrome.storage.local.get([
    "syncInProgress",
    "syncProgress",
    "lastSyncTime",
    "lastError",
    "lastErrorTime",
    "initialSyncDone",
    "sheetId",
    "aiProvider"
  ]);

  let syncState = "Idle";
  if (state.syncInProgress) {
    syncState = `Syncing (${Number(state.syncProgress || 0)}%)`;
  } else if (!state.initialSyncDone) {
    syncState = "Setup incomplete";
  }

  diagSyncStateEl.value = syncState;
  diagLastSyncEl.value = formatTime(state.lastSyncTime);
  diagLastErrorEl.value = state.lastError || "-";
  diagLastErrorTimeEl.value = formatTime(state.lastErrorTime);
}

async function runSyncNowFromSettings() {
  diagSyncNowButton.disabled = true;
  setDiagStatus("Running sync...");

  chrome.runtime.sendMessage({ type: "SYNC_NOW" }, async (resp) => {
    if (chrome.runtime.lastError) {
      setDiagStatus(`Sync failed: ${chrome.runtime.lastError.message}`, true);
      diagSyncNowButton.disabled = false;
      await refreshDiagnostics();
      return;
    }

    if (!resp || !resp.success) {
      setDiagStatus(`Sync failed: ${(resp && resp.error) || "Unknown error"}`, true);
    } else {
      setDiagStatus("Sync completed successfully.");
    }

    diagSyncNowButton.disabled = false;
    await refreshDiagnostics();
  });
}

async function runInitialSyncFromSettings() {
  const range = diagInitialRangeEl.value || "last30";
  diagRunInitialButton.disabled = true;
  setDiagStatus(`Starting initial sync (${range})...`);

  chrome.runtime.sendMessage({ type: "START_INITIAL_SYNC", dateRange: range }, async (resp) => {
    if (chrome.runtime.lastError) {
      setDiagStatus(`Initial sync failed: ${chrome.runtime.lastError.message}`, true);
      diagRunInitialButton.disabled = false;
      await refreshDiagnostics();
      return;
    }

    if (!resp || !resp.success) {
      setDiagStatus(`Initial sync failed: ${(resp && resp.error) || "Unknown error"}`, true);
    } else {
      setDiagStatus("Initial sync started. Refresh status to monitor progress.");
    }

    diagRunInitialButton.disabled = false;
    await refreshDiagnostics();
  });
}

toggleKeyButton.addEventListener("click", () => {
  const nextType = apiKeyEl.type === "password" ? "text" : "password";
  apiKeyEl.type = nextType;
  toggleKeyButton.textContent = nextType === "password" ? "Show" : "Hide";
});

providerEl.addEventListener("change", updateProviderUi);
verifyCustomButton.addEventListener("click", onVerifyCustomClicked);
saveSettingsButton.addEventListener("click", saveSettings);
connectGoogleButton.addEventListener("click", reconnectGoogle);
signOutGoogleButton.addEventListener("click", signOutGoogle);
openOnboardingButton.addEventListener("click", () => {
  window.location.href = chrome.runtime.getURL("onboarding/onboarding.html");
});
resetSyncStateButton.addEventListener("click", resetSyncState);
clearRuntimeErrorsButton.addEventListener("click", clearRuntimeErrors);
diagRefreshButton.addEventListener("click", refreshDiagnostics);
diagSyncNowButton.addEventListener("click", runSyncNowFromSettings);
diagRunInitialButton.addEventListener("click", runInitialSyncFromSettings);
goHomeButton.addEventListener("click", () => {
  window.location.href = chrome.runtime.getURL("popup/popup.html");
});
openDashboardButton.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard/dashboard.html") });
});

(async () => {
  const state = await chrome.storage.local.get([
    "aiProvider",
    "aiApiKey",
    "customApiBaseUrl",
    "customModel",
    "customApiType",
    "sheetId",
    "sensitivity",
    "trackOutreach",
    "notificationsEnabled"
  ]);

  providerEl.value = state.aiProvider || "gemini";
  apiKeyEl.value = state.aiApiKey || "";
  customApiBaseEl.value = state.customApiBaseUrl || "";
  customModelEl.value = state.customModel || "";
  const inferredType = isLikelyOllamaBaseUrl(state.customApiBaseUrl || "") ? "ollama" : "openai";
  const resolvedType = state.customApiType || inferredType;
  customApiTypeEl.value = resolvedType;

  if (!state.customApiType && state.customApiBaseUrl) {
    await chrome.storage.local.set({ customApiType: resolvedType });
  }
  sheetIdEl.value = state.sheetId || "";
  sensitivityEl.value = state.sensitivity || "balanced";
  trackOutreachEl.checked = Boolean(state.trackOutreach);
  notificationsEl.checked = Boolean(state.notificationsEnabled);
  updateProviderUi();
  await refreshAuthState();
  await refreshDiagnostics();
})();
