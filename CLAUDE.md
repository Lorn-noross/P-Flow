# P-Flow : notes pour les sessions de développement

- Appli vanilla JS + Vite (`index.html`, `src/main.js`, `src/style.css`, `src/firebase.js`), empaquetée pour Android avec Capacitor 7 (`android/`).
- Langue de l'interface : français, tutoiement. Ton simple : l'appli est aussi utilisée par des personnes peu à l'aise avec l'informatique.
- **Aucune donnée personnelle dans le dépôt** (dépôt public) : pas de montants réels, d'emails ou de noms dans le code, les tests ou les exemples.
- Données Firestore : `users/{uid}/meta/settings`, `users/{uid}/entries/{id}` (opérations ponctuelles, champ `month` = `AAAA-MM`), `users/{uid}/recurring/{id}` (fixes, `start`/`end` = `AAAA-MM`). Accès : `allowlist/{email}` et `admins/{uid}`. Règles dans `firestore.rules` (à recopier dans la console Firebase à chaque changement).
- Versions : `package.json` donne la base et le canal (`0.1.0-beta` → appli en bêta 0.1). Le workflow calcule la version réelle `0.1.<numéro de compilation>-beta`, affichée « 0.1.N bêta ». Le versionCode Android = `github.run_number`. Pour passer en 0.2 ou en version finale, changer seulement `package.json` (ex. `0.2.0-beta`, puis `1.0.0`).
- APK publiée sous le nom `P-Flow-<version>.apk` ; lien de partage stable : `https://lorn-noross.github.io/P-Flow/telecharger.html` (lit `version.json`).
- La clé de signature `android/app/p-flow-release.p12` est protégée par le secret GitHub `ANDROID_KEYSTORE_PASSWORD`. Ne jamais la régénérer : sinon les mises à jour ne s'installent plus par-dessus l'ancienne version.
- Vérifier `npm run build` avant chaque push. Le build Android ne tourne que dans GitHub Actions.
