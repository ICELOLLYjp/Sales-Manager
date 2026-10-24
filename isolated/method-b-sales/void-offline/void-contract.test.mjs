import test from 'node:test';
import assert from 'node:assert/strict';
import {baseline,sessionRef} from './boundary-fixture.mjs';
import {timestampCodec} from './timestamp-codec.mjs';
import {proofCandidateAdapter} from './void-proof-candidate.mjs';
import {voidContract,requireDurableAnchor} from './void-contract.mjs';
const known=new WeakSet();
class Stamp{constructor(seconds,nanoseconds=0){this.seconds=seconds;this.nanoseconds=nanoseconds;known.add(this);Object.freeze(this);}}
class Sentinel{}
const sentinel=Object.freeze(new Sentinel()),codec=timestampCodec(Stamp,x=>known.has(x));
const actor={uid:'fixture-business',email:'fixture-business@example.test',email_verified:true};
const api=voidContract(codec,[actor.uid],x=>x===sentinel);
function setup(){
  const b=baseline();delete b.trustedAnchor;
  const old=new Stamp(100);
  b.original.sale.createdAt=old;b.original.sale.updatedAt=old;b.original.lock.createdAt=old;
  for(const m of Object.values(b.original.movements))m.createdAt=old;
  const plan=api.prepare(b,actor,sessionRef);
  return {b,plan};
}
function resolved(plan){
  const out=api.materializeForInspection(plan,sentinel),t=new Stamp(200);
  for(const w of out.writes)for(const k of Object.keys(w.data))if(w.data[k]===sentinel)w.data[k]=t;
  return out;
}
function candidate(){
  const {b}=setup(),a=proofCandidateAdapter(codec,[actor.uid]),h=codec.digest(b.original);
  const r=a.build(b,{...actor,time:new Stamp(200)},h);
  return {b,a,r,trust:{originalHash:h,candidateHash:codec.digest(r)}};
}
test('C01 valid ancestor is only structural consistency, never durable trust',()=>{
  const {b}=setup();assert.equal(api.inspectOriginal(b.original).durableAnchor,false);
  assert.throws(()=>api.acceptPersisted(b.original),{code:'independent-anchor-unproven'});
});
test('C02 durable gate cannot be enabled by claims or self digests',()=>{
  for(const claim of [undefined,true,{trusted:true,durable:true},()=>true])assert.throws(()=>requireDurableAnchor(claim),{code:'independent-anchor-unproven'});
});
test('C03 fully coherent audit rewrite passes structure but cannot acquire trust',()=>{
  const {b,a,trust}=candidate(),r=a.build(b,{...actor,time:new Stamp(201)},trust.originalHash);
  const replaced={...trust,candidateHash:codec.digest(r)};
  assert.doesNotThrow(()=>a.verify(r,replaced,sessionRef));
  assert.throws(()=>api.acceptPersisted(r,replaced),{code:'independent-anchor-unproven'});
  assert.throws(()=>api.inspectCommitReplay(r,trust,b.original.lock.serverSaleV1.canonicalRequest,sessionRef));
});
test('C04 sentinel is write-only and all resolved times must agree',()=>{
  const {plan}=setup(),out=resolved(plan);
  assert.equal(api.inspectResolved(plan,out).commitAcknowledged,false);
  assert.throws(()=>api.inspectResolved(plan,api.materializeForInspection(plan,sentinel)));
  out.writes[0].data.updatedAt=new Stamp(201);assert.throws(()=>api.inspectResolved(plan,out));
});
test('C05 timestamp resolution preserves semantic hash without postcommit patch',()=>{
  const {plan}=setup(),out=resolved(plan),one=api.inspectResolved(plan,out);
  for(const w of out.writes)for(const k of Object.keys(w.data))if(w.data[k] instanceof Stamp)w.data[k]=new Stamp(300,7);
  assert.equal(api.inspectResolved(plan,out).semanticHash,one.semanticHash);
  assert.equal(one.durableAnchor,false);
});
test('C06 sentinel clones unknown types and unresolved values fail closed',()=>{
  const {plan}=setup();
  for(const x of [{},new Sentinel(),new Stamp(200),null])assert.throws(()=>api.materializeForInspection(plan,x));
  for(const x of [{seconds:200,nanoseconds:0},NaN,new Date(),sentinel,Object.create(Stamp.prototype)]){
    const out=resolved(plan);out.writes[0].data.updatedAt=x;assert.throws(()=>api.inspectResolved(plan,out));
  }
});
test('C07 exact paths operations values and timestamp slots bound',()=>{
  const {plan}=setup();
  for(const change of [o=>o.writes.pop(),o=>o.writes.reverse(),o=>o.writes[0].op='create',o=>o.writes[0].path='other',o=>o.writes[0].data.inventoryRevision++,o=>delete o.writes[0].data.updatedAt,o=>o.writes[0].data.extra=1]){
    const out=resolved(plan);change(out);assert.throws(()=>api.inspectResolved(plan,out));
  }
});
test('C08 no candidate proof is emitted as server receipt',()=>{
  const {plan}=setup(),out=resolved(plan);
  assert.equal(out.newCommit,false);
  assert.equal(out.writes.some(w=>Object.hasOwn(w.data,'serverVoidV1')),false);
  assert.throws(()=>api.materializeForInspection({...plan},sentinel));
});
test('C09 request audit or identity fields rejected',()=>{
  for(const key of ['actor','audit','uid','trustedAnchor']){
    const {b}=setup();b[key]=actor;assert.throws(()=>api.prepare(b,actor,sessionRef));
  }
  for(const key of ['actor','audit','uid']){
    const {b}=setup();b.intent[key]='fake';assert.throws(()=>api.prepare(b,actor,sessionRef));
  }
});
test('C10 actor boundary rejects outsider unverified extra fields and getters',()=>{
  const {b}=setup();
  for(const a of [{...actor,uid:'outsider'},{...actor,email_verified:false},{...actor,email:''},{...actor,time:new Stamp(1)},{get uid(){assert.fail('getter executed');}}])assert.throws(()=>api.prepare(b,a,sessionRef));
});
test('C11 original proof and movement omissions reject',()=>{
  for(const change of [b=>delete b.original.lock.serverSaleV1,b=>delete b.original.movements.sale_multi__1,b=>b.original.movements.extra={},b=>b.original.lock.serverSaleV1.saleHash='f'.repeat(64),b=>b.original.lock.serverSaleV1.actorUid='outsider']){
    const {b}=setup();change(b);assert.throws(()=>api.prepare(b,actor,sessionRef));
  }
});
test('C12 original snapshot is captured and later source mutation cannot change plan',()=>{
  const {b,plan}=setup(),before=codec.digest(resolved(plan));b.original.sale.items[0].quantity++;
  assert.equal(codec.digest(resolved(plan)),before);assert.throws(()=>api.prepare(b,actor,sessionRef));
});
test('C13 session identity existence status and stock revision enforced',()=>{
  const {b}=setup();
  for(const ref of [{id:'other',exists:true},{id:'s',exists:false}])assert.throws(()=>api.prepare(b,actor,ref));
  b.state.session.status='closed';assert.throws(()=>api.prepare(b,actor,sessionRef));
  const next=setup().b;next.expectedRevisions['tshirtStock/master']++;assert.throws(()=>api.prepare(next,actor,sessionRef));
});
test('C14 commit and result use one verifier preserve reply and forbid new sale',()=>{
  const {b,r,trust}=candidate(),before=codec.digest(r),op=b.original.lock.serverSaleV1.canonicalRequest;
  const commit=api.inspectCommitReplay(r,trust,op,sessionRef);
  assert.deepEqual(api.inspectResultReplay(r,trust,{version:1,transactionId:op.transactionId},sessionRef),commit);
  assert.equal(commit.newCommit,false);assert.equal(commit.mayCreateSale,false);
  assert.deepEqual(commit.reply.result,b.original.lock.serverSaleV1.result);assert.equal(codec.digest(r),before);
});
test('C15 different sale intent or query identity cannot fall through',()=>{
  const {b,r,trust}=candidate(),op=codec.copy(b.original.lock.serverSaleV1.canonicalRequest);op.items[0].quantity++;
  assert.throws(()=>api.inspectCommitReplay(r,trust,op,sessionRef));
  assert.throws(()=>api.inspectResultReplay(r,trust,{version:1,transactionId:'other'},sessionRef));
});
test('C16 ancestor or return corruption rejected by both replay paths',()=>{
  for(const change of [r=>delete r.movements.sale_multi__void__1,r=>r.lock.serverVoidV1.original.sale.createdAt=new Stamp(99),r=>r.lock.serverVoidV1.originalProofHash='f'.repeat(64)]){
    const {b,r,trust}=candidate();change(r);trust.candidateHash=codec.digest(r);
    assert.throws(()=>api.inspectCommitReplay(r,trust,b.original.lock.serverSaleV1.canonicalRequest,sessionRef));
    assert.throws(()=>api.inspectResultReplay(r,trust,{version:1,transactionId:'sale_multi'},sessionRef));
  }
});
