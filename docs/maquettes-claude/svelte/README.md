# G-FLUX — 35 écrans en Svelte 5 / SvelteKit 2 (TypeScript)

Conversion **visuelle** des 35 maquettes validées en composants Svelte autonomes. Aucune connexion à l'application réelle : les **données sont fictives** (celles des maquettes) pour permettre la prévisualisation.

## Lancer
Prérequis : Node ≥ 20.
```bash
npm install
npm run dev          # http://localhost:5173
# ou version de production
npm run build && npm run preview     # http://localhost:4173
```

## Naviguer
- `/` : index des 35 écrans avec vignettes, groupés (Principal, Journal, Progression, Outils, Compte).
- `/<écran>` : un écran, par exemple `/home`, `/journal`, `/food-banane`, `/scanner`, `/login` (liste complète dans `src/lib/screens/registry.ts`).
- **Bureau** (> 640 px) : liste des écrans à gauche, écran 390 × 844 centré dans un cadre (réduit automatiquement si la fenêtre est trop basse). Touches **← →** : écran précédent / suivant.
- **Mobile / PWA** (≤ 640 px) : l'écran occupe toute la fenêtre. Il est mis à l'échelle **proportionnellement** à la largeur (360 px → ×0,92 ; 430 px → ×1,10), jamais déformé ; sa hauteur suit la fenêtre.
- **Dans les écrans** : les boutons de navigation des maquettes fonctionnent (barre du bas Accueil / Journal / Progression, boutons « Retour », cartes vers Performance, Pas, Cycle, Drive, Bilans, Scanner, fiches aliment, feuilles de saisie…). Les interactions d'origine sont conservées : courbes interactives (survol / toucher), quantité − / +, cœur favori, calendrier du Journal, flash et zoom du scanner, bascules, saisies, etc.

## Contenu
```
src/lib/screens/            35 écrans : Nom.svelte (gabarit) + Nom.logic.svelte.ts (état + valeurs fictives) + Nom.css (styles propres)
src/lib/screens/registry.ts liste des écrans (slug, titre, groupe, chargement à la demande)
src/lib/components/         BottomNav.svelte (barre du bas partagée, 3 variantes), Stage.svelte (cadre responsive)
src/lib/dc/DCLogic.svelte.ts   classe de base de la logique (état réactif $state + setState)
src/lib/styles/             dc-base.css (keyframes et classes communes), tokens.css (charte officielle), app.css (cadre de prévisualisation)
src/routes/                 / (index), [slug] (un écran), +layout (polices, CSS, cadre)
static/assets/              images et logos ; static/icons + manifest.webmanifest (PWA) ; static/thumbs (vignettes)
reference/maquettes/        les 35 maquettes HTML d'origine (référence absolue) ; reference/passation/ : 4 pages de passation
docs/                       INSTRUCTIONS_FREEBUFF.md (règles et plan par lots), CHARTE_GRAPHIQUE.md, GUIDE_ECRANS.md, INTEGRATION_SVELTE.md, fichiers PWA
scripts/                    fidelity.mjs, smoke.mjs, thumbs.mjs (tests, voir plus bas)
```

## Comment la conversion a été faite
- **Gabarit** : `{{x}}` → `{v.x}`, `<sc-for>` → `{#each}`, `<sc-if>` → `{#if}`, `onClick` → `onclick`, `onChange` → `oninput` (équivalent du `onChange` de React : réagit à chaque frappe / déplacement de curseur), liens `X.dc.html` → routes `/x`, images → `/assets/…`. Les styles en ligne, SVG, tailles et textes sont repris tels quels.
- **Logique** : la classe d'origine (`state`, `setState`, `renderVals()`) est conservée dans `Nom.logic.svelte.ts` ; l'état est réactif (rune `$state`) et chaque écran calcule `const v = $derived(logic.renderVals())`. Les animations qui se rejouent à chaque changement (alternance de keyframes A/B) fonctionnent donc comme dans la maquette.
- **CSS** : keyframes, `.fx`, `.sheet`, `.hbar`… sont mutualisés dans `dc-base.css`. Les règles qui différaient d'un écran à l'autre (`.press`, `.area`, règles sur `button`, `a`, `input`) restent **par écran**, préfixées par `.s-<slug>`, pour ne rien changer au rendu.
- **Taille** : la racine de chaque écran utilise `width: var(--gf-w, 390px); height: var(--gf-h, 844px)`. Le cadre `Stage` fournit ces variables.
- **Polices** : Lato 400 / 700 / 900 auto-hébergée (`@fontsource/lato`), pas de requête vers Google Fonts.

## Vérifications effectuées
- `npm run build` : compile sans erreur ni avertissement ; `npm run check` (svelte-check) : 0 erreur.
- `node scripts/fidelity.mjs` : pour chacun des 35 écrans, la maquette d'origine (évaluée avec sa propre logique, état initial) et la route Svelte sont rendues dans Chromium puis comparées élément par élément (balises, attributs, styles, textes, position et taille). **Résultat : 35 / 35 identiques.**
- `node scripts/smoke.mjs` : liens internes valides, clic sur tous les boutons sans erreur, interactions clés (quantité, favori, scanner, calendrier, bascule cru/cuit, navigation) et rendu à 360×740, 375×667, 390×844, 430×932, 1280×900 et 1024×600 sans défilement horizontal ni écran coupé.

Pour relancer ces tests : `npm run build && npm run preview -- --port 4173`, puis dans un autre terminal `npx playwright install chromium` (une fois), `npm run test:fidelity` et `npm run test:smoke`.

## Limites à connaître
1. **Données fictives** (valeurs, noms, historiques, images d'aliments, avatar « HG ») : dans `*.logic.svelte.ts`. Elles ne doivent pas devenir des données réelles.
2. **Logique conservée en JavaScript d'origine** (fichiers `.svelte.ts` avec `// @ts-nocheck`) pour garantir un rendu identique ; les gabarits et le cadre sont en TypeScript strict. À typer lors de l'intégration (props typées à la place des valeurs fictives).
3. **Mise à l'échelle sur mobile** (et non reflow fluide) : fidèle aux maquettes 390 × 844, mais pas encore une mise en page adaptative écran par écran. Pour la PWA réelle, voir `docs/INSTRUCTIONS_FREEBUFF.md` (safe areas, `100dvh`, etc.) et `docs/pwa-adapt.css`.
4. **Mutualisation limitée** à ce qui est identique au pixel près : barre du bas, base CSS, cadre. Les en-têtes, cartes et boutons restent en markup par écran ; les extraire en composants est l'étape suivante, à faire écran par écran sans changer le rendu.
5. Avertissements d'accessibilité du compilateur Svelte masqués (`svelte.config.js`) : les maquettes utilisent des `<a>` / `<button>` stylés ; à réactiver à l'intégration.
6. Les 4 pages de passation (tokens, composants, PWA, logo) ne sont pas converties : elles restent dans `reference/passation/` (documentation).
7. La comparaison de fidélité utilise ma propre évaluation de la syntaxe des maquettes (le lecteur Claude Design n'est pas utilisable hors ligne) ; non testé sur appareils réels ni sous Safari/Firefox.

## Pour Freebuff
Lire `docs/INSTRUCTIONS_FREEBUFF.md` (règles impératives) puis `docs/INTEGRATION_SVELTE.md`. L'app G-FLUX existante reste la source de vérité fonctionnelle ; ces composants ne sont que la référence visuelle.
