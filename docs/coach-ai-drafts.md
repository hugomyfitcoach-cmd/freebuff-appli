# Brouillons de retours de bilan — conception (release 2026-10-b)

*Conception en lecture seule : aucun code applicatif, aucune écriture Convex, aucune donnée cliente réelle consultée. Code cité : `main` (PR #20 fusionnée) et branche de la PR #16, lue sans modification.*

**Promesse** : pour chaque bilan hebdo, un bouton **« Préparer un brouillon »** remplit le champ de retour avec une proposition dans le style de Hugo. Il relit, modifie, puis **enregistre en brouillon ou publie lui-même**. Aucun envoi automatique, aucun effet côté cliente avant publication.

## 0. Décisions de conception (validées pour M0)

1. **Exemples de style — Preview et Production** : uniquement **un fichier de retours sélectionnés et anonymisés par Hugo**, plus **l'historique de la même cliente**. Aucun corpus global issu des autres clientes, dans aucun environnement. L'environnement ne change que le mode de chargement, jamais la règle de sélection.
2. **Trois sources dans le prompt** : (a) le guide de style, (b) le référentiel de méthode (`methode-gflux.md`, fourni par Hugo — fichier provisoire de démonstration en attendant), (c) les exemples (fichier sélectionné + historique de la même cliente).
3. **Fournisseur générique** : un seul module, réutilisable par d'autres fonctionnalités IA (analyse de repas, analyses à la demande M6). Fournisseur et modèle réglables **par fonctionnalité** (`AI_PROVIDER_COACH_DRAFT`, `AI_MODEL_COACH_DRAFT`). Le module vit côté Convex (`src/convex/ai/provider.ts`), importable par une action Convex, et lit `process.env` — **jamais `$env` SvelteKit**.
4. **Longueur du brouillon** : paramètre explicite (`COACH_DRAFT_TARGET_WORDS`, défaut 150 mots). La valeur sera calée plus tard sur les vrais retours de Hugo ; elle ne doit pas être codée en dur dans le prompt.
5. **Mission M6** : analyses à la demande depuis la fiche cliente (« Analyser sa semaine », « Points de blocage actuels »), même moteur, lecture seule, sans chat libre.

## 1. Données disponibles par bilan

| Donnée | Source existante | Usage |
|---|---|---|
| Réponses | `checkins.answers` (`answersValidator` : motivation, adhérence, faim, hydratation, digestion, pas, cycle, évolution, victoire, `point_retour`…) | Faits déclarés |
| Semaine | `checkins.weekStart` (lundi ISO), `weekLabel` | Repère temporel |
| Stats de la semaine | `src/lib/vision360.ts` : `visionWindow`, `foodAverages`, `weightVision`, `stepsAverages`, `sportVision`, `mensurationsVision` | **Chiffres calculés par le code** |
| Historique cliente | `coach.checkinsFor` (tri desc, coach) | Bilans + retours passés |
| File CRM | `coach.bilansBoard` | Retrouver le bilan |

Réutiliser : `coach.checkinsFor`, `checkins.myCheckins`, `coach.setFeedback` (seule écriture du retour), `helpers.formatWeekLabel`, helpers `vision360.ts`.

**Piège vérifié** : `coach.client360` ancre son cockpit sur `checkins[0]`, le bilan le plus récent — inutilisable pour une semaine ancienne. La génération recalcule la semaine ciblée via une query interne (`coachDraft.loadContext`) réutilisant les mêmes fonctions pures (7 jours du bilan, + 7 jours précédents pour les deltas).

## 2. Historique des retours : où, exploitable ?

- **Stockage** : `checkins.feedback` (texte), `feedbackAt` (publication), `feedbackReadAt` (lecture), `status` (`nouveau` | `retour_envoye`). Un seul texte par bilan, sans versions.
- **Exploitable comme style ?** Oui, avec deux filtres : ne garder que `status === "retour_envoye"` (un brouillon n'est pas un exemple de ton envoyé) ; nettoyer côté serveur le **prénom d'une autre cliente** (`[prénom]`), les e-mails et téléphones avant tout envoi.
- Volume suffisant pour 2–5 exemples par prompt, sans embeddings en V1.

## 3. Réutilisable depuis la PR #16 (lecture seule)

| Élément | Fichier | Réutilisation |
|---|---|---|
| Appel OpenAI + coûts | `src/lib/server/assistantAi.ts` | Chat Completions, `AbortSignal.timeout`, `max_tokens`, température, agrégation tokens/coût, erreurs métier sans stack |
| Garde-fous | `src/lib/assistant/policy.ts` | Kill switch `ASSISTANT_DISABLED`, quotas par env, `safetyScreen` déterministe, prompt interdisant diagnostics et restrictions |
| Traçabilité | `src/convex/aiLog.ts`, `aiUsageLog` | Modèle, tokens, durée, coût — **jamais** prompt ni texte |
| Motif d'appel | action Convex `assistant.send` derrière une route BFF mince | Même couloir, clé jamais côté navigateur |

La PR #16 est **non fusionnée** (fermée sans merge lors de la dernière vérification ; branche `feat/assistant-gflux-v1` conservée) : on ne l'importe pas et on ne la modifie pas. On reprend les motifs quand ils seront disponibles sur `main`. Différence assumée : un seul appel texte, sans boucle d'outils ni conversation.

## 4. Architecture proposée

```
BilanCard.svelte ──POST /api/coach/draft──► route BFF (requireRole coach)
                                                ▼
                                action Convex coachDraft.generate
                                  ├─ coachDraft.loadContext (auth + données + stats)
                                  ├─ coachDraftPrompt.ts (prompt pur, testable)
                                  ├─ ai/provider.ts (SEUL fournisseur générique)
                                  └─ aiLog.record (usage, sans données perso)
                                                │ texte brut
                          textarea (relu/modifié) → coach.setFeedback
```

- **Fournisseur générique unique** : `src/convex/ai/provider.ts`, exposant `generateText({ feature, system, prompt, maxTokens }): Promise<{ text, usage }>`. Une seule implémentation `fetch` (OpenAI/Anthropic), sans SDK. La fonctionnalité choisit son couple via `AI_PROVIDER_<FEATURE>` / `AI_MODEL_<FEATURE>` — pour le coach : `AI_PROVIDER_COACH_DRAFT`, `AI_MODEL_COACH_DRAFT`. Aucune autre couche ne connaît le fournisseur. Le module est côté Convex et lit `process.env` (jamais `$env` SvelteKit).
- **Prompt** (`src/convex/coachDraftPrompt.ts`, module pur) : (1) guide de style, (2) référentiel de méthode, (3) exemples (fichier sélectionné + historique de la même cliente), (4) faits de la semaine en lignes `libellé : valeur` **déjà formatées par le code**, (5) consignes : français, tutoiement, longueur paramétrée, pas de diagnostic ni de promesse, **interdiction de calculer et d'inventer**. Les chiffres sont des faits vérifiés ; le prompt ne contient aucune formule. Sortie texte brut, 1 appel, `max_tokens` ≈ 400.
- **Longueur** : `COACH_DRAFT_TARGET_WORDS` (défaut 150), passé au prompt builder. Calibration ultérieure sur les retours réels de Hugo, sans changement de code.
- **Sélection des exemples** : (a) fichier de retours sélectionnés/anonymisés par Hugo (commun Preview/Production) ; (b) **2 derniers retours publiés de la même cliente** (`status === "retour_envoye"`), lus par `coachDraft.loadContext`. Pas de corpus global, pas d'embeddings.

## 5. Exemples de style : Preview et Production

| Source | Détail | Preview | Production |
|---|---|---|---|
| **Fichier de retours sélectionnés** | `src/lib/data/coach-feedback-examples.json` — retours anonymisés par Hugo, aucune donnée réelle | Oui | Oui |
| **Historique de la même cliente** | 2 derniers retours publiés, chargés par `coachDraft.loadContext` | Oui | Oui |
| Corpus global (autres clientes) | **Interdit** | Non | Non |

Un seul module `coachDraftExamples.ts` expose ces deux sources ; l'environnement ne change ni la sélection, ni le prompt, ni l'UI.

## 6. Confidentialité

- **Envoyé** : prénom seul, libellé de semaine, réponses (dont textes libres nécessaires), chiffres calculés, extraits de retours anonymisés.
- **Jamais envoyé** : nom, e-mail, `userId`/`_id`, date de naissance, photos, médias, lecture, identifiants Stripe/Google. Nettoyage e-mails/téléphones/prénoms connus avant appel.
- **Fournisseur** : `store: false` explicite côté OpenAI (indispensable avec l'API Responses, stockage actif par défaut) ; API non entraînée sur les données par défaut ; rétention « abuse monitoring » jusqu'à 30 jours, ZDR sur demande. Anthropic : pas d'entraînement par défaut, rétention 30 jours, ZDR possible — à confirmer contractuellement.
- **App** : aucun log de prompt/réponse ; `aiUsageLog` ne stocke que modèle, tokens, durée, coût. Texte persisté seulement si Hugo sauvegarde le brouillon.

## 7. Interface CRM

Dans `BilanCard.svelte`, au-dessus du textarea :
1. Bouton **« Préparer un brouillon »**. Si du texte existe → confirmation de remplacement.
2. Pendant l'appel : bouton désactivé « Préparation… » (timeout 40 s, erreur sobre, texte existant préservé).
3. Texte injecté dans le textarea, **modifiable**, badge « Brouillon IA — à relire ».
4. **« Régénérer »** après la première génération (nouvel appel facturé, quota 20/jour).
5. Les boutons existants « Sauvegarder le brouillon » / « Publier le retour » restent **les seuls** à écrire. Aucun événement cliente, push ou badge : la génération ne touche pas `checkins`.

## 8. Coût

Hypothèse : ~2 000 tokens d'entrée, ~350 de sortie, 240 brouillons/mois.

| Modèle | $/M entrée–sortie | $/brouillon | $/mois |
|---|---|---|---|
| `gpt-4o-mini` | 0,15 – 0,60 | ~0,0005 | **~0,12 $** |
| `gpt-4.1-mini` | 0,40 – 1,60 | ~0,0014 | ~0,33 $ |
| `gpt-4o` | 2,50 – 10 | ~0,0085 | ~2,04 $ |
| Claude Haiku 4.5 | 1 – 5 | ~0,0038 | ~0,90 $ |
| Claude Sonnet 5.5 | 2 – 10 | ~0,0075 | ~1,80 $ |

Avec 50 % de régénérations, majorer de 50 % (gpt-4o-mini ≈ **0,18 $/mois**). Tarifs publics à revérifier ; le coût réel est journalisé dans `aiUsageLog`.

## 9. Découpage en missions

| # | Mission | Livrable | IA ? |
|---|---|---|---|
| M0 | Contexte et prompt | `coachDraft.loadContext` (stats de la semaine ciblée) + `coachDraftPrompt` + tests dorés | Non |
| M1 | Plomberie | Provider `fake`, route BFF, bouton, textarea | Non |
| M2 | OpenAI Preview | Vrai appel, exemples fichier, quota, kill switch, aucune persistance | Oui |
| M3 | Style et historique | Fichier sélectionné + 2 derniers retours de la même cliente, anonymisation, régénération, journal d'usage | Oui |
| M4 | Qualité | Anthropic, comparaison sur 20 bilans relus par Hugo, calibration du guide | Oui |
| M5 | Production | Revue privacy/coûts, activation progressive, monitoring | Oui |
| M6 | Analyses à la demande | Depuis la fiche cliente : **« Analyser sa semaine »**, **« Points de blocage actuels »**. Même moteur de contexte + prompt, **lecture seule**, aucun chat libre, aucune écriture. | Oui (v1.1) |

M0–M2 rendent le brouillon utilisable ; M3 apporte le style ; M4–M5 sécurisent la production ; M6 étend le même moteur à des analyses ponctuelles, sans conversation.

## 10. État M0 (livré)

- `src/convex/coachDraft.ts` : query interne `loadContext` (coach uniquement) — réponses, semaine, statistiques de la semaine du bilan et de la semaine précédente via `src/lib/vision360.ts`, 2 derniers retours publiés de la même cliente. Résultat sans identifiant, e-mail ni nom de famille : **prénom seul**.
- `src/convex/coachDraftPrompt.ts` : module pur, sources injectées, chiffres pré-formatés, longueur paramétrée, interdiction de calculer/inventer.
- Fichiers provisoires : guide de style, `methode-gflux.md`, 3 retours fictifs.
- Tests dorés : 3 bilans fictifs (progrès, stagnation, alerte fatigue) → prompts figés. Aucune interface, aucun appel IA, aucune écriture Convex.

## 11. État M1 (livré)

- `src/convex/ai/provider.ts` : fonction unique `generateText({ feature, system, prompt, maxTokens })`. Fournisseur et modèle par fonctionnalité via `AI_PROVIDER_COACH_DRAFT` / `AI_MODEL_COACH_DRAFT`. Seul `fake` est implémenté : texte déterministe (prénom, semaine), court délai simulé, coût 0, aucune requête réseau. `openai` et `anthropic` refusent explicitement tant que M2/M4 ne les implémentent pas (jamais de repli silencieux sur `fake`).
- `src/convex/coachDraft.ts` : action `generate` (session coach re-vérifiée, `loadContext` → `buildCoachDraftPrompt` → `generateText`, retourne le texte seul) et query `status` (kill switch pour l'interface). Aucune écriture, aucun événement, push ni badge ; `coach.setFeedback` reste la seule écriture du retour.
- `src/routes/api/coach/draft/+server.ts` : route BFF `POST /api/coach/draft`, `requireRole coach`, timeout 40 s, erreurs sobres et génériques, refus si le kill switch est actif.
- `BilanCard.svelte` : bouton « Préparer un brouillon » (confirmation si le champ contient déjà du texte), « Préparation… » pendant l'appel, injection modifiable avec badge « Brouillon IA — à relire », « Régénérer », texte conservé en cas d'erreur. Les boutons de sauvegarde/publication existants restent les seuls à écrire.
- Arrêt d'urgence : `AI_COACH_DRAFT_DISABLED` (1/true/yes/on) lu côté Convex — le bouton disparaît et la route refuse l'appel, sans redéploiement.
- Le fichier d'exemples sélectionnés par Hugo rejoint le prompt en M3 ; M1 utilise l'historique de la même cliente déjà fourni par `loadContext`.

## 12. État M4-1 (livré) — règles de style du coach (retour de Hugo)

- `docs/guide-style-retours.md` : section **« Règles prioritaires »** en tête du guide (4 à 6 phrases en 2 courts paragraphes, verdict dès la première phrase, chiffres arrondis, silence sur les jours non renseignés quand la tendance baisse ou les mensurations baissent, décision claire toujours, aucun « focus » imposé quand tout va bien, clôture courte « Passe un bon dimanche :) ») + **exemple de référence de Hugo au mot près**. Ces règles priment sur le reste du guide et sur les habitudes du corpus.
- `src/lib/data/coachDraftStyleGuide.ts` : copie serveur régénérée par `scripts/gen-guide-style.mjs` — le .md reste la source unique.
- `src/convex/coachDraftPrompt.ts` : **arrondis avant envoi** (kcal à la dizaine, protéines au gramme, poids à la centaine de grammes, pas à la centaine) ; le modèle n'a plus le droit de calculer ni d'arrondir. Consignes de rédaction alignées sur les règles prioritaires.
- `src/convex/coachDraft.ts` : `weightTrendFacts` — **tendance de poids indépendante des fenêtres hebdomadaires** : écart entre les deux dernières pesées (toutes dates) et poids moyen du bilan précédent. Chaque absence reste `null` (« indisponible » au prompt), jamais un zéro inventé.
- `src/lib/server/openai.ts` : **régularité** — température basse `COACH_DRAFT_TEMPERATURE = 0.3` transmise au fournisseur ; si le modèle refuse le réglage, réessai sans température (valeur par défaut, la plus proche acceptée), jamais de repli sur un autre modèle.
- `BilanCard.svelte` : indicateur « Préparation du brouillon… » sur le bouton désactivé, `aria-busy`, couvrant tout l'appel (`finally`).
- Tests : `tests/mission-coach-draft-m4-1.test.mjs` (12 tests, aucun réseau, aucune écriture Convex) ; tests dorés et `mission-coach-draft-m1` alignés.

> Remarque : les états M2 et M3 (vrai appel OpenAI, fichier d'exemples, badge persisté, dernière date d'appel) ne sont pas encore consignés dans ce document.
