import { createHash } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { assertIsolated, PROJECT, UIDS } from './runtime.mjs';

export class ApiError extends Error {
  constructor(status, code) { super(code); this.status=status; this.code=code; }
}
const fail=(status,code)=>{throw new ApiError(status,code);};
const object=x=>x!==null && typeof x==='object' && !Array.isArray(x) && Object.getPrototypeOf(x)===Object.prototype;
function keys(x,names) {
  if(!object(x) || Object.keys(x).length!==names.length || names.some(k=>!Object.hasOwn(x,k))) fail(400,'invalid-schema');
}
function id(x) {
  if(typeof x!=='string' || !x.length || x.length>256 || ['__proto__','prototype','constructor'].includes(x)) fail(400,'invalid-sku-id');
  return x;
}
const integer=x=>Number.isSafeInteger(x) && !Object.is(x,-0);
export function normalize(input) {
  keys(input,['version','operationId','stock','sku','expectedRevision','expectedQuantity','quantity']);
  if(input.version!==1 || !/^[A-Za-z0-9_-]{1,128}$/.test(input.operationId) || typeof input.operationId!=='string') fail(400,'invalid-operation');
  if(!integer(input.expectedRevision) || input.expectedRevision<0 || input.expectedRevision>=Number.MAX_SAFE_INTEGER
    || !integer(input.expectedQuantity) || !integer(input.quantity)) fail(400,'invalid-quantity-or-revision');
  let sku;
  if(input.stock==='tshirt') {
    keys(input.sku,['bodyId','designId','colorId','sizeId']);
    sku=Object.fromEntries(['bodyId','designId','colorId','sizeId'].map(k=>[k,id(input.sku[k])]));
  } else if(input.stock==='accessory') {
    keys(input.sku,['designId','quantityField']);
    if(!['piercing','earring'].includes(input.sku.quantityField)) fail(400,'invalid-quantity-field');
    sku={designId:id(input.sku.designId),quantityField:input.sku.quantityField};
  } else fail(400,'invalid-stock');
  return {version:1,operationId:input.operationId,stock:input.stock,sku,expectedRevision:input.expectedRevision,expectedQuantity:input.expectedQuantity,quantity:input.quantity};
}
const canonical=x=>Array.isArray(x)?x.map(canonical):object(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
export const hash=x=>createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
// Server-owned, co-located reservation evidence, never supplied by the caller.
// No implicit empty ledger/TTL release: producers must reconcile every hold.
export function reservationFloor(ledger, op) {
  try {
    keys(ledger,['schema','complete','entries']);
    if(ledger.schema!=='inventory-reservations-v1' || ledger.complete!==true
      || !Array.isArray(ledger.entries) || ledger.entries.length>1000) throw new Error();
    const seen=new Set(); let ec=0,event=0;
    for(const entry of ledger.entries) {
      keys(entry,['id','kind','state','sku','quantity']);
      if(typeof entry.id!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(entry.id)
        || seen.has(entry.id) || !['ec','event'].includes(entry.kind)
        || !['held','confirmed','released'].includes(entry.state)
        || !integer(entry.quantity) || entry.quantity<0) throw new Error();
      seen.add(entry.id);
      const sku=normalize({...op,sku:entry.sku}).sku;
      if(entry.state!=='released' && hash(sku)===hash(op.sku)) {
        if(entry.kind==='ec') ec+=entry.quantity; else event+=entry.quantity;
        if(!Number.isSafeInteger(ec+event)) throw new Error();
      }
    }
    return {ec,event,total:ec+event,ledgerHash:hash(ledger)};
  } catch { fail(409,'reservation-evidence-required'); }
}
export function revision(data) {
  const value=Object.hasOwn(data,'inventoryRevision')?data.inventoryRevision:0;
  // Terminal MAX_SAFE_INTEGER may be read to replay its last receipt. New
  // operations cannot expect that revision, so overflow writes remain denied.
  if(!integer(value) || value<0) fail(409,'invalid-stored-revision');
  return value;
}
export function target(data,op) {
  if(op.stock==='tshirt') {
    let cursor=data.inventory_v2;
    for(const key of Object.values(op.sku)) {
      if(!object(cursor) || !Object.hasOwn(cursor,key)) fail(404,'sku-not-found');
      cursor=cursor[key];
    }
    if(!object(cursor) || !Object.hasOwn(cursor,'qty') || !integer(cursor.qty)) fail(409,'unknown-or-invalid-quantity');
    return {cell:cursor,field:'qty'};
  }
  if(!Array.isArray(data.designs) || data.designs.some(d=>!object(d)||typeof d.id!=='string')
    || new Set(data.designs.map(d=>d.id)).size!==data.designs.length) fail(409,'invalid-designs');
  const cell=data.designs.find(d=>d.id===op.sku.designId);
  if(!cell) fail(404,'sku-not-found');
  if(!Object.hasOwn(cell,op.sku.quantityField) || !integer(cell[op.sku.quantityField])) fail(409,'unknown-or-invalid-quantity');
  return {cell,field:op.sku.quantityField};
}
// Copy only containers on the edited path; preserve Timestamp and other values.
export function updatedField(data,op) {
  if(op.stock==='accessory') return {designs:data.designs.map(d=>d.id===op.sku.designId?{...d,[op.sku.quantityField]:op.quantity}:d)};
  const ks=Object.values(op.sku);
  function copy(cursor,level) {
    if(level===ks.length) return {...cursor,qty:op.quantity};
    const out={...cursor}, key=ks[level];
    Object.defineProperty(out,key,{value:copy(cursor[key],level+1),enumerable:true,writable:true,configurable:true});
    return out;
  }
  return {inventory_v2:copy(data.inventory_v2,0)};
}
export async function editInventory(db,uid,input,{lookupOnly=false}={}) {
  assertIsolated();
  if(db.projectId!==PROJECT) fail(500,'wrong-project');
  if(!UIDS.includes(uid)) fail(403,'forbidden');
  const op=normalize(input), fingerprint=hash(op);
  const path=op.stock==='tshirt'?'tshirtStock/master':'accessoryStock/shared';
  const ref=db.doc(path), receipt=db.collection('inventoryWriteReceipts').doc(op.operationId);
  return db.runTransaction(async tx=>{
    const authorityRef=db.doc(`inventoryReservationAuthorities/${op.stock}`);
    const [stock,done,authority]=await tx.getAll(ref,receipt,authorityRef);
    if(!stock.exists) fail(404,'stock-not-found');
    const data=stock.data(), rev=revision(data);
    const result={operationId:op.operationId,fingerprint,path,revision:op.expectedRevision+1,beforeQuantity:op.expectedQuantity,quantity:op.quantity};
    if(done.exists) {
      const r=done.data();
      // Legacy/unknown receipts must never suppress a new server operation.
      if(r.schema!=='manual-inventory-server-v2' || !UIDS.includes(r.actorUid)
        || r.intent!==fingerprint || r.path!==path || r.revision!==result.revision
        || r.beforeRevision!==op.expectedRevision || !object(r.operation) || hash(r.operation)!==fingerprint
        || !object(r.result) || hash(r.result)!==hash(result) || !(r.createdAt instanceof Timestamp)
        || rev<r.revision) fail(409,'operation-id-conflict');
      // Validate the historical floor, not today's holds, on a lost-reply replay.
      let floor;
      try { floor=reservationFloor(r.reservations,op); } catch { fail(409,'operation-id-conflict'); }
      if(!object(r.reservationFloor) || hash(floor)!==hash(r.reservationFloor) || op.quantity<floor.total) fail(409,'operation-id-conflict');
      return {...result,replayed:true};
    }
    if(lookupOnly) return {operationId:op.operationId,status:'unknown'};
    const {cell,field}=target(data,op);
    if(rev!==op.expectedRevision || cell[field]!==op.expectedQuantity) fail(409,'inventory-conflict');
    const floor=reservationFloor(data.inventoryReservations,op);
    if(data.inventoryReservationAuthority===1 || authority.exists) assertReservationAuthority(authority,data.inventoryReservations,path);
    if(op.quantity<floor.total) fail(409,'reserved-stock-floor');
    tx.update(ref,{...updatedField(data,op),inventoryRevision:rev+1,inventoryWriteProtocol:1,updatedAt:FieldValue.serverTimestamp()});
    tx.create(receipt,{schema:'manual-inventory-server-v2',actorUid:uid,operation:op,intent:fingerprint,path,beforeRevision:rev,revision:rev+1,result,reservations:data.inventoryReservations,reservationFloor:floor,createdAt:FieldValue.serverTimestamp()});
    return {...result,replayed:false};
  },{maxAttempts:3});
}

// Migration must reconcile both sources under a write freeze before creating
// this server-only checkpoint. No browser/API bootstrap or inferred empty ledger.
export function assertReservationAuthority(snapshot,ledger,path) {
  const a=snapshot.exists?snapshot.data():null;
  if(!a || a.schema!=='reservation-authority-v1' || a.path!==path
    || a.ledgerHash!==hash(ledger) || a.ecComplete!==true || a.eventComplete!==true
    || typeof a.reconciliationId!=='string' || !a.reconciliationId.length
    || !(a.reconciledAt instanceof Timestamp)) fail(409,'reservation-authority-required');
  return a;
}
