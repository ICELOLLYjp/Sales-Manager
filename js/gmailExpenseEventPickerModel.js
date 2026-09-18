// Deleted sessions no longer exist in the returned salesSessions collection.
export function eventStatus(item) {
  return String(item?.status || "open").trim().toLowerCase();
}

export function selectableEvents(sessions, { includeClosed = false, query = "" } = {}) {
  const needle = String(query || "").normalize("NFKC").trim().toLowerCase();
  return (Array.isArray(sessions) ? sessions : [])
    .filter(item => item && /^[A-Za-z0-9_-]{1,160}$/.test(String(item.id || "")))
    .filter(item => !["archived", "deleted"].includes(eventStatus(item)))
    .filter(item => includeClosed || eventStatus(item) !== "closed")
    .filter(item => !needle || [item.eventName, item.city, item.country, item.startDate, item.endDate]
      .map(value => String(value || "").normalize("NFKC").toLowerCase()).join(" ").includes(needle))
    .sort((a, b) => String(b.startDate || "").localeCompare(String(a.startDate || "")) ||
      String(a.eventName || "").localeCompare(String(b.eventName || ""), "ja"));
}

export function eventDateLabel(item) {
  const from = String(item?.startDate || "").slice(0, 10);
  const to = String(item?.endDate || "").slice(0, 10);
  if (!from) return "開催日未設定";
  return !to || from === to ? from.replace(/-/g, "/") :
    `${from.replace(/-/g, "/")} 〜 ${to.slice(5).replace(/-/g, "/")}`;
}
