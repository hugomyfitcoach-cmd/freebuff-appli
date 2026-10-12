# AUDIT — ASSISTANT G-FLUX IA V2 (Phase 1 : diagnostic & plan)

**Date :** 2026-10-08 · **Base d'audit :** branche `feat/assistant-gflux-v1`, commit `69e7055`, PR #16 (non mergée)
**Mode :** lecture seule. Aucun code, schéma, donnée, variable d'env, branche, commit ou deploy modifié.

**Preuves de terrain** : reproductions réelles effectuées le 08/10 sur la Deploy Preview (compte seed fictif Sophie Martin), transcription dans le rapport. Aucune écriture métier (messages de conversation uniquement).

---

## A. DIAGNOSTIC V1

### A.1 Ce qui fonctionne réellement (vérifié en E2E)

| Capacité | Preuve |
|---|---|
| Conversation avec outils réels, chiffres 100 % serveur | « Combien de calories il me reste ? » → 796 kcal calculées par `getToday`, jamais par le modèle |
| Écriture preview → clic → écriture → undo | journal : 2 aliments ajoutés puis retirés via `resolveAction` |
| Anti-double-submit & anti-rafale | 2 envois simultanés → un seul accepté (400 « demande déjà en cours ») |
| Action falsifiée refusée | `actionId` inconnu → 400, payload non falsifiable (client n'envoie que l'id) |
| Sécurité avant coût IA | écran de détresse déterministe exécuté avant tout appel OpenAI |
| Hard lock Billing/Autonomie | `requireClientAccess` BFF **et** `accessStateForUser` recalculé dans chaque outil Convex |
| Estimation structurée | « 2 œufs et 30 g d'avoine » → valeurs Ciqual (140 kcal/100 g œufs), pas d'estimation IA ici |
| Quotas | `reserve` transactionnelle : quota + incrémentation atomiques, remboursement sur panne IA |

### A.2 Ce qui fonctionne partiellement

1. **« Analyse ma journée »** → l'agent répond mais se limite au journal du jour (souvent vide) : il ne produit pas de *bilan* (comparaison objectifs/réalisés, tendances, lecture des jours précédents, mensurations). Pas de refus, mais une analyse pauvre. *Reproduit sur preview.*
2. **Estimations alimentaires** : la chaîne `searchFood → getFoodReference/estimateFoodPortion → fallback IA` existe, mais la correspondance nom → fiche dépend de la qualité de la requête du modèle (français générique vs noms Ciqual/OFF). « Œufs crus » matche ; un plat composé non. L'estimation IA (`aiKcal100` → `nutritionGuard`) est correctement bornée et marquée, mais le modèle la choisit trop vite (requête trop vague).
3. **Photo en conversation** : l'attach de photo existe (composer + pipeline Repas IA) mais l'agent ne *voit* pas l'image — il reçoit une **chaîne de texte** `[Photo jointe : pomme, riz…]`. Il ne peut donc ni commenter le contenu, ni faire de recette frigo, ni lire une étiquette en conversation. *Reproduit : « Je ne peux pas analyser des photos. »*
4. **Contexte conversationnel** : fenêtre 12 messages, fils persistés en base. Mais aucune donnée client (objectifs, profil, dernières mesures) n'est injectée : le modèle part « à l'aveugle » et doit appeler un outil pour tout, et le fil retombe à plat quand il ne le fait pas.

### A.3 Ce qui manque (vision V2)

- **Analyse nutritionnelle avancée** : aucune combinaison alimentaire proposée pour compléter macros restantes ; aucune adaptation de recette aux macros ; pas de liste de courses.
- **Analyse corporelle** : `bodyMetrics` (poids + cou/taille/hanches, historique complet) n'est exposé qu'en *dernier poids* et *moyenne semaine* — aucune tendance (régression, comparaison S/S-1), aucune comparaison de mensurations.
- **Bilans hebdo** (`checkins`, avec retours du coach) : **aucun outil** ne les lit. L'agent ignore ce que Hugo a dit.
- **Profil** (`users.prenom, heightCm, birthDate, timeZone`) : non injecté.
- **Modification d'entrée du journal** (changer une quantité) : seul ajout/suppression existe.
- **Multi-jours** : `prepareJournalEntry` est mono-date ; « tous les matins de la semaine » impossible.
- **Orchestration multi-actions** : un seul `pendingAction` par tour.
- **Streaming** : attente 2–12 s sans flux de tokens.

