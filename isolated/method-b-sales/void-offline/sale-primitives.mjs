// Exact contiguous extraction from fixed sales.mjs, before guard/db code.
import {hash,object,integer,fail,id} from './validation.mjs';
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

export {target,cell,clone,core,rev,safe};
