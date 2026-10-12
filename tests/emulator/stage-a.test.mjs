import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import * as api from './sdk.mjs';
import { saveInventoryEdit } from '../../js/inventory-concurrency.mjs';
import { commitQuickSale, voidSaleTransaction } from '../../js/services/transactionService.js';
import { finalizeEventSession } from '../../js/services/eventCloseService.js';
import { closeEventWithPendingInventory } from '../../js/services/closeWithPendingInventoryService.js';
import { closeEventWithUnidentified } from '../../js/services/closeWithUnidentifiedService.js';
import { resolveClosedQuickGroupToSku } from '../../js/services/eventLateSkuResolutionService.js';
import { classifyFastAmountToSku } from '../../js/services/fastAmountAllocationService.js';
import { saveTshirtPhysicalStock } from '../../js/services/tshirtPhysicalStockService.js';
import { saveEventOpeningInventory, saveEventClosingInventory, resetEventOpeningInventory } from '../../js/services/inventoryCountService.js';

const projectId = 'demo-icelolly-stage-a';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8085', 'Explicit loopback emulator required');
let env, db;
const stock = 'tshirtStock/master', accessory = 'accessoryStock/shared';
const variantId = 'tshirt__b__d__c__s';
const row = { variantId, category: 'tshirt', inventorySource: 'tshirt', inventoryKey: 'tshirt:b|d|c|s', bodyId:'b', designId:'d', colorId:'c', sizeId:'s', label:'Test S', openingQty:5 };
const rowM = { ...row, variantId:'tshirt__b__d__c__m', inventoryKey:'tshirt:b|d|c|m', sizeId:'m', label:'Test M', openingQty:8 };
const base = () => ({ inventoryRevision:0, inventory_v2:{b:{d:{c:{s:{qty:5},m:{qty:8}}}}}, masters:{unchanged:true} });
const session = () => ({ status:'open', currency:'JPY', inventoryCount:{opening:{items:[row,rowM]},soldByVariant:{}} });
const ref = (path, database=db) => api.doc(database,path);
const read = async path => (await api.getDocFromServer(ref(path))).data();
const qty = async () => (await read(stock)).inventory_v2.b.d.c.s.qty;
const fields = (b,size,value) => { const tree=structuredClone(b.inventory_v2); tree.b.d.c[size]={qty:value}; return {inventory_v2:tree}; };
const save = (b,size,value,id,customApi=api) => saveInventoryEdit(customApi,db,ref(stock),b,fields(b,size,value),id);
const sale = (id='sale',items=[{variantId,category:'tshirt',quantity:1,unitPrice:100}]) => commitQuickSale({transactionId:id,sessionId:'event',items});
async function seed(values) {
  await env.withSecurityRulesDisabled(async context => {
    const fixtureDb = context.firestore();
    for (const [path,data] of Object.entries(values)) await api.setDoc(api.doc(fixtureDb,path),data);
  });
}
before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore:{host:'127.0.0.1',port:8085,rules:await fs.readFile(new URL('../../firestore.rules',import.meta.url),'utf8')} });
  db = env.authenticatedContext('operator',{email:'operator@example.test'}).firestore();
});
beforeEach(async () => {
  globalThis.__stageA={db,attempts:0};
  await env.clearFirestore();
  await seed({[stock]:base(),[accessory]:{designs:[{id:'a',name:'A',piercing:5,earring:null}]},'salesSessions/event':session(),['productVariants/'+variantId]:{...row,active:true}});
});
after(async () => { await env?.cleanup(); });

