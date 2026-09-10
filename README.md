# ICELOLLY Sales Manager

Phase 1 scaffold for GitHub Pages + Firebase / Firestore.

## Included

* Responsive mobile-first shell
* 8 default product categories
* JPY / TWD / HKD / SGD / THB / USD currency metadata
* Inventory adapter architecture
* T-shirt adapter boundary
* Accessory adapter boundary
* Product and variant draft helpers
* Bundle service foundation
* Firebase config isolation
* Firestore rules starter

## Product categories

* tshirt
* pierce
* earring
* drop_pierce
* drop_earring
* sticker
* postcard
* art_print

## Important design rules

1. POS sales do not perform FX conversion.
2. Quick and Semi sales may remain unallocated until stock reconciliation.
3. Existing T-shirt inventory remains the current stock master.
4. Existing inventory schemas are accessed only through adapters.
5. Bundle discount, item discount and transaction discount remain separate.
6. Products without SKU or initialized stock can still be sold.

## Firebase setup

Edit:

`js/firebase-config.js`

Then add your Firebase Web App config.

Authentication and Firestore Security Rules must be enabled before production use.

## Next implementation phase

* Firestore seed / initialization
* Product registration UI
* Existing T-shirt inventory read adapter
* Existing accessory inventory read adapter
* Event Session creation