### A.4 Problème modèle

- Modèle effectif : **`gpt-4o-mini`** (borné par la liste fermée `gpt-4o | gpt-4o-mini | gpt-4.1(-mini/nano) | o4-mini`), Chat Completions, `max_tokens 1400`, `temperature 0.3`, timeout 40 s, boucle ≤ 4 rounds.
- **Le modèle n'est PAS le facteur limitant principal.** Les refus injustifiés viennent du *prompt* (A.5), pas des capacités. En revanche :
  - `max_tokens 1400` coupe les analyses longues ;
  - la fenêtre 12 messages limite les conversations multi-étapes ;
  - gpt-4o-mini est en dessous de gpt-4o/4.1 sur le *tool-calling multi-étapes* et la sujettivité des instructions nuancées (le cas B ci-dessous le montre) ;
  - aucun streaming, pas de vision native dans la boucle agent.

### A.5 Problème system prompt (cause racine n°1)

Dans [policy.ts](../src/lib/assistant/policy.ts) — `assistantSystemPrompt()` :

1. **Règle « décision de coaching » sur-généralisée** : *« Quand une décision de coaching est nécessaire (objectif, stratégie, ajustement du plan, bilan), réponds : 'Ça mérite une décision de coaching…' »*. Le modèle classe « comment atteindre mes protéines restantes ? » comme *stratégie* → renvoi Hugo. **Reproduit le 08/10** : question macros → refus pur, zéro outil appelé. C'est le bug A/B constaté.
2. **Aucune description des capacités d'image** : le prompt ne dit pas au modèle qu'une photo peut être jointe ni ce qu'il peut en faire → « je ne peux pas analyser des photos ».
3. **Consigne de format contradictoire avec l'UI** : le prompt n'interdit pas le markdown, l'UI ne le rend pas → `**Poids · 2026-10-08**` affiché brut. **Reproduit.**
4. **Pas de contexte client initial** : rien sur l'identité, les objectifs, l'ancienneté, le mode (Coaching/Autonomie) → impossible de contextualiser sans outil.
5. La règle « ne recalcul JAMAIS » est correcte mais devrait être adossée à une règle positive : « appelle getToday AVANT de répondre à toute question chiffrée » (sinon le modèle improvise, comme dans le cas B où il n'a appelé aucun outil).

### A.6 Problème d'accès aux outils

- 12 outils déclarés (dont `setTopic`), tous câblés dans le switch géant de `send()` ([assistant.ts](../src/convex/assistant.ts)) — fonctionnel mais **non modulaire** : ajouter un outil = modifier un `switch` de 150 lignes + un catalogue JSON + un handler Convex, 3 endroits.
- **Outils de lecture manquants** (données présentes en base, jamais exposées) :
  | Donnée | Table existante | Exposée à l'agent ? |
  |---|---|---|
  | Historique poids/mensurations | `bodyMetrics` | dernier poids seulement |
  | Tendances, comparaison de semaines | calculée côté `dashboard.ts` | non |
  | Bilans hebdo + retours coach | `checkins` | non |
  | Programme/plan alimentaire du coach | `mealPlans` | non |
  | Profil (prénom, taille, naissance) | `users` | non |
  | Vision 360 (agrégats) | `dashboard.ts` | non |
  | Recettes internes | `lib/data/recettes` (statique) | recherche simple, pas d'adaptation macros |
- **Outils d'écriture manquants** : modification d'entrée (quantité/repas), ajout multi-jours, action groupée (plusieurs écritures, une confirmation), liste de courses.

### A.7 Problème d'architecture

- L'orchestrateur est une **Convex action** qui réexécute `requireAssistantClient` dans chaque outil (bon point) mais : le switch `callTool` centralise tout, le prompt système est monolithique, et le contexte (historique) est reconstruit sans résumé ni injection de données.
- La séparation lecture/préparation/confirmation est **saine et à conserver** : `assistantActions` + `resolveAction` comme unique chemin d'écriture est exactement le bon socle pour la V2.
- Aucun streaming, pas de routage par tâche, pas de cache de lecture (quota/quota-coût ok mais latence 2–12 s).

### A.8 Problème d'interface

- **Markdown non rendu** (bug D confirmé) : bulles en `whitespace-pre-line` texte brut ([+page.svelte](../src/routes/espace/assistant/+page.svelte)).
- `pendingAction` géré en state local : survit au rechargement (relu du fil côté serveur ✔) mais **un seul à la fois**, pas d'historique d'actions ni d'undo visible après délai.
- Scroll conversationnel dans un conteneur `max-h-[52vh]` (ok desktop, à valider clavier iOS/PWA — non testable sans appareil).
- Pas de rendu des cartes riches (recette proposée, analyse multi-lignes) : tout est texte.
- Quotas visibles uniquement après réponse (`usage`), pas d'indicateur persistant.

---

## B. CARTOGRAPHIE TECHNIQUE

### B.1 Chaîne de conversation

| Élément | Fichier | Rôle | Réutilisable V2 |
|---|---|---|---|
| Flag, quotas, prompt, détresse, WhatsApp | [policy.ts](../src/lib/assistant/policy.ts) | source unique serveur | ✔ à réécrire par sections |
| Catalogue outils + boucle | [assistantAi.ts](../src/lib/server/assistantAi.ts) | Chat Completions, tool-calling borné | ✔ (ajouter streaming/vision) |
| Orchestrateur | [assistant.ts](../src/convex/assistant.ts) `send` | reserve → safety → outils → commit | ✔ (remplacer le switch par un registre) |
| Outils lecture/préparation | [assistantTools.ts](../src/convex/assistantTools.ts) | 12 outils, isolation userId | ✔ à étendre |
| BFF | [send/+server.ts](../src/routes/api/assistant/send/+server.ts), [action/+server.ts](../src/routes/api/assistant/action/+server.ts) | cookie, garde Billing, flag | ✔ |
| UI | [+page.svelte](../src/routes/espace/assistant/+page.svelte), [components/assistant/*](../src/lib/components/assistant) | chips, card, bulles, composer | ✔ (markdown, cartes, streaming) |

### B.2 Chemin d'écriture (socle à conserver tel quel)

`prepare*` (mutation outil) → `assistantActions {status:pending, payload, previousValue, expiresAt}` → clic cliente → BFF `action` → `resolveAction` (owner + statut + TTL) → `executeConfirmed` **réutilise les mutations métier existantes** (`meals.commitAnalyzedMeal` avec `requestId: assistant:<id>` anti-doublon, `journal.removeEntry`, `steps.setSteps`, `metrics.upsert`, insert `coachQuestions`) → `undoConfirmed` (journal, pas, mesures, question).

**Aucune écriture directe du modèle. Types interdits (objectifs, coachingMode, planning) absents de la liste fermée `assistantActionType`.** C'est la garantie de niveau 3 — elle est back-end, pas prompt.

### B.3 Données Convex accessibles pour la V2 (lecture seule ajoutable sans risque)

`clientGoals` + `clientGoalHistory` (objectifs historisés ✔ déjà utilisés), `diaryEntries`, `dailySteps`, `bodyMetrics`, `foodPortions`, `customFoods`, `foods` (OFF), Ciqual local, `checkins` (bilans + retours), `mealPlans`, `users` (profil), agrégats `dashboard.ts`.

### B.4 Permissions nécessaires

Toutes les nouvelles lectures : même garde `requireAssistantClient` (session + rôle client + flag + hard lock). Aucune nouvelle permission métier à créer ; les lectures sont mono-utilisateur par construction (index `by_user*`). Pour G-FLUX Pro (multi-coach), la clé est déjà `userId` — l'agent n'accède jamais par un id fourni par le modèle.

---

## C. PROPOSITION D'ARCHITECTURE V2

### C.1 Principe : extension de l'existant, pas refonte

SvelteKit → BFF → **Convex action orchestrateur** → **registre d'outils** → `resolveAction`. Le socle V1 (reserve/safety/commit/resolveAction) est conservé à 100 %.

### C.2 Registre d'outils modulaire (remplace le switch)

```
src/convex/assistantToolRegistry.ts
  type ToolDef = { name, schema JSON, kind: 'read' | 'prepare' | 'meta',
                   handler(ctx, sessionToken, threadId, topic, args) }
  READ_TOOLS / PREPARE_TOOLS — un fichier par domaine :
    toolsProfile.ts  toolsGoals.ts  toolsJournal.ts  toolsFoods.ts
    toolsRecipes.ts  toolsBody.ts    toolsBilans.ts   toolsCoach.ts
```
`send()` n'a plus qu'à : filtrer le registre par permissions, sérialiser les schémas vers OpenAI, dispatcher. Ajouter un outil = 1 fichier, 1 ligne dans le registre. **Les `prepare*` restent les seules portes d'écriture.**

### C.3 Contexte (mémoire en 3 couches)

1. **Injection serveur par tour** (coût nul, toujours à jour) : un bloc `<contexte>` compact recalculé avant l'appel — prénom, objectif kcal/macros du jour (historisé), kcal/macros restants, dernières pesée/mensurations + tendance courte, mode Coaching/Autonomie, 2 derniers bilans (titre + retour coach tronqué). Règle : « ces chiffres font foi ; re-vérifie par outil si > 5 min ».
2. **Historique fenêtré** (existant, 12 messages) : conservé.
3. **Résumé glissant** : au-delà de N messages, un résumé de ~300 tokens généré par le modèle économique et stocké sur le fil — pour les conversations longues sans exploser le coût.

### C.4 Trois niveaux d'autonomie — enforcement

| Niveau | Mécanisme |
|---|---|
| 1 — lecture/analyse | outils `read` librement appelés ; **aucun quota coach** |
| 2 — écritures cliente | uniquement `prepare*` → preview → `resolveAction` (existant) ; **nouveau :** multi-prepare (une action groupée = plusieurs payloads dans UNE `assistantActions`, confirmé/cancel/undo atomique) et `journal_update` (delta quantité/repas avec previousValue) |
| 3 — réservé coach | inchangé : la liste fermée `assistantActionType` refuse au niveau schéma Convex ; le prompt *oriente* vers « préparer une synthèse pour Hugo » (outil `prepareCoachQuestion` existe déjà) au lieu de *refuser* |

Le prompt cesse d'être un filtre négatif (« tu ne peux pas ») pour devenir un guide positif (analyse → conseil → préparation → escalade Hugo), la sécurité restant back-end.

### C.5 Sécurité Convex (priorité absolue)

- **Isolation** : toutes les lectures via `userId` de la session (`getSessionUser`), jamais un id passé par le modèle ou le client. Déjà le cas ; à conserver dans chaque nouvel outil.
- **Environnements** : dev local doit pointer `convex dev`/preview ; le seed et `set-preview-billing-env` ont des verrous anti-prod (`calm-jaguar-475`) — jamais de migration manuelle sur la prod, codegen seulement.
- **Prompt injection** : les noms d'aliments/retours de bilans/marques viennent de sources externes ou de la cliente → toute donnée est passée aux outils comme **arguments typés et bornés** (jamais concaténée dans des requêtes) ; le système prompt précise que le contenu des outils/photos est des *données*, pas des instructions ; les outputs d'outils sont JSON du serveur.
- **Actions** : TTL 30 min, statuts pending/confirmed/cancelled/undone, `requestId` anti-doublon, undo borné — déjà en place ; l'action groupée hérite du même cycle de vie.
- **Confidentialité** : `aiUsageLog` sans donnée perso (déjà) ; rétention `assistantMessages` à définir (proposition : purge 90 j, conversation supprimable par la cliente) ; images jamais persistées (dataURL transitoire, déjà le cas) ; RGPD : export/suppression du fil à prévoir dans un lot ultérieur.

### C.6 Multimodal

- **Étape 1 (frugal)** : brancher `analyzeMealImage` / `analyzeLabelImage` (déjà dans [openai.ts](../src/lib/server/openai.ts), vision validée, guards anti-placeholder) comme **outils** `inspectPhoto` appelables par l'agent dans la boucle — le modèle reçoit la description structurée, pas l'image.
- **Étape 2 (vision native)** : passer la boucle à l'API Chat/Responses multimodale (`input_image`) avec un modèle vision — nécessaire pour frigo/assiette en libre. Toute estimation photo reste marquée « ≈ Estimation » et éditable avant enregistrement (la carte `ActionPreviewCard` le permet déjà).

### C.7 Coûts (ordres de grandeur, gpt-4o-mini)

- Tour simple : ~2 500 tokens in / 300 out → **≈ 0,0006 $**. Tour avec 4 rounds d'outils : ~6 000 in / 600 out → **≈ 0,0013 $**. Photo analysée via pipeline existant : +0,001–0,003 $.
- À 50 msg/j/client (quota actuel) : pire cas ~0,065 $/j/client — soutenable, mais le quota réel sera bien plus bas.
- Stratégie recommandée : **B (modèle économique + outils enrichis) en V2.0**, avec garde-fou pour passer `ASSISTANT_MODEL` à `gpt-4o`/`gpt-4.1` par env si la qualité du raisonnement le justifie (aucun code à changer — la variable existe). Le routage hybride (C) n'est justifié qu'après mesure : complexité + latence de classification non amorties tant que les outils font le travail déterministe.

### C.8 Compatibilité G-FLUX Pro

- Multi-coach/multi-org : l'agent lit/écrit par `userId` ; à l'ouverture Pro, ajouter la vérification d'appartenance org dans `requireAssistantClient` (un point unique).
- Modèle/quotas par organisation : les variables d'env deviennent des champs de config org (le registre lit la config, pas `process.env`).

---

## D. ROADMAP PRIORISÉE (lots indépendants, chacun = 1 branche + PR + Deploy Preview)

**Ordre justifié par les dépendances** : rien n'est possible sans instructions saines (les refus A/B) ni contexte ; les analyses avancées dépendent des nouveaux outils de lecture ; les écritures avancées dépendent du registre ; le multimodal peut arriver en parallèle car la pipeline existe.

### Lot 1 — Prompt & intelligence conversationnelle *(rapide, ~1-2 j)*
- **Objectif** : éliminer les refus injustifiés ; réécrire `assistantSystemPrompt()` : identité, règle « décision de coaching » restreinte aux objectifs/stratégie stricts, règle positive « appelle getToday avant toute question chiffrée », interdits inchangés, capacités image décrites.
- **Fichiers** : [policy.ts](../src/lib/assistant/policy.ts) (+ tests).
- **Convex** : aucun.
- **Risques** : relâcher trop le frein → garde-fous back-end inchangés.
- **Tests** : 10 scénarios prompts (dont les 6 cas de la mission §8), tests anti-régression détresse.
- **Acceptation** : « Analyse ma journée » et « comment atteindre mes protéines » → analyse, pas de renvoi Hugo ; « dois-je diminuer mes calories ? » → analyse + proposition de synthèse pour Hugo.
- **Complexité** : ●○○ (F)

### Lot 1b — Markdown UI *(rapide, < 1 j, même branche)*
- Rendu markdown borné dans les bulles (gras, listes, sauts de ligne — pas de HTML) ou consigne « texte brut » + strip serveur. **Fixe le bug D.**

### Lot 2 — Contexte injecté + registre d'outils *(structurel, ~2-3 j)*
- **Objectif** : registre d'outils modulaire + bloc `<contexte>` serveur (profil, objectifs du jour, restes, dernières mesures, dernier bilan) + injection du thread.
- **Fichiers** : nouveau `src/convex/assistantTools/*`, [assistant.ts](../src/convex/assistant.ts) (send allégé), [policy.ts](../src/lib/assistant/policy.ts).
- **Convex** : nouvelle query de contexte (lecture seule).
- **Risques** : régression sur l'existant → tests de non-régression + E2E V1 rerun.
- **Acceptation** : « Et en protéines ? » fonctionne avec mémoire ; réponses contextualisées sans appel d'outil redondant.
- **Complexité** : ●●○ (M)

### Lot 3 — Analyse nutritionnelle avancée *(~3-4 j)*
- **Outils** : `analyzeDay` (bilan complet multi-sources), `suggestFoodsForMacros` (moteur déterministe : recherche Ciqual/OFF/recettes par macros restantes, portions calculées), `adaptRecipeToMacros`, `buildShoppingList` (prepare, texte).
- **Convex** : lectures nouvelles, aucune écriture métier.
- **Acceptation** : « propose-moi un dîner avec 40 g de protéines » → combinaison concrète chiffrée depuis la base, jamais inventée.
- **Complexité** : ●●● (M-H, cœur de valeur)

### Lot 4 — Écritures avancées & multi-actions *(~3 j)*
- **Fonctions** : `journal_update` (delta quantité/repas avec `previousValue`), ajout multi-jours, **action groupée** (une preview, une confirmation, undo atomique).
- **Convex** : extension `assistantActions` (payload multi) — **additif** ; undo étendu.
- **Risques** : annulation partielle → transaction par action groupée + tests concurrents.
- **Complexité** : ●●○ (M)

### Lot 5 — Analyse corporelle & progression *(~2 j)*
- **Outils** : `getBodyHistory` (poids/mensurations complet), `analyzeWeightTrend` (régression/pente, comparaison S/S-1, prise en compte du journal pour expliquer une variation — sans jamais conclure médicalement).
- **Acceptation** : « pourquoi mon poids augmente alors que je respecte mes calories ? » → réponse factuelle (moyennes, eau/sel/hormonal en vigilance générale, orientation coach pour stratégie).
- **Complexité** : ●●○ (M)

### Lot 6 — Multimodal *(~2-3 j)*
- Étape frugale : `inspectPhoto` comme outil (réutilise `analyzeMealImage`/`analyzeLabelImage`) ; étape native vision si besoin. Photo frigo → liste d'ingrédients → recette → preview journal.
- **Complexité** : ●●○ (M)

### Lot 7 — Mémoire & optimisation *(~2 j)*
- Résumé glissant, streaming SSE (avec les contraintes Convex actions), cache de lecture court, purge/rétention, indicateur de quota UI.
- **Complexité** : ●●○ (M)

### Lot 8 — Stabilisation & tests adverses *(~2 j, avant toute mise en prod)*
- Tests où le modèle tente des écritures interdites (objectifs, autre compte, action expirée, double confirm concurrent, injection via nom d'aliment/retour de bilan), refus inter-comptes, PWA iOS/Android/Desktop.
- **Complexité** : ●●○ (M)

---

## E. RECOMMANDATION FINALE

**Architecture recommandée : extension de la V1 (SvelteKit BFF → Convex action orchestrateur → registre d'outils → resolveAction), modèle économique unique, sécurité et intelligence déplacées du prompt vers le backend et le contexte.**

- **Corrections rapides (Lot 1 + 1b, ~2 jours)** : réécrire le prompt (refus injustifiés, capacités image, chiffres), rendre le markdown — c'est là que se trouve l'essentiel de la perception « chatbot bête » actuelle, et c'est 95 % prompt, 5 % code.
- **Évolutions intermédiaires (Lots 2-6)** : contexte injecté + registre, analyse nutritionnelle avancée, écritures groupées, corps, multimodal frugal. La valeur produit (« véritable agent ») vient des **outils déterministes enrichis**, pas d'un modèle plus gros.
- **Transformations structurelles (Lots 7-8, puis phase 3)** : mémoire longue, streaming, multi-actions robustes, conformité RGPD, préparation Pro.

**À ne PAS faire** : changer de modèle maintenant, introduire un framework d'agents (LangChain etc.), donner au modèle un accès générique à Convex, ou un routage multi-modèles avant mesure.

**STOP ici.** Aucune implémentation sans validation explicite du périmètre (les 8 lots, ou un sous-ensemble — le Lot 1+1b peut être livré seul très vite).
