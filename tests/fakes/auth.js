// Fausse authentification Firebase, utilisée UNIQUEMENT par les tests.
// Connecte automatiquement un compte fictif à l'email vérifié
// (sauf si window.__PFLOW_NO_USER__ est vrai : écran de connexion).
const USER = {
  uid: 'uid-test',
  email: 'test@example.invalid',
  emailVerified: true,
  providerData: [{ providerId: 'google.com' }],
  getIdToken: async () => 'jeton-de-test',
};

export const indexedDBLocalPersistence = {};
export const browserLocalPersistence = {};
export const browserPopupRedirectResolver = {};
export function initializeAuth() { return { currentUser: null }; }
export function onAuthStateChanged(auth, cb) {
  setTimeout(() => {
    const u = window.__PFLOW_NO_USER__ ? null : USER;
    auth.currentUser = u;
    cb(u);
  }, 0);
  return () => {};
}
export class GoogleAuthProvider { static credential() { return {}; } }

const off = async () => { throw Object.assign(new Error('Désactivé dans les tests'), { code: 'auth/test' }); };
export const signInWithEmailAndPassword = off;
export const createUserWithEmailAndPassword = off;
export const signInWithPopup = off;
export const signInWithCredential = off;
export const sendEmailVerification = async () => {};
export const sendPasswordResetEmail = async () => {};
export const signOut = async () => {};
export const reload = async () => {};
