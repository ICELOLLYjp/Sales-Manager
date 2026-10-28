import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { ApiError, hash, revision, target } from './inventory.mjs';
import { normalizeReservation, produceReservation } from './reservations.mjs';
import { assertIsolated, PROJECT } from './runtime.mjs';
import { WOO_ACTOR, wooSource, wooKey } from './woo-proof.mjs';
const fail=code=>{throw new ApiError(409,code);};
const exact=(x,keys)=>x && Object.getPrototypeOf(x)===Object.prototype && Object.keys(x).sort().join(',')===[...keys].sort().join(',');
const fields=['schema','siteId','orderId','lineItemId','revision','orderDigest','productDigest','status','paid','refunded','singleLine','active','productId','variationId','wooSku','quantity','stock','sku','issuedAt','expiresAt','challenge'];
// Server composition only: never populate sites/key/read/clock from an HTTP body.
// read(locator) must fetch fresh evidence from the configured server, not webhook data.
export function createWooBridge(rt,{sites,clock=()=>Math.floor(Date.now()/1000)}) {
  assertIsolated(); if(rt.db.projectId!==PROJECT) fail('wrong-project');
  const config=new Map(Object.entries(sites).map(([site,c])=>{
    if(!/^fixture-site-[ab]$/.test(site) || typeof c.key!=='string' || c.key.length<32 || typeof c.read!=='function' || c.keyId!=='fixture-v1') fail('invalid-woo-server-config');
    return [site,{...c}];
  }));
  async function auth(token) {
    let c;try {c=await rt.auth.verifyIdToken(token,true);} catch {throw new ApiError(401,'unauthenticated');}
    if(c.uid!==WOO_ACTOR || c.inventoryProducer!=='ec' || c.email_verified!==true) throw new ApiError(403,'forbidden');
  }
  function locate(x) {
    if(!exact(x,['siteId','orderId','lineItemId']) || !config.has(x.siteId)
      || !Number.isSafeInteger(x.orderId) || x.orderId<1 || !Number.isSafeInteger(x.lineItemId) || x.lineItemId<1) fail('invalid-woo-locator');
    return {...x};
  }
  async function evidence(loc) {
    const c=config.get(loc.siteId), challenge=randomBytes(16).toString('hex'), env=await c.read({...loc,challenge});
    if(!exact(env,['keyId','payload','signature']) || env.keyId!==c.keyId || typeof env.payload!=='string' || env.payload.length>16384
      || typeof env.signature!=='string' || !/^[a-f0-9]{64}$/.test(env.signature)) fail('invalid-woo-signature');
    const mac=createHmac('sha256',c.key).update(env.payload).digest();
    if(!timingSafeEqual(mac,Buffer.from(env.signature,'hex'))) fail('invalid-woo-signature');
    let e;try {e=JSON.parse(Buffer.from(env.payload,'base64').toString('utf8'));}catch{fail('invalid-woo-evidence');}
    if(!exact(e,fields) || e.challenge!==challenge || e.schema!=='woo-hpos-hold-v1' || e.siteId!==loc.siteId || e.orderId!==loc.orderId || e.lineItemId!==loc.lineItemId
      || !Number.isSafeInteger(e.revision) || e.revision<1 || !Number.isSafeInteger(e.issuedAt) || !Number.isSafeInteger(e.expiresAt)
      || e.issuedAt>clock() || e.expiresAt<=clock() || e.expiresAt-e.issuedAt>30 || e.expiresAt<=e.issuedAt
      || ![e.orderDigest,e.productDigest].every(v=>typeof v==='string' && /^[a-f0-9]{64}$/.test(v))
      || !Number.isSafeInteger(e.productId) || e.productId<1 || !Number.isSafeInteger(e.variationId) || e.variationId<0
      || typeof e.wooSku!=='string' || !e.wooSku || e.wooSku.length>256
      || e.status!=='pending' || e.paid!==false || e.refunded!=='0.00' || e.singleLine!==true || e.active!==true) fail('woo-evidence-ineligible');
    const {issuedAt,expiresAt,challenge:answeredChallenge,...stable}=e;return stable;
  }
  const refFor=loc=>rt.db.doc(`inventoryWooIntents/${wooKey(wooSource(loc))}`);
  async function review(ref,reason) {
    await rt.db.runTransaction(async tx=>{const s=await tx.get(ref);if(s.exists) tx.update(ref,{state:'review_required',reason,updatedAt:FieldValue.serverTimestamp()});});
  }
  const response=(state,result=null)=>({state,result,purchaseAuthorized:false,paymentAuthorized:false,reservationConfirmed:false,reviewRequired:true});
  async function lookup(token,input) {
    await auth(token); const loc=locate(input), row=(await refFor(loc).get()).data();
    if(!row) return response('unknown');
    const result=await produceReservation(rt,token,row.operation,{lookupOnly:true});
    return response(row.state==='review_required'?'review_required':result.status==='unknown'?'pending':'held_review_required',result);
  }
  async function hold(token,input) {
    await auth(token);const loc=locate(input),ref=refFor(loc);let e;
    try {e=await evidence(loc);}catch(err){await review(ref,'source-unavailable-or-changed');throw err;}
    const operation=await rt.db.runTransaction(async tx=>{
      const fence=rt.db.doc(`inventoryWooOrderFences/${hash({siteId:loc.siteId,orderId:loc.orderId})}`);
      const mode=await tx.get(fence);
      if(mode.exists && mode.data().mode!=='single') fail('woo-order-mode-conflict');
      const old=await tx.get(ref);
      if(old.exists) {
        const row=old.data();
        if(row.state==='review_required' || hash(row.evidence)!==hash(e)) {
          tx.update(ref,{state:'review_required',reason:'source-changed'});return null;
        }
        return row.operation;
      }
      const source=wooSource(e), stockPath=e.stock==='tshirt'?'tshirtStock/master':'accessoryStock/shared';
      // Validate identifiers before constructing or reading a canonical target.
      const provisional=normalizeReservation({version:1,operationId:`woo-${wooKey(source)}`,kind:'ec',action:'hold',source,stock:e.stock,sku:e.sku,quantity:e.quantity,expectedRevision:0,expectedQuantity:0});
      const stock=await tx.get(rt.db.doc(stockPath));if(!stock.exists) fail('stock-not-found');
      const data=stock.data(),{cell,field}=target(data,provisional);
      const op=normalizeReservation({...provisional,expectedRevision:revision(data),expectedQuantity:cell[field]});
      if(!mode.exists) tx.create(fence,{mode:'single'});
      tx.create(ref,{schema:'woo-intent-v1',evidence:e,operation:op,state:'pending',createdAt:FieldValue.serverTimestamp()});return op;
    });
    if(!operation) fail('woo-review-required');
    let result;
    try {result=await produceReservation(rt,token,operation);} catch(err) {
      // Transient/unknown completion remains pending; never create a new ID or release.
      if(err instanceof ApiError) await review(ref,err.code);
      throw err;
    }
    let matched=false;try {matched=hash(await evidence(loc))===hash(e);}catch{}
    await rt.db.runTransaction(async tx=>{
      const row=(await tx.get(ref)).data();
      if(!row || row.state==='review_required') return;
      tx.update(ref,{state:matched?'observed':'review_required',reason:matched?'cross-store-review-required':'postflight-source-changed',updatedAt:FieldValue.serverTimestamp()});
    });
    // Even a matching read cannot make Woo and Firestore an atomic commit.
    return lookup(token,loc);
  }
  return Object.freeze({hold,lookup});
}
