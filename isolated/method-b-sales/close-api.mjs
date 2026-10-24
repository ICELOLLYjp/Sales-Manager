// Isolated fixture API only. No production entry point or client-selected adapter options.
import {FieldPath} from 'firebase-admin/firestore';
import {assertIsolated,PROJECT,UIDS} from './runtime.mjs';
import {keys,id,hash,integer,fail,object} from './validation.mjs';
import {realFlowAdapter} from './real-flow-adapter.mjs';
const sessionPath='salesSessions/s',lockPath='transactionLocks/eventclose_s';
const core=x=>Object.fromEntries(Object.entries(x).filter(([k])=>!['createdAt','updatedAt'].includes(k)));
const data=s=>s.docs.map(d=>({id:d.id,data:d.data()}));
export const closeStateHash=state=>hash({version:1,sessionId:'s',...state});
export async function closeState(tx,db){
  const [s,stock,sales]=await Promise.all([
    tx.get(db.doc(sessionPath)),tx.get(db.doc('tshirtStock/master')),
    tx.get(db.collection('salesTransactions').where('sessionId','==','s'))
  ]);
  if(!s.exists||!stock.exists)fail('close-state-missing');
  return {session:s.data(),stock:stock.data(),sales:data(sales)};
}
function supported({session:s,stock,sales}){
  const c=s.inventoryCount,o=c?.opening?.items,closing=c?.closing?.items;
  if(s.status!=='open'||s.type!=='event'||s.currency!=='JPY'||s.eventCloseId||s.eventCloseSummary||c?.eventFlowCloseRecovery||c?.eventFlowReconciliation)fail('close-review-required');
  if(!Array.isArray(c?.quickAllocations??[])||(c.quickAllocations??[]).length)fail('quick-not-supported');
  // Intentionally one known fixture coordinate; extending SKU coverage needs separate tests.
  if(!Array.isArray(o)||o.length!==1||o[0].variantId!=='t'||o[0].category!=='tshirt'||o[0].inventorySource!=='tshirt'||o[0].inventoryKey!=='tshirt:b|d|c|s'||!integer(o[0].openingQty)||o[0].openingQty<0)fail('unsupported-opening');
  if(!Array.isArray(closing)||closing.length!==1||closing[0].variantId!=='t'||!integer(closing[0].closingQty)||closing[0].closingQty<0)fail('unsupported-closing');
  for(const [k,v] of Object.entries(closing[0]))if(k!=='variantId'&&(!['closingQty','loss','theft','damage','gift','sample','stockAdjustment'].includes(k)||!integer(v)||v<0))fail('unsupported-closing');
  if(!Array.isArray(c.flowEntries??[])||(c.flowEntries??[]).some(f=>!object(f)||f.type!=='restock'||f.variantId!=='t'||!integer(f.quantity)||f.quantity<0))fail('unsupported-flow');
  if(!integer(stock.inventoryRevision)||stock.inventoryRevision<0||stock.inventoryRevision===Number.MAX_SAFE_INTEGER||!integer(stock.inventory_v2?.b?.d?.c?.s?.qty))fail('invalid-stock');
  for(const {data:sale} of sales)if(!['completed','voided'].includes(sale.status)||!Array.isArray(sale.items)||!sale.items.length||sale.items.some(i=>i.trackingMode!=='sku'||i.variantId!=='t'||i.category!=='tshirt'||i.inventorySource!=='tshirt'||i.inventoryKey!=='tshirt:b|d|c|s'||!integer(i.quantity)||i.quantity<1))fail('unsupported-sale');
}
async function movements(tx,db){
  const [byId,prefix]=await Promise.all([
    tx.get(db.collection('inventoryMovements').where('eventCloseId','==','eventclose_s')),
    tx.get(db.collection('inventoryMovements').orderBy(FieldPath.documentId()).startAt('eventclose_s__').endAt('eventclose_s__\uf8ff'))
  ]);
  return Object.fromEntries([...byId.docs,...prefix.docs].map(d=>[d.id,core(d.data())]));
}
export function closeAPI(rt,hooks={}){
  assertIsolated();if(rt.db.projectId!==PROJECT)throw Error('wrong-demo-project');
  return async(actor,input)=>{
    assertIsolated();
    if(!UIDS.includes(actor?.uid)||actor.email_verified!==true||actor.email!==`${actor.uid}@example.test`)fail('forbidden',403);
    keys(input,['version','sessionId','operationId','expectedStateHash']);id(input.operationId);
    if(input.version!==1||input.sessionId!=='s'||typeof input.expectedStateHash!=='string'||!/^[a-f0-9]{64}$/.test(input.expectedStateHash))fail('invalid-close-input',400);
    const requestHash=hash(input);let attempts=0;
    return rt.db.runTransaction(async tx=>{
      await hooks.beforeAttempt?.(++attempts);
      const state=await closeState(tx,rt.db),lock=(await tx.get(rt.db.doc(lockPath))).data(),existing=await movements(tx,rt.db);
      if(lock||state.session.status==='closed'||Object.keys(existing).length){
        const p=lock?.serverCloseV1;
        if(!p||p.version!==1||p.requestHash!==requestHash||p.actorUid!==actor.uid||p.actorEmail!==actor.email)fail('close-intent-conflict');
        if(lock.status!=='committed'||lock.action!=='event_close'||lock.sessionId!=='s'||lock.transactionId!=='eventclose_s'||state.session.status!=='closed'||state.session.eventCloseId!=='eventclose_s'||state.session.closedByEmail!==p.actorEmail||state.session.inventoryCount?.eventFlowCloseRecovery||hash(state.session.eventCloseSummary)!==hash(p.summary)||hash(existing)!==hash(p.movements)||p.resultHash!==hash(p.result)||p.requestHash!==hash(p.request)||lock.movementCount!==Object.keys(existing).length)fail('close-reconciliation-required');
        return p.result;
      }
      supported(state);
      if(closeStateHash(state)!==input.expectedStateHash)fail('close-state-changed');
      await hooks.afterReads?.();
      let summary,recordedMovements={};
      const flow=await realFlowAdapter(rt.db,{
        atomic:true,transactionScope:tx,beforeWrite:hooks.beforeWrite,beforeCommit:hooks.beforeCommit,
        beforeFlush:({writes,result})=>{
          if(result.duplicate||result.status!=='closed')fail('close-review-required');
          for(const [method,args] of writes){
            if(args[0].path===sessionPath&&method==='update'){
              if(args[1].eventCloseSummary)summary={...args[1].eventCloseSummary};
              for(const [key,value] of Object.entries(args[1]))if(key.startsWith('eventCloseSummary.'))summary[key.slice(18)]=value;
            }
            if(args[0].parent.id==='inventoryMovements'&&method==='set')recordedMovements[args[0].id]=core(args[1]);
          }
          if(!summary)fail('close-summary-missing');
        }
      });
      // Every source read and every write (including identity) belongs to this transaction.
      await flow.finalizeEventSession({sessionId:'s',closedByEmail:actor.email});
      const response={version:1,sessionId:'s',operationId:input.operationId,status:'closed',requestHash,summary};
      tx.update(rt.db.doc(lockPath),{serverCloseV1:{version:1,request:input,requestHash,actorUid:actor.uid,actorEmail:actor.email,result:response,resultHash:hash(response),summary,movements:recordedMovements}});
      return response;
    },{maxAttempts:3});
  };
}
