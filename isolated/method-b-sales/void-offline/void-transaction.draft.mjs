// UNCONNECTED DRAFT. No SDK loading, listener, runtime initialization or usable writer.
import {fail,hash,normalize,parseJSON} from './validation.mjs';
import {normalizeVoid} from './void-pure.mjs';
import {boundaryPlan} from './void-boundary.mjs';
import {target,rev} from './sale-primitives.mjs';

export const VOID_ROUTE='/v1/sales/void';
// Shape validation only. The existing HTTP layer must retain token revocation,
// verified-email/UID, loopback, byte-limit and error-class checks before dispatch.
export function parseVoidHttp(method,url,raw){
  if(method!=='POST'||url!==VOID_ROUTE)fail('not-found',404);
  if(typeof raw!=='string')fail('invalid-json',400);
  if(Buffer.byteLength(raw)>32768)fail('body-too-large',413);
  return normalizeVoid(parseJSON(raw));
}

// Reviewable offline write set. The marker and candidate proof explicitly forbid
// handing these objects directly to an Admin transaction.
export function offlineWriteSet(input,audit){
  const b=boundaryPlan(input,audit),tid=b.sale.transactionId;
  const writes=Object.entries(input.expectedRevisions).map(([path])=>{
    const s=b.stocks[path];
    return {op:'update',path,data:{...(path==='tshirtStock/master'?{inventory_v2:s.inventory_v2}:{designs:s.designs}),
      inventoryRevision:s.inventoryRevision,inventoryWriteProtocol:1,updatedAt:audit.time}};
  });
  writes.push({op:'update',path:`salesTransactions/${tid}`,data:{status:'voided',voidReason:b.sale.voidReason,
    voidedByEmail:b.sale.voidedByEmail,voidedAt:audit.time,updatedAt:audit.time}});
  writes.push({op:'update',path:`transactionLocks/${tid}`,data:{status:'voided',voidedAt:audit.time,serverVoidV1:b.lock.serverVoidV1}});
  for(let i=0;i<b.sale.items.length;i++){
    const mid=`${tid}__void__${i+1}`;
    writes.push({op:'create',path:`inventoryMovements/${mid}`,data:b.movements[mid]});
  }
  const event=b.sale.items.some(x=>x.eventInventoryApplied);
  writes.push({op:'update',path:`salesSessions/${b.sale.sessionId}`,data:{salesSummary:b.session.salesSummary,
    ...(event?{'inventoryCount.soldByVariant':b.session.inventoryCount.soldByVariant,'inventoryCount.salesUpdatedAt':audit.time}:{}),
    lastVoidAt:audit.time,updatedAt:audit.time}});
  return {kind:'offline-write-set-only',newCommit:false,writes,result:b.result};
}

function requireVerifiedCodec(){
  // Deliberately no env flag, option, injected codec or fallback to unlock this.
  // Missing: real Timestamp codec + authoritative original/void proof verification
  // + serverTimestamp/hash contract. Offline candidate schemas are NOT receipts.
  fail('void-timestamp-proof-gate-closed',503);
}

async function readRecords(tx,db,tid,documentId){
  const sale=db.collection('salesTransactions').doc(tid),lock=db.collection('transactionLocks').doc(tid);
  const [s,l]=await tx.getAll(sale,lock);
  const byTransaction=await tx.get(db.collection('inventoryMovements').where('transactionId','==',tid));
  const byPrefix=await tx.get(db.collection('inventoryMovements').orderBy(documentId).startAt(tid+'__').endAt(tid+'__\uf8ff'));
  const movements=new Map([...byTransaction.docs,...byPrefix.docs].map(d=>[d.id,d.data()]));
  return {sale,lock,s:s.data(),l:l.data(),movements};
}

// This body documents the single-transaction integration, but cannot run while
// requireVerifiedCodec fails. There is no public switch that bypasses the gate.
// Future codec methods are obligations, not existing verified implementations.
export async function voidSaleDraft(db,actor,input){
  const op=normalizeVoid(input),codec=requireVerifiedCodec();
  codec.guardIsolatedAndActor(db,actor); // preserve runtime.mjs + sales.mjs guard
  return db.runTransaction(async tx=>{
    const r=await readRecords(tx,db,op.transactionId,codec.documentId());
    if(!r.s&&!r.l&&!r.movements.size)return {transactionId:op.transactionId,outcome:'not-found'};
    // Must reject orphan/legacy/unknown records; no inferred completed snapshot.
    const checked=codec.verifySaleOrVoid(r,op.transactionId);
    if(checked.saleProof.requestHash!==op.expectedSaleRequestHash)fail('intent-conflict');
    const sessionRef=db.collection('salesSessions').doc(checked.sessionId);
    const session=await tx.get(sessionRef);
    if(!session.exists)fail('reconciliation-required');
    if(checked.status==='voided'){
      // Verify all original AND return movements before same-intent replay.
      if(checked.voidIntentHash!==hash(op))fail('intent-conflict');
      return {...checked.voidResult,duplicate:true};
    }
    if(checked.status!=='completed')fail('reconciliation-required');
    if(session.data().status!=='open')fail('session-closed');
    const stocks={},expectedRevisions={};
    for(const path of new Set(checked.original.sale.items.map(x=>target(x).path))){
      const snap=await tx.get(db.doc(path));
      if(!snap.exists)fail('unknown-stock');
      stocks[path]=snap.data();expectedRevisions[path]=rev(stocks[path]);
    }
    // All DB reads precede all writes, including retries. Never re-resolve SKU,
    // prices or costs from current variants. Adapter-created anchor only.
    const inputDTO=codec.toPureInput({original:checked.original,intent:op,
      state:{session:session.data(),stocks},expectedRevisions});
    const candidate=offlineWriteSet(inputDTO,codec.auditDTO(actor));
    // Must retain real Timestamp metadata, emit sale-server/void-server proof,
    // bind actor + original snapshot + intent + result + return hashes, replace
    // DTO audit times with server timestamps, and reject both offline schemas.
    const encoded=codec.encodeVerifiedWrites(candidate,checked,actor);
    for(const w of encoded.writes){
      if(w.op==='create')tx.create(db.doc(w.path),w.data);
      else if(w.op==='update')tx.update(db.doc(w.path),w.data);
      else fail('reconciliation-required');
    }
    return encoded.result;
  },{maxAttempts:3}); // resolve only after Admin commit; unknown ack stays failure
}

// Intended replacement for the existing-record branch of BOTH commitSale and
// saleResult. No caller is connected yet. Never fall through to new sale logic.
export async function reconcileVoidedSaleDraft(tx,db,records,input,{query=false}={}){
  const op=normalize(input,query),codec=requireVerifiedCodec();
  const p=codec.verifySaleOrVoid(records,op.transactionId);
  if(p.status!=='voided'||(!query&&p.saleProof.requestHash!==hash(op)))fail('reconciliation-required');
  if(!(await tx.get(db.collection('salesSessions').doc(p.sessionId))).exists)fail('reconciliation-required');
  return {transactionId:op.transactionId,sessionId:p.sessionId,outcome:'committed',replayed:true,
    requestHash:p.saleProof.requestHash,result:p.saleProof.result,currentSaleStatus:'voided'};
}
