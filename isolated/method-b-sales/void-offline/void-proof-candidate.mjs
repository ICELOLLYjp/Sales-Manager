// NOT a persisted server receipt or writer. No SDK, DB, clock or HTTP access.
import {hash,normalize,keys,fail} from './validation.mjs';
import {normalizeVoid,verifyOriginal} from './void-pure.mjs';
import {boundaryPlan} from './void-boundary.mjs';
const check=x=>{if(!x)fail('reconciliation-required');};
const SCHEMA='void-timestamp-candidate-v1';
// codec and allowedUids are trusted adapter dependencies, never request fields.
export function proofCandidateAdapter(codec,allowedUids){
  const uids=new Set(allowedUids);
  function originalChecked(original,anchor){
    check(codec.digest(original)===anchor);
    codec.stamp(original.sale.createdAt);codec.stamp(original.sale.updatedAt);
    codec.stamp(original.lock.createdAt);
    for(const m of Object.values(original.movements))codec.stamp(m.createdAt);
    check(uids.has(original.lock.serverSaleV1.actorUid));
    const dto=codec.dto(original);verifyOriginal(dto,hash(dto));return dto;
  }
  function build(input,audit,anchor){
    const original=codec.copy(input.original),dto=originalChecked(original,anchor);
    keys(audit,['uid','email','email_verified','time']);
    check(uids.has(audit.uid)&&audit.email_verified===true&&typeof audit.email==='string'&&audit.email.length>0);
    const time=codec.stamp(audit.time),intent=normalizeVoid(codec.dto(input.intent));
    const state=codec.copy(input.state),expectedRevisions=codec.copy(input.expectedRevisions);
    const b=boundaryPlan({original:dto,trustedAnchor:hash(dto),intent,state:codec.dto(state),expectedRevisions},{email:audit.email,time});
    const sale={...original.sale,status:'voided',voidReason:intent.reason,voidedByEmail:audit.email,voidedAt:audit.time,updatedAt:audit.time};
    const lock={...original.lock,status:'voided',voidedAt:audit.time};
    const movements={...original.movements};
    for(let i=0;i<original.sale.items.length;i++){
      const id=original.sale.transactionId+'__void__'+(i+1);
      movements[id]={...b.movements[id],createdAt:audit.time};
    }
    const p={schema:SCHEMA,original,originalAnchor:anchor,intent,intentHash:hash(intent),
      beforeState:state,expectedRevisions,audit:codec.copy(audit),
      originalProofHash:codec.digest(original.lock.serverSaleV1),originalLockHash:codec.digest(original.lock),
      originalMovementHash:codec.digest(original.movements),afterSaleHash:codec.digest(sale),
      returnHashes:Object.fromEntries(Object.entries(movements).filter(([k])=>!Object.hasOwn(original.movements,k)).map(([k,m])=>[k,codec.digest(m)])),result:b.result};
    lock.serverVoidV1=p;
    return {kind:'typed-candidate-only',newCommit:false,sale,lock,movements};
  }
  function verify(records,trust,sessionRef){
    // Read the complete union of transaction-id and ID-prefix query results.
    keys(trust,['originalHash','candidateHash']);
    const r=codec.copy(records),p=r.lock?.serverVoidV1;check(p?.schema===SCHEMA);
    check(codec.digest(r)===trust.candidateHash);
    const expected=build({original:p.original,intent:p.intent,state:p.beforeState,expectedRevisions:p.expectedRevisions},p.audit,trust.originalHash);
    keys(sessionRef,['id','exists']);check(sessionRef.exists===true&&sessionRef.id===expected.sale.sessionId);
    check(codec.digest(r)===codec.digest(expected));return expected;
  }
  function saleReplay(records,anchor,input,sessionRef,{query=false}={}){
    const r=verify(records,anchor,sessionRef),op=normalize(codec.dto(input),query),p=r.lock.serverSaleV1;
    check(op.transactionId===r.sale.transactionId&&(query||hash(op)===p.requestHash));
    return {kind:'typed-candidate-reconciliation-only',newCommit:false,mayCreateSale:false,
      reply:{transactionId:r.sale.transactionId,sessionId:r.sale.sessionId,outcome:'committed',replayed:true,
        requestHash:p.requestHash,result:codec.copy(p.result),currentSaleStatus:'voided'}};
  }
  function voidReplay(records,anchor,input,sessionRef){
    const r=verify(records,anchor,sessionRef);check(hash(normalizeVoid(codec.dto(input)))===r.lock.serverVoidV1.intentHash);
    return {kind:'typed-candidate-reconciliation-only',newCommit:false,result:{...r.lock.serverVoidV1.result,duplicate:true}};
  }
  return Object.freeze({build,verify,saleReplay,voidReplay});
}
