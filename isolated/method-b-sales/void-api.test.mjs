import {isolatedVoid} from './void-runtime.mjs';
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
const voidOp=op=>({version:1,transactionId:op.transactionId,expectedSaleRequestHash:hash(op),reason:'manual_void'});
const cancel=(op,options={})=>good(voidOp(op),{route:'void',...options});
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
    const client=env.authenticatedContext(UIDS[0],{email_verified:true}).firestore();
  for(const p of [stock,acc,sessionPath,'salesTransactions/probe','transactionLocks/probe','inventoryMovements/probe'])await assertFails(web.setDoc(web.doc(client,p),{probe:true}));
  rt.voidSales=isolatedVoid(rt,()=>true,hooks);
  api=server(rt,hooks);url=await listen(api);
});
beforeEach(async()=>{for(const k of Object.keys(hooks))delete hooks[k];await env.clearFirestore();await rt.db.doc(stock).set({inventoryRevision:0,inventory_v2:{b:{d:{c:{s:{qty:5,note:'retain'},m:{qty:8}}}}},createdAt:Timestamp.fromMillis(123),keep:{x:1}});await rt.db.doc(acc).set({inventoryRevision:0,designs:[{id:'a',piercing:5,earring:null},{id:'other',piercing:8}],keep:true});await rt.db.doc(sessionPath).set(session());for(const [id,v]of variants())await rt.db.doc('productVariants/'+id).set(v);caseBefore=JSON.parse(await snapshot());});
afterEach(async t=>{observations.push({case:t.name,before:caseBefore,after:JSON.parse(await snapshot())});});
after(async()=>{await fs.mkdir(new URL('./artifacts/',import.meta.url),{recursive:true});await fs.writeFile(new URL('./artifacts/void-observations.json',import.meta.url),JSON.stringify(observations,null,2));if(api)await close(api);await env?.cleanup();await rt?.close();});

test('V02 multi-source and repeated SKU reversal preserves original evidence and unrelated data',async()=>{
 const op=payload('multi',[row('t','1'),row('t','2',2),row('a','3')]);await good(op);
 const beforeSale=await read('salesTransactions/multi'),beforeLock=await read('transactionLocks/multi');
 const originals=await rt.db.collection('inventoryMovements').get();
 const result=await cancel(op);assert.equal(result.transactionId,'multi');assert.equal(await qty(),5);
 const tshirt=await read(),accessory=await read(acc),s=await read(sessionPath),sale=await read('salesTransactions/multi'),lock=await read('transactionLocks/multi');
 assert.equal(tshirt.inventoryRevision,2);assert.equal(accessory.inventoryRevision,2);assert.equal(tshirt.inventory_v2.b.d.c.m.qty,8);assert.equal(tshirt.inventory_v2.b.d.c.s.note,'retain');assert.equal(tshirt.createdAt.toMillis(),123);
 assert.equal(accessory.designs[0].piercing,5);assert.equal(accessory.designs[0].earring,null);assert.equal(accessory.designs[1].piercing,8);
 assert.equal(s.salesSummary.transactionCount,0);assert.equal(s.salesSummary.itemCount,0);assert.equal(s.salesSummary.netSales,0);assert.equal(s.inventoryCount.soldByVariant.t,0);assert.equal(s.note,'keep');
 assert.equal(sale.status,'voided');assert.deepEqual(sale.items,beforeSale.items);assert.equal(sale.costSnapshotTotalJPY,beforeSale.costSnapshotTotalJPY);assert.equal(sale.netSales,beforeSale.netSales);assert.deepEqual(sale.createdAt,beforeSale.createdAt);
 assert.deepEqual(lock.serverSaleV1,beforeLock.serverSaleV1);assert.equal(lock.fingerprint,beforeLock.fingerprint);assert.equal(lock.serverVoidV1.schema,'void-server-v1');
 for(const d of originals.docs)assert.deepEqual(await read(d.ref.path),d.data());
 assert.equal((await rt.db.collection('inventoryMovements').get()).size,6);
 for(let i=1;i<=3;i++){const m=await read('inventoryMovements/multi__void__'+i);assert.equal(m.reversalOfTransactionId,'multi');assert.equal(m.appliedInventoryDelta,beforeSale.items[i-1].quantity);}
});

