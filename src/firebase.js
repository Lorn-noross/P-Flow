// Configuration publique du projet Firebase (identifiants publics, pas de secret).
// La sécurité des données repose sur les règles Firestore (voir firestore.rules).
import { initializeApp } from 'firebase/app';
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserPopupRedirectResolver } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';

const firebaseConfig = {
  apiKey: 'AIzaSyBu2WTuu3D4M329lQfRW52F4l9IeuKHqVA',
  authDomain: 'p-flow-a56b0.firebaseapp.com',
  projectId: 'p-flow-a56b0',
  storageBucket: 'p-flow-a56b0.firebasestorage.app',
  messagingSenderId: '59632894514',
  appId: '1:59632894514:web:2a46edb4700c43a005722b',
};

export const isNative = Capacitor.isNativePlatform();
export const app = initializeApp(firebaseConfig);

// Dans l'APK, pas de fenêtre pop-up : persistance IndexedDB seule.
export const auth = isNative
  ? initializeAuth(app, { persistence: indexedDBLocalPersistence })
  : initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence], popupRedirectResolver: browserPopupRedirectResolver });

// Cache local : l'appli marche hors ligne et synchronise au retour du réseau.
let db;
try {
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch (e) {
  db = initializeFirestore(app, {});
}
export { db };
