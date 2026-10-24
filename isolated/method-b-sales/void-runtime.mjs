import {Timestamp,FieldPath,FieldValue} from 'firebase-admin/firestore';
import {assertIsolated,PROJECT,UIDS} from './runtime.mjs';
import {timestampCodec} from './void-offline/timestamp-codec.mjs';
import {transactionReader} from './void-offline/transaction-reader.mjs';

// Only the isolated harness may attest its protected writers and loaded rules.
// No stored flag, request field, or digest supplies this attestation.
export function isolatedVoid(rt,assertBoundary,hooks={}){
  const stamps=new WeakSet(),sentinels=new WeakSet();
  function trust(x){
    if(x instanceof Timestamp)stamps.add(x);
    else if(x&&typeof x==='object')for(const v of Object.values(x))trust(v);
    return x;
  }
  function snapshot(s){
    if(s.docs)return {docs:s.docs.map(snapshot)};
    const data=trust(s.data());
    return {id:s.id,ref:s.ref,exists:s.exists,data:()=>data};
  }
  const wrap=tx=>({get:async ref=>snapshot(await tx.get(ref)),
    getAll:async(...refs)=>(await tx.getAll(...refs)).map(snapshot),
    create:(...args)=>tx.create(...args),update:(...args)=>tx.update(...args)});
  const db={doc:p=>rt.db.doc(p),collection:p=>rt.db.collection(p),
    runTransaction:(fn,options)=>{let attempts=0;return rt.db.runTransaction(async tx=>{
      attempts++;hooks.onAttempt?.(attempts);
      const result=await fn(wrap(tx));
      await hooks.afterReads?.({tx,attempts});
      hooks.beforeCommit?.({tx,db:rt.db});
      return result;
    },options);}};
  const reader=transactionReader({db,auth:rt.auth,allowedUids:UIDS,
    codec:timestampCodec(Timestamp,x=>stamps.has(x)),documentId:()=>FieldPath.documentId(),
    serverTimestamp:()=>{const s=FieldValue.serverTimestamp();sentinels.add(s);return s;},
    isServerSentinel:x=>sentinels.has(x),assertBoundary:async()=>{
      assertIsolated();return rt.db.projectId===PROJECT&&typeof assertBoundary==='function'&&await assertBoundary()===true;
    }});
  return Object.freeze({void:reader.void,
    replay:(kind,tx,token,input)=>reader.replayInTransaction(kind,wrap(tx),token,input)});
}
