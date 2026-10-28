import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHmac} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import * as web from 'firebase/firestore';
import {Timestamp} from 'firebase-admin/firestore';
import {runtime,PROJECT,UIDS} from './runtime.mjs';
import {hash,editInventory} from './inventory.mjs';
import {produceReservation,PRODUCERS} from './reservations.mjs';
import {createWooBridge} from './woo-bridge.mjs';
import {WOO_ACTOR,wooSource,wooKey} from './woo-proof.mjs';
let rt,env,bridge,body,token,operator,legacy,reads,reader,currentChallenge;
const key='fixture-woo-signing-key-not-for-production';
const signed=e=>{const payload=Buffer.from(JSON.stringify({...e,challenge:currentChallenge})).toString('base64');return {keyId:'fixture-v1',payload,signature:createHmac('sha256',key).update(payload).digest('hex')};};
const loc=()=>({siteId:body.siteId,orderId:body.orderId,lineItemId:body.lineItemId});
const ref=()=>rt.db.doc(`inventoryWooIntents/${wooKey(wooSource(body))}`);
const stock=()=>rt.db.doc('accessoryStock/shared');
const call=()=>bridge.hold(token,loc());
const lookup=()=>bridge.lookup(token,loc());
async function login(uid,kind) {
  await rt.auth.createUser({uid,email:`${uid}@example.test`,emailVerified:true,password:'fixture-password-only'});
  if(kind) await rt.auth.setCustomUserClaims(uid,{inventoryProducer:kind});
  const r=await fetch('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:`${uid}@example.test`,password:'fixture-password-only',returnSecureToken:true})});
  assert.equal(r.status,200);return (await r.json()).idToken;
}
before(async()=>{
  rt=runtime();env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8087,rules:await fs.readFile(new URL('./firestore.rules',import.meta.url),'utf8')}});
  await fetch(`http://127.0.0.1:9098/emulator/v1/projects/${PROJECT}/accounts`,{method:'DELETE'});
  token=await login(WOO_ACTOR,'ec');operator=await login(UIDS[0]);legacy=await login(PRODUCERS.ec,'ec');
});
beforeEach(async()=>{
  await env.clearFirestore();reads=0;
  const phpEnvelope=JSON.parse(await fs.readFile(process.env.WOO_FIXTURE_PATH || new URL('../../../php-runtime/woo-envelope.json',import.meta.url),'utf8'));
  body=JSON.parse(Buffer.from(phpEnvelope.payload,'base64').toString('utf8'));
  reader=async()=>signed(body);
  bridge=createWooBridge(rt,{clock:()=>body.issuedAt,sites:{[body.siteId]:{key,keyId:'fixture-v1',read:async l=>{reads++;currentChallenge=l.challenge;return reader(l);}}}});
  const ledger={schema:'inventory-reservations-v1',complete:true,entries:[]};
  await stock().set({inventoryRevision:0,inventoryReservationAuthority:1,inventoryReservations:ledger,designs:[{id:body.sku.designId,piercing:7,earring:7}]});
  await rt.db.doc('inventoryReservationAuthorities/accessory').set({schema:'reservation-authority-v1',path:'accessoryStock/shared',ledgerHash:hash(ledger),ecComplete:true,eventComplete:true,reconciliationId:'synthetic-only',reconciledAt:Timestamp.now()});
});
after(async()=>{await env?.cleanup();await rt?.close();});
test('W01 actual PHP/HPOS signed evidence reaches canonical producer; lookup is readonly',async()=>{
  const read=async l=>{
    const {stdout}=await promisify(execFile)(process.execPath,[process.env.WOO_PHP_RUNNER || fileURLToPath(new URL('../../../run-php.cjs',import.meta.url)),'emit',l.challenge,String(l.orderId),String(l.lineItemId)],{windowsHide:true,timeout:30000});
    return JSON.parse(stdout);
  };
  bridge=createWooBridge(rt,{sites:{[body.siteId]:{key,keyId:'fixture-v1',read}}});
  const r=await call();assert.equal(r.state,'held_review_required');assert.equal(r.result.ledger.entries[0].quantity,body.quantity);
  for(const k of ['purchaseAuthorized','paymentAuthorized','reservationConfirmed']) assert.equal(r[k],false);
  const before=await stock().get();const x=await lookup();assert.equal(x.result.replayed,true);assert.equal((await stock().get()).updateTime.isEqual(before.updateTime),true);
  assert.equal(before.data().designs[0].earring,7);assert.equal(before.data().inventoryRevision,1);
});
test('W02 duplicate notifications and lost response/restart have one effect',async()=>{
  await Promise.all([call(),call(),call()]);await rt.close();rt=runtime();
  bridge=createWooBridge(rt,{clock:()=>body.issuedAt,sites:{[body.siteId]:{key,keyId:'fixture-v1',read:l=>{currentChallenge=l.challenge;return signed(body);}}}});
  assert.equal((await call()).result.replayed,true);assert.equal((await stock().get()).data().inventoryRevision,1);
});
test('W03 client cannot provide operation ID, SKU, quantity, status or envelope',async()=>{
  for(const extra of [{operationId:'new'},{quantity:2},{sku:body.sku},{status:'pending'},{payload:'x'}]) await assert.rejects(bridge.hold(token,{...loc(),...extra}),{code:'invalid-woo-locator'});
  assert.equal(reads,0);assert.equal((await stock().get()).data().inventoryRevision,0);
});
test('W04 signature/site/key and order/line substitution rejected',async()=>{
  for(const changed of [{siteId:'fixture-site-b'},{orderId:body.orderId+1},{lineItemId:body.lineItemId+1},{wooSku:''},{quantity:0}]) {
    reader=()=>signed({...body,...changed});await assert.rejects(call());
  }
  reader=()=>({...signed(body),signature:'a'.repeat(64)});await assert.rejects(call(),{code:'invalid-woo-signature'});
  reader=()=>({...signed(body),keyId:'unknown'});await assert.rejects(call(),{code:'invalid-woo-signature'});
  assert.equal((await stock().get()).data().inventoryRevision,0);
});
test('W05 expired/future evidence, paid/cancelled/refunded/delayed status cannot hold',async()=>{
  for(const patch of [{expiresAt:body.issuedAt},{issuedAt:body.issuedAt+1},{status:'processing'},{status:'cancelled'},{status:'refunded'},{status:'failed'},{status:'on-hold'},{paid:true},{refunded:'1.00'},{singleLine:false},{active:false},{revision:0}]) {
    reader=()=>signed({...body,...patch});await assert.rejects(call());
  }
  assert.equal((await stock().get()).data().inventoryRevision,0);
});
test('W06 postflight cancellation retains hold and latches review',async()=>{
  reader=()=>signed({...body,...(reads>1?{status:'cancelled',revision:body.revision+1}:{})});
  const r=await call();assert.equal(r.state,'review_required');assert.equal(r.result.revision,1);
  reader=()=>signed(body);await assert.rejects(call(),{code:'woo-review-required'});assert.equal((await lookup()).state,'review_required');
});
test('W07 ABA with identical contents and newer durable source revision stops retry',async()=>{
  await call();reader=()=>signed({...body,revision:body.revision+2});await assert.rejects(call(),{code:'woo-review-required'});
  assert.equal((await stock().get()).data().inventoryRevision,1);
});
test('W08 changed quantity, SKU or product evidence cannot rebind source',async()=>{
  await call();reader=()=>signed({...body,quantity:2});await assert.rejects(call(),{code:'woo-review-required'});
  reader=()=>signed({...body,sku:{...body.sku,designId:'other'},productDigest:'a'.repeat(64)});await assert.rejects(call(),{code:'woo-review-required'});
});
test('W09 postflight transport loss preserves receipt; lookup does not fetch Woo or write',async()=>{
  reader=()=>{if(reads>1)throw Error('lost Woo reply');return signed(body);};
  assert.equal((await call()).state,'review_required');const n=reads;assert.equal((await lookup()).result.revision,1);assert.equal(reads,n);
});
test('W10 browser, generic EC and disabled service identities cannot enter bridge',async()=>{
  for(const t of [operator,legacy,'invalid']) await assert.rejects(bridge.hold(t,loc()));
  await rt.auth.updateUser(WOO_ACTOR,{disabled:true});try{await assert.rejects(call(),{code:'unauthenticated'});}finally{await rt.auth.updateUser(WOO_ACTOR,{disabled:false});}
  assert.equal(reads,0);
});
test('W11 missing checkpoint and stock CAS conflicts never silently replan',async()=>{
  await rt.db.doc('inventoryReservationAuthorities/accessory').delete();await assert.rejects(call(),{code:'reservation-authority-required'});
  assert.equal((await ref().get()).data().state,'review_required');assert.equal((await lookup()).result.status,'unknown');
});
test('W12 producer requires journal proof, rejects confirm/release and generic actor bypass',async()=>{
  await call();const op=(await ref().get()).data().operation;
  for(const action of ['confirm','release']) await assert.rejects(produceReservation(rt,token,{...op,action,operationId:'other'}),{code:'forbidden'});
  await assert.rejects(produceReservation(rt,legacy,op),{code:'forbidden'});
  await rt.db.doc(`inventoryWriteReceipts/${op.operationId}`).delete();await ref().delete();
  await assert.rejects(produceReservation(rt,token,{...op,expectedRevision:1}),{code:'woo-review-required'});
});
test('W13 forged historical proof fails closed',async()=>{
  await call();const op=(await ref().get()).data().operation;await rt.db.doc(`inventoryWriteReceipts/${op.operationId}`).update({'wooProof.evidence.quantity':99});
  await assert.rejects(lookup(),{code:'operation-id-conflict'});
});
test('W14 direct browser journal/evidence/receipt writes denied',async()=>{
  const db=env.authenticatedContext(UIDS[0],{email_verified:true}).firestore();
  for(const p of [ref().path,'inventoryWriteReceipts/woo-fake','inventoryCommitmentSources/fake']) await assertFails(web.setDoc(web.doc(db,p),{state:'observed',evidence:body}));
});
test('W15 stock floor remains atomic with a concurrent manual count',async()=>{
  const manual=()=>editInventory(rt.db,UIDS[0],{version:1,operationId:'manual-race',stock:'accessory',sku:body.sku,expectedRevision:0,expectedQuantity:7,quantity:0});
  const results=await Promise.allSettled([call(),manual()]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const s=(await stock().get()).data();assert.ok(s.designs[0].earring>=s.inventoryReservations.entries.reduce((n,e)=>n+e.quantity,0));
});
test('W16 unknown lookup creates no journal or receipt',async()=>{
  assert.equal((await lookup()).state,'unknown');assert.equal(reads,0);assert.equal((await ref().get()).exists,false);
});
test('W17 previously valid signed reply cannot answer a fresh server challenge',async()=>{
  let saved;reader=()=>{if(!saved)saved=signed(body);return saved;};
  assert.equal((await call()).state,'review_required');assert.equal((await stock().get()).data().inventoryRevision,1);
});
test('W18 failure after durable intent but before producer keeps exact operation for retry',async()=>{
  let transactions=0;
  const db={projectId:PROJECT,doc:p=>rt.db.doc(p),runTransaction:async(...args)=>{if(++transactions===2)throw Error('transport-before-commit');return rt.db.runTransaction(...args);}};
  const injected=createWooBridge({...rt,db},{clock:()=>body.issuedAt,sites:{[body.siteId]:{key,keyId:'fixture-v1',read:l=>{currentChallenge=l.challenge;return signed(body);}}}});
  await assert.rejects(injected.hold(token,loc()),/transport-before-commit/);
  const pinned=(await ref().get()).data().operation;assert.equal((await lookup()).result.status,'unknown');
  await call();assert.deepEqual((await ref().get()).data().operation,pinned);assert.equal((await stock().get()).data().inventoryRevision,1);
});
test('W19 producer commit then lost acknowledgement is recovered without new write',async()=>{
  let transactions=0;
  const db={projectId:PROJECT,doc:p=>rt.db.doc(p),runTransaction:async(...args)=>{const n=++transactions;const r=await rt.db.runTransaction(...args);if(n===2)throw Error('lost-commit-reply');return r;}};
  const injected=createWooBridge({...rt,db},{clock:()=>body.issuedAt,sites:{[body.siteId]:{key,keyId:'fixture-v1',read:l=>{currentChallenge=l.challenge;return signed(body);}}}});
  await assert.rejects(injected.hold(token,loc()),/lost-commit-reply/);const before=await stock().get();
  assert.equal((await lookup()).result.revision,1);await call();assert.equal((await stock().get()).updateTime.isEqual(before.updateTime),true);
});
test('W20 persisted intent never adopts a newer inventory revision automatically',async()=>{
  let transactions=0;
  const db={projectId:PROJECT,doc:p=>rt.db.doc(p),runTransaction:async(...args)=>{if(++transactions===2)throw Error('pause');return rt.db.runTransaction(...args);}};
  const injected=createWooBridge({...rt,db},{clock:()=>body.issuedAt,sites:{[body.siteId]:{key,keyId:'fixture-v1',read:l=>{currentChallenge=l.challenge;return signed(body);}}}});
  await assert.rejects(injected.hold(token,loc()),/pause/);
  await editInventory(rt.db,UIDS[0],{version:1,operationId:'manual-after-intent',stock:'accessory',sku:body.sku,expectedRevision:0,expectedQuantity:7,quantity:6});
  await assert.rejects(call(),{code:'inventory-conflict'});assert.equal((await ref().get()).data().state,'review_required');
  assert.equal((await stock().get()).data().inventoryReservations.entries.length,0);
});
