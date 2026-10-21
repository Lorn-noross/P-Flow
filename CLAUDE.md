# P-Flow : notes pour les sessions de développement

- Appli vanilla JS + Vite (`index.html`, `src/main.js`, `src/style.css`, `src/firebase.js`), empaquetée pour Android avec Capacitor 7 (`android/`).
- Langue de l'interface : français, tutoiement. Ton simple : l'appli est aussi utilisée par des personnes peu à l'aise avec l'informatique.
- **Aucune donnée personnelle dans le dépôt** (dépôt public) : pas de montants réels, d'emails ou de noms dans le code, les tests ou les exemples.
- Données Firestore : `users/{uid}/meta/settings`, `users/{uid}/entries/{id}` (opérations ponctuelles, champ `month` = `AAAA-MM`), `users/{uid}/recurring/{id}` (fixes, `start`/`end` = `AAAA-MM`). Accès ouvert à tout compte dont l'email est vérifié (plus de liste d'emails autorisés). Règles dans `firestore.rules` (à recopier dans la console Firebase à chaque changement).
- **Règle du propriétaire : ne jamais publier ni compiler de version (APK, test ou release) sans son accord explicite.** Avant chaque publication, lui demander s'il faut recompiler et quel numéro donner. Format souhaité : `0.1.N-beta` (affiché « 0.1.N bêta »). La série repart de `0.1.0-beta` (publiée le 21/10/2026) : prochaines versions 0.1.1, 0.1.2… Les anciennes 0.1.7 à 0.1.12 étaient des tests internes.
- Mécanique : la version publiée est celle de `package.json`. Un push sur main ne publie que si le tag `v<version>` n'existe pas encore ; on ne change donc `version` dans `package.json` qu'après accord, avec le numéro choisi. Sans changement de version, le push vérifie seulement le build web (rien n'est publié). Les APK de test se font par lancement manuel du workflow, aussi après accord. Le versionCode Android = `github.run_number` (toujours croissant).
- APK publiée sous le nom `P-Flow-<version>.apk` ; lien de partage stable : `https://lorn-noross.github.io/P-Flow/telecharger.html` (lit `version.json`).
- La clé de signature `android/app/p-flow-release.p12` est protégée par le secret GitHub `ANDROID_KEYSTORE_PASSWORD`. Ne jamais la régénérer : sinon les mises à jour ne s'installent plus par-dessus l'ancienne version.
- Vérifier `npm run build` avant chaque push. Le build Android ne tourne que dans GitHub Actions.

## Règle n°1 : ne jamais perdre ni abîmer les données (exigence absolue du propriétaire)
Des personnes (dont la famille du propriétaire) ont de vraies données dans l'appli. Une mise à jour ne doit **jamais** les effacer, les déplacer ni les rendre illisibles. Cette règle passe avant toute nouveauté.
- **On ajoute, on ne retire jamais.** Ne jamais renommer, déplacer ni supprimer une collection ou un chemin Firestore (`users/{uid}/…`), un champ existant, ni une clé `localStorage` (`pf-…`). Ne jamais restreindre `firestore.rules` sur un chemin existant.
- **Tout nouveau champ est facultatif** : le code doit marcher quand il est absent (valeur par défaut), puisque les données existantes ne l'ont pas.
- **Plusieurs versions tournent en même temps** (un téléphone pas encore mis à jour, le PC déjà à jour, sur le même compte) :
  - une ancienne version doit continuer à lire ce qu'écrit la nouvelle ;
  - une écriture ne doit jamais effacer un champ qu'elle ne connaît pas : `setDoc(…, { merge: true })` pour les réglages ; pour réécrire un document entier, repartir du document lu (`plain(o)`) puis modifier ;
  - les versions jusqu'à 0.1.0-beta réécrivent une opération modifiée (`entries`) sans garder les champs inconnus : tant qu'elles circulent, ne rien mettre d'indispensable dans un nouveau champ d'opération.
- **Version des données** : `DATA_VERSION` dans `src/main.js` ; champ `dataVersion` dans `users/{uid}/meta/settings` (absent = 1). Une appli qui voit un `dataVersion` plus grand que le sien passe en lecture seule et demande la mise à jour (garde-fou présent depuis le patch 1). Si une donnée doit vraiment changer de forme :
  1. demander l'accord du propriétaire ;
  2. sauvegarde complète du compte avant toute conversion ;
  3. conversion idempotente (relançable sans dégât), étape par étape (1→2, puis 2→3…), en gardant l'ancienne forme lisible tant que des versions qui l'utilisent circulent ;
  4. écrire `dataVersion` seulement après une conversion réussie.
- **Test de non-régression des données avant chaque publication** (voir `tests/README.md`) : des jeux de données fictifs au format de chaque ancienne version sont chargés dans l'appli, construite avec un faux Firebase en mémoire (`tests/fakes/`) ; on vérifie que tout s'affiche à l'identique et que modifier ou supprimer ne fait rien perdre d'autre. Quand le format évolue, on ajoute un nouveau jeu de données sans retirer les anciens.

## Qualité avant chaque publication (exigence du propriétaire)
1. Relire intégralement chaque modification (diff complet), puis lancer le plugin Code Review sur les changements.
2. Vérifier les API utilisées dans la documentation officielle à jour (Firebase, Capacitor, plugins) : pas de mémoire approximative.
3. `npm run build` sans erreur ni avertissement nouveau.
4. Tester l'interface en local (Playwright) : téléphone et PC, thème clair et sombre, parcours ajout / modification / suppression. Lancer le test de non-régression des données (`tests/README.md`).
5. Si le modèle de données change : mettre à jour `firestore.rules` et prévenir le propriétaire qu'il doit les recopier dans la console.
6. Poids : budget actuel JS ≈ 160 Ko gzip (dont ~140 Ko Firebase), CSS ≈ 6 Ko gzip, APK ≈ 5 Mo. Ne pas ajouter de bibliothèque lourde ; préférer le code natif du navigateur ; charger à la demande ce qui n'est pas nécessaire au démarrage.
7. Donner au propriétaire la liste des changements, le numéro de version proposé, et attendre son accord avant de monter la version.

