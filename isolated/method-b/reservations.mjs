import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { ApiError, normalize, hash, revision, target, updatedField, reservationFloor, assertReservationAuthority } from './inventory.mjs';
import { assertIsolated, PROJECT } from './runtime.mjs';

// Server identities only; never use the stock operator's browser identity.
// Production service identity/IAM and upstream Woo/Session adapters are not enabled.
export const PRODUCERS=Object.freeze({ec:'fixture-ec-producer',event:'fixture-event-producer'});
const fail=(status,code)=>{throw new ApiError(status,code);};
const exact=(x,ks)=>x && Object.getPrototypeOf(x)===Object.prototype && Object.keys(x).length===ks.length && ks.every(k=>Object.hasOwn(x,k));
const ident=x=>typeof x==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(x);
const floor=(ledger,op)=>reservationFloor(ledger,Object.fromEntries(['version','operationId','stock','sku','expectedRevision','expectedQuantity','quantity'].map(k=>[k,op[k]])));
export function normalizeReservation(input) {
  if(!exact(input,['version','operationId','stock','sku','expectedRevision','expectedQuantity','quantity','kind','source','action',...(input?.action==='return'?['returnOf']:[])])) fail(400,'invalid-schema');
  const {kind,source,action}=input;
  if(!['ec','event'].includes(kind) || !['hold','confirm','release','sale','return'].includes(action)
    || !exact(source,['namespace','documentId','lineId']) || !Object.values(source).every(ident)
    || (kind!=='event' && ['sale','return'].includes(action))) fail(400,'invalid-source-or-action');
  const op=normalize(Object.fromEntries(['version','operationId','stock','sku','expectedRevision','expectedQuantity','quantity'].map(k=>[k,input[k]])));
  if(op.expectedQuantity<0 || op.quantity<0 || (op.quantity===0 && action!=='release')) fail(400,'invalid-quantity');
  if(action==='return' && (!ident(input.returnOf) || input.returnOf===op.operationId)) fail(400,'invalid-return-reference');
  return {...op,kind,source:{namespace:source.namespace,documentId:source.documentId,lineId:source.lineId},action,...(action==='return'?{returnOf:input.returnOf}:{})};
}
export const commitmentId=op=>hash({kind:op.kind,source:op.source,stock:op.stock,sku:op.sku});
function transition(ledger,op) {
  const id=commitmentId(op), entries=ledger.entries.map(e=>({...e}));
  const index=entries.findIndex(e=>e.id===id), old=entries[index];
  let physical=op.expectedQuantity;
  if(op.action==='hold') {
    if(old) fail(409,'commitment-already-exists');
    entries.push({id,kind:op.kind,state:'held',sku:op.sku,quantity:op.quantity});
  } else {
    if(!old || old.kind!==op.kind || hash(old.sku)!==hash(op.sku)) fail(409,'commitment-not-found');
    if(op.action==='confirm') {
      if(old.state!=='held' || old.quantity!==op.quantity) fail(409,'invalid-transition');
      entries[index]={...old,state:'confirmed'};
    } else if(op.action==='release') {
      if(!['held','confirmed'].includes(old.state) || old.quantity!==op.quantity) fail(409,'invalid-transition');
      entries[index]={...old,state:'released'};
    } else if(op.action==='sale') {
      if(old.state!=='confirmed' || op.quantity>old.quantity || op.quantity>physical) fail(409,'invalid-transition');
      entries[index]={...old,quantity:old.quantity-op.quantity}; physical-=op.quantity;
    } else {
      // Return must use the original sale receipt; handled separately below.
      if(old.state!=='confirmed') fail(409,'invalid-transition');
      entries[index]={...old,quantity:old.quantity+op.quantity}; physical+=op.quantity;
      if(!Number.isSafeInteger(physical) || !Number.isSafeInteger(entries[index].quantity)) fail(409,'quantity-overflow');
    }
  }
  const next={...ledger,entries}, minimum=floor(next,op);
  if(physical<minimum.total) fail(409,'reserved-stock-floor');
  return {ledger:next,quantity:physical,commitmentId:id};
}

