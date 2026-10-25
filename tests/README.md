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
- le premier démarrage guidé d'un nouveau compte (documents identiques à un ajout manuel) et « Refaire la configuration » (rien de supprimé) ;
- patch 2 : épargne (soldes, dépôts, retraits, versements automatiques, désactivation sans perte), fixes trimestriels et annuels (échéances, modification en cours de route qui garde le cycle et les champs inconnus), proposition d'activer l'épargne aux anciens comptes, demandes d'accès (côté personne et côté administrateur), nouveautés affichées une seule fois, apparence propre à l'appareil, sous-pages des Réglages, glisser pour changer de mois ;
- patch 3 (jeu `v0.1.3-beta`) : solde du compte courant (« Prévu sur ton compte le 31 », aujourd'hui, point le plus bas, nouveau solde à découvert avec le bouton −, historique intact), question « Déjà passée sur ton compte ? » (réponses rangées à part dans `pointages`, rien de nouveau dans `entries`), calendrier du mois (pastilles, bulle du jour), calendrier maison de la date, jour d'un fixe rangé à part (`jours`, rien de nouveau dans `recurring`), URSSAF retenue par libellé, « Arrêter » / « Supprimer aussi des mois passés », « Annuler » après une suppression (document remis à l'identique), comptes d'épargne en pilules avec solde de départ, revenus sans URSSAF sur leur propre ligne, revenus fixes repliables, mois à venir, aucune liste / date / couleur native dans la page ;
- patch 4 (jeu `v0.1.4-beta`) : URSSAF payée (montant réel à la place de l'estimation dans la cascade avec « montant réel », écran Année et solde prévu ; modifier garde les champs inconnus ; retirer puis « Annuler » ; question « URSSAF payée ? » après l'échéance avec « Pas encore » rangé à part et reposé le lendemain ; trimestriel réparti selon le chiffre d'affaires), objectif de fin de mois (tous les mois ou seulement ce mois-ci, retiré, autres réglages intacts), épargne possible et « Mettre de côté », « Tu peux encore dépenser » sans l'URSSAF due ni l'objectif, sauvegarde au format 4 ; visuel : vérification automatique des mises à jour en menu compact (5 choix, Échap referme sans rien changer), « Où part l'argent » (fixes dans la couleur des Fixes) ;
- patch 5 (jeu `v0.1.4-beta`, scénario `Patch5`) : écran Mois allégé (gros chiffre en premier, une seule ligne dessous, comparaison des dépenses sous la ligne Dépenses), un seul bloc URSSAF sous les boutons d'ajout (question « Celle de mars est payée ? » dedans, détail dépliable), carte Fin du mois (« Disponible d'ici le 31 », « Soit ~X € par jour », calcul dans un ⓘ ; rien de plus que « Fixer un objectif » sans objectif ni épargne), nouveau ⓘ (pastille, zone de toucher de 40 px, une bulle à la fois, fermeture seule après le temps de lecture, fermée en changeant de mois), mois à venir (gros chiffre « Prévu sur ton compte », bloc URSSAF caché à 0 €), aide du taux « tape 21,98 % » ;
- patch 5, étape 2 (scénarios `Patch5Annee` et `Patch5Ecrans`, plus la configuration « grand écran sombre » 1920 × 1080 réservée aux scénarios du patch 5) : écran Année « Sur mon compte / Reste de l'année » (solde à la fin de chaque mois, même valeur que l'écran Mois, évolution, bulle, colonne « Compte », même choix que l'écran Mois, pas d'interrupteur sans solde), mêmes mots qu'en Mois, seuils en une ligne avec ⓘ, mise en page selon la place (Mois en 1, 2 ou 3 colonnes ; Fixes et Réglages côte à côte sur grand écran) ;
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
Une partie seulement : `FX=0.1.2` (jeu de données), `CFG=PC` (appareil), `ONLY=Epargne` (scénario), `--no-build` (réutiliser la construction), `DEBUG=1` (détail d'un échec).

## Fluidité

```bash
node tests/perf.mjs            # processeur ralenti ×6 (vieux téléphone) ; --rate=4 pour ×4
```

Mesure chaque image pendant les transitions (onglets, mois, glisser, fenêtre d'ajout, sous-pages, carte URSSAF ; patch 3 : calendrier du mois, bulle d'un jour, calendrier de la date, explication ⓘ ; patch 4 : pilule qui se resserre en Réglages, objectif de fin de mois, « URSSAF payée », fond vivant au repos et pendant un défilement), avec le jeu de données le plus récent, et pendant le défilement du contenu sous les pilules floutées. « Affichage » = calcul du nouvel écran avant le départ de l'animation ; « animation » = les images de l'animation elle-même, qui ne doivent pas dépasser 50 ms au ralenti ×6 (plus de 2 par animation = saccade).
Captures d'écran : `tests/.out/` (ignoré par git).

## Quand le format des données change

Ajouter un nouveau fichier `fixtures/v<version>.json` au nouveau format, **sans modifier ni supprimer les anciens**.
