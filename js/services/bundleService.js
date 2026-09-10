export function calculateBundleDiscount(cartLines, rules = []) {
  let totalDiscount = 0;
  const appliedBundles = [];

  const activeRules = rules
    .filter(rule => rule.active !== false)
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  for (const rule of activeRules) {
    if (rule.mode !== "mix_match_same_category") continue;

    const eligible = cartLines.filter(line =>
      rule.eligibleCategories?.includes(line.category)
    );

    const unitCount = eligible.reduce((sum, line) => sum + line.quantity, 0);
    const bundleCount = Math.floor(unitCount / rule.requiredQuantity);

    if (!bundleCount) continue;

    const standardPrice = eligible
      .slice()
      .sort((a, b) => a.unitListPrice - b.unitListPrice)[0]?.unitListPrice ?? 0;

    const regularBundleTotal = standardPrice * rule.requiredQuantity;
    const discountPerBundle = Math.max(0, regularBundleTotal - rule.bundlePrice);
    const discount = discountPerBundle * bundleCount;

    totalDiscount += discount;
    appliedBundles.push({
      bundleId: rule.id,
      name: rule.name,
      count: bundleCount,
      discount
    });
  }

  return { totalDiscount, appliedBundles };
}
