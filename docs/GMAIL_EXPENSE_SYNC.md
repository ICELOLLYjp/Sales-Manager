# Gmail expense candidates — development handoff

Updated: 2026-09-17 (Japan time). Repo: `ICELOLLYjp/Sales-Manager`.

## Production state reported by the owner

- Gmail API enabled in Firebase project `t-shirtstock`; standalone OAuth Web client and redirect URI `https://asia-southeast1-t-shirtstock.cloudfunctions.net/gmailOAuthCallback`.
- The owner confirmed **both** `fjmthrs@gmail.com` and `icelolly.zakka@gmail.com` show 「接続済み」 in `gmail-connect.html` after separately consenting to Gmail readonly.
- Four existing Gmail Functions (start/callback/status/disconnect) have been deployed using **only** `firebase.cmd deploy --only functions:gmail-expenses --project t-shirtstock`. Stripe Functions were not targeted.
- The initial 401/invalid_client OAuth issue was resolved by using the matching client secret from the owner's locally downloaded OAuth JSON. The JSON, secret values and encryption key must never be copied into GitHub or chat. Do not recreate or rotate secrets without a concrete reason.
- Production has **not** been shown to fetch email or post any expense. Google OAuth verification status/long-term restricted-scope requirements remain a separate review item. The app can require separate consent screens.

## Draft PR #6: first manual preview, not complete expense sync

- `functions-gmail/expensePreview.js` adds a staff-only callable `gmailExpensePreview`. It decrypts the stored server-side refresh token, refreshes the Google access token server-side, runs a bounded month-and-keyword Gmail search, and returns at most 25 message metadata rows **per selected account** (date, sender, subject, Gmail message/thread ID).
- `gmail-expenses.html` is an isolated user-driven preview page. The owner chooses a month and an individual connected account; no background polling occurs.
- No Gmail bodies, PDF attachments, invoice totals or payment proof are read in this first iteration; no merchant/amount/currency is inferred from a subject. Search matches are *possible* expenses, not confirmed expenses; results can include unrelated mail, and Gmail search may miss relevant messages.
- Preview results exist only in memory in the authenticated browser, disappear on reload, and are **not saved** as candidate records. Neither preview nor OAuth updates `salesSessions.expenses`, sales transactions, stock or financial totals. There is no expense-posting action.
- CI now installs the Gmail Functions dependencies and checks/smoke-tests the preview. Passing CI does **not** demonstrate that live Gmail fetching succeeds or that user access and Firestore rules are correct.

## Security constraints

- Keep Google OAuth JSON, client secrets, encrypted refresh tokens, key and Firebase staff-email allowlist off public GitHub, screenshots and chat.
- Only server-side code reads `gmailOAuthConnections`. Callable handlers require a verified Firebase Auth identity on `GMAIL_STAFF_EMAILS`.
- **The tracked `firestore.rules` is stale and permissive.** Previously verified *deployed* production rules used a verified-email allowlist and explicit collection matches, rejecting browser access to `gmailOAuthConnections`, `gmailOAuthStates` and `gmailExpenseCandidates`. Re-check if rules change. Never deploy the tracked rules or run unrestricted `firebase deploy`.
- Release preview with the Gmail-specific codebase only: `firebase.cmd deploy --only functions:gmail-expenses --project t-shirtstock`. There is no new Firestore rule deployment.

## Remaining work before full expense management

1. Review PR #6, then merge intentionally; update local project from latest main before deploying.
2. Deploy only Gmail Functions; verify the live callable using the authenticated `gmail-expenses.html` page. The UI page is published by the existing GitHub Pages main workflow after merge. Do not claim live email retrieval before testing.
3. Build separately: attachment/PDF parsing, stable idempotent candidate storage, duplicate review and audit trail, user-approved expense posting, per-account partial failures, and weekly server sync. Preserve reviewed choices on rescans and distinguish invoice from confirmed payment.
4. ChatGPT's own weekly reminders/summaries do not automatically populate Sales Manager. The app's weekly server sync is not yet implemented.
