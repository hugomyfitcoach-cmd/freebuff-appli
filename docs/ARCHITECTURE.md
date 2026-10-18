# Carte d'architecture — G-FLUX

*Base : branche `main` (octobre 2026). Uniquement des faits vérifiés dans le code ; ce qui est déduit est marqué « non vérifié ».*

## 1. Vue d'ensemble

- **Frontend** : SvelteKit 2 + Svelte 5, Tailwind 4, déployé sur **Netlify** (`adapter-netlify`, fonction SSR unique — `netlify.toml`).
- **Base de données / logique métier** : **Convex** (projet `calm-jaguar-475`, région eu-west-1) — tables + fonctions (queries/mutations/actions) dans `src/convex/`.
- **PWA** : installable sur téléphone (manifest + service worker), notifications push Web.
- **Autres services** : Stripe (paiement), OpenAI (analyses alimentaires), Google Calendar (RDV), Web Push (VAPID).
- **Trajet d'une requête** : le navigateur ne parle **jamais** directement à Convex. Il appelle SvelteKit (pages + ~100 routes `/api/*`) ; le serveur SvelteKit (BFF) ajoute le jeton de session et appelle Convex (`src/lib/server/convex.ts`). Tout passe par ce couloir unique.

## 2. Authentification et session

- Connexion par email/mot de passe sur `/connexion` → mutation Convex `users.signIn` → **cookie HttpOnly `gflux_session`** (valable 30 jours). Déconnexion : `users.signOut` + suppression du cookie.
- Chaque requête serveur reconnait l'utilisatrice via `users.resolveSession` (Convex), dans `src/lib/server/session.ts`.
- **Deux rôles** : `coach` (CRM `/admin`, 1 compte) et `client` (espace `/espace`). Les gardes `requireRole` / `requireClientAccess` bloquent les mélanges de rôles.
- **Verrou facturation** : l'accès est dérivé côté Convex (`billing.ts` → `canAccessApp` : coaching = inclus ; autonomie = abonnement Stripe actif, gratuité, ou grâce de 24 h). Une cliente bloquée est redirigée vers `/espace/facturation` par le layout serveur — sauf facturation et déconnexion.

## 3. Pages principales

**Cliente (`/espace`)** — Accueil (dashboard : message du coach, bilan à faire, pas, calories, rappels) ; Journal (repas du jour) ; Progression (poids, mensurations, photos) ; Mes bilans (`/espace/historique`, retours du coach) ; Messages ; Ressources (Drive) ; Entraînement ; Performance ; Hydratation ; Mes pas ; Cycle ; Dépense sportive ; RDV ; Paramètres ; Facturation ; Démarrage (onboarding). Hors espace : `/bilan` (formulaire bilan hebdo, ouvert **vendredi 9h → dimanche 12h**), `/outils` (calibrage), `/recettes`, `/onboarding/install`.
**Coach (`/admin`)** — Tableau de bord (liste clientes + Vision 360) ; Bilans (bord des bilans hebdo, semaine par semaine) ; Notifications (journal CRM + messages) ; Plans de repas ; Entraînement (programmes) ; Templates ; RDV ; Photos ; Exercices (bibliothèque).
Données : le layout `/espace` recalcule à chaque navigation le `dashboard` (badges compris) + la photo de profil ; chaque page y ajoute ses requêtes.

## 4. Mises à jour automatiques (constats de l'audit)

| Mécanisme | Rythme | Arrière-plan ? |
|---|---|---|
| Poll central `src/lib/notificationPoll.ts` → `/api/live` (badges, événements temps réel) | 5 s au premier plan + immédiat au retour de focus/visibilité | Non (garde `document.hidden`) |
| Veille de version `swUpdate.ts` → `/api/app/version` | 60 s + focus/visibilité | Non |
| CRM Bilans (`admin/bilans`) → `invalidateAll` | 30 s | **Oui**, aucune garde |
| CRM → revalidation à chaque événement cliente (`journalVersion`) | événementiel | non |
| Changement de jour (`currentDay.svelte.ts`, minuit local) → `invalidateAll` | 1×/jour | timer gelé, rattrapé au réveil |
| Retour de focus facturation (`billingRefresh.ts`) → `invalidateAll` | focus seulement | non |
| Crons Convex (côté serveur) | purge audios 1 h ; rappel RDV 12 h (5 min) ; alertes CRM (30 min) ; rattrapage message global (5 min) | — |

