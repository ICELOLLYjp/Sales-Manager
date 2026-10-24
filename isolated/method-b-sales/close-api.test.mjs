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
import http from 'node:http';
import {closeAPI,closeState,closeStateHash} from './close-api.mjs';
let rt,env,api,url,token,baseline;
const observations=[],tokens={},hooks={};
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
async function assertClosed(sold,movementCount){const s=await read(sessionPath),lock=await read('transactionLocks/eventclose_s');assert.equal(s.status,'closed');assert.equal(s.eventCloseSummary.skuSalesTotal,sold);assert.equal(s.eventCloseSummary.movementCount,movementCount);assert.equal(s.inventoryCount.soldByVariant.t,sold);assert.equal(s.note,'retain');assert.equal(lock.status,'committed');assert.equal(lock.action,'event_close');assert.equal(lock.movementCount,movementCount);}
before(async()=>{
  assertIsolated();rt=runtime();env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8088,rules:await fs.readFile(new URL('./firestore.rules',import.meta.url),'utf8')}});
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`,{method:'DELETE'});
  await rt.auth.createUser({uid:UIDS[0],email:'fixture-business@example.test',emailVerified:true,password:'fixture-only-password'});
  const initialLogin=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'fixture-business@example.test',password:'fixture-only-password',returnSecureToken:true})});assert.equal(initialLogin.status,200);token=(await initialLogin.json()).idToken;
  const client=env.authenticatedContext(UIDS[0],{email_verified:true}).firestore();
  for(const p of [stock,'accessoryStock/shared',sessionPath,'salesTransactions/probe','transactionLocks/probe','inventoryMovements/probe'])await assertFails(web.setDoc(web.doc(client,p),{probe:true}));
  for(const uid of [...UIDS.slice(1),'outsider']){await rt.auth.createUser({uid,email:uid+'@example.test',emailVerified:true,password:'fixture-only-password'});tokens[uid]=await login(uid);}tokens[UIDS[0]]=token;
  rt.voidSales=isolatedVoid(rt,()=>true);rt.closeEvent=closeAPI(rt,hooks);api=server(rt);api.listen(0,'127.0.0.1');await once(api,'listening');url=`http://127.0.0.1:${api.address().port}`;
});
beforeEach(async()=>{
  for(const key of Object.keys(hooks))delete hooks[key];await env.clearFirestore();await rt.db.doc(stock).set({inventoryRevision:0,inventory_v2:{b:{d:{c:{s:{qty:5,note:'retain'},m:{qty:8}}}}},keep:true});
  await rt.db.doc('accessoryStock/shared').set({inventoryRevision:0,designs:[],keep:true});await rt.db.doc(sessionPath).set(session());await rt.db.doc('productVariants/t').set(variant);baseline=JSON.parse(await snapshot());
});
afterEach(async t=>observations.push({case:t.name,before:baseline,after:JSON.parse(await snapshot())}));
after(async()=>{await fs.writeFile(new URL('./artifacts/close-api-observations.json',import.meta.url),JSON.stringify(observations,null,2)+'\n');if(api){api.closeAllConnections();await new Promise(r=>api.close(r));}await env?.cleanup();await rt?.close();});

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
async function login(uid){const r=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:uid+'@example.test',password:'fixture-only-password',returnSecureToken:true})});assert.equal(r.status,200);return (await r.json()).idToken;}
async function request(operationId='close-1'){return {version:1,sessionId:'s',operationId,expectedStateHash:await rt.db.runTransaction(async tx=>closeStateHash(await closeState(tx,rt.db)))};}
async function post(body,{auth=token,endpoint=url,raw}={}){const r=await fetch(endpoint+'/v1/events/close',{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:`Bearer ${auth}`}:{})},body:raw??JSON.stringify(body)});return {status:r.status,body:await r.json()};}
async function good(op,options){const r=await post(op,options);assert.equal(r.status,200,JSON.stringify(r));return r.body;}
async function reject(op,status,options){const before=await snapshot(),r=await post(op,options);assert.equal(r.status,status,JSON.stringify(r));const after=await snapshot();assert.equal(after,before);observations.push({checkpoint:'rejection unchanged',status,error:r.body.error,beforeHash:hash(before),afterHash:hash(after)});}
async function listen(s){s.listen(0,'127.0.0.1');await once(s,'listening');return `http://127.0.0.1:${s.address().port}`;}
async function stop(s){s.closeAllConnections();await new Promise(r=>s.close(r));}

