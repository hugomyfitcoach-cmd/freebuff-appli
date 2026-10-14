# Charte graphique G-FLUX appliquée aux maquettes

Source : charte officielle extraite du code de l'app (layout.css, JournalDay.svelte, MacroLine.svelte, PerformanceWeekCard.svelte…). Jetons prêts à lire : `src/lib/styles/tokens.css`. **Ne jamais recopier une valeur en dur : utiliser la variable existante de l'app.**

## Couleurs de marque
| Usage | Variable de l'app | HEX |
|---|---|---|
| Vert principal : boutons pleins, icônes, états actifs, anneaux, courbes, calories (normal) | `--color-brand` / `--accent` | `#1db954` |
| Hover / pressé des boutons pleins | `--color-brand-dark` | `#17a349` |
| Texte vert, onglet / filtre actif | `--color-brand-deep` | `#0d7c36` |
| Fond vert clair (pastilles, onglet actif) | `--color-brand-light` | `#e8fef0` |
| Vert très clair (dégradés doux) | `--color-brand-soft` | `#f3fcf7` |
| Bordure verte translucide | `--green-mid` (tools.css) | `rgba(29,185,84,.3)` |

## États calories (Journal) — règle officielle, aucun seuil ajouté
- Vert `#1db954` : consommé ≤ objectif.
- Orange `#f59e0b` : objectif dépassé, maintenance non dépassée (ou aucune maintenance définie).
- Rouge `#ef4444` : maintenance dépassée.
- Comparaisons strictes `consommé > objectif`, `consommé > maintenance`. Remplissage plafonné à 100 %, échelle = maintenance si > objectif sinon objectif ; marqueur vertical à l'objectif ; zone au-delà teintée `#fff8f0`.
- Carte : bordure et fond teintés selon l'état. Fond de jauge : `#eef0ec`.
- Macros : couleur dédiée quel que soit le pourcentage (arc plafonné à 100 %, valeur affichée non plafonnée) — **jamais orange ni rouge**. Jour futur : gris `#9aa19a`, `opacity-60`, `saturate-50`.

## Macronutriments
Glucides `#ec4899` · Protéines `#3b82f6` · Lipides `#f97316` · Calories `#1db954`. Utilisés tels quels, y compris pour les textes (aucune variante plus foncée).

## Alertes générales
Avertissement `--color-warn` `#ff9500` sur fond `--color-warn-light` `#fff8f0` · Erreur / danger `--color-danger` `#ff4444` sur fond `--color-danger-light` `#fff0f0`. Utilisés pour : suppression, déconnexion, avertissements d'information.

## Typographie
Lato 400 / 700 / 800 / 900 (`--font-sans`, `--font-display`). Dans les maquettes : 400, 700, 900 (Lato ne propose pas de 800 distinct côté maquette, 900 utilisé pour les titres et chiffres). Oswald uniquement sur la page de bilan existante (non redessinée en Oswald dans les maquettes : conserver l'existant).

## Styles communs des maquettes (esthétique validée par Hugo)
| Élément | Valeur dans la maquette |
|---|---|
| Fond d'écran | blanc `#FFFFFF` (+ dégradés décoratifs validés sur quelques écrans) |
| Carte | rayon 24 px, bordure 1 px `#EEF1EF`, ombre `0 1px 2px rgba(15,21,18,.04), 0 14px 32px -16px rgba(15,21,18,.18)` |
| Carte compacte | rayon 20 px, ombre `0 12px 26px -16px rgba(15,21,18,.18)` |
| Bouton plein | pilule (rayon 26-29 px), hauteur 52-58 px, fond `#1db954`, texte blanc 700, ombre `0 14px 26px -12px rgba(23,163,73,.65)` |
| Bouton secondaire | fond blanc, bordure `#E3E8E5`, texte `#66716B` |
| Barre du bas flottante | rayon 34 px, hauteur 68 px, `bottom:28px` (→ `env(safe-area-inset-bottom)+12px`), onglet actif fond `#e8fef0` texte `#0d7c36` |
| Marge de contenu | 20 px |
| Retour tactile | `scale(.97)`, 150 ms |

## Correspondance neutres maquette → variables de l'app
Les maquettes utilisent des neutres légèrement différents de ceux de l'app. **Les variables de l'app l'emportent**, l'écart est volontairement accepté.
| Maquette | Variable de l'app à utiliser |
|---|---|
| Texte `#0F1512` | `--color-ink` `#111110` |
| Texte secondaire `#66716B` | `--color-mist-strong` `#6f736b` |
| Texte discret `#7B857F`, `#9AA39E` | `--color-mist` `#999990` (décoratif ou ≥ 18 px uniquement) |
| Bordures/lignes `#EEF1EF`, `#E9EDEA`, `#E3E8E5` | `--color-line-soft` `#efede6` / `--color-line` `#e5e3dc` |
| Surfaces douces `#F3F6F4`, `#F6F8F6` | `--color-soft` `#f4f6f4` |
| Capsule sombre `#111A15` | pas d'équivalent officiel : valeur conservée (barre de mode du scanner, infobulles) |

## Points d'arbitrage à signaler à Hugo (ne pas trancher seul)
1. **Fond blanc vs crème** : la charte officielle a `--color-cream #f7f5f0` comme fond principal ; Hugo a validé un fond **blanc** pour les écrans redessinés. Ne pas modifier `--bg` / `--color-cream` globalement : appliquer le fond blanc écran par écran.
2. **Contraste** : texte blanc sur `#1db954` ≈ 2,6:1 (< 4,5:1 recommandé). Appliqué tel que demandé. Alternative accessible : `#17a349` pour les boutons à petit texte. Les macros `#ec4899`, `#3b82f6`, `#f97316` en petit texte sur blanc sont aussi sous 4,5:1.
3. **Rayons et ombres** : maquettes 24 px + ombre douce vs app 16-18 px + `--ds-sh-*`. À implémenter au niveau des composants des écrans redessinés, **sans modifier** les jetons globaux `--ds-sh-*`.
4. **Hors charte conservés tels quels** : violet `#A855F7` (courbe Masse grasse), teintes ambre des encarts d'info (`#B45309`, `#FFF1DC`, `#FFF8F0`/`#F8D9A4`), `#111A15`, `#06361B` (texte sur badge BÊTA).
