import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { saveInventoryEdit, guardedTransaction, mergeEdit, preparePatch } from '../js/inventory-concurrency.mjs';

// Isolated in-memory Firestore: no Firebase credentials, SDK or network.
// Models optimistic retry, read-before-write, atomic commits and the A1 gate.
const clone = v => structuredClone(v);
const stockPath = 'tshirtStock/master';
const accessoryPath = 'accessoryStock/shared';
const canonical = p => [stockPath, accessoryPath].includes(p);
class FieldPath { constructor(...parts) { this.parts = parts; } }
function put(data, field, value) {
  const parts = field instanceof FieldPath ? field.parts : field.split('.');
  let out = data;
  for (const part of parts.slice(0,-1)) out = out[part] ||= {};
  const key = parts.at(-1);
  out[key] = value?.__increment !== undefined ? (out[key] || 0) + value.__increment : clone(value);
}
function mock(seed) {
  const docs = new Map(Object.entries(clone(seed))), versions = new Map();
  let failBefore = false, loseReply = false, retries = 0, rendezvous = null;
  const api = {
    doc: (_db,...parts) => ({path:parts.join('/'), id:parts.at(-1)}),
    serverTimestamp: () => 'mock-server-time', increment: n => ({__increment:n}), FieldPath,
    async runTransaction(_db, fn) {
      for(let attempt=0;attempt<20;attempt++) {
        const reads = new Map(), writes = [];
        const tx = {
          async get(ref) {
            assert.equal(writes.length,0,'Firestore reads must precede writes');
            reads.set(ref.path, versions.get(ref.path)||0);
            const value = clone(docs.get(ref.path));
            return {exists:()=>value!==undefined,data:()=>clone(value),id:ref.id};
          },
          update(ref,...args) { writes.push({ref,args}); },
          set(ref,data,options) { writes.push({ref,data,options}); },
          delete(ref) { writes.push({ref,remove:true}); }
        };
        const result = await fn(tx);
        if(rendezvous) { const barrier=rendezvous; if(--barrier.left===0){rendezvous=null;barrier.release();} await barrier.promise; }
        if([...reads].some(([p,v])=>(versions.get(p)||0)!==v)){ retries++;continue; }
        if(failBefore){failBefore=false;throw Object.assign(new Error('offline'),{code:'unavailable'});}
        const next = new Map(docs);
        for(const w of writes) {
          const p=w.ref.path; let value;
          if(w.remove) value=undefined;
          else if(w.args) {
            assert(next.has(p),'update requires existing doc'); value=clone(next.get(p));
            if(w.args.length===1) for(const [k,v] of Object.entries(w.args[0])) put(value,k,v);
            else for(let i=0;i<w.args.length;i+=2) put(value,w.args[i],w.args[i+1]);
          } else value=w.options?.merge?{...clone(next.get(p)),...clone(w.data)}:clone(w.data);
          if(canonical(p)) assert(value && value.inventoryWriteProtocol===1 && value.inventoryRevision===(docs.get(p)?.inventoryRevision??0)+1,'legacy write denied');
          if(p.startsWith('inventoryWriteReceipts/')) assert(!docs.has(p),'receipt immutable');
          next.set(p,value);
        }
        for(const w of writes){docs.set(w.ref.path,next.get(w.ref.path));versions.set(w.ref.path,(versions.get(w.ref.path)||0)+1);}
        if(loseReply && writes.length){loseReply=false;throw Object.assign(new Error('reply lost'),{code:'unavailable'});}
        return result;
      }
      throw new Error('retry limit');
    }
  };
  return {api,docs,ref:api.doc(null,...stockPath.split('/')),get retries(){return retries;}, fail(){failBefore=true;},lose(){loseReply=true;},overlap(){let release;const promise=new Promise(r=>release=r);rendezvous={left:2,promise,release};}};
}
const base = () => ({inventoryRevision:0,inventory_v2:{b:{d:{c:{s:{qty:5},m:{qty:8}}}}},blank_stock:{b:{qty:10}},production_tasks:{task:{qty:2}},masters:{unchanged:true}});
const qty = db => db.docs.get(stockPath).inventory_v2.b.d.c.s.qty;
const edit = (b,size,n) => {const tree=clone(b.inventory_v2);tree.b.d.c[size]={qty:n};return {inventory_v2:tree};};
const save = (db,b,f,id,opts) => saveInventoryEdit(db.api,null,db.ref,b,f,id,opts);
async function delta(db,n,id) {
  return db.api.runTransaction(null,async raw=>{
    const tx=guardedTransaction(raw), receipt=db.api.doc(null,'transactionLocks',id);
    const snap=await tx.get(db.ref), done=await tx.get(receipt);
    if(done.exists()) return;
    tx.update(db.ref,new FieldPath('inventory_v2','b','d','c','s','qty'),snap.data().inventory_v2.b.d.c.s.qty+n);
    tx.set(receipt,{done:true});
  });
}

