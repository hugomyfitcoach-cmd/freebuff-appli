# Abduction de hanche assise avec mini-bande

> Exercice de la bibliothèque propriétaire **G-FLUX** — animé, validé et
> conforme au standard [`docs/exercise-db-standard.md`](../../../docs/exercise-db-standard.md).

## Identité

| | |
| --- | --- |
| Slug | `seated-mini-band-hip-abduction` |
| Nom (FR / EN) | Abduction de hanche assise avec mini-bande / Seated Hip Abduction with Mini Band |
| Catégorie | Bas du corps |
| Groupe musculaire principal | Fessiers |
| Muscles primaires | Moyen fessier |
| Muscles secondaires | Grand fessier, Petit fessier |
| Matériel | Mini-bande |
| Niveaux | Débutant, Intermédiaire, Avancé |

## Livrable

| Fichier | Rôle |
| --- | --- |
| `animation.mp4` | **Média canonique** — boucle départ → fin → départ (720×720, H.264, 2,8 s). |
| `poster.webp` | Vignette statique (asset optionnel/legacy = position de fin). |
| `exercise.json` | Données structurées (exécution, cues, erreurs, respiration). |
| `source/` | Working files de production (grille 2 panneaux : départ à gauche, fin à droite). |

## État de validation

- **Statut** : validé ✅
- **Version du rendu** : v1 (standard 2 positions)
- **Personnage** : femme athlétique (standard G-FLUX) — cohérence de marque
  de toute la bibliothèque, indépendamment de l'Exercise DB importée.
- **Série** : bandes — exercices à domicile (lot 2, 2026).

## Contrôle qualité

- [x] Livrables obligatoires présents, aucun fichier temporaire.
- [x] Source = 2 panneaux (départ à gauche, fin à droite), séparateur détecté
      et exclu — même échelle/cadrage entre les 2 frames.
- [x] Animation dans le bon sens (départ → fin → retour départ), boucle propre.
- [x] Bande visible et tendue sur les 2 positions.
- [x] Données complètes dans `exercise.json`.
- [x] Enregistré dans le registre (`static/exercises/index.json`).
- [x] Anti-doublon : `resistance band seated hip abduction` (+ variante « fast
      style », exercisedb-v1) = même mouvement avec le même outil — entrée
      officielle G-FLUX créée, doublons importés masqués réversiblement.
