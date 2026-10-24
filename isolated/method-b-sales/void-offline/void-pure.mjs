// Offline decision prototype. No authentication, timestamps, persistence or commit acknowledgement.
import {hash,normalize,keys,id,integer,object,fail} from './validation.mjs';
import {target,cell,clone,core,rev,safe,legacyFingerprint} from './sale-primitives.mjs';
const requireThat=(ok,code='reconciliation-required')=>{if(!ok)fail(code);};
const same=(a,b)=>hash(a)===hash(b);
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export function normalizeVoid(x){
  keys(x,['version','transactionId','expectedSaleRequestHash','reason']);
  id(x.transactionId);
  requireThat(x.version===1&&x.reason==='manual_void'&&digest(x.expectedSaleRequestHash),'invalid-void-intent');
  return clone(x);
}
// trustedAnchor MUST come from a trusted adapter, never the HTTP body or the records being checked.
// A hash is not authentication. This offline anchor does not replace Timestamp/UID verification.
export function verifyOriginal(original,trustedAnchor){
  requireThat(digest(trustedAnchor)&&hash(original)===trustedAnchor);
  const {sale:s,lock:l,movements:ms}=original,p=l?.serverSaleV1;
  requireThat(object(s)&&object(l)&&object(ms)&&object(p)&&p.schema==='sale-server-v1');
  const op=normalize(p.canonicalRequest),tid=op.transactionId;
  requireThat(!['voidReason','voidedByEmail','voidedAt'].some(k=>Object.hasOwn(s,k))&&!Object.hasOwn(l,'voidedAt'));
  requireThat(s.status==='completed'&&l.status==='committed'&&!Object.hasOwn(l,'serverVoidV1'));
  requireThat(s.transactionId===tid&&l.transactionId===tid&&s.sessionId===op.sessionId&&l.sessionId===op.sessionId);
  requireThat(p.requestHash===hash(op)&&p.contextHash===op.expectedContextHash&&p.resultHash===hash(p.result)&&p.effectsHash===hash(p.effects)&&p.saleHash===hash(core(s)));
  requireThat(l.fingerprint===legacyFingerprint(op,s.items)&&same(s.items,p.result.items));
  requireThat(s.mode==='sku'&&s.currency==='JPY'&&s.paymentMethod==='manual'&&s.discount===0&&s.inventoryApplied===true);
  requireThat(['paymentProvider','providerPaymentIntentId','providerCheckoutSessionId','providerPaymentStatus'].every(k=>s[k]===''));
  requireThat(Array.isArray(s.items)&&s.items.length===op.items.length&&Object.keys(ms).length===s.items.length&&Object.keys(p.movementHashes).length===s.items.length);
  requireThat(Array.isArray(p.effects.stock)&&p.effects.stock.length===s.items.length);
  s.items.forEach((x,i)=>{
    const row=op.items[i],mid=`${tid}__${i+1}`,m=ms[mid],t=target(x),e=p.effects.stock[i];
    requireThat(Object.keys(row).every(k=>x[k]===row[k])&&x.trackingMode==='sku'&&x.inventoryApplied===true&&typeof x.eventInventoryApplied==='boolean');
    requireThat(x.grossLineTotal===safe(x.quantity*x.unitPrice)&&x.netLineTotal===x.grossLineTotal&&x.totalLineDiscount===0);
    requireThat(m&&hash(core(m))===p.movementHashes[mid]&&m.movementId===mid&&m.transactionId===tid&&m.sessionId===s.sessionId);
    requireThat(m.type==='sale'&&m.status==='applied'&&m.variantId===x.variantId&&m.inventoryKey===x.inventoryKey&&m.inventorySource===x.inventorySource&&m.quantity===x.quantity&&m.appliedInventoryDelta===-x.quantity&&m.expectedInventoryDelta===-x.quantity&&m.eventInventoryApplied===x.eventInventoryApplied);
    requireThat(e.path===t.path&&e.variantId===x.variantId&&e.inventoryKey===x.inventoryKey&&safe(e.beforeQuantity-x.quantity)===e.quantity&&safe(e.beforeRevision+1)===e.revision);
    requireThat(m.reason==='sale'&&m.inventoryApplied===true&&m.trackingMode==='sku'&&m.category===x.category&&m.label===x.label);
  });
  // Hash self-consistency alone does not establish the sales.mjs business contract.
  const total=safe(s.items.reduce((n,x)=>safe(n+safe(x.quantity*x.unitPrice)),0));
  const count=safe(s.items.reduce((n,x)=>safe(n+x.quantity),0));
  const totals={grossSales:total,setDiscount:0,lineDiscount:0,orderDiscount:0,discount:0,netSales:total,grossSalesJPY:total,setDiscountJPY:0,lineDiscountJPY:0,orderDiscountJPY:0,discountJPY:0,netSalesJPY:total};
  requireThat(same(p.effects.session,{...totals,transactionCount:1,itemCount:count}));
  requireThat(Object.entries(totals).every(([k,v])=>s[k]===v)&&s.itemCount===count&&s.lineCount===s.items.length);
  requireThat(same(p.result,{transactionId:tid,currency:'JPY',items:s.items,subtotal:total,discount:0,netSales:total,inventoryWarnings:s.inventoryWarnings}));
  const prior=new Map(), revisions=new Map();
  for(const e of p.effects.stock){
    const key=JSON.stringify([e.path,e.inventoryKey]);
    requireThat(!prior.has(key)||prior.get(key)===e.beforeQuantity);
    requireThat(integer(e.beforeRevision)&&e.beforeRevision>=0&&(!revisions.has(e.path)||revisions.get(e.path)===e.beforeRevision));
    prior.set(key,e.quantity);revisions.set(e.path,e.beforeRevision);
  }
  return clone(p);
}
function calculate(original,anchor,intent,state,expectedRevisions){
  const p=verifyOriginal(original,anchor),op=normalizeVoid(intent),s=original.sale;
  requireThat(op.transactionId===s.transactionId&&op.expectedSaleRequestHash===p.requestHash,'intent-conflict');
  requireThat(object(state.session)&&state.session.status==='open'&&state.session.currency==='JPY','session-closed');
  const stocks=clone(state.stocks),session=clone(state.session),groups=new Map();
  for(const x of s.items){
    const t=target(x),k=JSON.stringify([t.path,t.parts]);
    const g=groups.get(k)??{target:t,quantity:0};g.quantity=safe(g.quantity+x.quantity);groups.set(k,g);
  }
  const touched=[...new Set([...groups.values()].map(g=>g.target.path))].sort();
  keys(expectedRevisions,touched);
  for(const path of touched){
    requireThat(object(stocks[path]),'unknown-stock');
    const r=rev(stocks[path]);requireThat(integer(expectedRevisions[path])&&r===expectedRevisions[path],'revision-conflict');
    requireThat(r<Number.MAX_SAFE_INTEGER,'revision-overflow');
    // A stock revision older than the original sale cannot describe a valid current baseline.
    requireThat(p.effects.stock.filter(e=>e.path===path).every(e=>r>=e.revision),'revision-conflict');
  }
  const restores=[];
  for(const {target:t,quantity} of groups.values()){
    const [c,k]=cell(stocks[t.path],t),before=c[k];c[k]=safe(before+quantity);
    restores.push({path:t.path,parts:t.parts,quantity,beforeQuantity:before,afterQuantity:c[k]});
  }
  for(const path of touched){stocks[path].inventoryRevision=rev(stocks[path])+1;stocks[path].inventoryWriteProtocol=1;}
  requireThat(object(session.salesSummary)&&object(p.effects.session));
  for(const [k,delta] of Object.entries(p.effects.session)){
    requireThat(integer(delta)&&delta>=0&&Object.hasOwn(session.salesSummary,k),'invalid-summary');
    const n=safe(safe(session.salesSummary[k])-delta);requireThat(n>=0,'invalid-summary');session.salesSummary[k]=n;
  }
  for(const x of s.items.filter(x=>x.eventInventoryApplied)){
    const sold=session.inventoryCount?.soldByVariant;requireThat(object(sold)&&Object.hasOwn(sold,x.variantId),'invalid-event-summary');
    const n=safe(safe(sold[x.variantId])-x.quantity);requireThat(n>=0,'invalid-event-summary');sold[x.variantId]=n;
  }
  // Business-only projection. Audit actor/time and reversal document formatting remain adapter work.
  const saleAfter={...clone(s),status:'voided',voidReason:op.reason};
  const lockAfter={...clone(original.lock),status:'voided'};
  const result={transactionId:s.transactionId,currentSaleStatus:'voided',saleRequestHash:p.requestHash};
  return {saleAfter,lockAfter,stocksAfter:stocks,sessionAfter:session,restores,result};
}
export function planVoid({original,trustedAnchor,intent,state,expectedRevisions}){
  const op=normalizeVoid(intent),projection=calculate(original,trustedAnchor,op,state,expectedRevisions);
  const serverVoidV1={schema:'void-pure-candidate-v1',intent:op,intentHash:hash(op),original:clone(original),originalAnchor:trustedAnchor,beforeState:clone(state),expectedRevisions:clone(expectedRevisions),beforeSaleHash:hash(core(original.sale)),afterSaleHash:hash(core(projection.saleAfter)),projectionHash:hash(projection)};
  return {kind:'candidate-only',newCommit:false,projection,serverVoidV1};
}
export function verifyCandidate(candidate,trustedAnchor){
  requireThat(candidate?.kind==='candidate-only'&&candidate.newCommit===false);
  const v=candidate.serverVoidV1;requireThat(object(v)&&v.schema==='void-pure-candidate-v1'&&v.originalAnchor===trustedAnchor);
  const expected=planVoid({original:v.original,trustedAnchor,intent:v.intent,state:v.beforeState,expectedRevisions:v.expectedRevisions});
  requireThat(same(candidate,expected));
  return clone(expected);
}
export function replayVoid(candidate,trustedAnchor,intent,sessionExists){
  const checked=verifyCandidate(candidate,trustedAnchor),op=normalizeVoid(intent);
  requireThat(sessionExists===true,'session-not-found');
  requireThat(hash(op)===checked.serverVoidV1.intentHash,'intent-conflict');
  return {kind:'candidate-replay-only',newCommit:false,replayed:true,result:clone(checked.projection.result)};
}
export function lateSaleDecision(candidate,trustedAnchor,saleIntent,sessionExists){
  const checked=verifyCandidate(candidate,trustedAnchor),p=checked.serverVoidV1.original.lock.serverSaleV1;
  requireThat(sessionExists===true,'session-not-found');
  requireThat(hash(normalize(saleIntent))===p.requestHash,'intent-conflict');
  return {kind:'candidate-reconciliation-only',newCommit:false,mayCreateSale:false,currentSaleStatus:'voided',originalSaleResult:clone(p.result)};
}
