// Diagnostic experiments ONLY. Permissive controls must never be deployed.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDocFromServer, runTransaction } from 'firebase/firestore';

assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8085');
const projectId = 'demo-icelolly-stage-a';
const original = await fs.readFile(new URL('../../firestore.rules', import.meta.url), 'utf8');
const observations = [];
const startedAt = new Date().toISOString();
const step = "request.resource.data.inventoryRevision == resource.data.inventoryRevision + 1";
const variants = [
  ['D01-original', original],
  ['D02-update-only-true', 'allow update: if true;'],
  ['D03-write-true', 'allow write: if true;'],
  ['D04-update-revision', `allow update: if ${step};`],
  ['D05-write-revision', `allow write: if ${step};`],
  ['D06-write-null-guard', `allow write: if resource != null && ${step};`],
  ['D07-write-explicit-get', "allow write: if request.resource.data.inventoryRevision == get(/databases/$(database)/documents/tshirtStock/master).data.inventoryRevision + 1;"],
  ['D08-update-protocol-only', 'allow update: if request.resource.data.inventoryWriteProtocol == 1;'],
  ['D09-update-revision-create-true', `allow update: if ${step}; allow create: if true;`],
  ['D10-precondition-no-sdk-retry', 'allow update: if true;'],
  ['D11-revision-sequential', `allow update: if ${step};`],
];
try {
for (const [name, body] of variants) {
  const rules = name === 'D01-original' ? body : `rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /tshirtStock/master { allow read: if request.auth != null; ${body} } } }`;
  const env = await initializeTestEnvironment({projectId, firestore:{host:'127.0.0.1',port:8085,rules}});
  try {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(),'tshirtStock/master'),{inventoryRevision:0,inventoryWriteProtocol:1,n:0}));
    const db = env.authenticatedContext('diagnostic').firestore();
    const ref = doc(db,'tshirtStock/master');
    let firstRead, secondRead, firstDone;
    const gate1 = new Promise(r => firstRead=r), gate2 = new Promise(r=>secondRead=r), committed = new Promise(r=>firstDone=r);
    const attempts = [0,0];
    const increment = i => runTransaction(db, async tx => {
      attempts[i]++;
      const snap = await tx.get(ref);
      if (attempts[i]===1 && name !== 'D11-revision-sequential') {
        if(i===0) { firstRead(); await gate2; }
        else { secondRead(); await gate1; await committed; }
      }
      tx.update(ref,{n:snap.data().n+1,inventoryRevision:snap.data().inventoryRevision+1,inventoryWriteProtocol:1});
    }, name === 'D10-precondition-no-sdk-retry' ? {maxAttempts:1} : undefined);
    const a = increment(0).finally(()=>firstDone());
    if (name === 'D11-revision-sequential') await a;
    const results = await Promise.allSettled([a,increment(1)]);
    const final = (await getDocFromServer(ref)).data();
    const row = {name, rules, attempts, outcomes:results.map(r=>r.status==='fulfilled'?{status:'committed'}:{status:'rejected',code:r.reason.code,message:r.reason.message}), final};
    observations.push(row);
    console.log(JSON.stringify(row));
  } finally { await env.cleanup(); }
}
} finally {
// Restore even when a diagnostic fails. No production endpoint is used.
const restored = await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8085,rules:original}});
await restored.cleanup();
}
const evidence = {purpose:'Diagnostic observations, NOT safety acceptance tests',startedAt,finishedAt:new Date().toISOString(),projectId,host:process.env.FIRESTORE_EMULATOR_HOST,node:process.version,sdk:'11.0.2',emulator:'1.22.0',sourceSHA256:createHash('sha256').update(await fs.readFile(new URL(import.meta.url))).digest('hex'),rulesSHA256:createHash('sha256').update(original).digest('hex'),observations};
await fs.mkdir(new URL('./artifacts/',import.meta.url),{recursive:true});
await fs.writeFile(new URL('./artifacts/diagnostic.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');
