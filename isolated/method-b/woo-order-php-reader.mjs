import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {assertIsolated} from './runtime.mjs';
const execute=promisify(execFile);

// Local copy-DB transport only. Server composition supplies fixed absolute paths;
// there is no HTTP route, user-controlled executable, live secret or production mode.
// createWooOrderBridge remains the signature/actor/TTL/journal authority.
export function createPhpOrderReader({runner,php,wpRoot,fixtureRuntime}) {
  assertIsolated();
  if(![runner,php,wpRoot,fixtureRuntime].every(x=>typeof x==='string'&&path.isAbsolute(x))
    ||path.basename(runner)!=='run-woo-order.cjs')throw Error('fixed-isolated-paths-required');
  const env={...process.env,WOO_PHP_BIN:php,WOO_WP_ROOT:wpRoot,WOO_FIXTURE_RUNTIME:fixtureRuntime};
  return async loc=>{
    assertIsolated();
    if(!loc||Object.getPrototypeOf(loc)!==Object.prototype
      ||Object.keys(loc).sort().join(',')!=='challenge,orderId,siteId'
      ||loc.siteId!=='fixture-site-a'||!Number.isSafeInteger(loc.orderId)||loc.orderId<=0
      ||typeof loc.challenge!=='string'||!/^[a-f0-9]{32}$/.test(loc.challenge))throw Error('invalid-php-order-locator');
    let stdout;
    try {({stdout}=await execute(process.execPath,[runner,'emit',loc.challenge,String(loc.orderId)],
      {env,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:131072}));}
    catch {throw Error('php-order-source-unavailable');}
    try {return JSON.parse(stdout);}catch {throw Error('php-order-source-invalid');}
  };
}