test('1 different SKUs: both edits survive a real optimistic retry',async()=>{
  const b=base(),db=mock({[stockPath]:b});
  db.overlap();
  await Promise.all([save(db,b,edit(b,'s',4),'a'),save(db,b,edit(b,'m',7),'b')]);
  assert.equal(qty(db),4);assert.equal(db.docs.get(stockPath).inventory_v2.b.d.c.m.qty,7);assert(db.retries>0);
});
test('2 same SKU: two deltas accumulate; stale absolute edit is rejected',async()=>{
  const b=base(),db=mock({[stockPath]:b});
  await Promise.all([delta(db,-1,'sale1'),delta(db,-2,'sale2')]);assert.equal(qty(db),2);
  await assert.rejects(save(db,b,edit(b,'s',9),'absolute'),{code:'inventory-conflict'});assert.equal(qty(db),2);
});
test('3 stale full save preserves untouched remote SKU and metadata',async()=>{
  const b=base(),db=mock({[stockPath]:b});await delta(db,-1,'sale');
  await save(db,b,{...edit(b,'m',3),masters:b.masters},'stale');assert.equal(qty(db),4);
  assert.deepEqual(db.docs.get(stockPath).masters,b.masters);
});
test('4 POS then inventory screen: same SKU cannot restore sold stock',async()=>{
  const b=base(),db=mock({[stockPath]:b});await delta(db,-1,'sale');
  await assert.rejects(save(db,b,edit(b,'s',6),'screen'),{code:'inventory-conflict'});assert.equal(qty(db),4);
});
test('5 cancellation vs adjustment: no lost cancellation',async()=>{
  const b=base(),db=mock({[stockPath]:b});
  const results=await Promise.allSettled([delta(db,1,'void'),save(db,b,edit(b,'s',2),'adjust')]);
  assert.equal(results[0].status,'fulfilled');assert([3,6].includes(qty(db)));
  if(results[1].status==='rejected') assert.equal(results[1].reason.code,'inventory-conflict');
  await delta(db,1,'void');assert([3,6].includes(qty(db)));
});
test('6 production is atomic with resources/task; conflict changes none',async()=>{
  const b=base(),db=mock({[stockPath]:b});await delta(db,-1,'sale');
  const fields={...edit(b,'s',7),blank_stock:{b:{qty:8}},production_tasks:{}};
  await assert.rejects(save(db,b,fields,'produce',{strict:true}),{code:'inventory-conflict'});
  assert.deepEqual(db.docs.get(stockPath).blank_stock,b.blank_stock);assert.deepEqual(db.docs.get(stockPath).production_tasks,b.production_tasks);
  const fresh=clone(db.docs.get(stockPath));await save(db,fresh,{...fields,...edit(fresh,'s',6)},'produce2',{strict:true});
  assert.equal(qty(db),6);assert.deepEqual(db.docs.get(stockPath).production_tasks,{});
});
test('7 explicit zero, absent cell, null and unknown remain distinct',()=>{
  const b={inventory_v2:{zero:{qty:0},unknown:{qty:null}}},c=clone(b);
  const out=preparePatch(b,{inventory_v2:{...b.inventory_v2,new:{qty:0}}},c);
  assert.equal(out.inventory_v2.zero.qty,0);assert.equal(out.inventory_v2.unknown.qty,null);assert(!Object.hasOwn(out.inventory_v2,'missing'));
});
test('8 failure before commit then retry applies once',async()=>{
  const b=base(),db=mock({[stockPath]:b}),f=edit(b,'s',4);db.fail();
  await assert.rejects(save(db,b,f,'retry'));assert.equal(qty(db),5);
  await save(db,b,f,'retry');assert.equal(qty(db),4);
});
test('9 lost reply + intervening sale + duplicate retry never restores stock',async()=>{
  const b=base(),db=mock({[stockPath]:b}),f=edit(b,'s',4);db.lose();
  await assert.rejects(save(db,b,f,'retry'));await delta(db,-1,'sale');
  await save(db,b,f,'retry');assert.equal(qty(db),3);
  await assert.rejects(save(db,b,edit(b,'s',8),'retry'),/reused/);
});
test('accessory IDs merge independently, delete conflicts, unknown preserved',async()=>{
  const b={designs:[{id:'a',piercing:5,earring:null},{id:'b',piercing:3}]};
  const db=mock({[accessoryPath]:b}),ref=db.api.doc(null,'accessoryStock','shared');
  await Promise.all([
    saveInventoryEdit(db.api,null,ref,b,{designs:[{...b.designs[0],piercing:4},b.designs[1]]},'a'),
    saveInventoryEdit(db.api,null,ref,b,{designs:[b.designs[0],{...b.designs[1],piercing:2}]},'b')
  ]);
  assert.deepEqual(db.docs.get(accessoryPath).designs,[{id:'a',piercing:4,earring:null},{id:'b',piercing:2}]);
  await assert.rejects(saveInventoryEdit(db.api,null,ref,b,{designs:[b.designs[1]]},'delete'),{code:'inventory-conflict'});
});
test('legacy whole-document update denied by modeled gate; adapter refuses blind write',async()=>{
  const db=mock({[stockPath]:base()});
  await assert.rejects(db.api.runTransaction(null,async tx=>tx.update(db.ref,{inventory_v2:{}})),/legacy write denied/);
  assert.throws(()=>guardedTransaction({update(){}}).update(db.ref,{inventory_v2:{}}),/Read canonical/);
});
test('pending accessory edit rebases without reapplying stale remote fields',()=>{
  const sent=[{id:'a',piercing:4},{id:'b',piercing:3}];
  const typing=[{id:'a',piercing:2},{id:'b',piercing:3}];
  const result=[{id:'a',piercing:4},{id:'b',piercing:1}];
  assert.deepEqual(mergeEdit(sent,typing,result),[{id:'a',piercing:2},{id:'b',piercing:1}]);
});

