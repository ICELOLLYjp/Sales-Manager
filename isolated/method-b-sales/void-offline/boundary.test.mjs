import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from './validation.mjs';
import {core} from './sale-primitives.mjs';
import {planVoid} from './void-pure.mjs';
import {boundaryPlan,verifyObserved,reconcileVoid,reconcileSale} from './void-boundary.mjs';
import {baseline,audit,sessionRef,expectedReturns} from './boundary-fixture.mjs';
const copy=x=>structuredClone(x);
const setup=()=>{const b=baseline();return {b,r:boundaryPlan(b,audit)};};
test('B01 three exact legacy return documents; duplicate SKU keeps row IDs',()=>{
  const {r}=setup();assert.deepEqual(Object.values(r.movements).filter(m=>m.type==='return'),expectedReturns);
  assert.equal(Object.keys(r.movements).length,6);assert.equal(r.stocks['tshirtStock/master'].inventory_v2.b.d.c.s.qty,5);
});
test('B02 sale audit fields lock fingerprint and original proof/movements preserved',()=>{
  const b=baseline(),before=hash(b),r=boundaryPlan(b,audit);assert.equal(hash(b),before);
  assert.equal(r.sale.status,'voided');assert.equal(r.sale.voidReason,'manual_void');assert.equal(r.sale.voidedByEmail,audit.email);
  assert.deepEqual(r.sale.voidedAt,audit.time);assert.deepEqual(r.lock.voidedAt,audit.time);assert.equal(r.lock.status,'voided');
  assert.equal(r.lock.fingerprint,b.original.lock.fingerprint);assert.deepEqual(r.lock.serverSaleV1,b.original.lock.serverSaleV1);
  assert.deepEqual(r.sale.items,b.original.sale.items);
  for(const [id,m]of Object.entries(b.original.movements))assert.deepEqual(r.movements[id],m);
});
test('B03 exact original session deltas removed and unrelated metadata survives',()=>{
  const b=baseline();b.state.session.salesSummary.extra=7;b.state.session.salesSummary.netSales+=400;b.state.session.inventoryCount.soldByVariant.t+=2;
  const r=boundaryPlan(b,audit);assert.equal(r.session.salesSummary.netSales,400);assert.equal(r.session.salesSummary.extra,7);
  assert.equal(r.session.inventoryCount.soldByVariant.t,2);assert.deepEqual(r.session.lastVoidAt,audit.time);
  assert.deepEqual(r.session.lastTransactionAt,b.state.session.lastTransactionAt);
  assert.deepEqual(r.stocks['tshirtStock/master'].inventory_v2.b.d.c.m,b.state.stocks['tshirtStock/master'].inventory_v2.b.d.c.m);
});
test('B04 observed void replay and delayed sale/result preserve exact original reply contract',()=>{
  const {b,r}=setup();assert.equal(reconcileVoid(r,b.trustedAnchor,b.intent,sessionRef).result.duplicate,true);
  const p=b.original.lock.serverSaleV1,decision=reconcileSale(r,b.trustedAnchor,p.canonicalRequest,sessionRef);
  assert.equal(decision.newCommit,false);assert.equal(decision.mayCreateSale,false);
  assert.deepEqual(decision.reply,{transactionId:'sale_multi',sessionId:'s',outcome:'committed',replayed:true,requestHash:p.requestHash,result:p.result,currentSaleStatus:'voided'});
  assert.deepEqual(reconcileSale(r,b.trustedAnchor,{version:1,transactionId:'sale_multi'},sessionRef,{query:true}),decision);
});
test('B05 missing/extra/orphan/changed original or return movement is rejected',()=>{
  const {b,r}=setup();
  for(const change of [x=>delete x.movements.sale_multi__1,x=>delete x.movements.sale_multi__void__1,x=>x.movements.orphan={},x=>x.movements.sale_multi__1.quantity++,x=>x.movements.sale_multi__void__2.quantity++,x=>x.movements.sale_multi__void__3.eventInventoryApplied=true]){
    const bad=copy(r);change(bad);assert.throws(()=>verifyObserved(bad,b.trustedAnchor,sessionRef));
  }
});
test('B06 candidate alone and status-only legacy void cannot masquerade as observed proof',()=>{
  const {b,r}=setup();assert.throws(()=>verifyObserved(planVoid(b),b.trustedAnchor,sessionRef));
  delete r.lock.serverVoidV1;assert.throws(()=>verifyObserved(r,b.trustedAnchor,sessionRef));
});
test('B07 before after audit and original anchor binding rejects tampering',()=>{
  const {b,r}=setup();
  for(const change of [x=>x.sale.voidedByEmail='changed',x=>x.lock.serverVoidV1.beforeSaleHash='f'.repeat(64),x=>x.lock.serverVoidV1.afterSaleHash='f'.repeat(64),x=>x.lock.serverSaleV1.result.netSales=1,x=>x.lock.serverVoidV1.returnHashes.sale_multi__void__1='f'.repeat(64)]){
    const bad=copy(r);change(bad);assert.throws(()=>verifyObserved(bad,b.trustedAnchor,sessionRef));
  }
});
test('B08 replay requires correct existing session but no open status/current stock check',()=>{
  const {b,r}=setup();assert.doesNotThrow(()=>verifyObserved(r,b.trustedAnchor,sessionRef));
  for(const ref of [{id:'s',exists:false},{id:'other',exists:true}])assert.throws(()=>verifyObserved(r,b.trustedAnchor,ref));
});
test('B09 conflicting cancel/sale intent and arbitrary query payload rejected',()=>{
  const {b,r}=setup();
  assert.throws(()=>reconcileVoid(r,b.trustedAnchor,{...b.intent,expectedSaleRequestHash:'f'.repeat(64)},sessionRef));
  const op=copy(b.original.lock.serverSaleV1.canonicalRequest);op.items[0].lineId='other';
  assert.throws(()=>reconcileSale(r,b.trustedAnchor,op,sessionRef));
  assert.throws(()=>reconcileSale(r,b.trustedAnchor,{version:1,transactionId:'other'},sessionRef,{query:true}));
  assert.throws(()=>reconcileSale(r,b.trustedAnchor,{version:1,transactionId:'sale_multi',actor:'fake'},sessionRef,{query:true}));
});
test('B10 self-rehashed extra summary effect cannot erase unrelated summary',()=>{
  const b=baseline(),p=b.original.lock.serverSaleV1;p.effects.session.extra=5;p.effectsHash=hash(p.effects);b.state.session.salesSummary.extra=5;b.trustedAnchor=hash(b.original);
  assert.throws(()=>planVoid(b));
});
test('B11 self-rehashed result inconsistent with original sale rejected',()=>{
  const b=baseline(),p=b.original.lock.serverSaleV1;p.result.transactionId='other';p.resultHash=hash(p.result);b.trustedAnchor=hash(b.original);
  assert.throws(()=>planVoid(b));
});
test('B12 completed sale carrying void audit fields rejected even after rehash',()=>{
  const b=baseline();b.original.sale.voidedAt=audit.time;b.original.lock.serverSaleV1.saleHash=hash(core(b.original.sale));b.trustedAnchor=hash(b.original);
  assert.throws(()=>planVoid(b));
});
test('B13 duplicate SKU effects must form continuous quantities and shared revision',()=>{
  const b=baseline(),p=b.original.lock.serverSaleV1;p.effects.stock[1].beforeQuantity+=2;p.effects.stock[1].quantity+=2;p.effectsHash=hash(p.effects);b.trustedAnchor=hash(b.original);
  assert.throws(()=>planVoid(b));
});
test('B14 raw Timestamp/non-JSON values blocked at offline boundary',()=>{
  const b=baseline();b.state.session.updatedAt=new Date(0);assert.throws(()=>boundaryPlan(b,audit));
  assert.throws(()=>boundaryPlan(baseline(),{...audit,time:{seconds:1,nanoseconds:1000000000}}));
});
