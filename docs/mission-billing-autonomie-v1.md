# MISSION — G-FLUX BILLING / STRIPE AUTONOMIE V1

> Branche `feat/billing-autonomie-v1` (depuis origin/main `50f62aa`). 100 % Stripe **TEST**,
> 0 € encaissé, 0 Convex prod touché, 0 donnée cliente réelle utilisée.
>
> **Révision 2** — décisions produit appliquées : grâce **24 heures** (plus 5 jours),
> **hard lock** complet hors facturation, **Customer Portal/Checkout réservés Autonomie**.

## 0. Contexte et règle fondamentale

La cliente en mode **Autonomie** (`coachingMode: "autonomy"`) paie son accès à l'app via
Stripe. La cliente en mode **Coaching** garde l'accès inclus, indépendamment de Stripe.

Décision d'accès — fonction unique [`canAccessApp`](../src/convex/billing.ts), testée :

| # | Situation | Décision |
|---|-----------|----------|
| 1 | `coachingMode: "coaching"` | **allow** (toujours, même si Stripe est cassé derrière) |
| 2 | Autonomie, aucun abonnement / aucune offre | **block** — HARD LOCK immédiat (une cliente passée de coaching à autonomie sans abonnement n'a jamais de grâce) |
| 3 | Autonomie + accès offert par le coach (`billingAccessOverride: "complimentary"`) | **allow** |
| 4 | Abonnement `active` | **allow** |
| 5 | Abonnement `trialing` | **allow** |
| 6 | `past_due` + grâce 24 h non expirée | **allow_with_payment_warning** (alerte calme) |
| 7 | `past_due` grâce expirée (ou sans grâce) | **block** |
| 8 | `canceled` / période payée atteinte | **block** |
| 9 | Résiliation programmée, période payée en cours (`active`/`canceled` + `current_period_end` futur) | **allow** |

Ordre strict : coaching → complimentary → actif/trialing → période payée en cours →
grâce past_due → block. **Aucune donnée n'est jamais supprimée** : bloquer = empêcher
l'entrée dans /espace, le compte et l'historique restent intacts (inaccessibles).

## 1. Audit initial

- **AGENTS.md : n'existe pas** (vérifié à la racine et dans tous les worktrees). Conventions
  tirées du code : secrets serveur via `$env/dynamic/private`, jamais `PUBLIC_*` pour un
  secret, garde-fous Convex (`requireCoach`, sessionToken optionnel + résolution serveur).
- `schema.ts` : table `users` sans aucun champ Stripe ; index `by_email` ; `coachingMode`
  optionnel avec fallback `"coaching"` (comportement historique préservé).
- `resolveSession` (users.ts) : source de la session BFF — étendu additivement (billing).
- `/espace` protégé au niveau `+layout.server.ts` via `requireRole('client')` : le guard
  billing devait s'y placer pour couvrir toute sous-page (impossible de contourner par URL).
- CRM coach : fiche cliente (`updateFiche`) gère déjà `coachingMode` → point d'ancrage
  naturel du bloc « Accès G-FLUX ».
- Convex `http.ts` : aucune route Stripe ; les previews Netlify recréent un Convex preview
  (`netlify.toml [context.deploy-preview]` : `convex deploy --preview-create` + seed).
- `.env` : aucune variable Stripe existante → fail-closed obligatoire (§9).

## 2. Champs Convex ajoutés (tous OPTIONNELS / additifs)

Table `users` ([schema.ts](../src/convex/schema.ts)) — aucune donnée existante modifiée :

| Champ | Type | Rôle |
|---|---|---|
| `billingAccessOverride` | `"complimentary"` \| rien | Accès offert par le coach (ne touche jamais Stripe) |
| `stripeCustomerId` | string | Customer Stripe (Checkout/Portal/webhook) |
| `stripeSubscriptionId` | string | Abonnement courant |
| `stripeSubscriptionStatus` | union 8 statuts Stripe (`active`, `trialing`, `past_due`, `canceled`, `unpaid`, `incomplete`, `incomplete_expired`, `paused`) | Statut dérivé |
| `stripePriceId` | string | Mensuel / annuel (mapping par env BFF) |
| `stripeCurrentPeriodEnd` | number (ms) | Fin de période payée |
| `stripeCancelAtPeriodEnd` | boolean | Résiliation programmée |
| `stripeGraceUntil` | number (ms) | Fin de grâce 24 h après échec |

+ index `by_stripeCustomer` sur `users`. Nouveau module [src/convex/billing.ts](../src/convex/billing.ts)
: logique pure (`canAccessApp`, `nextGraceUntil`, `patchMeaningfullyDiffers`,
`subscriptionPatchFromStripe`, `accessStateForUser`) + query `accessState` (session) +
query `myStripeCustomerId` (session) + fonctions webhook PUBLIQUES protégées par le secret
partagé `CONVEX_BILLING_WEBHOOK_SECRET` (`webhookUserExists`, `userByStripeSubscription`,
`userByStripeCustomer`, mutation `syncFromStripe`) — même motif que le bootstrap coach :
le SDK Convex HTTP du BFF ne peut pas appeler d'`internal`.

## 3. Guard serveur (verrouillage réel, pas de l'UI)

- [`src/lib/server/session.ts`](../src/lib/server/session.ts) : `requireClientAccess()` =
  `requireRole('client')` + lecture `billing.decision` (dérivé côté Convex dans
  `resolveSession`) + `redirect(303, '/espace/facturation')` si `block`. Jamais un simple
  masquage de menu.
- [`src/routes/espace/+layout.server.ts`](../src/routes/espace/+layout.server.ts) : tout
  `/espace/*` passe par `requireClientAccess`, **sauf** `BILLING_OPEN_PATHS =
  ['/espace/facturation']` — **hard lock** (révision 2) : pendant le lock, la cliente
  n'a accès qu'à la facturation (re-souscription) et à la déconnexion (action `?/logout`
  sur la page facturation). Tout le reste est inaccessible côté serveur : Accueil,
  Journal, Progression, Entraînement, Bilans, Photos, RDV, **Profil, Compte,
  Notifications (la page Paramètres entière est verrouillée)**. Données conservées
  mais inaccessibles. Décision prise AVANT toute charge de page.
- L'état `billing` est calculé côté Convex (horloge serveur) — le client ne peut rien forger.

## 4. Routes Stripe créées

- `POST /api/billing/checkout` ([+server.ts](../src/routes/api/billing/checkout/+server.ts)) :
  auth cliente ; **autonomie uniquement** — `coachingMode !== 'autonomy'` → **403**
  (une cliente coaching ne peut pas créer accidentellement un abonnement Autonomie par
  appel API direct) ; le navigateur n'envoie QUE `{ plan: "monthly" | "yearly" }` ; le
  priceId vient STRICTEMENT des env serveur (`STRIPE_PRICE_AUTONOMY_*`) ; Session Checkout
  en mode `subscription` avec `client_reference_id`, `metadata.gfluxUserId/gfluxEmail`,
  `subscription_data.metadata`, customer existant réutilisé (`myStripeCustomerId`),
  success/cancel → `/espace/facturation?checkout=…` ; non configuré → **503** (fail-closed).
- `POST /api/billing/portal` : Customer Portal — **autonomie uniquement** → **403** pour
  coaching (aucun accès Portal via G-FLUX, vérifié côté serveur) ; l'ID Customer vient
  TOUJOURS de la base ; aucun customer → 400 (jamais d'ID reçu du navigateur).
- `POST /api/billing/webhook` : signature Stripe **obligatoire** via `constructEventAsync`
  (raw body), invalide/absente → **400** ; relit TOUJOURS l'abonnement réel chez Stripe
  avant d'écrire (source de vérité = API, jamais l'événement) ; metadata `gfluxUserId`
  validée par regex `^[a-z0-9]{32}$` (id Convex) sinon résolution par subscription/customer
  ; 503 si secrets absents.
- [`src/lib/server/stripe.ts`](../src/lib/server/stripe.ts) : fail-closed — refuse
  `sk_live_`/`rk_live_`, n'accepte que `sk_test_`/`rk_test_`, `priceIdForPlan`,
  `planForPriceId`, `webhookSecret()` (`whsec_`), `convexBillingSecret()`, `billingConfigured()`.

## 5. Webhooks supportés

| Événement | Effet |
|---|---|
| `checkout.session.completed` | Persiste `stripeCustomerId` ; sync abonnement réel |
| `invoice.paid` | Sync + **efface la grâce** |
| `invoice.payment_failed` | Sync + **grâce = instant de l'événement + 24 h** |
| `customer.subscription.updated` | Sync état réel (statut, fin de période, cancel_at_period_end, price) |
| `customer.subscription.deleted` | Sync état final + efface la grâce |

Toutes les écritures passent par `syncFromStripe` : idempotent (`patchMeaningfullyDiffers`
→ no-op si identique), grâce plafonnée au max de l'existant en base (§6), statut limité à
l'union des 8 statuts Stripe (validation côté Convex).

## 6. Grâce 24 heures (révision produit)

- `invoice.payment_failed` → `stripeGraceUntil = événement.created + GRACE_PERIOD_MS (24 h exactes)`.
- Cette grâce concerne UNIQUEMENT un abonnement qui était actif et dont le
  **renouvellement** échoue. Elle ne s'applique JAMAIS à une cliente qui vient d'être
  passée de coaching à autonomie sans abonnement → **hard lock immédiat** (aucun
  événement Stripe dans ce cas, et une souscription initiale échouée reste `incomplete`,
  jamais `past_due`).
- Pendant la grâce : décision `allow_with_payment_warning` → accès maintenu + bannière
  calme (page Facturation) avec CTA « Mettre à jour mon moyen de paiement » (Customer
  Portal). +23h59 → encore autorisé ; +24h01 → hard lock (bornes testées).
- **Un doublon ne repousse jamais les 24 h** : la mutation plafonne au max de l'existant
  en base ; deux livraisons du même événement (même `created`) donnent strictement la
  même échéance.
- `invoice.paid` / `subscription.deleted` → grâce effacée.
- Grâce expirée + toujours `past_due` → `block` (guard serveur).

## 7. Accès offert (complimentary, §12 mission)

- Mutation [`coach.setComplimentaryAccess`](../src/convex/coach.ts) (coach requis) : pose ou
  retire `billingAccessOverride`, ne touche JAMAIS à Stripe, retourne la décision recalculée.
- UI coach : Vision 360 → rangée d'actions → drawer « Accès G-FLUX » : Mode (Coaching/
  Autonomie), Accès (Inclus / Offert / Abonnement actif / Paiement à régulariser / Suspendu),
  bouton « Offrir l'accès G-FLUX » / « Retirer l'accès offert ».
