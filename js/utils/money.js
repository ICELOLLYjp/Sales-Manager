import { getCurrency } from "../data/currencies.js";

export function formatMoney(amount, currencyCode) {
  const currency = getCurrency(currencyCode);
  const digits = currency?.decimalPlaces ?? 2;

  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(Number(amount || 0));
}

export function roundMoney(amount, currencyCode) {
  const currency = getCurrency(currencyCode);
  const digits = currency?.decimalPlaces ?? 2;
  const factor = 10 ** digits;
  return Math.round((Number(amount) + Number.EPSILON) * factor) / factor;
}
