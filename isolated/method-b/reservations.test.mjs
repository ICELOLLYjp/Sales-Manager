import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { initializeTestEnvironment,assertFails } from '@firebase/rules-unit-testing';
import * as web from 'firebase/firestore';
import { Timestamp } from 'firebase-admin/firestore';
import { runtime,PROJECT,UIDS } from './runtime.mjs';
import { hash,editInventory } from './inventory.mjs';
import { produceReservation,PRODUCERS } from './reservations.mjs';
let rt,env; const tokens={};
const path='tshirtStock/master';
const ledger=()=>({schema:'inventory-reservations-v1',complete:true,entries:[]});
const base=()=>({inventoryRevision:0,inventoryReservationAuthority:1,inventoryReservations:ledger(),inventory_v2:{b:{d:{c:{s:{qty:5},m:{qty:8}}}}},keep:Timestamp.fromMillis(123)});
const op=(extra={})=>({version:1,operationId:'hold-1',stock:'tshirt',sku:{bodyId:'b',designId:'d',colorId:'c',sizeId:'s'},expectedRevision:0,expectedQuantity:5,quantity:2,kind:'ec',source:{namespace:'woo-test',documentId:'order-1',lineId:'line-1'},action:'hold',...extra});
const read=async()=>(await rt.db.doc(path).get()).data();
const call=(o=op(),token=tokens[PRODUCERS[o.kind]])=>produceReservation(rt,token,o);
const manual=(extra={})=>editInventory(rt.db,UIDS[0],{version:1,operationId:'count',stock:'tshirt',sku:op().sku,expectedRevision:0,expectedQuantity:5,quantity:4,...extra});
async function checkpoint(stock,path,data) {
  await rt.db.doc(path).set(data);
  await rt.db.doc(`inventoryReservationAuthorities/${stock}`).set({schema:'reservation-authority-v1',path,ledgerHash:hash(data.inventoryReservations),ecComplete:true,eventComplete:true,reconciliationId:'synthetic-both-sources-only',reconciledAt:Timestamp.now()});
}
async function login(uid) {
  const response=await fetch('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:`${uid}@example.test`,password:'fixture-password-only',returnSecureToken:true})});
  assert.equal(response.status,200); return (await response.json()).idToken;
}
before(async()=>{
  rt=runtime(); env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8087,rules:await fs.readFile(new URL('./firestore.rules',import.meta.url),'utf8')}});
  await fetch(`http://127.0.0.1:9098/emulator/v1/projects/${PROJECT}/accounts`,{method:'DELETE'});
  for(const [kind,uid] of [...Object.entries(PRODUCERS),['operator',UIDS[0]]]) {
    await rt.auth.createUser({uid,email:`${uid}@example.test`,emailVerified:true,password:'fixture-password-only'});
    if(kind!=='operator') await rt.auth.setCustomUserClaims(uid,{inventoryProducer:kind});
    tokens[uid]=await login(uid);
  }
});
beforeEach(async()=>{await env.clearFirestore();await checkpoint('tshirt',path,base());});
after(async()=>{await env?.cleanup();await rt?.close();});
test('P01 held to confirmed replaces identity and advances revision; release and replay',async()=>{
  const a=await call(); const confirm=op({operationId:'confirm',action:'confirm',expectedRevision:1});
  const b=await call(confirm); assert.equal(a.commitmentId,b.commitmentId); assert.equal(b.ledger.entries.length,1); assert.equal(b.revision,2);
  const release=op({operationId:'release',action:'release',expectedRevision:2}); await call(release);
  assert.equal((await call(release)).replayed,true); assert.equal((await read()).inventoryRevision,3);
  await assert.rejects(call(op({operationId:'release-again',action:'release',expectedRevision:3})),{code:'invalid-transition'});
});
test('P02 concurrent same ID has one effect; changed intent rejected',async()=>{
  const rs=await Promise.all([call(),call(),call()]);assert.equal(rs.filter(r=>!r.replayed).length,1);
  await assert.rejects(call(op({quantity:3})),{code:'operation-id-conflict'});
  await assert.rejects(call(op({operationId:'new-id',expectedRevision:1})),{code:'commitment-already-exists'});
});
test('P03 same and different SKU conflicts use shared canonical revision',async()=>{
  for(const sizeId of ['s','m']) {
    await env.clearFirestore();await checkpoint('tshirt',path,base());
    const rs=await Promise.allSettled([call(),call(op({operationId:'other',sku:{...op().sku,sizeId},expectedQuantity:sizeId==='s'?5:8,source:{...op().source,lineId:'line-2'}}))]);
    assert.equal(rs.filter(r=>r.status==='fulfilled').length,1);assert.equal(rs.find(r=>r.status==='rejected').reason.code,'inventory-conflict');
  }
});
test('P04 EC plus event floor rejects overbooking and manual below floor',async()=>{
  await call(op({quantity:3}));
  const event=op({kind:'event',operationId:'event',expectedRevision:1,quantity:2});await call(event);
  await assert.rejects(manual({expectedRevision:2,quantity:4}),{code:'reserved-stock-floor'});
  await manual({expectedRevision:2,quantity:5});
  await assert.rejects(call(op({operationId:'more',expectedRevision:3,source:{...op().source,lineId:'line-2'},quantity:1})),{code:'reserved-stock-floor'});
});
test('P05 zero, unknown and unregistered stock fail safely',async()=>{
  for(const value of [0,null,undefined]) {
    const b=base(); if(value===undefined) delete b.inventory_v2.b.d.c.s;else b.inventory_v2.b.d.c.s.qty=value;
    await checkpoint('tshirt',path,b);await assert.rejects(call(op({expectedQuantity:0})));assert.equal((await read()).inventoryRevision,0);
  }
  await checkpoint('tshirt',path,base());await assert.rejects(call(op({quantity:0})),{code:'invalid-quantity'});
});
test('P06 missing/incomplete/tampered ledger and forged complete flag rejected',async()=>{
  for(const mutation of [b=>delete b.inventoryReservations,b=>b.inventoryReservations.complete=false,b=>b.inventoryReservations.entries.push({fake:true})]) {
    const b=base();mutation(b);await rt.db.doc(path).set(b);await assert.rejects(call());
  }
  await checkpoint('tshirt',path,base());await rt.db.doc('inventoryReservationAuthorities/tshirt').delete();
  await assert.rejects(call(),{code:'reservation-authority-required'});await assert.rejects(manual(),{code:'reservation-authority-required'});
});
test('P07 authority must cover both sources and exact ledger hash',async()=>{
  for(const patch of [{eventComplete:false},{ecComplete:false},{ledgerHash:'forged'},{path:'other/path'},{reconciledAt:'fake'}]) {
    await checkpoint('tshirt',path,base());await rt.db.doc('inventoryReservationAuthorities/tshirt').update(patch);
    await assert.rejects(call(),{code:'reservation-authority-required'});
  }
});
test('P08 service auth rejects browser, other producer, missing/expired and revoked user',async()=>{
  for(const token of [tokens[UIDS[0]],tokens[PRODUCERS.event],'invalid','']) await assert.rejects(call(op(),token));
  await rt.auth.updateUser(PRODUCERS.ec,{disabled:true});try {await assert.rejects(call(),{code:'unauthenticated'});}finally {await rt.auth.updateUser(PRODUCERS.ec,{disabled:false});}
  assert.equal((await read()).inventoryRevision,0);
});
test('P09 old client whole-map/init/queue/authority/receipt writes denied',async()=>{
  for(const uid of [UIDS[0],PRODUCERS.ec]) {
    const db=env.authenticatedContext(uid,{email_verified:true,inventoryProducer:'ec'}).firestore();
    for(const p of [path,'accessoryStock/shared','tshirtStock/shared','inventoryReservationAuthorities/tshirt','inventoryWriteReceipts/forged','inventorySaleReturns/forged','salesSessions/old-queue']) {
      await assertFails(web.setDoc(web.doc(db,p),{inventoryReservations:ledger(),inventory_v2:{},designs:[]}));
      await assertFails(web.deleteDoc(web.doc(db,p)));
    }
  }
});
test('P10 lost response and server restart replay original ID',async()=>{
  await call();await rt.close();rt=runtime();const result=await call();assert.equal(result.replayed,true);assert.equal((await read()).inventoryRevision,1);
});
test('P11 forged historical receipt result and ledger rejected',async()=>{
  await call();const ref=rt.db.doc('inventoryWriteReceipts/hold-1'),saved=(await ref.get()).data();
  for(const patch of [{schema:'fake'},{actorUid:UIDS[0]},{result:{...saved.result,quantity:999}},{beforeLedger:{...ledger(),complete:false}}]) {
    await ref.set({...saved,...patch});await assert.rejects(call(),{code:'operation-id-conflict'});
  }
});
test('P12 atomic rollback includes ledger authority physical and receipt',async()=>{
  const before=await read(),authority=(await rt.db.doc('inventoryReservationAuthorities/tshirt').get()).data();
  const db={projectId:PROJECT,doc:p=>rt.db.doc(p),runTransaction:fn=>rt.db.runTransaction(tx=>fn(new Proxy(tx,{get(t,k){if(k==='create')return()=>{throw new Error('injected-rollback');};const v=t[k];return typeof v==='function'?v.bind(t):v;}})))};
  await assert.rejects(produceReservation({...rt,db},tokens[PRODUCERS.ec],op()),/injected-rollback/);
  assert.deepEqual(await read(),before);assert.deepEqual((await rt.db.doc('inventoryReservationAuthorities/tshirt').get()).data(),authority);assert.equal((await rt.db.collection('inventoryWriteReceipts').get()).size,0);
});
async function eventConfirmed() {await call(op({kind:'event',quantity:3}));await call(op({kind:'event',quantity:3,operationId:'confirm',expectedRevision:1,action:'confirm'}));}
test('P13 sale reduces physical and event remainder once, return binds original sale',async()=>{
  await eventConfirmed();const sale=op({kind:'event',action:'sale',operationId:'sale',expectedRevision:2,quantity:2});await call(sale);await call(sale);
  assert.equal((await read()).inventory_v2.b.d.c.s.qty,3);
  const ret=op({kind:'event',action:'return',returnOf:'sale',operationId:'return',expectedRevision:3,expectedQuantity:3,quantity:2});await call(ret);assert.equal((await call(ret)).replayed,true);
  assert.equal((await read()).inventory_v2.b.d.c.s.qty,5);
  await assert.rejects(call({...ret,operationId:'return-again',expectedRevision:4,expectedQuantity:5}),{code:'original-sale-receipt-required'});
});
test('P14 reserve/count/sale contention commits only one and preserves EC floor',async()=>{
  await eventConfirmed();
  const rs=await Promise.allSettled([call(op({operationId:'ec',expectedRevision:2,quantity:2})),manual({expectedRevision:2,quantity:4}),call(op({kind:'event',action:'sale',operationId:'sale',expectedRevision:2,quantity:1}))]);
  assert.equal(rs.filter(r=>r.status==='fulfilled').length,1);assert.equal((await read()).inventoryRevision,3);
});
test('P15 no implicit release by time or session close, no arbitrary caller ledger',async()=>{
  await call();
  for(const extra of [{complete:true},{entries:[]},{path:'other/path'},{action:'close'},{action:'expire'}]) await assert.rejects(call(op({...extra,operationId:'bad',expectedRevision:1})));
  assert.equal((await read()).inventoryReservations.entries[0].state,'held');
});
test('P16 accessory uses same producer and preserves metadata and other SKU',async()=>{
  const data={inventoryRevision:0,inventoryReservationAuthority:1,inventoryReservations:ledger(),designs:[{id:'a',piercing:5,earring:0},{id:'b',piercing:8}],keep:Timestamp.fromMillis(123)};
  await checkpoint('accessory','accessoryStock/shared',data);
  const o=op({stock:'accessory',sku:{designId:'a',quantityField:'piercing'}});await call(o);
  const result=(await rt.db.doc('accessoryStock/shared').get()).data();assert.deepEqual(result.designs,data.designs);assert.deepEqual(result.keep,data.keep);
});
test('P17 held confirmed released ABA invalidates old manual revision',async()=>{
  await call();await call(op({operationId:'confirm',action:'confirm',expectedRevision:1}));await call(op({operationId:'release',action:'release',expectedRevision:2}));
  await assert.rejects(manual(),{code:'inventory-conflict'});assert.equal((await read()).inventory_v2.b.d.c.s.qty,5);
});
test('P18 refund cannot invent sale or use other identity / quantity',async()=>{
  await eventConfirmed();await call(op({kind:'event',action:'sale',operationId:'sale',expectedRevision:2,quantity:1}));
  const ret=op({kind:'event',action:'return',returnOf:'sale',operationId:'return',expectedRevision:3,expectedQuantity:4,quantity:1});
  for(const extra of [{returnOf:'absent'},{quantity:2},{source:{...op().source,lineId:'wrong'}}]) await assert.rejects(call({...ret,...extra}));
  assert.equal((await read()).inventory_v2.b.d.c.s.qty,4);
});
test('P19 original order/Session line cannot silently rebind to another SKU',async()=>{
  await call();await assert.rejects(call(op({operationId:'rebind',expectedRevision:1,expectedQuantity:8,sku:{...op().sku,sizeId:'m'}})),{code:'source-sku-conflict'});
  assert.equal((await read()).inventoryReservations.entries.length,1);
});
test('P20 sold-out event hold can release explicit zero but cannot reserve zero',async()=>{
  await eventConfirmed();await call(op({kind:'event',action:'sale',operationId:'all-sold',expectedRevision:2,quantity:3}));
  const release=op({kind:'event',action:'release',operationId:'release-zero',expectedRevision:3,expectedQuantity:2,quantity:0});
  await call(release);assert.equal((await call(release)).replayed,true);assert.equal((await read()).inventoryReservations.entries[0].state,'released');
});
