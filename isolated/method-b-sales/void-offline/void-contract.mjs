// Offline contracts only. No receipt issuer, SDK loader or database capability.
import {hash,keys,fail} from './validation.mjs';
import {verifyOriginal,normalizeVoid} from './void-pure.mjs';
import {proofCandidateAdapter} from './void-proof-candidate.mjs';
import {offlineWriteSet} from './void-transaction.draft.mjs';
const check=x=>{if(!x)fail('reconciliation-required');};
const zero={seconds:0,nanoseconds:0};

// A same-domain lock is NOT independent evidence. There is intentionally no
// boolean, callback or request-provided digest that enables durable acceptance.
export function requireDurableAnchor(){fail('independent-anchor-unproven',503);}

export function voidContract(codec,allowedUids,isServerSentinel){
  check(typeof isServerSentinel==='function');
  const candidates=proofCandidateAdapter(codec,allowedUids),uids=new Set(allowedUids);
  const plans=new WeakMap();
  function actorChecked(actor){
    const a=codec.copy(actor);keys(a,['uid','email','email_verified']);
    check(uids.has(a.uid)&&a.email_verified===true&&typeof a.email==='string'&&a.email.length>0);
    return a;
  }
  function inspectOriginal(original){
    const o=codec.copy(original);
    codec.stamp(o.sale.createdAt);codec.stamp(o.sale.updatedAt);codec.stamp(o.lock.createdAt);
    for(const m of Object.values(o.movements))codec.stamp(m.createdAt);
    check(uids.has(o.lock.serverSaleV1.actorUid));
    const dto=codec.dto(o);verifyOriginal(dto,hash(dto));
    return {kind:'structural-consistency-only',durableAnchor:false,originalHash:codec.digest(o)};
  }
  function prepare(input,actor,sessionRef){
    // Exact keys exclude audit/identity/hash injection through request input.
    const b=codec.copy(input);keys(b,['original','intent','state','expectedRevisions']);
    const a=actorChecked(actor),inspection=inspectOriginal(b.original);
    const ref=codec.copy(sessionRef);keys(ref,['id','exists']);
    check(ref.exists===true&&ref.id===b.original.sale.sessionId);
    normalizeVoid(b.intent);
    const dto=codec.dto(b);
    const writes=offlineWriteSet({...dto,trustedAnchor:hash(dto.original)},{email:a.email,time:zero}).writes;
    // Candidate serverVoidV1 is deliberately not emitted as a persisted proof.
    // The existing proof contains a resolved time and hashes over that value;
    // replacing it with a sentinel would make its read-side hashes contradictory.
    for(const w of writes)if(w.path.startsWith('transactionLocks/'))delete w.data.serverVoidV1;
    const slots=w=>w.path.startsWith('salesTransactions/')?['voidedAt','updatedAt']:
      w.path.startsWith('transactionLocks/')?['voidedAt']:
      w.path.startsWith('inventoryMovements/')?['createdAt']:
      w.path.startsWith('salesSessions/')?['lastVoidAt','updatedAt',...(Object.hasOwn(w.data,'inventoryCount.salesUpdatedAt')?['inventoryCount.salesUpdatedAt']:[])]:['updatedAt'];
    const timeSlots=writes.map(slots);
    const normalized=writes.map((w,i)=>({...w,data:Object.fromEntries(Object.entries(w.data).filter(([k])=>!timeSlots[i].includes(k)))}));
    const semantic={schema:'void-write-contract-offline-v1',originalHash:inspection.originalHash,
      actor:a,intent:b.intent,sessionId:ref.id,expectedRevisions:b.expectedRevisions,
      beforeStateHash:codec.digest(b.state),normalized,timeSlots};
    const plan=Object.freeze({kind:'unpersistable-write-contract',newCommit:false,semanticHash:codec.digest(semantic)});
    plans.set(plan,{b,a,writes,timeSlots,semantic});return plan;
  }
  function get(plan){check(plans.has(plan));return plans.get(plan);}
  function materializeForInspection(plan,sentinel){
    check(isServerSentinel(sentinel)===true);
    const p=get(plan),writes=codec.copy(p.writes);
    writes.forEach((w,i)=>p.timeSlots[i].forEach(k=>{w.data[k]=sentinel;}));
    return {kind:'unpersistable-write-contract',newCommit:false,writes};
  }
  function inspectResolved(plan,observed){
    const p=get(plan),out=codec.copy(observed);keys(out,['kind','newCommit','writes']);
    check(out.kind==='unpersistable-write-contract'&&out.newCommit===false&&Array.isArray(out.writes)&&out.writes.length===p.writes.length);
    let timeHash;
    out.writes.forEach((w,i)=>{
      keys(w,['op','path','data']);
      for(const k of p.timeSlots[i]){
        check(isServerSentinel(w.data[k])!==true);codec.stamp(w.data[k]);
        const h=codec.digest(w.data[k]);if(timeHash===undefined)timeHash=h;else check(h===timeHash);
        delete w.data[k];
      }
    });
    check(codec.digest(out.writes)===codec.digest(p.semantic.normalized));
    return {kind:'resolved-write-shape-only',semanticHash:plan.semanticHash,durableAnchor:false,commitAcknowledged:false};
  }
  // Both existing-record branches share the same structural candidate verifier.
  // No callback can write stock or fall through to a fresh sale here.
  function inspectReplay(records,heldHashes,input,sessionRef,query){
    return candidates.saleReplay(records,heldHashes,input,sessionRef,{query});
  }
  function acceptPersisted(){return requireDurableAnchor();}
  return Object.freeze({inspectOriginal,prepare,materializeForInspection,inspectResolved,
    inspectCommitReplay:(r,h,i,s)=>inspectReplay(r,h,i,s,false),
    inspectResultReplay:(r,h,i,s)=>inspectReplay(r,h,i,s,true),acceptPersisted});
}
