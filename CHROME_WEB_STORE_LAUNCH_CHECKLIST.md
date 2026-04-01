# Chrome Web Store Launch Checklist

Use this checklist before submitting Careerlog.

## 1. Package Quality

- [x] `manifest.json` version bumped for release
- [x] Icons present (16/48/128)
- [ ] No debug-only strings or dead UI controls
- [ ] Onboarding flow tested end-to-end on a clean Chrome profile

## 2. OAuth And Google Cloud

- [ ] OAuth consent screen configured in Google Cloud
- [ ] OAuth app publishing status set correctly
- [ ] Chrome Extension OAuth client uses production extension ID
- [ ] Gmail API enabled
- [ ] Google Sheets API enabled
- [ ] Redirect/account configuration verified

## 3. Permissions Review

- [x] Requested permissions are minimal and justified
- [x] Broad host access is not granted by default
- [x] Custom API host permissions are requested at runtime
- [x] Permission usage is explained in store listing and privacy policy

## 4. Policy Documents

- [ ] Public privacy policy URL is live
- [x] Support contact email listed
- [ ] Data usage disclosure prepared for store form

Recommended docs in this repo:

- `PRIVACY_POLICY.md`
- `README.md`

## 5. Store Listing Assets

- [ ] Short description
- [ ] Detailed description
- [ ] Screenshots (popup, onboarding, dashboard)
- [ ] Promotional images (optional)
- [ ] Category/tags selected

## 6. Functional Testing

- [ ] New install flow works
- [ ] Google sign-in works
- [ ] Initial sync (`last15`, `last30`) works
- [ ] Incremental sync works
- [ ] Manual sync from popup/dashboard/settings works
- [ ] Custom provider verification works
- [ ] Local Ollama flow works (if documented in listing)

## 7. Failure-Path Testing

- [ ] Invalid API key shows actionable error
- [ ] Missing OAuth client ID error is clear
- [ ] Sheet permission/404 errors are clear
- [ ] History expiration fallback behavior works
- [ ] Runtime errors appear in diagnostics

## 8. Release Operations

- [ ] Create release git tag
- [ ] Build zip from repository root
- [ ] Upload to Chrome Web Store Developer Dashboard
- [ ] Fill justification fields clearly
- [ ] Submit and monitor review feedback

## 9. After Approval

- [ ] Publish announcement/update notes
- [ ] Monitor Issues and support email
- [ ] Track approval feedback for next release

## Useful Notes

- Keep permissions and claims aligned with real behavior.
- Any statement like "data never leaves browser" must account for selected AI provider calls.
- If adding analytics later, update both policy and listing disclosures first.
