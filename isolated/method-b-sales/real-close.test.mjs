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
import {realCloseAdapter} from './real-close-adapter.mjs';
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
after(async()=>{await fs.writeFile(new URL('./artifacts/real-close-observations.json',import.meta.url),JSON.stringify(observations,null,2)+'\n');if(api){api.closeAllConnections();await new Promise(r=>api.close(r));}await env?.cleanup();await rt?.close();});

test('C01 real finalize: void excluded, retained exact sale not decremented twice, loss and revision applied once',async()=>{
  const voided=sale('voided'),retained=sale('retained');await call('commit',voided);await call('commit',retained);await cancel(voided);assert.equal(await quantity(),4);
  const evidence=await snapshot();await count(2,1);const service=await realCloseAdapter(rt.db);const result=await finalize(service);
  assert.equal(result.duplicate,false);await assertClosed(1,1);assert.equal(await quantity(),3);assert.equal((await read(stock)).inventoryRevision,4);
  const m=await read('inventoryMovements/eventclose_s__1__loss');assert.equal(m.appliedInventoryDelta,-1);assert.equal(m.reason,'loss');assert.equal(m.sourceAction,'event_close');
  const prior=JSON.parse(evidence);for(const [path,value] of Object.entries(prior))if(/^(salesTransactions|inventoryMovements|transactionLocks)\//.test(path))assert.deepEqual(JSON.parse(JSON.stringify(await read(path))),value);
  assert.equal((await read(stock)).inventory_v2.b.d.c.m.qty,8);assert.equal((await read(stock)).inventory_v2.b.d.c.s.note,'retain');
  const closed=await snapshot();assert.equal((await finalize(service)).duplicate,true);assert.equal(await snapshot(),closed);
});

test('C02 real preflight versus void: event-data-changed, no close writes, recount and fresh finalize succeed',async()=>{
  const op=sale('race');await call('commit',op);await count(3);
  let entered,release;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  const service=await realCloseAdapter(rt.db,{beforeTransaction:async()=>{entered();await gate;}});
  const pending=finalize(service);const rejected=assert.rejects(pending,{code:'event-data-changed'});await ready;
  try{await cancel(op);}finally{release();}
  const afterVoid=await snapshot();await rejected;assert.equal(await snapshot(),afterVoid);assert.equal((await rt.db.doc('transactionLocks/eventclose_s').get()).exists,false);
  assert.equal(await quantity(),5);await count(4);await finalize(await realCloseAdapter(rt.db));await assertClosed(0,0);assert.equal(await quantity(),5);assert.equal((await read(stock)).inventoryRevision,2);
});

test('C03 real close complete: first void denied, saved void and commit/result replay immutable',async()=>{
  const voided=sale('done'),retained=sale('live');await call('commit',voided);await call('commit',retained);await cancel(voided);await count(3);
  await finalize(await realCloseAdapter(rt.db));await assertClosed(1,0);assert.equal(await quantity(),4);
  const closed=await snapshot();await cancel(retained,409);assert.equal(await snapshot(),closed);await cancel(voided);assert.equal((await call('commit',voided)).currentSaleStatus,'voided');assert.equal((await call('result',{version:1,transactionId:'done'})).currentSaleStatus,'voided');assert.equal(await snapshot(),closed);
});