// Call only with a token obtained by the trusted upstream server. Verification
// is performed here (revocation included), not delegated to a caller-supplied UID.
// Input has no complete flag, ledger, arbitrary path, or receipt proof.
export async function produceReservation({db,auth},token,input) {
  assertIsolated(); if(db.projectId!==PROJECT) fail(500,'wrong-project');
  const op=normalizeReservation(input);
  let claims; try { claims=await auth.verifyIdToken(token,true); } catch { fail(401,'unauthenticated'); }
  if(claims.uid!==PRODUCERS[op.kind] || claims.inventoryProducer!==op.kind || claims.email_verified!==true) fail(403,'forbidden');
  const path=op.stock==='tshirt'?'tshirtStock/master':'accessoryStock/shared', fingerprint=hash(op);
  const ref=db.doc(path), receipt=db.doc(`inventoryWriteReceipts/${op.operationId}`), authorityRef=db.doc(`inventoryReservationAuthorities/${op.stock}`);
  const sourceRef=db.doc(`inventoryCommitmentSources/${hash({kind:op.kind,source:op.source})}`);
  return db.runTransaction(async tx=>{
    const returnRefs=op.action==='return'?[db.doc(`inventoryWriteReceipts/${op.returnOf}`),db.doc(`inventorySaleReturns/${op.returnOf}`)]:[];
    const [stock,done,authority,binding,sale,returned]=await tx.getAll(ref,receipt,authorityRef,sourceRef,...returnRefs);
    if(!stock.exists) fail(404,'stock-not-found');
    const data=stock.data(), rev=revision(data);
    if(done.exists) {
      const r=done.data();
      if(r.schema!=='reservation-server-v1' || r.actorUid!==claims.uid || r.intent!==fingerprint
        || !r.operation || !r.result || hash(r.operation)!==fingerprint || r.path!==path || !(r.createdAt instanceof Timestamp)
        || r.revision!==op.expectedRevision+1 || rev<r.revision) fail(409,'operation-id-conflict');
      let proof;
      try {
        assertReservationAuthority({exists:true,data:()=>r.authorityBefore},r.beforeLedger,path);
        floor(r.beforeLedger,op); proof=transition(r.beforeLedger,op);
      }
      catch { fail(409,'operation-id-conflict'); }
      const result={operationId:op.operationId,fingerprint,path,revision:r.revision,...proof};
      if(hash(result)!==hash(r.result)) fail(409,'operation-id-conflict');
      return {...result,replayed:true};
    }
    const {cell,field}=target(data,op);
    if(rev!==op.expectedRevision || cell[field]!==op.expectedQuantity) fail(409,'inventory-conflict');
    floor(data.inventoryReservations,op);
    assertReservationAuthority(authority,data.inventoryReservations,path);
    if(binding.exists && (binding.data().commitmentId!==commitmentId(op) || binding.data().path!==path)) fail(409,'source-sku-conflict');
    if(op.action!=='hold' && !binding.exists) fail(409,'source-binding-required');
    if(op.action==='return') {
      const s=sale.exists?sale.data():null;
      if(!s || s.schema!=='reservation-server-v1' || s.operation?.action!=='sale'
        || s.operation.kind!=='event' || s.actorUid!==PRODUCERS.event || s.path!==path
        || s.operation.operationId!==op.returnOf || s.intent!==hash(s.operation)
        || s.revision!==s.operation.expectedRevision+1 || rev<s.revision
        || !(s.createdAt instanceof Timestamp) || commitmentId(s.operation)!==commitmentId(op)
        || s.operation.quantity!==op.quantity || returned.exists) fail(409,'original-sale-receipt-required');
      let proof; try { floor(s.beforeLedger,s.operation); proof=transition(s.beforeLedger,s.operation); }
      catch { fail(409,'original-sale-receipt-required'); }
      if(hash(s.result)!==hash({operationId:op.returnOf,fingerprint:s.intent,path,revision:s.revision,...proof})) fail(409,'original-sale-receipt-required');
    }
    const next=transition(data.inventoryReservations,op);
    const result={operationId:op.operationId,fingerprint,path,revision:rev+1,...next};
    tx.update(ref,{...updatedField(data,{...op,quantity:next.quantity}),inventoryReservations:next.ledger,inventoryReservationAuthority:1,inventoryRevision:rev+1,inventoryWriteProtocol:1,updatedAt:FieldValue.serverTimestamp()});
    tx.update(authorityRef,{ledgerHash:hash(next.ledger),updatedAt:FieldValue.serverTimestamp()});
    if(!binding.exists) tx.create(sourceRef,{commitmentId:commitmentId(op),path,kind:op.kind,source:op.source,sku:op.sku,createdAt:FieldValue.serverTimestamp()});
    tx.create(receipt,{schema:'reservation-server-v1',actorUid:claims.uid,operation:op,intent:fingerprint,path,revision:rev+1,beforeLedger:data.inventoryReservations,authorityBefore:authority.data(),result,createdAt:FieldValue.serverTimestamp()});
    if(op.action==='return') tx.create(returnRefs[1],{operationId:op.operationId,saleOperationId:op.returnOf,createdAt:FieldValue.serverTimestamp()});
    return {...result,replayed:false};
  },{maxAttempts:3});
}
