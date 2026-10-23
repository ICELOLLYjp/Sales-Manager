import fs from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url)),art=path.join(root,'artifacts');
fs.mkdirSync(art,{recursive:true});
const home=fs.mkdtempSync(path.join(art,'runtime-home-'));
const java=path.join(art,'java'),policy=path.join(art,'loopback.policy');
// Java 21 SecurityManager denies all external sockets, including metadata/ADC.
fs.writeFileSync(policy,`grant {
 permission java.io.FilePermission "<<ALL FILES>>", "read,write,delete,execute";
 permission java.util.PropertyPermission "*", "read,write";
 permission java.lang.RuntimePermission "*";
 permission java.lang.reflect.ReflectPermission "*";
 permission java.security.SecurityPermission "*";
 permission java.util.logging.LoggingPermission "control";
 permission java.lang.management.ManagementPermission "control";
 permission java.net.NetPermission "*";
 permission javax.management.MBeanPermission "*", "*";
 permission javax.management.MBeanServerPermission "*";
 permission javax.management.MBeanTrustPermission "*";
 permission java.net.SocketPermission "localhost:0-", "connect,listen,accept,resolve";
 permission java.net.SocketPermission "127.0.0.1:0-", "connect,listen,accept,resolve";
 permission java.net.SocketPermission "[::1]:0-", "connect,listen,accept,resolve";
};`);
const env={SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,COMSPEC:process.env.COMSPEC,
 PATH:[java+'/bin',path.dirname(process.execPath),process.env.SystemRoot+'/System32'].join(';'),
 HOME:home,USERPROFILE:home,APPDATA:home,LOCALAPPDATA:home,TEMP:home,TMP:home,
 JAVA_HOME:java,JAVA_TOOL_OPTIONS:`-Duser.home="${home.replaceAll('\\','/')}" -Djava.security.manager -Djava.security.policy=="${policy.replaceAll('\\','/')}"`,
 NODE_OPTIONS:`--require "${path.join(root,'loopback-guard.cjs').replaceAll('\\','/')}"`,
 CI:'true',METADATA_SERVER_DETECTION:'none',NO_GCE_CHECK:'true',FIREBASE_CLI_DISABLE_UPDATE_CHECK:'true',
 FIREBASE_EMULATORS_PATH:path.join(art,'emulator-cache'),
 FIRESTORE_EMULATOR_HOST:'127.0.0.1:8088',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',
 GCLOUD_PROJECT:'demo-icelolly-method-b-sales',GOOGLE_CLOUD_PROJECT:'demo-icelolly-method-b-sales'};
// Official firebase-tools 1.22.0 digest; preserve the downloaded JAR bytes.
const jar=fs.readFileSync(path.join(art,'emulator-cache/cloud-firestore-emulator-v1.22.0.jar'));
if(createHash('sha256').update(jar).digest('hex')!=='9b6498b7f62714d67f48f59b3818883cd682dbcd46b9f59511de81c97bb5166c')throw Error('emulator-checksum-mismatch');
// This official ELF/JAR polyglot fails URLClassPath's LOC-header check with SM.
// Only bypass that header check. SocketPermission and SecurityManager stay on.
env.JAVA_TOOL_OPTIONS+=' -Dsun.misc.URLClassPath.disableJarChecking=true';
const probe=spawnSync(path.join(java,'bin/java.exe'),['-cp',art,'LoopbackProbe'],{cwd:root,env,windowsHide:true,encoding:'utf8',timeout:45000});
process.stdout.write(probe.stdout||'');
if(probe.status!==0){process.stderr.write(probe.stderr||'');throw Error('java-isolation-preflight-failed');}
const nodeProbe=spawnSync(process.execPath,[path.join(root,'loopback-probe.cjs')],{cwd:root,env,windowsHide:true,encoding:'utf8',timeout:15000});
process.stdout.write(nodeProbe.stdout||'');
if(nodeProbe.status!==0){process.stderr.write(nodeProbe.stderr||'');throw Error('node-isolation-preflight-failed');}
const command=process.argv[2]||'node --test --test-timeout=60000 void-api.test.mjs';
const log=fs.createWriteStream(path.join(art,'integration.log'));
log.write((probe.stdout||'')+(nodeProbe.stdout||''));
const child=spawn(process.execPath,[path.join(art,'tools/node_modules/firebase-tools/lib/bin/firebase.js'),
 'emulators:exec','--only','firestore,auth','--project',env.GCLOUD_PROJECT,'--config',path.join(root,'firebase.json'),command],
 {cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
for(const stream of [child.stdout,child.stderr])stream.on('data',d=>{log.write(d);process.stdout.write(d);});
const timer=setTimeout(()=>{spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true});},240000);
child.on('error',e=>{clearTimeout(timer);log.end();throw e;});
child.on('exit',(code)=>{clearTimeout(timer);log.end();process.exitCode=code??1;});

