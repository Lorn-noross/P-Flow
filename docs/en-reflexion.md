# Idées en attente de réflexion

Idées du propriétaire pas encore décidées. **Ne rien coder tant qu'il n'a pas tranché.** Une fois décidée, l'idée passe dans la feuille de route de `CLAUDE.md` (patch choisi) et sort de ce fichier.

## Soutenir le développeur (31/10/2026)

**L'idée** : dans Réglages, une section « Soutenir le développeur » avec un don facultatif, quelques montants au choix et un petit message de remerciement.

**À décider par le propriétaire**
- Plateforme : Ko-fi ou Stripe (lien de paiement).
- Montants.
- Où le mettre : une sous-page de Réglages ou dans « À propos ».

**Ce qui est déjà clair (avis de Claude, 31/10/2026)**
- Discret : jamais de rappel ni de fenêtre qui s'ouvre toute seule.
- Pas de paiement dans l'appli : il faudrait un serveur, et aucune clé secrète ne peut être dans un dépôt public ni dans une APK. Les boutons ouvrent une page de don dans le navigateur.
  - Ko-fi : 0 % de commission sur les dons ponctuels, seulement les frais Stripe ou PayPal.
  - Stripe : un lien de paiement par montant.
- Frais Stripe, carte européenne : 1,5 % + 0,25 €. Un don de 1 € perd environ 27 %. Montants conseillés : 2 / 5 / 10 € (ou 3 / 5 / 10 €).
- Remerciement : affiché sur la page de don (Ko-fi et Stripe le permettent). L'appli ne peut pas savoir si le don a eu lieu.
- Impôts : les dons liés à une activité sont en général des revenus imposables (BNC, à part de l'activité d'électricien). À vérifier avec l'URSSAF ou un comptable avant de l'activer.
- Tarifs à revérifier au moment de coder.

**Si c'est décidé** : patch 8 (nouvelles fonctions), ou le suivant.

## Crédits dans À propos (31/10/2026)

**Décidé** : une carte « Crédits » dans À propos (voir patch 8, point 5 de `CLAUDE.md`).

**En attente des réponses du propriétaire** (à lui reposer au début du patch 8, ou dès qu'il reparle des crédits) :
1. Comment il veut apparaître : prénom, nom complet, pseudo ou « Arcing-E ».
2. Comment sa sœur (icône et logo) veut apparaître, avec son accord, et si elle veut un lien vers son travail (portfolio, Instagram…).
3. Qui d'autre remercier : des personnes nommées, ou juste « la famille ».

Rappel : le dépôt est public, les noms affichés seront visibles de tous.

## Logo et icône : nouvelle version (31/10/2026)

**En attente** : la sœur du propriétaire (graphiste) doit encore modifier le logo. Version agrandie de l'icône rangée dans `assets/branding/icone-pf-upscale-2664.png`, **pas intégrée** à l'appli et **pas une icône finale**. Quand la version validée arrive : procédure « Nouvelle icône » de `CLAUDE.md` (APK et web), dans le patch en cours.

## Lancement public (31/10/2026)

**L'idée** : un jour, ouvrir P-Flow à tout le monde. Positionnement conseillé : **le budget simple des auto-entrepreneurs** (et de leur famille), sans pub ni connexion bancaire. Les grandes applis françaises (Bankin', Linxo, Finary…) misent sur la connexion aux banques ; aucune ne calcule l'URSSAF d'un micro-entrepreneur ni ne prévoit le solde avec l'URSSAF à sa date.

