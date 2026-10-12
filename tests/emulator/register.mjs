import { registerHooks } from 'node:module';
const sdk = new URL('./sdk.mjs', import.meta.url).href;
const firebaseState = new URL('../../js/firebase.js', import.meta.url).href;
// Only replace environment boundaries. All business services and the actual
// inventory adapter run unchanged. Never import the production Firebase config.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js') {
      return { url: sdk, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.split('?')[0] === firebaseState) return {
      format: 'module', shortCircuit: true,
      source: 'export const getFirebaseState = () => ({enabled:true, db:globalThis.__stageA.db});'
    };
    return nextLoad(url, context);
  }
});
