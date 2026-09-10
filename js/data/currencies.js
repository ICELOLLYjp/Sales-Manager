export const CURRENCIES = [
  { code: "JPY", name: "Japanese Yen", symbol: "¥", decimalPlaces: 0 },
  { code: "TWD", name: "New Taiwan Dollar", symbol: "NT$", decimalPlaces: 0 },
  { code: "HKD", name: "Hong Kong Dollar", symbol: "HK$", decimalPlaces: 2 },
  { code: "SGD", name: "Singapore Dollar", symbol: "S$", decimalPlaces: 2 },
  { code: "THB", name: "Thai Baht", symbol: "฿", decimalPlaces: 2 },
  { code: "USD", name: "US Dollar", symbol: "$", decimalPlaces: 2 }
];

export function getCurrency(code) {
  return CURRENCIES.find(item => item.code === code) ?? null;
}