### Indispensable avant d'ouvrir au public
1. **Coûts Firebase** : offre gratuite = 50 000 lectures, 20 000 écritures et 20 000 suppressions Firestore par jour, 1 Gio stocké ; une fois le quota atteint, le service s'arrête jusqu'au lendemain, pour tout le monde. À chaque ouverture, P-Flow relit toutes ses collections (`onSnapshot` sur chacune) : quelques dizaines à une centaine d'utilisateurs actifs pourraient suffire à tout bloquer (estimation, à mesurer). À faire : mesurer les lectures par ouverture, lire moins (seulement ce qui sert), puis offre Blaze (paiement à l'usage) avec alerte de budget.
2. **Inscriptions ouvertes** : remplacer la liste d'accès (`allowlist`) par une inscription libre (garder la liste en option). Protéger le serveur : Firebase App Check, clé d'API restreinte (déjà notée). Règle n°1 : ne jamais restreindre `firestore.rules` sur un chemin existant.
3. **« Supprimer mon compte »** dans l'appli (le compte Firebase Auth et toutes ses données), en partant de l'effacement du patch 8. Sur le Play Store, Google exige en plus un lien web pour demander la suppression.
4. **Politique de confidentialité et mentions légales** (RGPD, données financières) : quelles données, où elles sont hébergées, qui peut y accéder (le propriétaire du projet Firebase le peut techniquement : le dire), combien de temps elles sont gardées, comment nous contacter. Sur le Play Store : formulaire « Sécurité des données ».
5. **Verrou de l'appli** par code ou empreinte.
6. **Installation simple** : Play Store (compte développeur, fiche, formulaire) ou au moins la version web. L'APK à installer à la main fait peur au grand public. Vérification des développeurs Android en 2027 (déjà notée dans `CLAUDE.md`).
7. **Aide** : « Signaler un problème » (e-mail ou formulaire), et une phrase claire « Estimation, pas une déclaration officielle » sur l'URSSAF.
8. **Arrivée d'un inconnu** : un mode démo avec des données fictives pour essayer sans compte.

### Idées de fonctions
- Auto-entrepreneurs : **livre des recettes** (registre obligatoire) prêt à exporter ; rappel de la déclaration URSSAF avec le montant à déclarer ; versement libératoire (patch 8) ; aide pour l'ACRE (taux réduit des débuts).
- Tout le monde : objectifs d'épargne avec barre de progression ; budget par catégorie avec alerte de dépassement ; widget Android (solde prévu) ; fixes détectés tout seuls à l'import d'un relevé ; compte à deux, pour un couple (gros chantier).

### Offre payante pour les auto-entrepreneurs (idée du propriétaire)
**L'idée** : un abonnement mensuel très petit. Le profil auto-entrepreneur reste utilisable gratuitement pour l'essentiel ; l'abonnement débloque des fonctions en plus.

**Principes (règle n°1 et confiance)**
- Tout ce qui est gratuit aujourd'hui reste gratuit (la famille l'utilise déjà).
- Jamais de données prises en otage : si l'abonnement s'arrête, tout reste lisible, exportable et sauvegardable ; seules les fonctions en plus se bloquent.
- Pas de limite sur le nombre d'opérations notées : une appli de budget qui bloque la saisie perd la confiance. Faire payer des outils en plus, pas la saisie.

**Fonctions payantes possibles** : export du livre des recettes et récapitulatif annuel pour la déclaration ; rappels des déclarations et paiements URSSAF ; plusieurs activités à des taux différents (vente + services) ; versement libératoire et ACRE ; suivi des clients et des factures impayées ; objectif de chiffre d'affaires et prévision de trésorerie sur 12 mois ; simulateurs (seuils, passage en société).

**À éviter** : faire les factures dans P-Flow. Avec la facturation électronique, les micro-entreprises émettent leurs factures par une plateforme agréée à partir du 1er septembre 2027 (réception obligatoire depuis le 1er septembre 2026) : trop lourd.

**Prix** : à décider (exemples : 1,99 à 2,99 €/mois, ou une formule à l'année moins chère).

**Technique** : il faut un serveur (Cloud Functions, offre Blaze) qui reçoit la confirmation de paiement et note l'abonnement dans un document que l'appli lit sans pouvoir l'écrire (nouvelle collection, écriture interdite aux appareils).
- Play Store (depuis le 30/06/2026 en Europe) : 10 % de frais de service sur les abonnements, + 5 % avec le paiement de Google Play ; les 5 % disparaissent avec un paiement externe, les frais de service restent.
- APK et web : Stripe (carte européenne 1,5 % + 0,25 €) ou une plateforme qui gère aussi la TVA pour toi (Paddle, Lemon Squeezy : frais plus élevés, à vérifier).

**Légal (à vérifier avec un comptable ou un juriste)** : conditions générales de vente ; résiliation en ligne « en 3 clics » obligatoire si on s'abonne en ligne (amende jusqu'à 75 000 €) ; droit de rétractation ; TVA (franchise, ventes à des particuliers d'autres pays de l'UE) ; ces revenus sont une nouvelle activité à déclarer.

**Ordre conseillé** : d'abord le lancement public gratuit, puis demander aux utilisateurs ce qu'ils paieraient, et seulement ensuite l'abonnement.

Chiffres relevés le 31/10/2026 : à revérifier au moment de s'y mettre.
