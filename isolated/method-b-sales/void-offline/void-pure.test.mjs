import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from './fixture.mjs';
import {hash} from './validation.mjs';
import {planVoid,verifyOriginal,verifyCandidate,replayVoid,lateSaleDecision} from './void-pure.mjs';
const copy=x=>structuredClone(x),tid='sale_multi';
function baseline(){
  const original={sale:copy(fixture[`salesTransactions/${tid}`]),lock:copy(fixture[`transactionLocks/${tid}`]),movements:Object.fromEntries(Object.entries(fixture).filter(([k])=>k.startsWith('inventoryMovements/')).map(([k,v])=>[k.split('/')[1],copy(v)]))};
  return {original,trustedAnchor:hash(original),intent:{version:1,transactionId:tid,expectedSaleRequestHash:original.lock.serverSaleV1.requestHash,reason:'manual_void'},state:{session:copy(fixture['salesSessions/s']),stocks:Object.fromEntries(['tshirtStock/master','accessoryStock/shared'].map(k=>[k,copy(fixture[k])]))},expectedRevisions:{'tshirtStock/master':1,'accessoryStock/shared':1}};
}
const frozen=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(frozen);Object.freeze(x);}return x;};
const rejects=(mutate,code)=>{const b=baseline();mutate(b);assert.throws(()=>planVoid(b),code?{code}:undefined);};
test('U01 persisted P05 sale proof and price/cost snapshots remain compatible',()=>{
  const b=baseline(),c=planVoid(b);assert.equal(verifyOriginal(b.original,b.trustedAnchor).requestHash,b.intent.expectedSaleRequestHash);
  assert.equal(c.kind,'candidate-only');assert.equal(c.newCommit,false);assert.deepEqual(c.projection.saleAfter.items,b.original.sale.items);
  assert.equal(c.projection.saleAfter.transactionId,tid);assert.equal(c.projection.saleAfter.netSales,10000);
});
test('U02 duplicate SKU rows aggregate once; each stock revision increases once',()=>{
  const c=planVoid(baseline());assert.deepEqual(c.projection.restores.map(x=>x.quantity),[3,1]);
  assert.equal(c.projection.stocksAfter['tshirtStock/master'].inventory_v2.b.d.c.s.qty,5);
  assert.equal(c.projection.stocksAfter['accessoryStock/shared'].designs[0].piercing,5);
  for(const s of Object.values(c.projection.stocksAfter))assert.equal(s.inventoryRevision,2);
});
test('U03 original sale lock movement proof and all inputs are nonmutable',()=>{
  const b=baseline(),before=hash(b);frozen(b);const c=planVoid(b);assert.equal(hash(b),before);
  assert.deepEqual(c.projection.lockAfter.serverSaleV1,b.original.lock.serverSaleV1);
  c.projection.saleAfter.items[0].unitPrice=9;assert.equal(b.original.sale.items[0].unitPrice,3000);
});
test('U04 non-target cells and metadata survive',()=>{
  const b=baseline(),c=planVoid(b),s=c.projection.stocksAfter;
  assert.deepEqual(s['tshirtStock/master'].inventory_v2.b.d.c.m,{qty:8});assert.equal(s['tshirtStock/master'].inventory_v2.b.d.c.s.note,'retain');
  assert.deepEqual(s['tshirtStock/master'].createdAt,b.state.stocks['tshirtStock/master'].createdAt);
  assert.equal(s['accessoryStock/shared'].designs[0].earring,null);assert.deepEqual(s['accessoryStock/shared'].designs[1],b.state.stocks['accessoryStock/shared'].designs[1]);
});
test('U05 tampered sale or movement hash is rejected',()=>{
  rejects(b=>b.original.sale.items[0].unitPrice=1,'reconciliation-required');
  rejects(b=>b.original.movements[`${tid}__1`].quantity=9,'reconciliation-required');
  rejects(b=>{b.original.lock.serverSaleV1.saleHash='a'.repeat(64);b.trustedAnchor=hash(b.original);},'reconciliation-required');
});
test('U06 absent extra and orphan movements fail closed',()=>{
  rejects(b=>delete b.original.movements[`${tid}__1`]);rejects(b=>b.original.movements.extra={});
  rejects(b=>{b.original.movements.extra={};b.trustedAnchor=hash(b.original);});
});
test('U07 unknown SKU null quantity and duplicate accessory IDs fail closed',()=>{
  rejects(b=>delete b.state.stocks['tshirtStock/master'].inventory_v2.b.d.c.s,'unknown-quantity');
  rejects(b=>b.state.stocks['accessoryStock/shared'].designs[0].piercing=null,'invalid-stored-number');
  rejects(b=>b.state.stocks['accessoryStock/shared'].designs.push({id:'a',piercing:0}),'invalid-designs');
});
test('U08 stale baseline and revision overflow are rejected',()=>{
  rejects(b=>b.expectedRevisions['tshirtStock/master']=0,'revision-conflict');
  rejects(b=>{b.state.stocks['tshirtStock/master'].inventoryRevision=Number.MAX_SAFE_INTEGER;b.expectedRevisions['tshirtStock/master']=Number.MAX_SAFE_INTEGER;},'revision-overflow');
  rejects(b=>b.state.stocks['tshirtStock/master'].inventoryRevision=null,'invalid-stored-number');
});
test('U09 initial closed session rejected but candidate replay only needs existence',()=>{
  rejects(b=>b.state.session.status='closed','session-closed');const b=baseline(),c=planVoid(b);
  assert.equal(replayVoid(c,b.trustedAnchor,b.intent,true).replayed,true);
  assert.throws(()=>replayVoid(c,b.trustedAnchor,b.intent,false),{code:'session-not-found'});
});
test('U10 same ID same intent replays; conflicting hash rejects',()=>{
  const b=baseline(),c=planVoid(b);assert.deepEqual(replayVoid(c,b.trustedAnchor,b.intent,true).result,c.projection.result);
  assert.throws(()=>replayVoid(c,b.trustedAnchor,{...b.intent,expectedSaleRequestHash:'f'.repeat(64)},true),{code:'intent-conflict'});
});
test('U11 strict intent rejects extra keys and partial/unsupported reason',()=>{
  rejects(b=>b.intent.quantity=1,'invalid-schema');rejects(b=>b.intent.reason='partial','invalid-void-intent');rejects(b=>b.intent.transactionId='other','intent-conflict');
});
test('U12 before and after sale hashes and entire projection bind candidate',()=>{
  const b=baseline(),c=planVoid(b);assert.deepEqual(verifyCandidate(c,b.trustedAnchor),c);
  for(const mutate of [x=>x.serverVoidV1.beforeSaleHash='f'.repeat(64),x=>x.serverVoidV1.afterSaleHash='f'.repeat(64),x=>x.projection.saleAfter.items[0].quantity++,x=>x.projection.stocksAfter['tshirtStock/master'].inventory_v2.b.d.c.s.qty++]){
    const x=copy(c);mutate(x);assert.throws(()=>verifyCandidate(x,b.trustedAnchor));
  }
});
test('U13 cancel then late sale retry never indicates a new commit',()=>{
  const b=baseline(),c=planVoid(b),r=lateSaleDecision(c,b.trustedAnchor,b.original.lock.serverSaleV1.canonicalRequest,true);
  assert.equal(r.newCommit,false);assert.equal(r.mayCreateSale,false);assert.equal(r.currentSaleStatus,'voided');assert.deepEqual(r.originalSaleResult,b.original.lock.serverSaleV1.result);
  const op=copy(b.original.lock.serverSaleV1.canonicalRequest);op.items[0].lineId='changed';assert.throws(()=>lateSaleDecision(c,b.trustedAnchor,op,true),{code:'intent-conflict'});
});
test('U14 summaries reverse only original effects and preserve other sales',()=>{
  const b=baseline();b.state.session.salesSummary.netSales+=4000;b.state.session.salesSummary.transactionCount+=2;b.state.session.inventoryCount.soldByVariant.t+=2;
  const c=planVoid(b);assert.equal(c.projection.sessionAfter.salesSummary.netSales,4000);assert.equal(c.projection.sessionAfter.salesSummary.transactionCount,2);assert.equal(c.projection.sessionAfter.inventoryCount.soldByVariant.t,2);assert.equal(c.projection.sessionAfter.note,'keep');
});
test('U15 inconsistent summaries reject without clamp',()=>{
  rejects(b=>b.state.session.salesSummary.netSales=1,'invalid-summary');rejects(b=>b.state.session.inventoryCount.soldByVariant.t=0,'invalid-event-summary');
});
test('U16 current prices and variants cannot replace saved SKU or snapshots',()=>{
  const b=baseline();b.state.session.methodBSalesPolicyV1.pricesByVariant.t=999999;
  const c=planVoid(b);assert.equal(c.projection.saleAfter.items[0].unitPrice,3000);assert.deepEqual(c.projection.restores[0].parts,['b','d','c','s']);
});
test('U17 quantity overflow rejects and negative integer stock remains valid',()=>{
  rejects(b=>b.state.stocks['tshirtStock/master'].inventory_v2.b.d.c.s.qty=Number.MAX_SAFE_INTEGER,'invalid-stored-number');
  const b=baseline();b.state.stocks['tshirtStock/master'].inventory_v2.b.d.c.s.qty=-5;assert.equal(planVoid(b).projection.stocksAfter['tshirtStock/master'].inventory_v2.b.d.c.s.qty,-2);
});
test('U18 legacy status-only void is not trusted',()=>{
  rejects(b=>b.original.sale.status='voided');assert.throws(()=>verifyCandidate({kind:'candidate-only',newCommit:false,serverVoidV1:{schema:'void-pure-candidate-v1'}},baseline().trustedAnchor));
});
test('U19 missing records cannot produce cancellation reservation',()=>{rejects(b=>b.original.sale=null);});
test('U20 self-rehashed evidence cannot replace independent original anchor',()=>{
  const b=baseline(),c=planVoid(b);c.serverVoidV1.original.sale.items[0].unitPrice=1;c.serverVoidV1.originalAnchor=hash(c.serverVoidV1.original);assert.throws(()=>verifyCandidate(c,b.trustedAnchor));
});
test('U21 stored numeric strings and null summaries cannot coerce to numbers',()=>{
  rejects(b=>b.state.session.salesSummary.netSales='10000','invalid-stored-number');
  rejects(b=>b.state.session.salesSummary.discount=null,'invalid-stored-number');
  rejects(b=>b.state.session.inventoryCount.soldByVariant.t='3','invalid-stored-number');
});
