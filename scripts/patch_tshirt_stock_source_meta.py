from pathlib import Path


def replace_once(path, old, new, label):
    text = path.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')

# 1) Event-end physical count: stamp every counted T-shirt cell and its color row.
physical = Path('js/services/tshirtPhysicalStockService.js')
old = '''    const master = snapshot.data();
    const inventory = cloneInventory(master?.inventory_v2);
    let changedCount = 0;
    let totalBefore = 0;
    let totalAfter = 0;

    normalized.forEach(row => {'''
new = '''    const master = snapshot.data();
    const inventory = cloneInventory(master?.inventory_v2);
    const inventoryColorMeta = cloneInventory(master?.inventory_color_meta);
    const savedAtIso = new Date().toISOString();
    let changedCount = 0;
    let totalBefore = 0;
    let totalAfter = 0;

    normalized.forEach(row => {'''
replace_once(physical, old, new, 'physical metadata setup')

old = '''      sizeTree[row.sizeId] = {
        ...previousCell,
        qty: after
      };
    });

    const savedAtIso = new Date().toISOString();
    transaction.set(ref, {
      inventory_v2: inventory,'''
new = '''      sizeTree[row.sizeId] = {
        ...previousCell,
        qty: after,
        updatedAt: savedAtIso,
        updateSource: "sales_manager"
      };

      inventoryColorMeta[row.bodyId] ||= {};
      inventoryColorMeta[row.bodyId][row.designId] ||= {};
      inventoryColorMeta[row.bodyId][row.designId][row.colorId] = {
        updatedAt: savedAtIso,
        source: "sales_manager"
      };
    });

    transaction.set(ref, {
      inventory_v2: inventory,
      inventory_color_meta: inventoryColorMeta,'''
replace_once(physical, old, new, 'physical cell metadata')

# 2) Exact-SKU checkout: the sale itself changes canonical stock, so mark it as Sales Manager.
transaction = Path('js/services/transactionService.js')
old = '''        if (tshirtTargets.length) {
          const args = [
            tshirtMasterRef
          ];

          tshirtTargets.forEach(
            entry => {
              args.push(
                new FieldPath(
                  "inventory_v2",
                  entry.target.bodyId,
                  entry.target.designId,
                  entry.target.colorId,
                  entry.target.sizeId,
                  "qty"
                )
              );

              args.push(
                entry.nextQty
              );
            }
          );

          args.push(
            "updatedAt",
            serverTimestamp()
          );

          transaction.update(
            ...args
          );
        }
'''
new = '''        if (tshirtTargets.length) {
          const args = [
            tshirtMasterRef
          ];
          const colorMetaKeys = new Set();

          tshirtTargets.forEach(
            entry => {
              const target = entry.target;
              args.push(
                new FieldPath(
                  "inventory_v2",
                  target.bodyId,
                  target.designId,
                  target.colorId,
                  target.sizeId,
                  "qty"
                ),
                entry.nextQty,
                new FieldPath(
                  "inventory_v2",
                  target.bodyId,
                  target.designId,
                  target.colorId,
                  target.sizeId,
                  "updatedAt"
                ),
                serverTimestamp(),
                new FieldPath(
                  "inventory_v2",
                  target.bodyId,
                  target.designId,
                  target.colorId,
                  target.sizeId,
                  "updateSource"
                ),
                "sales_manager"
              );

              const colorMetaKey = [target.bodyId, target.designId, target.colorId].join("|");
              if (!colorMetaKeys.has(colorMetaKey)) {
                colorMetaKeys.add(colorMetaKey);
                args.push(
                  new FieldPath(
                    "inventory_color_meta",
                    target.bodyId,
                    target.designId,
                    target.colorId,
                    "updatedAt"
                  ),
                  serverTimestamp(),
                  new FieldPath(
                    "inventory_color_meta",
                    target.bodyId,
                    target.designId,
                    target.colorId,
                    "source"
                  ),
                  "sales_manager"
                );
              }
            }
          );

          args.push(
            "updatedAt",
            serverTimestamp()
          );

          transaction.update(
            ...args
          );
        }
'''
replace_once(transaction, old, new, 'checkout stock metadata')

