# PR — Journal plus compact + repères G-FLUX + valeurs recalculées

**Branche** : `freebuff/nouvelle-mission-g-flux-journal-plus-compact-rep-r-dda1e857-c743-431f-8ae3-b5b600b6f332`
**Base** : `main` — **commit** : `0a48908` — **PR sans merge** (test en preview)

## Titre de la PR

```
Journal : lignes aliments plus compactes + repères œufs/corn flakes/whey + édulcorants sans recalcul
```

## Description

### 1) Journal — vignettes aliments plus compactes (`src/lib/components/JournalDay.svelte`, mode cliente uniquement)

- **Vignettes images** réduites : 52 px → **44 px** (arrondi `rounded-xl` conservé) — composant partagé : entrées consommées, placeholder, items planifiés, cartes « repas analysé ».
- **Lignes aliments** resserrées : padding vertical `py-1.5` → **`py-1`** (consommées + planifiées) — hauteur de ligne réduite sans sacrifier la lisibilité.
- **Lisibilité conservée** : nom du produit **14 px**, kcal/quantité **11 px**, tabular-nums, troncature — inchangés.
- **Placeholder G-FLUX sans image** : même gabarit 44 px, fond `brand-light`, icône `utensils` réduite proportionnellement (18 → 15 px) — propre et aligné.
- **Rond de sélection réduit** : 28 px → **24 px** (rendu proche Food/Virtuagym), coche 13 → 11 px, **zone tactile ~44 px conservée** via `after:-inset-2.5` (facile à toucher, moins imposant visuellement). Appliqué aux lignes consommées ET planifiées.
- Le rendu **coach (Vision 360 CRM) reste inchangé** (36 px / paddings d'origine) — la compacité ne s'applique qu'au mode cliente.

### 2) Repères G-FLUX

- **Œufs (bloc Ciqual « Aliments de référence »)** : la recherche générique « œuf » affiche désormais l'ordre fixe **1. œuf cru → 2. œuf dur → 3. œuf au plat** (avant : fiches exotiques ou « Oeufs de cabillaud fumés » pouvaient s'inviter). Une requête précise (« œuf dur », « œuf au plat », « à la coque ») reste une recherche spécifique. Le repère de saisie « 1 œuf = 50 g » est intact.
- **Corn flakes** : nouveau repère **c. à soupe ≈ 9 g** (dédicace, sans doublon avec les flocons d'avoine à 8 g ; « pop-corn » et barres exclus).
- **Whey** : nouveau repère **1 scoop = 30 g** pour la poudre pure (whey, caséine, isolat) — jamais pour barres/pancakes/boissons à la whey.
- Doublons vérifiés : chaque règle ne renvoie qu'une occurrence par libellé (contrainte d'interface de l'onglet Repères) ; correctif bonus « Oeuf de caille » qui héritait du pot de dessert lacté (collision de normalisation « caillé »/« caille »).

### 3) Valeurs recalculées — édulcorants (`src/lib/nutritionGuard.ts`)

- Les fiches qui **sont** l'édulcorant (stévia, édulcorant de table, sucralose, aspartame, Pure Via, Canderel, Splenda…) avec des kcal de fiche ≤ 50/100 g ne sont **plus jamais recalculées** — leurs macros ≈ nulles rendaient le garde-fou kcal↔macros sans objet.
- Un **aliment classique citant l'édulcorant** (« yaourt au sucralose »…) **reste couvert** par le garde-fou.
- Non-régression vérifiée : huile (exclusion), bière sans champ alcool (exclusion), tomate aberrante (correction conservée).

### 4) Sécurité

- **Aucun Convex production touché** (aucun `convex dev`, aucun `npm run deploy`, aucune commande Convex exécutée).
- **Aucune migration** : pas de changement de schéma, pas de suppression de table/champ/index, aucune écriture de données — les modifications Ciqual/repères/garde-fou sont 100 % lecture.
- Fusibles preview existants conservés (`scripts/build-preview.mjs` refuse toute preview vers la prod `calm-jaguar-475`).

### 5) Tests & checks

- **`npm test` : 77/77 verts** — 14 nouveaux tests (`tests/mission-journal-compact.test.mjs`) couvrant : Journal compact (vignettes, lignes, rond, placeholder), ordre des œufs (générique + spécifique), corn flakes, whey scoop, édulcorants, non-régressions (œuf de caille, pop-corn, Pure Via, sucre, flocons d'avoine, bière/huile/tomate).
- **`npm run check` (svelte-check) : 0 erreur** (37 warnings a11y préexistants, fichiers non touchés).
- **`npm run build` : OK** (garde-fous preview passés en contexte dev, `.env.production` local généré, aucune infrastructure contactée).

## Checklist de test manuel (Preview)

- [ ] Journal avec images réduites (densité, lisibilité nom/kcal/quantité)
- [ ] Journal sans image (placeholder G-FLUX 44 px)
- [ ] Noms longs (troncature propre)
- [ ] Rond de sélection réduit à droite (tap fiable)
- [ ] Recherche « œuf » → cru, dur, au plat
- [ ] Recherche « corn flakes » → repère cuillère
- [ ] Recherche « whey » → 1 scoop = 30 g
- [ ] Fiches stevia / Pure Via / sucralose → pas de badge « Valeur recalculée »
- [ ] Rendu coach (Vision 360) inchangé
