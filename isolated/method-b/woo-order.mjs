import {createHmac, timingSafeEqual, randomBytes} from 'node:crypto';
import {FieldValue, Timestamp} from 'firebase-admin/firestore';
import {ApiError, hash, normalize, revision, target, reservationFloor, assertReservationAuthority} from './inventory.mjs';
import {assertIsolated, PROJECT} from './runtime.mjs';

export const ORDER_ACTOR='fixture-woo-order-producer';
const fail=code=>{throw new ApiError(409,code);};
const exact=(x,keys)=>x && Object.getPrototypeOf(x)===Object.prototype && Object.keys(x).sort().join(',')===[...keys].sort().join(',');
const positive=x=>Number.isSafeInteger(x)&&x>0;
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const pathFor=s=>s==='tshirt'?'tshirtStock/master':'accessoryStock/shared';
const keyFor=loc=>hash(loc);
const response=(state,result=null)=>({state,result,purchaseAuthorized:false,paymentAuthorized:false,reservationConfirmed:false,reviewRequired:true});

// Isolated server composition only. No HTTP endpoint, production key or issuer.
// A complete signed order is mandatory; never assemble it from individual holds.
export function createWooOrderBridge(rt,{sites,clock=()=>Math.floor(Date.now()/1000)}) {
  assertIsolated();if(rt.db.projectId!==PROJECT) fail('wrong-project');
  const configs=new Map(Object.entries(sites).map(([site,c])=>{
    if(!/^fixture-site-[ab]$/.test(site)||c.keyId!=='fixture-v1'||typeof c.key!=='string'||c.key.length<32||typeof c.read!=='function') fail('invalid-server-config');
    return [site,{...c}];
  }));
  async function auth(token) {
    let c;try{c=await rt.auth.verifyIdToken(token,true);}catch{throw new ApiError(401,'unauthenticated');}
    if(c.uid!==ORDER_ACTOR||c.inventoryProducer!=='ec'||c.email_verified!==true) throw new ApiError(403,'forbidden');
  }
  function locate(x) {
    if(!exact(x,['siteId','orderId'])||!configs.has(x.siteId)||!positive(x.orderId)) fail('invalid-order-locator');
    return {...x};
  }
  async function evidence(loc) {
    const c=configs.get(loc.siteId),challenge=randomBytes(16).toString('hex'),env=await c.read({...loc,challenge});
    if(!exact(env,['keyId','payload','signature'])||env.keyId!==c.keyId||typeof env.payload!=='string'||env.payload.length>65536||!digest(env.signature)) fail('invalid-signature');
    if(!timingSafeEqual(createHmac('sha256',c.key).update(env.payload).digest(),Buffer.from(env.signature,'hex'))) fail('invalid-signature');
    let e;try{e=JSON.parse(Buffer.from(env.payload,'base64').toString('utf8'));}catch{fail('invalid-evidence');}
    if(!exact(e,['schema','siteId','orderId','revision','orderDigest','status','paid','refunded','complete','purchaseStopped','lines','issuedAt','expiresAt','challenge'])
      ||e.schema!=='woo-order-hold-v1'||e.siteId!==loc.siteId||e.orderId!==loc.orderId||e.challenge!==challenge||!positive(e.revision)||!digest(e.orderDigest)
      ||!Number.isSafeInteger(e.issuedAt)||!Number.isSafeInteger(e.expiresAt)||e.issuedAt>clock()||e.expiresAt<=clock()||e.expiresAt<=e.issuedAt||e.expiresAt-e.issuedAt>30
      ||e.status!=='pending'||e.paid!==false||e.refunded!=='0.00'||e.complete!==true||e.purchaseStopped!==false||!Array.isArray(e.lines)||e.lines.length<1||e.lines.length>50) fail('order-ineligible');
    const seen=new Set();
    for(const l of e.lines) {
      if(!exact(l,['lineItemId','productId','variationId','productDigest','wooSku','active','selected','fulfillment','stock','sku','quantity'])
        ||!positive(l.lineItemId)||seen.has(l.lineItemId)||!positive(l.productId)||!Number.isSafeInteger(l.variationId)||l.variationId<0||!digest(l.productDigest)
        ||typeof l.wooSku!=='string'||!l.wooSku.length||l.wooSku.length>256||l.active!==true||l.selected!==true||l.fulfillment!=='finished'||!positive(l.quantity)) fail('line-ineligible');
      seen.add(l.lineItemId);
      normalize({version:1,operationId:'validation',stock:l.stock,sku:l.sku,quantity:l.quantity,expectedRevision:0,expectedQuantity:0});
    }
    const {issuedAt,expiresAt,challenge:answer,...stable}=e;
    stable.lines.sort((a,b)=>a.lineItemId-b.lineItemId);return stable;
  }
  const refs=loc=>{
    const id=keyFor(loc);return {intent:rt.db.doc(`inventoryWooOrders/${id}`),receipt:rt.db.doc(`inventoryWriteReceipts/woo-order-${id}`),fence:rt.db.doc(`inventoryWooOrderFences/${id}`)};
  };
  async function review(ref,reason) {
    await rt.db.runTransaction(async tx=>{const row=await tx.get(ref);if(row.exists)tx.update(ref,{state:'review_required',reason});});
  }
  function receiptResult(done,row) {
    const r=done.data();
    if(!r||r.schema!=='woo-order-receipt-v1'||r.actor!==ORDER_ACTOR||!(r.createdAt instanceof Timestamp)||r.intent!==hash(row.plan)||hash(r.plan)!==r.intent||!r.result||r.result.operationId!==row.plan.operationId||r.result.planHash!==r.intent||r.resultHash!==hash(r.result)) fail('receipt-conflict');
    // Reconstruct historical effects rather than trusting a self-consistent result hash.
    try {
      const stocks=Object.keys(row.plan.expected),updates=[];
      if(!Array.isArray(r.before)||r.before.length!==stocks.length)fail('receipt-conflict');
      for(let n=0;n<stocks.length;n++){
        const s=stocks[n],b=r.before[n],ledger=structuredClone(b.ledger);
        assertReservationAuthority({exists:true,data:()=>b.authority},ledger,pathFor(s));
        for(const l of row.plan.lines.filter(l=>l.stock===s)){
          const op=normalize({version:1,operationId:row.plan.operationId,stock:s,sku:l.sku,quantity:l.quantity,expectedQuantity:l.expectedQuantity,expectedRevision:row.plan.expected[s].revision});
          reservationFloor(ledger,op);
          const id=hash({source:row.plan.source,lineItemId:l.lineItemId});
          if(ledger.entries.some(x=>x.id===id))fail('receipt-conflict');
          ledger.entries.push({id,kind:'ec',state:'held',sku:op.sku,quantity:op.quantity});
          if(reservationFloor(ledger,op).total>op.expectedQuantity)fail('receipt-conflict');
        }
        updates.push({stock:s,path:pathFor(s),revision:row.plan.expected[s].revision+1,ledger});
      }
      if(hash(r.result)!==hash({operationId:row.plan.operationId,planHash:r.intent,stocks:updates}))fail('receipt-conflict');
    } catch {fail('receipt-conflict');}
    return {...r.result,replayed:true};
  }
  async function lookup(token,input) {
    await auth(token);const loc=locate(input),r=refs(loc);
    return rt.db.runTransaction(async tx=>{
      const [i,d]=await tx.getAll(r.intent,r.receipt);
      if(!i.exists){if(d.exists)fail('receipt-conflict');return response('unknown');}
      const row=i.data(),result=d.exists?receiptResult(d,row):null;
      if(row.state==='committed'&&!d.exists)fail('receipt-missing');
      return response(row.state==='review_required'?'review_required':result?'held_review_required':'pending',result);
    });
  }
  async function hold(token,input) {
    await auth(token);const loc=locate(input),r=refs(loc);let e;
    try{e=await evidence(loc);}catch(err){await review(r.intent,'source-unavailable-or-ineligible');throw err;}
    const plan=await rt.db.runTransaction(async tx=>{
      const [old,fence]=await tx.getAll(r.intent,r.fence);
      if(fence.exists&&fence.data().mode!=='order')fail('woo-order-mode-conflict');
      if(old.exists){const row=old.data();if(row.state==='review_required'||hash(row.evidence)!==hash(e)){tx.update(r.intent,{state:'review_required',reason:'source-changed'});return null;}return row.plan;}
      // Pre-fence single-line journals must also block migration, including removed lines.
      const legacy=await tx.get(rt.db.collection('inventoryWooIntents').where('evidence.siteId','==',loc.siteId).where('evidence.orderId','==',loc.orderId));
      if(!legacy.empty)fail('legacy-order-reconciliation-required');
      if(fence.exists)fail('order-journal-missing');
      const stocks=[...new Set(e.lines.map(l=>l.stock))].sort(),snaps=await tx.getAll(...stocks.map(s=>rt.db.doc(pathFor(s))));
      const expected={};for(let n=0;n<stocks.length;n++){
        if(!snaps[n].exists)fail('stock-not-found');const d=snaps[n].data(),rev=revision(d);
        if(rev>=Number.MAX_SAFE_INTEGER)fail('revision-overflow');expected[stocks[n]]={revision:rev};
      }
      const lines=e.lines.map(l=>{const d=snaps[stocks.indexOf(l.stock)].data(),{cell,field}=target(d,l);return {...l,expectedQuantity:cell[field]};});
      const p={operationId:`woo-order-${keyFor(loc)}`,source:loc,evidenceHash:hash(e),expected,lines};
      tx.create(r.fence,{mode:'order'});tx.create(r.intent,{schema:'woo-order-intent-v1',evidence:e,plan:p,state:'pending'});return p;
    });
    if(!plan)fail('woo-review-required');
    let result;
    try{result=await rt.db.runTransaction(async tx=>{
      const stocks=Object.keys(plan.expected),stockRefs=stocks.map(s=>rt.db.doc(pathFor(s))),authorityRefs=stocks.map(s=>rt.db.doc(`inventoryReservationAuthorities/${s}`));
      const [i,done,fence,gate,...rest]=await tx.getAll(r.intent,r.receipt,r.fence,rt.db.doc('inventoryWooPurchaseGate/current'),...stockRefs,...authorityRefs);
      const row=i.data();if(!row||hash(row.plan)!==hash(plan)||row.state==='review_required'||fence.data()?.mode!=='order')fail('woo-review-required');
      if(done.exists)return receiptResult(done,row);
      if(row.state!=='pending')fail('receipt-missing');
      // Missing/stopped gate denies all fresh holds. Only explicit fixture setup enables tests.
      if(gate.data()?.schema!=='woo-purchase-gate-v1'||gate.data()?.stopped!==false)fail('purchases-stopped');
      const updates=[];
      for(let n=0;n<stocks.length;n++){
        const s=stocks[n],snap=rest[n],a=rest[n+stocks.length];if(!snap.exists)fail('stock-not-found');
        const d=snap.data();if(revision(d)!==plan.expected[s].revision)fail('inventory-conflict');
        assertReservationAuthority(a,d.inventoryReservations,pathFor(s));
        let ledger={...d.inventoryReservations,entries:[...d.inventoryReservations.entries]};
        for(const l of plan.lines.filter(l=>l.stock===s)){
          const op=normalize({version:1,operationId:plan.operationId,stock:s,sku:l.sku,quantity:l.quantity,expectedQuantity:l.expectedQuantity,expectedRevision:plan.expected[s].revision});
          const {cell,field}=target(d,op);if(cell[field]!==l.expectedQuantity||cell[field]<0)fail('inventory-conflict');
          reservationFloor(ledger,op);
          const id=hash({source:loc,lineItemId:l.lineItemId});if(ledger.entries.some(x=>x.id===id))fail('commitment-already-exists');
          ledger.entries.push({id,kind:'ec',state:'held',sku:op.sku,quantity:op.quantity});
          if(reservationFloor(ledger,op).total>cell[field])fail('reserved-stock-floor');
        }
        updates.push({stock:s,path:pathFor(s),revision:revision(d)+1,ledger});
      }
      const out={operationId:plan.operationId,planHash:hash(plan),stocks:updates};
      // All reads and all validation precede any writes. One canonical update per stock.
      for(let n=0;n<updates.length;n++){
        const u=updates[n];tx.update(stockRefs[n],{inventoryReservations:u.ledger,inventoryRevision:u.revision,inventoryReservationAuthority:1,inventoryWriteProtocol:1,updatedAt:FieldValue.serverTimestamp()});
        tx.update(authorityRefs[n],{ledgerHash:hash(u.ledger),updatedAt:FieldValue.serverTimestamp()});
      }
      const before=stocks.map((s,n)=>({ledger:rest[n].data().inventoryReservations,authority:rest[n+stocks.length].data()}));
      tx.create(r.receipt,{schema:'woo-order-receipt-v1',actor:ORDER_ACTOR,intent:hash(plan),plan,before,result:out,resultHash:hash(out),createdAt:FieldValue.serverTimestamp()});
      tx.update(r.intent,{state:'committed'});return {...out,replayed:false};
    },{maxAttempts:3});}catch(err){if(err instanceof ApiError)await review(r.intent,err.code);throw err;}
    let matched=false;try{matched=hash(await evidence(loc))===hash(e);}catch{}
    if(!matched)await review(r.intent,'postflight-source-changed-or-unavailable');
    const observed=await lookup(token,loc);return {...observed,result};
  }
  return Object.freeze({hold,lookup});
}
