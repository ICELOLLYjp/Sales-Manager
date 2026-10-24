import test from 'node:test';
import assert from 'node:assert/strict';
import {baseline,sessionRef} from './boundary-fixture.mjs';
import {timestampCodec} from './timestamp-codec.mjs';
import {protectedVoid,protectedVoidApi} from './protected-void.mjs';
const stamps=new WeakSet(),reads=new WeakSet();
class Stamp{constructor(seconds,nanoseconds=0){this.seconds=seconds;this.nanoseconds=nanoseconds;stamps.add(this);Object.freeze(this);}}
class Sentinel{}
const sentinel=Object.freeze(new Sentinel()),codec=timestampCodec(Stamp,x=>stamps.has(x));
const actor={uid:'fixture-business',email:'fixture-business@example.test',email_verified:true};
const deps={codec,allowedUids:[actor.uid],isServerSentinel:x=>x===sentinel,authorizeRead:x=>reads.has(x)};
const api=protectedVoid(deps),trusted=x=>{reads.add(x);return x;};
function setup(){const b=baseline();delete b.trustedAnchor;const t=new Stamp(100);
  b.original.sale.createdAt=t;b.original.sale.updatedAt=t;b.original.lock.createdAt=t;
  for(const m of Object.values(b.original.movements))m.createdAt=t;
  b.sessionRef={...sessionRef};return trusted(b);
}
function resolve(x,time){if(x===sentinel)return time;if(x instanceof Stamp)return x;if(Array.isArray(x))return x.map(y=>resolve(y,time));if(x&&typeof x==='object')return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,resolve(v,time)]));return x;}
function committed(b=setup()){const out=resolve(api.writes(api.prepare(b,actor),sentinel),new Stamp(200));return {out,r:trusted({sale:out.sale,lock:out.lock,movements:out.movements,sessionRef:{...sessionRef}}),b};}
test('W01 serializable serverVoidV1 round trip survives a new verifier instance',()=>{
  const {r,b}=committed();const fresh=protectedVoid(deps);assert.equal(fresh.verify(r).lock.serverVoidV1.schema,'void-server-v1');
  assert.equal(fresh.voidReplay(r,b.intent).duplicate,true);assert.equal(r.lock.serverVoidV1.createdAt.seconds,200);
  assert.equal(Object.hasOwn(r.lock.serverVoidV1.beforeState.stocks['tshirtStock/master'],'createdAt'),false);
});
test('W02 one write set contains exact targets, row returns, grouped quantities and revision once',()=>{
  const {out}=committed();assert.equal(out.writes.length,8);
  assert.deepEqual(out.writes.filter(x=>x.op==='create').map(x=>x.path),[1,2,3].map(n=>'inventoryMovements/sale_multi__void__'+n));
  const tshirt=out.writes.find(x=>x.path==='tshirtStock/master').data;
  assert.equal(tshirt.inventoryRevision,2);assert.equal(tshirt.inventory_v2.b.d.c.s.qty,5);
  assert.equal(out.writes.find(x=>x.path==='accessoryStock/shared').data.designs[0].piercing,5);
  const session=out.writes.find(x=>x.path==='salesSessions/s').data;
  assert.equal(session.salesSummary.transactionCount,0);assert.deepEqual(session['inventoryCount.soldByVariant'],{t:0,a:0});
  assert.equal(out.writes.find(x=>x.path==='transactionLocks/sale_multi').data.serverVoidV1.result.restoredItemCount,4);
});
test('W03 metadata Timestamp survives stock write and original cost snapshot survives void',()=>{
  const b=setup(),t=new Stamp(42);b.state.stocks['tshirtStock/master'].inventory_v2.b.d.c.s.audit=t;
  const {out,r}=committed(b);assert.equal(out.writes.find(x=>x.path==='tshirtStock/master').data.inventory_v2.b.d.c.s.audit,t);
  assert.deepEqual(r.sale.items,b.original.sale.items);assert.deepEqual(r.lock.serverSaleV1,b.original.lock.serverSaleV1);
});
test('W04 unproven source denies coherent wholesale rewrites before structural checks',()=>{
  const {r,b}=committed();const forged=codec.copy(r);forged.lock.serverVoidV1.actor.email='forged@example.test';
  assert.throws(()=>api.verify(forged),{code:'protected-writer-boundary-unproven'});
  assert.throws(()=>api.prepare(codec.copy(b),actor),{code:'protected-writer-boundary-unproven'});
  const closed=protectedVoid({...deps,authorizeRead:undefined});assert.throws(()=>closed.verify(r),{code:'protected-writer-boundary-unproven'});
});
test('W05 even self consistent complete replacement has no origin authority',()=>{
  const {r}=committed(),other=committed().r;
  const replacement=codec.copy(other);assert.equal(codec.digest(replacement),codec.digest(r));
  assert.throws(()=>api.verify(replacement),{code:'protected-writer-boundary-unproven'});
});
test('W06 trusted malicious Admin is outside tamper evidence threat model',()=>{
  const b=setup(),otherActor={...actor,email:'other@example.test'};
  const out=resolve(api.writes(api.prepare(b,otherActor),sentinel),new Stamp(300));
  const r=trusted({sale:out.sale,lock:out.lock,movements:out.movements,sessionRef});
  assert.doesNotThrow(()=>api.verify(r)); // Deliberately demonstrates no independent signature guarantee.
});
test('W07 arbitrary sentinel and unresolved read rejected',()=>{
  const b=setup(),p=api.prepare(b,actor);
  for(const t of [{},new Sentinel(),new Stamp(200)])assert.throws(()=>api.writes(p,t));
  const o=api.writes(p,sentinel);assert.throws(()=>api.verify(trusted({sale:o.sale,lock:o.lock,movements:o.movements,sessionRef})));
});
test('W08 resolved Timestamp requires provenance and identical audit slots',()=>{
  for(const value of [{seconds:200,nanoseconds:0},Object.create(Stamp.prototype),new Stamp(201)]){
    const {r}=committed();r.sale.voidedAt=value;assert.throws(()=>api.verify(r));
  }
});
test('W09 commit and result share verifier and preserve original sale reply',()=>{
  const {r,b}=committed(),op=b.original.lock.serverSaleV1.canonicalRequest;
  const result=api.resultReplay(r,{version:1,transactionId:op.transactionId});assert.deepEqual(api.commitReplay(r,op),result);
  assert.deepEqual(result.result,b.original.lock.serverSaleV1.result);assert.equal(result.currentSaleStatus,'voided');
});
test('W10 wrong sale or void intent and wrong query identity rejected',()=>{
  const {r,b}=committed(),op=codec.copy(b.original.lock.serverSaleV1.canonicalRequest);op.items[0].quantity++;
  assert.throws(()=>api.commitReplay(r,op));assert.throws(()=>api.resultReplay(r,{version:1,transactionId:'other'}));
  assert.throws(()=>api.voidReplay(r,{...b.intent,expectedSaleRequestHash:'f'.repeat(64)}));
});
test('W11 partial returns, extra movement and modified original movement reject both replay paths',()=>{
  for(const change of [r=>delete r.movements.sale_multi__void__1,r=>r.movements.extra=r.movements.sale_multi__1,r=>r.movements.sale_multi__1.quantity++]){
    const {r,b}=committed();change(r);assert.throws(()=>api.commitReplay(r,b.original.lock.serverSaleV1.canonicalRequest));assert.throws(()=>api.resultReplay(r,{version:1,transactionId:'sale_multi'}));
  }
});
test('W12 original snapshot, lock fingerprint, proof hash or saved result change fails closed',()=>{
  for(const change of [r=>r.lock.serverVoidV1.original.sale.items[0].unitCostJPY=999,r=>r.lock.fingerprint='fake',r=>r.lock.serverVoidV1.originalHash='f'.repeat(64),r=>r.lock.serverVoidV1.result.restoredItemCount++]){
    const {r}=committed();change(r);assert.throws(()=>api.verify(r));
  }
});
test('W13 initial closed session rejected but replay only needs matching session existence',()=>{
  const b=setup();b.state.session.status='closed';assert.throws(()=>api.prepare(b,actor));
  const {r}=committed();assert.doesNotThrow(()=>api.verify(r));r.sessionRef.exists=false;assert.throws(()=>api.verify(r));
});
test('W14 revision mismatch, unknown stock and summary underflow reject before write set',()=>{
  for(const change of [b=>b.expectedRevisions['tshirtStock/master']++,b=>b.state.stocks['tshirtStock/master'].inventory_v2.b.d.c.s.qty=null,b=>b.state.session.salesSummary.transactionCount=0]){
    const b=setup();change(b);assert.throws(()=>api.prepare(b,actor));
  }
});
test('W15 unauthorized actor, input proof injection and unknown sale state fail closed',()=>{
  const b=setup();for(const a of [{...actor,uid:'outsider'},{...actor,email_verified:false}])assert.throws(()=>api.prepare(b,a));
  b.intent.actor=actor;assert.throws(()=>api.prepare(b,actor));delete b.intent.actor;b.original.sale.status='unknown';assert.throws(()=>api.prepare(b,actor));
});
test('W16 plan captures input and rejects fabricated handle',()=>{
  const b=setup(),p=api.prepare(b,actor);b.original.sale.items[0].quantity=999;
  assert.equal(api.writes(p,sentinel).sale.items[0].quantity,1);assert.throws(()=>api.writes({...p},sentinel));
});
test('W17 public integration gate stops before any database property access',async()=>{
  const db=new Proxy({},{get(){assert.fail('database accessed');}});await assert.rejects(protectedVoidApi(db),{code:'void-integration-gate-closed'});
});
function portFor(b,{fault=false,ackFailure=false,retry=false}={}){
  const committedWrites=[],attempts=[];
  const port={serverTimestamp:()=>sentinel,read:async(tx)=>{assert.equal(tx.staged.length,0);tx.read=true;return b;},
    apply:async(tx,w)=>{assert.equal(tx.read,true);tx.staged.push(w);if(fault&&tx.staged.length===4)throw Error('injected-write-failure');},
    runTransaction:async(cb,options)=>{assert.equal(options.maxAttempts,3);let result;
      for(let n=0;n<(retry?2:1);n++){const tx={staged:[],read:false};attempts.push(tx);result=await cb(tx);}
      committedWrites.push(...attempts.at(-1).staged);if(ackFailure)throw Error('unknown-ack');return result;
    }};
  return {port,committedWrites,attempts};
}
test('W18 injected transaction stages all writes after reads and resolves through commit',async()=>{
  const b=setup(),p=portFor(b);const result=await api.transact(p.port,actor,b.intent);
  assert.equal(result.status,'voided');assert.equal(p.attempts.length,1);assert.equal(p.committedWrites.length,8);
});
test('W19 injected write failure has no published writes; ack failure is never success',async()=>{
  const b=setup(),p=portFor(b,{fault:true});await assert.rejects(api.transact(p.port,actor,b.intent),/injected-write-failure/);assert.equal(p.committedWrites.length,0);
  const unknown=portFor(b,{ackFailure:true});await assert.rejects(api.transact(unknown.port,actor,b.intent),/unknown-ack/);assert.equal(unknown.committedWrites.length,8);
});
test('W20 retry rereads, discards previous staged writes and replay stages none',async()=>{
  const b=setup(),p=portFor(b,{retry:true});await api.transact(p.port,actor,b.intent);
  assert.equal(p.attempts.length,2);assert.equal(p.committedWrites.length,8);
  const {r}=committed(b),replay=portFor(r);assert.equal((await api.transact(replay.port,actor,b.intent)).duplicate,true);assert.equal(replay.committedWrites.length,0);
});
test('W21 confirmed missing records create no reservation and conflicting read intent rejects',async()=>{
  const b=setup(),missing=trusted({absent:true,transactionId:b.intent.transactionId,sale:null,lock:null,movements:{}}),p=portFor(missing);
  assert.equal((await api.transact(p.port,actor,b.intent)).outcome,'not-found');assert.equal(p.committedWrites.length,0);
  const other={...b.intent,expectedSaleRequestHash:'f'.repeat(64)};await assert.rejects(api.transact(portFor(b).port,actor,other));
});
test('W22 persisted values rehydrated by trusted reader need no live plan or held digest',()=>{
  const {r,b}=committed();
  const wire=JSON.stringify(r,(_k,v)=>v instanceof Stamp?{fixtureStamp:[v.seconds,v.nanoseconds]}:v);
  const read=trusted(JSON.parse(wire,(_k,v)=>v&&Object.hasOwn(v,'fixtureStamp')?new Stamp(...v.fixtureStamp):v));
  assert.notEqual(read.lock.serverVoidV1.createdAt,r.lock.serverVoidV1.createdAt);
  assert.deepEqual(protectedVoid(deps).voidReplay(read,b.intent),{...r.lock.serverVoidV1.result,duplicate:true});
});
