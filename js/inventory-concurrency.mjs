// Inventory write protocol A1. Keep this file byte-identical in the three apps.
export const PROTOCOL = 1;
export function revision(data) {
  const value = data?.inventoryRevision ?? 0;
  if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) throw new Error('Invalid inventory revision');
  return value;
}
export function conflict(path = '') {
  const error = new Error(`在庫が他の操作で変更されました。再読込して入力を確認してください。 ${path}`);
  error.code = 'inventory-conflict';
  return error;
}
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
export function equal(a, b) {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (object(a) && object(b)) return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => Object.hasOwn(b, k) && equal(a[k], b[k]));
  return false;
}
// Only local edits are applied. Changed/deleted records must still match their
// original observation. A qty cell is atomic (including its change timestamp).
export function mergeEdit(base, desired, current, path = '') {
  if (equal(base, desired)) return current;
  if (path.startsWith('inventory_color_meta/') && /\/(updatedAt|source)$/.test(path)) return desired;
  if (Array.isArray(base) && Array.isArray(desired) && Array.isArray(current)) {
    const keyed = a => a.every(v => object(v) && typeof v.id === 'string' && v.id) && new Set(a.map(v => v.id)).size === a.length;
    if (keyed(base) && keyed(desired) && keyed(current)) {
      const b = new Map(base.map(v => [v.id, v])), d = new Map(desired.map(v => [v.id, v])), c = new Map(current.map(v => [v.id, v]));
      const out = new Map(c);
      for (const id of new Set([...b.keys(), ...d.keys()])) {
        const value = mergeEdit(b.get(id), d.get(id), c.get(id), `${path}/${id}`);
        if (value === undefined) out.delete(id); else out.set(id, value);
      }
      return [...out.values()];
    }
  }
  if (object(base) && object(desired) && object(current) && !Object.hasOwn(base, 'qty')) {
    const out = { ...current };
    for (const key of new Set([...Object.keys(base), ...Object.keys(desired)])) {
      const value = mergeEdit(base[key], desired[key], current[key], `${path}/${key}`);
      if (value === undefined) delete out[key]; else Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
    }
    return out;
  }
  if (!equal(base, current)) throw conflict(path);
  return desired;
}
export function preparePatch(base, fields, current, strict = false) {
  if (strict && revision(base) !== revision(current)) throw conflict('revision');
  const patch = {};
  for (const key of Object.keys(fields)) {
    if (['inventoryRevision', 'inventoryWriteProtocol', 'updatedAt'].includes(key)) throw new Error('Reserved inventory field');
    if (!equal(base[key], fields[key])) patch[key] = mergeEdit(base[key], fields[key], current[key], key);
  }
  return patch;
}
// A receipt is committed atomically with the inventory. Reuse operationId for
// network retries; never retry a conflict by silently replacing the baseline.
export async function saveInventoryEdit(api, db, ref, base, fields, operationId, { strict = false, serverFields = [] } = {}) {
  if (!base || !operationId) throw new Error('Inventory baseline and operation ID required');
  const receipt = api.doc(db, 'inventoryWriteReceipts', operationId);
  const bytes = new TextEncoder().encode(JSON.stringify({ path: ref.path, revision: revision(base), fields, strict, serverFields }));
  const intent = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), v => v.toString(16).padStart(2, '0')).join('');
  return api.runTransaction(db, async tx => {
    const snap = await tx.get(ref), done = await tx.get(receipt);
    if (!snap.exists()) throw new Error('Inventory document missing; explicit migration required');
    if (done.exists()) {
      if (done.data().intent !== intent) throw new Error('Inventory operation ID reused');
      return snap.data();
    }
    const current = snap.data(), patch = preparePatch(base, fields, current, strict);
    if (!Object.keys(patch).length) return current;
    const next = { ...patch, inventoryRevision: revision(current) + 1, inventoryWriteProtocol: PROTOCOL };
    for (const key of serverFields) {
      if (key !== 'physicalCountUpdatedAt') throw new Error('Unsupported inventory timestamp field');
      next[key] = api.serverTimestamp();
    }
    tx.update(ref, { ...next, updatedAt: api.serverTimestamp() });
    tx.set(receipt, { path: ref.path, intent, revision: next.inventoryRevision, createdAt: api.serverTimestamp() });
    return { ...current, ...next };
  });
}
// Existing POS transactions retain their locks, movements and arithmetic.
// Stamp the exact revision they read, on every canonical write.
export function guardedTransaction(tx) {
  const reads = new Map();
  const canonical = ref => ['tshirtStock/master', 'accessoryStock/shared'].includes(ref.path);
  function stamp(ref) {
    if (!reads.has(ref.path)) throw new Error('Read canonical inventory before writing');
    return { inventoryRevision: revision(reads.get(ref.path)) + 1, inventoryWriteProtocol: PROTOCOL };
  }
  const proxy = {
    async get(ref) { const snap = await tx.get(ref); if (canonical(ref)) { if (!snap.exists()) throw new Error('Inventory document missing'); reads.set(ref.path, snap.data()); } return snap; },
    update(ref, ...args) {
      if (canonical(ref)) {
        const next = stamp(ref);
        args = args.length === 1 ? [{ ...args[0], ...next }] : [...args, 'inventoryRevision', next.inventoryRevision, 'inventoryWriteProtocol', PROTOCOL];
      }
      tx.update(ref, ...args); return proxy;
    },
    set(ref, data, ...args) { tx.set(ref, canonical(ref) ? { ...data, ...stamp(ref) } : data, ...args); return proxy; },
    delete(ref) { if (canonical(ref)) throw new Error('Canonical inventory deletion prohibited'); tx.delete(ref); return proxy; }
  };
  return proxy;
}
