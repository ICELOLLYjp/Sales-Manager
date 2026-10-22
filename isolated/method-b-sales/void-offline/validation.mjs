import {createHash} from 'node:crypto';
export class ApiError extends Error {constructor(status,code){super(code);this.status=status;this.code=code;}}
export const fail=(code,status=409)=>{throw new ApiError(status,code);};
export const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
export const integer=x=>Number.isSafeInteger(x)&&!Object.is(x,-0);
export function keys(x,list){if(!object(x)||Object.keys(x).length!==list.length||list.some(k=>!Object.hasOwn(x,k)))fail('invalid-schema',400);}
export function id(x){if(typeof x!=='string'||!x||x!==x.trim()||Buffer.byteLength(x)>256||/[\u0000-\u001f\u007f/]/u.test(x)||/^[.]{1,2}$|^__.*__$/.test(x)||['constructor','prototype'].includes(x))fail('invalid-id',400);return x;}
export const canonical=x=>Array.isArray(x)?x.map(canonical):object(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
export const hash=x=>createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
export function normalize(x,query=false){
  keys(x,query?['version','transactionId']:['version','transactionId','sessionId','currency','items','orderDiscount','paymentMethod','expectedContextHash']);
  if(x.version!==1)fail('invalid-version',400);id(x.transactionId);if(query)return x;
  id(x.sessionId);if(x.currency!=='JPY'||x.paymentMethod!=='manual'||x.orderDiscount!==0||Object.is(x.orderDiscount,-0)||typeof x.expectedContextHash!=='string'||!/^[a-f0-9]{64}$/.test(x.expectedContextHash))fail('unsupported-sale',400);
  if(!Array.isArray(x.items)||x.items.length<1||x.items.length>20)fail('invalid-items',400);
  const seen=new Set();for(const row of x.items){keys(row,['lineId','variantId','quantity','unitPrice','setDiscount','manualDiscount']);id(row.lineId);id(row.variantId);
    if(seen.has(row.lineId)||!integer(row.quantity)||row.quantity<1||row.quantity>1000||!integer(row.unitPrice)||row.unitPrice<0||row.unitPrice>1000000||!integer(row.setDiscount)||row.setDiscount!==0||!integer(row.manualDiscount)||row.manualDiscount!==0)fail('invalid-line',400);seen.add(row.lineId);}
  return x;
}
// JSON.parse validates grammar; this second pass rejects duplicate decoded keys.
export function parseJSON(raw){
  let result;try{result=JSON.parse(raw);}catch{fail('invalid-json',400);}let i=0;
  const ws=()=>{while(/\s/.test(raw[i]||'x'))i++;};
  function string(){const start=i++;while(i<raw.length){if(raw[i]==='\\'){i+=2;continue;}if(raw[i++]==='"')return JSON.parse(raw.slice(start,i));}}
  function value(depth=0){if(depth>32)fail('json-depth',400);ws();if(raw[i]==='"'){string();return;}
    if(raw[i]==='{'){i++;ws();const seen=new Set();if(raw[i]==='}'){i++;return;}while(true){ws();const key=string();if(seen.has(key))fail('duplicate-json-key',400);seen.add(key);ws();i++;value(depth+1);ws();if(raw[i++]==='}')return;}}
    if(raw[i]==='['){i++;ws();if(raw[i]===']'){i++;return;}while(true){value(depth+1);ws();if(raw[i++]===']')return;}}
    while(i<raw.length&&!/[\s,\]}]/.test(raw[i]))i++;
  }value();return result;
}