# 3) Voiding a sale restores canonical stock; that is also a Sales Manager-origin update.
old = '''      if (
        tshirtRestore.size
      ) {
        const args = [
          tshirtMasterRef
        ];

        tshirtRestore
          .forEach(
            entry => {
              const currentQty =
                readTshirtQty(
                  tshirtMaster,
                  entry.target
                );

              args.push(
                new FieldPath(
                  "inventory_v2",
                  entry.target.bodyId,
                  entry.target.designId,
                  entry.target.colorId,
                  entry.target.sizeId,
                  "qty"
                )
              );

              args.push(
                currentQty +
                entry.quantity
              );
            }
          );

        args.push(
          "updatedAt",
          serverTimestamp()
        );

        transaction.update(
          ...args
        );
      }
'''
new = '''      if (
        tshirtRestore.size
      ) {
        const args = [
          tshirtMasterRef
        ];
        const colorMetaKeys = new Set();

        tshirtRestore
          .forEach(
            entry => {
              const target = entry.target;
              const currentQty =
                readTshirtQty(
                  tshirtMaster,
                  target
                );

              args.push(
                new FieldPath(
                  "inventory_v2",
                  target.bodyId,
                  target.designId,
                  target.colorId,
                  target.sizeId,
                  "qty"
                ),
                currentQty + entry.quantity,
                new FieldPath(
                  "inventory_v2",
                  target.bodyId,
                  target.designId,
                  target.colorId,
                  target.sizeId,
                  "updatedAt"
                ),
                serverTimestamp(),
                new FieldPath(
                  "inventory_v2",
                  target.bodyId,
                  target.designId,
                  target.colorId,
                  target.sizeId,
                  "updateSource"
                ),
                "sales_manager"
              );

              const colorMetaKey = [target.bodyId, target.designId, target.colorId].join("|");
              if (!colorMetaKeys.has(colorMetaKey)) {
                colorMetaKeys.add(colorMetaKey);
                args.push(
                  new FieldPath(
                    "inventory_color_meta",
                    target.bodyId,
                    target.designId,
                    target.colorId,
                    "updatedAt"
                  ),
                  serverTimestamp(),
                  new FieldPath(
                    "inventory_color_meta",
                    target.bodyId,
                    target.designId,
                    target.colorId,
                    "source"
                  ),
                  "sales_manager"
                );
              }
            }
          );

        args.push(
          "updatedAt",
          serverTimestamp()
        );

        transaction.update(
          ...args
        );
      }
'''
replace_once(transaction, old, new, 'void stock metadata')

# 4) Late Quick -> SKU resolution can also decrement canonical T-shirt stock.
late = Path('js/services/eventLateSkuResolutionService.js')
old = '''      transaction.update(
        tshirtRef,
        new FieldPath("inventory_v2", target.bodyId, target.designId, target.colorId, target.sizeId, "qty"),
        stockAfter,
        "updatedAt",
        serverTimestamp()
      );'''
new = '''      transaction.update(
        tshirtRef,
        new FieldPath("inventory_v2", target.bodyId, target.designId, target.colorId, target.sizeId, "qty"),
        stockAfter,
        new FieldPath("inventory_v2", target.bodyId, target.designId, target.colorId, target.sizeId, "updatedAt"),
        serverTimestamp(),
        new FieldPath("inventory_v2", target.bodyId, target.designId, target.colorId, target.sizeId, "updateSource"),
        "sales_manager",
        new FieldPath("inventory_color_meta", target.bodyId, target.designId, target.colorId, "updatedAt"),
        serverTimestamp(),
        new FieldPath("inventory_color_meta", target.bodyId, target.designId, target.colorId, "source"),
        "sales_manager",
        "updatedAt",
        serverTimestamp()
      );'''
replace_once(late, old, new, 'late SKU stock metadata')

# Static guardrails: all three stock mutation paths must now expose the common source value.
checks = {
    physical: 2,
    transaction: 4,
    late: 2,
}
for file, minimum in checks.items():
    count = file.read_text(encoding='utf-8').count('sales_manager')
    if count < minimum:
        raise SystemExit(f'{file}: sales_manager metadata markers missing ({count} < {minimum})')

# Remove temporary patch machinery from the resulting branch.
Path('scripts/patch_tshirt_stock_source_meta.py').unlink(missing_ok=True)
Path('.github/workflows/apply-tshirt-stock-source-meta.yml').unlink(missing_ok=True)
try:
    Path('scripts').rmdir()
except OSError:
    pass

print('Sales Manager T-shirt stock source metadata patch applied successfully')
