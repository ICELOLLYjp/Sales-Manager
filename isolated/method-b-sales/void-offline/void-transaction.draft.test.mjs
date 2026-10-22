import test from 'node:test';
import assert from 'node:assert/strict';
import {baseline,audit,expectedReturns} from './boundary-fixture.mjs';
import {hash} from './validation.mjs';
import {parseVoidHttp,offlineWriteSet,voidSaleDraft,reconcileVoidedSaleDraft} from './void-transaction.draft.mjs';

test('D01 exact fixed route and unchanged intent',()=>{
  const b=baseline();assert.deepEqual(parseVoidHttp('POST','/v1/sales/void',JSON.stringify(b.intent)),b.intent);
});
test('D02 method suffix query and alternate route rejected',()=>{
  for(const [method,url] of [['GET','/v1/sales/void'],['POST','/v1/sales/void/'],['POST','/v1/sales/void?x=1'],['POST','/v1/sales/commit']])
    assert.throws(()=>parseVoidHttp(method,url,'{}'),{code:'not-found'});
});
test('D03 duplicate JSON keys and malformed JSON rejected',()=>{
  for(const raw of ['{"version":1,"version":1}','{'])assert.throws(()=>parseVoidHttp('POST','/v1/sales/void',raw));
});
test('D04 HTTP cannot supply actor anchor state patch or partial quantity',()=>{
  for(const key of ['actor','trustedAnchor','beforeState','patch','quantity'])
    assert.throws(()=>parseVoidHttp('POST','/v1/sales/void',JSON.stringify({...baseline().intent,[key]:1})),{code:'invalid-schema'});
});
test('D05 invalid hash reason version rejected',()=>{
  for(const patch of [{expectedSaleRequestHash:'bad'},{reason:'partial'},{version:2}])
    assert.throws(()=>parseVoidHttp('POST','/v1/sales/void',JSON.stringify({...baseline().intent,...patch})),{code:'invalid-void-intent'});
});
test('D06 body size limit',()=>{
  assert.throws(()=>parseVoidHttp('POST','/v1/sales/void',' '.repeat(32769)),{code:'body-too-large'});
});
test('D07 offline write set is not commit evidence; original data immutable',()=>{
  const b=baseline(),before=hash(b),w=offlineWriteSet(b,audit);
  assert.equal(hash(b),before);assert.equal(w.newCommit,false);assert.equal(w.kind,'offline-write-set-only');
  assert.equal(w.writes.length,8);assert.equal(new Set(w.writes.map(x=>x.path)).size,8);
  assert.equal(w.writes.find(x=>x.path.startsWith('transactionLocks/')).data.serverVoidV1.schema,'offline-void-boundary-v1');
});
test('D08 return writes are create-only per row; original movements never written',()=>{
  const w=offlineWriteSet(baseline(),audit).writes.filter(x=>x.path.startsWith('inventoryMovements/'));
  assert.deepEqual(w.map(x=>x.data),expectedReturns);assert.ok(w.every(x=>x.op==='create'&&x.path.includes('__void__')));
});
test('D09 stock document revision once and targeted fields only',()=>{
  const w=offlineWriteSet(baseline(),audit).writes;
  const t=w.find(x=>x.path==='tshirtStock/master'),a=w.find(x=>x.path==='accessoryStock/shared');
  assert.equal(t.data.inventoryRevision,2);assert.equal(a.data.inventoryRevision,2);
  assert.equal(t.data.inventory_v2.b.d.c.s.qty,5);assert.equal(a.data.designs[0].piercing,5);
  assert.deepEqual(Object.keys(t.data).sort(),['inventoryRevision','inventoryWriteProtocol','inventory_v2','updatedAt'].sort());
});
test('D10 sale update never overwrites snapshots; session retains unrelated fields',()=>{
  const w=offlineWriteSet(baseline(),audit).writes,s=w.find(x=>x.path.startsWith('salesTransactions/'));
  assert.deepEqual(Object.keys(s.data).sort(),['status','voidReason','voidedByEmail','voidedAt','updatedAt'].sort());
  const session=w.find(x=>x.path==='salesSessions/s');assert.equal(session.data.salesSummary.netSales,0);
  assert.equal(session.data['inventoryCount.soldByVariant'].t,0);assert.ok(!Object.hasOwn(session.data,'inventoryCount'));
});
test('D11 closed first cancellation rejected without write-set output',()=>{
  const b=baseline();b.state.session.status='closed';assert.throws(()=>offlineWriteSet(b,audit),{code:'session-closed'});
});
test('D12 transaction draft stops before any DB access',async()=>{
  const db=new Proxy({}, {get(){assert.fail('DB accessed while gate closed');}});
  await assert.rejects(voidSaleDraft(db,{},baseline().intent),{code:'void-timestamp-proof-gate-closed',status:503});
});
test('D13 sale retry and query drafts stop before any DB access',async()=>{
  const b=baseline(),db=new Proxy({}, {get(){assert.fail('DB accessed while gate closed');}});
  await assert.rejects(reconcileVoidedSaleDraft(null,db,null,b.original.lock.serverSaleV1.canonicalRequest),{code:'void-timestamp-proof-gate-closed'});
  await assert.rejects(reconcileVoidedSaleDraft(null,db,null,{version:1,transactionId:'sale_multi'},{query:true}),{code:'void-timestamp-proof-gate-closed'});
});
