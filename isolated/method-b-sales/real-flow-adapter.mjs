// Constructor-only demo harness. No route, credentials, product writes or IAM claim.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {FieldValue} from 'firebase-admin/firestore';
import {assertIsolated,PROJECT,UIDS} from './runtime.mjs';
import {realCloseAdapter} from './real-close-adapter.mjs';
const pins={
  eventCloseFlowCompatService:'d6ef7e4b0637c95d1d02c1de70f5bae8e5f16908272f01a163c050a0800209f9',
  eventFlowAccountingService:'c7c54f2183f7c7b725637d5ad53c9fca41f69ec1b546365144cf21be00a01031',
  eventCloseServiceCompat:'3827f1ff4e064bd220e699067a98e317e0a5523ac21dff815eb689a075c88432'
};
async function source(name){
  const code=(await fs.readFile(new URL(`../../js/services/${name}.js`,import.meta.url),'utf8')).replaceAll('\r\n','\n');
  if(createHash('sha256').update(code).digest('hex')!==pins[name])throw Error('flow-source-pin-mismatch: '+name);
  return code;
}
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
function replaceOnce(code,from,to){if(code.split(from).length!==2)throw Error('flow-import-boundary-changed');return code.replace(from,to);}
async function wrapper(name,base,sdk,db,summarizeEventFlow){
  let code=await source(name);
  code=replaceOnce(code,'import { getFirebaseState } from "../firebase.js";','');
  const parent=name==='eventCloseFlowCompatService'?'eventCloseServiceCompat.js?v=20260915-outside-opening-1':'eventCloseService.js?v=20260915-quick-allocation-list-1';
  code=replaceOnce(code,`import * as base from "./${parent}";`,'');
  if(name==='eventCloseFlowCompatService')code=replaceOnce(code,'import { summarizeEventFlow } from "./eventFlowAccountingService.js?v=20260916-flow-accounting-1";','');
  code=replaceOnce(code,'return await import("https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js");','return demoFirestore;');
  code=code.replace(/^export async function /gm,'async function ');
  if(/\bimport\s*(?:\(|\{|\*)|^export /m.test(code))throw Error('unexpected-flow-dependency');
  return new AsyncFunction('getFirebaseState','demoFirestore','base','summarizeEventFlow',code+'\nreturn {finalizeEventSession};')(()=>({db,enabled:true}),sdk,base,summarizeEventFlow);
}
const snapshot=s=>({id:s.id,ref:s.ref,exists:()=>s.exists,data:()=>s.data()});
const allowedKeys=new Set(['inventoryCount.opening.items','inventoryCount.eventFlowCloseRecovery','inventoryCount.eventFlowReconciliation','eventCloseSummary.openingTotal','eventCloseSummary.restockTotal','eventCloseSummary.openingCorrectionTotal','eventCloseSummary.flowAdjustedOpeningTotal','updatedAt']);

export async function realFlowAdapter(db,{atomic=true,beforeWrite,beforeTransaction,beforeCommit,transactionScope,beforeFlush}={}){
  assertIsolated();if(db.projectId!==PROJECT)throw Error('wrong-demo-project');
  if(transactionScope&&!atomic)throw Error('atomic-scope-required');
  const accounting=await source('eventFlowAccountingService');
  if(/\bimport\s*(?:\(|\{|\*)/m.test(accounting))throw Error('unexpected-accounting-import');
  const {summarizeEventFlow}=await import('data:text/javascript;base64,'+Buffer.from(accounting).toString('base64'));
  return {async finalizeEventSession(args){
    assertIsolated();
    // Deliberately bounded fixture authority. Never derive this allowlist from HTTP input.
    if(args?.sessionId!=='s'||!UIDS.some(uid=>args.closedByEmail===`${uid}@example.test`)||Object.keys(args).some(k=>!['sessionId','closedByEmail'].includes(k)))throw Error('unsupported-demo-close-authority');
    const execute=async tx=>{
      const writes=[];let sessionData,writeNumber=0;
      const scope=tx?{
        async get(ref){
          const s=await tx.get(ref);
          if(ref.path==='salesSessions/s'){
            sessionData??=s.data();return {id:s.id,ref:s.ref,exists:s.exists,data:()=>sessionData};
          }
          return s;
        },
        update:(...a)=>writes.push(['update',a]),set:(...a)=>writes.push(['set',a]),delete:(...a)=>writes.push(['delete',a])
      }:null;
      const get=ref=>scope?scope.get(ref):ref.get();
      const initial=await get(db.doc('salesSessions/s'));
      if(!initial.exists)throw Error('missing-demo-session');
      if(initial.data().inventoryCount?.quickAllocations?.some(a=>a.outsideOpening))throw Error('outside-opening-not-supported-in-flow-scope');
      if(initial.data().inventoryCount?.eventFlowCloseRecovery)throw Error('recovery-marker-requires-review');
      const sdk={
        doc:(d,...p)=>{if(d!==db)throw Error('wrong-demo-db');return d.doc(p.join('/'));},
        collection:(d,p)=>{if(d!==db)throw Error('wrong-demo-db');return d.collection(p);},where:(...a)=>a,
        query:(r,...clauses)=>clauses.reduce((q,a)=>q.where(...a),r),
        getDocFromServer:async ref=>snapshot(await get(ref)),getDocsFromServer:get,
        serverTimestamp:()=>FieldValue.serverTimestamp(),deleteField:()=>FieldValue.delete(),
        updateDoc:async(ref,patch)=>{
          if(ref.path!=='salesSessions/s'||Object.keys(patch).some(k=>!allowedKeys.has(k)))throw Error('unsupported-compat-write');
          await beforeWrite?.(++writeNumber,patch);
          if(!scope)return ref.update(patch);
          scope.update(ref,patch);
          // Read-your-writes for the real base preflight, while retaining Firestore values.
          sessionData={...sessionData,inventoryCount:{...sessionData.inventoryCount,opening:{...sessionData.inventoryCount.opening}},eventCloseSummary:{...sessionData.eventCloseSummary}};
          for(const [key,value] of Object.entries(patch)){
            const parts=key.split('.');let target=sessionData;
            for(const p of parts.slice(0,-1))target=target[p]??=( {} );
            target[parts.at(-1)]=value;
          }
        }
      };
      const realBase=await realCloseAdapter(db,{beforeTransaction,transactionScope:scope});
      const compat=await wrapper('eventCloseServiceCompat',realBase,sdk,db);
      const flow=await wrapper('eventCloseFlowCompatService',compat,sdk,db,summarizeEventFlow);
      const result=await flow.finalizeEventSession(args);
      if(tx)await beforeFlush?.({writes,result});
      if(tx)for(const [method,a] of writes)tx[method](...a);
      if(tx)await beforeCommit?.(tx);
      return result;
    };
    return transactionScope?execute(transactionScope):atomic?db.runTransaction(execute,{maxAttempts:3}):execute(null);
  }};
}
