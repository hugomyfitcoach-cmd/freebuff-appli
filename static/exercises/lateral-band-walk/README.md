# Marche latérale avec mini-bande

> Exercice de la bibliothèque propriétaire **G-FLUX** — animé, validé et
> conforme au standard [`docs/exercise-db-standard.md`](../../../docs/exercise-db-standard.md).

## Identité

| | |
| --- | --- |
| Slug | `lateral-band-walk` |
| Nom (FR / EN) | Marche latérale avec mini-bande / Lateral Band Walk |
| Catégorie | Bas du corps |
| Groupe musculaire principal | Fessiers |
| Muscles primaires | Moyen fessier |
| Muscles secondaires | Grand fessier, Petit fessier |
| Matériel | Mini-bande |
| Niveaux | Débutant, Intermédiaire, Avancé |

## Livrable

| Fichier | Rôle |
| --- | --- |
| `poster.webp` | Vignette statique (frame 2 — pas latéral, tension maximale de la bande). |
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
- [x] Poster = position clé du mouvement (pas latéral en tension).
- [x] Animation en boucle fluide (fondus 0,25 s), sans son, H.264 faststart.
- [x] Bande visible et tendue sur les 4 frames.
- [x] Données complètes dans `exercise.json`.
- [x] Enregistré dans le registre (`static/exercises/index.json`).
- [x] Anti-doublon : aucun équivalent dans la Exercise DB (`monster walk`
      importé = marche diagonale distincte, conservé).
