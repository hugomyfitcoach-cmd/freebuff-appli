# Pont fessier avec mini-bande

> Exercice de la bibliothèque propriétaire **G-FLUX** — animé, validé et
> conforme au standard [`docs/exercise-db-standard.md`](../../../docs/exercise-db-standard.md).

## Identité

| | |
| --- | --- |
| Slug | `mini-band-glute-bridge` |
| Nom (FR / EN) | Pont fessier avec mini-bande / Mini Band Glute Bridge |
| Catégorie | Bas du corps |
| Groupe musculaire principal | Fessiers |
| Muscles primaires | Grand fessier |
| Muscles secondaires | Ischio-jambiers, Moyen fessier, Abdominaux |
| Matériel | Mini-bande |
| Niveaux | Débutant, Intermédiaire, Avancé |

## Livrable

| Fichier | Rôle |
| --- | --- |
| `poster.webp` | Vignette statique (frame 3 — pont haut, contraction maximale). |
| `animation.mp4` | Animation officielle du mouvement (720×720, boucle 1→2→3→4→1, 3 s). |
| `exercise.json` | Données structurées (exécution, cues, erreurs, respiration). |
| `source/` | Working files de production (grille 2×2 validée). |

## État de validation

- **Statut** : validé ✅
- **Version du rendu** : v1
- **Personnage** : femme athlétique (standard G-FLUX) — cohérence de marque
  de toute la bibliothèque, indépendamment de l'Exercise DB importée.
- **Série** : mini-bandes — exercices à domicile (lot 1, 2026).

## Contrôle qualité

- [x] 4 fichiers livrables présents, aucun fichier temporaire.
- [x] Extraction des 4 quadrants avec cadrage commun (aucune ligne de grille
      résiduelle, aucun personnage coupé, échelle identique entre les frames).
- [x] Poster = position clé du mouvement (pont en contraction).
- [x] Animation en boucle fluide (fondus 0,25 s), sans son, H.264 faststart.
- [x] Bande visible et tendue au-dessus des genoux sur les 4 frames.
- [x] Données complètes dans `exercise.json`.
- [x] Enregistré dans le registre (`static/exercises/index.json`).
- [x] Anti-doublon : aucun pont avec mini-bande dans la Exercise DB (les ponts
      importés = barre/march/banc — variante distincte justifiée).
