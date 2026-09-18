# Exercices — bibliothèque G-FLUX

Chaque exercice vit dans son propre dossier `static/exercises/<slug>/` et suit
le même standard de production (visuel, données, livrable). Le standard
complet — structure, fichiers, art direction, template README — est documenté
dans **`docs/exercise-db-standard.md`**, c'est la référence à lire avant de
créer un nouvel exercice.

## Fichiers du livrable final

**OBLIGATOIRES** — `animation.mp4` est le média principal et canonique de
l'exercice : il est affiché directement dans la recherche, la bibliothèque
et la fiche détail (boucle silencieuse, « GIF premium »). `poster.webp` est
OPTIONNEL / legacy : les exercices produits avec un poster le conservent,
mais aucun nouvel exercice n'en a besoin et l'application n'en dépend pas.

```
static/exercises/<slug>/
├── animation.mp4     ← MÉDIA CANONIQUE (affiché partout)
├── exercise.json     ← données structurées de l'exercice
├── README.md         ← fiche de contrôle qualité
├── poster.webp       ← optionnel/legacy (vignette statique)
└── source/           ← working files de production (optionnel)
```

## Registre (Exercise DB)

Le registre du projet est **`static/exercises/index.json`** — un fichier
**généré**, jamais édité à la main. Chaque nouvel exercice est enregistré en
régénérant le registre :

```bash
npm run exercises            # valide chaque dossier + réécrit index.json
npm run exercises -- --check # validation seule (utile en CI / avant commit)
npm run exercises -- --report # diagnostic détaillé dossier par dossier
```

Le script refuse (exit 1) tout dossier non conforme : fichier temporaire
(`_check.html`, captures de contrôle…), variante vidéo multiple, livrable
manquant, `status: "validated"` approximatif, slug ≠ dossier.

## Intégration à l'application (bibliothèque unique)

Les exercices officiels G-FLUX sont poussés dans la **table Convex
`exercises` existante** (la même que les exercices importés), sous la source
**`gflux-official`** — aucune bibliothèque parallèle :

```bash
npm run exercises:sync              # registre → Exercise DB (auth coach)
npm run exercises:sync -- --check   # vérification sans écriture
```

Ils apparaissent alors automatiquement dans la bibliothèque du CRM, le
picker de l'éditeur de programmes et partout où la bibliothèque est
consommée (filtres « Fessiers », « Machine »… déjà branchés sur le même
vocabulaire FR). Workflow d'un nouvel exercice : `npm run exercises` puis
`npm run exercises:sync` — rien d'autre.

## Exercices de la bibliothèque

| Slug | Nom | Groupe principal | Statut |
| --- | --- | --- | --- |
| `machine-hip-thrust` | Hip Thrust à la machine | Fessiers | validé ✅ *(template maître)* |