test('V01 authorized UIDs, authentication and fixed input schema',async()=>{
 for(let i=0;i<3;i++){const op=payload('uid'+i);await good(op);await cancel(op,{token:tokens[UIDS[i]]});}
 const op=payload('reject');await good(op);
 for(const token of [null,'bad',tokens.outsider])await rejected(voidOp(op),token===tokens.outsider?403:401,{route:'void',token});
 await rt.auth.updateUser(UIDS[2],{emailVerified:false});await rejected(voidOp(op),403,{route:'void',token:await login(UIDS[2])});await rt.auth.updateUser(UIDS[2],{emailVerified:true});
 await rt.auth.updateUser(UIDS[1],{disabled:true});await rejected(voidOp(op),401,{route:'void',token:tokens[UIDS[1]]});await rt.auth.updateUser(UIDS[1],{disabled:false});
 const parts=tokens[UIDS[0]].split('.');const claims={...JSON.parse(Buffer.from(parts[1],'base64url')),auth_time:1};await rt.auth.revokeRefreshTokens(UIDS[0]);
 await rejected(voidOp(op),401,{route:'void',token:[parts[0],Buffer.from(JSON.stringify(claims)).toString('base64url'),parts[2]].join('.')});tokens[UIDS[0]]=await login(UIDS[0]);
 for(const extra of [{patch:{}},{actorUid:UIDS[1]},{serverVoidV1:{}},{quantity:1},{path:stock}])await rejected({...voidOp(op),...extra},400,{route:'void'});
 const raw=JSON.stringify(voidOp(op)).replace('"version":1','"version":1,"version":1');await rejected(null,400,{route:'void',raw});
});

test('V03 serial/parallel replay and lost committed reply survive API restart',async()=>{
 const op=payload();await good(op);await Promise.all([cancel(op),cancel(op),cancel(op)]);const state=await snapshot();await cancel(op);assert.equal(await snapshot(),state);
 await rejected({...voidOp(op),expectedSaleRequestHash:'a'.repeat(64)},409,{route:'void'});
 const lost=payload('lost');await good(lost);
 const proxy=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const r=await fetch(url+req.url,{method:'POST',headers:{'content-type':'application/json',authorization:req.headers.authorization},body:Buffer.concat(chunks)});assert.equal(r.status,200);await r.text();res.destroy();});const endpoint=await listen(proxy);
 try{await assert.rejects(cancel(lost,{endpoint}));}finally{await close(proxy);}
 await close(api);api=server(rt,hooks);url=await listen(api);const saved=await snapshot();await cancel(lost);assert.equal(await snapshot(),saved);assert.equal(await qty(),5);assert.equal((await rt.db.collection('salesTransactions').get()).size,2);assert.equal((await rt.db.collection('inventoryMovements').get()).size,4);
});

test('V04 concurrent sale replay/void then commit/result never resurrect sale',async()=>{
 const op=payload(),original=await good(op);await Promise.all([good(op),cancel(op),good(op)]);
 const state=await snapshot();const replay=await good(op),result=await good({version:1,transactionId:op.transactionId},{route:'result'});
 for(const r of [replay,result]){assert.equal(r.currentSaleStatus,'voided');assert.deepEqual(r.result,original.result);}
 assert.equal(await snapshot(),state);assert.equal(await qty(),5);assert.equal((await rt.db.collection('salesTransactions').get()).size,1);assert.equal((await rt.db.collection('inventoryMovements').get()).size,2);
});

test('V05 bounded retries/exhaustion and concurrent sales preserve effects',async()=>{
 const op=payload();await good(op);const attempts=[];hooks.onAttempt=n=>attempts.push(n);
 hooks.afterReads=({attempts:n})=>{if(n===1)throw Object.assign(Error('injected abort after real reads'),{code:10});};await cancel(op);assert.deepEqual(attempts,[1,2]);
 const exhausted=payload('exhausted');await good(exhausted);attempts.length=0;hooks.afterReads=()=>{throw Object.assign(Error('abort'),{code:10});};await rejected(voidOp(exhausted),503,{route:'void'});assert.deepEqual(attempts,[1,2,3]);delete hooks.afterReads;delete hooks.onAttempt;
 await Promise.all([cancel(exhausted),good(payload('same')),good(payload('other',[row('u')]))]);assert.equal(await qty(),4);assert.equal((await read()).inventory_v2.b.d.c.m.qty,7);assert.equal((await read(sessionPath)).salesSummary.transactionCount,2);
});