Aucun signal direct « saisie Journal → Accueil » : mise à jour par rechargement à la navigation (le préchargement d'onglet peut servir des données de moins de 30 s). Le badge « message coach » (poll ≤ 5 s) et la carte épinglée (rechargement de page) n'apparaissent donc pas toujours ensemble.

## 5. Service worker (`src/service-worker.ts`)

- **Coquille de l'app** (JS/HTML/icons du build) : pré-cachée à l'installation, cache nommé par version — un nouveau déploiement invalide l'ancien.
- **Vignettes alimentaires** (OpenFoodFacts + miroir Convex `/api/storage/`) : cache stable `gflux-img-v1`, 600 entrées max, stratégie « servi du cache puis rafraîchi en arrière-plan ».
- **Notifications push** : affichage (`push`) + ouverture de la bonne page (`notificationclick`).
- **Mise à jour** : le client peut forcer l'activation (`SKIP_WAITING`) puis recharge ; un bandeau signale toute nouvelle version (service worker, contrat API ou empreinte de build).

## 6. Convex — principaux groupes de fonctions

- **Utilisateurs/session** (`users.ts`) : connexion, résolution de session, profil, cycle, photo.
- **Alimentation** (`journal`, `meals`, `foods`, `customFoods`, `ciqual*`, `off`, `mealMatch`, `foodImages`, `foodPortions`, `foodRanking`) : journal, recherche, scan de code-barres, photos de repas, base Ciqual + OpenFoodFacts.
- **Suivi** (`metrics`, `photos`, `hydration`, `steps`) : poids, mensurations, photos, hydratation, pas.
- **Bilans** (`checkins`) : bilan hebdo, retours coach.
- **Accueil** (`dashboard`) : dashboard, badges, messages du coach, message global.
- **CRM coach** (`coach`, `notifications`) : Vision 360, journal d'activité, notifications, signal temps réel (`clientEvents`).
- **Entraînement** (`training*`, `sport*`) : programmes, séances, historique.
- **RDV** (`appointments`, `googleCalendar`) : réservation, disponibilités, sync Google.
- **Facturation** (`billing`) : accès dérivé, sync Stripe.
- **Médias/Drive** (`media`, `resources`) : audios, contenus partagés.
- **Push** (`push`, `reminderPush`, `webPushVendors`) : abonnements, rappels.
- **Divers** : `mealPlans`, `aiAnalysis`/`aiLog`, `betaAccess`, `appVersion`, `onboarding`, `tools` (calibrage), `crons` (4 jobs planifiés), `maintenance`.

## 7. Environnements — noms des variables (valeurs jamais affichées)

- Convex : `PUBLIC_CONVEX_URL`, `PUBLIC_CONVEX_SITE_URL`, `CONVEX_DEPLOY_KEY`, `CONVEX_DEPLOYMENT`.
- Compte coach : `COACH_EMAIL`, `COACH_PASSWORD`, `COACH_BOOTSTRAP_CODE`.
- IA : `OPENAI_API_KEY`, `OPENAI_MODEL`.
- Google : `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_ENC_KEY`, `GOOGLE_REDIRECT_URI`.
- Stripe : `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_AUTONOMY_MONTHLY`, `STRIPE_PRICE_AUTONOMY_YEARLY`, `STRIPE_EXPECTED_MODE`, `CONVEX_BILLING_WEBHOOK_SECRET`.
- Push : `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
- Déploiement Netlify : `CONTEXT`, `PULL_REQUEST`, `REVIEW_ID`, `PREVIEW_DIAG`, `PREVIEW_SEED_TOKEN`, `E2E_TARGET_URL`.
- Règle stricte Stripe : preview = mode TEST uniquement, production = mode LIVE uniquement (`stripeMode.ts`, refus croisé fail-closed).

## 8. Tests (46 fichiers, `npm test` = node --test)

- **Garde-fous d'infra** : `mission-convex-safety` (aucune URL de prod en repli dans les scripts) ; `e2e-env-guard` (la production Convex est TOUJOURS refusée comme cible de test) ; `mission-netlify-preview-isolation` (chaque PR = backend Convex isolé, jamais de partage ni de suppression).
- **Argent et accès** : `stripe-mode` (TEST/LIVE selon contexte) ; `mission-billing-autonomie` (matrice complète `canAccessApp` : coaching, autonomie, gratuité, grâce…).
- **Robustesse** : `mission-session-load` (chargement de séance : timeout 15 s, exactement 1 retry, jamais de spinner infini) ; `mission-messages-coach` (« J'ai lu » = geste explicite).
- **Métier** : vision 360 (journées calendaires Europe/Paris), journal, scan de code-barres, repas IA, hydratation, semaines, etc.

## 9. Zones sensibles (à toucher avec précaution)

| Fichier / zone | Pourquoi |
|---|---|
| `src/lib/server/session.ts`, `src/convex/users.ts`, `helpers.ts` | Authentification, rôles, verrou facturation — erreur = clientes bloquées ou déconnectées |
| `src/convex/billing.ts`, `src/lib/server/stripe.ts`, `stripeMode.ts` | Argent réel, logique fail-closed TEST/LIVE |
| `src/convex/schema.ts` | Modèle de données partagé par toutes les fonctions |
| `src/lib/server/convex.ts` | Client Convex unique côté serveur (point de passage obligé) |
| `netlify.toml`, `scripts/deploy*.mjs` | Déploiements et isolation des aperçus par PR |
| `src/service-worker.ts`, `src/lib/swUpdate.ts` | Cache PWA + mise à jour (incident historique : PWA périmées) |
| `src/lib/notificationPoll.ts`, `routes/api/live` | Tout le temps réel de l'app |
| `src/convex/dashboard.ts`, `notifications.ts` | Badges, messages du coach, journal CRM |
| `src/hooks.server.ts` | En-têtes de cache des pages (fraîcheur après déploiement) |

---

## Annexe — PR #20 (`fix/midnight-date-rollover`) : **fusionnée**

**Statut : fusionnée dans `main` le 16 octobre 2026** (merge `a543fc0`, « Merge pull request #20 »). `main` local = `origin/main` = `a543fc0` au moment de la rédaction de cette annexe.

Contenu : 8 commits, 38 fichiers (+1 112 / −314) : **`f2988fa`** passage à minuit **heure de Paris** pour le suivi quotidien (cœur de la PR) ; **`892d23f`+`b0f0f17`** écran « bilan fermé » navigable ; **`2680e2b`+`ace787c`** CRM : courbe de tendance de poids et moyennes de protéines en direct ; **`6c5998a`** portions de recette via la feuille de quantité partagée ; **`a1ee22f`** navigation basse fixe pendant le scroll du Journal ; **`67b8bdc`** résilience PWA après perte de réseau. Touche aussi `currentDay.svelte.ts`, `service-worker.ts`, `convex/helpers.ts`, `metrics.ts`, `server/convex.ts`, `server/session.ts`. Nouveaux tests : `mission-midnight-timezone`, `mission-pwa-resilience`, `mission-crm-vision360`, `mission-admin-weight-trend`, `mission-bilan-closed-back`.

La branche `fix/midnight-date-rollover` est donc l'état de `main` ; aucune comparaison ouverte ne subsiste. La présente release (`release/2026-10-b`) part de ce point.
