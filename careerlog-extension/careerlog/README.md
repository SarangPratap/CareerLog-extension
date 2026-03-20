# Careerlog — Chrome Extension

> Automatically tracks job applications from Gmail into your Google Sheet.
> Your emails never leave your browser. No backend. No subscription.

---

## Setup (5 steps)

### 1. Get a Google OAuth Client ID

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Enable these APIs:
   - Gmail API
   - Google Sheets API
   - Google Drive API
4. Go to **Credentials → Create Credentials → OAuth 2.0 Client ID**
5. Application type: **Chrome Extension**
6. Add your extension ID (get it from `chrome://extensions` after loading unpacked)
7. Copy the Client ID

### 2. Add Client ID to manifest.json

```json
"oauth2": {
  "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
  ...
}
```

### 3. Generate placeholder icons

```bash
pip install pillow
python scripts/generate_icons.py
```

### 4. Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this folder

### 5. Run setup

1. Click the Careerlog icon in your toolbar
2. Click **Get started**
3. Choose your AI provider and paste your API key
4. Sign in with Google
5. Pick your date range and click **Start syncing**

---

## Getting API Keys

| Provider | Free tier | Get key |
|---|---|---|
| **Gemini** | Yes — 1500/day free | [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| **Claude** | No | [console.anthropic.com](https://console.anthropic.com/keys) |
| **OpenAI** | No | [platform.openai.com](https://platform.openai.com/api-keys) |

---

## File Structure

```
careerlog/
├── manifest.json          ← Extension config — ADD YOUR CLIENT ID HERE
├── background.js          ← Service worker (sync logic)
├── lib/
│   ├── auth.js            ← OAuth token management
│   ├── gmail.js           ← Gmail API + email parsing
│   ├── filter.js          ← 4-layer job email filter
│   ├── ai.js              ← Claude / Gemini / OpenAI
│   └── sheets.js          ← Google Sheets read/write
├── popup/
│   ├── popup.html         ← Toolbar popup (320px)
│   └── popup.js
├── onboarding/
│   ├── onboarding.html    ← 4-step setup flow
│   └── onboarding.js
├── dashboard/
│   └── dashboard.html     ← Full dashboard (opens as tab)
├── styles/
│   └── tokens.css         ← Design tokens + fonts
├── icons/                 ← Generate with scripts/generate_icons.py
└── scripts/
    └── generate_icons.py  ← Icon generator (pip install pillow)
```

---

## How it works

```
Every 5 minutes (or on Chrome wake-up):
  Gmail historyId → fetch new emails → 4-layer filter → AI parse → update Sheet

First run:
  User picks date range → Gmail query with after:date → batch fetch → AI parse → Sheet
```

---

## Privacy

- Your emails are never sent to any server we control
- API calls go directly: your browser → AI provider (using your key)
- Data lives only in your own Google Sheet
- OAuth tokens managed by Chrome — we never see them
- Open source — read the code yourself

---

## Troubleshooting

**Extension not syncing?**
- Check `chrome://extensions` → Careerlog → **Service Worker** → Inspect → Console
- Verify your API key is valid (Settings page)
- Try clicking **Sync now** in the popup

**No emails being detected?**
- Open Gmail and search: `subject:(application received) OR from:(greenhouse.io)`
- If that returns results but the extension doesn't catch them, your emails may use different subject lines
- Open Settings and check the filter sensitivity

**Sheet not updating?**
- Make sure you completed all 4 onboarding steps
- Check that your Google Sheet still exists (it may have been deleted)
- Try re-connecting Google in Settings

**historyId expired error?**
- This happens if Chrome was closed for more than 30 days
- The extension will automatically fall back to scanning the last 7 days
- Open the dashboard and click **Sync now** to trigger a fresh scan
