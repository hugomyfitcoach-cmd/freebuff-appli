# AUDIT — Module « Dépense sportive » (pré-implémentation)

Mission : Dépense sportive + intégration Accueil + connexion Entraînement.
Statut : AUDIT SEUL — aucune modification métier écrite. En attente de validation.

---

## 1. Base de départ

- `main` local = `b07795f` (« Harnais E2E Entraînement finalisés — 23/23 API + 8/8 UI verts »).
- Worktree mission : `.freebuff/worktrees/b2cfbbb4-…`, branche `freebuff/nouvelle-mission-module-d-pense-sportive-…`,
  alignée sur `b07795f` par fast-forward (l'ancien point de départ 4098720 était un ancêtre direct, zéro commit perdu).
- Environnement bootstrapé : `npm ci` + `.env.local` copié depuis le dossier principal (non committé).
- Convex : **aucun push, aucun déploiement** — rien n'a été touché.

## 2–7. État réel du module Entraînement

**Tables Convex** (schéma actuel = déployé) :
- `trainingAssignments` — {coachId, userId, programId (COPIE indépendante), sourceProgramId, startDate, endDate, weekdays[1..7], removedAt, createdAt}. Retrait ≠ suppression : l'historique reste.
- `trainingScheduledSessions` — {userId, assignmentId, sessionId, date "yyyy-mm-dd", status: `planned|completed|cancelled`, completedAt (ms), durationMin (optionnel), difficulty 1–5, note, createdAt}. Index : by_user_date, by_user, by_assignment, by_session. Annulée = masquée, jamais détruite.
- `trainingSetLogs` — historique autonome en snapshot (exerciseName, médias, prescription…), clé d'idempotence (occurrence, exercice, n° série). JAMAIS réécrit par un changement de programme.
- `trainingPrograms` / `trainingSessions` / `trainingSessionExercises` / `trainingSets` — modèle de programmes + prescription.

**Mécanisme « Terminer la séance »** (audit points 5, 21) :
1. `SessionRunner.svelte` — bouton « Terminer la séance » → confirm si partiel → récap LOCAL (durée, exercices, séries, volume, progression) → difficulté + note facultatives → « Enregistrer et fermer ».
2. POST unique `POST /api/training/session/[id]` (BFF, rôle client) → mutation `trainingClient.completeSession`.
3. `completeSession` : patch {status: "completed", completedAt: Date.now(), durationMin (clamp 0–600), difficulty, note}. **Idempotent** : déjà completed → return ok immédiat.
4. Verrouillage : une fois completed, `logSet`, `moveMySession`, `deleteMySession` refusent — historique intouchable.

**Champs début/fin/durée existants** (audit point 6) :
- `completedAt` (ms) : persisté. `durationMin` : persisté (optionnel).
- **`startedAt` N'EXISTE PAS** : la durée est calculée côté frontend (`Date.now() - startedAt` local, min 1 min) — perdue si l'app se ferme (verrou iPhone, PWA en arrière-plan). C'est le principal manque.
- Durée estimée théorique affichée (« ≈ X min ») — jamais persistée.

**Consultation vs réalisation** (audit points 23, 25) : aujourd'hui, ouvrir la séance ne crée rien en base ; seule l'écriture de séries (`logSet`) écrit. Mais il n'existe **aucune distinction persistée** entre « consultée » et « commencée réellement » — logSet est le premier geste d'exécution, c'est l'ancre la plus fiable disponible.

**Mode libre / guidé** : même écriture (`logSet`), même fin (`completeSession`). Le guidé gère timers repos/durée côté client uniquement.

## 8. Notifications

Moteur existant : `coachNotifications` (CRM, dedupKey transactionnelle), `clientEvents` + poller 5 s (`/api/live`), push web-push VAPID. **Rien à créer** — le module Dépense sportive n'a pas de notification en V1 ; la confirmation de durée est une interaction contextuelle, pas une notification.

## 9. Pas

`dailySteps` {userId, date, count, manualCount (legacy)} — saisie manuelle quotidienne, index by_user_date. Objectif : `clientGoals.stepGoal`. La marche quotidienne vit uniquement ici — **aucune activité type marche dans le catalogue Dépense sportive** (voir §14–16).

## 10. Poids

`bodyMetrics` {userId, date, weightKg?, …} — une ligne par prise, tri par DATE de mesure (jamais par création). Le dernier poids pertinent = dernière ligne avec `weightKg` défini. Sans pesée → `null` (aucun poids inventé). Utilisé dans `dashboard.getDashboard` (progression.lastWeightKg) et `coach.client360`.

## 11. Coefficients sportifs existants

- **Aucun MET / coeff sportif dans le code** (recherche MET, kcal/kg, coefficient : néant hors nutrition).
- **Le tableau G-FLUX fourni (image)** en kcal/kg/heure :
  | Activité | kcal/kg/h |
  |---|---|
  | Musculation récréative | 2,2 |
  | Musculation intensive | 4,4 |
  | Cardio basse intensité (<130 BPM) | 3,3–4,3 |
  | Cardio moyenne (130–150 BPM) | 4,4–6,6 |
  | Cardio haute (160–180 BPM) | 6,6–8,8 |
- Conversion documentée : kcal/kg/h ≈ MET × 1,05 (1 MET ≈ 3,5 ml O₂/kg/min ≈ 1,05 kcal/kg/h). MET = kcal/kg/h ÷ 1,05.
- Complément des activités absentes : Compendium of Physical Activities (Ainsworth 2011/2024), valeurs MET standard (course 8–9,8 ; vélo 4–10 ; elliptique 5 ; rameur 4–8,5 ; natation 5,8–9,8 ; aquagym 4,0 ; pilates 2,5–4,5 ; yoga 2,5–4 ; HIIT 6–8 ; escalier 4–9 ; tennis 5–8 ; padel ≈ 5,5–7 ; badminton 4,5–5,5 ; football 7–10 ; basket 6–8 ; ski 4,5–8 ; danse 3–7…). Chaque entrée porte `coefficientSource` + `coefficientVersion`.

## 12. Modèle de données proposé (audit point 12, 30)

Table **`sportActivities`** (nom interne ; libellé produit = « Dépense sportive ») — 100 % additive :

| Champ | Type | Notes |
|---|---|---|
| userId | id(users) | |
| date | string "yyyy-mm-dd" | heure locale cliente (comme dailySteps) |
| activityId | string | slug du catalogue ("musculation", "padel"…) |
| activityNameSnapshot | string | survit aux renommages du catalogue |
| durationMinutes | number | clamp 1–600 |
| intensity | string optionnel | "legere" \| "moderee" \| "intense" — absent si activité sans intensité |
| metValue | number | snapshot MET utilisé |
| coefficientSource | string | "gflux_table" \| "compendium" |
| coefficientVersion | string | version du catalogue (ex "1") |
| weightSnapshot | number optionnel | kg au moment du save — jamais recalculé a posteriori |
| estimatedCalories | number optionnel | MET × poids × durée/60 — absent si pas de poids |
| metMinutes | number | MET × minutes — suit le volume indépendamment du poids |
| source | string | "manual" \| "gflux_training" |
| trainingSessionId | id(trainingScheduledSessions) optionnel | lien stable (idempotence) |
| durationSource | string optionnel | "tracked" \| "manual" (source gflux_training) |
| createdAt / updatedAt | number | |

Index : `by_user_date` [userId, date] (semaines), `by_user` [userId], `by_trainingSession` [trainingSessionId] (**idempotence : une séance = au plus une dépense**).

Conventions respectées : dates ISO locales cliente, sessionToken optionnel, requireClient, ConvexError FR, snapshots partout.

## 13. Catalogue initial (audit points 13, 14, 15, 16)

Centralisé dans UN module (`src/convex/sportCatalog.ts` — données + calcul), servi au frontend via une query (aucune dispersion). Versionné.

**Inclus (V1)** — catégories : Musculation (Musculation — intensités), Cardio salle (Course tapis, Vélo, Vélo indoor/spinning, Elliptique, Rameur, StairMaster/escalier, **Marche inclinée sur tapis**), Natation & eau (Natation, Aquagym), Cours collectifs & douceurs (Pilates, Yoga, Danse), HIIT & circuits (HIIT, Circuit training, Cross training), Sports raquette (Tennis, Padel, Badminton), Sports collectifs (Football, Basket), Glisse/hiver (Ski), + `autres activités réellement sportives` (Corde à sauter…).

**Exclus** (double comptage avec les pas / non sportifs) : Marche, Marche rapide, Promenade, Balade, déplacements quotidiens.

**Recherche « marche »** → message pédagogique : « La marche quotidienne est déjà prise en compte dans ton suivi. Tes pas et déplacements habituels ne doivent pas être ajoutés ici. » + seule suggestion : « Marche inclinée sur tapis ».

**Randonnée (audit point 17) — proposition à valider : EXCLUE du catalogue V1** (approche conservatrice anti double comptage : beaucoup de pas + déjà couverte par le niveau de marche du calibrage). Si tu la veux : entrée dédiée avec encart pédagogique « déjà partiellement couverte par tes pas » et MET bas (4,0 « Légère »), ou à créer plus tard.

## 18. Calcul

- kcal = MET × weightSnapshot × (durationMinutes / 60), arrondi (affichage toujours `≈ X kcal estimées`).
- metMinutes = MET × durationMinutes (toujours stocké, même sans poids).
- weightSnapshot = dernier poids connu (bodyMetrics, tri par date) AU MOMENT du save — historique gelé. Sans poids → estimatedCalories absent, metMinutes conservé.
- kcal sportives **jamais** ajoutées aux calories alimentaires (aucune écriture diaryEntries/clientGoals/mealPlans — sécurité métier testée).

## 20–29. Connexion Entraînement → Dépense sportive

**Adaptations minimales de `trainingScheduledSessions`** (additives, aucune rupture) :
- `startedAt: optional(number)` — horodatage persisté du DÉBUT RÉEL.
- `durationSource: optional("tracked" | "manual")`.
- `skippedAt: optional(number)` — « Je n'ai pas réalisé cette séance » : séance terminée SANS dépense (consultée/séries cochées mais non réalisée).

**Démarrage réel ≠ consultation (points 22, 23)** — proposition : `startedAt` posé par la **première écriture de série** (`logSet`), PAS à l'ouverture de la page. Regarder les exercices/médias, renseigner une charge sans valider → rien. Dès la 1ʳᵉ série validée (libre OU guidé) → startedAt persisté backend (survit au verrouillage iPhone / PWA en fond). Aucun chrono JavaScript ne porte la durée : la durée finale = completedAt − startedAt (persistés), corrigible manuellement.
Alternative (plus explicite, +1 tap) : bouton « Commencer la séance ». Je recommande la version sans friction.

**Durée réelle (point 22)** : `actualDurationMin = round((completedAt − startedAt)/60)` si startedAt présent ; sinon (séance réalisée hors app, durée inconnue) → récap propose 45/60/… → `durationSource = "manual"`.

**Confirmation de durée (points 26)** — seuils proposés à valider : **< 10 min ou > 150 min** après « Terminer la séance » → panneau léger DANS le flux existant (pas une notification, jamais bloquant, fermable, aucune perte de données) : « G-FLUX a détecté X min » + [45 min] [60 min] [Modifier la durée] [Je n'ai pas réalisé cette séance]. Durée cohérente → aucune friction ajoutée (le récap existant suffit).

**Séance non finalisée (point 27)** : startedAt présent + status planned + date passée → état dérivé « Séance à finaliser » : badge discret page Entraînement + ligne discrète carte Accueil. Reprendre / terminer / corriger la durée / « pas réalisée ». Aucun popup global, aucun état bloquant.

**Création de la dépense (points 21, 29)** : dans/à côté de `completeSession` (même transaction de patch) : si !skipped → upsert `sportActivities` par index by_trainingSession :
- idempotent (re-validation, double appel → 1 seule ligne),
- correction de durée → mise à jour de la ligne existante (kcal + metMinutes recalculés),
- activité « Musculation » (MET modéré du tableau coach, intensité modérée — à valider), name snapshot = nom de la séance, source "gflux_training", durationSource "tracked"/"manual",
- retrait/remplacement de programme → dépenses conservées (lignes autonomes, snapshots).

## Accueil cliente (points 8–10, 27–30)

**Position** : directement sous la carte Performance (pleine largeur), ajoute une grille **identique** à celle des cartes Pas/Calories :
`<div class="mt-4 grid grid-cols-2 gap-3">` — deux cartes moitié, mêmes rayons (rounded-3xl), mêmes paddings (p-4), mêmes styles d'entête (label uppercase + icône + chevron), mêmes hauteurs visuelles (structure entête / valeur / sous-ligne). Jamais deux cartes pleine largeur.

**Carte DÉPENSE SPORTIVE** (href `/espace/depense-sportive`) :
- Entête : icône `zap` + label « Dépense sportive ».
- Avec données : valeur `≈ 860 kcal` (font-display 2xl–3xl, comme Pas/Calories) ; sous-ligne « 3 activités · 2 h 35 ».
- Semaine vide : valeur compacte « Aucune activité » / sous-ligne « cette semaine » (+ discret « + Ajouter » en sous-ligne, jamais un gros CTA).
- Chargement : état neutre (—) tant que la donnée n'est pas là, rien d'inventé.

**Carte ENTRAÎNEMENT** (href `/espace/entrainement`) :
- Entête : icône `dumbbell` + label « Entraînement ».
- Séance aujourd'hui : « Séance aujourd'hui » + nom (« Bas du corps »).
- Prochaine séance : « Prochaine séance » + jour (« Jeudi ») (+ nom si ça tient).
- Séance à finaliser (nouveau, discret) : « À finaliser » + nom.
- Aucun programme : « Aucun programme prévu » — état neutre, pas d'alerte, pas de gros CTA. Explication longue uniquement après ouverture de la page.
- Données : réutilise l'endpoint existant `/api/training` (myWeek) en fetch async non bloquant — même pattern que la carte Performance (perfWeek). **Aucun système parallèle** ; la carte reste visible pour toutes.

**Ordre global Accueil** : Aujourd'hui (Pas|Calories|Poids|Cycle) → Ma progression → Performance → [Dépense sportive | Entraînement] → Récap hebdo → footer. Aucun changement involontaire aux autres cartes.

## Page « Dépense sportive » (points 11, 18, 19)

`/espace/depense-sportive` (cliente) :
- Semaine courante par défaut, navigation `‹ Semaine du 14 au 20 septembre ›` (précédentes OK, future non).
- Résumé : N activités · total durée · ≈ X kcal estimées (+ équivalent MET-min pour info coach côté CRM).
- Liste par jour : activité (nom snapshot), durée, ≈ kcal, pastille source (manuelle / séance G-FLUX).
- Ajout : bottom sheet rapide — Sports récents (activité, persisté) → recherche → catégories → catalogue complet ; durée [30][45][60][libre] ; date = aujourd'hui par défaut, modifiable ; intensité (Légère/Modérée/Intense) quand pertinent ; jamais le mot « MET » côté cliente.
- Tap activité → Modifier (sport/date/durée/intensité ; weightSnapshot conservé, recalcul kcal + metMinutes) / Dupliquer (pré-remplit, date libre) / Supprimer (confirmation légère). Tout recalcul est immédiat.

## Vision 360 (points 31, 32)

- Carte compacte dans la grille cockpit (style des cartes Poids/Calories/Pas) : « Dépense sportive — 3 activités · 2 h 35 — ≈ 860 kcal » + badge tendance (`Volume stable` / `↑ Volume sportif` / `↓ Volume sportif`).
- Lecture rapide des dernières semaines dans l'onglet dédié/détail : S, S-1, S-2, S-3 (min · kcal) + distinction saisie manuelle / séance G-FLUX. Extension additive de `client360` (ou query dédiée) — la Vision reste sobre.

**Tendance (point 32)** — proposition à valider : comparaison sur **semaines closes** (jamais la semaine en cours partielle) : S-1 vs S-2 sur les MET-minutes ; hausse/baisse si écart ≥ ±25 % (sinon stable). La semaine en cours est affichée seule, jamais comparée à une semaine complète. Pas de pourcentage affiché — libellé qualitatif uniquement.

## Fichiers / routes concernés (points 33)

**Convex (additifs)** : `schema.ts` (+ table sportActivities, + champs trainingScheduledSessions.startedAt/durationSource/skippedAt) · `sportCatalog.ts` (NOUVEAU — catalogue + calcul) · `sport.ts` (NOUVEAU — CRUD cliente : save/delete/duplicate + week query + myRecentActivities) · `trainingClient.ts` (startedAt à la 1ʳᵉ série ; completeSession : skipped + upsert dépense idempotent) · `coach.ts` (client360 : bloc dépense sportive ; removeClient : purge sportActivities).

**BFF SvelteKit** : `src/routes/api/sport/+server.ts` (NOUVEAU, GET/POST/DELETE client) · `/espace/depense-sportive/+page.server.ts` + `+page.svelte` (NOUVEAU) · `/espace/+page.svelte` (deux cartes sous Performance) · `SessionRunner.svelte` (panneau confirmation durée, « Je n'ai pas réalisé cette séance ») · `/espace/entrainement/+page.svelte` (badge « à finaliser ») · `admin/+page.svelte` ou TrainingPanel (carte Vision 360).

**Migrations Convex (point 34)** : aucune migration de données — table nouvelle + champs optionnels additifs. Aucune table/index/fonction existante supprimée ; Notifications + Entraînement intacts (diff schema audité avant tout push ; **déploiement uniquement après ton accord explicite**).

## Risques de régression (point 35)

1. Accueil : layout des cartes existantes (toucher uniquement l'insertion sous Performance) — testé par E2E UI.
2. SessionRunner : le flux de fin évolue (confirmation durée) — attention à ne pas casser le récap existant ; E2E Entraînement existant (23 API + 8 UI) doit rester vert.
3. `completeSession` : nouvelles branches (skipped, dépense) — l'erreur de calcul de dépense ne doit JAMAIS bloquer la complétion (try/catch interne / écriture défensive).
4. Cascade removeClient : ajouter la purge sportActivities (cohérence E2E jetables).
5. dashboard/client360 : extensions en lecture pure.

## Plan de tests (points 36, 40, 41)

- **Harnais existant réutilisé** : `scripts/e2e-training.mjs` (compte e2e jetable auto-supprimé) étendu : séance terminée → 1 dépense (source gflux_training), idempotence, correction durée, skipped → 0 dépense, séance non terminée → 0 dépense, retrait programme → historique conservé.
- **NOUVEAU** `scripts/e2e-sport.mjs` : CRUD manuel complet, semaines, marche (refus catalogue), cliente sans poids, weightSnapshot, idempotence, cascade suppression, sécurité métier (aucune écriture diaryEntries/clientGoals).
- **E2E UI** (extension `e2e-training-ui.mjs` ou nouveau) : cartes côte à côte sous Performance, états des deux cartes, mobile/desktop/petite largeur, clics corrects, Pas/Calories/Progression/Performance inchangés.
- `npm run check` + `npm run build` verts. Convex : aucune donnée réelle touchée (comptes e2e auto-supprimés).
- **Sécurité métier testée explicitement (point 40)** : aucune dépense n'écrit jamais dans diaryEntries / clientGoals / mealPlans / plannedEntries — aucun crédit calorique, aucun ajustement auto.

## Décisions à valider (résumé)

1. **Randonnée exclue** du catalogue V1 (anti double comptage conservateur) — OK ?
2. **startedAt posé à la première série validée** (zéro friction) plutôt qu'un bouton « Commencer » — OK ?
3. **Seuils confirmation durée : < 10 min / > 150 min** — OK ?
4. **« Je n'ai pas réalisé cette séance »** = séance terminée sans dépense (champ skippedAt) — OK ?
5. **Tendance = semaines closes, MET-min, seuil ±25 %** — OK ?
6. **Musculation (séance G-FLUX) = MET 3,0 modéré** du tableau coach — OK ?
7. Nom de table Convex **`sportActivities`** + route **`/espace/depense-sportive`** — OK ?
