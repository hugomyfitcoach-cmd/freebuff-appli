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
| `poster.webp` | Vignette statique (position de fin du mouvement). |
| `animation.mp4` | Animation officielle : boucle **départ → fin → départ** (720×720, 2,8 s). |
| `exercise.json` | Données structurées (exécution, cues, erreurs, respiration). |
| `source/` | Working files de production (grille 2 panneaux : départ à gauche, fin à droite). |

## État de validation

- **Statut** : validé ✅
- **Version du rendu** : v2 (standard 2 positions — remplace la v1 en 4 frames)
- **Personnage** : femme athlétique (standard G-FLUX) — cohérence de marque
  de toute la bibliothèque, indépendamment de l'Exercise DB importée.
- **Série** : mini-bandes — exercices à domicile (lot 1, 2026).

## Contrôle qualité

- [x] 4 fichiers livrables présents, aucun fichier temporaire.
- [x] Source = 2 panneaux (départ à gauche, fin à droite), séparateur détecté
      et exclu — même échelle/cadrage entre les 2 frames.
- [x] Animation dans le bon sens (départ → fin → retour départ), sans inversion.
- [x] Boucle propre (dernière image = première), fondus progressifs, sans son.
- [x] Poster = position de fin (conservé pour les vignettes, hors pipeline).
- [x] Bande visible et tendue sur les 2 positions.
- [x] Données complètes dans `exercise.json`.
- [x] Enregistré dans le registre (`static/exercises/index.json`).
- [x] Anti-doublon : aucun équivalent dans la Exercise DB (`monster walk`
      importé = marche diagonale distincte, conservé).
