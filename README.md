# P-Flow

**Know where your money flows.**

Application de suivi de budget : revenus, dépenses, charges fixes et reste du mois, avec un mode auto-entrepreneur (calcul URSSAF, échéances de déclaration, seuils de la micro-entreprise).

- **Android** : APK installable, fonctionne hors ligne et se synchronise au retour du réseau.
- **PC** : même appli dans le navigateur, sans installation.
- **Synchronisation** : Firebase (Authentication + Cloud Firestore).

## Télécharger

- APK Android : [page de téléchargement](https://lorn-noross.github.io/P-Flow/telecharger.html) (toujours la dernière version)
- Version PC : https://lorn-noross.github.io/P-Flow/

Chacun crée son compte (Google ou email) ; chaque compte ne voit que ses propres données.

## Vie privée

Ce dépôt ne contient **aucune donnée personnelle**. Chaque utilisateur a son propre espace dans Firestore, accessible uniquement par lui (voir `firestore.rules`). La configuration Firebase présente dans `src/firebase.js` est composée d'identifiants publics.

## Développement

```bash
npm install
npm run dev          # version web locale
npm run build        # construit dist/
npx cap sync android # copie dans le projet Android
```

Chaque push sur `main` déclenche `.github/workflows/build.yml` :
1. construction de la version web, publiée sur GitHub Pages ;
2. construction et signature de l'APK (secret `ANDROID_KEYSTORE_PASSWORD`), publié dans les Releases sous le nom `P-Flow-<version>.apk` ;
3. publication de `version.json`, que l'appli Android lit pour proposer les mises à jour.
