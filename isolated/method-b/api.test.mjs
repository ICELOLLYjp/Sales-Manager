import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { once } from 'node:events';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import * as web from 'firebase/firestore';
import { Timestamp } from 'firebase-admin/firestore';
import { runtime,PROJECT,UIDS,assertIsolated } from './runtime.mjs';
import { server } from './http.mjs';
let rt, env, api, url;
const tokens={};
const stock='tshirtStock/master', accessory='accessoryStock/shared';
const base=()=>({inventoryRevision:0,inventory_v2:{b:{d:{c:{s:{qty:5,note:'retain'},m:{qty:8}}}}},masters:{keep:true},createdAt:Timestamp.fromMillis(123456)});
const acc=()=>({inventoryRevision:0,designs:[{id:'a',name:'A',piercing:5,earring:null},{id:'b',piercing:8,earring:0}],keep:'metadata'});
const payload=(operationId='op',extra={})=>({version:1,operationId,stock:'tshirt',sku:{bodyId:'b',designId:'d',colorId:'c',sizeId:'s'},expectedRevision:0,expectedQuantity:5,quantity:4,...extra});
const read=async(path=stock)=>(await rt.db.doc(path).get()).data();
const qty=async()=> (await read()).inventory_v2.b.d.c.s.qty;
async function listen(s) {s.listen(0,'127.0.0.1'); await once(s,'listening'); return `http://127.0.0.1:${s.address().port}/v1/inventory/manual-edit`;}
async function close(s) {s.closeAllConnections(); await new Promise(r=>s.close(r));}
async function call(body=payload(),token=tokens[UIDS[0]],endpoint=url) {
  const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
}
async function login(uid) {
  const response=await fetch('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-key',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:`${uid}@example.test`,password:'fixture-password-only',returnSecureToken:true})});
  const data=await response.json(); assert.equal(response.status,200); return data.idToken;
}
before(async()=>{
  assertIsolated(); rt=runtime();
  env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8087,rules:await fs.readFile(new URL('./firestore.rules',import.meta.url),'utf8')}});
  await fetch(`http://127.0.0.1:9098/emulator/v1/projects/${PROJECT}/accounts`,{method:'DELETE'});
  for(const uid of [...UIDS,'fixture-outsider']) {
    await rt.auth.createUser({uid,email:`${uid}@example.test`,emailVerified:true,password:'fixture-password-only'});
    tokens[uid]=await login(uid);
  }
  api=server(rt); url=await listen(api);
});
beforeEach(async()=>{await env.clearFirestore();await rt.db.doc(stock).set(base());await rt.db.doc(accessory).set(acc());});
after(async()=>{if(api)await close(api);await env?.cleanup();await rt?.close();});

