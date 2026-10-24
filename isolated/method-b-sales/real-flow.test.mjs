import test,{before,beforeEach,afterEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {once} from 'node:events';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import * as web from 'firebase/firestore';
import {Timestamp} from 'firebase-admin/firestore';
import {runtime,PROJECT,UIDS,assertIsolated} from './runtime.mjs';
import {isolatedVoid} from './void-runtime.mjs';
import {server} from './http.mjs';
import {contextHash} from './sales.mjs';
import {hash} from './validation.mjs';
import {realFlowAdapter} from './real-flow-adapter.mjs';
let rt,env,api,url,token,baseline;
const observations=[];
const stock='tshirtStock/master',sessionPath='salesSessions/s';
const variant={active:true,category:'tshirt',inventorySource:'tshirt',inventoryKey:'tshirt:b|d|c|s',bodyId:'b',designId:'d',colorId:'c',sizeId:'s',displayName:'Shirt'};
const session=()=>({status:'open',currency:'JPY',type:'event',methodBSalesPolicyV1:{version:1,currency:'JPY',pricesByVariant:{t:3000}},inventoryCount:{opening:{capturedAt:Timestamp.fromMillis(1000),items:[{...variant,variantId:'t',openingQty:4}]},flowEntries:[],soldByVariant:{}},note:'retain'});
const sale=id=>({version:1,transactionId:id,sessionId:'s',currency:'JPY',items:[{lineId:'1',variantId:'t',quantity:1,unitPrice:3000,setDiscount:0,manualDiscount:0}],orderDiscount:0,paymentMethod:'manual',expectedContextHash:contextHash('s',session(),new Map([['t',variant]]))});
const read=async path=>(await rt.db.doc(path).get()).data();
const quantity=async()=>(await read(stock)).inventory_v2.b.d.c.s.qty;
async function snapshot(){const result={};for(const c of await rt.db.listCollections())for(const d of (await c.get()).docs)result[d.ref.path]=d.data();return JSON.stringify(result);}
async function call(route,body,status=200){const response=await fetch(`${url}/v1/sales/${route}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify(body)});const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));return result;}
const cancel=(op,status=200)=>call('void',{version:1,transactionId:op.transactionId,expectedSaleRequestHash:hash(op),reason:'manual_void'},status);
const count=(closingQty,loss=0)=>rt.db.doc(sessionPath).update({'inventoryCount.closing':{savedAt:Timestamp.now(),items:[{variantId:'t',closingQty,loss}]}});
const finalize=service=>service.finalizeEventSession({sessionId:'s',closedByEmail:'fixture-business@example.test'});
async function assertClosed(sold,movementCount){const s=await read(sessionPath),lock=await read('transactionLocks/eventclose_s');assert.equal(s.status,'closed');assert.equal(s.eventCloseSummary.skuSalesTotal,sold);assert.equal(s.eventCloseSummary.movementCount,movementCount);assert.equal(s.inventoryCount.soldByVariant.t,sold);assert.equal(s.note,'retain');assert.equal(lock.status,'committed');assert.equal(lock.action,'event_close');assert.equal(lock.movementCount,movementCount);}
before(async()=>{
  assertIsolated();rt=runtime();env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8088,rules:await fs.readFile(new URL('./firestore.rules',import.meta.url),'utf8')}});
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`,{method:'DELETE'});
  await rt.auth.createUser({uid:UIDS[0],email:'fixture-business@example.test',emailVerified:true,password:'fixture-only-password'});
  const login=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'fixture-business@example.test',password:'fixture-only-password',returnSecureToken:true})});assert.equal(login.status,200);token=(await login.json()).idToken;
  const client=env.authenticatedContext(UIDS[0],{email_verified:true}).firestore();
  for(const p of [stock,'accessoryStock/shared',sessionPath,'salesTransactions/probe','transactionLocks/probe','inventoryMovements/probe'])await assertFails(web.setDoc(web.doc(client,p),{probe:true}));
  rt.voidSales=isolatedVoid(rt,()=>true);api=server(rt);api.listen(0,'127.0.0.1');await once(api,'listening');url=`http://127.0.0.1:${api.address().port}`;
});
beforeEach(async()=>{
  await env.clearFirestore();await rt.db.doc(stock).set({inventoryRevision:0,inventory_v2:{b:{d:{c:{s:{qty:5,note:'retain'},m:{qty:8}}}}},keep:true});
  await rt.db.doc('accessoryStock/shared').set({inventoryRevision:0,designs:[],keep:true});await rt.db.doc(sessionPath).set(session());await rt.db.doc('productVariants/t').set(variant);baseline=JSON.parse(await snapshot());
});
afterEach(async t=>observations.push({case:t.name,before:baseline,after:JSON.parse(await snapshot())}));
after(async()=>{await fs.writeFile(new URL('./artifacts/real-flow-observations.json',import.meta.url),JSON.stringify(observations,null,2)+'\n');if(api){api.closeAllConnections();await new Promise(r=>api.close(r));}await env?.cleanup();await rt?.close();});

