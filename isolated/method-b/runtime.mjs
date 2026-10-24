import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
export const PROJECT = 'demo-icelolly-method-b';
export const UIDS = Object.freeze(['fixture-business', 'fixture-personal', 'fixture-backup']);
export function assertIsolated() {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8087'
      || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9098'
      || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('Only fixed loopback Auth/Firestore emulators without credentials are permitted');
  }
}
export function runtime() {
  assertIsolated();
  const app = initializeApp({projectId:PROJECT}, 'isolated-method-b');
  const db = getFirestore(app);
  // No ADC or production URL: emulator environment is required before init.
  return {db, auth:getAuth(app), close:async()=>{await db.terminate(); await deleteApp(app);}};
}
