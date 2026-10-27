import { ApiError, hash } from './inventory.mjs';
export const WOO_ACTOR='fixture-woo-producer';
export const wooSource=e=>({namespace:`woo-${e.siteId}`,documentId:String(e.orderId),lineId:String(e.lineItemId)});
export const wooKey=source=>hash(source);
export function assertWooProof(proof,op) {
  const e=proof?.evidence;
  if(!e || proof.schema!=='woo-hold-proof-v1' || proof.intent!==hash(op)
    || op.kind!=='ec' || op.action!=='hold' || hash(op.source)!==hash(wooSource(e))
    || op.operationId!==`woo-${wooKey(op.source)}` || op.quantity!==e.quantity
    || op.stock!==e.stock || hash(op.sku)!==hash(e.sku)
    || e.status!=='pending' || e.paid!==false || e.refunded!=='0.00'
    || e.singleLine!==true || e.active!==true || !Number.isSafeInteger(e.revision) || e.revision<1)
    throw new ApiError(409,'woo-proof-required');
}
export async function readWooProof(tx,db,op) {
  const snap=await tx.get(db.doc(`inventoryWooIntents/${wooKey(op.source)}`));
  const row=snap.data();
  if(!row || row.state==='review_required' || hash(row.operation)!==hash(op)) throw new ApiError(409,'woo-review-required');
  const proof={schema:'woo-hold-proof-v1',intent:hash(op),evidence:row.evidence};
  assertWooProof(proof,op); return proof;
}
