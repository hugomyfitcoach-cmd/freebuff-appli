# INSTRUCTIONS_FREEBUFF — Cahier des charges d'intégration de la refonte visuelle G-FLUX

Stack : SvelteKit + Convex, PWA mobile (iPhone et Android), déploiement Netlify.
Lis ce fichier en entier avant toute modification. Puis `charte/` et `reference/passation/` (4 écrans à ouvrir en premier : Tokens, Composants, PWA, Logo).

## 1. Règles impératives (non négociables)
1. **L'application G-FLUX existante est la source de vérité FONCTIONNELLE.** Les maquettes Claude sont uniquement la source de vérité ESTHÉTIQUE.
2. Préserver intégralement la logique métier, les calculs nutritionnels, les seuils, les données, les permissions et les fonctionnalités existantes.
3. Conserver **tous** les boutons, menus, formulaires et interactions de l'app actuelle, même absents des maquettes. Si un élément n'est pas dans la maquette, le restyler dans le même langage visuel, ne pas le supprimer.
4. Réutiliser les composants SvelteKit et les styles existants. Pas de nouveau framework UI, pas de réécriture complète.
5. **Ne pas modifier Convex, les API, l'authentification ou la base de données** pour une adaptation purement visuelle. Si un changement semble nécessaire : s'arrêter et demander.
6. Préserver les performances mobiles, l'accessibilité et `prefers-reduced-motion` (tout est coupé dans ce mode).
7. **Ne jamais intégrer les données fictives des maquettes comme données réelles** (noms, valeurs, dates, historiques, « Hugo », « HG », aliments d'exemple, recettes, textes).
8. Travailler par **lots indépendants**, avec tests et **Netlify Deploy Preview** avant validation.
9. **Aucun merge ni déploiement en Production sans autorisation explicite de Hugo.** Travailler sur branches dédiées, une PR par lot.
10. Les couleurs viennent des variables de l'app (voir `CHARTE_GRAPHIQUE.md`). Ne pas inventer de nouveaux seuils nutritionnels : la logique orange/rouge des calories existe déjà dans l'app, ne pas la modifier.

## 2. Comment lire les maquettes
- `reference/maquettes/*.dc.html` : 35 écrans (390 × 844). Ce ne sont **pas** des pages prêtes à l'emploi : HTML + styles en ligne + un bloc de script d'état. `{{x}}` = valeur dynamique, `<sc-for>` = boucle, `<sc-if>` = condition. À utiliser comme **spécification** (structure, tailles, couleurs, animations) et à reproduire avec les composants Svelte.
- Les liens `X.dc.html` indiquent la navigation voulue entre écrans ; dans l'app, garder les routes existantes.
- Les images sont dans `static/assets/` (chemins `../assets/...`). Les images d'aliments sont des exemples, pas des ressources produit. Le logo est un export bitmap : utiliser la source vectorielle de l'app.
- `reference/passation/` : tokens, composants et états, intégration PWA, logo. **À lire en premier.**

## 3. Exigences PWA (iPhone + Android)
- Fichiers fournis dans `pwa/` : `head.html` (meta), `manifest.webmanifest`, `adapt.css` (safe areas, hauteur dynamique, tap, reduced-motion), `keyboard.js` (clavier), icônes 180 / 192 / 512 / 512 maskable.
- Remplacer les valeurs codées en dur : `height:844px` → `min-height:100dvh`; marge haute `52px` → `env(safe-area-inset-top)`; barre du bas `bottom:28px` → `calc(env(safe-area-inset-bottom) + 12px)`. Ne pas figer la largeur à 390 px : tester 360, 375 × 667 (iPhone SE), 390, 430 × 932.
- Champs de saisie à 16 px minimum (évite le zoom iOS). Zones de toucher ≥ 44 px (la maquette a quelques cibles de 32-42 px : agrandir la zone sensible sans agrandir le dessin).
- Scanner de codes-barres : prévoir/garder la lecture sur flux caméra existante (vérifier le comportement sur iPhone en PWA).
- Reprendre les icônes fournies tant que la source vectorielle n'est pas utilisée.

## 4. Animations
Sobres, 150 à 300 ms pour les interactions, 600 à 900 ms pour les tracés de courbes/anneaux. Aucune animation sur les éléments dont l'état est déjà visible au repos. Tout animé doit être neutralisé sous `@media (prefers-reduced-motion: reduce)` (règle globale déjà dans `pwa/adapt.css`). Détail par écran : `GUIDE_ECRANS.md`.

## 5. Plan de travail par lots (une PR et un Deploy Preview par lot)
| Lot | Contenu | Priorité |
|---|---|---|
| 0 | Fondations : variables (sans écraser l'existant), `adapt.css`, manifest + icônes, composants partagés (carte, champ, bouton, barre du bas, en-tête) | 1 |
| 1 | Accueil (Home) + navigation | 1 |
| 2 | Journal : Journal, Journal-Select, Recherche, Scanner, Repas IA, fiches aliment (Food-Detail, Food-Banane), Main, Meal-Edit, Foods, Food-Edit | 1 |
| 3 | Progression : Progress, Poids, Partie-fine, Fessiers, Cou, Masse-grasse, Sheet-Poids, Sheet-Mesures, Sheet-Taille, Performance, Steps, Cycle, Depense | 2 |
| 4 | Outils : Drive, Bilans, Calibrage, Nutrition, Recipes, Messages, Guide | 3 |
| 5 | Compte : Settings, Recap (menu profil), Login (visuel uniquement : ne pas toucher à l'authentification) | 3 |

Chaque lot : (a) lire les écrans concernés, (b) lister ce que fait l'écran actuel et ce que la maquette ne montre pas, (c) restyler en réutilisant les composants, (d) tests, (e) Deploy Preview, (f) rapport à Hugo, (g) attendre sa validation avant le lot suivant.

## 6. Checklist de validation par écran
- [ ] Toutes les fonctions de l'écran actuel sont présentes et fonctionnent (y compris celles absentes de la maquette).
- [ ] Aucun changement dans Convex / API / auth / calculs / seuils / permissions.
- [ ] Couleurs = variables de l'app (aucun HEX en dur sauf ceux listés « conservés » dans `CHARTE_GRAPHIQUE.md`).
- [ ] Aucune donnée fictive dans le rendu final ; états vide / chargement / erreur / hors ligne / clavier ouvert / confirmation de suppression traités dans le même style (liste dans `reference/passation/Handoff-Composants.dc.html`).
- [ ] Safe areas OK sur iPhone (encoche + barre d'accueil) et Android ; testé à 360, 375 × 667, 390, 430 px.
- [ ] `prefers-reduced-motion` testé.
- [ ] Navigation clavier / lecteur d'écran : libellés `aria-label` conservés, focus visible.
- [ ] Pas de régression de performance (pas de gros assets, pas d'animation en boucle hors scanner).
- [ ] Deploy Preview Netlify partagé à Hugo ; **aucun merge ni Production sans son accord.**

## 7. Éléments fictifs ou à ne pas reprendre
Valeurs d'exemple de Meal-Edit et Food-Edit ; étapes 2-3 des recettes ; avatar « HG » et prénom ; historiques de mesures (reconstitués) ; contenu « Repères G-FLUX » (non fourni, placeholder) ; « Mot de passe oublié ? » et bascule coach / client de la connexion (visuels) ; seuil de 8 chiffres du bouton du scanner ; zoom « 2× » du scanner (simulation) ; Journal-Select et Messages non reliés aux autres écrans dans la maquette (conserver la navigation actuelle).

## 8. En cas de doute
S'arrêter, décrire l'écart entre maquette et app en 3 lignes, proposer une option, attendre la réponse de Hugo. Ne jamais supprimer une fonction pour coller à la maquette.
