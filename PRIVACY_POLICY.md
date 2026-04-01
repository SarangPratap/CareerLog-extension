# Careerlog Privacy Policy

Effective date: April 1, 2026

Careerlog is a Chrome extension that helps users track job applications by reading job-related Gmail messages and updating a Google Sheet owned by the user.

## Data We Access

Careerlog requests:

- Gmail read-only access (`https://www.googleapis.com/auth/gmail.readonly`)
- Google Sheets access (`https://www.googleapis.com/auth/spreadsheets`)

This access is used only to:

- detect job-related email updates
- parse those updates into structured application data
- write the results to the user's Google Sheet

## Data We Do Not Collect

Careerlog does not run an app-owned backend and does not store your Gmail data on developer servers.

Careerlog does not sell personal data.

## AI Provider Processing

If you configure Gemini, Claude, OpenAI, or a custom provider, relevant email snippets are sent directly from your extension runtime to the provider you selected, using your API key/settings.

The developer does not proxy or intermediate these requests.

You are responsible for reviewing your selected AI provider's privacy terms.

## Local Storage

Careerlog stores configuration in Chrome local extension storage, such as:

- selected AI provider
- API key (if provided)
- sheet ID
- sync status metadata

## Data Sharing

Careerlog does not share data with third parties other than:

- Google APIs required for extension functionality
- the AI provider you explicitly configure

## Security

- OAuth is handled using Chrome Identity APIs.
- Custom provider host access is requested at runtime.
- Supported custom endpoints are restricted to HTTPS or localhost HTTP.

## User Controls

You can:

- disconnect or reconnect Google account access
- clear sync/runtime state in Settings
- remove extension data by uninstalling the extension

## Contact

For privacy or bug reports:

- Email: chamola31@gmail.com
- GitHub Issues: use the repository Issues tab

## Changes To This Policy

This policy may be updated as the product evolves. The updated date above reflects the latest revision.
