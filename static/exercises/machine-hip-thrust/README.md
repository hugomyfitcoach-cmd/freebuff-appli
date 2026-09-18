# Hip Thrust à la machine

> Exercice de la bibliothèque propriétaire **G-FLUX** — animé, validé et
> conforme au standard [`docs/exercise-db-standard.md`](../../../docs/exercise-db-standard.md).
> **Premier exercice de la bibliothèque : il sert de template maître pour
> tous les prochains.**

## Identité

| | |
| --- | --- |
| Slug | `machine-hip-thrust` |
| Nom (FR / EN) | Hip Thrust à la machine / Machine Hip Thrust |
| Catégorie | Bas du corps |
| Groupe musculaire principal | Fessiers |
| Muscles primaires | Grand fessier |
| Muscles secondaires | Ischio-jambiers, Quadriceps, Adducteurs |
| Matériel | Machine Hip Thrust |
| Niveaux | Débutant, Intermédiaire, Avancé |

## Livrable

| Fichier | Rôle |
| --- | --- |
| `animation.mp4` | **Média canonique** (720×720, boucle) — affiché directement dans la recherche, la bibliothèque et la fiche. |
| `exercise.json` | Données structurées (exécution, cues, erreurs, respiration). |
| `poster.webp` | Vignette statique (position haute = contraction des fessiers) — asset optionnel/legacy conservé. |
| `source/` | Working files de production (optionnel — source du rendu). |

## État de validation

- **Statut** : validé ✅
- **Version du rendu** : v1
- **Personnage** : femme athlétique (standard G-FLUX) — cohérence de marque
  de toute la bibliothèque, indépendamment de l'Exercise DB importée.

## Contrôle qualité

- [x] Livrables obligatoires présents (`animation.mp4`, `exercise.json`, `README.md`), aucun fichier temporaire.
- [x] Poster legacy = position clé du mouvement (contraction en haut) — asset optionnel conservé.
- [x] Animation en boucle fluide, sans son.
- [x] Données complètes dans `exercise.json`.
- [x] Enregistré dans le registre (`static/exercises/index.json`).
