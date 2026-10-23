// Unconnected Method B core. Dependencies belong to the trusted server adapter,
// never HTTP input. No SDK, storage, auth loader, clock, or production gate switch.
import {hash,keys,fail,normalize} from './validation.mjs';
import {target,cell} from './sale-primitives.mjs';
import {normalizeVoid,verifyOriginal} from './void-pure.mjs';
import {boundaryPlan} from './void-boundary.mjs';
const check=x=>{if(!x)fail('reconciliation-required');};
const schema='void-server-v1';
export function protectedVoid({codec,allowedUids,isServerSentinel,authorizeRead}){
  const uids=new Set(allowedUids),plans=new WeakMap();
  // authorizeRead must attest origin AND protected writer migration for this
  // complete snapshot. A schema flag/digest/UID inside stored data is not trust.
  function authorized(value){
    if(typeof authorizeRead!=='function'||authorizeRead(value)!==true)fail('protected-writer-boundary-unproven',503);
  }
  function actorChecked(value){const a=codec.copy(value);keys(a,['uid','email','email_verified']);
    check(uids.has(a.uid)&&a.email_verified===true&&typeof a.email==='string'&&a.email.length>0);return a;}
  function originalChecked(o){
    codec.stamp(o.sale.createdAt);codec.stamp(o.sale.updatedAt);codec.stamp(o.lock.createdAt);
    for(const m of Object.values(o.movements))codec.stamp(m.createdAt);
    check(uids.has(o.lock.serverSaleV1.actorUid));const dto=codec.dto(o);verifyOriginal(dto,hash(dto));
  }
  function sessionChecked(ref,id){keys(ref,['id','exists']);check(ref.exists===true&&ref.id===id);}
  // Save only quantities/revisions and summary inputs needed to recompute the
  // reversal. Do not persist entire current stock documents or session metadata.
  function compact(b){
    const stocks={};
    const own=(o,k)=>{if(!Object.hasOwn(o,k))Object.defineProperty(o,k,{value:{},writable:true,enumerable:true,configurable:true});return o[k];};
    for(const x of b.original.sale.items){const t=target(x),src=b.state.stocks[t.path],q=cell(src,t)[0][cell(src,t)[1]];
      const dst=stocks[t.path]??={inventoryRevision:src.inventoryRevision??0};
      if(t.source==='tshirt'){let c=dst.inventory_v2??={};for(const k of t.parts)c=own(c,k);c.qty=q;}
      else {dst.designs??=[];let d=dst.designs.find(d=>d.id===t.parts[0]);if(!d){d={id:t.parts[0]};dst.designs.push(d);}d[t.parts[1]]=q;}
    }
    const s=b.state.session;
    return {session:{status:s.status,currency:s.currency,salesSummary:codec.copy(s.salesSummary),
      ...(b.original.sale.items.some(x=>x.eventInventoryApplied)?{inventoryCount:{soldByVariant:codec.copy(s.inventoryCount?.soldByVariant)}}:{})},stocks};
  }
  function build(b,actor,time){
    originalChecked(b.original);const intent=normalizeVoid(b.intent),dto=codec.dto(b.original);
    const calc=boundaryPlan({original:dto,trustedAnchor:hash(dto),intent,state:codec.dto(b.state),expectedRevisions:b.expectedRevisions},{email:actor.email,time:{seconds:0,nanoseconds:0}});
    const semantic={schema,actor,intent,original:b.original,originalHash:codec.digest(b.original),
      beforeState:compact(b),expectedRevisions:b.expectedRevisions,result:calc.result};
    // No unresolved Timestamp/sentinel enters a hash; createdAt is a separate
    // audit field validated against sale/lock/returns on the read boundary.
    const proof={...semantic,semanticHash:codec.digest(semantic),createdAt:time};
    check(Buffer.byteLength(JSON.stringify(codec.dto(semantic)))<400000);
    const tid=intent.transactionId,sale={...b.original.sale,status:'voided',voidReason:intent.reason,voidedByEmail:actor.email,voidedAt:time,updatedAt:time};
    const lock={...b.original.lock,status:'voided',voidedAt:time,serverVoidV1:proof},movements={...b.original.movements};
    for(let i=0;i<sale.items.length;i++){const mid=tid+'__void__'+(i+1);movements[mid]={...calc.movements[mid],createdAt:time};}
    const writes=[];
    for(const path of Object.keys(b.expectedRevisions)){
      const stock=codec.copy(b.state.stocks[path]);
      for(const x of sale.items){const t=target(x);if(t.path!==path)continue;const [c,k]=cell(stock,t);c[k]=cell(calc.stocks[path],t)[0][k];}
      writes.push({op:'update',path,data:{...(path==='tshirtStock/master'?{inventory_v2:stock.inventory_v2}:{designs:stock.designs}),inventoryRevision:calc.stocks[path].inventoryRevision,inventoryWriteProtocol:1,updatedAt:time}});
    }
    writes.push({op:'update',path:'salesTransactions/'+tid,data:{status:sale.status,voidReason:sale.voidReason,voidedByEmail:actor.email,voidedAt:time,updatedAt:time}});
    writes.push({op:'update',path:'transactionLocks/'+tid,data:{status:'voided',voidedAt:time,serverVoidV1:proof}});
    for(let i=0;i<sale.items.length;i++){const mid=tid+'__void__'+(i+1);writes.push({op:'create',path:'inventoryMovements/'+mid,data:movements[mid]});}
    writes.push({op:'update',path:'salesSessions/'+sale.sessionId,data:{salesSummary:calc.session.salesSummary,
      ...(sale.items.some(x=>x.eventInventoryApplied)?{'inventoryCount.soldByVariant':calc.session.inventoryCount.soldByVariant,'inventoryCount.salesUpdatedAt':time}:{}),lastVoidAt:time,updatedAt:time}});
    return {sale,lock,movements,writes,result:calc.result};
  }
  function prepare(snapshot,actor){
    authorized(snapshot);const b=codec.copy(snapshot);keys(b,['original','intent','state','expectedRevisions','sessionRef']);
    sessionChecked(b.sessionRef,b.original.sale.sessionId);const a=actorChecked(actor);
    // Validate before creating a plan; the private plan is not a DB receipt.
    build(b,a,null);const plan=Object.freeze({transactionId:b.intent.transactionId});plans.set(plan,{b,a});return plan;
  }
  function writes(plan,sentinel){check(plans.has(plan)&&isServerSentinel(sentinel)===true);const {b,a}=plans.get(plan);return build(b,a,sentinel);}
  function verify(snapshot){
    authorized(snapshot);const r=codec.copy(snapshot);keys(r,['sale','lock','movements','sessionRef']);
    const p=r.lock?.serverVoidV1;check(p?.schema===schema);codec.stamp(p.createdAt);
    const a=actorChecked(p.actor);sessionChecked(r.sessionRef,r.sale.sessionId);
    const expected=build({original:p.original,intent:p.intent,state:p.beforeState,expectedRevisions:p.expectedRevisions},a,p.createdAt);
    for(const k of ['sale','lock','movements'])check(codec.digest(r[k])===codec.digest(expected[k]));
    return expected;
  }
  function saleReplay(snapshot,input,query){
    const r=verify(snapshot),op=normalize(codec.copy(input),query),p=r.lock.serverSaleV1;
    check(op.transactionId===r.sale.transactionId&&(query||hash(op)===p.requestHash));
    return {transactionId:r.sale.transactionId,sessionId:r.sale.sessionId,outcome:'committed',replayed:true,
      requestHash:p.requestHash,result:codec.copy(p.result),currentSaleStatus:'voided'};
  }
  function voidReplay(snapshot,input){const r=verify(snapshot);check(hash(normalizeVoid(codec.copy(input)))===hash(r.lock.serverVoidV1.intent));return {...r.result,duplicate:true};}
  // Injectable transaction coordinator; not connected to any runtime. read must
  // gather the complete transactionId + document-prefix union, session and stock
  // snapshots inside THIS attempt. apply stages writes on this same transaction.
  // The port resolves runTransaction only after commit acknowledgement. Its real
  // implementation and query/authorization completeness remain integration gates.
  async function transact(port,actor,input){
    const a=actorChecked(actor),op=normalizeVoid(codec.copy(input));
    return await port.runTransaction(async tx=>{
      const snapshot=await port.read(tx,op);authorized(snapshot);
      if(snapshot.absent===true){
        keys(snapshot,['absent','transactionId','sale','lock','movements']);
        check(snapshot.transactionId===op.transactionId&&snapshot.sale===null&&snapshot.lock===null);
        keys(snapshot.movements,[]);return {transactionId:op.transactionId,outcome:'not-found'};
      }
      if(Object.hasOwn(snapshot,'original')){
        check(hash(snapshot.intent)===hash(op));const plan=prepare(snapshot,a),out=writes(plan,port.serverTimestamp());
        for(const w of out.writes)await port.apply(tx,w);
        return out.result;
      }
      return voidReplay(snapshot,op);
    },{maxAttempts:3});
  }
  return Object.freeze({prepare,writes,verify,voidReplay,transact,commitReplay:(s,i)=>saleReplay(s,i,false),resultReplay:(s,i)=>saleReplay(s,i,true)});
}

// Actual API activation remains impossible. The pure serializer above does not
// grant permission to call a database or prove an Admin commit acknowledgement.
export async function protectedVoidApi(){fail('void-integration-gate-closed',503);}
