import test from 'node:test';
import assert from 'node:assert/strict';
import {baseline,sessionRef} from './boundary-fixture.mjs';
import {timestampCodec} from './timestamp-codec.mjs';
import {proofCandidateAdapter} from './void-proof-candidate.mjs';
// Explicit test double. No real SDK instances or timestamp provenance claimed.
const known=new WeakSet();
class TestTimestamp {
  constructor(seconds,nanoseconds){this.seconds=seconds;this.nanoseconds=nanoseconds;known.add(this);Object.freeze(this);}
}
const codec=timestampCodec(TestTimestamp,x=>known.has(x));
const api=proofCandidateAdapter(codec,['fixture-business','fixture-personal','fixture-backup']);
function setup(){
  const b=baseline(),old=new TestTimestamp(1791976867,538000000);
  b.original.sale.createdAt=old;b.original.sale.updatedAt=old;b.original.lock.createdAt=old;
  for(const m of Object.values(b.original.movements))m.createdAt=old;
  b.state.stocks['tshirtStock/master'].createdAt=new TestTimestamp(0,123000000);
  const audit={uid:'fixture-business',email:'fixture-business@example.test',email_verified:true,time:new TestTimestamp(1792540800,123000000)};
  const originalHash=codec.digest(b.original),r=api.build(b,audit,originalHash);
  return {b,audit,r,trust:{originalHash,candidateHash:codec.digest(r)}};
}
test('T01 typed timestamp differs from JSON tuple and tag-like object',()=>{
  const t=new TestTimestamp(1,2);
  for(const x of [{seconds:1,nanoseconds:2},['timestamp',1,2],{_seconds:1,_nanoseconds:2}]){
    assert.notEqual(codec.digest(t),codec.digest(x));assert.throws(()=>codec.stamp(x));
  }
  assert.equal(codec.copy(t),t);assert.deepEqual(codec.dto(t),{seconds:1,nanoseconds:2});
});
test('T02 prototype forgery subclass and proxy are rejected',()=>{
  const fake=Object.assign(Object.create(TestTimestamp.prototype),{seconds:1,nanoseconds:2});
  class Sub extends TestTimestamp {}
  for(const x of [fake,new Sub(1,2),new Proxy(new TestTimestamp(1,2),{})])assert.throws(()=>codec.digest(x));
});
test('T03 exact timestamp limits accepted without millisecond truncation',()=>{
  for(const t of [new TestTimestamp(-62135596800,0),new TestTimestamp(253402300799,999999999)])assert.doesNotThrow(()=>codec.stamp(t));
  assert.notEqual(codec.digest(new TestTimestamp(1,1)),codec.digest(new TestTimestamp(1,2)));
});
test('T04 invalid timestamp scalar types ranges and negative zero rejected',()=>{
  for(const [s,n] of [[-62135596801,0],[253402300800,0],[1,-1],[1,1e9],['1',0],[1,0.5],[NaN,0],[1,Infinity],[-0,0],[1,-0]])assert.throws(()=>codec.stamp(new TestTimestamp(s,n)));
});
test('T05 no getter toJSON symbol sparse undefined cycle or exotic object coercion',()=>{
  const getter={get secret(){assert.fail('getter invoked');}},cycle={};cycle.self=cycle;
  for(const x of [getter,{toJSON(){assert.fail('toJSON invoked');}},{[Symbol('x')]:1},Array(2),{x:undefined},cycle,new Date(0),new Map(),{x:NaN},{x:-0},{x:1n}])assert.throws(()=>codec.digest(x));
});
test('T06 canonical object order stable and array order significant',()=>{
  assert.equal(codec.digest({a:1,b:2}),codec.digest({b:2,a:1}));
  assert.notEqual(codec.digest([1,2]),codec.digest([2,1]));
});
test('T07 preserves original snapshots audit object identity and no input mutations',()=>{
  const {b,audit,r}=setup(),before=codec.digest(b);
  api.build(b,audit,codec.digest(b.original));assert.equal(codec.digest(b),before);
  assert.equal(r.sale.createdAt,b.original.sale.createdAt);assert.equal(r.sale.voidedAt,audit.time);
  assert.deepEqual(r.sale.items,b.original.sale.items);assert.deepEqual(r.lock.serverSaleV1,b.original.lock.serverSaleV1);
  assert.equal(r.lock.fingerprint,b.original.lock.fingerprint);
  for(const [id,m] of Object.entries(b.original.movements))assert.deepEqual(r.movements[id],m);
  assert.equal(r.lock.serverVoidV1.beforeState.stocks['tshirtStock/master'].createdAt,b.state.stocks['tshirtStock/master'].createdAt);
});
test('T08 same cancel intent replays without new commit',()=>{
  const {b,r,trust}=setup(),out=api.voidReplay(r,trust,b.intent,sessionRef);
  assert.equal(out.newCommit,false);assert.equal(out.result.duplicate,true);assert.equal(out.result.restoredItemCount,4);
});
test('T09 commit retry and result query return exact original result and voided status',()=>{
  const {b,r,trust}=setup(),p=b.original.lock.serverSaleV1;
  const commit=api.saleReplay(r,trust,p.canonicalRequest,sessionRef);
  assert.equal(commit.newCommit,false);assert.equal(commit.mayCreateSale,false);
  assert.deepEqual(commit.reply,{transactionId:'sale_multi',sessionId:'s',outcome:'committed',replayed:true,requestHash:p.requestHash,result:p.result,currentSaleStatus:'voided'});
  assert.deepEqual(api.saleReplay(r,trust,{version:1,transactionId:'sale_multi'},sessionRef,{query:true}),commit);
});
test('T10 different cancellation and sale intents rejected',()=>{
  const {b,r,trust}=setup();
  assert.throws(()=>api.voidReplay(r,trust,{...b.intent,expectedSaleRequestHash:'f'.repeat(64)},sessionRef));
  const op=codec.copy(b.original.lock.serverSaleV1.canonicalRequest);op.items[0].quantity++;
  assert.throws(()=>api.saleReplay(r,trust,op,sessionRef));
  assert.throws(()=>api.saleReplay(r,trust,{version:1,transactionId:'other'},sessionRef,{query:true}));
});
test('T11 missing or different session rejected; replay does not inspect live stock or open state',()=>{
  const {r,trust}=setup();
  for(const ref of [{id:'s',exists:false},{id:'other',exists:true}])assert.throws(()=>api.verify(r,trust,ref));
  assert.doesNotThrow(()=>api.verify(r,trust,sessionRef));
});
test('T12 closed first cancellation rejected',()=>{
  const {b,audit,trust}=setup();b.state.session.status='closed';
  assert.throws(()=>api.build(b,audit,trust.originalHash),{code:'session-closed'});
});
test('T13 original audit changes rejected even though sale core hash excludes them',()=>{
  for(const change of [b=>b.original.sale.createdAt=new TestTimestamp(1,0),b=>b.original.sale.updatedAt=new TestTimestamp(1,0),b=>b.original.lock.createdAt=new TestTimestamp(1,0),b=>b.original.movements.sale_multi__1.createdAt=new TestTimestamp(1,0)]){
    const {b,audit,trust}=setup();change(b);assert.throws(()=>api.build(b,audit,trust.originalHash));
  }
});
test('T14 original raw JSON timestamp is not promoted to trusted instance',()=>{
  const {b,audit}=setup();b.original.sale.createdAt={seconds:1,nanoseconds:0};
  assert.throws(()=>api.build(b,audit,codec.digest(b.original)));
});
test('T15 unauthorized actor unverified email and audit JSON rejected',()=>{
  const {b,audit,trust}=setup();
  for(const patch of [{uid:'outsider'},{email_verified:false},{email:''},{time:{seconds:1,nanoseconds:0}}])assert.throws(()=>api.build(b,{...audit,...patch},trust.originalHash));
  b.original.lock.serverSaleV1.actorUid='outsider';assert.throws(()=>api.build(b,audit,codec.digest(b.original)));
});
test('T16 original and return movement missing extra or replaced rejected',()=>{
  for(const change of [r=>delete r.movements.sale_multi__1,r=>delete r.movements.sale_multi__void__1,r=>r.movements.orphan={},r=>r.movements.sale_multi__1.quantity++,r=>r.movements.sale_multi__void__2.quantity++]){
    const {r,trust}=setup();change(r);assert.throws(()=>api.verify(r,trust,sessionRef));
  }
});
test('T17 void audit time email result and proof hashes bound',()=>{
  for(const change of [r=>r.sale.voidedAt=new TestTimestamp(1,0),r=>r.sale.voidedByEmail='other',r=>r.lock.serverVoidV1.result.restoredItemCount++,r=>r.lock.serverVoidV1.originalLockHash='f'.repeat(64),r=>r.movements.sale_multi__void__1.createdAt=new TestTimestamp(1,0)]){
    const {r,trust}=setup();change(r);assert.throws(()=>api.verify(r,trust,sessionRef));
  }
});
test('T18 coherent audit rewrite cannot pass independently held candidate digest',()=>{
  const {b,audit,trust}=setup();
  const altered=api.build(b,{...audit,time:new TestTimestamp(1792540801,123000000)},trust.originalHash);
  assert.throws(()=>api.verify(altered,trust,sessionRef));
});
test('T19 old candidate schemas missing proof and unknown status rejected',()=>{
  for(const change of [r=>delete r.lock.serverVoidV1,r=>r.lock.serverVoidV1.schema='offline-void-boundary-v1',r=>r.lock.serverVoidV1.schema='sale-server-v1',r=>r.sale.status='unknown']){
    const {r,trust}=setup();change(r);assert.throws(()=>api.verify(r,trust,sessionRef));
  }
});
test('T20 structural verifier rejects inconsistency even if outer digest recomputed',()=>{
  const {r,trust}=setup();r.lock.serverVoidV1.returnHashes.sale_multi__void__1='f'.repeat(64);
  assert.throws(()=>api.verify(r,{...trust,candidateHash:codec.digest(r)},sessionRef));
});
test('T21 returns stay row specific and keep exact original quantity',()=>{
  const {r}=setup();assert.deepEqual([1,2,3].map(i=>r.movements['sale_multi__void__'+i].quantity),[1,2,1]);
  assert.equal(Object.keys(r.movements).length,6);
});
