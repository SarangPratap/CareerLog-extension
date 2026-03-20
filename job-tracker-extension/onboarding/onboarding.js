const providers = document.querySelectorAll(".provider");
const toStep2Button = document.getElementById("to-step-2");
const apiKeyInput = document.getElementById("api-key");
const toggleKeyButton = document.getElementById("toggle-key");
const keyLink = document.getElementById("key-link");
const saveKeyButton = document.getElementById("save-key");
const connectGoogleButton = document.getElementById("connect-google");
const createSheetButton = document.getElementById("create-sheet");
const firstSyncWindowEl = document.getElementById("first-sync-window");
const progressWrapEl = document.getElementById("sync-progress-wrap");
const progressLabelEl = document.getElementById("sync-progress-label");
const progressEl = document.getElementById("sync-progress");
const openSheetLink = document.getElementById("open-sheet");
const statusEl = document.getElementById("status");

const keyPages = {
  gemini: "https://aistudio.google.com/app/apikey",
  claude: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys"
};

let selectedProvider = "gemini";
let authToken = null;
let createdSheetId = null;
let progressTimerId = null;

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function setActiveStep(stepNumber) {
  document.querySelectorAll(".step").forEach((section) => {
    const step = Number(section.dataset.step);
    section.classList.toggle("active", step === stepNumber);
    section.classList.toggle("done", step < stepNumber);
  });

  document.querySelectorAll(".progress li").forEach((item, index) => {
    const step = index + 1;
    item.classList.toggle("done", step < stepNumber);
    item.classList.toggle("active", step === stepNumber);
  });
}

function updateProviderUI() {
  providers.forEach((button) => {
    button.classList.toggle("selected", button.dataset.provider === selectedProvider);
  });

  keyLink.href = keyPages[selectedProvider] || keyPages.gemini;
}

providers.forEach((button) => {
  button.addEventListener("click", () => {
    selectedProvider = button.dataset.provider;
    updateProviderUI();
  });
});

toStep2Button.addEventListener("click", async () => {
  await chrome.storage.local.set({ aiProvider: selectedProvider });
  setActiveStep(2);
  apiKeyInput.focus();
});

toggleKeyButton.addEventListener("click", () => {
  const nextType = apiKeyInput.type === "password" ? "text" : "password";
  apiKeyInput.type = nextType;
  toggleKeyButton.textContent = nextType === "password" ? "Show" : "Hide";
});

saveKeyButton.addEventListener("click", async () => {
  const aiApiKey = apiKeyInput.value.trim();
  if (!aiApiKey) {
    setStatus("Please paste your API key.", true);
    return;
  }

  await chrome.storage.local.set({ aiProvider: selectedProvider, aiApiKey });
  connectGoogleButton.disabled = false;
  setActiveStep(3);
  setStatus("API key saved. Connect Google to continue.");
});

connectGoogleButton.addEventListener("click", async () => {
  try {
    authToken = await getValidToken();
    createSheetButton.disabled = false;
    setActiveStep(4);
    setStatus("Google account connected.");
  } catch (error) {
    setStatus(error?.message || "Google connection failed.", true);
  }
});

createSheetButton.addEventListener("click", async () => {
  try {
    if (!authToken) {
      authToken = await getValidToken();
    }

    progressWrapEl.classList.remove("hidden");
    progressLabelEl.textContent = "Creating sheet...";
    progressEl.value = 5;

    const firstSyncWindowDays = firstSyncWindowEl.value;
    await chrome.storage.local.set({ firstSyncWindowDays });

    createdSheetId = await createJobTrackerSheet(authToken);
    await chrome.storage.local.set({ setupComplete: true });

    if (progressTimerId) {
      clearInterval(progressTimerId);
    }
    progressTimerId = setInterval(async () => {
      const { syncProgress } = await chrome.storage.local.get(["syncProgress"]);
      const total = Number(syncProgress?.total || 0);
      const current = Number(syncProgress?.current || 0);
      const percent = total > 0 ? Math.floor((current / total) * 100) : 0;
      progressEl.value = Math.max(progressEl.value, percent);
      progressLabelEl.textContent = `Sync: ${syncProgress?.stage || "starting"} (${current}/${total})`;
      if (syncProgress?.stage === "done") {
        progressEl.value = 100;
      }
    }, 1500);

    await chrome.runtime.sendMessage({ type: "SYNC_INITIAL" });

    openSheetLink.classList.remove("hidden");
    openSheetLink.href = `https://docs.google.com/spreadsheets/d/${createdSheetId}`;

    setStatus("Setup complete. Your tracker is ready.");
  } catch (error) {
    setStatus(error?.message || "Failed to create sheet.", true);
  }
});

(async () => {
  const state = await chrome.storage.local.get(["aiProvider", "aiApiKey", "sheetId", "firstSyncWindowDays"]);

  if (state.aiProvider) {
    selectedProvider = state.aiProvider;
  }

  updateProviderUI();

  if (state.aiApiKey) {
    connectGoogleButton.disabled = false;
  }

  if (state.sheetId) {
    createdSheetId = state.sheetId;
    openSheetLink.classList.remove("hidden");
    openSheetLink.href = `https://docs.google.com/spreadsheets/d/${createdSheetId}`;
    setStatus("Setup already completed. You can open your sheet.");
  }

  if (state.firstSyncWindowDays) {
    firstSyncWindowEl.value = state.firstSyncWindowDays;
  }
})();
