export * from 'firebase/firestore';
import { runTransaction as realRunTransaction } from 'firebase/firestore';
export async function runTransaction(db, callback, options) {
  const state = globalThis.__stageA;
  const before = state.beforeTransaction;
  state.beforeTransaction = null;
  if (before) await before();
  const result = await realRunTransaction(db, async tx => {
    state.attempts++;
    return callback(tx);
  }, state.maxAttempts ? { ...options, maxAttempts: state.maxAttempts } : options);
  if (state.loseReply) {
    state.loseReply = false;
    throw Object.assign(new Error('Injected lost response AFTER real emulator commit'), { code: 'unavailable' });
  }
  return result;
}
