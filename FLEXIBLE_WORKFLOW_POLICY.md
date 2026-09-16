# Flexible workflow policy

This policy is a required design rule for ICELOLLY Sales Manager.

## Core rule

Operational work must not be blocked just because some information is unknown or some optional processing was not completed.

For inventory, daily close, event close, reconciliation, expenses, and future workflows, prefer explicit states such as:

- confirmed
- partially confirmed
- unprocessed / skipped
- unknown / unresolved

Do not invent `0`, a guessed SKU, an estimated quantity, or a fake completion state merely to let the workflow continue.

## Event inventory

A user may:

- skip an intermediate count,
- count only some SKUs,
- leave Restock / Opening correction unknown if it was not recorded,
- leave some closing quantities unknown,
- leave Quick sales unidentified,
- leave an event-only unregistered product unlinked,
- formally finish the event while unresolved items remain.

When an event is formally closed with unresolved inventory:

- exact SKU sales already applied at checkout are never applied again,
- explicit known Quick allocations / recorded loss / theft / damage / gift / sample / stock adjustments may be applied,
- unknown quantities and unknown SKU assignments are not applied to canonical stock,
- unresolved state is preserved under `inventoryCount.pendingInventory`,
- Session uses `eventCloseMode: closed_with_pending_inventory`,
- later resolution may be performed where a safe resolution workflow exists.

## UI principle

Every multi-step operational flow should provide a safe way to continue without forcing completion of every step.

Typical wording:

- `あとで処理`
- `一部だけ保存`
- `不明のまま進む`
- `未処理を残して終了`

The UI must clearly distinguish these from fully confirmed states.

## Daily close direction

The upcoming daily-close workflow must follow the same rule:

- a day may be closed with no physical count,
- a partial count may be saved,
- unknown items remain unknown rather than becoming zero,
- the next day can begin from the known state plus explicit later movements,
- daily history must retain whether each value was confirmed, inherited, skipped, or unresolved.
