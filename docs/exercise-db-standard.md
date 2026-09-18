# Standard « Exercice G-FLUX » — bibliothèque propriétaire

> **Document de référence.** Toute création d'exercice pour la bibliothèque
> G-FLUX suit ce standard, sans exception. Il est dérivé du premier exercice
> validé : **Machine Hip Thrust** (`static/exercises/machine-hip-thrust/`),
> qui sert de template maître.
>
> ⚠️ **Direction artistique** : ne pas se baser sur la logique historique
> (majoritairement masculine) de l'Exercise DB importée. La bibliothèque
> G-FLUX a sa propre cohérence de marque.

---

> **RÈGLE MÉDIA (sept. 2026)** : `animation.mp4` est le média principal et
> canonique de tout exercice G-FLUX. Il est affiché directement dans la
> recherche, la bibliothèque, la fiche détail et partout où un aperçu média
> est nécessaire (lecture automatique, boucle, muet, « GIF premium »).
> `poster.webp` est un asset **OPTIONNEL / legacy** : l'application ne doit
> jamais en dépendre.

## 1. Structure finale idéale du dossier

```
static/exercises/<slug>/
├── animation.mp4      ← LIVRABLE · MÉDIA CANONIQUE (H.264, carré, boucle)
├── exercise.json      ← LIVRABLE · données structurées de l'exercice
├── README.md          ← LIVRABLE · fiche de contrôle qualité du dossier
├── poster.webp        ← OPTIONNEL · asset legacy (position clé, 720×720)
└── source/            ← WORKING · fichiers de production (optionnel)
    └── source.png
```

- Le **slug** est en kebab-case anglais, sans accent : `machine-hip-thrust`.
- Un dossier = un exercice = un seul fichier vidéo (`animation.mp4`).
- `source/` contient les working files de production (fichier de référence
  du rendu). Il reste dans le dépôt tant qu'il sert à régénérer le livrable.

## 2. Livrable final — 3 fichiers OBLIGATOIRES (+ optionnels)

