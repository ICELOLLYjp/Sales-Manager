// Canonical inventory writers must use this adapter, preserving Firebase 11.0.2.
export * from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { runTransaction as firebaseRunTransaction } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { guardedTransaction } from './inventory-concurrency.mjs';
export function runTransaction(db, callback, options) {
  return firebaseRunTransaction(db, tx => callback(guardedTransaction(tx)), options);
}
