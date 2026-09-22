# Mission « Alimentation intelligente » — audit initial

## 1. Scanner code-barres actuel (`src/lib/barcodeScanner.ts`)

- Déjà une bonne base : décodage sur l'image caméra **native** (plafond 1280 px), 
  BarcodeDetector natif (Chrome/Android/Samsung Internet) puis fallback ZXing 
  (UMD vendored dans `html5-qrcode/third_party`), boucle ~70 ms, formats EAN-13/
  EAN-8/UPC-A/UPC-E/CODE-128/ITF/CODE-39.
- Manques identifiés :
  - pas de `torch` (lampe) ni de zoom (`track.applyConstraints({ advanced: [{ zoom }] })`) ;
  - pas de vibration à la détection ;
  - `getUserMedia` une seule tentative — pas de repli 1280 si 1920 indisponible ;
  - pas de validation de format (un code lu n'est pas forcément EAN/UPC) ;
  - pas de cache `BarcodeDetector.isFormatSupported`.
- Décision : améliorer le module existant **sans** changer son API 
  (`startBarcodeScanner(container, onDecoded)` + `stop()`), en ajoutant :
  resolution ladder, torch/zoom optionnels, vibration, validation EAN-13/EAN-8/UPC
  (checksum), garde anti double lecture (même code < 1,2 s).

## 2. « Créés par moi » (`customFoods`)

- Table : `userId, name, brand?, kcal100, carbs100, protein100, fat100, servingQty?`.
- Form : entrée actuelle « + Créer un aliment (étiquette nutritionnelle) » dans 
  l'onglet `crees` de l'écran « Ajouter un aliment » (`+page.svelte` ~2560).
- Toute la mécanique (CRUD API BFF `/api/foods/custom`, préremplissage, éditeur) 
  est réutilisable : la photo d'étiquette préremplit exactement ce formulaire.

## 3. Recherche Convex / barcode

- `GET /api/foods/barcode?code=` → action Convex `off.barcodeLookup` : 
  base locale d'abord (`foods.by_offId`), puis API OFF → cache `foods`.
- Décision : retourner un statut structuré `{ found, food }` côté BFF 
  (aujourd'hui un tableau vide signe « inconnu ») sans casser l'usage existant.

## 4. Journal & repas

- `diaryEntries` : snapshot kcal/macros calculés serveur (`addEntry`) ; 
  `plannedEntries` : planifié ≠ consommé ; `meals` : recettes personnalisées 
  (ingrédients snapshot) ; plan coach = templates intouchables.
- Ciqual = fiche de référence par `ciqualLabel` exact résolu côté serveur 
  (`ciqualFoodSource`) — jamais de valeurs transmises par le client. 
  Le matching repas réutilisera cette règle.
- Coach : une cliente ne peut JAMAIS écrire la base globale `foods` 
  (aucune mutation cliente n'existe — à préserver).

## 5. Architecture retenue (V1)

- **OpenAI 100 % côté BFF SvelteKit** (`src/lib/server/openai.ts`, clé 
  `OPENAI_API_KEY` serveur). Pas d'import npm lourd : `fetch` direct Responses API.
- `POST /api/foods/label-scan` : photo (dataURL) → 1) décodage barcode CÔTÉ PWA
  (même ZXing vendored que le scanner, `src/lib/labelBarcode.ts`) — l'IA ne
  devine JAMAIS un code-barres ; 2) Convex `aiAnalysis.analyzeLabel` → BFF
  `/api/ai/label` (OpenAI Vision, JSON structuré) → clamps + `needsReview[]`.
- `POST /api/meals/analyze` : photo → Convex `aiAnalysis.analyzeMeal` (OpenAI
  reconnaît aliments + quantités UNIQUEMENT) → `mealMatch.matchComponents`
  (hiérarchie : customFoods → foods (OFF importé) → CIQUAL → « Estimation IA »).
- `POST /api/meals/commit` → `meals.commitAnalyzedMeal` : N `diaryEntries` en
  une mutation, snapshots serveur, garde-fou kcal↔macros, date future →
  `plannedEntries`, clé `mealGroup` pour le regroupement visuel.

## 6. Implémentation livrée (branche dédiée, aucun push Convex/origin)

### Backend Convex
- `schema.ts` : `customFoods` + `barcode`, `fiber100`, `salt100`, `globalStatus`
  (`candidate`/`published`), `sourceKind`, index `by_barcode` ; `diaryEntries` +
  `mealGroup?` ; table `aiUsageLog` (kind, model, tokens, durée, coût estimé).
- `customFoods.ts` : create/update acceptent barcode + sourceKind — avec barcode
  → `globalStatus: "candidate"` (candidat global, JAMAIS publié auto) ; sans
  barcode → privé ; `byBarcode` (anti-doublon), `globalCandidates` (coach).
- `mealMatch.ts` : matching nominal par hiérarchie (score) — aucun appel live OFF.
- `aiAnalysis.ts` : actions `analyzeLabel` / `analyzeMeal` (session client,
  validation, clamps 0–900 kcal & 0–100 g, `kcalFromKj`, `needsReview`),
  logs `aiUsageLog`, panne OpenAI → `{ ok: false, reason }`.
- `aiLog.ts` : `internal.aiLog.record`.
- `meals.ts` : `commitAnalyzedMeal` (≤ 12 composants, identités résolues serveur,
  estimation IA encadrée `source: "ai_estimation"`, `mealGroup`).

### BFF SvelteKit
- `src/lib/server/openai.ts` : clé serveur, modèle configurable (`OPENAI_MODEL`,
  défaut gpt-4o-mini), timeout, JSON structuré validé, erreurs normalisées,
  usage (tokens + coût estimé) remonté.
- `/api/ai/label`, `/api/ai/meal` : uniques consommateurs de la clé OpenAI.
- `/api/foods/label-scan`, `/api/meals/analyze`, `/api/meals/commit`.
- `/api/foods/custom` : + `fiber100`, `salt100`, `barcode`, `sourceKind`.

### PWA (Journal)
- Bottom sheet « + Créer un aliment » : Scanner / Photographier une étiquette /
  Saisir manuellement (formulaire historique conservé, + fibres & sel, badge
  « à vérifier » sur les champs ambigus, note kJ→kcal).
- Flux barcode inconnu → « Photographier l'étiquette » (code mémorisé, candidat
  global à la création).
