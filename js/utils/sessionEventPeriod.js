// Pure display helpers. Session lifecycle and inventory are unchanged.
export function sessionDateKey(value) {
  if (typeof value !== "string") return "";
  const match = value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const actual = new Date(Date.UTC(year, month - 1, day));
  if (actual.getUTCFullYear() !== year || actual.getUTCMonth() + 1 !== month || actual.getUTCDate() !== day) return "";
  return `${match[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const EVENT_TIMEZONES = new Map([
  ["japan", "Asia/Tokyo"], ["jp", "Asia/Tokyo"], ["日本", "Asia/Tokyo"],
  ["taiwan", "Asia/Taipei"], ["tw", "Asia/Taipei"], ["台湾", "Asia/Taipei"], ["台灣", "Asia/Taipei"],
  ["hong kong", "Asia/Hong_Kong"], ["hk", "Asia/Hong_Kong"], ["香港", "Asia/Hong_Kong"],
  ["singapore", "Asia/Singapore"], ["sg", "Asia/Singapore"], ["シンガポール", "Asia/Singapore"],
  ["thailand", "Asia/Bangkok"], ["th", "Asia/Bangkok"], ["タイ", "Asia/Bangkok"],
  ["macau", "Asia/Macau"], ["macao", "Asia/Macau"], ["mo", "Asia/Macau"], ["澳門", "Asia/Macau"], ["マカオ", "Asia/Macau"]
]);

export function sessionTodayKey(session, now = new Date()) {
  const country = String(session?.country ?? "").trim().toLowerCase();
  const zone = EVENT_TIMEZONES.get(country);
  if (zone) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function sessionEventPhase(session, now = new Date()) {
  if (String(session?.status ?? "").trim() === "closed") return "ended";

  const start = sessionDateKey(session?.startDate);
  const end = session?.endDate ? sessionDateKey(session.endDate) : start;
  if (!start || !end || end < start) return "unscheduled";

  const today = sessionTodayKey(session, now);
  if (today < start) return "upcoming";
  if (today > end) return "ended";
  return "current";
}

export function compareSessionEventDates(a, b, phase) {
  const aStart = sessionDateKey(a?.startDate);
  const bStart = sessionDateKey(b?.startDate);
  const aEnd = sessionDateKey(a?.endDate) || aStart;
  const bEnd = sessionDateKey(b?.endDate) || bStart;
  const byName = () => String(a?.eventName ?? "").localeCompare(String(b?.eventName ?? ""), "ja");

  if (phase === "upcoming") return aStart.localeCompare(bStart) || byName();
  if (phase === "ended") return bEnd.localeCompare(aEnd) || bStart.localeCompare(aStart) || byName();
  if (phase === "unscheduled") return byName();
  const aLifecycle = String(a?.status) === "open" ? 0 : 1;
  const bLifecycle = String(b?.status) === "open" ? 0 : 1;
  return aLifecycle - bLifecycle || bStart.localeCompare(aStart) || byName();
}
