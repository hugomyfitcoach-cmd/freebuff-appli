# Module Entraînement — socle + bibliothèque d'exercices (Mission 1)

Socle backend/data du futur module Entraînement : bibliothèque interne G-FLUX
d'exercices, import de la banque gratuite ExerciseDB, et un outil de validation.
Ni le CRM Coach final, ni l'expérience cliente ne sont construits à ce stade.

## Mission 2 — CRM Coach V1 (programmes, éditeur, prescription)

Section CRM `/admin/entrainement` à 3 sous-onglets : **Programmes** (liste,
recherche, filtres objectif/niveau/fréquence, tri, création modale avec image,
dupliquer, supprimer), **Éditeur** (3 colonnes) et **Bibliothèque** (composant
réutilisable `ExerciseLibraryBrowser`).

Tables additives (module `src/convex/training.ts`) :
`trainingPrograms` → `trainingSessions` → `trainingSessionExercises`
(→ `exercises` de la bibliothèque, jamais une source externe) → `trainingSets`.
La prescription (mode reps/temps, tempo, notes coach/technique, séries avec
repsMin/repsMax, charge kg libre, RIR 0–5, repos s, durée s) vit ENTièrement
dans les tables training — remplacer la banque d'exercices ne touche aucun
programme existant.

- Éditeur : colonne gauche = séances (ajout, renommage, duplication,
  suppression, drag & drop) ; centre = exercices de la séance (DnD, aperçu
  compact « 3 × 8–12 · 70 kg · RIR 2 · 120 s », duplication, retrait) ;
  droite = prescription (séries, mode, tempo, notes). Le picker ouvre la
  bibliothèque avec recherche + filtres et ajout en un clic.
- Autosave debouncé (600 ms) pour les champs texte/séries ; actions
  structurelles écrites immédiatement puis rechargement silencieux du
  programme. Indicateur discret « Enregistrement… / Enregistré ».
- Endpoints BFF : `/api/coach/training/programs[/id]`, `/sessions[/id]`,
  `/session-exercises[/id]`, `/sets[/id]` — tout authentifié coach,
  propriété vérifiée par remontée program→session→exercice→série.
- Limites : 20 séances/programme, 30 exercices/séance, 12 séries/exercice.
- Pas encore construit (missions suivantes) : assignation clientes, suivi de
  séance, historique de performance, circuits/supersets, timers.

## Principe d'architecture : le modèle est G-FLUX, pas la source

La banque ExerciseDB est une **source externe jetable**. Rien dans le schéma,
les fonctions Convex ou le frontend ne dépend de sa structure ni de ses ids :

- les exercices sont identifiés par `gfluxExerciseId` (`ex_` + hash déterministe
  de `source:sourceExerciseId`) — stable, portatif, référencé par les futurs
  programmes/séances ;
- l'import reconnait les exercices déjà présents par le couple
  `(source, sourceExerciseId)` (index `by_source_id`) → un ré-import **met à
  jour** au lieu de dupliquer, et **ne supprime jamais** les exercices G-FLUX ;
- la normalisation vers le vocabulaire G-FLUX (muscles, équipements, parties
  du corps, catégories — en français) vit **uniquement** dans le convertisseur
  du script d'import. Remplacer la source gratuite par un dataset commercial
  demain = réécrire ce convertisseur, rien d'autre ;
- le frontend lit uniquement les champs du modèle (`mediaUrl`,
  `thumbnailUrl`, `sourceLabel`…) — aucune URL source codée en dur.

Deux familles coexistent : `system: true` (bibliothèque système importée) et
`system: false` (exercices créés par la coach, `source: "gflux"`, jamais
touchés par un import). Les champs édités par la coach (`name`, `hidden`)
sont préservés par les imports.

## Source retenue (prototypage)

**`exercisedb-v1`** — ExerciseDB **V1 Free API** (https://oss.exercisedb.dev/docs) :
**1 500 exercices avec GIFs** (servis par static.exercisedb.dev), sans clé API.
Pagination par curseur (`limit=25&after=<nextCursor>`), rate-limit ~10 req/rafale
(le script espace les pages de 1,2 s et reprend avec backoff exponentiel sur 429).

Historique : la première itération de la Mission 1 utilisait `free-exercise-db`
(yuhonas, 876 exercices à images statiques). Ces lignes de test ont été
**supprimées définitivement** (mission « nettoyage », via `exercises:purgeSource`,
audit de références au préalable : 0 exercice coach, cascade limitée aux lignes
programmes qui les citaient — 1 programme de test supprimé).

Le remplacement commercial prévu reste EDB Exercise Intelligence (exercisedb.io)
: le modèle accepte une nouvelle `source` sans migration — seul le convertisseur
du script change.

## Hébergement interne des médias (GIFs G-FLUX)

La bibliothèque ne dépend plus de `static.exercisedb.dev` : les GIFs sont
téléchargés puis stockés dans le **file storage Convex** (jamais de binaire
dans la table `exercises`), et `mediaUrl` pointe vers l'URL interne résolue.

- `sourceMediaUrl` : URL ExerciseDB d'origine (figée au premier hébergement,
  traçabilité / re-téléchargement) ;
