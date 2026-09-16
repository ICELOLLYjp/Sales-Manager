# Gmail expense candidates — development handoff

Updated: 2026-09-17 (Japan time). Repo: `ICELOLLYjp/Sales-Manager`.

## Production state reported by the owner

- Gmail API enabled in Firebase project `t-shirtstock`; standalone OAuth Web client and redirect URI `https://asia-southeast1-t-shirtstock.cloudfunctions.net/gmailOAuthCallback`.
- The owner confirmed **both** `fjmthrs@gmail.com` and `icelolly.zakka@gmail.com` show 「接続済み」 in `gmail-connect.html` after separately consenting to Gmail readonly.
- Four existing Gmail Functions (start/callback/status/disconnect) have been deployed using **only** `firebase.cmd deploy --only functions:gmail-expenses --project t-shirtstock`. Stripe Functions were not targeted.
- The initial 401/invalid_client OAuth issue was resolved by using the matching client secret from the owner's locally downloaded OAuth JSON. The JSON, secret values and encryption key must never be copied into GitHub or chat. Do not recreate or rotate secrets without a concrete reason.
- On 2026-09-17 Japan time, the owner successfully fetched 25 metadata results from each connected account using the production preview. Both accounts reported additional results beyond the first page. No expense was posted.
- The live results confirmed that useful receipts and invoices are mixed with advertisements, incoming-payment notices and unrelated operational mail. Search matches must remain review candidates rather than automatically becoming expenses.
- Google OAuth verification status/long-term restricted-scope requirements remain a separate review item. The app can require separate consent screens.

## Phase 1 live: manual preview, not complete expense sync

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

## Phase 2 in development: explicit candidate storage

- Candidate storage is a separate, explicit action after preview. Merely fetching Gmail continues to write nothing.
- The server writes only to `gmailExpenseCandidates`. It does not update expense totals, `salesSessions`, sales, inventory or payment records.
- The document ID is a deterministic hash of Gmail account plus message ID. Rescanning the same email updates source metadata without creating another candidate.
- A rescan must not overwrite human review state, extracted amount/currency, payment assessment or expense-posting state.
- Stored records still contain metadata only. Email body and PDF parsing remain out of scope for this phase.
- Browser code does not write Firestore directly. The staff-authenticated Gmail Functions codebase performs the candidate write.

## Phase 3 in development: saved candidate review

- Staff can list saved candidates by month through a server callable. The browser does not read Firestore directly.
- Each candidate can be marked `kept`, `excluded` or returned to `unreviewed`.
- Every actual review-state change creates a separate audit record in `gmailExpenseCandidateAudit`.
- Same-date records with a normalized matching sender and subject are shown as possible duplicates. They remain separate records and are never deleted or merged automatically.
- Review actions do not post expenses and do not fetch bodies or attachments.
- Production review showed that one month can contain multiple events and general business expenses. Candidates therefore require an explicit scope: unassigned, general business, or one existing `salesSessions` event.
- Event assignment is independently auditable and can be used as a review-page filter. It is classification only and does not update `salesSessions.expenses`.

## Phase 4 in development: explicit evidence inspection

- Only candidates already marked `kept` may be inspected.
- Inspection is a separate user action. It retrieves a bounded text excerpt and attachment metadata from Gmail readonly.
- Raw body text, attachment bytes and OAuth tokens are not written to candidate records or logs.
- Currency and amount-looking strings are hints only. They are not accepted as an expense amount.
- PDF attachments are identified by metadata, but their contents are not fetched or parsed in this phase.
- The inspection response is temporary in the browser and does not post an expense.

## Phase 5 in development: human-reviewed evidence draft

- After temporary inspection, staff may explicitly save amount, currency, evidence status, expense category and description as an `evidenceReview` draft.
- `paid_evidence` and `invoiced` require a positive amount and supported currency. Unknown stays unknown.
- Saving the draft requires the candidate to be kept and assigned to an event or general business.
- Draft changes are audited. Raw body text and attachment bytes are not stored.
- Candidate amount and currency may be updated from the reviewed draft, but `expensePosted` remains false and no `salesSessions.expenses` value changes.
- A separate future action is still required to post an approved expense.

## Remaining work before full expense management

1. Review, merge, deploy and live-test candidate event assignment and event filtering. Deploy only the Gmail Functions codebase and never the tracked Firestore rules.
2. Confirm that event assignment and review-state changes persist using production candidate data.
3. Refine probable duplicate warnings after candidates are separated by event.
4. Live-test bounded body and attachment inspection on a kept production candidate.
5. Live-test manual evidence review storage using the confirmed Public Garden clothing-rack payment.
6. If a PDF attachment exists, add PDF-byte retrieval and parsing as a separate isolated phase. Preserve unknown amounts and distinguish invoice from payment evidence.
4. Add a separate, user-approved expense-posting action only after review. Never post during fetch, scan or candidate save.
5. Add per-account partial failures and weekly server sync only after the manual workflow is stable.
6. ChatGPT's own weekly reminders/summaries do not automatically populate Sales Manager.