test('H01 three real allowed Auth tokens close atomically with durable actor and identical replay',async()=>{
  const opening=await prepare(),op=await request(),result=await good(op);await healthy(opening);
  assert.equal(result.summary.openingTotal,4);assert.equal(result.summary.flowAdjustedOpeningTotal,6);
  const p=(await read('transactionLocks/eventclose_s')).serverCloseV1;
  assert.equal(p.actorUid,UIDS[0]);assert.equal(p.request.operationId,op.operationId);
  const closed=await snapshot();assert.deepEqual(await good(op),result);assert.equal(await snapshot(),closed);
  for(const uid of UIDS.slice(1)){
    await env.clearFirestore();await rt.db.doc(stock).set({inventoryRevision:0,inventory_v2:{b:{d:{c:{s:{qty:5}}}}}});await rt.db.doc(sessionPath).set(session());await rt.db.doc('productVariants/t').set(variant);
    await count(3,1);const next=await request(uid);await good(next,{auth:tokens[uid]});
    assert.equal((await read(sessionPath)).closedByEmail,uid+'@example.test');assert.equal((await read('transactionLocks/eventclose_s')).serverCloseV1.actorUid,uid);
  }
});
test('H02 missing outsider unverified disabled revoked and invalid signed tokens leave DB unchanged',async()=>{
  await prepare();const op=await request();
  await reject(op,401,{auth:null});await reject(op,401,{auth:'malformed'});await reject(op,403,{auth:tokens.outsider});
  await rt.auth.updateUser(UIDS[2],{emailVerified:false});await reject(op,403,{auth:await login(UIDS[2])});await rt.auth.updateUser(UIDS[2],{emailVerified:true});tokens[UIDS[2]]=await login(UIDS[2]);
  await rt.auth.updateUser(UIDS[1],{disabled:true});await reject(op,401,{auth:tokens[UIDS[1]]});await rt.auth.updateUser(UIDS[1],{disabled:false});
  // Real original token, never rewrite auth_time to manufacture a revocation test.
  const original=await login(UIDS[1]);await new Promise(r=>setTimeout(r,1200));await rt.auth.revokeRefreshTokens(UIDS[1]);await reject(op,401,{auth:original});tokens[UIDS[1]]=await login(UIDS[1]);
  const pieces=token.split('.');assert.equal(JSON.parse(Buffer.from(pieces[0],'base64url')).alg,'none');
  await reject(op,401,{auth:[Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url'),pieces[1],'invalid-signature'].join('.')});
});
test('H03 fixed parser rejects unknown authority flags patches duplicate keys types sizes and UTF8',async()=>{
  await prepare();const op=await request();
  for(const key of ['uid','email','admin','sdk','quantity','patch','atomic','allowUnresolved'])await reject({...op,[key]:true},400);
  for(const delta of [{version:2},{version:'1'},{sessionId:'other'},{operationId:12},{operationId:'x'.repeat(257)},{expectedStateHash:null},{expectedStateHash:'z'.repeat(64)}])await reject({...op,...delta},400);
  for(const raw of ['null','[]','{}','{"version":1',JSON.stringify(op).replace('"version":1','"version":1,"\\u0076ersion":1'),Buffer.from([255])])await reject(null,400,{raw});
  await reject(null,413,{raw:' '.repeat(32769)});
});
test('H04 parallel same operation closes once and returns byte-equivalent saved results',async()=>{
  const opening=await prepare(),op=await request();const results=await Promise.all([good(op),good(op),good(op)]);
  results.forEach(r=>assert.deepEqual(r,results[0]));await healthy(opening);const closed=await snapshot();await good(op);assert.equal(await snapshot(),closed);
});
test('H05 commit response lost through HTTP proxy then API restart replays durable result',async()=>{
  const opening=await prepare(),op=await request();
  const proxy=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const r=await fetch(url+req.url,{method:'POST',headers:{'content-type':'application/json',authorization:req.headers.authorization},body:Buffer.concat(chunks)});assert.equal(r.status,200);await r.text();res.destroy();});
  const endpoint=await listen(proxy);try{await assert.rejects(post(op,{endpoint}));}finally{await stop(proxy);}
  await healthy(opening);const result=(await read('transactionLocks/eventclose_s')).serverCloseV1.result,closed=await snapshot();
  await stop(api);rt.closeEvent=closeAPI(rt,hooks);api=server(rt);url=await listen(api);
  assert.deepEqual(await good(op),result);assert.equal(await snapshot(),closed);
});
test('H06 changed operation intent actor and legacy closed lock are rejected without writes',async()=>{
  await prepare();const op=await request();await good(op);
  await reject({...op,operationId:'different'},409);await reject({...op,expectedStateHash:'a'.repeat(64)},409);await reject(op,409,{auth:tokens[UIDS[1]]});
  const lock=await read('transactionLocks/eventclose_s');delete lock.serverCloseV1;await rt.db.doc('transactionLocks/eventclose_s').set(lock);await reject(op,409);
});
test('H07 stale session sales and inventory revision preflight rejects unchanged close writes',async()=>{
  await prepare();let op=await request();await rt.db.doc(sessionPath).update({note:'changed without timestamps'});await reject(op,409);
  op=await request();await rt.db.doc(stock).update({inventoryRevision:7});await reject(op,409);
  op=await request();await rt.db.doc('salesTransactions/retained').update({note:'changed'});await reject(op,409);
});
test('H08 buffered final-write failure rolls back identity and all business effects then retry succeeds',async()=>{
  const opening=await prepare(),op=await request();hooks.beforeWrite=n=>{if(n>=2)throw Error('injected-final-write-failure');};
  await reject(op,500);assert.equal(await read('transactionLocks/eventclose_s'),undefined);delete hooks.beforeWrite;await good(op);await healthy(opening);
});
test('H09 real Firestore commit rejection rolls back close and operation evidence',async()=>{
  const opening=await prepare(),op=await request();hooks.beforeCommit=tx=>tx.update(rt.db.doc('faultFixture/missing'),{probe:true});
  await reject(op,500);assert.equal(await read('transactionLocks/eventclose_s'),undefined);delete hooks.beforeCommit;await good(op);await healthy(opening);
});
test('H10 unsupported closed recovery outsideOpening Quick accessory later SKU and unidentified sales reject',async()=>{
  await prepare();const original=await read(sessionPath),saleDoc=await read('salesTransactions/retained');
  for(const patch of [{status:'closed'},{'inventoryCount.eventFlowCloseRecovery':{}},{'inventoryCount.quickAllocations':[{outsideOpening:true}]},{'inventoryCount.quickAllocations':[{}]},{'inventoryCount.opening.items':[{...variant,variantId:'t',openingQty:4,category:'pierce',inventorySource:'accessory'}]},{'inventoryCount.flowEntries':[{type:'restock',variantId:'later',quantity:1}]}]){
    await rt.db.doc(sessionPath).set(original);await rt.db.doc(sessionPath).update(patch);await reject(await request(),409);
  }
  await rt.db.doc(sessionPath).set(original);
  for(const patch of [{variantId:null,trackingMode:'quick'},{variantId:'later'},{category:'pierce',inventorySource:'accessory'},{variantId:null,category:'unknown'}]){
    await rt.db.doc('salesTransactions/retained').set({...saleDoc,items:[{...saleDoc.items[0],...patch}]});await reject(await request(),409);
  }
});
test('H11 closed first void rejected while previous void replay stays immutable',async()=>{
  const cancelled=sale('cancelled');await call('commit',cancelled);const saved=await cancel(cancelled);
  await prepare();await good(await request());await assertClosed(1,1);assert.equal(await quantity(),3);assert.equal((await read(stock)).inventoryRevision,4);assert.equal((await rt.db.collection('inventoryMovements').get()).size,4);
  await cancel(sale('retained'),409);const closed=await snapshot();const replay=await cancel(cancelled);assert.deepEqual(replay.result,saved.result);assert.equal(await snapshot(),closed);
});
test('H12 tampered close summary movement and evidence refuse replay without repair',async()=>{
  await prepare();const op=await request();await good(op);const s=await read(sessionPath),m=await read('inventoryMovements/eventclose_s__1__loss');
  await rt.db.doc(sessionPath).update({'eventCloseSummary.openingTotal':999});await reject(op,409);await rt.db.doc(sessionPath).set(s);
  await rt.db.doc('inventoryMovements/eventclose_s__1__loss').update({appliedInventoryDelta:-2});await reject(op,409);await rt.db.doc('inventoryMovements/eventclose_s__1__loss').set(m);
  await rt.db.doc('transactionLocks/eventclose_s').update({'serverCloseV1.result.status':'open'});await reject(op,409);
});
test('H13 competing distinct operation IDs produce one winner and no second close effects',async()=>{
  const opening=await prepare(),op=await request();const results=await Promise.all([post(op),post({...op,operationId:'competitor'})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);await healthy(opening);
  const winner=results.find(r=>r.status===200).body;assert.equal((await read('transactionLocks/eventclose_s')).serverCloseV1.request.operationId,winner.operationId);
});
test('H14 transaction retry rechecks changed preflight and finite abort exhaustion leaves DB unchanged',async()=>{
  await prepare();const op=await request();let attempts=0,changed;
  hooks.beforeAttempt=async n=>{attempts=n;if(n===2){await rt.db.doc(sessionPath).update({note:'changed between aborted attempts'});changed=await snapshot();}};
  hooks.afterReads=()=>{throw Object.assign(Error('injected abort after real reads'),{code:10});};
  const r=await post(op);assert.equal(r.status,409);assert.equal(attempts,2);assert.equal(await snapshot(),changed);assert.equal(await read('transactionLocks/eventclose_s'),undefined);
  hooks.beforeAttempt=n=>{attempts=n;};await reject(await request(),503);assert.equal(attempts,3);
});
