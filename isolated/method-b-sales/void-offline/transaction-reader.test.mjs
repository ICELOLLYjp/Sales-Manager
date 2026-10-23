import test from 'node:test';
import assert from 'node:assert/strict';
import {baseline} from './boundary-fixture.mjs';
import {timestampCodec} from './timestamp-codec.mjs';
import {transactionReader} from './transaction-reader.mjs';
const stamps=new WeakSet();
class Stamp{constructor(seconds,nanoseconds=0){this.seconds=seconds;this.nanoseconds=nanoseconds;stamps.add(this);Object.freeze(this);}}
class Sentinel{}
const sentinel=Object.freeze(new Sentinel()),codec=timestampCodec(Stamp,x=>stamps.has(x));
const actor={uid:'fixture-business',email:'fixture-business@example.test',email_verified:true};
function setup(options={}){
  const b=baseline(),t=new Stamp(100),log=[],attempts=[];
  b.original.sale.createdAt=t;b.original.sale.updatedAt=t;b.original.lock.createdAt=t;
  for(const m of Object.values(b.original.movements))m.createdAt=t;
  const docs={'salesTransactions/sale_multi':b.original.sale,'transactionLocks/sale_multi':b.original.lock,'salesSessions/s':b.state.session,...b.state.stocks,
    ...Object.fromEntries(Object.entries(b.original.movements).map(([k,v])=>['inventoryMovements/'+k,v]))};
  const snap=path=>({id:path.split('/')[1],ref:{path},exists:Object.hasOwn(docs,path),data:()=>docs[path]});
  function query(){return {where(field,_eq,value){return {...query(),filter:{field,value}};},orderBy(field){assert.equal(field,'__name__');return query();},
    startAt(start){return {...query(),start,endAt(end){return {...query(),start,end};}};}};}
  let authCalls=0,commits=0;
  function resolve(x){if(x===sentinel)return new Stamp(200);if(x instanceof Stamp)return x;if(Array.isArray(x))return x.map(resolve);
    if(x&&typeof x==='object')return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,resolve(v)]));return x;}
  const db={doc:path=>({path}),collection:name=>{assert.equal(name,'inventoryMovements');return query();},runTransaction:async(fn,opts)=>{
    assert.deepEqual(opts,opts.readOnly?{readOnly:true}:{maxAttempts:3});let result;
    for(let n=0;n<(options.retry?2:1);n++){
      const staged=[];attempts.push(staged);let writing=false;
      const read=()=>{assert.equal(writing,false,'READ AFTER WRITE');log.push('read');};
      const tx={getAll:async(...refs)=>{read();return refs.map(r=>snap(r.path));},get:async ref=>{
        read();if(ref.path)return snap(ref.path);
        const rows=Object.entries(docs).filter(([p,v])=>p.startsWith('inventoryMovements/')&&(ref.filter?v[ref.filter.field]===ref.filter.value:p.split('/')[1]>=ref.start&&p.split('/')[1]<=ref.end));
        return {docs:rows.map(([p])=>snap(p))};},
        update:(ref,data)=>{writing=true;log.push('write');staged.push({op:'update',path:ref.path,data});},
        create:(ref,data)=>{writing=true;log.push('write');assert.equal(Object.hasOwn(docs,ref.path),false);staged.push({op:'create',path:ref.path,data});}};
      result=await fn(tx);
      if(options.retry&&n===0){options.onRetry?.(docs);continue;}
      for(const w of staged){const value=resolve(w.data);if(w.op==='create')docs[w.path]=value;
        else for(const [k,v] of Object.entries(value)){const parts=k.split('.');let dst=docs[w.path];for(const p of parts.slice(0,-1))dst=dst[p]??={};dst[parts.at(-1)]=v;}}
      commits++;
    }
    if(options.ackFailure)throw Error('unknown-ack');return result;
  }};
  const deps={db,codec,allowedUids:[actor.uid],documentId:()=> '__name__',serverTimestamp:()=>sentinel,isServerSentinel:x=>x===sentinel,
    assertBoundary:()=>options.boundary??true,auth:{verifyIdToken:async(token,revoke)=>{
      authCalls++;assert.equal(revoke,true);assert.equal(token,'verified-token');
      if(options.revokeAt&&authCalls>=options.revokeAt)throw Error('token-revoked');return options.actor??actor;
    }}};
  return {api:transactionReader(deps),deps,docs,b,log,attempts,get authCalls(){return authCalls;},get commits(){return commits;}};
}
const queryInput={version:1,transactionId:'sale_multi'};
test('R01 transaction-only reads precede all writes; original data and metadata preserved',async()=>{
  const f=setup(),old=codec.copy(f.b.original);f.docs['tshirtStock/master'].inventory_v2.b.d.c.s.audit=new Stamp(42);
  f.docs['salesSessions/s'].extra='keep';const result=await f.api.void('verified-token',f.b.intent);
  assert.equal(result.restoredItemCount,4);assert.equal(f.attempts[0].length,8);assert.equal(f.authCalls,2);
  assert.ok(f.log.lastIndexOf('read')<f.log.indexOf('write'));
  assert.deepEqual(f.docs['salesTransactions/sale_multi'].items,old.sale.items);
  assert.deepEqual(f.docs['transactionLocks/sale_multi'].serverSaleV1,old.lock.serverSaleV1);
  for(const [id,m] of Object.entries(old.movements))assert.deepEqual(f.docs['inventoryMovements/'+id],m);
  assert.equal(f.docs['tshirtStock/master'].inventory_v2.b.d.c.s.audit.seconds,42);
  assert.equal(f.docs['salesSessions/s'].extra,'keep');
  assert.equal(f.docs['tshirtStock/master'].inventory_v2.b.d.c.s.qty,5);
  assert.equal(f.docs['tshirtStock/master'].inventoryRevision,2);
});
test('R02 duplicate void and stale sale replay share stored result and stage zero writes',async()=>{
  const f=setup(),op=f.b.original.lock.serverSaleV1.canonicalRequest;await f.api.void('verified-token',f.b.intent);
  f.docs['salesSessions/s'].status='closed';const saved=codec.digest(f.docs);
  assert.equal((await f.api.void('verified-token',f.b.intent)).duplicate,true);
  const commit=await f.api.commitReplay('verified-token',op),result=await f.api.resultReplay('verified-token',queryInput);
  assert.deepEqual(commit,result);assert.deepEqual(commit.result,f.b.original.lock.serverSaleV1.result);
  assert.equal(result.currentSaleStatus,'voided');assert.equal(codec.digest(f.docs),saved);
  assert.ok(f.attempts.slice(1).every(x=>x.length===0));
});
test('R03 unknown writer boundary fails before any database access',async()=>{
  const f=setup();for(const assertBoundary of [undefined,()=>false,()=> 'UNKNOWN']){
    const api=transactionReader({...f.deps,assertBoundary,db:new Proxy({},{get(){assert.fail('database touched');}})});
    await assert.rejects(api.void('verified-token',f.b.intent),{code:'protected-writer-boundary-unproven'});
  }
});
test('R04 actor spoof in body and unverified/outsider principals fail before reads',async()=>{
  for(const a of [{...actor,uid:'outsider'},{...actor,email_verified:false}]){const f=setup({actor:a});await assert.rejects(f.api.void('verified-token',f.b.intent));assert.equal(f.log.length,0);}
  const f=setup();await assert.rejects(f.api.void('verified-token',{...f.b.intent,actor}));assert.equal(f.log.length,0);
});
test('R05 revocation checked before transaction and again before attempt reads',async()=>{
  for(const revokeAt of [1,2]){const f=setup({revokeAt});await assert.rejects(f.api.void('verified-token',f.b.intent),/token-revoked/);assert.equal(f.log.length,0);}
});
test('R06 plain and prototype-spoof Timestamp rejected with zero staged writes',async()=>{
  for(const timestamp of [{seconds:100,nanoseconds:0},Object.assign(Object.create(Stamp.prototype),{seconds:100,nanoseconds:0})]){
    const f=setup();f.docs['salesTransactions/sale_multi'].createdAt=timestamp;
    await assert.rejects(f.api.void('verified-token',f.b.intent));assert.equal(f.attempts[0].length,0);
  }
});
test('R07 missing original movement and partial sale/lock evidence reject before writes',async()=>{
  for(const path of ['inventoryMovements/sale_multi__1','transactionLocks/sale_multi','salesTransactions/sale_multi']){
    const f=setup();delete f.docs[path];await assert.rejects(f.api.void('verified-token',f.b.intent));assert.equal(f.attempts[0].length,0);
  }
});
test('R08 missing or extra returns reject both replay branches',async()=>{
  for(const change of [d=>delete d['inventoryMovements/sale_multi__void__1'],d=>d['inventoryMovements/sale_multi__extra']={transactionId:'other'},
    d=>d['inventoryMovements/unrelated_id']={transactionId:'other',reversalOfTransactionId:'sale_multi'}]){
    const f=setup();await f.api.void('verified-token',f.b.intent);change(f.docs);
    await assert.rejects(f.api.commitReplay('verified-token',f.b.original.lock.serverSaleV1.canonicalRequest));
    await assert.rejects(f.api.resultReplay('verified-token',queryInput));assert.ok(f.attempts.slice(1).every(x=>x.length===0));
  }
});
test('R09 stale stock revision and invalid metadata are rejected before encoding writes',async()=>{
  for(const change of [d=>d['tshirtStock/master'].inventoryRevision=0,d=>d['tshirtStock/master'].inventoryRevision=Number.MAX_SAFE_INTEGER,
    d=>d['tshirtStock/master'].inventory_v2.b.d.c.s.metadata=undefined]){
    const f=setup();change(f.docs);await assert.rejects(f.api.void('verified-token',f.b.intent));assert.equal(f.attempts[0].length,0);
  }
});
test('R10 retry rereads updated revision and quantity without overwriting concurrent changes',async()=>{
  const f=setup({retry:true,onRetry:d=>{d['tshirtStock/master'].inventoryRevision=2;d['tshirtStock/master'].inventory_v2.b.d.c.s.qty=9;}});
  await f.api.void('verified-token',f.b.intent);assert.equal(f.attempts.length,2);assert.equal(f.authCalls,3);
  assert.equal(f.docs['tshirtStock/master'].inventoryRevision,3);assert.equal(f.docs['tshirtStock/master'].inventory_v2.b.d.c.s.qty,12);
});
test('R11 revoked token on retry prevents second attempt reads or writes',async()=>{
  const f=setup({retry:true,revokeAt:3});await assert.rejects(f.api.void('verified-token',f.b.intent),/token-revoked/);
  assert.equal(f.attempts[1].length,0);assert.equal(f.commits,0);
});
test('R12 response waits for injected ack; unknown ack never returns success',async()=>{
  const f=setup({ackFailure:true});await assert.rejects(f.api.void('verified-token',f.b.intent),/unknown-ack/);assert.equal(f.commits,1);
});
test('R13 absent records create no reservation; sale replay branch cannot create new sales',async()=>{
  const f=setup();for(const key of Object.keys(f.docs))if(!key.startsWith('salesSessions/')&&!key.includes('Stock/'))delete f.docs[key];
  assert.equal((await f.api.void('verified-token',f.b.intent)).outcome,'not-found');assert.equal(f.attempts[0].length,0);
  await assert.rejects(f.api.resultReplay('verified-token',queryInput));assert.equal(f.attempts[1].length,0);
});
test('R14 different sale/void intentions and closed initial session fail safely',async()=>{
  const f=setup();f.docs['salesSessions/s'].status='closed';await assert.rejects(f.api.void('verified-token',f.b.intent));
  f.docs['salesSessions/s'].status='open';await f.api.void('verified-token',f.b.intent);
  await assert.rejects(f.api.void('verified-token',{...f.b.intent,expectedSaleRequestHash:'f'.repeat(64)}));
  const op=codec.copy(f.b.original.lock.serverSaleV1.canonicalRequest);op.items[0].quantity++;
  await assert.rejects(f.api.commitReplay('verified-token',op));
});
test('R15 sentinel factory spoof fails before any write is staged',async()=>{
  const f=setup(),api=transactionReader({...f.deps,serverTimestamp:()=>new Sentinel()});
  await assert.rejects(api.void('verified-token',f.b.intent));assert.equal(f.attempts[0].length,0);
});
test('R16 matching hashes cannot override a failed protected-source attestation',async()=>{
  const f=setup();await f.api.void('verified-token',f.b.intent);
  const forged=transactionReader({...f.deps,assertBoundary:()=>false});
  await assert.rejects(forged.resultReplay('verified-token',queryInput),{code:'protected-writer-boundary-unproven'});
  assert.equal(f.attempts.length,1);
});
test('R17 reference preparation failure stages no earlier writes',async()=>{
  const f=setup(),doc=f.deps.db.doc;f.deps.db.doc=path=>{if(path==='inventoryMovements/sale_multi__void__3')throw Error('encode-reference-failure');return doc(path);};
  await assert.rejects(f.api.void('verified-token',f.b.intent),/encode-reference-failure/);assert.equal(f.attempts[0].length,0);
});
test('R18 read source path mismatch fails before trusting records',async()=>{
  const f=setup(),doc=f.deps.db.doc;f.deps.db.doc=path=>doc(path==='salesTransactions/sale_multi'?'transactionLocks/sale_multi':path);
  await assert.rejects(f.api.void('verified-token',f.b.intent));assert.equal(f.attempts[0].length,0);
});
test('R19 lost boundary attestation on retry stops before more reads',async()=>{
  const f=setup({retry:true});let calls=0;const api=transactionReader({...f.deps,assertBoundary:()=>++calls<3});
  await assert.rejects(api.void('verified-token',f.b.intent),{code:'protected-writer-boundary-unproven'});
  assert.equal(f.attempts[1].length,0);assert.equal(f.commits,0);
});
test('R20 missing session rejects initial void and both saved replay branches',async()=>{
  const f=setup(),session=f.docs['salesSessions/s'];delete f.docs['salesSessions/s'];
  await assert.rejects(f.api.void('verified-token',f.b.intent));assert.equal(f.attempts[0].length,0);
  f.docs['salesSessions/s']=session;await f.api.void('verified-token',f.b.intent);delete f.docs['salesSessions/s'];
  await assert.rejects(f.api.commitReplay('verified-token',f.b.original.lock.serverSaleV1.canonicalRequest));
  await assert.rejects(f.api.resultReplay('verified-token',queryInput));assert.ok(f.attempts.slice(2).every(x=>x.length===0));
});
