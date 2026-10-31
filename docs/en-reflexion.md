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
