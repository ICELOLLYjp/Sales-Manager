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

const eventOp=(extra={})=>op({kind:'event',source:{namespace:'sales-manager',documentId:'session-fixture',lineId:'sku-fixture'},...extra});
const release=()=>eventOp({operationId:'event-release',action:'release',expectedRevision:2});
const sessionPath='salesSessions/session-fixture';
async function prepare() {
  await call(eventOp());await call(eventOp({operationId:'event-confirm',action:'confirm',expectedRevision:1}));
  await rt.db.doc(sessionPath).set({status:'closed',closedAt:Timestamp.now(),eventCloseSummary:{unclassifiedDifference:0},inventoryCount:{finalizedAt:Timestamp.now(),adjustmentsAppliedAt:Timestamp.now()}});
  await rt.db.doc('salesTransactions/fixture-sale').set({sessionId:'session-fixture',status:'committed',items:[{quantity:1}]});
}
const describe=s=>({path:s.ref.path,version:{seconds:s.updateTime.seconds,nanoseconds:s.updateTime.nanoseconds},dataHash:hash(s.data())});
const reviewRef=()=>rt.db.doc(`inventoryEventReconciliations/${hash(release())}`);
async function review(patch={}) {
  const session=await rt.db.doc(sessionPath).get(),sales=await rt.db.collection('salesTransactions').where('sessionId','==','session-fixture').get();
  const sourceManifest={session:describe(session),transactions:sales.docs.map(describe).sort((a,b)=>a.path.localeCompare(b.path))};
  await reviewRef().set({schema:'event-release-reconciliation-v1',operationHash:hash(release()),sourceHash:hash(sourceManifest),physicalCountReviewed:true,allDevicesSynced:true,salesAndVoidsReviewed:true,unresolvedCount:0,manualReleaseApproved:true,reviewedAt:Timestamp.now(),reviewId:'fixture-review',...patch});
}
test('R01 real Session/sales query -> reviewed release -> receipt; replay after later source change does not write',async()=>{
  await prepare();await review();const result=await call(release());assert.equal(result.ledger.entries[0].state,'released');
  await rt.db.doc('salesTransactions/late-offline').set({sessionId:'session-fixture',status:'committed'});
  assert.equal((await call(release())).replayed,true);assert.equal((await read()).inventoryRevision,3);
  assert.equal((await read()).inventory_v2.b.d.c.s.qty,5);
});
test('R02 closed Session alone cannot release; no receipt or revision side effects',async()=>{
  await prepare();await assert.rejects(call(release()),{code:'event-reconciliation-required'});
  assert.equal((await read()).inventoryRevision,2);assert.equal((await rt.db.doc('inventoryWriteReceipts/event-release').get()).exists,false);
});
test('R03 each missing review condition fails closed',async()=>{
  await prepare();
  for(const patch of [{allDevicesSynced:false},{physicalCountReviewed:false},{salesAndVoidsReviewed:false},{manualReleaseApproved:false},{unresolvedCount:1},{sourceHash:'forged'},{operationHash:'wrong'},{reviewedAt:'yesterday'}]){
    await review(patch);await assert.rejects(call(release()),{code:'event-reconciliation-required'});
  }assert.equal((await read()).inventoryRevision,2);
});
test('R04 pending Session and missing final inventory count reject even with review',async()=>{
  await prepare();
  for(const patch of [{status:'pending_allocation'},{status:'closed',inventoryCount:{}},{inventoryCount:{finalizedAt:Timestamp.now(),adjustmentsAppliedAt:Timestamp.now()},eventCloseSummary:{unclassifiedDifference:1}}]){
    await rt.db.doc(sessionPath).update(patch);await review();await assert.rejects(call(release()),{code:'event-reconciliation-required'});
  }
});
test('R05 late offline insert, cancellation update and deletion invalidate review',async()=>{
  await prepare();
  for(const mutate of [()=>rt.db.doc('salesTransactions/late').set({sessionId:'session-fixture'}),()=>rt.db.doc('salesTransactions/fixture-sale').update({status:'voided'}),()=>rt.db.doc('salesTransactions/late').delete()]){
    await review();await mutate();await assert.rejects(call(release()),{code:'event-reconciliation-required'});
  }
});
test('R06 Session ABA with equal content still invalidates reviewed snapshot',async()=>{
  await prepare();const ref=rt.db.doc(sessionPath),saved=(await ref.get()).data();await review();
  await ref.update({status:'open'});await ref.set(saved);await assert.rejects(call(release()),{code:'event-reconciliation-required'});
});
test('R07 stale stock revision rejects; operator must reread and explicitly review a new intent',async()=>{
  await prepare();await review();await manual({expectedRevision:2,quantity:4});
  await assert.rejects(call(release()),{code:'inventory-conflict'});
  await assert.rejects(call({...release(),operationId:'blind-retry',expectedRevision:3,expectedQuantity:4}),{code:'event-reconciliation-required'});
});
test('R08 concurrent same operation releases exactly once',async()=>{
  await prepare();await review();const results=await Promise.all([call(release()),call(release())]);
  assert.equal(results.filter(x=>!x.replayed).length,1);assert.equal((await read()).inventoryRevision,3);
});
test('R09 receipt without historical proof or tampered review cannot replay',async()=>{
  await prepare();await review();await call(release());const ref=rt.db.doc('inventoryWriteReceipts/event-release'),saved=(await ref.get()).data();
  for(const eventReleaseProof of [null,{...saved.eventReleaseProof,reconciliation:{...saved.eventReleaseProof.reconciliation,allDevicesSynced:false}}]){
    await ref.set({...saved,eventReleaseProof});await assert.rejects(call(release()),{code:'operation-id-conflict'});
  }
});
test('R10 transaction rollback preserves hold, checkpoint and source review',async()=>{
  await prepare();await review();const before=await read();
  const db={projectId:PROJECT,doc:p=>rt.db.doc(p),collection:p=>rt.db.collection(p),runTransaction:fn=>rt.db.runTransaction(tx=>fn(new Proxy(tx,{get(t,k){if(k==='create')return()=>{throw Error('rollback');};const v=t[k];return typeof v==='function'?v.bind(t):v;}})))};
  await assert.rejects(produceReservation({...rt,db},tokens[PRODUCERS.event],release()),/rollback/);assert.deepEqual(await read(),before);
});
test('R11 browser and producer clients cannot forge privileged review',async()=>{
  for(const uid of [UIDS[0],PRODUCERS.event]){
    const db=env.authenticatedContext(uid,{email_verified:true,inventoryProducer:'event'}).firestore();
    await assertFails(web.setDoc(web.doc(db,'inventoryEventReconciliations/forged'),{allDevicesSynced:true}));
  }
});
test('R12 concurrent count versus reviewed release commits only one canonical revision',async()=>{
  await prepare();await review();
  const results=await Promise.allSettled([call(release()),manual({expectedRevision:2,quantity:4})]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(results.find(x=>x.status==='rejected').reason.code,'inventory-conflict');
  assert.equal((await read()).inventoryRevision,3);
});