async function actualSales(db) {
  globalThis.__inventoryTest={db,api:{...db.api,runTransaction:(_db,fn)=>db.api.runTransaction(null,tx=>fn(guardedTransaction(tx)))}};
  let source=await fs.readFile(new URL('../js/services/transactionService.js',import.meta.url),'utf8');
  source=source.replace('import { getFirebaseState } from "../firebase.js";', 'const getFirebaseState=()=>({enabled:true,db:globalThis.__inventoryTest.db});');
  source=source.replace(/async function firestoreModule\(\) \{[\s\S]*?\n\}/,'async function firestoreModule(){return globalThis.__inventoryTest.api;}');
  return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
}
test('actual POS commit/void functions preserve locks, history and stock',async()=>{
  const variantId='tshirt__b__d__c__s';
  const db=mock({[stockPath]:base(),'salesSessions/event':{status:'open',currency:'JPY',inventoryCount:{opening:{items:[{variantId,openingQty:5}]},soldByVariant:{}}},
    ['productVariants/'+variantId]:{active:true,category:'tshirt',inventorySource:'tshirt',inventoryKey:'tshirt:b|d|c|s',bodyId:'b',designId:'d',colorId:'c',sizeId:'s'}});
  const service=await actualSales(db);
  const request={transactionId:'pos-1',sessionId:'event',items:[{variantId,category:'tshirt',quantity:1,unitPrice:100}]};
  await service.commitQuickSale(request);assert.equal(qty(db),4);
  await service.commitQuickSale(request);assert.equal(qty(db),4);
  assert(db.docs.has('salesTransactions/pos-1'));assert(db.docs.has('transactionLocks/pos-1'));
  await service.voidSaleTransaction({transactionId:'pos-1'});assert.equal(qty(db),5);
  await service.voidSaleTransaction({transactionId:'pos-1'});assert.equal(qty(db),5);
});

test('actual physical stock function rejects stale count and replays one receipt',async()=>{
  const b=base();b.physicalEditStartedAtIso='count-time';const db=mock({[stockPath]:base()});
  globalThis.__physicalTest={db,api:db.api};
  let source=await fs.readFile(new URL('../js/services/tshirtPhysicalStockService.js',import.meta.url),'utf8');
  source=source.replace("'../inventory-concurrency.mjs'",JSON.stringify(new URL('../js/inventory-concurrency.mjs',import.meta.url).href));
  source=source.replace('import { getFirebaseState } from "../firebase.js";','const getFirebaseState=()=>({enabled:true,db:globalThis.__physicalTest.db});');
  source=source.replace(/async function firestoreModule\(\) \{[\s\S]*?\n\}/,'async function firestoreModule(){return globalThis.__physicalTest.api;}');
  const {saveTshirtPhysicalStock}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const req={rows:[{variantId:'tshirt__b__d__c__s',quantity:0}],baseline:b,operationId:'physical'};
  await saveTshirtPhysicalStock(req);assert.equal(qty(db),0);
  await delta(db,2,'incoming');await saveTshirtPhysicalStock(req);assert.equal(qty(db),2);
  await assert.rejects(saveTshirtPhysicalStock({...req,operationId:'stale-count'}),{code:'inventory-conflict'});
});
test('all canonical service writers import the revision adapter; rules exclude broad grants',async()=>{
  for(const name of ['transactionService','eventCloseService','closeWithPendingInventoryService','closeWithUnidentifiedService','eventLateSkuResolutionService','fastAmountAllocationService','tshirtPhysicalStockService']){
    const source=await fs.readFile(new URL('../js/services/'+name+'.js',import.meta.url),'utf8');
    assert(source.includes('../inventory-firestore.js'));assert(!source.includes('firebase-firestore.js'));
  }
  const rules=await fs.readFile(new URL('../firestore.rules',import.meta.url),'utf8');
  assert(!rules.includes('match /{document=**}'));
  assert(rules.includes("collection == 'tshirtStock' && document == 'master'"));
  assert(rules.includes("collection == 'accessoryStock' && document == 'shared'"));
  assert(rules.includes('request.resource.data.inventoryRevision == before + 1'));
});
