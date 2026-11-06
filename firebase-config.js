
import { initializeApp } from
  "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";

import {
  getAuth,
  GoogleAuthProvider
} from
  "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";

import {
  getFirestore
} from
  "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

const firebaseConfig = {
 apiKey: "AIzaSyBK_JONhCMAyx9_BSmfutVW0XwG2msfZbM",
  authDomain: "cade-meu-pet-8966f.firebaseapp.com",
  projectId: "cade-meu-pet-8966f",
  storageBucket: "cade-meu-pet-8966f.firebasestorage.app",
  messagingSenderId: "392063371019",
  appId: "1:392063371019:web:4cd24ccd4c72b031fb040e",
  measurementId: "G-DK2XJ1WKG0"

};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