async function prepare(){
  await call('commit',sale('retained'));
  // Synthetic event flow and closing input; calculation and wrappers are real pinned source.
  await rt.db.doc(sessionPath).update({'inventoryCount.flowEntries':[{id:'r1',type:'restock',variantId:'t',quantity:2}]});
  await count(4,1); // opening 4 + restock 2 - exact sale 1 - loss 1 = closing 4
  assert.equal(await quantity(),4);
  return (await read(sessionPath)).inventoryCount.opening.items;
}
async function healthy(opening){
  const s=await read(sessionPath);await assertClosed(1,1);assert.equal(await quantity(),3);
  assert.equal((await read(stock)).inventoryRevision,2);
  assert.deepEqual(s.inventoryCount.opening.items,opening);
  assert.equal(s.inventoryCount.eventFlowCloseRecovery,undefined);
  assert.equal(s.inventoryCount.eventFlowReconciliation.restockTotal,2);
  assert.equal(s.eventCloseSummary.openingTotal,4);assert.equal(s.eventCloseSummary.flowAdjustedOpeningTotal,6);
  assert.equal((await read('inventoryMovements/eventclose_s__1__loss')).appliedInventoryDelta,-1);
  assert.equal((await rt.db.collection('inventoryMovements').get()).size,2);
}
test('C04 genuine FlowCompat sequential success restores opening and applies loss only once',async()=>{
  const opening=await prepare(),service=await realFlowAdapter(rt.db,{atomic:false});
  await finalize(service);await healthy(opening);const closed=await snapshot();
  assert.equal((await finalize(service)).duplicate,true);assert.equal(await snapshot(),closed);
});
test('C05 known defect reproduced: post-close write failure clears marker but loses reconciliation',async()=>{
  const opening=await prepare();
  const service=await realFlowAdapter(rt.db,{atomic:false,beforeWrite:n=>{if(n===2)throw Error('injected-post-close-write-failure');}});
  await assert.rejects(finalize(service),/injected-post-close-write-failure/);
  const s=await read(sessionPath);await assertClosed(1,1);assert.equal(await quantity(),3);
  assert.deepEqual(s.inventoryCount.opening.items,opening);assert.equal(s.inventoryCount.eventFlowCloseRecovery,undefined);
  assert.equal(s.inventoryCount.eventFlowReconciliation,undefined);assert.equal(s.eventCloseSummary.openingTotal,6);
  const broken=await snapshot();assert.equal((await finalize(await realFlowAdapter(rt.db,{atomic:false}))).duplicate,true);
  assert.equal(await snapshot(),broken); // PASS means defect reproduced, NOT safe original behavior.
  observations.push({checkpoint:'C05 unsafe original state after failed final write and replay',state:JSON.parse(broken)});
});
test('C06 atomic genuine FlowCompat success and replay preserve all close evidence',async()=>{
  const opening=await prepare(),service=await realFlowAdapter(rt.db);
  await finalize(service);await healthy(opening);const closed=await snapshot();
  assert.equal((await finalize(service)).duplicate,true);assert.equal(await snapshot(),closed);
});
test('C07 atomic post-close failure rolls back session stock lock movements then fresh retry succeeds',async()=>{
  const opening=await prepare(),prior=await snapshot();
  await assert.rejects(finalize(await realFlowAdapter(rt.db,{beforeWrite:n=>{if(n>=2)throw Error('injected-write-failure');}})),/injected-write-failure/);
  assert.equal(await snapshot(),prior);assert.equal((await read(sessionPath)).status,'open');assert.equal(await quantity(),4);
  assert.equal(await read('transactionLocks/eventclose_s'),undefined);
  observations.push({checkpoint:'C07 unchanged after injected failure before retry',state:JSON.parse(await snapshot())});
  await finalize(await realFlowAdapter(rt.db));await healthy(opening);
});
test('C08 atomic real database commit failure rolls back all staged close writes',async()=>{
  const opening=await prepare(),prior=await snapshot();
  // Emulator rejects update of a missing document at commit, after all writes staged.
  const service=await realFlowAdapter(rt.db,{beforeCommit:tx=>tx.update(rt.db.doc('salesSessions/missing-failure-probe'),{probe:true})});
  await assert.rejects(finalize(service),e=>e.code===5);assert.equal(await snapshot(),prior);
  observations.push({checkpoint:'C08 unchanged after Emulator commit rejection before retry',state:JSON.parse(await snapshot())});
  await finalize(await realFlowAdapter(rt.db));await healthy(opening);
});
test('C09 demo boundary rejects other authority outside-opening and retained recovery marker without writes',async()=>{
  const service=await realFlowAdapter(rt.db),prior=await snapshot();
  await assert.rejects(service.finalizeEventSession({sessionId:'other',closedByEmail:'fixture-business@example.test'}),/unsupported-demo-close-authority/);
  await assert.rejects(service.finalizeEventSession({sessionId:'s',closedByEmail:'other@example.test'}),/unsupported-demo-close-authority/);
  assert.equal(await snapshot(),prior);
  await rt.db.doc(sessionPath).update({'inventoryCount.quickAllocations':[{outsideOpening:true}]});
  const outside=await snapshot();await assert.rejects(finalize(service),/outside-opening-not-supported/);assert.equal(await snapshot(),outside);
  await rt.db.doc(sessionPath).update({'inventoryCount.quickAllocations':[],'inventoryCount.eventFlowCloseRecovery':{originalOpeningItems:[]}});
  const recovery=await snapshot();await assert.rejects(finalize(service),/recovery-marker-requires-review/);assert.equal(await snapshot(),recovery);
});

