# P-Flow

**Know where your money flows.**

Application de suivi de budget : revenus, dépenses, charges fixes et reste du mois, avec un mode auto-entrepreneur (calcul URSSAF, échéances de déclaration, seuils de la micro-entreprise).

- **Android** : APK installable, fonctionne hors ligne et se synchronise au retour du réseau. Mises à jour depuis l'appli.
- **PC et iPhone** : même appli dans le navigateur, sans installation.
- **Synchronisation** : Firebase (Authentication + Cloud Firestore).
- **Sauvegardes** : export / import d'un fichier, copies automatiques sur Google Drive.
- **Couleurs** personnalisables, identiques sur tous les appareils.

Nouveautés de chaque version : onglet [Releases](https://github.com/Lorn-noross/P-Flow/releases).

## Télécharger

- APK Android : [page de téléchargement](https://lorn-noross.github.io/P-Flow/telecharger.html) (toujours la dernière version)
- Version PC : https://lorn-noross.github.io/P-Flow/

L'accès est réservé aux personnes autorisées par l'administrateur.

## Vie privée et sécurité

- Ce dépôt ne contient **aucune donnée personnelle** ni aucun mot de passe.
- Les identifiants visibles dans le code (configuration Firebase dans `src/firebase.js` et `android/app/google-services.json`, identifiant du client Google dans `src/drive.js`) sont **publics par nature** : ils désignent le projet, ils ne donnent accès à rien. Les données sont protégées par les règles Firestore (`firestore.rules`) : seules les personnes autorisées entrent, et chacune ne voit que ses propres données.
- La clé de signature Android (`android/app/p-flow-release.p12`) est chiffrée ; son mot de passe est uniquement dans les secrets GitHub.
- Google Drive : l'appli n'a accès qu'aux fichiers qu'elle crée (dossier « P-Flow Sauvegardes »).

## Développement

```bash
npm install
npm run dev          # version web locale
npm run build        # construit dist/
npx cap sync android # copie dans le projet Android
```

Une nouvelle version est publiée quand le numéro de `package.json` change (sinon, un push sur `main` vérifie seulement la construction). `.github/workflows/build.yml` :
1. construit la version web et la publie sur GitHub Pages ;
2. construit et signe l'APK, publiée dans les Releases sous le nom `P-Flow-<version>.apk`, avec les nouveautés de `notes-de-version/<version>.md` ;
3. publie `version.json`, que l'appli lit pour proposer les mises à jour.

Tests de non-régression des données : voir `tests/README.md`.
