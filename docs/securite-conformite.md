# P-Flow : sécurité et conformité

Règles à suivre : section « Règle n°2 » de `CLAUDE.md`. Ce fichier donne les références, l'état des lieux, le registre des données et ce qu'il reste à faire. Créé le 13/11/2026 à la demande du propriétaire ; à tenir à jour à chaque patch.

## Référentiels (vérifier la version à jour avant de s'en servir)
- CNIL, guide RGPD de l'équipe de développement : https://www.cnil.fr/fr/developper-en-conformite-avec-le-rgpd
- CNIL, recommandation « applications mobiles » (24/09/2024, mise à jour le 08/04/2025) : https://www.cnil.fr/fr/recommandations-applications-mobiles
- Firebase, checklist de sécurité : https://firebase.google.com/support/guides/security-checklist?hl=fr
- OWASP Mobile Top 10 (2024) : https://owasp.org/www-project-mobile-top-10/ et MASVS (exigences vérifiables) : https://mas.owasp.org/MASVS/
- Google Play, permission `REQUEST_INSTALL_PACKAGES` : https://support.google.com/googleplay/android-developer/answer/12085295 ; règles « Abus d'appareil et de réseau » : https://support.google.com/googleplay/android-developer/answer/9888379

## RGPD : où on en est
- Tant que l'appli sert au propriétaire et à sa famille, on est proche du cadre personnel et domestique (RGPD, art. 2.2.c). Dès qu'elle s'ouvre à d'autres personnes, le RGPD s'applique entièrement : le propriétaire devient responsable du traitement, Google (Firebase) son sous-traitant.
- On applique dès maintenant la protection des données dès la conception (règle n°2), pour ne pas tout reprendre au lancement public.

## État des lieux (13/11/2026, relevé rapide, pas un audit)
En place :
- Règles Firestore : accès réservé aux emails de `allowlist` avec email vérifié ; chacun ne lit et n'écrit que `users/{son uid}` ; `demandes` contrôlées (champs, types, tailles, date du serveur) ; `admins` en lecture seule ; tout autre chemin refusé (comportement par défaut de Firestore).
- Configuration Firebase publique, sans secret (normal : Firebase s'en sert pour identifier le projet, pas pour protéger les données).
- Aucune statistique d'usage, pub ni outil de suivi (pas de Firebase Analytics, Crashlytics, Sentry…) : à garder ainsi.
- Connexion : Google ou email + mot de passe (Firebase Auth).
- Google Drive avec l'accès minimal `drive.file` (l'appli ne voit que ses propres fichiers).
- Mises à jour téléchargées seulement depuis les releases du dépôt, paquet vérifié avant installation.
- Export tableur protégé contre les formules (patch 7). Fonction `esc()` pour le texte inséré dans la page.
- Permissions Android : `INTERNET`, `REQUEST_INSTALL_PACKAGES` (mises à jour intégrées).
- Effacement d'un jour, d'un mois, d'une année ou de tout le compte (patch 8).

Points à surveiller :
- La clé de signature `android/app/p-flow-release.p12` est dans le dépôt public, protégée seulement par son mot de passe (secret GitHub). Elle est déjà dans l'historique : la retirer ne servirait à rien. Son mot de passe doit être long et aléatoire (au moins 20 caractères). Ne jamais la régénérer (voir `CLAUDE.md`).
- 57 `innerHTML` dans `src/` : vérifier que chaque texte venant d'une personne ou d'un fichier passe par `esc()`.
- Pas d'App Check, clé d'API Firebase non restreinte (réglages de console).
- Les règles Firestore ne sont pas testées automatiquement.
- Mises à jour intégrées incompatibles avec le Play Store : une appli distribuée par Google Play ne peut pas se mettre à jour autrement que par Google Play, et `REQUEST_INSTALL_PACKAGES` n'y est pas permise pour ça. Une version Play Store devra désactiver la mise à jour intégrée et retirer cette permission (la version APK du site peut la garder).

## Registre des données (à tenir à jour : sert de base à la future politique de confidentialité)
| Donnée | Où | Pourquoi | Durée |
|---|---|---|---|
| Email, identifiant, nom affiché du compte | Firebase Auth (Google) | Connexion | Tant que le compte existe |
| Opérations, fixes, épargne, soldes, URSSAF, catégories, réglages (montants, libellés, dates) | Firestore, `users/{uid}/…` (Google) | Fonction principale | Tant que la personne ne les efface pas |
| Liste d'accès (emails) | Firestore, `allowlist` | Contrôle d'accès | Jusqu'au retrait par l'administrateur |
| Demande d'accès (email, nom, message ≤ 200 caractères) | Firestore, `demandes` | Demander l'accès | Jusqu'à la réponse de l'administrateur |
| Sauvegardes (copie complète du compte en JSON) | Google Drive de la personne, dossier « P-Flow Sauvegardes » | Sauvegarde | 12 copies, les plus anciennes à la corbeille |
| Réglages d'affichage, brouillons, dernier import | Appareil (`localStorage`, cache Firestore) | Confort, hors ligne | Sur l'appareil |
| Téléchargement des mises à jour | GitHub (releases) | Mises à jour | — |

À vérifier dans la console Firebase : région d'hébergement de Firestore (à indiquer dans la politique de confidentialité).

## À faire
**Dans le code** (patch 9, point 0 de la feuille de route ; rien ne change à l'écran ni dans les données) :
1. Relire chaque `innerHTML` : tout texte d'une personne, d'un fichier importé ou de Firestore passe par `esc()`.
2. Limites à l'import : taille maximale du fichier, nombre de lignes, longueur des libellés, montants hors bornes refusés.
3. Ajouter `npm audit --omit=dev --audit-level=high` au workflow GitHub (le build échoue sur une faille haute ou critique).
4. Tests automatiques des règles Firestore avec l'émulateur Firebase, lancés dans le workflow (recommandé par la checklist Firebase) : une personne ne lit pas les données d'une autre, un email non autorisé n'a accès à rien, les champs de `demandes` sont refusés hors format.

**Réglages, par le propriétaire ou avec lui** (prudemment) :
5. GitHub (gratuit pour un dépôt public) : activer les alertes Dependabot et l'analyse des secrets (« Secret scanning » avec « Push protection »).
6. Restreindre la clé d'API Firebase aux adresses de l'appli dans Google Cloud (déjà noté).
7. App Check : d'abord en mode « surveillance » seulement. L'imposer bloquerait toutes les versions installées qui ne l'ont pas : contraire à la règle n°1 tant que des anciennes versions circulent.
8. Vérifier la longueur du mot de passe de la clé de signature.

**Avant un lancement public** (obligatoire, en plus de `docs/en-reflexion.md`) :
9. Politique de confidentialité et mentions légales à partir du registre ci-dessus ; formulaire « Sécurité des données » sur le Play Store.
10. « Supprimer mon compte » dans l'appli et lien web de demande de suppression (exigé par Google Play).
11. Version Play Store sans mise à jour intégrée ni `REQUEST_INSTALL_PACKAGES`.
12. App Check imposé, inscriptions ouvertes protégées (abus, quotas).
13. Verrou de l'appli (code ou empreinte), écran masqué dans les applis récentes.
14. Audit complet par quelqu'un qui n'a pas écrit le code (au minimum une revue indépendante complète avec MASVS ; idéalement un professionnel).
