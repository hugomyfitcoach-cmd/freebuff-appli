# Intégrer ces composants dans G-FLUX (SvelteKit + Convex)

Ces composants sont des **références visuelles exécutables**. Ils ne contiennent ni appel Convex, ni authentification, ni logique métier.

## Anatomie d'un écran
```
Home.svelte           gabarit (HTML + SVG + styles en ligne identiques à la maquette), lit les valeurs dans `v`
Home.logic.svelte.ts  état local (setState) + renderVals() qui produit les valeurs (fictives) du gabarit
Home.css              règles CSS propres à l'écran, préfixées .s-home
```
Dans le gabarit, `v` est un objet de valeurs (texte, nombres, chaînes de style, fonctions de clic, listes). Pour brancher des données réelles : remplacer le contenu de `renderVals()` par des valeurs calculées à partir de **props** typées reçues du composant de page existant (ou de ses stores), sans toucher au gabarit. Les calculs, seuils et règles de couleur de l'app existante restent ceux de l'app (voir CHARTE_GRAPHIQUE.md : états calories vert / orange / rouge).

## Marche à suivre par lot (voir INSTRUCTIONS_FREEBUFF.md §5)
1. Copier `src/lib/dc/DCLogic.svelte.ts`, `src/lib/styles/dc-base.css`, les écrans du lot (`.svelte`, `.logic.svelte.ts`, `.css`), `BottomNav.svelte` si nécessaire et les images utilisées.
2. Dans la page existante correspondante : conserver toute la logique et les appels existants ; remplacer uniquement le rendu par le composant visuel, en lui passant les données réelles. Garder tous les boutons, menus, formulaires et interactions de l'app actuelle, même absents de la maquette (les restyler dans le même langage).
3. Remplacer les couleurs en dur par les variables de l'app quand une variable officielle existe (tableau de correspondance dans CHARTE_GRAPHIQUE.md).
4. Remplacer `width/height` fixes de la racine par `min-height: 100dvh` et les marges `52px` / `bottom: 28px` par les safe areas (`env(safe-area-inset-*)`), voir `pwa-adapt.css`.
5. Ne jamais copier les données fictives dans le produit. Tester sur iPhone et Android réels, Deploy Preview Netlify, aucun merge ni Production sans accord de Hugo.

## Points techniques
- Svelte 5 (runes). `DCLogic.state` est un `$state` ; `setState(patch)` fusionne le patch. `renderVals()` est appelé dans un `$derived` : toute lecture de `this.state` est suivie.
- `onChange` des maquettes = événement `input` (réaction à chaque frappe).
- Animations : keyframes dans `dc-base.css`, neutralisées sous `prefers-reduced-motion`. Quelques écrans définissent leurs propres keyframes dans leur `.css`.
- `preserveWhitespace: true` (svelte.config.js) : à conserver pour garder les espaces du HTML d'origine (ex. « 206,9 g »).
- Les liens `href="/x"` sont ceux de la prévisualisation ; dans G-FLUX, garder les routes existantes.
