import { CURRENCIES, getCurrency } from "../data/currencies.js";
import { formatMoney } from "../utils/money.js";

export function listCurrencies() {
  return CURRENCIES;
}

export function getCurrencyMeta(code) {
  return getCurrency(code);
}

export function displayMoney(amount, code) {
  return formatMoney(amount, code);
}

// 為替換算はEVENT POS会計時には行いません。
// 収支確定フェーズで別途実装します。
