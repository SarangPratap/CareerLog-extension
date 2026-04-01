# Careerlog

Track job applications from Gmail to Google Sheets automatically, with your own AI provider, in your own browser.

No backend. No data warehouse. No monthly SaaS dependency.

---

## Why This Project Is Worth Buying

Careerlog solves a painful workflow that every active job seeker has: keeping applications updated across dozens of ATS emails, interview updates, and status changes.

What makes this sellable:

- Clear painkiller product: removes manual spreadsheet admin from the job search process.
- Trust-first architecture: privacy posture is strong and easy to explain to users.
- Fast user activation: onboarding gets users from install to first sync in minutes.
- Low operating overhead: no backend, no infra bill, no on-call burden.
- Flexible AI economics: supports Gemini, Claude, OpenAI, and local/custom models.

If you are packaging this as a product or acquisition asset, the core value story is simple:

"Users keep full ownership of their data while getting automation usually locked behind subscriptions."

---

## Product Snapshot

- Platform: Chrome Extension (Manifest V3)
- Core workflow: Gmail events -> filtering -> AI parsing -> Google Sheets updates
- Data ownership: user-controlled Google account and spreadsheet
- AI providers: Gemini, Claude, OpenAI, custom OpenAI-compatible, Ollama local models
- Sync behavior: initial backfill (15 or 30 days) + ongoing catch-up every 5 minutes
- UI surfaces: popup, setup wizard, settings, full dashboard

---

## Business Hooks You Can Use In Pitch Decks

Use these lines when positioning the project to buyers, partners, or early customers:

- "Own your pipeline, not just your notes."
- "The privacy-first job tracker: your inbox, your AI key, your sheet."
- "From application email to organized tracker row in seconds."
- "No backend risk, no subscription lock-in, no vendor data hostage scenario."
- "An MVP that already behaves like a product, not a prototype."

---

## How It Works

Initial setup flow:

1. User picks AI provider and enters key (or configures local/custom endpoint).
2. User signs in with Google via Chrome Identity.
3. Extension creates a formatted Google Sheet with `Applications` and `Interview Log` tabs.
4. User chooses sync range (`last15` or `last30`) for first import.
5. Extension parses candidate emails and writes structured rows.

Ongoing automation:

- Polling alarm runs every 5 minutes.
- Wake triggers run on Chrome startup and window focus.
- Gmail history API is used for incremental catch-up.
- If Gmail history expires, extension falls back to a last-7-days scan.

Matching and updates:

- Row matching prioritizes Job URL, then company/role fuzzy match, then company fallback for update events.
- Existing rows get status/round updates.
- New opportunities insert at top of sheet.

---

## Privacy And Security Positioning

This is a major selling point and should be front-and-center:

- Emails are processed inside the extension runtime.
- There is no app-owned backend receiving mailbox content.
- OAuth is handled through Chrome Identity APIs.
- Data is persisted in `chrome.storage.local` and user-owned Google Sheets.
- Custom API endpoints are constrained to `https://` or localhost HTTP for safer local runtimes.
- AI JSON responses are schema-restricted before writing to Sheets.

---

## Features

- Multi-provider AI parsing with provider-specific verification logic.
- Local model support via Ollama (`/api/chat` with `/api/generate` fallback).
- Account-to-sheet binding for multi-account Google usage.
- Real-time status and diagnostics in settings.
- Manual `Sync now` controls in popup and dashboard.
- Interview pipeline visualization and activity feed in dashboard.
- Structured onboarding with progress UI and completion state.

---

## Tech Stack

- Chrome Extension: Manifest V3 service worker architecture
- Auth: Chrome Identity API
- Email source: Gmail API (`gmail.readonly`)
- Storage target: Google Sheets API (`spreadsheets`)
- UI: Vanilla HTML/CSS/JS
- Persistence: `chrome.storage.local`

---

## Quick Start

### 1. Configure Google Cloud OAuth

1. Create or select a project in Google Cloud Console.
2. Enable APIs:
   - Gmail API
   - Google Sheets API
3. Create OAuth 2.0 Client ID with application type `Chrome Extension`.
4. Add your extension ID from `chrome://extensions`.
5. Put the client ID into `manifest.json` under `oauth2.client_id`.

Important: do not leave placeholder client IDs. Chrome auth will fail with `bad client id` style errors.

### 2. (Optional) Generate Icons

```bash
pip install pillow
python scripts/generate_icons.py
```

### 3. Load Extension

1. Open `chrome://extensions`
2. Turn on `Developer mode`
3. Click `Load unpacked`
4. Select this repository folder

### 4. Complete Onboarding

1. Open extension popup and click `Get started`
2. Select AI provider
3. Add API key (optional for local/custom)
4. Connect Google
5. Choose initial sync range and start sync

---

## AI Provider Setup

| Provider | Typical Cost Profile | Key URL |
|---|---|---|
| Gemini | Free tier available | https://aistudio.google.com/app/apikey |
| Claude | Paid usage | https://console.anthropic.com/keys |
| OpenAI | Paid usage | https://platform.openai.com/api-keys |
| Ollama (local) | Local compute | No cloud key required |

Local/custom example:

- Provider: `Custom / Local Model`
- API Type: `Ollama`
- Base URL: `http://localhost:11434`
- Model: `llama3.1`
- API key: optional for local Ollama

---

## Project Structure

```text
Job-Tracker/
|- manifest.json
|- background.js
|- lib/
|  |- auth.js
|  |- gmail.js
|  |- filter.js
|  |- ai.js
|  |- sheets.js
|- popup/
|  |- popup.html
|  |- popup.js
|- onboarding/
|  |- onboarding.html
|  |- onboarding.js
|- dashboard/
|  |- dashboard.html
|  |- dashboard.js
|- settings/
|  |- settings.html
|  |- settings.js
|- styles/
|  |- tokens.css
|  |- popup.css
|  |- onboarding.css
|  |- dashboard.css
|- scripts/
|  |- generate_icons.py
```

---

## Operational Notes For Buyers

- `totalProcessed` is an event counter from sync processing, not a direct sheet row count.
- Applied date logic prefers parsed date, then source email date, and avoids fabricating dates for update-type emails.
- Gmail history expiration is handled with a fallback scan, reducing silent data gaps.
- Duplicate reduction is improved by matching by job URL before fuzzy company/role checks.

These are the kinds of details buyers look for because they reduce support burden post-handoff.

---

## Troubleshooting

Sync issues:

- Inspect service worker logs in `chrome://extensions` -> Careerlog -> `Service Worker`.
- Confirm provider config and API key in Settings.
- Run `Sync now` from popup or dashboard.

OAuth issues:

- Verify `manifest.json` has a valid Chrome Extension OAuth client ID.
- Reconnect Google from Settings.

Sheet write issues:

- Confirm sheet exists and account still has access.
- Use Settings diagnostics to inspect last error and rerun sync.

No detections:

- Validate your emails match query patterns (ATS domains, application/interview/rejection keywords).
- Trigger manual sync after recent inbox activity.

---

## Positioning Summary

Careerlog is a practical, production-leaning automation asset with a strong trust narrative:

- Users keep control of inbox data.
- Setup and ongoing usage are simple.
- Architecture is low-cost to maintain.
- Market demand is persistent and obvious.

That combination makes it attractive for founders, indie makers, career-tech operators, and agencies that want a monetizable product without backend complexity.
