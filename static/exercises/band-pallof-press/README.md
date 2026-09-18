# Pallof press avec bande

> Exercice de la bibliothèque propriétaire **G-FLUX** — animé, validé et
> conforme au standard [`docs/exercise-db-standard.md`](../../../docs/exercise-db-standard.md).

## Identité

| | |
| --- | --- |
| Slug | `band-pallof-press` |
| Nom (FR / EN) | Pallof press avec bande / Band Pallof Press |
| Catégorie | Tronc |
| Groupe musculaire principal | Abdominaux |
| Muscles primaires | Abdominaux, Obliques |
| Muscles secondaires | Grand fessier, Épaules |
| Matériel | Élastiques |
| Niveaux | Débutant, Intermédiaire, Avancé |

## Livrable

| Fichier | Rôle |
| --- | --- |
| `poster.webp` | Vignette statique (frame 2 — bras tendus, gainage anti-rotation). |
| `animation.mp4` | Animation officielle du mouvement (720×720, boucle 1→2→3→4→1, 3 s). |
| `exercise.json` | Données structurées (exécution, cues, erreurs, respiration). |
| `source/` | Working files de production (grille 2×2 validée). |

## État de validation

- **Statut** : validé ✅
- **Version du rendu** : v1
- **Personnage** : femme athlétique (standard G-FLUX) — cohérence de marque
  de toute la bibliothèque, indépendamment de l'Exercise DB importée.
- **Série** : mini-bandes — exercices à domicile (lot 1, 2026).

## Particularité de production

- L'**ancre murale** (point fixe de la bande) touche le bord droit du cadre
  dans la source validée : c'est voulu et pédagogique. L'extraction conserve
  l'ancre complète ; l'outil de QC remonte un warning documenté
  (bord droit non bloquant, contrairement aux bords haut/bas/gauche).

## Contrôle qualité

- [x] 4 fichiers livrables présents, aucun fichier temporaire.
- [x] Extraction des 4 quadrants avec cadrage commun (aucune ligne de grille
      résiduelle, aucun personnage coupé, échelle identique entre les frames).
- [x] Point d'ancrage conservé sur les 4 frames (warning documenté).
- [x] Poster = position clé du mouvement (bras tendus, tension anti-rotation).
- [x] Animation en boucle fluide (fondus 0,25 s), sans son, H.264 faststart.
- [x] Données complètes dans `exercise.json`.
- [x] Enregistré dans le registre (`static/exercises/index.json`).
- [x] Anti-doublon : `band horizontal pallof press` (importé) = même mouvement ;
      version G-FLUX officielle créée — masquage réversible de l'import
      recommandé (fait dans ce lot, voir rapport).
