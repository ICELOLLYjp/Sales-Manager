import test,{before,beforeEach,afterEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import {once} from 'node:events';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import * as web from 'firebase/firestore';
import {Timestamp,FieldValue} from 'firebase-admin/firestore';
import {runtime,PROJECT,UIDS,assertIsolated} from './runtime.mjs';
import {server} from './http.mjs';
import {commitSale,contextHash,legacyFingerprint} from './sales.mjs';
import {hash,normalize,parseJSON} from './validation.mjs';
import {editInventory} from './manual-compat.mjs';
let rt,env,api,url,caseBefore;const tokens={},actor={uid:UIDS[0],email_verified:true,email:'fixture-business@example.test'};
const stock='tshirtStock/master',acc='accessoryStock/shared',sessionPath='salesSessions/s';
const hooks={};const observations=[];
const variants=()=>new Map([
 ['t',{active:true,category:'tshirt',inventorySource:'tshirt',inventoryKey:'tshirt:b|d|c|s',bodyId:'b',designId:'d',colorId:'c',sizeId:'s',displayName:'Shirt'}],
 ['u',{active:true,category:'tshirt',inventorySource:'tshirt',inventoryKey:'tshirt:b|d|c|m',bodyId:'b',designId:'d',colorId:'c',sizeId:'m'}],
 ['a',{active:true,category:'pierce',inventorySource:'accessory',inventoryKey:'accessory:a|piercing',designId:'a'}]]);
const session=()=>({status:'open',currency:'JPY',type:'event',methodBSalesPolicyV1:{version:1,currency:'JPY',pricesByVariant:{t:3000,u:3000,a:1000}},inventoryCount:{opening:{items:[{variantId:'t',openingQty:4}]},flowEntries:[],soldByVariant:{}},note:'keep'});
const row=(variantId='t',lineId='line_1',quantity=1)=>({lineId,variantId,quantity,unitPrice:variantId==='a'?1000:3000,setDiscount:0,manualDiscount:0});
const payload=(transactionId='sale_a',items=[row()])=>({version:1,transactionId,sessionId:'s',currency:'JPY',items,orderDiscount:0,paymentMethod:'manual',expectedContextHash:contextHash('s',session(),new Map([...variants()].filter(([id])=>items.some(x=>x.variantId===id))))});
const read=async(path=stock)=>(await rt.db.doc(path).get()).data();
const qty=async()=> (await read()).inventory_v2.b.d.c.s.qty;
async function snapshot(){const out={};for(const c of await rt.db.listCollections()){const docs=await c.get();for(const d of docs.docs)out[d.ref.path]=d.data();}return JSON.stringify(out);}
async function listen(s){s.listen(0,'127.0.0.1');await once(s,'listening');return `http://127.0.0.1:${s.address().port}`;}
async function close(s){s.closeAllConnections();await new Promise(r=>s.close(r));}
async function call(body=payload(),{token=tokens[UIDS[0]],endpoint=url,route='commit',raw}={}){const response=await fetch(`${endpoint}/v1/sales/${route}`,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:raw??JSON.stringify(body)});return {status:response.status,body:await response.json()};}
async function good(body=payload(),options){const r=await call(body,options);assert.equal(r.status,200,JSON.stringify(r));return r.body;}
async function rejected(body,status,options){const before=await snapshot();const r=await call(body,options);assert.equal(r.status,status,JSON.stringify(r));assert.equal(await snapshot(),before);return r;}
async function login(uid){const r=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:`${uid}@example.test`,password:'fixture-only-password',returnSecureToken:true})});assert.equal(r.status,200);return (await r.json()).idToken;}
before(async()=>{assertIsolated();rt=runtime();env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8088,rules:await fs.readFile(new URL('./firestore.rules',import.meta.url),'utf8')}});
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`,{method:'DELETE'});
  for(const uid of [...UIDS,'outsider']){await rt.auth.createUser({uid,email:`${uid}@example.test`,emailVerified:true,password:'fixture-only-password'});tokens[uid]=await login(uid);}
  api=server(rt,hooks);url=await listen(api);
});
beforeEach(async()=>{for(const k of Object.keys(hooks))delete hooks[k];await env.clearFirestore();await rt.db.doc(stock).set({inventoryRevision:0,inventory_v2:{b:{d:{c:{s:{qty:5,note:'retain'},m:{qty:8}}}}},createdAt:Timestamp.fromMillis(123),keep:{x:1}});await rt.db.doc(acc).set({inventoryRevision:0,designs:[{id:'a',piercing:5,earring:null},{id:'other',piercing:8}],keep:true});await rt.db.doc(sessionPath).set(session());for(const [id,v]of variants())await rt.db.doc('productVariants/'+id).set(v);caseBefore=JSON.parse(await snapshot());});
afterEach(async t=>{observations.push({case:t.name,before:caseBefore,after:JSON.parse(await snapshot())});});
after(async()=>{await fs.mkdir(new URL('./artifacts/',import.meta.url),{recursive:true});await fs.writeFile(new URL('./artifacts/observations.json',import.meta.url),JSON.stringify(observations,null,2));if(api)await close(api);await env?.cleanup();await rt?.close();});

test('P01 authentication on commit/result and three equal synthetic UIDs',async()=>{
 for(let i=0;i<3;i++)await good(payload('uid'+i),{token:tokens[UIDS[i]]});
 for(const route of ['commit','result']){const body=route==='commit'?payload('reject'):{version:1,transactionId:'uid0'};for(const token of [null,'malformed',tokens.outsider])await rejected(body,token===tokens.outsider?403:401,{route,token});}
 await rt.auth.updateUser(UIDS[2],{emailVerified:false});await rejected(payload(),403,{token:await login(UIDS[2])});await rt.auth.updateUser(UIDS[2],{emailVerified:true});
 const pieces=tokens[UIDS[0]].split('.');for(const patch of [{exp:1},{aud:'demo-other'},{iss:'https://securetoken.google.com/demo-other'}]){const claims={...JSON.parse(Buffer.from(pieces[1],'base64url')),...patch};await rejected(payload(),401,{token:[pieces[0],Buffer.from(JSON.stringify(claims)).toString('base64url'),pieces[2]].join('.')});}
 await rt.auth.updateUser(UIDS[1],{disabled:true});await rejected(payload(),401,{token:tokens[UIDS[1]]});await rt.auth.updateUser(UIDS[1],{disabled:false});
 await rt.auth.revokeRefreshTokens(UIDS[0]);const claims={...JSON.parse(Buffer.from(pieces[1],'base64url')),auth_time:1};await rejected(payload(),401,{token:[pieces[0],Buffer.from(JSON.stringify(claims)).toString('base64url'),pieces[2]].join('.')});
 tokens[UIDS[0]]=await login(UIDS[0]);
 const offline=server({...rt,auth:{verifyIdToken:async()=>{throw Object.assign(Error(),{code:'auth/internal-error'});}}});const endpoint=await listen(offline);try{await rejected(payload(),503,{endpoint});}finally{await close(offline);}
});
test('P02 Web SDK writes denied across canonical and related documents',async()=>{
 const db=env.authenticatedContext(UIDS[0],{email_verified:true}).firestore();const before=await snapshot();
 for(const path of [stock,acc,sessionPath,'salesTransactions/fake','transactionLocks/fake','inventoryMovements/fake','inventoryWriteReceipts/fake','productVariants/t','products/tshirt','tshirtStock/shared','salesSessions/s/children/x']){
  await rt.db.doc(path).set({keep:'fixture'},{merge:true});const state=await snapshot();await assertFails(web.setDoc(web.doc(db,path),{fake:true}));await assertFails(web.updateDoc(web.doc(db,path),{fake:true}));await assertFails(web.deleteDoc(web.doc(db,path)));await assertFails(web.setDoc(web.doc(db,path+'New'),{fake:true}));assert.equal(await snapshot(),state);
 }assert.equal((await read()).inventory_v2.b.d.c.s.qty,5);assert.ok(before);
});
test('P03 fixed schema rejects malicious payload and duplicate decoded JSON keys',async()=>{
 for(const extra of [{path:'tshirtStock/master'},{patch:{}},{inventory_v2:{}},{receipt:{}},{actorUid:UIDS[1]},{providerPaymentStatus:'paid'}])await rejected({...payload(),...extra},400);
 await rejected({...payload(),items:[{...row(),inventoryKey:'evil'}]},400);
 const raw=JSON.stringify(payload()).replace('"version":1','"version":1,"\\u0076ersion":1');await rejected(null,400,{raw});
 await rejected(null,400,{raw:'{"version":1'});await rejected(null,413,{raw:' '.repeat(32769)});
 await rejected(null,400,{raw:Buffer.from([0xff])});
});
test('P04 IDs, quantities, line count and byte boundaries',async()=>{
 for(const value of ['', ' x','x/','..','__id__','constructor','x'.repeat(257),'あ'.repeat(86)])await rejected({...payload(),transactionId:value},400);
 for(const quantity of [0,-1,1.5,'1',null,1001])await rejected({...payload(),items:[{...row(),quantity}]},400);
 await rejected({...payload(),items:Array.from({length:21},(_,i)=>row('t','l'+i))},400);await rejected({...payload(),items:[row(),row()]},400);
 await rejected({...payload(),items:[{...row(),variantId:'missing'}]},404);
 const op=payload('x'.repeat(256),Array.from({length:20},(_,i)=>row('t','l'+i)));op.items[0].quantity=1000;await good(op);assert.equal(await qty(),5-1019);
 const raw=JSON.stringify(payload('boundary'));await good(null,{raw:raw+' '.repeat(32768-Buffer.byteLength(raw))});
});
test('P05 multiple rows/sources preserve IDs, fields, fingerprint and aggregates',async()=>{
 const op=payload('sale_multi',[row('t','1'),row('t','2',2),row('a','3')]);const r=await good(op);assert.equal(await qty(),2);assert.equal((await read(acc)).designs[0].piercing,4);assert.equal((await read(acc)).designs[0].earring,null);assert.equal((await read()).inventoryRevision,1);assert.equal((await read(acc)).inventoryRevision,1);assert.equal((await read()).inventory_v2.b.d.c.m.qty,8);assert.equal((await read()).createdAt.toMillis(),123);
 const sale=await read('salesTransactions/sale_multi'),lock=await read('transactionLocks/sale_multi'),s=await read(sessionPath);assert.equal(sale.netSales,10000);assert.equal(sale.itemCount,4);assert.equal(s.salesSummary.transactionCount,1);assert.equal(s.inventoryCount.soldByVariant.t,3);assert.equal(lock.fingerprint,JSON.stringify({sessionId:'s',currency:'JPY',discount:0,items:[{category:'tshirt',quantity:1,unitPrice:3000,setDiscount:0,manualDiscount:0,trackingMode:'sku',variantId:'t',tshirtBodyKey:'b'},{category:'tshirt',quantity:2,unitPrice:3000,setDiscount:0,manualDiscount:0,trackingMode:'sku',variantId:'t',tshirtBodyKey:'b'},{category:'pierce',quantity:1,unitPrice:1000,setDiscount:0,manualDiscount:0,trackingMode:'sku',variantId:'a',tshirtBodyKey:null}]}));assert.equal((await rt.db.collection('inventoryMovements').get()).size,3);observations.push({case:'P05',result:r,stock:await read(),session:s});
});
test('P06 identical replay and later stock changes preserve original result',async()=>{
 const op=payload(),first=await good(op);await good(payload('later'));const before=await snapshot();const again=await good(Object.fromEntries(Object.entries(op).reverse()));assert.equal(again.replayed,true);assert.deepEqual(again.result,first.result);assert.equal(await snapshot(),before);
});
test('P07 changed intent including legacy fingerprint omissions is rejected',async()=>{
 await good();for(const op of [{...payload(),items:[{...row(),lineId:'changed'}]},{...payload(),expectedContextHash:'a'.repeat(64)},{...payload(),items:[row('t','line_1',2)]}])await rejected(op,409);
});
test('P08 S02 a/b/a concurrent requests create exactly two sales and decrements',async()=>{
 const attempts=[];hooks.onAttempt=n=>attempts.push(n);const result=await Promise.all([good(payload('a')),good(payload('b')),good(payload('a'))]);assert.equal(await qty(),3);assert.equal((await read()).inventoryRevision,2);assert.equal((await read(sessionPath)).salesSummary.transactionCount,2);assert.equal((await rt.db.collection('salesTransactions').get()).size,2);assert.equal((await rt.db.collection('inventoryMovements').get()).size,2);assert.equal(result.filter(x=>x.replayed).length,1);observations.push({case:'P08',result,attempts,stock:await read(),session:await read(sessionPath)});
});
test('P09 forced retry, finite exhaustion and different SKU concurrency',async()=>{
 const attempts=[];hooks.onAttempt=n=>attempts.push(n);hooks.afterReads=({attempts:n})=>{if(n===1)throw Object.assign(Error('synthetic aborted after real reads'),{code:10});};await good();assert.deepEqual(attempts,[1,2]);
 hooks.afterReads=()=>{throw Object.assign(Error('synthetic aborted after real reads'),{code:10});};attempts.length=0;await rejected(payload('exhaust'),503);assert.deepEqual(attempts,[1,2,3]);delete hooks.afterReads;
 await Promise.all([good(payload('diff1',[row('u')])),good(payload('diff2',[row('a')]))]);assert.equal((await read()).inventory_v2.b.d.c.m.qty,7);assert.equal((await read(acc)).designs[0].piercing,4);observations.push({case:'P09',exhaustedAttempts:attempts.slice(0,3),note:'retry injection after real transaction reads; contention also tested in P08'});
 let release,ready;const held=new Promise(r=>release=r),entered=new Promise(r=>ready=r);const first=commitSale(rt.db,actor,payload('held'),{afterReads:async()=>{ready();await held;}});await entered;
 const second=commitSale(rt.db,actor,payload('contender'),{onAttempt:()=>release()});await Promise.all([first,second]);assert.equal(await qty(),2);
});
test('P10 original manual operation with stale baseline after sales',async()=>{
 // Byte-identical manual algorithm; relative runtime import binds only to this demo.
 assert.equal(await fs.readFile(new URL('./manual-compat.mjs',import.meta.url),'utf8'),await fs.readFile(new URL('../method-b/inventory.mjs',import.meta.url),'utf8'));
 const baseline=await read();await good();assert.equal(baseline.inventoryRevision,0);assert.equal((await read()).inventoryRevision,1);
 const op={version:1,operationId:'manual',stock:'tshirt',sku:{bodyId:'b',designId:'d',colorId:'c',sizeId:'s'},expectedRevision:0,expectedQuantity:5,quantity:9};
 const before=await snapshot();await assert.rejects(editInventory(rt.db,UIDS[0],op),{code:'inventory-conflict'});assert.equal(await snapshot(),before);
 const outcomes=await Promise.allSettled([good(payload('parallel')),editInventory(rt.db,UIDS[0],{...op,expectedRevision:1,expectedQuantity:4})]);assert.equal(outcomes[0].status,'fulfilled');if(outcomes[1].status==='fulfilled')assert.equal(await qty(),8);else{assert.equal(outcomes[1].reason.code,'inventory-conflict');assert.equal(await qty(),3);}observations.push({case:'P10',outcomes:outcomes.map(x=>x.status),quantity:await qty()});
});
test('P11 real committed reply lost through proxy then same-ID retry',async()=>{
 const proxy=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const r=await fetch(url+req.url,{method:'POST',headers:{'content-type':'application/json',authorization:req.headers.authorization},body:Buffer.concat(chunks)});await r.text();res.destroy();});const endpoint=await listen(proxy);
 try{await assert.rejects(call(payload(),{endpoint}));}finally{await close(proxy);}assert.equal(await qty(),4);const before=await snapshot();assert.equal((await good()).replayed,true);assert.equal(await snapshot(),before);
});
test('P12 API stopped before delivery and restarted with durable result',async()=>{
 await close(api);await assert.rejects(call());assert.equal(await qty(),5);api=server(rt,hooks);url=await listen(api);await good();await close(api);api=server(rt,hooks);url=await listen(api);assert.equal((await good()).replayed,true);assert.equal(await qty(),4);
 hooks.afterReads=()=>{throw Object.assign(Error('injected unavailable during transaction'),{code:14});};await rejected(payload('interrupted'),503);delete hooks.afterReads;await good(payload('interrupted'));assert.equal(await qty(),3);
});
test('P13 replay after session close/context change, new sale rejected',async()=>{
 await good();await rt.db.doc(sessionPath).update({status:'closed','methodBSalesPolicyV1.version':2,'methodBSalesPolicyV1.pricesByVariant.t':9000});assert.equal((await good()).replayed,true);await rejected(payload('new'),409);
});
test('P14 real commit failure leaves no partial business writes',async()=>{
 hooks.beforeCommit=({tx,db})=>tx.update(db.doc('faultFixture/nonexistent'),{bad:true});await rejected(payload(),500);delete hooks.beforeCommit;await good();assert.equal(await qty(),4);
});
test('P15 legacy locks/sales/receipt cannot suppress server operation',async()=>{
 for(const data of [{status:'committed'},{fingerprint:legacyFingerprint(payload(),[{...row(),category:'tshirt',tshirtBodyKey:'b'}]),status:'committed'}]){await rt.db.doc('transactionLocks/sale_a').set(data);await rejected(payload(),409);await rt.db.doc('transactionLocks/sale_a').delete();}
 await rt.db.doc('salesTransactions/sale_a').set({status:'completed'});await rejected(payload(),409);await rt.db.doc('salesTransactions/sale_a').delete();
 await rt.db.doc('inventoryWriteReceipts/sale_a').set({schema:'sale-server-v1',result:'forged'});await good();assert.equal(await qty(),4);
});
test('P16 orphan and tampered stored proof rejected without repairs',async()=>{
 await rt.db.doc('inventoryMovements/sale_a__99').set({fake:true});await rejected(payload(),409);await rt.db.doc('inventoryMovements/sale_a__99').delete();await good();
 const original=await read('transactionLocks/sale_a');for(const patch of [{'serverSaleV1.requestHash':'f'.repeat(64)},{'serverSaleV1.result':{}},{'serverSaleV1.effects':{}},{'serverSaleV1.schema':'legacy'}]){await rt.db.doc('transactionLocks/sale_a').update(patch);await rejected(payload(),409);await rt.db.doc('transactionLocks/sale_a').set(original);}
 await rt.db.doc('inventoryMovements/sale_a__1').update({appliedInventoryDelta:-9});await rejected(payload(),409);
});
test('P17 price, policy ABA, unsupported money, negative and unknown stock',async()=>{
 await rejected({...payload(),currency:'USD'},400);await rejected({...payload(),orderDiscount:1},400);await rejected({...payload(),items:[{...row(),unitPrice:1.1}]},400);await rejected({...payload(),items:[{...row(),unitPrice:1}]},409);
 await rt.db.doc(sessionPath).update({'methodBSalesPolicyV1.version':2,'methodBSalesPolicyV1.pricesByVariant.t':4000});await rt.db.doc(sessionPath).update({'methodBSalesPolicyV1.version':3,'methodBSalesPolicyV1.pricesByVariant.t':3000});await rejected(payload(),409);await rt.db.doc(sessionPath).set(session());
 await rt.db.doc('productVariants/t').update({sizeId:'m',inventoryKey:'tshirt:b|d|c|m'});await rejected(payload(),409);await rt.db.doc('productVariants/t').set(variants().get('t'));
 for(const active of [false,'yes',null]){await rt.db.doc('productVariants/t').update({active});await rejected(payload(),409);}await rt.db.doc('productVariants/t').set(variants().get('t'));
 await rt.db.doc(sessionPath).update({'methodBSalesPolicyV1.pricesByVariant.t':1000000});const maxSession=await read(sessionPath),maxOp=payload('max');maxOp.items[0].unitPrice=1000000;maxOp.expectedContextHash=contextHash('s',maxSession,new Map([['t',variants().get('t')]]));await good(maxOp);await rejected({...payload('over'),items:[{...row(),unitPrice:1000001}]},400);await rt.db.doc(sessionPath).set(session());
 await rt.db.doc(stock).update({'inventory_v2.b.d.c.s.qty':null});await rejected(payload(),409);await rt.db.doc(stock).update({'inventory_v2.b.d.c.s.qty':0});const r=await good();assert.equal(await qty(),-1);assert.equal(r.result.inventoryWarnings[0].type,'global_stock_negative');
 await rt.db.doc(stock).update({inventoryRevision:Number.MAX_SAFE_INTEGER});await rejected(payload('overflow'),409);assert.equal((await good()).replayed,true);
});
test('P23 result read-only including missing/inflight/voided/inconsistent',async()=>{
 const query={version:1,transactionId:'sale_a'};const before=await snapshot();assert.equal((await good(query,{route:'result'})).outcome,'not-found');assert.equal(await snapshot(),before);
 let release,ready;const hold=new Promise(r=>release=r),entered=new Promise(r=>ready=r);hooks.afterReads=async()=>{ready();await hold;};const pending=good();await entered;try{assert.equal((await good(query,{route:'result'})).outcome,'not-found');}finally{release();}await pending;delete hooks.afterReads;assert.equal((await good(query,{route:'result'})).outcome,'committed');await rt.db.doc('salesTransactions/sale_a').update({status:'voided'});assert.equal((await good(query,{route:'result'})).outcome,'reconciliation-required');await rejected(payload(),409);
});
test('P24 environment project credential guards and parser depth',async()=>{
 for(const [key,value]of [['FIRESTORE_EMULATOR_HOST','localhost:8088'],['FIREBASE_AUTH_EMULATOR_HOST','127.0.0.1:9098'],['GOOGLE_APPLICATION_CREDENTIALS','fake.json'],['GCLOUD_PROJECT','production']]){const old=process.env[key];process.env[key]=value;try{assert.throws(assertIsolated);}finally{if(old===undefined)delete process.env[key];else process.env[key]=old;}}
 await assert.rejects(commitSale({projectId:'production'},actor,payload()),{code:'wrong-project'});assert.throws(()=>parseJSON('['.repeat(34)+'0'+']'.repeat(34)));assert.throws(()=>normalize({...payload(),items:[]}));
});
