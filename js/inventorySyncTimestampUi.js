import { getFirebaseState } from "./firebase.js";

function text(value) {
  return String(value ?? "").trim();
}

async function firestoreModule() {
  return await import("https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js");
}

function timestampToDate(value) {
  if (!value) return null;

  try {
    if (typeof value.toDate === "function") {
      const date = value.toDate();
      return Number.isNaN(date.getTime()) ? null : date;
    }

    if (typeof value === "object" && Number.isFinite(Number(value.seconds))) {
      const date = new Date(Number(value.seconds) * 1000);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof value === "number") {
      const millis = value < 100000000000 ? value * 1000 : value;
      const date = new Date(millis);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    if (typeof value === "string" && value.trim()) {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }
  } catch {
    return null;
  }

  return null;
}

const TIMESTAMP_KEYS = [
  "updatedAt",
  "syncedAt",
  "lastSyncedAt",
  "inventoryUpdatedAt",
  "stockUpdatedAt",
  "lastUpdatedAt",
  "modifiedAt"
];

function newestCandidate(data) {
  if (!data || typeof data !== "object") return null;

  let newest = null;
  TIMESTAMP_KEYS.forEach(key => {
    const date = timestampToDate(data?.[key]);
    if (date && (!newest || date > newest)) newest = date;
  });
  return newest;
}

function newestInventoryTimestamp(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 8) return null;

  let newest = newestCandidate(node);
  Object.values(node).forEach(value => {
    if (!value || typeof value !== "object") return;
    const nested = newestInventoryTimestamp(value, depth + 1);
    if (nested && (!newest || nested > newest)) newest = nested;
  });
  return newest;
}

function formatDateTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "未記録";

  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function installStyles() {
  if (document.getElementById("inventorySyncTimestampStyles")) return;

  const style = document.createElement("style");
  style.id = "inventorySyncTimestampStyles";
  style.textContent = `
    .inventory-sync-meta{display:flex;align-items:center;gap:6px;margin:7px 0 0;padding:7px 9px;border-radius:10px;background:#f7f7f4;color:#666;font-size:11px;line-height:1.35}
    .inventory-sync-meta strong{color:#333;font-size:11px}
    .inventory-sync-dot{width:7px;height:7px;flex:0 0 7px;border-radius:50%;background:#4d9a61}
    .inventory-sync-meta.fallback .inventory-sync-dot{background:#999}
  `;
  document.head.appendChild(style);
}

function metaNode(source, date, fallbackDate) {
  const node = document.createElement("div");
  node.className = `inventory-sync-meta${date ? "" : " fallback"}`;
  node.dataset.inventorySyncSource = source;

  const shownDate = date || fallbackDate;
  const label = date ? "最終同期" : "Sales Manager読込";
  node.innerHTML = `<span class="inventory-sync-dot"></span><span>${label} <strong>${formatDateTime(shownDate)}</strong></span>`;
  return node;
}

function placeMeta(sectionId, source, date, fallbackDate) {
  const section = document.getElementById(sectionId);
  if (!section) return;

  const existing = section.querySelector(`:scope > .inventory-sync-meta[data-inventory-sync-source="${source}"]`);
  const nextText = `${date ? "最終同期" : "Sales Manager読込"} ${formatDateTime(date || fallbackDate)}`;

  if (existing) {
    if (text(existing.textContent) !== nextText) {
      existing.replaceWith(metaNode(source, date, fallbackDate));
    }
    return;
  }

  const header = section.firstElementChild;
  if (header) header.insertAdjacentElement("afterend", metaNode(source, date, fallbackDate));
}

let busy = false;
let scheduled = false;
let lastLoadedAt = 0;
let cached = null;

async function loadSyncTimes() {
  const now = Date.now();
  if (cached && now - lastLoadedAt < 15000) return cached;

  const { db, enabled } = getFirebaseState();
  if (!enabled || !db) return null;

  const { doc, getDocFromServer } = await firestoreModule();
  const readAt = new Date();

  const [tshirtSnapshot, accessorySnapshot] = await Promise.all([
    getDocFromServer(doc(db, "tshirtStock", "master")),
    getDocFromServer(doc(db, "accessoryStock", "shared"))
  ]);

  const tshirtData = tshirtSnapshot.exists() ? tshirtSnapshot.data() : {};
  const accessoryData = accessorySnapshot.exists() ? accessorySnapshot.data() : {};

  const tshirtTop = newestCandidate(tshirtData);
  const tshirtInventory = newestInventoryTimestamp(tshirtData?.inventory_v2 || {});
  const tshirtDate = [tshirtTop, tshirtInventory]
    .filter(Boolean)
    .sort((a, b) => b - a)[0] || null;

  const accessoryDate = newestCandidate(accessoryData);

  cached = {
    tshirtDate,
    accessoryDate,
    readAt
  };
  lastLoadedAt = now;
  return cached;
}

async function enhanceInventorySyncTimes() {
  if (busy) return;
  if (text(document.querySelector("h1.page-title")?.textContent) !== "Inventory") return;
  if (!document.getElementById("inventoryTshirtSection") || !document.getElementById("inventoryAccessorySection")) return;

  busy = true;
  try {
    installStyles();
    const result = await loadSyncTimes();
    if (!result) return;
    if (text(document.querySelector("h1.page-title")?.textContent) !== "Inventory") return;

    placeMeta("inventoryTshirtSection", "tshirt", result.tshirtDate, result.readAt);
    placeMeta("inventoryAccessorySection", "accessory", result.accessoryDate, result.readAt);
  } catch (error) {
    console.warn("在庫同期日時を表示できませんでした。", error);
  } finally {
    busy = false;
  }
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    void enhanceInventorySyncTimes();
  });
}

const view = document.getElementById("view");
if (view) {
  new MutationObserver(schedule).observe(view, { childList: true, subtree: true });
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    cached = null;
    lastLoadedAt = 0;
    schedule();
  }
});

schedule();
