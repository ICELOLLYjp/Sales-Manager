# Gmail expense candidate sync — implementation contract

Status: **foundation only**. The ChatGPT Gmail connection is NOT an OAuth credential usable by the GitHub Pages application or Firebase Functions. The in-app Sync button is NOT live yet. Do not imply that connecting Gmail in ChatGPT connects Sales Manager.

## Accounts and behavior

- Read both `fjmthrs@gmail.com` and `icelolly.zakka@gmail.com` with separately granted Google OAuth `gmail.readonly` consent. Never assume one account's token can read the other account.
- Sync on demand via a button, and optionally run a server-side weekly job after both accounts are authorized. ChatGPT's existing weekly reminder/report is separate and does not populate Firestore.
- Store OAuth refresh tokens only in a server-side secret store with restricted access, not in client JS, GitHub, Firestore client-readable documents, localStorage, or logs. Restrict callable endpoints to authorized staff and verify the authenticated Firebase user server-side.
- Query Gmail incrementally per account, track the last successful cursor per account, and report partial failure per account. Do not advance a cursor when its fetch or processing fails.
- Extract candidates from message bodies and attached PDF receipts/invoices server-side; preserve source account, Gmail message ID, attachment ID, date, amount, currency, merchant, invoice number, and payment evidence status. Avoid downloading arbitrary attachments to the browser.
- Distinguish invoice, payment confirmation, reservation, account transfer, and unrelated event. An invoice alone is NOT proof of payment. Cross-account duplicate detection is a warning for human review, not silent deletion.
- Candidate records belong in a separate, access-controlled collection, e.g. `gmailExpenseCandidates`. They must never write `salesSessions.expenses`, `salesTransactions`, inventory, or accounting totals during sync.
- Review UI must display last sync time and each account's result, including an explicit disconnected/failed state. Never display 'both accounts synced' if only one was read.
- Use a stable source ID (`account:messageId:attachmentId`) for idempotent upsert. Keep source references and review decisions across rescans; never reset manually excluded candidates to pending automatically.
- Explicit user action is required for any eventual expense posting; that action is a separate future feature, not part of this sync.

## Work completed in this branch

`js/services/gmailExpenseCandidateService.js` provides a pure, read-only candidate schema and potential-duplicate grouping. It does not fetch Gmail, save candidates, or add a functioning Sync button.

## Blockers before enabling the Sync button

1. Configure Google Cloud OAuth consent and a web/server OAuth client authorized for the project's Firebase Functions callback URL; request Gmail readonly scope for **each** account. Review Google's verification/testing-user requirements for this scope before production use.
2. Provision encrypted server-side token storage and revoke/disconnect controls; configure and deploy the backend through the project's Firebase account.
3. Implement authorized OAuth start/callback, Gmail API retrieval, safe attachment parsing, candidate storage, and a callable sync/status endpoint. Add strict Firestore rules for candidate documents and tests for idempotency, duplicate warnings, partial failures, and no expense writes.
4. Only then add and enable a visible Sync button and a review inbox in Sales Manager. Never add a button that falsely claims to sync while the backend is unavailable.

No email was modified or sent, and no expense was registered by this branch.
