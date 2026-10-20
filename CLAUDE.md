# P-Flow : notes pour les sessions de développement

- Appli vanilla JS + Vite (`index.html`, `src/main.js`, `src/style.css`, `src/firebase.js`), empaquetée pour Android avec Capacitor 7 (`android/`).
- Langue de l'interface : français, tutoiement. Ton simple : l'appli est aussi utilisée par des personnes peu à l'aise avec l'informatique.
- **Aucune donnée personnelle dans le dépôt** (dépôt public) : pas de montants réels, d'emails ou de noms dans le code, les tests ou les exemples.
- Données Firestore : `users/{uid}/meta/settings`, `users/{uid}/entries/{id}` (opérations ponctuelles, champ `month` = `AAAA-MM`), `users/{uid}/recurring/{id}` (fixes, `start`/`end` = `AAAA-MM`). Accès : `allowlist/{email}` et `admins/{uid}`. Règles dans `firestore.rules` (à recopier dans la console Firebase à chaque changement).
- Montée de version : incrémenter `version` dans `package.json` pour les changements visibles. Le numéro de build (versionCode Android) vient de `github.run_number`.
- La clé de signature `android/app/p-flow-release.p12` est protégée par le secret GitHub `ANDROID_KEYSTORE_PASSWORD`. Ne jamais la régénérer : sinon les mises à jour ne s'installent plus par-dessus l'ancienne version.
- Vérifier `npm run build` avant chaque push. Le build Android ne tourne que dans GitHub Actions.
