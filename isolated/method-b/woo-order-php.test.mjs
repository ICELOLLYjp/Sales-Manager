import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {Timestamp} from 'firebase-admin/firestore';
import {runtime,PROJECT} from './runtime.mjs';
import {hash} from './inventory.mjs';
import {createWooOrderBridge,ORDER_ACTOR} from './woo-order.mjs';
import {createPhpOrderReader} from './woo-order-php-reader.mjs';
let rt,env,token,fixture,loc,read,bridge;
const key='fixture-order-signing-key-not-for-production';
const php=(...args)=>JSON.parse(execFileSync(process.execPath,[process.env.WOO_ORDER_RUNNER,...args],{env:process.env,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:131072}));
const change=kind=>php('mutate',kind,String(loc.orderId));
const make=(reader=read,runtime=rt)=>createWooOrderBridge(runtime,{sites:{'fixture-site-a':{key,keyId:'fixture-v1',read:reader}}});
const call=()=>bridge.hold(token,loc);
const a=()=>rt.db.doc('accessoryStock/shared'),t=()=>rt.db.doc('tshirtStock/master');
before(async()=>{
  rt=runtime();env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8087,rules:await fs.readFile(new URL('./firestore.rules',import.meta.url),'utf8')}});
  await fetch(`http://127.0.0.1:9098/emulator/v1/projects/${PROJECT}/accounts`,{method:'DELETE'});
  await rt.auth.createUser({uid:ORDER_ACTOR,email:'order@example.test',emailVerified:true,password:'fixture-password'});
  await rt.auth.setCustomUserClaims(ORDER_ACTOR,{inventoryProducer:'ec'});
  const r=await fetch('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'order@example.test',password:'fixture-password',returnSecureToken:true})});
  assert.equal(r.status,200);token=(await r.json()).idToken;
  read=createPhpOrderReader({runner:process.env.WOO_ORDER_RUNNER,php:process.env.WOO_PHP_BIN,wpRoot:process.env.WOO_WP_ROOT,fixtureRuntime:process.env.WOO_FIXTURE_RUNTIME});
});
beforeEach(async()=>{
  await env.clearFirestore();fixture=php('setup');loc={siteId:'fixture-site-a',orderId:fixture.id};
  const proof=await read({...loc,challenge:'a'.repeat(32)});const body=JSON.parse(Buffer.from(proof.payload,'base64'));
  assert.equal(body.lines.length,3);const as=body.lines[0].sku,ts=body.lines[1].sku;
  const ledger={schema:'inventory-reservations-v1',complete:true,entries:[]};
  await a().set({inventoryRevision:0,inventoryReservations:ledger,designs:[{id:as.designId,earring:7,piercing:0}]});
  await t().set({inventoryRevision:0,inventoryReservations:ledger,inventory_v2:{[ts.bodyId]:{[ts.designId]:{[ts.colorId]:{[ts.sizeId]:{qty:7}}}}}});
  for(const [s,ref]of [['accessory',a()],['tshirt',t()]])await rt.db.doc(`inventoryReservationAuthorities/${s}`).set({schema:'reservation-authority-v1',path:ref.path,ledgerHash:hash(ledger),ecComplete:true,eventComplete:true,reconciliationId:'synthetic-only',reconciledAt:Timestamp.now()});
  await rt.db.doc('inventoryWooPurchaseGate/current').set({schema:'woo-purchase-gate-v1',stopped:false});bridge=make();
});
after(async()=>{await env?.cleanup();await rt?.close();});
async function empty(){for(const ref of [a(),t()])assert.equal((await ref.get()).data().inventoryRevision,0);assert.equal((await rt.db.doc(`inventoryWriteReceipts/woo-order-${hash(loc)}`).get()).exists,false);}
async function held(){assert.equal((await a().get()).data().inventoryReservations.entries.length,2);assert.equal((await t().get()).data().inventoryReservations.entries.length,1);for(const ref of [a(),t()])assert.equal((await ref.get()).data().inventoryRevision,1);}
test('H01 actual PHP HPOS proof -> authenticated Node -> mixed atomic hold and same SKU two rows',async()=>{const r=await call();assert.equal(r.state,'held_review_required');for(const flag of ['purchaseAuthorized','paymentAuthorized','reservationConfirmed'])assert.equal(r[flag],false);await held();assert.equal((await call()).result.replayed,true);await held();});
for(const kind of ['add','delete','quantity','aba','mapping'])test(`H change ${kind} after commit retains original holds and latches review`,async()=>{await call();change(kind);await assert.rejects(call());assert.equal((await bridge.lookup(token,loc)).state,'review_required');await held();});
test('H07 HPOS postflight ABA retains holds and latches review',async()=>{let n=0;bridge=make(async l=>{if(++n===2)change('aba');return read(l);});assert.equal((await call()).state,'review_required');await held();});
test('H08 consumed PHP proof challenge replay rejected',async()=>{const proof=await read({...loc,challenge:'a'.repeat(32)});bridge=make(async()=>proof);await assert.rejects(call());await empty();});
test('H09 cross-site PHP proof rejected by bridge',async()=>{bridge=createWooOrderBridge(rt,{sites:{'fixture-site-b':{key,keyId:'fixture-v1',read:l=>read({...l,siteId:'fixture-site-a'})}}});await assert.rejects(bridge.hold(token,{...loc,siteId:'fixture-site-b'}));await empty();});
test('H10 response loss after Firestore commit recovers persistent operation/receipt via lookup',async()=>{let n=0;const proxy={...rt,db:{projectId:PROJECT,doc:p=>rt.db.doc(p),collection:p=>rt.db.collection(p),runTransaction:async(...args)=>{const r=await rt.db.runTransaction(...args);if(++n===2)throw Error('response-lost');return r;}}};bridge=make(read,proxy);await assert.rejects(call(),/response-lost/);bridge=make();const r=await bridge.lookup(token,loc);assert.equal(r.result.operationId,`woo-order-${hash(loc)}`);assert.equal((await call()).result.replayed,true);await held();});
test('H11 prior single-line fence prevents PHP order hold',async()=>{await rt.db.doc(`inventoryWooOrderFences/${hash(loc)}`).set({mode:'line'});await assert.rejects(call(),{code:'woo-order-mode-conflict'});await empty();});
test('H12 Firestore stop denies PHP proof with no partial writes',async()=>{await rt.db.doc('inventoryWooPurchaseGate/current').update({stopped:true});await assert.rejects(call(),{code:'purchases-stopped'});await empty();});
test('H13 saved Woo copy policy stop denies entire order',async()=>{change('stop');await assert.rejects(call());await empty();});
test('H14 server reader rejects request-supplied plan overrides and foreign site',async()=>{for(const patch of [{quantity:9},{sku:'forged'},{operationId:'forged'},{siteId:'fixture-site-b'},{challenge:'bad'}])await assert.rejects(read({...loc,challenge:'a'.repeat(32),...patch}),/invalid-php-order-locator/);await empty();});