- Retrait de l'offre : la cliente repasse sous la règle Autonomie (un abonnement actif
  derrière continue de vivre — recalcul dérivé, rien d'effacé).

## 8. Parcours cliente (UI)

- `/espace/facturation` : **autonomie uniquement** — une cliente coaching est redirigée
  vers `/espace` côté serveur (aucune page Facturation, pas un simple masquage d'onglet).
  Autonomie : bannière grâce + CTA portal ; carte « Accès offert » ; carte abonnement
  (statut, échéance, « prendra fin le… », Portal) ; paywall 2 offres (annuel par défaut,
  badge « 2 mois offerts », soit 10,75 €/mois ; mensuel 15,90 €) ; retours Checkout
  success/cancel honnêtes ; **déconnexion** disponible (seule page ouverte pendant le
  hard lock).
- Côté coaching : aucun onglet Facturation, aucun bouton Portal (rien à facturer).
- `/espace/parametres` (profil, compte, notifications, facturation, déconnexion) :
  ouverte uniquement aux clientes non bloquées — pendant le hard lock elle est verrouillée
  comme tout le reste de /espace.

## 9. Variables d'environnement requises (TEST uniquement)

```bash
# BFF SvelteKit (Netlify) — secrets serveur, JAMAIS PUBLIC_*
STRIPE_SECRET_KEY=sk_test_…                    # clé secrète TEST
STRIPE_WEBHOOK_SECRET=whsec_…                  # endpoint webhook (signing secret TEST)
STRIPE_PRICE_AUTONOMY_MONTHLY=price_…          # price TEST 15,90 € / mois
STRIPE_PRICE_AUTONOMY_YEARLY=price_…           # price TEST 129 € / an

# Convex (npx convex env set … — déploiement preview) + BFF (même valeur)
CONVEX_BILLING_WEBHOOK_SECRET=<chaîne aléatoire longue>
```

Sans ces variables : checkout/portal répondent 503, la page Facturation affiche un état
honnête (« souscription en ligne arrive très bientôt »), le webhook refuse tout. Aucune
clé LIVE n'est acceptée (rejet explicite dans stripe.ts).

## 10. Étapes exactes — objets Stripe TEST (dashboard test mode)

1. Activer le **mode Test** (toggle « Test mode » du dashboard).
2. **Product** : Products → + Add product → « G-FLUX Autonomie » → deux prices récurrents :
   - `15.90 €` / recurring / `monthly` → copier `price_…` → `STRIPE_PRICE_AUTONOMY_MONTHLY`
   - `129 €` / recurring / `yearly` → copier `price_…` → `STRIPE_PRICE_AUTONOMY_YEARLY`
3. **Webhook** : Developers → Webhooks → + Add endpoint → URL
   `https://<domaine-preview-netlify>/api/billing/webhook` → événements :
   `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`,
   `customer.subscription.updated`, `customer.subscription.deleted`
   → copier le signing secret `whsec_…` → `STRIPE_WEBHOOK_SECRET`.
4. **Customer Portal** : Settings → Billing → Customer portal (mode Test) → activer :
   « Customers can update payment methods », « cancel subscription » (au choix :
   immédiate ou fin de période), factures téléchargeables. Pas de code nécessaire.
5. Poser les env : Netlify (deploy preview) pour `STRIPE_*` + `CONVEX_BILLING_WEBHOOK_SECRET`
   ; `npx convex env set CONVEX_BILLING_WEBHOOK_SECRET <même valeur>` sur le déploiement
   Convex preview.

## 11. Protocole de test complet — cartes Stripe TEST

Compte de test : créer une cliente **Autonomie** (fiche coach → mode Autonomie), se
connecter, aller sur `/espace/facturation`.

| Carte TEST | Effet attendu |
|---|---|
| `4242 4242 4242 4242` | Paiement OK → `checkout.session.completed` + `invoice.paid` → abonnement `active`, accès allow, carte « Actif » + prochaine échéance |
| `4000 0000 0000 0341` | Attach OK puis **échec** au renouvellement → `invoice.payment_failed` → `past_due` + grâce 24 h → accès maintenu + bannière calme |
| `4000 0025 0000 3155` | Paiement `requires_payment_method` générique → même traitement d'échec |
| `4000 0000 0000 9995` | Fonds insuffisants (`card_declined`) → échec → grâce |
| `4000 0000 0000 0069` | Carte expirée → échec au Checkout |
| `4000 0000 0000 3220` | 3DS obligatoire → défi d'authentification puis succès |

Scénarios de bout en bout :

1. **Souscription** : carte 4242 → retour `?checkout=success` → (webhook) état « Actif » ;
   vérifier `stripeCustomerId`, `stripeSubscriptionId`, `stripeCurrentPeriodEnd` en base preview.
2. **Hard lock avant paiement** : cliente Autonomie sans abonnement → toute URL
   `/espace/*` (y compris `/espace/parametres`, accueil, journal…) renvoie vers
   `/espace/facturation` (serveur) ; depuis la facturation, « Se déconnecter » fonctionne.
3. **Échec → grâce 24 h** : carte 0341 → accès conservé avec bannière ; simuler +24h01
   (graceUntil dépassé en base) → hard lock au prochain chargement.
4. **Doublon** : re-livrer le même `invoice.payment_failed` (Developers → Webhooks →
   resend) → `stripeGraceUntil` INCHANGÉ (les 24 h ne sont jamais repoussées).
5. **Régularisation** : Portal (carte 4242) → `invoice.paid` → grâce effacée, statut Actif.
6. **Résiliation** : Portal → annuler → `updated` (`cancel_at_period_end=true`) → accès
   maintenu jusqu'à la fin de période, « prendra fin le… » ; après `deleted`/fin → hard
   lock, paywall, données intactes.
7. **Complimentary** : coach → « Offrir l'accès G-FLUX » → cliente Autonomie sans
   abonnement retrouve l'accès ; « Retirer » → hard lock ; aucune écriture Stripe.
8. **Coaching** : repasser la fiche en Coaching → accès inclus en toutes circonstances ;
   `/espace/facturation` redirige vers `/espace` ; POST direct sur `/api/billing/portal`
   ou `/api/billing/checkout` (session coaching) → **403**.
9. **Autonomie active** : Portal et Checkout autorisés (portal renvoie une URL Stripe).
10. **Fail-closed** : retirer les env Stripe du preview → checkout/portal 503, page
    honnête, webhook 503 ; aucune erreur 500 côté cliente.

## 12. Notes de mise en œuvre

- `_generated/` est committé et `npx convex codegen` exige un déploiement →
  [api.d.ts](../src/convex/_generated/api.d.ts) patché à la main (module `billing`) ; le
  CI/preview Convex le regénérera proprement au `convex deploy`.
- Pas de `gh` CLI disponible → PR créée via push + lien de comparaison GitHub.
- Tests : [tests/mission-billing-autonomie.test.mjs](../tests/mission-billing-autonomie.test.mjs)
  — matrice canAccessApp, bornes grâce 24 h (+23h59 / +24h01), plafonnement doublon,
  hard lock (coaching → autonomie sans abonnement, `/espace/parametres` inaccessible,
  facturation ouverte + déconnexion), Portal/Checkout 403 coaching, 403/400 serveur,
  fail-closed. `npm test` : 478/478.
- Vérifications : `npm test` ✔ 478/478 · `npm run check` ✔ 0 erreur (warnings préexistants)
  · `npm run build` ✔.

## 13. Confirmations explicites

- ✅ Aucun Stripe LIVE utilisé (fail-closed : les clés LIVE sont rejetées par le code).
- ✅ Aucun paiement réel (mode Test, cartes de test uniquement, 0 € encaissable).
- ✅ Aucun Convex prod touché (aucun `convex deploy` hors preview ; base prod calm-jaguar-475 intacte).
- ✅ Aucun merge sur main (branche dédiée `feat/billing-autonomie-v1`, PR ouverte).
- ✅ Aucune donnée cliente prod utilisée ni modifiée (aucune donnée supprimée nulle part :
  schema 100 % additif, bloquer n'efface rien — les données restent conservées, inaccessibles).