test('V06 forged/missing/orphan evidence refuses mutation',async()=>{
 for(const [i,mutate] of [
  async tid=>rt.db.doc('salesTransactions/'+tid).update({status:'voided'}),
  async tid=>rt.db.doc('transactionLocks/'+tid).update({serverSaleV1:FieldValue.delete()}),
  async tid=>rt.db.doc('inventoryMovements/'+tid+'__1').delete(),
  async tid=>rt.db.doc('inventoryMovements/orphan').set({transactionId:'other',reversalOfTransactionId:tid}),
 ].entries()){const op=payload('bad'+i);await good(op);await mutate(op.transactionId);await rejected(voidOp(op),409,{route:'void'});}
 const op=payload('badProof');await good(op);await cancel(op);await rt.db.doc('transactionLocks/badProof').update({'serverVoidV1.actor.email':'forged@example.test'});
 await rejected(voidOp(op),409,{route:'void'});await rejected(op,409);await rejected({version:1,transactionId:'badProof'},409,{route:'result'});
});

test('V07 closed first cancellation rejected; saved cancellation replays after close',async()=>{
 const op=payload();await good(op);await rt.db.doc(sessionPath).update({status:'closed'});await rejected(voidOp(op),409,{route:'void'});
 await rt.db.doc(sessionPath).update({status:'open'});await cancel(op);await rt.db.doc(sessionPath).update({status:'closed'});const state=await snapshot();await cancel(op);assert.equal((await good(op)).currentSaleStatus,'voided');assert.equal(await snapshot(),state);
});

test('V08 real commit failure rolls back all staged writes then retry succeeds',async()=>{
 const op=payload();await good(op);hooks.beforeCommit=({tx,db})=>tx.update(db.doc('faultFixture/missing'),{bad:true});await rejected(voidOp(op),500,{route:'void'});delete hooks.beforeCommit;await cancel(op);assert.equal(await qty(),5);
});

test('V09 inconsistent summary, revision overflow and missing coordinate reject; current catalog ignored',async()=>{
 const op=payload();await good(op);const s=await read(sessionPath),st=await read();
 await rt.db.doc(sessionPath).update({'salesSummary.netSales':0});await rejected(voidOp(op),409,{route:'void'});await rt.db.doc(sessionPath).set(s);
 await rt.db.doc(stock).update({inventoryRevision:Number.MAX_SAFE_INTEGER});await rejected(voidOp(op),409,{route:'void'});await rt.db.doc(stock).set(st);
 await rt.db.doc(stock).update({'inventory_v2.b.d.c.s.qty':Number.MAX_SAFE_INTEGER});await rejected(voidOp(op),409,{route:'void'});await rt.db.doc(stock).set(st);
 await rt.db.doc(stock).update({'inventory_v2.b.d.c.s':FieldValue.delete()});await rejected(voidOp(op),409,{route:'void'});await rt.db.doc(stock).set(st);
 await rt.db.doc('productVariants/t').update({inventoryKey:'tshirt:b|d|c|m',sizeId:'m'});await rt.db.doc(sessionPath).update({'methodBSalesPolicyV1.pricesByVariant.t':9999});await cancel(op);assert.equal(await qty(),5);assert.equal((await read()).inventory_v2.b.d.c.m.qty,8);
});

test('V10 absent cancellation creates no reservation; original ID can later commit and cancel',async()=>{
 const op=payload();const state=await snapshot();assert.equal((await cancel(op)).outcome,'not-found');assert.equal(await snapshot(),state);await good(op);await cancel(op);assert.equal(await qty(),5);assert.equal((await rt.db.collection('salesTransactions').get()).size,1);
});

