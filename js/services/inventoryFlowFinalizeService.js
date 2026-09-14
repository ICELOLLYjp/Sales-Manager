import { getFirebaseState } from "../firebase.js";
import { calculateEventInventoryState } from "./inventoryFlowService.js?v=20260913-inventory-flow-1";

const TRACKED_CATEGORIES = new Set(["tshirt","pierce","earring","drop_pierce","drop_earring"]);

async function firestoreModule(){
  return await import("https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js");
}
async function requireDb(){
  const {db,enabled}=getFirebaseState();
  if(!enabled||!db) throw new Error("Firebase is not connected.");
  return db;
}
const text=v=>String(v??"").trim();
const int=v=>Number.isFinite(Number(v))?Math.trunc(Number(v)):0;
const nn=v=>Math.max(0,int(v));

function finalCheckpoint(session){
  const rows=Array.isArray(session?.inventoryCount?.checkpoints)?session.inventoryCount.checkpoints:[];
  return [...rows].filter(r=>text(r?.type)==="final_count")
    .sort((a,b)=>text(a?.capturedAtIso).localeCompare(text(b?.capturedAtIso))).at(-1)||null;
}
function checkpointMap(cp){
  return new Map((Array.isArray(cp?.items)?cp.items:[]).map(r=>[text(r?.variantId),nn(r?.physicalQty)]).filter(([id])=>id));
}
function signature(session,cp){
  const state=calculateEventInventoryState(session);
  return JSON.stringify({
    status:text(session?.status),
    finalCheckpointId:text(cp?.id),
    finalCheckpointAt:text(cp?.capturedAtIso),
    flowCount:state.flowEntries.length,
    soldByVariant:state.soldByVariant
  });
}

async function loadPreflight(sessionId){
  const db=await requireDb();
  const {doc,collection,query,where,getDocFromServer,getDocsFromServer}=await firestoreModule();
  const sessionRef=doc(db,"salesSessions",sessionId);
  const [sessionSnap,salesSnap]=await Promise.all([
    getDocFromServer(sessionRef),
    getDocsFromServer(query(collection(db,"salesTransactions"),where("sessionId","==",sessionId)))
  ]);
  if(!sessionSnap.exists()) throw new Error("販売セッションが見つかりません。");
  const session=sessionSnap.data();
  if(session?.status==="closed") return {alreadyClosed:true,session,sessionRef};
  if(session?.status!=="open") throw new Error("このイベントは終了できる状態ではありません。");

  const cp=finalCheckpoint(session);
  if(!cp){
    const e=new Error("先に「最終実数として保存」を実行してください。"); e.code="final-count-missing"; throw e;
  }

  const state=calculateEventInventoryState(session);
  const physical=checkpointMap(cp);

  const incomplete=state.rows.filter(r=>!physical.has(r.variantId));
  if(incomplete.length){
    const e=new Error(`最終実数が未確認のSKUが ${incomplete.length} 件あります。途中カウントから再利用できるSKUは自動入力されるので、残りだけ確認してください。`);
    e.code="final-count-incomplete"; throw e;
  }

  const mismatches=state.rows.map(r=>({row:r,actualQty:physical.get(r.variantId),difference:physical.get(r.variantId)-r.expectedQty}))
    .filter(x=>x.difference!==0);
  if(mismatches.length){
    const examples=mismatches.slice(0,3).map(({row,actualQty})=>`${text(row.label||row.sku||row.variantId)}: 予測 ${row.expectedQty} / 実数 ${actualQty}`).join("、");
    const e=new Error(`在庫差異が ${mismatches.length} SKUあります。まず「補充」または「修正」で理由が分かる差分を反映してください。${examples?` ${examples}`:""}`);
    e.code="inventory-difference-unresolved"; e.mismatches=mismatches; throw e;
  }

  let quickTrackedTotal=0, outsideTotal=0;
  const stateIds=new Set(state.rows.map(r=>r.variantId));
  salesSnap.docs.forEach(s=>{
    const sale=s.data(); if(sale?.status==="voided") return;
    (Array.isArray(sale?.items)?sale.items:[]).forEach(item=>{
      const qty=nn(item?.quantity); if(!qty) return;
      const cat=text(item?.category); if(!TRACKED_CATEGORIES.has(cat)) return;
      const vid=text(item?.variantId);
      if(!vid) quickTrackedTotal+=qty;
      else if(!stateIds.has(vid)) outsideTotal+=qty;
    });
  });
  if(quickTrackedTotal){
    const e=new Error(`Tシャツ・アクセサリーのQuick未割当販売が ${quickTrackedTotal} 点あります。正式終了前にSKUへの割当が必要です。`);
    e.code="quick-sales-unallocated"; throw e;
  }
  if(outsideTotal){
    const e=new Error(`在庫運用に含まれないSKU販売が ${outsideTotal} 点あります。正式終了前に確認してください。`);
    e.code="sku-sales-outside-flow"; throw e;
  }

  const summary={
    skuCount:state.rows.length,
    totalExpected:state.rows.reduce((s,r)=>s+r.expectedQty,0),
    totalPhysical:state.rows.reduce((s,r)=>s+nn(physical.get(r.variantId)),0),
    restockTotal:state.rows.reduce((s,r)=>s+nn(r.restockQty),0),
    openingCorrectionTotal:state.rows.reduce((s,r)=>s+int(r.openingCorrection),0),
    exactSkuSalesTotal:state.rows.reduce((s,r)=>s+nn(r.skuSales),0)
  };
  return {alreadyClosed:false,session,sessionRef,checkpoint:cp,state,signature:signature(session,cp),summary};
}

