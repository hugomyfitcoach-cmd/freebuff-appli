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
| `poster.webp` | Vignette statique (position de fin = bras tendus, gainage). |
| `animation.mp4` | Animation officielle : boucle **départ → fin → départ** (720×720, 2,8 s). |
| `exercise.json` | Données structurées (exécution, cues, erreurs, respiration). |
| `source/` | Working files de production (grille 2 panneaux : départ à gauche, fin à droite). |

## État de validation

- **Statut** : validé ✅
- **Version du rendu** : v2 (standard 2 positions — remplace la v1 en 4 frames)
- **Personnage** : femme athlétique (standard G-FLUX) — cohérence de marque
  de toute la bibliothèque, indépendamment de l'Exercise DB importée.
- **Série** : mini-bandes — exercices à domicile (lot 1, 2026).

## Particularité de production

- L'**ancre murale** (point fixe de la bande) touche le bord droit du cadre
  dans la source validée : c'est voulu et pédagogique. L'extraction conserve
  l'ancre complète sur les 2 positions ; l'outil de QC remonte un warning
  documenté (bord droit non bloquant, contrairement aux autres bords).

## Contrôle qualité

- [x] 4 fichiers livrables présents, aucun fichier temporaire.
- [x] Source = 2 panneaux (départ à gauche, fin à droite), séparateur détecté
      et exclu — même échelle/cadrage entre les 2 frames.
- [x] Point d'ancrage conservé sur les 2 positions (warning documenté).
- [x] Animation dans le bon sens (départ → fin → retour départ), sans inversion.
- [x] Boucle propre (dernière image = première), fondus progressifs, sans son.
- [x] Poster = position de fin (conservé pour les vignettes, hors pipeline).
- [x] Données complètes dans `exercise.json`.
- [x] Enregistré dans le registre (`static/exercises/index.json`).
- [x] Anti-doublon : `band horizontal pallof press` (importé) = même mouvement ;
      version G-FLUX officielle = notre entrée, doublon importé masqué
      (réversible) lors du lot 1.
