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
- Candidate-save actions write only to `gmailExpenseCandidates`. They do not update expense totals, `salesSessions`, sales, inventory or payment records.
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
- A separate explicit action is required to post an approved expense.

## Phase 6 in development: bounded PDF text extraction

- PDF bytes are fetched only after the staff member explicitly inspects a kept candidate.
- At most 3 PDF attachments are considered. Each PDF is limited to 5 MiB and 20 pages.
- PDF text and attachment bytes are returned only in the callable response and are not written to Firestore or logs.
- Amount-looking strings from the PDF are suggestions only. A person must enter or confirm the amount, currency and evidence status before saving an evidence draft.
- A PDF invoice is not payment proof. PDF extraction does not set `paid_evidence` and never posts an expense.
- Scanned image-only PDFs may return no text. OCR is not part of this phase.
- The production candidate for Mori Market included one 105 KB PDF named `森之市｜2026 珈琲と花物語｜未払い項目確認.pdf`; metadata inspection succeeded before parser deployment.

## Phase 7 in development: explicit reviewed-candidate posting

- Only a kept event candidate with a `paid_evidence` draft, positive amount, supported currency and expense category can be posted.
- The browser displays the event, category, candidate amount, current category amount and resulting category amount in a separate confirmation dialog.
- The server requires the explicit confirmation value and checks that the current category amount has not changed since the dialog was shown.
- Candidate currency must match the event currency. A non-JPY event must already have an exchange rate.
- Posting updates the matching `salesSessions.expenses` category and marks the candidate `expensePosted` in one Firestore transaction.
- Retrying the same candidate is idempotent and never adds the amount twice. The posting creates an audit record.
- After posting, event assignment, review status and evidence draft are locked for that candidate.
- Preview, candidate save, review, assignment, Gmail inspection, PDF extraction and evidence-draft save never call the posting action.
- General and unassigned candidates cannot be posted through this event-only action.

## Remaining work before full expense management

1. Review, merge and deploy the explicit reviewed-candidate posting action. Deploy only the Gmail Functions codebase and never the tracked Firestore rules.
2. Live-test only Mori Market order `11333138`, amount `13,050 TWD`, after confirming the event's current booth-fee amount in the dialog.
3. Keep order `11333130`, amount `8,550 TWD`, unassigned until its 20 to 22 November event is identified.
4. Refine probable duplicate warnings after candidates are separated by event.
5. Add per-account partial failures and weekly server sync only after the manual workflow is stable.
6. ChatGPT's own weekly reminders/summaries do not automatically populate Sales Manager.
