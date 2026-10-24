// Standalone replacement; the previous guard remains untouched for recovery.
const dns=require('node:dns'),dgram=require('node:dgram');
const allowed=new Set(['127.0.0.1','::1','localhost']);
const deny=host=>{throw new Error('OUTBOUND_BLOCKED:'+host);};
const net=require('node:net'),connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
 // net.connect forwards an already-normalized argument array to Socket.connect.
 const [options,callback]=net._normalizeArgs(Array.isArray(args[0])?args[0]:args);
 const host=options.host||'localhost';
 if(options.path||!allowed.has(host))return deny(host);
 options.host=host==='localhost'?'127.0.0.1':host;
 return connect.call(this,options,...(callback?[callback]:[]));
};
const lookup=dns.lookup;
dns.lookup=function(host,...args){if(!allowed.has(host))return deny(host);return lookup.call(this,host==='localhost'?'127.0.0.1':host,...args);};
const promiseLookup=dns.promises.lookup;
dns.promises.lookup=async function(host,...args){if(!allowed.has(host))return deny(host);return promiseLookup.call(this,host==='localhost'?'127.0.0.1':host,...args);};
for(const target of [dns,dns.promises,dns.Resolver.prototype,dns.promises.Resolver.prototype]){
 for(const name of Object.getOwnPropertyNames(target))if(name.startsWith('resolve')||name==='reverse')target[name]=host=>deny(host);
}
dgram.Socket.prototype.send=function(){return deny('UDP');};
