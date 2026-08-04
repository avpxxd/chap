/**
 * PulseChat - Firebase Configuration & Initialization Module
 * Pre-configured with User's Firebase Credentials (chatapp-f1f3f)
 */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, setDoc, doc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const CONFIG_STORAGE_KEY = 'pulse_firebase_credentials';

// User's default Firebase project credentials
export const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyD4V61nnTkvE1kDC08eACZsedX8GrC73DM",
  authDomain: "chatapp-f1f3f.firebaseapp.com",
  projectId: "chatapp-f1f3f",
  storageBucket: "chatapp-f1f3f.firebasestorage.app",
  messagingSenderId: "519762777434",
  appId: "1:519762777434:web:8ed9ca727ab52f13dacf63",
  measurementId: "G-181SGZDMGT"
};

export let firebaseApp = null;
export let auth = null;
export let db = null;
export let isFirebaseConnected = false;
export let currentUserAuth = null;

export function getStoredConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    return raw ? JSON.parse(raw) : DEFAULT_FIREBASE_CONFIG;
  } catch (e) {
    return DEFAULT_FIREBASE_CONFIG;
  }
}

export function saveConfig(config) {
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
}

export function clearConfig() {
  localStorage.removeItem(CONFIG_STORAGE_KEY);
}

export async function initFirebase(customConfig = null) {
  const config = customConfig || getStoredConfig() || DEFAULT_FIREBASE_CONFIG;

  try {
    if (getApps().length === 0) {
      firebaseApp = initializeApp(config);
    } else {
      firebaseApp = getApps()[0];
    }

    auth = getAuth(firebaseApp);
    db = getFirestore(firebaseApp);

    try {
      const userCredential = await signInAnonymously(auth);
      currentUserAuth = userCredential.user;
      console.log('Firebase Anonymous Auth success:', currentUserAuth.uid);
    } catch (authError) {
      console.warn('Anonymous auth note:', authError);
    }

    onAuthStateChanged(auth, (user) => {
      currentUserAuth = user;
    });

    isFirebaseConnected = true;
    return true;
  } catch (error) {
    console.error('Firebase initialization error:', error);
    isFirebaseConnected = false;
    return false;
  }
}

export {
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  setDoc,
  doc
};
