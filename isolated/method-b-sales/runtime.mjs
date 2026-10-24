import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
export const PROJECT='demo-icelolly-method-b-sales';
export const UIDS=Object.freeze(['fixture-business','fixture-personal','fixture-backup']);
export function assertIsolated(){
  if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8088'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099'
    ||process.env.GOOGLE_APPLICATION_CREDENTIALS||[process.env.GCLOUD_PROJECT,process.env.GOOGLE_CLOUD_PROJECT].some(x=>x&&x!==PROJECT))throw Error('isolated-sales-environment-required');
}
export function runtime(){assertIsolated();const app=initializeApp({projectId:PROJECT},'isolated-sales');const db=getFirestore(app);return {db,auth:getAuth(app),close:async()=>{await db.terminate();await deleteApp(app);}};}
