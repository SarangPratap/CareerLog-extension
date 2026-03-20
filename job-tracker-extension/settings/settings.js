const providerEl = document.getElementById("provider");
const apiKeyEl = document.getElementById("api-key");
const sensitivityEl = document.getElementById("sensitivity");
const sheetIdEl = document.getElementById("sheet-id");
const trackOutreachEl = document.getElementById("track-outreach");
const notificationsEl = document.getElementById("notifications");
const toggleKeyButton = document.getElementById("toggle-key");
const connectGoogleButton = document.getElementById("connect-google");
const saveSettingsButton = document.getElementById("save-settings");
const goHomeButton = document.getElementById("go-home");
const openDashboardButton = document.getElementById("open-dashboard");
const statusEl = document.getElementById("status");

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
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
  const trackOutreach = trackOutreachEl.checked;
  const notificationsEnabled = notificationsEl.checked;

  if (!aiApiKey) {
    setStatus("Please enter your API key.", true);
    return;
  }

  if (!isValidKeyForProvider(provider, aiApiKey)) {
    setStatus(`This does not look like a valid ${provider} API key.`, true);
    return;
  }

  if (sheetId && !/^[A-Za-z0-9-_]{20,}$/.test(sheetId)) {
    setStatus("Sheet ID format looks invalid.", true);
    return;
  }

  await chrome.storage.local.set({
    aiProvider: provider,
    aiApiKey,
    sheetId,
    sensitivity,
    trackOutreach,
    notificationsEnabled
  });

  setStatus("Settings saved.");
}

async function reconnectGoogle() {
  try {
    await getValidToken();
    setStatus("Google account connected.");
  } catch (error) {
    setStatus(error?.message || "Google auth failed.", true);
  }
}

toggleKeyButton.addEventListener("click", () => {
  const nextType = apiKeyEl.type === "password" ? "text" : "password";
  apiKeyEl.type = nextType;
  toggleKeyButton.textContent = nextType === "password" ? "Show" : "Hide";
});

saveSettingsButton.addEventListener("click", saveSettings);
connectGoogleButton.addEventListener("click", reconnectGoogle);
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
    "sheetId",
    "sensitivity",
    "trackOutreach",
    "notificationsEnabled"
  ]);

  providerEl.value = state.aiProvider || "gemini";
  apiKeyEl.value = state.aiApiKey || "";
  sheetIdEl.value = state.sheetId || "";
  sensitivityEl.value = state.sensitivity || "balanced";
  trackOutreachEl.checked = Boolean(state.trackOutreach);
  notificationsEl.checked = Boolean(state.notificationsEnabled);
})();
