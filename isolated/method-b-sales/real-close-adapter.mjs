// Trusted test-only bridge. No HTTP route, product import side effects or Rules changes.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {FieldPath,FieldValue} from 'firebase-admin/firestore';
import {assertIsolated,PROJECT} from './runtime.mjs';

const pins = {
  '../../js/services/eventCloseService.js':'ff1310636b0180911777076abbe0f7f1b7d02a18981f18fe20bd83dfc7dba200',
  '../../js/inventory-concurrency.mjs':'6932a99faa26ff77268f242d8731a98df7b86b4343378dda965fd2be23cd9a71'
};
async function source(path) {
  const text=(await fs.readFile(new URL(path,import.meta.url),'utf8')).replaceAll('\r\n','\n');
  if(createHash('sha256').update(text).digest('hex')!==pins[path])throw Error('close-source-pin-mismatch: '+path);
  return text;
}
const snap=s=>({id:s.id,ref:s.ref,exists:()=>s.exists,data:()=>s.data()});
export async function realCloseAdapter(db,{beforeTransaction}={}) {
  assertIsolated();
  if(db.projectId!==PROJECT)throw Error('wrong-demo-project');
  const guarded=await source('../../js/inventory-concurrency.mjs');
  const {guardedTransaction}=await import('data:text/javascript;base64,'+Buffer.from(guarded).toString('base64'));
  const sdk={
    doc:(d,...parts)=>d.doc(parts.join('/')),
    collection:(d,path)=>d.collection(path),
    where:(...args)=>args,
    query:(ref,...clauses)=>clauses.reduce((q,args)=>q.where(...args),ref),
    getDocFromServer:async ref=>snap(await ref.get()),
    getDocsFromServer:ref=>ref.get(),
    FieldPath,serverTimestamp:()=>FieldValue.serverTimestamp(),
    runTransaction:async(d,fn)=>{
      assertIsolated();if(d!==db)throw Error('wrong-demo-db');
      // Deterministic scheduling after the REAL preflight, before its REAL final transaction.
      await beforeTransaction?.();
      return d.runTransaction(tx=>fn(guardedTransaction({
        get:async ref=>snap(await tx.get(ref)),
        update:(...args)=>tx.update(...args),set:(...args)=>tx.set(...args),delete:(...args)=>tx.delete(...args)
      })),{maxAttempts:3});
    }
  };
  let code=await source('../../js/services/eventCloseService.js');
  const stateImport='import { getFirebaseState } from "../firebase.js";';
  const sdkImport='return await import(\n    "../inventory-firestore.js"\n  );';
  if(!code.includes(stateImport)||!code.includes(sdkImport))throw Error('close-boundary-changed');
  code=code.replace(stateImport,'').replace(sdkImport,'return demoFirestore;').replace(/^export async function /gm,'async function ');
  if(/\bimport\s*(?:\(|\{)|^export /m.test(code))throw Error('unexpected-close-dependency');
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const service=await new AsyncFunction('getFirebaseState','demoFirestore',code+'\nreturn {finalizeEventSession};')(()=>({db,enabled:true}),sdk);
  return service;
}
