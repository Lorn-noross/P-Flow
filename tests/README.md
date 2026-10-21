# Test de non-régression des données

Garantit la règle n°1 de `CLAUDE.md` : une nouvelle version lit toujours les données des anciennes, et modifier ou supprimer ne fait rien perdre d'autre.

## Ce qui est vérifié

Pour chaque jeu de données de `fixtures/` (format d'une ancienne version, données **fictives**), sur téléphone, tablette et PC, en thème clair et sombre :

- les montants du mois et les totaux de l'année ;
- modifier une opération et un fixe garde tous les autres champs, y compris ceux qu'une version plus récente aurait ajoutés (`champFutur`) ;
- supprimer une opération ne retire qu'elle ;
- le garde-fou : des données marquées par une version plus récente (`dataVersion`) passent l'appli en lecture seule ;
- la saisie : suggestions de libellés sous le champ (filtrées par type, au doigt et au clavier PC), fenêtre d'ajout au-dessus du clavier, que le clavier recouvre l'appli (Android 15 et plus) ou réduise la fenêtre (anciens Android, navigateurs) ;
- l'accès : un compte hors de la liste d'emails voit l'écran de refus ; l'administrateur ajoute et retire des emails ;
- les couleurs : appliquées dès le chargement (venues d'un autre appareil), choix, retour par défaut, autres réglages intacts ;
- les sauvegardes : export complet, import qui remet seulement ce qui manque (sans écraser ni doublonner), Google Drive simulé (dossier, 12 copies, corbeille, restauration, copie automatique due) ;
- les mises à jour (navigateur) : bandeau « Recharger », intervalle, vérification manuelle ;
- l'écran de bienvenue d'un nouveau compte ;
- aucune erreur dans la console.

L'appli est construite avec un faux Firebase en mémoire (`fakes/`, `vite.config.js`) et Internet est simulé (version publiée, bibliothèque Google, Google Drive) : aucun accès au vrai projet, aucune donnée réelle. Ces fichiers ne sont jamais inclus dans l'appli publiée.

## Lancer

```bash
npm ci
npm i --no-save playwright      # outil de test, pas ajouté au projet
npx playwright install chromium
node tests/run.mjs
```

Autre Chromium : `CHROME_PATH=/chemin/vers/chromium CHROME_ARGS="--no-sandbox" node tests/run.mjs`.
Captures d'écran : `tests/.out/` (ignoré par git).

## Quand le format des données change

Ajouter un nouveau fichier `fixtures/v<version>.json` au nouveau format, **sans modifier ni supprimer les anciens**.
