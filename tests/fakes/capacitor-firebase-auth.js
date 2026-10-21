// Faux module natif de connexion Google, utilisé UNIQUEMENT par les tests.
export const FirebaseAuthentication = {
  signInWithGoogle: async () => ({}),
  signOut: async () => {},
};
