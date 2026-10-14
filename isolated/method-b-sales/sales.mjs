import {FieldValue,FieldPath,Timestamp} from 'firebase-admin/firestore';
import {assertIsolated,PROJECT,UIDS} from './runtime.mjs';
import {normalize,hash,object,integer,fail,id} from './validation.mjs';
import {localDateKey,resolveItemCostSnapshot} from './legacy-cost.mjs';
const paths={tshirt:'tshirtStock/master',accessory:'accessoryStock/shared'};
const coords=['bodyId','designId','colorId','sizeId'];
const safe=(n)=>{if(!integer(n))fail('invalid-stored-number');return n;};
const number=(obj,key)=>Object.hasOwn(obj,key)?safe(obj[key]):0;
const rev=d=>{const n=number(d,'inventoryRevision');if(n<0)fail('invalid-revision');return n;};
function target(v){
  if(!object(v)||(v.active!==undefined&&v.active!==true)||!['tshirt','accessory'].includes(v.inventorySource)||typeof v.category!=='string'||!v.category||typeof v.inventoryKey!=='string')fail('invalid-variant');
  const source=v.inventorySource,prefix=source+':';if(!v.inventoryKey.startsWith(prefix))fail('invalid-variant');
  let parts;try{parts=v.inventoryKey.slice(prefix.length).split('|').map(decodeURIComponent);}catch{fail('invalid-variant');}
  parts.forEach(x=>{try{id(x);}catch{fail('invalid-variant');}});
  if(source==='tshirt'){if(parts.length!==4||coords.some((k,i)=>v[k]!==parts[i]))fail('invalid-variant');}
  else if(parts.length!==2||!['piercing','earring'].includes(parts[1])||(v.designId!=null&&v.designId!==parts[0]))fail('invalid-variant');
  return {source,path:paths[source],parts};
}
export function contextHash(sessionId,session,variants){
  const p=session.methodBSalesPolicyV1;
  if(!object(p)||Object.keys(p).sort().join(',')!=='currency,pricesByVariant,version'||!integer(p.version)||p.version<1||p.currency!=='JPY'||session.currency!=='JPY'||!object(p.pricesByVariant))fail('invalid-policy');
  for(const price of Object.values(p.pricesByVariant))if(!integer(price)||price<0||price>1000000)fail('invalid-policy');
  const rows=[...variants].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([variantId,v])=>{target(v);if(!Object.hasOwn(p.pricesByVariant,variantId))fail('invalid-policy');return {variantId,active:v.active??true,category:v.category,inventorySource:v.inventorySource,inventoryKey:v.inventoryKey,...Object.fromEntries(coords.map(k=>[k,v[k]??null]))};});
  return hash({sessionId,policy:p,variants:rows});
}
function clone(x){if(Array.isArray(x))return x.map(clone);if(object(x))return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,clone(v)]));return x;}
function cell(data,t){if(t.source==='tshirt'){let c=data.inventory_v2;for(const k of t.parts){if(!object(c)||!Object.hasOwn(c,k))fail('unknown-quantity');c=c[k];}if(!object(c))fail('unknown-quantity');safe(c.qty);return [c,'qty'];}
  if(!Array.isArray(data.designs)||data.designs.some(x=>!object(x)||typeof x.id!=='string')||new Set(data.designs.map(x=>x.id)).size!==data.designs.length)fail('invalid-designs');
  const c=data.designs.find(x=>x.id===t.parts[0]);if(!c)fail('unknown-quantity');safe(c[t.parts[1]]);return [c,t.parts[1]];
}
// The legacy fingerprint intentionally omits undefined orderDiscount, as its caller does.
export function legacyFingerprint(request,items){return JSON.stringify({sessionId:request.sessionId,currency:request.currency,discount:0,items:items.map(x=>({category:x.category,quantity:x.quantity,unitPrice:x.unitPrice,setDiscount:0,manualDiscount:0,trackingMode:'sku',variantId:x.variantId,tshirtBodyKey:x.tshirtBodyKey||null}))});}
const core=d=>Object.fromEntries(Object.entries(d).filter(([k])=>!['createdAt','updatedAt'].includes(k)));
function guard(db,actor){assertIsolated();if(db.projectId!==PROJECT)fail('wrong-project',500);if(!UIDS.includes(actor.uid)||actor.email_verified!==true)fail('forbidden',403);}
async function records(tx,db,tid){
  const sale=db.collection('salesTransactions').doc(tid),lock=db.collection('transactionLocks').doc(tid);
  const [s,l]=await tx.getAll(sale,lock);
  const byId=await tx.get(db.collection('inventoryMovements').where('transactionId','==',tid));
  const prefix=await tx.get(db.collection('inventoryMovements').orderBy(FieldPath.documentId()).startAt(tid+'__').endAt(tid+'__\uf8ff'));
  const movements=new Map([...byId.docs,...prefix.docs].map(d=>[d.id,d.data()]));
  return {sale,lock,s:s.data(),l:l.data(),movements};
}
function checkProof(r,tid){
  const p=r.l?.serverSaleV1;
  if(!r.s||!p||p.schema!=='sale-server-v1'||!(r.l.createdAt instanceof Timestamp)||!(r.s.createdAt instanceof Timestamp)||!UIDS.includes(p.actorUid)||!object(p.canonicalRequest))fail('reconciliation-required');
  try{normalize(p.canonicalRequest);}catch{fail('reconciliation-required');}
  if(p.canonicalRequest.transactionId!==tid||p.requestHash!==hash(p.canonicalRequest)||p.contextHash!==p.canonicalRequest.expectedContextHash||p.resultHash!==hash(p.result)||p.effectsHash!==hash(p.effects)||p.saleHash!==hash(core(r.s))||r.s.transactionId!==tid||r.l.transactionId!==tid||r.l.sessionId!==r.s.sessionId||r.s.sessionId!==p.canonicalRequest.sessionId||r.l.status!=='committed'||r.s.status!=='completed'||r.l.fingerprint!==legacyFingerprint(p.canonicalRequest,r.s.items))fail('reconciliation-required');
  if(r.movements.size!==p.canonicalRequest.items.length||!object(p.movementHashes)||Object.keys(p.movementHashes).length!==r.movements.size)fail('reconciliation-required');
  for(let i=0;i<p.canonicalRequest.items.length;i++){const mid=`${tid}__${i+1}`,m=r.movements.get(mid);if(!m||!(m.createdAt instanceof Timestamp)||m.transactionId!==tid||m.movementId!==mid||m.sessionId!==r.s.sessionId||hash(core(m))!==p.movementHashes[mid])fail('reconciliation-required');}
  return p;
}
function proof(r,tid){try{return checkProof(r,tid);}catch{fail('reconciliation-required');}}
const reply=(p,replayed)=>({transactionId:p.canonicalRequest.transactionId,sessionId:p.canonicalRequest.sessionId,outcome:'committed',replayed,requestHash:p.requestHash,result:p.result,currentSaleStatus:'completed'});
function eventState(session){
  const c=session.inventoryCount??{};if(!object(c))fail('invalid-session');
  const opening=c.opening?.items??[],flow=c.flowEntries??[],sold=c.soldByVariant??{};
  if(!Array.isArray(opening)||!Array.isArray(flow)||!object(sold))fail('invalid-session');
  const available=new Map();for(const x of opening){if(!x.variantId)continue;const q=safe(x.openingQty);if(q<0||available.has(x.variantId))fail('invalid-session');available.set(x.variantId,q);}
  for(const x of flow){if(!['restock','opening_correction'].includes(x.type))continue;const q=safe(x.quantity);if(x.type==='restock'&&q<0)fail('invalid-session');available.set(x.variantId,safe((available.get(x.variantId)||0)+q));}
  for(const n of Object.values(sold))if(safe(n)<0)fail('invalid-session');
  return {enabled:available.size>0,available,sold:{...sold}};
}
export async function commitSale(db,actor,input,hooks={}){
  guard(db,actor);const op=normalize(input),requestHash=hash(op);let attempts=0;
  return db.runTransaction(async tx=>{
    attempts++;hooks.onAttempt?.(attempts);
    const r=await records(tx,db,op.transactionId);
    if(r.s||r.l||r.movements.size){const p=proof(r,op.transactionId);if(p.requestHash!==requestHash)fail('intent-conflict');const session=await tx.get(db.collection('salesSessions').doc(op.sessionId));if(!session.exists)fail('reconciliation-required');return reply(p,true);}
    const sessionRef=db.collection('salesSessions').doc(op.sessionId),sessionSnap=await tx.get(sessionRef);if(!sessionSnap.exists)fail('session-not-found',404);const session=sessionSnap.data();
    if(session.status!=='open')fail('session-closed');
    const variants=new Map();for(const vid of new Set(op.items.map(x=>x.variantId))){const snap=await tx.get(db.collection('productVariants').doc(vid));if(!snap.exists)fail('variant-not-found',404);variants.set(vid,snap.data());}
    if(contextHash(op.sessionId,session,variants)!==op.expectedContextHash)fail('context-conflict');
    const products=new Map();for(const cat of new Set([...variants.values()].map(v=>v.category))){try{id(cat);}catch{fail('invalid-variant');}const snap=await tx.get(db.collection('products').doc(cat));products.set(cat,snap.data()??{});}
    const stocks=new Map();for(const v of variants.values()){const t=target(v);if(stocks.has(t.path))continue;const ref=db.doc(t.path),snap=await tx.get(ref);if(!snap.exists)fail('invalid-stock');const data=clone(snap.data()),revision=rev(data);if(revision===Number.MAX_SAFE_INTEGER)fail('revision-overflow');stocks.set(t.path,{ref,data,revision});}
    await hooks.afterReads?.({tx,attempts});
    const event=eventState(session),warnings=[],effects=[],saleDate=localDateKey();
    const items=op.items.map(row=>{
      const v=variants.get(row.variantId),t=target(v);if(row.unitPrice!==session.methodBSalesPolicyV1.pricesByVariant[row.variantId])fail('price-conflict');
      const stock=stocks.get(t.path),[c,key]=cell(stock.data,t),before=c[key],after=safe(before-row.quantity);c[key]=after;
      const label=v.displayName||v.design||v.category;
      if(after<0)warnings.push({type:'global_stock_negative',source:t.source,variantId:row.variantId,label,availableBefore:before,requestedQuantity:row.quantity,projectedAfter:after});
      const eBefore=event.enabled?safe((event.available.get(row.variantId)||0)-(event.sold[row.variantId]||0)):null;
      const eAfter=event.enabled?safe(eBefore-row.quantity):null;
      if(event.enabled){event.sold[row.variantId]=safe((event.sold[row.variantId]||0)+row.quantity);if(eAfter<0)warnings.push({type:'event_stock_negative',variantId:row.variantId,availableBefore:eBefore,requestedQuantity:row.quantity,projectedAfter:eAfter});}
      const cost=resolveItemCostSnapshot({item:{...row,category:v.category},variant:v,product:products.get(v.category),saleDate});
      effects.push({variantId:row.variantId,path:t.path,inventoryKey:v.inventoryKey,beforeQuantity:before,quantity:after,beforeRevision:stock.revision,revision:stock.revision+1});
      return {...row,category:v.category,label,detail:'',trackingMode:'sku',tshirtBodyKey:t.source==='tshirt'?v.bodyId:null,...Object.fromEntries([...coords,'body','design','color','size','sku'].map(k=>[k,v[k]??null])),inventoryKey:v.inventoryKey,inventorySource:t.source,grossLineTotal:safe(row.quantity*row.unitPrice),lineDiscountBeforeOrder:0,netBeforeOrder:row.quantity*row.unitPrice,setOffer:{quantity:0,price:0},orderDiscountAllocated:0,totalLineDiscount:0,netLineTotal:row.quantity*row.unitPrice,inventoryApplied:true,inventoryWarning:after<0,inventoryQtyBefore:before,inventoryQtyAfter:after,reconciliationStatus:'reconciled',eventInventoryApplied:event.enabled,eventAvailableBefore:eBefore,eventAvailableAfter:eAfter,eventInventoryWarning:event.enabled&&eAfter<0,costSnapshotCaptured:true,unitCostJPY:cost.unitCostJPY??null,costSource:cost.source,costEffectiveFrom:cost.effectiveFrom,lineCostJPY:cost.unitCostJPY==null?null:cost.unitCostJPY*row.quantity};
    });
    const total=safe(items.reduce((n,x)=>n+x.grossLineTotal,0)),count=safe(items.reduce((n,x)=>n+x.quantity,0));
    const totals={grossSales:total,setDiscount:0,lineDiscount:0,orderDiscount:0,discount:0,netSales:total,grossSalesJPY:total,setDiscountJPY:0,lineDiscountJPY:0,orderDiscountJPY:0,discountJPY:0,netSalesJPY:total};
    const deltas={...totals,transactionCount:1,itemCount:count},summary={...(session.salesSummary??{})};if(!object(summary))fail('invalid-summary');for(const [k,v]of Object.entries(deltas))summary[k]=safe(number(summary,k)+v);
    const missing=items.filter(x=>x.unitCostJPY==null).reduce((n,x)=>n+x.quantity,0);
    const sale={transactionId:op.transactionId,sessionId:op.sessionId,sessionType:session.type||'event',eventName:session.eventName||'',country:session.country||'',city:session.city||'',mode:'sku',currency:'JPY',baseCurrency:'JPY',fxRateToJPY:1,fxRateStatus:'set',...totals,costSnapshotVersion:2,costSnapshotDate:saleDate,costSnapshotTotalJPY:items.reduce((n,x)=>n+(x.lineCostJPY??0),0),costSnapshotCoveredQuantity:count-missing,costSnapshotMissingQuantity:missing,costSnapshotComplete:missing===0,itemCount:count,lineCount:items.length,items,eventInventoryMode:event.enabled?'flow_allocation':'global_only',inventoryWarnings:warnings,inventoryWarningCount:warnings.length,hasInventoryWarning:!!warnings.length,inventoryMode:'allocated',inventoryApplied:true,reconciliationStatus:'reconciled',paymentMethod:'manual',paymentProvider:'',providerPaymentIntentId:'',providerCheckoutSessionId:'',providerPaymentStatus:'',status:'completed',createdByEmail:actor.email||''};
    const movements=items.map((x,i)=>({movementId:`${op.transactionId}__${i+1}`,transactionId:op.transactionId,sessionId:op.sessionId,type:'sale',reason:'sale',category:x.category,label:x.label,quantity:x.quantity,expectedInventoryDelta:-x.quantity,appliedInventoryDelta:-x.quantity,inventoryApplied:true,eventInventoryApplied:event.enabled,trackingMode:'sku',variantId:x.variantId,inventoryKey:x.inventoryKey,inventorySource:x.inventorySource,status:'applied'}));
    const result={transactionId:op.transactionId,currency:'JPY',items,subtotal:total,discount:0,netSales:total,inventoryWarnings:warnings};
    const p={schema:'sale-server-v1',canonicalRequest:op,requestHash,actorUid:actor.uid,contextHash:op.expectedContextHash,result,effects:{stock:effects,session: deltas},resultHash:hash(result),effectsHash:hash({stock:effects,session:deltas}),saleHash:hash(sale),movementHashes:Object.fromEntries(movements.map(m=>[m.movementId,hash(m)]))};
    for(const stock of stocks.values())tx.update(stock.ref,{...(stock.ref.path===paths.tshirt?{inventory_v2:stock.data.inventory_v2}:{designs:stock.data.designs}),inventoryRevision:stock.revision+1,inventoryWriteProtocol:1,updatedAt:FieldValue.serverTimestamp()});
    tx.create(r.sale,{...sale,createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
    tx.create(r.lock,{transactionId:op.transactionId,sessionId:op.sessionId,fingerprint:legacyFingerprint(op,items),status:'committed',serverSaleV1:p,createdAt:FieldValue.serverTimestamp()});
    for(const m of movements)tx.create(db.collection('inventoryMovements').doc(m.movementId),{...m,createdAt:FieldValue.serverTimestamp()});
    tx.update(sessionRef,{salesSummary:summary,...(event.enabled?{'inventoryCount.soldByVariant':event.sold,'inventoryCount.salesUpdatedAt':FieldValue.serverTimestamp()}:{}),lastTransactionAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
    hooks.beforeCommit?.({tx,db});return reply(p,false);
  },{maxAttempts:3});
}
export async function saleResult(db,actor,input){guard(db,actor);const op=normalize(input,true);return db.runTransaction(async tx=>{
  const r=await records(tx,db,op.transactionId);if(!r.s&&!r.l&&!r.movements.size)return {transactionId:op.transactionId,outcome:'not-found'};
  try{const p=proof(r,op.transactionId);if(!(await tx.get(db.collection('salesSessions').doc(p.canonicalRequest.sessionId))).exists)fail('reconciliation-required');return reply(p,true);}catch(e){if(e.code!=='reconciliation-required')throw e;return {transactionId:op.transactionId,outcome:'reconciliation-required',currentSaleStatus:r.s?.status??null};}
},{readOnly:true});}
