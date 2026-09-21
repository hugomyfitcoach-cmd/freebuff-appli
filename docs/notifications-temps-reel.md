# Mécanisme central de propagation des notifications

> Mission « audit complet + délai de propagation des notifications » —
> solution centralisée appliquée, mesurée et validée (2026-09-20).

## Problème initial (audit)

- **Côté cliente** : 3 compteurs (retours / message / Drive) pollés toutes les
  25 s → badge correct mais latence jusqu'à 25 s ; les **contenus** de pages
  (Drive, Bilans, Messages, Accueil) restaient one-shot SSR (un refresh
  manuel était nécessaire).
- **Côté coach** : badge CRM one-shot SSR — **aucune** remontée automatique :
  une photo, un bilan ou un RDV n'apparaissait qu'à la navigation suivante.
- **Flux sans notification** : « bilan hebdo envoyé » (types retirés) et
  « plan de repas assigné » (aucune trace).
- Cause : architecture BFF (le navigateur ne parle jamais à Convex) où tout
  est one-shot par défaut ; le temps réel n'existait que pour 3 compteurs.

## Solution centralisée appliquée

**Un seul endpoint (`GET /api/live`, `no-store`), un seul module
(`src/lib/notificationPoll.ts`), pour les deux rôles :**

| Rôle | Réponse `/api/live?since=<ms>` | Effet dans l'app |
|---|---|---|
| cliente | `{ retours, message, drive, total, events[] }` | badges Accueil/menu, badge icône PWA, revalidation des pages de consultation, invalidation ciblée sur `events` |
| coach | `{ notifications, journalVersion }` | badge cloche du CRM + revalidation du tableau de bord quand `journalVersion` avance |

### Signaux côté Convex

- `coach_events` (table `meta`, compteur cumulé) : incrémenté par
  `bumpCoachEvents`, appelé automatiquement dans `recordEvent` — donc à
  CHAQUE notification CRM. Comparer avant/après suffit (purge et marquages
  de lecture ne le touchent jamais → pas de faux positif).
- `clientEvents` (nouvelle table) : événements porteurs côté cliente
  (`recordClientEvent`), relus en delta par le poller (`newClientEvents`,
  `since`). Purge 7 jours par le tick CRM (30 min).
- « bilan_envoyé » réintroduit dans `coachNotifKind` : `checkins.submit`
  journalise maintenant l'événement (création comme mise à jour).
- `mealPlans.assignTemplate` : `recordClientEvent("plan_assigned")` +
  `recordEvent` CRM + Web Push (« Nouveau plan de repas » → Journal).
- `coach.removeClient` purge désormais journal CRM + événements cliente.

### Rythme de polling (identique aux deux rôles)

- 5 s au **premier plan** (app visible) ;
- **immédiat** au retour de focus / visibilité / `pageshow` (bfcache) ;
- **aucune requête** en arrière-plan (le réveil rattrape) ;
- coalescing des checks simultanés + garde anti-tempête 3 s ;
- 401 → arrêt propre du poller (déconnexion).

### Invalidation ciblée des contenus

Le poller émet un événement DOM `gflux:live-event` (détail `{ kind, label }`)
pour chaque événement porteur et les pages concernées s'y abonnent :

- `plan_assigned` → Accueil (`invalidateAll`) + Journal (re-fetch du jour) ;
- compteur `drive` qui monte → page Ressources se revalide ;
- compteur `retours` qui monte → page Historique se revalide ;
- compteur `message` qui monte → page Messages se revalide ;
- `journalVersion` qui avance → tableau de bord CRM se revalide.

### Étendre le système (future fonctionnalité)

1. Écrire la donnée métier dans la mutation Convex concernée.
2. Badge suffisant côté coach → rien d'autre (`recordEvent` bump le signal).
3. La page cliente doit se mettre à jour →
   `await recordClientEvent(ctx, userId, "mon_kind", label)` puis écouter
   `gflux:live-event` dans la page et s'y revalider.
4. Alerte app fermée → `sendPushToUser` côté BFF, après le commit réussi.

## Délais mesurés (local, script `scripts/e2e-notif-latency.mjs`)

`action commitée → visible dans l'app` (le poller relit `/api/live`
exactement comme la PWA ouverte) :

| Flux | Délai |
|---|---|
| Coach → cliente : Drive partagé → badge Drive | **271 ms** |
| Coach → cliente : plan assigné → événement `plan_assigned` | **254 ms** |
| Cliente → coach : bilan hebdo envoyé → badge + journal CRM | **244 ms** |
| Cliente → coach : photos envoyées → badge + journal CRM | **271 ms** |

Retour au premier plan : lecture immédiate (0–3 s pire cas, garde
anti-tempête). Objectif « < ~10 s sans refresh manuel » : atteint avec une
marge supérieure à 30×.

Rejouer la mesure : `node scripts/e2e-notif-latency.mjs http://127.0.0.1:5173`
(dev : `npx vite dev` — le serveur écoute sur `localhost` / IPv6).