| Fichier | Statut | Rôle |
| --- | --- | --- |
| `animation.mp4` | **OBLIGATOIRE** | MÉDIA CANONIQUE, affiché directement partout (recherche, bibliothèque, fiche). H.264, carré (720×720), lecture en boucle, silencieux. ~200 Ko par exercice. |
| `exercise.json` | **OBLIGATOIRE** | Données structurées : noms, muscles, matériel, niveau, exécution, cues, erreurs, respiration (voir §5). |
| `README.md` | **OBLIGATOIRE** | Fiche de contrôle qualité : ce que contient le dossier, état de validation, conformité au standard (voir §7 pour le template). |
| `poster.webp` | **OPTIONNEL** (legacy) | Vignette statique. Les exercices produits avec un poster le conservent (filet de sécurité si l'animation échoue), mais **aucun nouvel exercice n'en a besoin** — `animation.mp4` est le média affiché partout. |
| `source/` | **OPTIONNEL** (working) | Fichiers de production servant à régénérer le rendu. Ne fait pas partie du cœur du livrable. |
| `frames/` | **OPTIONNEL** (working) | Frames intermédiaires générées pendant la production. Peuvent être supprimées une fois l'animation finalisée — jamais livrées comme cœur du livrable. |
| `_check.html`, variantes vidéo (`animation.webm`, `animation-*.mp4`…), captures d'écran de contrôle | **INTERDIT dans le livrable** | Fichiers temporaires de contrôle/test. À supprimer **avant validation finale** du dossier. |

## 3. Direction artistique — cohérence de marque G-FLUX

- **Personnage par défaut** : femme athlétique, neutre et premium, cohérent
  avec la cible de l'application. Ne pas reprendre la logique historique de
  l'Exercise DB importée (majoritairement masculine).
- Style visuel constant d'un exercice à l'autre : même palette, même rendu
  3D/illustratif, même cadrage (carré), même environnement neutre.
- Un exercice = une seule animation officielle. Pas de variantes animées
  multiples : c'est le standard de marque G-FLUX.
- Le mouvement doit être lisible sans son : l'animation est affichée muette
  en boucle partout dans l'application.

## 4. Checklist avant validation d'un nouvel exercice

1. [ ] Le dossier contient les 3 livrables obligatoires : `animation.mp4`, `exercise.json`, `README.md` (+ `source/` si working files). `poster.webp` est optionnel.
2. [ ] Aucun fichier temporaire (`_check.html`, captures, variantes vidéo) ne traîne.
3. [ ] `exercise.json` respecte le schéma du §5, avec `status: "validated"`.
4. [ ] `animation.mp4` est en boucle fluide, cadrage carré, ~200 Ko.
5. [ ] `README.md` est rempli (template §7).
6. [ ] L'exercice est **enregistré dans le registre** : `npm run exercises` (voir §6).
7. [ ] L'exercice est **synchronisé dans la Exercise DB** : `npm run exercises:sync` (voir §6).
8. [ ] Commit : `static/exercises/<slug>/` + `static/exercises/index.json` régénéré.

## 5. Schéma `exercise.json`

```jsonc
{
  // Identité
  "slug": "machine-hip-thrust",          // kebab-case anglais, = nom du dossier
  "nameFr": "Hip Thrust à la machine",
  "nameEn": "Machine Hip Thrust",
  "category": "Bas du corps",            // classification G-FLUX (pas celle de l'Exercise DB importée)

  // Muscles
  "primaryMuscleGroup": "Fessiers",
  "primaryMuscles": ["Grand fessier"],
  "secondaryMuscles": ["Ischio-jambiers", "Quadriceps", "Adducteurs"],

  // Profil
  "equipment": ["Machine Hip Thrust"],
  "level": ["Débutant", "Intermédiaire", "Avancé"],

  // Contenu pédagogique
  "description": "...",                  // 1–2 phrases, tutoiement
  "execution": ["..."],                  // étapes numérotées, une action par étape
  "cues": ["..."],                       // repères courts et concrets
  "mistakes": ["..."],                   // erreurs classiques à éviter
  "breathing": { "eccentric": "...", "concentric": "..." },

  // Production (bloc standard, ajouté à chaque exercice)
  "status": "validated",                 // "draft" | "in-review" | "validated"
  "version": 1,                          // incrémenté à chaque régénération du rendu
  "assets": {
    "animation": "animation.mp4"         // media canonique — chemin relatif au dossier
    // "poster": "poster.webp"           // optionnel/legacy : listé SEULEMENT s'il existe
  },
  "artDirection": {
    "character": "female-athletic",      // standard G-FLUX (voir §3)
    "style": "gflux-premium"
  }
}
```

## 6. Registre / Exercise DB — enregistrement automatique

Le registre du projet est **`static/exercises/index.json`** : il est
**généré** à partir des `exercise.json` du dépôt — jamais édité à la main.
La règle : **chaque nouvel exercice est enregistré en régénérant le
registre** (aucun exercice ne peut exister dans le dossier sans y figurer).

```bash
npm run exercises   # scanne static/exercises/*/exercise.json, valide chaque
                    # dossier contre le standard et réécrit index.json
```

- Le script échoue (exit ≠ 0) si un dossier viole le standard : fichier
  interdit détecté, JSON invalide, `status: "validated"` sans livrables
  complets, slug ≠ nom du dossier.
- Utiliser `npm run exercises -- --report` pour un diagnostic détaillé.
- Les nouveautés apparaissent avec `"isNew": true` dans le registre
  (exercices jamais intégrés à l'application).

### Intégration à la Exercise DB de l'application (bibliothèque unique)

Le registre est la seule source des exercices officiels G-FLUX côté
application : ils sont poussés dans la **table Convex `exercises` existante**
(la même que les exercices importés), sous la source dédiée
**`gflux-official`** — jamais dans une bibliothèque parallèle :

```bash
npm run exercises:sync              # registre → Exercise DB (auth coach, upsert idempotent)
npm run exercises:sync -- --check   # vérifie l'alignement registre ↔ base (exit 1 si écart)
npm run exercises:sync -- --dry-run # aperçu de la conversion, aucun envoi
```

- Même modèle, même upsert (`source + sourceExerciseId` = slug), mêmes
  endpoints BFF : les exercices officiels apparaissent automatiquement dans
  la bibliothèque du CRM, le picker de l'éditeur de programmes et partout
  où la bibliothèque est consommée — sans interface dédiée.
- Idempotent : relancer sans risque (mise à jour au lieu de doublon).
- Un exercice retiré du registre (ou repassé en draft) est **désactivé**
  en base (jamais supprimé) : les programmes qui le référencent restent
  intacts.
- Workflow d'un nouvel exercice : `npm run exercises` puis
  `npm run exercises:sync` — aucune intervention manuelle.

## 7. Template `README.md` (à copier pour chaque nouvel exercice)

```markdown
# <NameFr>

> Exercice de la bibliothèque propriétaire **G-FLUX** — animé, validé et
> conforme au standard [`docs/exercise-db-standard.md`](../../../docs/exercise-db-standard.md).

## Identité

| | |
| --- | --- |
| Slug | `<slug>` |
| Nom (FR / EN) | <NameFr> / <NameEn> |
| Catégorie | <category> |
| Groupe musculaire principal | <primaryMuscleGroup> |
| Muscles primaires | <primaryMuscles> |
| Muscles secondaires | <secondaryMuscles> |
| Matériel | <equipment> |
| Niveaux | <level> |

## Livrable

| Fichier | Rôle |
| --- | --- |
| `animation.mp4` | **Média canonique** — affiché directement dans la recherche, la bibliothèque et la fiche. |
| `exercise.json` | Données structurées (exécution, cues, erreurs, respiration). |
<!-- Poster optionnel : ajouter « poster.webp | Vignette statique (asset legacy, optionnel). » si le dossier en contient un. -->
| `source/` | Working files de production (optionnel). |

## État de validation

- **Statut** : validé ✅
- **Version du rendu** : v<n>
- **Personnage** : femme athlétique (standard G-FLUX) — cohérence de marque
  de toute la bibliothèque, indépendamment de l'Exercise DB importée.

## Contrôle qualité

- [x] Livrables obligatoires présents (`animation.mp4`, `exercise.json`, `README.md`), aucun fichier temporaire.
- [x] Animation en boucle fluide, sans son.
- [x] Données complètes dans `exercise.json`.
- [x] Enregistré dans le registre (`static/exercises/index.json`).
```

## 8. Résumé du workflow « nouvel exercice »

1. Créer `static/exercises/<slug>/` avec les 3 livrables obligatoires
   (+ `source/`). Le poster n'est plus une étape obligatoire — l'animation
   MP4 est le média utilisé directement dans toute l'application.
2. Remplir `exercise.json` (schéma §5, `status: "draft"` tant que non validé).
3. Produire le rendu (personnage féminin athlétique, §3) → `animation.mp4`
   (média canonique), frames intermédiaires en working files si besoin.
   Poster optionnel/legacy uniquement si un besoin statique réel existe.
4. Contrôler le rendu (fichiers de check autorisés en **working**, mais
   supprimés avant validation finale).
5. Copier/adapter le template README (§7) → `README.md`.
6. Passer `status: "validated"` puis **`npm run exercises`** pour enregistrer
   l'exercice dans le registre, et **`npm run exercises:sync`** pour le
   pousser dans la Exercise DB de l'application (bibliothèque unique,
   sans interface parallèle).
7. Commit du dossier + du `index.json` régénéré.