- « Photographier mon repas » : capture → analyse → fiche visuelle unique
  (composants : quantité modifiable avec recalcul instantané, remplacement,
  suppression ; « + Ajouter un ingrédient » avec recherche Convex+CIQUAL, 10 g
  par défaut sur huiles/sauces ; badge « Estimation IA » ; hint « Huile, sauce
  ou matière grasse utilisée ? » ; macros live ; « Ajouter au Journal »).
- Journal : les composants d'une même analyse forment UNE carte repliable
  (« 🍽️ … · ≈ X kcal · N éléments ») — totaux du jour inchangés ; mode coach
  inchangé (lignes plates).
- Scanner : BarcodeDetector natif + fallback ZXing, ladder 1920→1280, autofokus,
  vibration, lampe + zoom UI si supportés, formats EAN-13/EAN-8/UPC validés
  (checksum), anti double lecture.

## 7. Checks & tests

- `svelte-check` : **0 erreur** (31 warnings préexistants, a11y/labels).
- `npm run build` : OK.
- `npx convex codegen --typecheck=try` : typecheck Convex strict OK, `_generated`
  régénéré — **aucun push** (codegen ne modifie pas le déploiement).
- Tests manuels E2E à effectuer avec une clé `OPENAI_API_KEY` + déploiement
  Convex réel (barcode connu/inconnu, étiquette claire/portion+kJ, photo floue,
  repas multi-composants, ajout huile, modification quantité, panne OpenAI,
  iPhone/PWA). Non automatisables ici : camera/vision réelles indisponibles
  dans l'environnement.

## 8. Points à valider (produit)

1. `OPENAI_API_KEY` / `OPENAI_MODEL` : à définir dans `.env.local` (dev) et
   Netlify (prod) — jamais côté PWA.
2. `PUBLIC_APP_URL` côté Convex (`npx convex env set`) doit pointer vers le BFF
   réel pour que les actions Convex joignent `/api/ai/*` (défaut localhost:5173
   en dev).
3. Le push Convex (schema + fonctions) reste À FAIRE par toi, au moment choisi
   (`npx convex dev` / `convex deploy`) — rien n'a été poussé.
4. Modération des candidats globaux : `globalCandidates` (coach) liste, la
   publication effective vers `foods` est volontairement HORS V1.
5. « Enregistrer ce repas » (template réutilisable) : volontairement hors V1.
