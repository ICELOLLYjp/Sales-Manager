import { getFirebaseState } from "./firebase.js";

import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";


const ALLOWED_EMAILS = new Set([
  "fjmthrs@gmail.com",
  "icelolly.zakka@gmail.com",
  "maki.peko.126@gmail.com"
].map(email => email.toLowerCase()));


function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}


export function isAllowedUser(user) {

  if (!user) return false;

  const email = normalizeEmail(user.email);

  return Boolean(
    user.emailVerified &&
    ALLOWED_EMAILS.has(email)
  );
}


export async function initAuth(onStateChange) {

  const { auth, enabled } = getFirebaseState();

  if (!enabled || !auth) {

    onStateChange?.(null, {
      code: "firebase_not_ready",
      message: "Firebase is not ready."
    });

    return () => {};
  }


  try {

    await setPersistence(
      auth,
      browserLocalPersistence
    );

  } catch (error) {

    console.warn(
      "Auth persistence setup failed",
      error
    );
  }


  const unsubscribe = onAuthStateChanged(
    auth,

    async user => {

      if (!user) {

        onStateChange?.(null, null);
        return;
      }


      if (!isAllowedUser(user)) {

        const deniedEmail =
          user.email || "このアカウント";

        await signOut(auth);

        onStateChange?.(null, {
          code: "not_allowed",
          message:
            `${deniedEmail} はこのアプリの許可アカウントではありません。`
        });

        return;
      }


      onStateChange?.(user, null);
    }
  );


  return unsubscribe;
}


export async function loginWithGoogle() {

  const { auth } = getFirebaseState();

  if (!auth) {

    throw new Error(
      "Firebase Authentication is not ready."
    );
  }


  await setPersistence(
    auth,
    browserLocalPersistence
  );


  const provider =
    new GoogleAuthProvider();


  provider.setCustomParameters({
    prompt: "select_account"
  });


  const result =
    await signInWithPopup(
      auth,
      provider
    );


  if (!isAllowedUser(result.user)) {

    const deniedEmail =
      result.user?.email ||
      "このアカウント";


    await signOut(auth);


    const error =
      new Error(
        `${deniedEmail} はこのアプリの許可アカウントではありません。`
      );


    error.code = "not_allowed";

    throw error;
  }


  return result.user;
}


export async function logout() {

  const { auth } = getFirebaseState();

  if (!auth) return;

  await signOut(auth);
}
