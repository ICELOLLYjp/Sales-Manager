# Gmail expense sync — implementation and rollout

**Status: draft PR, not deployed.** No Gmail accounts have been linked to Sales Manager. The ChatGPT weekly report is a separate automation and does not populate Sales Manager. No expense is posted automatically.

## Implemented in this branch

- `js/services/gmailExpenseCandidateService.js`: normalize candidates and flag duplicates without posting expenses.
- `functions-gmail/`: a Firebase Functions codebase isolated from Stripe. Staff-only callable OAuth start/status/disconnect; public one-use callback with expiring state; Gmail readonly; verify the Gmail profile matches the selected account; AES-256-GCM-encrypted refresh tokens. No OAuth tokens in browser redirects.
- GitHub Actions syntax and unit checks; these cannot verify production deployment, live OAuth or Firestore rules.

## IMPORTANT: deployed Firestore rules differ from repository

A screenshot of the actual production rules dated 2026-09-10 shows `isAllowedUser()` checking verified email membership in an allowlist and **only explicitly named collection matches**. There is no catch-all matching other collections in the visible complete rule. By default, `gmailOAuthStates`, `gmailOAuthConnections` and `gmailExpenseCandidates` are therefore not readable or writable by browser clients under the shown rules. Confirm this against the exact active rules before storing any tokens.

The repository's existing `firestore.rules` on `main` is a **stale permissive template** allowing any signed-in user to access all collections. DO NOT deploy or copy it to production, including via `firebase deploy --only firestore:rules`. An earlier change to this PR's rule file also would have weakened the deployed allowlist; it was reverted, so **this PR deliberately does not change `firestore.rules`**. Do not publish the production staff-email allowlist into the public GitHub repository. Later security changes must start from an exact, privately retained backup of the deployed production rules and use rule tests before any separate deployment. `firebase.json` in main has only a Functions configuration, not a Firestore rules target.

## OAuth client settings

The owner created a distinct Google Cloud OAuth **Web application** client named `ICELOLLY Gmail Expense Sync` in project `t-shirtstock` and downloaded the OAuth JSON locally. Keep that file, the client ID/secret and any token out of ChatGPT, screenshots and public GitHub.

- Authorized JavaScript origins: blank (server-side OAuth).
- Authorized redirect URI: `https://asia-southeast1-t-shirtstock.cloudfunctions.net/gmailOAuthCallback`.
- This URL is planned, not yet live; compare against the exact Firebase CLI deployment output before attempting authorization. An exact match is required.

## Remaining release steps (local trusted operator)

1. Privately verify that currently deployed Firestore rules still match the production allowlist screenshot and deny browser access to all three Gmail collections. **Do not deploy repository Firestore rules.** Verify authorized staff Firebase Auth separately.
2. Review this PR's OAuth handlers, IAM, token encryption, OAuth state flow, production scopes and Google restricted-scope verification/personal-use requirements before merging and deploying. Do not switch the whole existing production OAuth app to Testing merely for convenience.
3. Using an authenticated local Firebase CLI and the **existing** project `t-shirtstock`, configure the secrets interactively (never commit or paste secret values here): `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_TOKEN_ENCRYPTION_KEY` (base64 for exactly 32 random bytes), and `GMAIL_STAFF_EMAILS` (staff Firebase Auth email allowlist). Keep the downloaded JSON entirely local.
4. Install `functions-gmail` dependencies and deploy **only** `functions:gmail-expenses`, never `functions:stripe` or all functions. Verify callback URI and invoker permissions. Only the OAuth callback should be publicly invokable; callable endpoints must verify Firebase Auth and the staff allowlist server-side.
5. Implement and deploy the authenticated connection UI, then separately authorize **each** Gmail account. This branch does not yet have the UI, Gmail retrieval, attachment/PDF parsing, candidate storage, an operational manual Sync button, or a server-side weekly sync. The ChatGPT weekly automation remains separate.
6. Implement Gmail fetching, partial failure and per-account status, idempotent candidate upsert and a review inbox. Do not write `salesSessions.expenses`, `salesTransactions`, inventory or accounting totals when syncing. Expense posting requires a distinct explicit confirmation feature in the future.

## Behavior contract

- `fjmthrs@gmail.com` and `icelolly.zakka@gmail.com` each require a separate Gmail readonly grant; never claim two accounts are connected on one token.
- OAuth refresh tokens remain encrypted on the server, with their key only in Firebase Functions Secrets; no tokens or raw messages in GitHub Pages/localStorage/logs/client-accessible Firestore.
- Preserve review choices during rescans; warn rather than silently drop potential duplicates; an invoice alone does not prove payment; unknown amounts remain unknown.
- No Gmail send/edit/delete scope or automatic expense posting.
