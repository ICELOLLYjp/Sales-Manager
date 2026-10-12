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
const hash=x=>createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
function revision(data) {
  const value=Object.hasOwn(data,'inventoryRevision')?data.inventoryRevision:0;
  if(!integer(value) || value<0 || value>=Number.MAX_SAFE_INTEGER) fail(409,'invalid-stored-revision');
  return value;
}
function target(data,op) {
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
function updatedField(data,op) {
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
export async function editInventory(db,uid,input) {
  assertIsolated();
  if(db.projectId!==PROJECT) fail(500,'wrong-project');
  if(!UIDS.includes(uid)) fail(403,'forbidden');
  const op=normalize(input), fingerprint=hash(op);
  const path=op.stock==='tshirt'?'tshirtStock/master':'accessoryStock/shared';
  const ref=db.doc(path), receipt=db.collection('inventoryWriteReceipts').doc(op.operationId);
  return db.runTransaction(async tx=>{
    const [stock,done]=await tx.getAll(ref,receipt);
    if(!stock.exists) fail(404,'stock-not-found');
    const data=stock.data(), rev=revision(data);
    const result={operationId:op.operationId,fingerprint,path,revision:op.expectedRevision+1,beforeQuantity:op.expectedQuantity,quantity:op.quantity};
    if(done.exists) {
      const r=done.data();
      // Legacy/unknown receipts must never suppress a new server operation.
      if(r.schema!=='manual-inventory-server-v1' || !UIDS.includes(r.actorUid)
        || r.intent!==fingerprint || r.path!==path || r.revision!==result.revision
        || r.beforeRevision!==op.expectedRevision || !object(r.operation) || hash(r.operation)!==fingerprint
        || !object(r.result) || hash(r.result)!==hash(result) || !(r.createdAt instanceof Timestamp)
        || rev<r.revision) fail(409,'operation-id-conflict');
      return {...result,replayed:true};
    }
    const {cell,field}=target(data,op);
    if(rev!==op.expectedRevision || cell[field]!==op.expectedQuantity) fail(409,'inventory-conflict');
    tx.update(ref,{...updatedField(data,op),inventoryRevision:rev+1,inventoryWriteProtocol:1,updatedAt:FieldValue.serverTimestamp()});
    tx.create(receipt,{schema:'manual-inventory-server-v1',actorUid:uid,operation:op,intent:fingerprint,path,beforeRevision:rev,revision:rev+1,result,createdAt:FieldValue.serverTimestamp()});
    return {...result,replayed:false};
  },{maxAttempts:3});
}
