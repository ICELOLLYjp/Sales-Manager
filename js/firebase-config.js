export const firebaseConfig = {
  apiKey: "AIzaSyA1AZlnCYr5cfHG3HDcyvG17jokBnr5lO8",
  authDomain: "t-shirtstock.firebaseapp.com",
  projectId: "t-shirtstock",
  storageBucket: "t-shirtstock.firebasestorage.app",
  messagingSenderId: "485805702075",
  appId: "1:485805702075:web:f9d8668ca57d9f58c4229e",
  measurementId: "G-TXEHB9FGSR"
};

export const firebaseEnabled = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.projectId &&
  firebaseConfig.appId
);
