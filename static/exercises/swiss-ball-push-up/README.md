# Pompes mains sur Swiss Ball

> Exercice de la bibliothèque propriétaire **G-FLUX** — animé, validé et
> conforme au standard [`docs/exercise-db-standard.md`](../../../docs/exercise-db-standard.md).

## Identité

| | |
| --- | --- |
| Slug | `swiss-ball-push-up` |
| Nom (FR / EN) | Pompes mains sur Swiss Ball / Swiss Ball Push-up (Hands on Ball) |
| Catégorie | Haut du corps |
| Groupe musculaire principal | Pectoraux |
| Muscles primaires | Grand pectoral |
| Muscles secondaires | Triceps, Deltoïde antérieur, Abdominaux |
| Matériel | Swiss Ball |
| Niveaux | Débutant, Intermédiaire, Avancé |

## Livrable

| Fichier | Rôle |
| --- | --- |
| `animation.mp4` (180 Ko) | **Média canonique** — boucle **départ → fin → départ** (720×720, 2,8 s), affiché partout dans l'application. |
| `poster.webp` (27 Ko) | Vignette statique (position de fin, asset legacy optionnel). |
| `exercise.json` | Données structurées (exécution, cues, erreurs, respiration). |
| `source/` | Working files de production (grille 2 panneaux : départ à gauche, fin à droite). |

## État de validation

- **Statut** : validé ✅
- **Version du rendu** : v1 (standard 2 positions)
- **Personnage** : femme athlétique (standard G-FLUX) — cohérence de marque
  de toute la bibliothèque, indépendamment de l'Exercise DB importée.
- **Série** : Swiss Ball — stabilité et tronc (lot 3, sept. 2026).

## Contrôle qualité

- [x] 4 fichiers livrables présents, aucun fichier temporaire.
- [x] Source = 2 panneaux (départ à gauche, fin à droite), séparateur détecté
      et exclu — même échelle/cadrage entre les 2 frames.
- [x] Animation dans le bon sens (départ → fin → retour départ), sans inversion.
- [x] Boucle propre (dernière image = première), fondus progressifs, sans son.
- [x] Poster = position de fin (conservé pour les vignettes, hors pipeline).
- [x] Ballon visible et cohérent sur les 2 positions.
- [x] Données complètes dans `exercise.json`.
- [x] Enregistré dans le registre (`static/exercises/index.json`).
- [x] Anti-doublon : aucun blocage — variantes proches signalées en warning
      informatif seulement (politique sept. 2026 : signaler, jamais supprimer).
