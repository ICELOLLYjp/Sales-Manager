import http from 'node:http';
import {ApiError,parseJSON,fail} from './validation.mjs';
import {ApiError as VoidApiError} from './void-offline/validation.mjs';
import {commitSale,saleResult} from './sales.mjs';
import {assertIsolated,UIDS} from './runtime.mjs';
const unauth=new Set(['auth/argument-error','auth/invalid-id-token','auth/id-token-expired','auth/id-token-revoked','auth/user-disabled','auth/user-not-found']);
export function server(rt,hooks={}){assertIsolated();return http.createServer(async(req,res)=>{
  const send=(status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
  try{
    if(!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.localAddress))fail('loopback-required',403);
    if(req.method!=='POST'||!['/v1/sales/commit','/v1/sales/result','/v1/sales/void','/v1/events/close'].includes(req.url))fail('not-found',404);
    const token=/^Bearer (\S+)$/.exec(req.headers.authorization||'');if(!token)fail('unauthenticated',401);
    let actor;try{actor=await rt.auth.verifyIdToken(token[1],true);}catch(e){if(unauth.has(e.code))fail('unauthenticated',401);fail('auth-unavailable',503);}
    if(!UIDS.includes(actor.uid)||actor.email_verified!==true)fail('forbidden',403);
    if(!/^application\/json(?:;.*)?$/i.test(req.headers['content-type']||''))fail('invalid-content-type',400);
    const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>32768)fail('body-too-large',413);chunks.push(chunk);}
    let raw;try{raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}catch{fail('invalid-utf8',400);}const input=parseJSON(raw);
    if(req.url==='/v1/events/close'){
      if(!rt.closeEvent)fail('close-integration-gate-closed',503);
      send(200,await rt.closeEvent(actor,input));return;
    }
    const saleHooks={...hooks,...(rt.voidSales?{voidReplay:(kind,tx,op)=>rt.voidSales.replay(kind,tx,token[1],op)}:{})};
    if(req.url.endsWith('/void')&&!rt.voidSales)fail('void-integration-gate-closed',503);
    const result=req.url.endsWith('/void')?await rt.voidSales.void(token[1],input):req.url.endsWith('/commit')?await commitSale(rt.db,actor,input,saleHooks):await saleResult(rt.db,actor,input,saleHooks);
    send(200,result);
  }catch(e){const known=e instanceof ApiError||e instanceof VoidApiError;const status=known?e.status:[4,10,14].includes(e.code)?503:unauth.has(e.code)?401:500;send(status,{error:known?e.code:status===503?'temporarily-unavailable':status===401?'unauthenticated':'internal-error'});}
});}
