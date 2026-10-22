import fixture from './fixture.mjs';
import {hash} from './validation.mjs';
const copy=x=>structuredClone(x);
export const audit={email:'reviewer@example.test',time:{seconds:1792540800,nanoseconds:123000000}};
export const sessionRef={id:'s',exists:true};
export function baseline(){
  const original={sale:copy(fixture['salesTransactions/sale_multi']),lock:copy(fixture['transactionLocks/sale_multi']),
    movements:Object.fromEntries(Object.entries(fixture).filter(([k])=>k.startsWith('inventoryMovements/')).map(([k,v])=>[k.split('/')[1],copy(v)]))};
  return {original,trustedAnchor:hash(original),intent:{version:1,transactionId:'sale_multi',expectedSaleRequestHash:original.lock.serverSaleV1.requestHash,reason:'manual_void'},
    state:{session:copy(fixture['salesSessions/s']),stocks:Object.fromEntries(['tshirtStock/master','accessoryStock/shared'].map(k=>[k,copy(fixture[k])]))},
    expectedRevisions:{'tshirtStock/master':1,'accessoryStock/shared':1}};
}
// Independent literal expectations transcribed from main voidSaleTransaction fields.
// No eventInventoryApplied field in legacy return documents; one document per row.
export const expectedReturns=[
  {movementId:'sale_multi__void__1',transactionId:'sale_multi',reversalOfTransactionId:'sale_multi',sessionId:'s',type:'return',reason:'return',sourceAction:'sale_void',category:'tshirt',label:'Shirt',quantity:1,expectedInventoryDelta:1,appliedInventoryDelta:1,inventoryApplied:true,trackingMode:'sku',variantId:'t',inventoryKey:'tshirt:b|d|c|s',inventorySource:'tshirt',status:'applied',createdAt:audit.time},
  {movementId:'sale_multi__void__2',transactionId:'sale_multi',reversalOfTransactionId:'sale_multi',sessionId:'s',type:'return',reason:'return',sourceAction:'sale_void',category:'tshirt',label:'Shirt',quantity:2,expectedInventoryDelta:2,appliedInventoryDelta:2,inventoryApplied:true,trackingMode:'sku',variantId:'t',inventoryKey:'tshirt:b|d|c|s',inventorySource:'tshirt',status:'applied',createdAt:audit.time},
  {movementId:'sale_multi__void__3',transactionId:'sale_multi',reversalOfTransactionId:'sale_multi',sessionId:'s',type:'return',reason:'return',sourceAction:'sale_void',category:'pierce',label:'pierce',quantity:1,expectedInventoryDelta:1,appliedInventoryDelta:1,inventoryApplied:true,trackingMode:'sku',variantId:'a',inventoryKey:'accessory:a|piercing',inventorySource:'accessory',status:'applied',createdAt:audit.time}
];