test('V05b held void overlaps another sale; stale manual edit cannot erase either effect',async()=>{
 const op=payload();await good(op);const baseline=await read();
 let release,entered;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r);
 hooks.afterReads=async()=>{entered();await gate;};
 const pending=rt.voidSales.void(tokens[UIDS[0]],voidOp(op));await ready;
 const concurrent=commitSale(rt.db,actor,payload('concurrent'),{onAttempt:()=>release()});
 await Promise.all([pending,concurrent]);delete hooks.afterReads;
 assert.equal(await qty(),4);assert.equal((await read()).inventoryRevision,3);
 await assert.rejects(editInventory(rt.db,UIDS[0],{version:1,operationId:'manual-stale',stock:'tshirt',sku:{bodyId:'b',designId:'d',colorId:'c',sizeId:'s'},expectedRevision:baseline.inventoryRevision,expectedQuantity:baseline.inventory_v2.b.d.c.s.qty,quantity:9}),{code:'inventory-conflict'});
 const fresh=await read();await editInventory(rt.db,UIDS[0],{version:1,operationId:'manual-fresh',stock:'tshirt',sku:{bodyId:'b',designId:'d',colorId:'c',sizeId:'s'},expectedRevision:fresh.inventoryRevision,expectedQuantity:4,quantity:9});
 await cancel(payload('concurrent'));assert.equal(await qty(),10);assert.equal((await read()).inventoryRevision,5);
 const next=payload('manual-race');await good(next);const before=await read();
 const gate2=new Promise(r=>release=r),ready2=new Promise(r=>entered=r);hooks.afterReads=async()=>{entered();await gate2;};
 const voiding=rt.voidSales.void(tokens[UIDS[0]],voidOp(next));await ready2;
 const manualDb={projectId:rt.db.projectId,doc:p=>rt.db.doc(p),collection:p=>rt.db.collection(p),runTransaction:(fn,opts)=>rt.db.runTransaction(tx=>{release();return fn(tx);},opts)};
 const editing=editInventory(manualDb,UIDS[0],{version:1,operationId:'manual-race',stock:'tshirt',sku:{bodyId:'b',designId:'d',colorId:'c',sizeId:'s'},expectedRevision:before.inventoryRevision,expectedQuantity:9,quantity:20});
 const outcomes=await Promise.allSettled([voiding,editing]);delete hooks.afterReads;assert.equal(outcomes[0].status,'fulfilled');
 if(outcomes[1].status==='fulfilled')assert.equal(await qty(),21);else {assert.equal(outcomes[1].reason.code,'inventory-conflict');assert.equal(await qty(),10);}
});

test('V07b session-close transaction overlaps held void in a legal serial order',async()=>{
 const op=payload();await good(op);const before=JSON.parse(await snapshot());let release,entered;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r);
 hooks.afterReads=async()=>{entered();await gate;};const pending=rt.voidSales.void(tokens[UIDS[0]],voidOp(op));await ready;
 const closing=rt.db.runTransaction(async tx=>{release();const ref=rt.db.doc(sessionPath);await tx.get(ref);tx.update(ref,{status:'closed'});});
 const outcomes=await Promise.allSettled([pending,closing]);delete hooks.afterReads;assert.equal(outcomes[1].status,'fulfilled');assert.equal((await read(sessionPath)).status,'closed');
 if(outcomes[0].status==='fulfilled'){assert.equal(await qty(),5);await cancel(op);}
 else {assert.equal(outcomes[0].reason.code,'session-closed');before[sessionPath].status='closed';assert.deepEqual(JSON.parse(await snapshot()),before);await rejected(voidOp(op),409,{route:'void'});}
});

test('V10b cancellation overlapping in-flight sale leaves one original ID and no reservation',async()=>{
 const op=payload();let release,entered;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r);
 const selling=commitSale(rt.db,actor,op,{afterReads:async()=>{entered();await gate;}});await ready;
 const cancelling=cancel(op);release();await Promise.all([selling,cancelling]);await cancel(op);
 assert.equal(await qty(),5);assert.equal((await rt.db.collection('salesTransactions').get()).size,1);assert.equal((await rt.db.collection('transactionLocks').get()).size,1);assert.equal((await rt.db.collection('inventoryMovements').get()).size,2);
});




