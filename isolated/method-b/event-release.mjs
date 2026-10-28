import { Timestamp } from 'firebase-admin/firestore';
import { ApiError, hash } from './inventory.mjs';

// Isolated consumer only. No endpoint or automatic reconciliation/approval writer.
// Mirrors native eventCloseService's salesSessions + salesTransactions/sessionId.
const reject=()=>{throw new ApiError(409,'event-reconciliation-required');};
const version=s=>({seconds:s.updateTime.seconds,nanoseconds:s.updateTime.nanoseconds});
const describe=s=>({path:s.ref.path,version:version(s),dataHash:hash(s.data())});
const validDigest=x=>typeof x==='string' && /^[a-f0-9]{64}$/.test(x);
export function assertEventReleaseProof(proof,op) {
  const r=proof?.reconciliation;
  if(proof?.schema!=='event-release-proof-v1' || !r
    || r.schema!=='event-release-reconciliation-v1' || r.operationHash!==hash(op)
    || r.sourceHash!==hash(proof.sourceManifest) || !validDigest(r.sourceHash)
    || r.physicalCountReviewed!==true || r.allDevicesSynced!==true
    || r.salesAndVoidsReviewed!==true || r.unresolvedCount!==0
    || r.manualReleaseApproved!==true || !(r.reviewedAt instanceof Timestamp)
    || typeof r.reviewId!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(r.reviewId)
    || proof.sourceManifest?.session?.path!==`salesSessions/${op.source.documentId}`
    || !Array.isArray(proof.sourceManifest?.transactions)
    || proof.sourceManifest.transactions.length>1000) reject();
}

export async function readEventReleaseProof(tx,db,op) {
  if(op.source.namespace!=='sales-manager') reject();
  const sessionRef=db.doc(`salesSessions/${op.source.documentId}`);
  // No caller-selected collection/path or caller-supplied completeness flag.
  const reviewRef=db.doc(`inventoryEventReconciliations/${hash(op)}`);
  const [session,review]=await tx.getAll(sessionRef,reviewRef);
  const sales=await tx.get(db.collection('salesTransactions')
    .where('sessionId','==',op.source.documentId).limit(1001));
  if(!session.exists || !review.exists || sales.size>1000) reject();
  const data=session.data();
  if(data.status!=='closed' || !(data.closedAt instanceof Timestamp)
    || !(data.inventoryCount?.finalizedAt instanceof Timestamp)
    || !(data.inventoryCount?.adjustmentsAppliedAt instanceof Timestamp)
    || data.eventCloseSummary?.unclassifiedDifference!==0) reject();
  const proof={schema:'event-release-proof-v1',sourceManifest:{
    session:describe(session),transactions:sales.docs.map(describe).sort((a,b)=>a.path.localeCompare(b.path))
  },reconciliation:review.data()};
  assertEventReleaseProof(proof,op);
  return proof;
}
