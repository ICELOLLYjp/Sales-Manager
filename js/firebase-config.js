// Firebase Console > Project settings > Your apps > Web app
// の値をここへ貼り付けます。
// GitHubへ公開する場合でも Firebase Security Rules と Authentication を必ず使用してください。

export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

export const firebaseEnabled = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.projectId &&
  firebaseConfig.appId
);
