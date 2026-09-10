import { firebaseConfig, firebaseEnabled } from "./firebase-config.js";

let app = null;
let db = null;
let auth = null;

export async function initFirebase() {
  if (!firebaseEnabled) {
    return { enabled: false, app: null, db: null, auth: null };
  }

  const [{ initializeApp }, firestoreModule, authModule] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js"),
    import("https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js")
  ]);

  app = initializeApp(firebaseConfig);
  db = firestoreModule.getFirestore(app);
  auth = authModule.getAuth(app);

  return { enabled: true, app, db, auth, firestoreModule, authModule };
}

export function getFirebaseState() {
  return { app, db, auth, enabled: Boolean(db) };
}