test('R01 unauthenticated canonical/read/receipt/business access is denied',async()=>{
  const anon=env.unauthenticatedContext().firestore();
  for(const path of [stock,accessory,'inventoryWriteReceipts/x','salesSessions/event','salesSessions/event/items/x']) {
    await assertFails(api.getDoc(ref(path,anon)));
    await assertFails(api.setDoc(ref(path,anon),{inventoryRevision:1,inventoryWriteProtocol:1}));
  }
});
test('R02 SECURITY GAP: unrelated authenticated and anonymous-auth identities are accepted',async()=>{
  for(const [uid,claims] of [['outsider',{email:'outsider@example.test',email_verified:false}],['anonymous-auth',{firebase:{sign_in_provider:'anonymous'}}]]) {
    const other=env.authenticatedContext(uid,claims).firestore();
    await assertSucceeds(api.getDoc(ref(stock,other)));
    const current=await read(stock);
    await assertSucceeds(api.updateDoc(ref(stock,other),{inventoryRevision:current.inventoryRevision+1,inventoryWriteProtocol:1}));
  }
});
test('R03 legacy full replacement and field update cannot bypass overlapping matches',async()=>{
  for(const path of [stock,accessory]) {
    await assertFails(api.setDoc(ref(path),{legacy:true}));
    await assertFails(api.updateDoc(ref(path),{legacy:true}));
  }
});
test('R04 real SDK transaction with inventory receipt succeeds',async()=>{
  await save(base(),'s',4,'normal');
  assert.equal(await qty(),4); assert.equal((await read(stock)).inventoryRevision,1);
  assert.equal((await read('inventoryWriteReceipts/normal')).revision,1);
});
test('R05 revision mismatch, skip, reuse, wrong type/protocol are denied',async()=>{
  for(const inventoryRevision of [0,2,-1,1.5,'1']) await assertFails(api.updateDoc(ref(stock),{inventoryRevision,inventoryWriteProtocol:1}));
  await assertFails(api.updateDoc(ref(stock),{inventoryRevision:1,inventoryWriteProtocol:2}));
  await save(base(),'s',4,'rev');
  await assertFails(api.updateDoc(ref(stock),{inventoryRevision:1,inventoryWriteProtocol:1}));
});
test('R06 canonical create and delete are denied',async()=>{
  for(const path of [stock,accessory]) {
    await assertFails(api.deleteDoc(ref(path)));
    await env.withSecurityRulesDisabled(c=>api.deleteDoc(api.doc(c.firestore(),path)));
    await assertFails(api.setDoc(ref(path),{inventoryRevision:1,inventoryWriteProtocol:1}));
  }
});
test('R07 receipt standalone, malformed, duplicate, update and deletion denied',async()=>{
  const receipt={path:stock,intent:'a'.repeat(64),revision:1,createdAt:api.serverTimestamp()};
  await assertFails(api.setDoc(ref('inventoryWriteReceipts/alone'),receipt));
  for(const patch of [{path:'other/doc'},{intent:'short'},{revision:2},{createdAt:0},{extra:true}]) {
    const batch=api.writeBatch(db);
    batch.update(ref(stock),{inventoryRevision:1,inventoryWriteProtocol:1});
    batch.set(ref('inventoryWriteReceipts/bad'),{...receipt,...patch});
    await assertFails(batch.commit()); assert.equal((await read(stock)).inventoryRevision,0);
  }
  await save(base(),'s',4,'immutable');
  await assertFails(api.setDoc(ref('inventoryWriteReceipts/immutable'),receipt));
  await assertFails(api.updateDoc(ref('inventoryWriteReceipts/immutable'),{intent:'b'.repeat(64)}));
  await assertFails(api.deleteDoc(ref('inventoryWriteReceipts/immutable')));
});
test('R08 rejected stock step rolls back receipt and business writes atomically',async()=>{
  const batch=api.writeBatch(db);
  batch.update(ref(stock),{inventoryRevision:2,inventoryWriteProtocol:1});
  batch.set(ref('inventoryWriteReceipts/atomic'),{path:stock,intent:'a'.repeat(64),revision:2,createdAt:api.serverTimestamp()});
  batch.set(ref('salesTransactions/atomic'),{test:true});
  await assertFails(batch.commit());
  assert.equal(await read('inventoryWriteReceipts/atomic'),undefined);
  assert.equal(await read('salesTransactions/atomic'),undefined);
  assert.equal(await qty(),5);
});
test('R09 SECURITY GAP: protocol plus next revision permits blind whole overwrite without receipt',async()=>{
  await assertSucceeds(api.setDoc(ref(stock),{inventoryRevision:1,inventoryWriteProtocol:1,inventory_v2:{}}));
  assert.equal((await read(stock)).masters,undefined);
});
test('R10 broad nested match allows descendant docs, never canonical parent',async()=>{
  await assertSucceeds(api.setDoc(ref(stock+'/audit/x'),{test:true}));
  await assertSucceeds(api.setDoc(ref('inventoryWriteReceipts/x/audit/y'),{test:true}));
  await assertFails(api.updateDoc(ref(stock),{legacy:true}));
  assert.equal(await qty(),5);
});
test('R11 missing revision migrates once; malformed stored revision is denied',async()=>{
  await seed({[stock]:{inventory_v2:base().inventory_v2}});
  await save({inventory_v2:base().inventory_v2},'s',4,'migration');
  assert.equal((await read(stock)).inventoryRevision,1);
  for(const value of [null,-1,'0']) {
    await seed({[stock]:{...base(),inventoryRevision:value}});
    await assertFails(api.updateDoc(ref(stock),{inventoryRevision:1,inventoryWriteProtocol:1}));
  }
});
test('R12 rules-disabled fixture demonstrates privileged path bypass, not production IAM coverage',async()=>{
  await seed({[stock]:{...base(),inventoryRevision:0,adminBypass:true}});
  assert.equal((await read(stock)).adminBypass,true);
});
test('C01 forced overlapping different SKU edits retry and preserve both',async()=>{
  let arrived=0,release; const gate=new Promise(r=>release=r); let attempts=0;
  const concurrentApi={...api,runTransaction:(database,callback)=>api.runTransaction(database,async tx=>{
    attempts++; const result=await callback(tx);
    if(arrived<2){arrived++;if(arrived===2)release();await gate;}
    return result;
  })};
  const results=await Promise.allSettled([save(base(),'s',4,'s',concurrentApi),save(base(),'m',7,'m',concurrentApi)]);
  console.log('C01 outcomes:',results.map(r=>r.status==='fulfilled'?'committed':r.reason.code),'attempts:',attempts,'revision:',(await read(stock)).inventoryRevision);
  for(const result of results) if(result.status==='rejected') throw result.reason;
  assert.equal(await qty(),4); assert.equal((await read(stock)).inventory_v2.b.d.c.m.qty,7);
  assert(attempts>=3); console.log('Observed transaction attempts:',attempts);
});
test('C02 concurrent same SKU absolute edits allow one and reject one',async()=>{
  const outcomes=await Promise.allSettled([save(base(),'s',4,'one'),save(base(),'s',3,'two')]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(outcomes.find(x=>x.status==='rejected').reason.code,'inventory-conflict');
  assert.equal((await read(stock)).inventoryRevision,1);
});
test('C03 accessory edits merge by ID/field and preserve unknown',async()=>{
  const b=await read(accessory);
  await saveInventoryEdit(api,db,ref(accessory),b,{designs:[{...b.designs[0],piercing:4}]},'acc');
  assert.deepEqual((await read(accessory)).designs,[{id:'a',name:'A',piercing:4,earring:null}]);
  await saveInventoryEdit(api,db,ref(accessory),b,{designs:[{...b.designs[0],earring:0}]},'acc-second');
  assert.deepEqual((await read(accessory)).designs,[{id:'a',name:'A',piercing:4,earring:0}]);
});
test('C04 control: real SDK retries stale non-inventory transaction under existing broad rule',async()=>{
  await api.setDoc(ref('emulatorControls/counter'),{n:0});
  let arrived=0,release,attempts=0; const gate=new Promise(r=>release=r);
  const increment=()=>api.runTransaction(db,async tx=>{
    attempts++; const target=ref('emulatorControls/counter'); const snap=await tx.get(target);
    if(arrived<2){arrived++;if(arrived===2)release();await gate;}
    tx.update(target,{n:snap.data().n+1});
  });
  const results=await Promise.allSettled([increment(),increment()]);
  console.log('C04 control outcomes:',results.map(r=>r.status==='fulfilled'?'committed':r.reason.code),'attempts:',attempts);
  for(const result of results) if(result.status==='rejected') throw result.reason;
  assert.equal((await read('emulatorControls/counter')).n,2); assert(attempts>=3);
});
test('S01 actual POS sale, duplicate and cancellation preserve stock/history/locks',async()=>{
  await sale(); await sale(); assert.equal(await qty(),4);
  assert.equal((await read(stock)).inventoryRevision,1);
  assert(await read('salesTransactions/sale')); assert(await read('transactionLocks/sale'));
  await voidSaleTransaction({transactionId:'sale'}); await voidSaleTransaction({transactionId:'sale'});
  assert.equal(await qty(),5); assert.equal((await read(stock)).inventoryRevision,2);
});
test('S02 actual concurrent POS deltas and duplicate sale decrement once per ID',async()=>{
  const results=await Promise.allSettled([sale('a'),sale('b'),sale('a')]);
  console.log('S02 outcomes:',results.map(r=>r.status==='fulfilled'?'committed':r.reason.code),'quantity:',await qty());
  for(const result of results) if(result.status==='rejected') throw result.reason;
  assert.equal(await qty(),3); assert.equal((await read(stock)).inventoryRevision,2);
});
test('S03 actual physical count versus sale rejects stale baseline',async()=>{
  const baseline={...base(),physicalEditStartedAtIso:'2026-10-12T00:00:00.000Z'};
  await sale();
  await assert.rejects(saveTshirtPhysicalStock({rows:[{variantId,quantity:9}],baseline,operationId:'count'}),{code:'inventory-conflict'});
  assert.equal(await qty(),4); assert.equal(await read('inventoryWriteReceipts/count'),undefined);
});
test('S04 injected lost reply after REAL commits: receipt and POS ID retries apply once',async()=>{
  globalThis.__stageA.loseReply=true;
  await assert.rejects(save(base(),'s',4,'lost'),{code:'unavailable'});
  await sale(); await save(base(),'s',4,'lost'); assert.equal(await qty(),3);
  await assert.rejects(save(base(),'s',9,'lost'),/reused/);
  globalThis.__stageA.loseReply=true;
  await assert.rejects(sale('lost-pos'),{code:'unavailable'});
  await sale('lost-pos'); assert.equal(await qty(),2);
});
test('S05 actual normal event close with loss applies only adjustment, never exact sale twice',async()=>{
  await sale();
  await api.updateDoc(ref('salesSessions/event'),{'inventoryCount.closing':{items:[{...row,closingQty:3,loss:1},{...rowM,closingQty:8}]}});
  await finalizeEventSession({sessionId:'event'}); await finalizeEventSession({sessionId:'event'});
  assert.equal(await qty(),3); assert.equal((await read('salesSessions/event')).status,'closed');
  assert.equal((await read(stock)).inventoryRevision,2);
});
test('S06 actual pending close applies known loss once and retains missing SKU count',async()=>{
  await sale();
  await api.updateDoc(ref('salesSessions/event'),{status:'pending_allocation','inventoryCount.closing':{items:[{...row,closingQty:3,loss:1}]}});
  await closeEventWithPendingInventory({sessionId:'event'}); await closeEventWithPendingInventory({sessionId:'event'});
  assert.equal(await qty(),3); assert.equal((await read('salesSessions/event')).status,'closed');
  assert.deepEqual((await read('salesSessions/event')).inventoryCount.pendingInventory.missingClosingVariantIds,[rowM.variantId]);
});
test('S07 actual unidentified close and later SKU resolution apply once',async()=>{
  await sale('quick',[{category:'tshirt',quantity:1,unitPrice:100}]);
  await api.updateDoc(ref('salesSessions/event'),{status:'pending_allocation','inventoryCount.closing':{items:[{...row,closingQty:4,loss:1},{...rowM,closingQty:8}]}});
  await closeEventWithUnidentified({sessionId:'event'});
  assert.equal(await qty(),4);
  const closed=await read('salesSessions/event');
  const group=closed.inventoryCount.unidentifiedQuick.groups[0];
  assert.equal(group.quantity,1);
  const request={sessionId:'event',groupKey:group.groupKey,variantId,quantity:1};
  await resolveClosedQuickGroupToSku(request);
  assert.equal(await qty(),3);
  await assert.rejects(resolveClosedQuickGroupToSku(request)); assert.equal(await qty(),3);
  assert.equal((await read('salesSessions/event')).inventoryCount.unidentifiedQuick.unresolvedTotal,0);
});
test('S08 actual amount-only sale allocation updates SKU once',async()=>{
  await seed({'salesTransactions/amount':{sessionId:'event',status:'committed',amountOnly:true,classificationStatus:'unclassified',total:100,items:[]}});
  const request={transactionId:'amount',variantId,quantity:1};
  await classifyFastAmountToSku(request); assert.equal(await qty(),4);
  await classifyFastAmountToSku(request); assert.equal(await qty(),4);
});
for(const operation of ['opening','closing','reset']) test('S09 actual count '+operation+' detects sale between preflight and transaction',async()=>{
  globalThis.__stageA.beforeTransaction=()=>sale('racing-sale');
  const request={sessionId:'event',items:[{...row,closingQty:5},{...rowM,closingQty:8}],overwrite:true};
  const fn={opening:saveEventOpeningInventory,closing:saveEventClosingInventory,reset:resetEventOpeningInventory}[operation];
  await assert.rejects(fn(request),{code:'inventory-conflict'});
  assert.equal(await qty(),4);
  assert.equal((await read('salesSessions/event')).inventoryCount.soldByVariant[variantId],1);
});
test('S10 TCP cut before commit fails without changes, reconnection retries same POS ID once',async()=>{
  const sockets=new Set(); let blocked=false,cutEnv;
  const proxy=net.createServer(socket=>{
    if(blocked){socket.destroy();return;}
    const upstream=net.connect(8085,'127.0.0.1');
    for(const s of [socket,upstream]) { sockets.add(s); s.on('close',()=>sockets.delete(s)); s.on('error',()=>{socket.destroy();upstream.destroy();}); }
    socket.pipe(upstream);upstream.pipe(socket);
  });
  await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(8086,'127.0.0.1',resolve);});
  try {
    cutEnv=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8086}});
    const cutDb=cutEnv.authenticatedContext('operator',{email:'operator@example.test'}).firestore();
    await api.getDocFromServer(ref(stock,cutDb));
    blocked=true; for(const socket of sockets)socket.destroy();
    globalThis.__stageA.db=cutDb; globalThis.__stageA.maxAttempts=1;
    await assert.rejects(sale('offline'),error=>{
      console.log('S10 TCP cut error:',error.code);
      return ['unavailable','cancelled'].includes(error.code);
    });
    assert.equal(await qty(),5);assert.equal(await read('salesTransactions/offline'),undefined);
    blocked=false;
    await sale('offline');await sale('offline');assert.equal(await qty(),4);
  } finally {
    globalThis.__stageA.db=db;delete globalThis.__stageA.maxAttempts;
    await cutEnv?.cleanup();for(const socket of sockets)socket.destroy();
    await new Promise(resolve=>proxy.close(resolve));
  }
});
test('S11 actual physical count success and receipt replay preserve later sale',async()=>{
  const baseline={...base(),physicalEditStartedAtIso:'2026-10-12T00:00:00.000Z'};
  const request={rows:[{variantId,quantity:3}],baseline,operationId:'physical-success'};
  await saveTshirtPhysicalStock(request); assert.equal(await qty(),3);
  await sale(); await saveTshirtPhysicalStock(request); assert.equal(await qty(),2);
});
test('S12 actual mixed T-shirt/accessory POS sale and void are atomic',async()=>{
  const acc={variantId:'pierce__a',category:'pierce',inventorySource:'accessory',inventoryKey:'accessory:a|piercing',sourceId:'a',stockField:'piercing',active:true};
  await seed({'productVariants/pierce__a':acc,'salesSessions/event':{...session(),inventoryCount:{opening:{items:[row,{...acc,openingQty:5}]},soldByVariant:{}}}});
  await sale('mixed',[{variantId,category:'tshirt',quantity:1,unitPrice:100},{variantId:acc.variantId,category:'pierce',quantity:1,unitPrice:50}]);
  assert.equal(await qty(),4); assert.equal((await read(accessory)).designs[0].piercing,4);
  await voidSaleTransaction({transactionId:'mixed'});
  assert.equal(await qty(),5); assert.equal((await read(accessory)).designs[0].piercing,5);
});
test('S13 rejected missing canonical stock cannot leave POS sale or lock behind',async()=>{
  await env.withSecurityRulesDisabled(c=>api.deleteDoc(api.doc(c.firestore(),stock)));
  await assert.rejects(sale('missing'));
  assert.equal(await read('salesTransactions/missing'),undefined); assert.equal(await read('transactionLocks/missing'),undefined);
});
test('R13 SECURITY GAP: multiple arbitrary receipts can accompany one legitimate revision',async()=>{
  const batch=api.writeBatch(db);
  batch.update(ref(stock),{inventoryRevision:1,inventoryWriteProtocol:1});
  for(const id of ['extra-one','extra-two']) batch.set(ref('inventoryWriteReceipts/'+id),{path:stock,intent:'z'.repeat(64),revision:1,createdAt:api.serverTimestamp()});
  await assertSucceeds(batch.commit()); assert(await read('inventoryWriteReceipts/extra-two'));
});