test('B01 all three verified synthetic UIDs can edit through verified Auth tokens',async()=>{
  for(let i=0;i<UIDS.length;i++) {
    const r=await call(payload(`uid-${i}`,{expectedRevision:i,expectedQuantity:5-i,quantity:4-i}),tokens[UIDS[i]]);
    assert.equal(r.status,200,JSON.stringify(r)); assert.equal(r.body.revision,i+1);
  }
  assert.equal(await qty(),2);
});
test('B02 outsider, unverified, missing and malformed token denied without effects',async()=>{
  assert.equal((await call(payload(),tokens['fixture-outsider'])).status,403);
  await rt.auth.updateUser(UIDS[2],{emailVerified:false});
  try { assert.equal((await call(payload(),await login(UIDS[2]))).status,403); }
  finally {await rt.auth.updateUser(UIDS[2],{emailVerified:true});}
  assert.equal((await call(payload(),null)).status,401);
  assert.equal((await call(payload(),'malformed')).status,401);
  assert.equal(await qty(),5);assert.equal((await rt.db.collection('inventoryWriteReceipts').get()).size,0);
});
test('B03 expired, wrong-project and disabled-user tokens denied',async()=>{
  const original=tokens[UIDS[0]].split('.');
  for(const patch of [{exp:1},{aud:'demo-other-project'},{iss:'https://securetoken.google.com/demo-other-project'}]) {
    const claims={...JSON.parse(Buffer.from(original[1],'base64url')), ...patch};
    const token=[original[0],Buffer.from(JSON.stringify(claims)).toString('base64url'),original[2]].join('.');
    assert.equal((await call(payload(),token)).status,401);
  }
  await rt.auth.updateUser(UIDS[1],{disabled:true});
  try {assert.equal((await call(payload(),tokens[UIDS[1]])).status,401);}
  finally {await rt.auth.updateUser(UIDS[1],{disabled:false});}
  assert.equal(await qty(),5);
});
test('B04 client direct create/update/delete denied across canonical and related paths',async()=>{
  const paths=[stock,accessory,'inventoryWriteReceipts/forged','salesTransactions/x','transactionLocks/x','inventoryMovements/x','salesSessions/x','productVariants/x','products/x','tshirtStock/shared','salesSessions/x/items/y','inventoryWriteReceipts/x/nested/y','other/x'];
  for(const path of paths) if(![stock,accessory].includes(path)) await rt.db.doc(path).set({fixture:true});
  for(const uid of UIDS) {
    const db=env.authenticatedContext(uid,{email_verified:true}).firestore();
    for(const path of paths) {
      const ref=web.doc(db,path);
      await assertFails(web.setDoc(ref,{inventoryRevision:1,inventoryWriteProtocol:1}));
      await assertFails(web.updateDoc(ref,{malicious:true}));
      await assertFails(web.deleteDoc(ref));
    }
    await assertFails(web.setDoc(web.doc(db,'inventoryWriteReceipts/new'),{intent:'a'.repeat(64)}));
  }
  assert.equal(await qty(),5);
});
test('B05 rules reject outsider, unverified and unauthenticated reads and writes',async()=>{
  for(const db of [env.authenticatedContext('fixture-outsider',{email_verified:true}).firestore(),env.authenticatedContext(UIDS[0],{email_verified:false}).firestore(),env.unauthenticatedContext().firestore()]) {
    await assertFails(web.getDoc(web.doc(db,stock))); await assertFails(web.setDoc(web.doc(db,stock),{}));
  }
});
test('B06 entire map, arbitrary path/patch and extra nested fields rejected',async()=>{
  for(const extra of [{inventory_v2:{}},{path:stock},{patch:{inventory_v2:{}}},{sku:{...payload().sku,extra:'x'}},{designs:[]},{actorUid:UIDS[1]},{fingerprint:'fake'}]) {
    assert.equal((await call(payload('bad',extra))).status,400);
  }
  assert.deepEqual(await read(),base()); assert.equal((await rt.db.collection('inventoryWriteReceipts').get()).size,0);
});
test('B07 malformed quantities, revisions, IDs and operation types rejected',async()=>{
  for(const extra of [{quantity:null},{quantity:1.5},{quantity:'4'},{quantity:Number.MAX_SAFE_INTEGER+1},{expectedRevision:-1},{expectedRevision:null},{operationId:'a/b'},{version:2},{stock:'sales'},{sku:{...payload().sku,sizeId:'__proto__'}}]) assert.equal((await call(payload('bad',extra))).status,400);
  assert.equal(await qty(),5);
});
test('B08 known legacy forged receipt cannot suppress edit',async()=>{
  const original=await call();assert.equal(original.status,200);
  await rt.db.doc(stock).set(base());
  // Even a known, matching intent cannot turn a client-era receipt into proof.
  await rt.db.doc('inventoryWriteReceipts/op').set({path:stock,intent:original.body.fingerprint,revision:1,createdAt:Timestamp.now()});
  const r=await call();assert.equal(r.status,409);assert.equal(r.body.error,'operation-id-conflict');assert.equal(await qty(),5);
});
test('B09 replay is once only and different input using same ID is rejected',async()=>{
  const first=await call(), reordered=Object.fromEntries(Object.entries(payload()).reverse());
  reordered.sku=Object.fromEntries(Object.entries(reordered.sku).reverse());
  const second=await call(reordered);
  assert.equal(first.status,200);assert.equal(second.status,200);assert.equal(second.body.replayed,true);
  assert.equal(first.body.fingerprint,second.body.fingerprint);
  assert.equal((await call(payload('op',{quantity:3}))).status,409);
  assert.equal((await read()).inventoryRevision,1);assert.equal(await qty(),4);
});
test('B10 same ID concurrent requests commit one effect and one receipt',async()=>{
  const results=await Promise.all([call(),call(),call()]);
  assert(results.every(r=>r.status===200),JSON.stringify(results));
  assert.equal(results.filter(r=>!r.body.replayed).length,1);assert.equal(await qty(),4);
  assert.equal((await rt.db.collection('inventoryWriteReceipts').get()).size,1);
});
test('B11 same SKU concurrent absolute quantities produce one commit and safe conflict',async()=>{
  const rs=await Promise.all([call(payload('a')),call(payload('b',{quantity:3}))]);
  assert.deepEqual(rs.map(r=>r.status).sort(),[200,409]);assert.equal((await read()).inventoryRevision,1);
  assert.equal(await qty(),rs.find(r=>r.status===200).body.quantity);
});
test('B12 different SKU stale revision safely rejected, no lost unrelated quantity (not C01 both-success)',async()=>{
  const second=payload('m',{sku:{...payload().sku,sizeId:'m'},expectedQuantity:8,quantity:7});
  const rs=await Promise.all([call(payload('s')),call(second)]);
  assert.deepEqual(rs.map(r=>r.status).sort(),[200,409]);
  const data=await read();assert.equal(data.inventoryRevision,1);
  assert.deepEqual([data.inventory_v2.b.d.c.s.qty,data.inventory_v2.b.d.c.m.qty],rs[0].status===200?[4,8]:[5,7]);
});
test('B13 lost HTTP reply after real commit then later edit and replay does not roll back',async()=>{
  const proxy=http.createServer((req,res)=>{
    const upstream=http.request(url,{method:req.method,headers:req.headers},reply=>{reply.resume();reply.on('end',()=>res.destroy());});
    upstream.on('error',()=>res.destroy());req.pipe(upstream);
  });
  const lostUrl=await listen(proxy);
  try {await assert.rejects(call(payload('lost'),tokens[UIDS[0]],lostUrl));}
  finally {await close(proxy);}
  assert.equal(await qty(),4);
  assert.equal((await call(payload('later',{expectedRevision:1,expectedQuantity:4,quantity:3}))).status,200);
  const replay=await call(payload('lost'));assert.equal(replay.status,200);assert.equal(replay.body.quantity,4);assert.equal(replay.body.replayed,true);
  assert.equal(await qty(),3);assert.equal((await read()).inventoryRevision,2);
});
test('B14 non-target SKU, cell metadata, master and Timestamp preserved',async()=>{
  assert.equal((await call()).status,200);const data=await read();
  assert.deepEqual(data.inventory_v2.b.d.c.m,{qty:8});assert.equal(data.inventory_v2.b.d.c.s.note,'retain');
  assert.deepEqual(data.masters,{keep:true});assert.equal(data.createdAt.toMillis(),123456);
});
test('B15 accessory updates by stable ID preserving other records and unknown',async()=>{
  const op=payload('acc',{stock:'accessory',sku:{designId:'a',quantityField:'piercing'},quantity:0});
  assert.equal((await call(op)).status,200);
  assert.deepEqual((await read(accessory)).designs,[{id:'a',name:'A',piercing:0,earring:null},{id:'b',piercing:8,earring:0}]);
  assert.equal((await read(accessory)).keep,'metadata');assert.equal((await call(op)).body.replayed,true);
});
test('B16 null/missing quantity and unregistered SKU refused without converting to zero',async()=>{
  const op=payload('unknown',{stock:'accessory',sku:{designId:'a',quantityField:'earring'},expectedQuantity:0,quantity:1});
  assert.equal((await call(op)).status,409);
  assert.equal((await call(payload('missing',{sku:{...payload().sku,sizeId:'missing'}}))).status,404);
  const b=base();delete b.inventory_v2.b.d.c.s.qty;await rt.db.doc(stock).set(b);
  assert.equal((await call()).status,409);assert.deepEqual(await read(),b);
});
test('B17 zero and negative integers retained, missing revision migrates once',async()=>{
  const b=base();delete b.inventoryRevision;await rt.db.doc(stock).set(b);
  assert.equal((await call(payload('zero',{quantity:0}))).status,200);
  assert.equal((await call(payload('negative',{expectedRevision:1,expectedQuantity:0,quantity:-1}))).status,200);
  assert.equal(await qty(),-1);assert.equal((await read()).inventoryRevision,2);
});
test('B18 malformed stored revision and absent canonical reject without receipt',async()=>{
  for(const inventoryRevision of [null,-1,1.5,'0',Number.MAX_SAFE_INTEGER]) {
    await rt.db.doc(stock).set({...base(),inventoryRevision});assert.equal((await call()).status,409);
  }
  await rt.db.doc(stock).delete();assert.equal((await call()).status,404);
  assert.equal((await rt.db.collection('inventoryWriteReceipts').get()).size,0);
});
test('B19 real commit failure leaves neither inventory change nor receipt',async()=>{
  // Inject one invalid write into the REAL Admin transaction, not a mock commit.
  const failing={projectId:rt.db.projectId,doc:rt.db.doc.bind(rt.db),collection:rt.db.collection.bind(rt.db),runTransaction:(cb,opts)=>rt.db.runTransaction(tx=>cb(new Proxy(tx,{get(target,key){
    if(key==='create')return (...args)=>{target.create(...args);target.update(rt.db.doc('fault/missing'),{invalid:true});return target;};
    const v=target[key];return typeof v==='function'?v.bind(target):v;
  }})),opts)};
  const endpointServer=server({db:failing,auth:rt.auth}), endpoint=await listen(endpointServer);
  try {assert.equal((await call(payload(),tokens[UIDS[0]],endpoint)).status,500);}
  finally {await close(endpointServer);}
  assert.deepEqual(await read(),base());assert.equal((await rt.db.doc('inventoryWriteReceipts/op').get()).exists,false);
});
test('B20 expected quantity mismatch and ABA revision mismatch safely rejected',async()=>{
  assert.equal((await call(payload('wrong',{expectedQuantity:6}))).status,409);
  await call(payload('a'));await call(payload('b',{expectedRevision:1,expectedQuantity:4,quantity:5}));
  assert.equal((await call(payload('stale'))).status,409);assert.equal(await qty(),5);assert.equal((await read()).inventoryRevision,2);
});
test('B21 receipt evidence matches atomic effect and malformed server receipt fails closed',async()=>{
  const result=await call();assert.equal(result.status,200);
  const ref=rt.db.doc('inventoryWriteReceipts/op'),receipt=(await ref.get()).data();
  assert.equal(receipt.intent,result.body.fingerprint);assert.equal(receipt.beforeRevision,0);assert.equal(receipt.revision,1);
  assert.equal(receipt.operation.expectedQuantity,5);assert.equal(receipt.result.quantity,4);assert.equal(receipt.actorUid,UIDS[0]);assert(receipt.createdAt instanceof Timestamp);
  await ref.update({'result.quantity':999});assert.equal((await call()).status,409);assert.equal(await qty(),4);
});
test('B22 duplicate accessory IDs refused and SKU keys containing dot are not treated as paths',async()=>{
  await rt.db.doc(accessory).set({designs:[{id:'a',piercing:5},{id:'a',piercing:9}]});
  assert.equal((await call(payload('dup',{stock:'accessory',sku:{designId:'a',quantityField:'piercing'}}))).status,409);
  const b=base();b.inventory_v2.b.d.c['s.dot']={qty:2};await rt.db.doc(stock).set(b);
  assert.equal((await call(payload('dot',{sku:{...payload().sku,sizeId:'s.dot'},expectedQuantity:2,quantity:1}))).status,200);
  assert.equal((await read()).inventory_v2.b.d.c['s.dot'].qty,1);assert.equal(await qty(),5);
});
test('B23 anonymous Auth token and revoked ID token rejected',async()=>{
  const response=await fetch('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-key',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({returnSecureToken:true})});
  const anonymous=await response.json();assert.equal(response.status,200);
  assert.equal((await call(payload(),anonymous.idToken)).status,403);
  // Tokens were issued >1s ago in setup; revocation checks real emulator state.
  await rt.auth.revokeRefreshTokens(UIDS[2]);
  assert.equal((await call(payload(),tokens[UIDS[2]])).status,401);
  assert.equal(await qty(),5);
});
test('B24 isolation guards fail closed before production access',()=>{
  for(const [name,value] of [['FIRESTORE_EMULATOR_HOST','example.invalid:8080'],['FIREBASE_AUTH_EMULATOR_HOST',''],['GOOGLE_APPLICATION_CREDENTIALS','fixture-not-a-real-file']]) {
    const previous=process.env[name];process.env[name]=value;
    try {assert.throws(assertIsolated,/Only fixed loopback/);}
    finally {if(previous===undefined)delete process.env[name];else process.env[name]=previous;}
  }
});
test('B25 final safe revision remains replayable but cannot overflow',async()=>{
  await rt.db.doc(stock).set({...base(),inventoryRevision:Number.MAX_SAFE_INTEGER-1});
  const op=payload('terminal',{expectedRevision:Number.MAX_SAFE_INTEGER-1});
  assert.equal((await call(op)).status,200);
  const replay=await call(op);assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);
  assert.equal((await read()).inventoryRevision,Number.MAX_SAFE_INTEGER);
  assert.equal((await call(payload('overflow',{expectedRevision:Number.MAX_SAFE_INTEGER,expectedQuantity:4,quantity:3}))).status,400);
  assert.equal(await qty(),4);
});
