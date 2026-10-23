// Unconnected dependency-injected adapter. No loader and no production entry point.
// db/auth/codec/FieldPath/sentinel factory and boundary attestation are trusted
// server dependencies, NEVER request fields. A malicious Admin is outside scope.
import {fail,id,normalize} from './validation.mjs';
import {target,rev} from './sale-primitives.mjs';
import {normalizeVoid} from './void-pure.mjs';
import {protectedVoid} from './protected-void.mjs';
const check=x=>{if(!x)fail('reconciliation-required');};
export function transactionReader({db,auth,codec,allowedUids,documentId,serverTimestamp,isServerSentinel,assertBoundary}){
  const reads=new WeakSet(),uids=new Set(allowedUids);
  const core=protectedVoid({codec,allowedUids:[...uids],isServerSentinel,authorizeRead:x=>reads.has(x)});
  async function boundary(){
    // Must attest the selected database, complete client writer exclusion and
    // trusted Admin writer inventory. Stored flags and HTTP claims cannot do so.
    if(typeof assertBoundary!=='function'||await assertBoundary()!==true)fail('protected-writer-boundary-unproven',503);
  }
  async function actor(token){
    if(typeof token!=='string'||!token)fail('unauthenticated',401);
    const a=await auth.verifyIdToken(token,true);
    if(!uids.has(a?.uid)||a.email_verified!==true||typeof a.email!=='string'||!a.email)fail('forbidden',403);
    return {uid:a.uid,email:a.email,email_verified:true};
  }
  function doc(s,path){
    check(s?.ref?.path===path&&typeof s.exists==='boolean');
    return s.exists?codec.copy(s.data()):null;
  }
  async function read(tx,op,initial){
    const tid=op.transactionId,sp='salesTransactions/'+tid,lp='transactionLocks/'+tid;
    const pair=await tx.getAll(db.doc(sp),db.doc(lp));check(pair.length===2);
    const sale=doc(pair[0],sp),lock=doc(pair[1],lp),movements={};
    const collection=db.collection('inventoryMovements');
    // Include orphan returns with a changed transactionId and non-prefix ID.
    const queries=[collection.where('transactionId','==',tid),collection.where('reversalOfTransactionId','==',tid),
      collection.orderBy(documentId()).startAt(tid+'__').endAt(tid+'__\uf8ff')];
    for(const q of queries){const result=await tx.get(q);check(Array.isArray(result.docs));
      for(const s of result.docs){id(s.id);const value=doc(s,'inventoryMovements/'+s.id);check(value!==null);
        if(Object.hasOwn(movements,s.id))check(codec.digest(movements[s.id])===codec.digest(value));
        else Object.defineProperty(movements,s.id,{value,enumerable:true});
      }
    }
    if(sale===null&&lock===null&&Object.keys(movements).length===0)return {absent:true,transactionId:tid,sale:null,lock:null,movements};
    check(sale!==null&&lock!==null&&sale.transactionId===tid&&lock.transactionId===tid);
    id(sale.sessionId);const path='salesSessions/'+sale.sessionId;
    const session=doc(await tx.get(db.doc(path)),path);check(session!==null);
    const sessionRef={id:sale.sessionId,exists:true};
    if(!initial||sale.status==='voided')return {sale,lock,movements,sessionRef};
    check(Array.isArray(sale.items));const stocks={},expectedRevisions={};
    for(const path of new Set(sale.items.map(x=>target(x).path))){
      const stock=doc(await tx.get(db.doc(path)),path);check(stock!==null);
      stocks[path]=stock;expectedRevisions[path]=rev(stock);
    }
    return {original:{sale,lock,movements},intent:op,state:{session,stocks},expectedRevisions,sessionRef};
  }
  // Validate every encoding and resolve every reference before staging ANY write.
  // Sentinel identity is accepted only from this attempt's trusted factory.
  function encode(value,sentinel){
    if(value===sentinel)return value;
    if(Array.isArray(value))return value.map(x=>encode(x,sentinel));
    if(value&&Object.getPrototypeOf(value)===Object.prototype){
      return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v,sentinel)]));
    }
    return codec.copy(value);
  }
  async function execute(kind,token,input){
    await boundary();const op=kind==='void'?normalizeVoid(codec.copy(input)):normalize(codec.copy(input),kind==='result');
    await actor(token); // Reject before opening a database transaction.
    return await db.runTransaction(async tx=>{
      await boundary();const a=await actor(token); // Recheck revocation on retries.
      const snapshot=await read(tx,op,kind==='void');reads.add(snapshot);
      if(snapshot.absent){
        if(kind!=='void')fail('void-replay-not-applicable');
        return {transactionId:op.transactionId,outcome:'not-found'};
      }
      if(kind!=='void')return kind==='commit'?core.commitReplay(snapshot,op):core.resultReplay(snapshot,op);
      if(!Object.hasOwn(snapshot,'original'))return core.voidReplay(snapshot,op);
      const plan=core.prepare(snapshot,a),sentinel=serverTimestamp(),out=core.writes(plan,sentinel);
      const writes=out.writes.map(w=>{check(['create','update'].includes(w.op));return {op:w.op,ref:db.doc(w.path),data:encode(w.data,sentinel)};});
      for(const w of writes)tx[w.op](w.ref,w.data);
      return out.result;
    },kind==='void'?{maxAttempts:3}:{readOnly:true,maxAttempts:3});
  }
  // commit/result methods are voided-record branches only, not new-sale routes.
  return Object.freeze({void:(token,input)=>execute('void',token,input),
    commitReplay:(token,input)=>execute('commit',token,input),resultReplay:(token,input)=>execute('result',token,input)});
}