- `mediaStorageId` : fichier dans le storage Convex (source de vérité du
  binaire) ; `mediaUrl` = son URL publique résolue (CDN G-FLUX plus tard) ;
- `mediaSizeBytes` : taille du média hébergé.

```bash
node scripts/host-exercise-media.mjs --audit   # sondage des URLs source seul
node scripts/host-exercise-media.mjs           # audit + hébergement complet
```

Le script est **progressif, reprenable et idempotent** : cache local
`.media-cache/` (GIFs + état JSON), skip des médias déjà hébergés (même
taille), concurrence 3 (réglable `--jobs`), retry/backoff sur 429 / timeout /
5xx, journal succès/erreurs. `mediaUrl` n'est mise à jour qu'APRÈS un stockage
réussi (`attachMediaBatch`) ; un média valide n'est jamais écrasé par un échec.

Audit exécuté (09/2026) : **1 324/1 500 GIFs valides** côté source (200),
**176 en 404 côté source** (l'API fournit un `gifUrl` dont le fichier n'existe
plus sur leur CDN — rien à corriger de notre côté). Volume total hébergé :
≈ 123 Mo. Les 176 exercices sans média affichent un **fallback propre**
(composant `ExerciseMedia` : essai `mediaUrl` → `sourceMediaUrl` → état
« Média indisponible », jamais d'icône d'image cassée).

## Import

```bash
node scripts/import-exercises.mjs [--dry-run] [--hide-old-source]
# ou : npm run import:exercises
```

- authentifié par session coach (COACH_EMAIL / COACH_PASSWORD dans `.env.local`) ;
- télécharge les 1 500 exercices via l'API V1 (paginé par curseur, ~75 s,
  throttled), convertit vers le vocabulaire G-FLUX, pousse par lots de 100 via
  la mutation Convex `exercises:importBatch` ;
- idempotent (anti-doublon par `source + sourceExerciseId`), relançable sans
  risque ; résumé final : importés / mis à jour / inchangés / ignorés / erreurs ;
- `--hide-old-source` : masque (réversible) les exercices des anciennes sources
  de prototype (jamais les exercices coach `gflux`) ;
- les URLs de la source sont enregistrées (`sourceMediaUrl`) ; l'hébergement
  interne des GIFs est fait par `scripts/host-exercise-media.mjs` (voir
  section dédiée) — `mediaUrl` pointe alors vers notre storage Convex.

### Mapping ExerciseDB V1 → G-FLUX (convertisseur du script)

| Source (EN) | G-FLUX |
|---|---|
| `exerciseId` | `sourceExerciseId` (+ `gfluxExerciseId` déterministe) |
| `name` | `name` + `sourceName` |
| `targetMuscles[0]` (50 valeurs) | `muscleGroup` (18 groupes FR existants + Obliques, Cardio, Chevilles…) |
| `secondaryMuscles[]` | `secondaryMuscles[]` (dédupliqué, ≠ principal) |
| `bodyParts[0]` (10 valeurs) | `bodyPart` (Haut du corps / Tronc / Bas du corps / Cardio) |
| `equipments[0]` (28 valeurs) | `equipment` (Haltères, Machine Smith, Bosu, SkiErg…) |
| `instructions[]` (« Step:N … ») | `instructions[]` (préfixe retiré) |
| `gifUrl` | `mediaUrl` + `thumbnailUrl` (GIF animé) |

## Schéma (table Convex `exercises`, purement additive)

`gfluxExerciseId`, `name` (G-FLUX, éditable), `sourceName` (nom original),
`muscleGroup`, `secondaryMuscles[]`, `bodyPart`, `equipment`, `category`,
`instructions[]`, `mediaUrl` (interne une fois hébergé), `sourceMediaUrl`
(URL d'origine), `mediaStorageId` (storage Convex), `mediaSizeBytes`,
`thumbnailUrl`, `mediaUrls[]`, `source`,
`sourceExerciseId`, `licenseNote`, `active`, `hidden` (masquage coach),
`system` (bibliothèque vs coach), `coachId`, `importBatch`, `createdAt`,
`updatedAt`. Index : `by_source_id`, `by_gfluxId`, `by_muscleGroup`,
`by_equipment`, `by_name` + searchIndex `name_search`.

## Accès aux données (architecture inchangée)

Navigateur → BFF SvelteKit (session cookie) → Convex. Aucun appel direct
navigateur → Convex. Toutes les lectures/écritures `exercises` sont réservées
au rôle coach, vérifiées dans chaque fonction Convex via le jeton de session.

- Endpoints BFF : `GET /api/coach/exercises` (recherche + filtres +
  pagination), `GET /api/coach/exercises/stats` (total + facettes),
  `GET|PATCH|POST /api/coach/exercises/[id]` (fiche / masquage / création
  personnalisée) ;
- Fonctions Convex : `src/convex/exercises.ts` (`libraryStats`,
  `searchExercises`, `exerciseById`, `createCustomExercise`, `setHidden`,
  `importBatch`).

## Outil de validation (dev coach)

`/admin/dev/exercices` — vérifie la bibliothèque : totaux, recherche live,
filtres (groupe musculaire / équipement / source), miniatures, fiche détaillée
(instructions, médias, source), masquage. C'est un outil de vérification des
données, **pas** la future bibliothèque du CRM Coach.
