const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const base=path.resolve(__dirname,'..'),root=path.join(__dirname,'Sales-Manager/isolated/method-b');
const art=path.join(base,'sm123-integration-20261023/isolated/method-b-sales/artifacts');
const home=path.join(__dirname,'runtime-home');fs.mkdirSync(home,{recursive:true});
const java=path.join(art,'java');
const env={SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,COMSPEC:process.env.COMSPEC,
 PATH:[java+'/bin',path.dirname(process.execPath),process.env.SystemRoot+'/System32'].join(';'),
 HOME:home,USERPROFILE:home,APPDATA:home,LOCALAPPDATA:home,TEMP:home,TMP:home,JAVA_HOME:java,
 JAVA_TOOL_OPTIONS:`-Duser.home="${home.replaceAll('\\','/')}"`,
 NODE_OPTIONS:`--require "${path.join(base,'sm123-integration-20261023/isolated/method-b-sales/loopback-only.cjs').replaceAll('\\','/')}"`,
 WOO_PHP_BIN:path.join(base,'php-runtime-8.3.35/php.exe'),WOO_WP_ROOT:path.join(base,'ec-drop-runtime-final-20261025/wp'),WOO_FIXTURE_RUNTIME:path.join(base,'woo-producer-20261028/php-runtime'),WOO_PHP_RUNNER:path.join(base,'woo-producer-20261028/Website/tests/run-woo-reservation.cjs'),WOO_FIXTURE_PATH:path.join(base,'woo-producer-20261028/php-runtime/woo-envelope.json'),CI:'true',NO_GCE_CHECK:'true',FIREBASE_CLI_DISABLE_UPDATE_CHECK:'true',
 FIREBASE_EMULATORS_PATH:path.join(art,'emulator-cache'),
 FIRESTORE_EMULATOR_HOST:'127.0.0.1:8087',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9098',
 GCLOUD_PROJECT:'demo-icelolly-method-b',GOOGLE_CLOUD_PROJECT:'demo-icelolly-method-b'};
const command=process.argv[2]||'node --test --test-concurrency=1 --test-timeout=60000 --test-reporter=tap reservations.test.mjs event-release.test.mjs';
const log=fs.createWriteStream(path.join(__dirname,'emulator.log'));
const child=spawn(process.execPath,[path.join(art,'tools/node_modules/firebase-tools/lib/bin/firebase.js'),
 'emulators:exec','--only','firestore,auth','--project',env.GCLOUD_PROJECT,'--config',path.join(root,'firebase.json'),command],
 {cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
for(const stream of [child.stdout,child.stderr])stream.on('data',d=>{log.write(d);process.stdout.write(d);});
const timer=setTimeout(()=>spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true}),240000);
child.on('error',e=>{clearTimeout(timer);log.end();throw e;});
child.on('exit',code=>{clearTimeout(timer);log.end();process.exitCode=code??1;});

