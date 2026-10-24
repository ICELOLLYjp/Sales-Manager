// Frozen cost helpers from Sales #123 dc8f14a; no product imports or writes.
function safeNumber(value) { const n=Number(value || 0); return Number.isFinite(n)?n:0; }
function localDateKey() {
  const now =
    new Date();

  const year =
    String(
      now.getFullYear()
    );

  const month =
    String(
      now.getMonth() +
      1
    ).padStart(
      2,
      "0"
    );

  const day =
    String(
      now.getDate()
    ).padStart(
      2,
      "0"
    );

  return `${year}-${month}-${day}`;
}


function normalizedCostSchedule(
  value
) {
  return (
    Array.isArray(
      value
    )
      ? value
      : []
  )
    .map(
      row => ({
        amountJPY:
          Number(
            row?.amountJPY
          ),

        effectiveFrom:
          String(
            row?.effectiveFrom ||
            ""
          ),

        note:
          String(
            row?.note || ""
          )
      })
    )
    .filter(
      row =>
        /^\d{4}-\d{2}-\d{2}$/.test(
          row.effectiveFrom
        ) &&
        Number.isFinite(
          row.amountJPY
        ) &&
        row.amountJPY >=
          0
    )
    .sort(
      (a, b) =>
        b.effectiveFrom
          .localeCompare(
            a.effectiveFrom
          )
    );
}


function resolveScheduledCost(
  schedule,
  saleDate
) {
  const match =
    normalizedCostSchedule(
      schedule
    ).find(
      row =>
        row.effectiveFrom <=
        saleDate
    );

  return match
    ? {
        unitCostJPY:
          match.amountJPY,

        effectiveFrom:
          match.effectiveFrom,

        note:
          match.note
      }
    : null;
}


function resolveItemCostSnapshot({
  item,
  variant,
  product,
  saleDate
}) {
  const isTshirt =
    item?.category ===
    "tshirt";

  if (
    isTshirt
  ) {
    if (
      item?.variantId
    ) {
      const skuOverrideCost =
        resolveScheduledCost(
          variant
            ?.skuOverrideCostSchedule,
          saleDate
        );

      if (
        skuOverrideCost
      ) {
        return {
          captured:
            true,
          version:
            2,
          saleDate,
          source:
            "sku_override",
          ...skuOverrideCost
        };
      }

      const outsourcedCost =
        resolveScheduledCost(
          variant
            ?.outsourcedCostSchedule,
          saleDate
        );

      if (
        outsourcedCost
      ) {
        return {
          captured:
            true,
          version:
            2,
          saleDate,
          source:
            "outsourced_all_in",
          ...outsourcedCost
        };
      }
    }

    const bodyId =
      String(
        item?.bodyId ||
        variant?.bodyId ||
        ""
      ).trim();

    if (
      bodyId
    ) {
      const bodyCost =
        resolveScheduledCost(
          product
            ?.bodyCostSchedules
            ?.[bodyId],
          saleDate
        );

      if (
        bodyCost
      ) {
        return {
          captured:
            true,
          version:
            2,
          saleDate,
          source:
            "body",
          ...bodyCost
        };
      }
    }

    return {
      captured:
        true,
      version:
        2,
      saleDate,
      source:
        "missing",
      unitCostJPY:
        null,
      effectiveFrom:
        null,
      note:
        ""
    };
  }

  /*
   * Non-T-shirt categories keep the existing compatibility path.
   * This avoids changing current accessory / paper-goods behavior
   * while the T-shirt cost master is moved to the stock app.
   */
  if (
    item?.variantId
  ) {
    const skuCost =
      resolveScheduledCost(
        variant?.costSchedule,
        saleDate
      );

    if (
      skuCost
    ) {
      return {
        captured:
          true,
        version:
          1,
        saleDate,
        source:
          "sku",
        ...skuCost
      };
    }

    const legacyDate =
      String(
        variant
          ?.latestCostEffectiveFrom ||
        ""
      );

    const legacyAmount =
      Number(
        variant
          ?.latestCostJPY
      );

    if (
      /^\d{4}-\d{2}-\d{2}$/.test(
        legacyDate
      ) &&
      legacyDate <=
        saleDate &&
      Number.isFinite(
        legacyAmount
      ) &&
      legacyAmount >=
        0
    ) {
      return {
        captured:
          true,
        version:
          1,
        saleDate,
        source:
          "sku",
        unitCostJPY:
          legacyAmount,
        effectiveFrom:
          legacyDate,
        note:
          ""
      };
    }
  }

  const categoryCost =
    resolveScheduledCost(
      product?.costSchedule,
      saleDate
    );

  if (
    categoryCost
  ) {
    return {
      captured:
        true,
      version:
        1,
      saleDate,
      source:
        "category",
      ...categoryCost
    };
  }

  return {
    captured:
      true,
    version:
      1,
    saleDate,
    source:
      "missing",
    unitCostJPY:
      null,
    effectiveFrom:
      null,
    note:
      ""
  };
}


export {localDateKey, resolveItemCostSnapshot};