export async function finalizeEventFromInventoryFlow({sessionId,closedByEmail=""}){
  const id=text(sessionId); if(!id) throw new Error("販売セッションを選択してください。");
  const pre=await loadPreflight(id);
  if(pre.alreadyClosed) return {sessionId:id,duplicate:true,status:"closed"};

  const db=await requireDb();
  const {doc,runTransaction,serverTimestamp}=await firestoreModule();
  const sessionRef=doc(db,"salesSessions",id);
  const lockRef=doc(db,"transactionLocks",`inventoryflowclose_${id}`);

  return await runTransaction(db,async transaction=>{
    const [lockSnap,sessionSnap]=await Promise.all([transaction.get(lockRef),transaction.get(sessionRef)]);
    if(lockSnap.exists()&&lockSnap.data()?.status==="committed") return {sessionId:id,duplicate:true,status:"closed"};
    if(!sessionSnap.exists()) throw new Error("販売セッションが見つかりません。");
    const current=sessionSnap.data();
    if(current?.status==="closed") return {sessionId:id,duplicate:true,status:"closed"};
    if(current?.status!=="open") throw new Error("このイベントは終了できる状態ではありません。");

    const currentFinal=finalCheckpoint(current);
    if(signature(current,currentFinal)!==pre.signature){
      const e=new Error("終了確認後に売上または在庫データが変わりました。画面を更新して、最終実数を確認し直してください。");
      e.code="event-data-changed"; throw e;
    }

    transaction.update(sessionRef,{
      status:"closed",
      closedAt:serverTimestamp(),
      closedByEmail:text(closedByEmail),
      "inventoryCount.finalization":{
        version:2,
        method:"inventory_flow",
        finalCheckpointId:text(pre.checkpoint?.id),
        finalCheckpointAtIso:text(pre.checkpoint?.capturedAtIso),
        skuCount:pre.summary.skuCount,
        totalExpected:pre.summary.totalExpected,
        totalPhysical:pre.summary.totalPhysical,
        restockTotal:pre.summary.restockTotal,
        openingCorrectionTotal:pre.summary.openingCorrectionTotal,
        exactSkuSalesTotal:pre.summary.exactSkuSalesTotal,
        differenceTotal:0,
        stockMutationAppliedAtClose:false
      },
      "inventoryCount.finalizedAt":serverTimestamp(),
      "inventoryCount.finalizedByEmail":text(closedByEmail),
      updatedAt:serverTimestamp()
    });
    transaction.set(lockRef,{
      sessionId:id,status:"committed",type:"inventory_flow_close",
      finalCheckpointId:text(pre.checkpoint?.id),createdAt:serverTimestamp()
    });
    return {sessionId:id,duplicate:false,status:"closed",summary:pre.summary};
  });
}
