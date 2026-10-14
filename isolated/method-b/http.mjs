import http from 'node:http';
import { ApiError, editInventory } from './inventory.mjs';
import { assertIsolated, UIDS } from './runtime.mjs';
// Only the test launcher starts this loopback server. No Functions export.
export function server({db,auth}) {
  assertIsolated();
  return http.createServer(async(req,res)=>{
    const send=(status,body)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
    try {
      if(req.method!=='POST'||req.url!=='/v1/inventory/manual-edit') throw new ApiError(404,'not-found');
      const match=/^Bearer (\S+)$/.exec(req.headers.authorization||'');
      if(!match) throw new ApiError(401,'unauthenticated');
      let claims;
      try { claims=await auth.verifyIdToken(match[1],true); } catch { throw new ApiError(401,'unauthenticated'); }
      if(!UIDS.includes(claims.uid)||claims.email_verified!==true) throw new ApiError(403,'forbidden');
      if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')) throw new ApiError(400,'json-required');
      let bytes=0, chunks=[];
      for await(const chunk of req) {bytes+=chunk.length;if(bytes>8192) throw new ApiError(413,'payload-too-large'); chunks.push(chunk);}
      let input;
      try {input=JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {throw new ApiError(400,'invalid-json');}
      send(200,await editInventory(db,claims.uid,input));
    } catch(error) {
      const status=error instanceof ApiError?error.status:[4,10,14].includes(error.code)?503:500;
      send(status,{error:error instanceof ApiError?error.code:status===503?'temporarily-unavailable':'internal-error'});
    }
  });
}
