# Gmail expense sync — implementation and rollout

**Status: draft PR, not deployed.** No Gmail accounts have been linked to Sales Manager. The ChatGPT weekly report is a separate automation and does not populate Sales Manager. No expense is posted automatically.

## Implemented in this branch

- `js/services/gmailExpenseCandidateService.js`: normalize candidate records and flag potential duplicates without posting expenses.
- `functions-gmail/`: dedicated Firebase Functions codebase, separate from the deployed Stripe codebase. Staff-only callable OAuth start, status, disconnect; public one-use, 10-minute callback state; Gmail readonly scope; enforce the *actual* connected Gmail email against the chosen account; store only AES-256-GCM-encrypted refresh tokens. OAuth callback never exposes tokens in redirects.
- `firestore.rules`: excludes all three Gmail server-only root collections from the existing signed-in wildcard rule. Explicit `allow false` blocks alone are insufficient because Firestore rules OR together.
- GitHub Actions runs syntax checks and unit tests on this branch. This does NOT validate live OAuth, deployed IAM, or production Firestore rules.

## Planned OAuth client settings (not yet deployed)

In **existing Google Cloud project `t-shirtstock`**, create a *new* Web application OAuth client named `ICELOLLY Gmail Expense Sync`; leave the Firebase-created client untouched.

- Authorized JavaScript origins: leave empty (Google consent is server-side, not JavaScript token handling).
- Authorized redirect URI: `https://asia-southeast1-t-shirtstock.cloudfunctions.net/gmailOAuthCallback`

That URI is derived from the configured project, region and exported function name. **After deploying, verify the exact HTTP URL printed by Firebase CLI, and correct the OAuth client URI if different; an exact match is required.** The callback URL is not live until deployment. Never put the OAuth client secret, refresh token, token key, or a downloaded OAuth JSON file in GitHub or ChatGPT.

## Required release order (a developer/operator with local Firebase CLI)

1. In Firebase Console > Firestore Database > Rules, **inspect the currently deployed rules first**. Compare them with repository rules; the repository's existing fallback allowed any signed-in user. Reconcile any production-only rules rather than blindly overwriting them. Ensure that `gmailOAuthStates`, `gmailOAuthConnections`, and future `gmailExpenseCandidates` are all blocked to client reads/writes (including by an unrelated signed-in user). Do not activate OAuth token storage until this is verified.
2. Review and merge the branch only after code/security review. Use a local, authenticated Firebase CLI (not Cloud Console UI) with project ID `t-shirtstock`. Explicitly deploy reviewed rules separately: `firebase deploy --project t-shirtstock --only firestore:rules`. Verify the live rule result.
3. Create the new Web OAuth client with the callback URI above. Keep its ID and secret locally. Set Firebase Functions secrets via interactive CLI, NEVER in repository files: `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_TOKEN_ENCRYPTION_KEY` (base64-encoded **32 random bytes**), `GMAIL_STAFF_EMAILS` (comma-separated exact Firebase Auth email allowlist). Do not share values in chat or screenshots.
4. Install dependencies under `functions-gmail`; deploy **only** the new codebase: `firebase deploy --project t-shirtstock --only functions:gmail-expenses`. Do not deploy all functions or accidentally modify Stripe. Check the deployed `gmailOAuthCallback` URL and invoker permissions. Only the callback should be publicly invokable; the other functions are Firebase Auth-verified callables with a server-side staff allowlist.
5. Wire a guarded Settings UI to `gmailOAuthStart`, `gmailOAuthStatus`, `gmailOAuthDisconnect`. The backend does **not** yet fetch Gmail or implement the on-demand Sync button. Each Gmail owner must explicitly authorize the respective address through the separate OAuth flow. Verify connected account via Gmail profile before storage; `login_hint` alone does not select an account securely.
6. Implement Gmail message/PDF retrieval, partial-failure sync status, idempotent candidate upsert and review UI. Never write `salesSessions.expenses`, `salesTransactions`, inventory or sales accounting totals during sync. Add server-only weekly fetch if desired. The existing ChatGPT weekly automation remains a separate report.

## OAuth personal-use limitation

`gmail.readonly` is a **restricted scope** and is subject to Google's verification/user limits. A small private-use app may be eligible for Google's personal-use exception, but do not assume it has been verified or is appropriate for public distribution. Never switch the project's already-production OAuth audience to Testing merely for convenience, as that may affect other clients and token lifetimes.

## Security and behavior contract

- Separate permission per `fjmthrs@gmail.com` and `icelolly.zakka@gmail.com`. Never assume the second Gmail is connected when only one succeeds.
- OAuth refresh tokens remain server-side encrypted and client-inaccessible. Only the encryption key and OAuth client secret are placed in Firebase Functions Secrets; neither belongs in Firestore or client code.
- Keep review decisions on rescans, warn rather than silently delete cross-account duplicates; invoice is not payment proof; unknown amounts remain unknown.
- Any eventual posting to the expense ledger requires a separate explicit confirmation. No mail send, change or delete scope is requested.
