// JSON-only offline adapter contract. Never a Firestore writer or commit receipt.
import {hash,keys,integer,object,fail,normalize} from './validation.mjs';
import {clone} from './sale-primitives.mjs';
import {planVoid,verifyCandidate,normalizeVoid} from './void-pure.mjs';
const check=(v)=>{if(!v)fail('reconciliation-required');};
function json(x){
  if(x===null||typeof x==='string'||typeof x==='boolean')return;
  if(typeof x==='number'){check(Number.isFinite(x)&&!Object.is(x,-0));return;}
  check(Array.isArray(x)||object(x));for(const v of Object.values(x))json(v);
}
function auditValue(a){
  keys(a,['email','time']);check(typeof a.email==='string');
  keys(a.time,['seconds','nanoseconds']);
  check(integer(a.time.seconds)&&integer(a.time.nanoseconds)&&a.time.nanoseconds>=0&&a.time.nanoseconds<1000000000);
  return clone(a);
}
// Timestamp-shaped DTO is fixture data, not a validated Firestore Timestamp.
export function boundaryPlan(input,audit){
  json(input);const a=auditValue(audit),base=planVoid(input),p=base.projection,s=input.original.sale,tid=s.transactionId;
  const sale={...p.saleAfter,voidedByEmail:a.email,voidedAt:a.time,updatedAt:a.time};
  const lock={...p.lockAfter,voidedAt:a.time};
  const returns=Object.fromEntries(s.items.map((x,i)=>{
    const movementId=tid+'__void__'+(i+1);
    return [movementId,{movementId,transactionId:tid,reversalOfTransactionId:tid,sessionId:s.sessionId,
      type:'return',reason:'return',sourceAction:'sale_void',category:x.category,label:x.label,quantity:x.quantity,
      expectedInventoryDelta:x.quantity,appliedInventoryDelta:x.quantity,inventoryApplied:true,
      trackingMode:'sku',variantId:x.variantId,inventoryKey:x.inventoryKey,inventorySource:x.inventorySource,status:'applied',createdAt:a.time}];
  }));
  const session={...p.sessionAfter,lastVoidAt:a.time,updatedAt:a.time};
  if(s.items.some(x=>x.eventInventoryApplied))session.inventoryCount={...session.inventoryCount,salesUpdatedAt:a.time};
  const stocks=clone(p.stocksAfter);for(const path of Object.keys(input.expectedRevisions))stocks[path].updatedAt=a.time;
  const result={transactionId:tid,duplicate:false,status:'voided',restoredItemCount:s.itemCount};
  const evidence={schema:'offline-void-boundary-v1',base,audit:a,beforeSaleHash:hash(input.original.sale),
    afterSaleHash:hash(sale),returnHashes:Object.fromEntries(Object.entries(returns).map(([id,m])=>[id,hash(m)])),result};
  lock.serverVoidV1=evidence;
  return {kind:'offline-only',newCommit:false,sale,lock,movements:{...clone(input.original.movements),...returns},session,stocks,result};
}
export function verifyObserved(records,anchor,sessionRef){
  json(records);const v=records?.lock?.serverVoidV1;
  check(v?.schema==='offline-void-boundary-v1');
  const base=verifyCandidate(v.base,anchor),b=base.serverVoidV1;
  const expected=boundaryPlan({original:b.original,trustedAnchor:anchor,intent:b.intent,state:b.beforeState,expectedRevisions:b.expectedRevisions},v.audit);
  keys(sessionRef,['id','exists']);check(sessionRef.exists===true&&sessionRef.id===expected.sale.sessionId);
  // Compare the complete union queried by transactionId and document-ID prefix.
  // Extra/orphan/replaced original movements and status-only voids are rejected.
  for(const k of ['sale','lock','movements'])check(hash(records[k])===hash(expected[k]));
  return expected;
}
export function reconcileVoid(records,anchor,intent,sessionRef){
  const e=verifyObserved(records,anchor,sessionRef);
  check(hash(normalizeVoid(intent))===e.lock.serverVoidV1.base.serverVoidV1.intentHash);
  return {kind:'offline-reconciliation-only',newCommit:false,result:{...e.result,duplicate:true}};
}
export function reconcileSale(records,anchor,input,sessionRef,{query=false}={}){
  const e=verifyObserved(records,anchor,sessionRef),op=normalize(input,query),p=e.lock.serverSaleV1;
  check(op.transactionId===e.sale.transactionId&&(query||hash(op)===p.requestHash));
  // Matches sales.mjs reply keys; committed describes the ORIGINAL sale only.
  return {kind:'offline-reconciliation-only',newCommit:false,mayCreateSale:false,
    reply:{transactionId:e.sale.transactionId,sessionId:e.sale.sessionId,outcome:'committed',replayed:true,
      requestHash:p.requestHash,result:clone(p.result),currentSaleStatus:'voided'}};
}
