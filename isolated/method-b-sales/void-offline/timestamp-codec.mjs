// Unconnected codec contract. The trusted reader must supply provenance; instance
// checks alone cannot distinguish Object.create(Timestamp.prototype) forgeries.
import {types} from 'node:util';
import {hash,fail,integer} from './validation.mjs';
const check=x=>{if(!x)fail('reconciliation-required');};
export function timestampCodec(Timestamp,fromTrustedRead){
  check(typeof Timestamp==='function'&&typeof fromTrustedRead==='function');
  function stamp(x){
    check(x!==null&&typeof x==='object'&&!types.isProxy(x));
    check(Object.getPrototypeOf(x)===Timestamp.prototype&&fromTrustedRead(x)===true);
    const seconds=x.seconds,nanoseconds=x.nanoseconds;
    check(integer(seconds)&&seconds>=-62135596800&&seconds<=253402300799);
    check(integer(nanoseconds)&&nanoseconds>=0&&nanoseconds<1000000000);
    return {seconds,nanoseconds};
  }
  function walk(x,mode,seen=new Set(),depth=0){
    check(depth<=64);
    if(x===null||typeof x==='string'||typeof x==='boolean')return mode==='typed'?[typeof x,x]:x;
    if(typeof x==='number'){check(Number.isFinite(x)&&!Object.is(x,-0));return mode==='typed'?['number',x]:x;}
    check(typeof x==='object'&&x!==null&&!types.isProxy(x)&&!seen.has(x));
    if(Object.getPrototypeOf(x)===Timestamp.prototype){const t=stamp(x);return mode==='typed'?['timestamp',t.seconds,t.nanoseconds]:mode==='dto'?t:x;}
    check(Array.isArray(x)?Object.getPrototypeOf(x)===Array.prototype:Object.getPrototypeOf(x)===Object.prototype);
    const ks=Reflect.ownKeys(x);check(ks.every(k=>typeof k==='string'));
    if(Array.isArray(x))check(ks.length===x.length+1&&ks.every(k=>k==='length'||/^(0|[1-9][0-9]*)$/.test(k)));
    seen.add(x);const pairs=[];
    for(const k of ks.filter(k=>!(Array.isArray(x)&&k==='length')).sort()){
      const d=Object.getOwnPropertyDescriptor(x,k);check(d.enumerable&&Object.hasOwn(d,'value'));
      pairs.push([k,walk(d.value,mode,seen,depth+1)]);
    }
    seen.delete(x);
    if(mode==='typed')return [Array.isArray(x)?'array':'object',pairs];
    return Array.isArray(x)?Array.from({length:x.length},(_,i)=>pairs.find(([k])=>k===String(i))[1]):Object.fromEntries(pairs);
  }
  return Object.freeze({stamp,dto:x=>walk(x,'dto'),copy:x=>walk(x,'copy'),digest:x=>hash(walk(x,'typed'))});
}
