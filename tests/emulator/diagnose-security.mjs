// Isolated design probes; synthetic identities, NOT deployable authorization.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import * as api from 'firebase/firestore';
import { saveInventoryEdit } from '../../js/inventory-concurrency.mjs';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8085');
const projectId='demo-icelolly-stage-a', path='tshirtStock/master';
const original=await fs.readFile(new URL('../../firestore.rules',import.meta.url),'utf8');
const startedAt=new Date().toISOString(), observations=[];
const config=rules=>({projectId,firestore:{host:'127.0.0.1',port:8085,rules}});
const baseline=()=>({inventoryRevision:0,inventory_v2:{a:{qty:5},b:{qty:8}},masters:{keep:true}});
async function probe(name,rules,fn) {
  const env=await initializeTestEnvironment(config(rules));
  try {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(c=>api.setDoc(api.doc(c.firestore(),path),baseline()));
    const result=await fn(env);
    observations.push({name,rules,...result});
  } finally { await env.cleanup(); }
}
try {
  await probe('P01 top-level diff allows nested inventory erasure',`rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /tshirtStock/master {
    allow read: if request.auth != null;
    allow update: if request.auth != null && request.resource.data.inventoryRevision == resource.data.inventoryRevision + 1
      && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['inventory_v2','inventoryRevision','inventoryWriteProtocol']);
  } } }`,async env=>{
    const db=env.authenticatedContext('fixture-admin').firestore(), ref=api.doc(db,path);
    await api.updateDoc(ref,{inventory_v2:{},inventoryRevision:1,inventoryWriteProtocol:1});
    const final=(await api.getDocFromServer(ref)).data();
    assert.deepEqual(final.inventory_v2,{}); assert.deepEqual(final.masters,{keep:true});
    return {classification:'danger reproduced, NOT a safety pass',final};
  });
  const fixtureRules=original.replace('return signedIn();',"return signedIn() && request.auth.uid in ['fixture-business','fixture-personal','fixture-backup'] && request.auth.token.email_verified == true;");
  await probe('P02 three synthetic verified UIDs pass; outsider/unverified/anonymous denied',fixtureRules,async env=>{
    let revision=0;
    for(const uid of ['fixture-business','fixture-personal','fixture-backup']) {
      const db=env.authenticatedContext(uid,{email_verified:true}).firestore();
      await api.updateDoc(api.doc(db,path),{inventoryRevision:++revision,inventoryWriteProtocol:1});
    }
    for(const [uid,claims] of [['fixture-outsider',{email_verified:true}],['fixture-business',{email_verified:false}],['fixture-anonymous',{firebase:{sign_in_provider:'anonymous'}}]]) {
      const db=env.authenticatedContext(uid,claims).firestore();
      for(const target of [path,'inventoryWriteReceipts/forged','salesTransactions/forged',path+'/audit/forged']) {
        await assertFails(api.getDocFromServer(api.doc(db,target)));
        await assertFails(api.setDoc(api.doc(db,target),{inventoryRevision:4,inventoryWriteProtocol:1}));
      }
    }
    return {classification:'isolated authorization feasibility only; production identities unknown',allowedSyntheticUids:3,deniedSyntheticContexts:3};
  });
  await probe('P03 known operation ID plus forged intent suppresses intended edit',original,async env=>{
    const db=env.authenticatedContext('fixture-admin').firestore(), ref=api.doc(db,path);
    const base=baseline(), fields={inventory_v2:{a:{qty:4},b:{qty:8}}}, id='known-planned-operation';
    const intent=createHash('sha256').update(JSON.stringify({path,revision:0,fields,strict:false,serverFields:[]})).digest('hex');
    const batch=api.writeBatch(db);
    batch.update(ref,{inventoryRevision:1,inventoryWriteProtocol:1,'inventory_v2.b.qty':7});
    batch.set(api.doc(db,'inventoryWriteReceipts',id),{path,intent,revision:1,createdAt:api.serverTimestamp()});
    await batch.commit();
    await saveInventoryEdit(api,db,ref,base,fields,id);
    const final=(await api.getDocFromServer(ref)).data();
    assert.equal(final.inventory_v2.a.qty,5); assert.equal(final.inventory_v2.b.qty,7); assert.equal(final.inventoryRevision,1);
    return {classification:'danger reproduced, NOT a safety pass',precondition:'attacker knows intended operation ID and payload; no UUID guessing claim',final};
  });
} finally {
  const env=await initializeTestEnvironment(config(original)); await env.cleanup();
}
const result={purpose:'Design probes, NOT application acceptance',startedAt,finishedAt:new Date().toISOString(),projectId,host:process.env.FIRESTORE_EMULATOR_HOST,node:process.version,sdk:'11.0.2',sourceSHA256:createHash('sha256').update(await fs.readFile(new URL(import.meta.url))).digest('hex'),observations};
await fs.writeFile(new URL('./artifacts/security-diagnostic.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(observations.map(({rules,...row})=>row),null,2));
