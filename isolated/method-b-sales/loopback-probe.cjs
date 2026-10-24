const assert=require('node:assert/strict'),net=require('node:net'),dns=require('node:dns'),tls=require('node:tls'),dgram=require('node:dgram');
async function main(){
 for(const host of ['192.0.2.1','169.254.169.254','2001:db8::1','example.test']){
  assert.throws(()=>net.connect(443,host),/OUTBOUND_BLOCKED/);
  assert.throws(()=>new net.Socket().connect({host,port:443}),/OUTBOUND_BLOCKED/);
  assert.throws(()=>tls.connect({host,port:443}),/OUTBOUND_BLOCKED/);
  assert.throws(()=>dns.lookup(host,()=>{}),/OUTBOUND_BLOCKED/);
 }
 assert.throws(()=>dns.resolve('example.test',()=>{}),/OUTBOUND_BLOCKED/);
 const udp=dgram.createSocket('udp4');assert.throws(()=>udp.send('x',53,'192.0.2.1'),/OUTBOUND_BLOCKED/);udp.close();
 for(const host of ['127.0.0.1','::1'])await new Promise((resolve,reject)=>{
  const server=net.createServer(socket=>socket.end());server.on('error',reject);
  server.listen(0,host,()=>{const client=net.connect(server.address().port,host,()=>client.end());client.on('error',reject);client.on('close',()=>server.close(resolve));});
 });
 console.log('NODE TCP/TLS/DNS/UDP egress denied; IPv4/IPv6 loopback passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
