# Plan de livraison — Assistant G-FLUX, Lot D

**Statut : plan uniquement.** Aucun service nutritionnel externe, SDK, secret, route réseau ni appel Open Food Facts/Ciqual supplémentaire n'est intégré dans ce lot. Lot D ne commence qu'après validation et revue des Lots A–C.

## Objectif

Étendre l'assistant avec une consultation nutritionnelle plus complète et explicable, sans en faire une source d'autorité clinique ni créer de nouvelles écritures implicites. Les sources actuelles de G-FLUX (journal, objectifs coach, plan actif, références Ciqual et fiches produit présentes en base) restent la seule base factuelle jusqu'à une décision produit distincte.

## Périmètre proposé

1. **Réponses de synthèse explicables** — agréger uniquement les données déjà exposées par les outils en lecture, indiquer période, jours renseignés et manquants, citer la provenance (« journal », « objectif coach », « référence Ciqual ») et ne pas inférer les jours absents comme zéro.
2. **Clarification avant calcul** — demander la période, la portion ou l'aliment exact lorsqu'ils manquent; refuser une résolution de fiche contradictoire ou une date ambiguë.
3. **Borne santé/sécurité** — conserver la détection de détresse, ne pas diagnostiquer, prescrire, proposer de compensation ou modifier les objectifs; escalader vers la coach ou un professionnel de santé selon le cas.
4. **Expérience de lecture** — présenter une réponse compacte, puis des détails repliables (source, période, limites), sans transformer les résultats en tâche ou en changement de plan.
5. **Observabilité minimisée** — métriques agrégées de disponibilité/latence et taux d'outils, sans texte de conversation, aliments personnels, identifiants de clientes ni données de santé dans les logs.

## Hors périmètre et portes de décision

- Pas de fournisseur/API nutritionnel externe dans cette livraison : aucune clé, compte, coût récurrent ou nouvelle licence de données.
- Pas de changement d'objectif, de plan coach, d'entraînement ni d'écriture au journal sans confirmation explicite dans le flux existant.
- Toute future source externe exige d'abord une recherche fournisseur (qualité/couverture France, prix, licence et réutilisation, RGPD/DPA, résidence/rétention, sécurité, disponibilité et sortie), une approbation produit et une revue juridique avant intégration.
- Pas de push, déploiement ou mutation de données Preview/Production dans le cadre de ce plan.

## Contrats et invariants techniques

- Les lectures passent par le registre fermé de l'assistant et des queries Convex en lecture seule, avec garde session/role/feature flag/billing et isolation par `userId` côté serveur.
- Les calculs restent déterministes et testables dans des fonctions pures; le modèle reformule, il n'invente ni chiffres ni références.
- Fenêtres temporelles dérivées du fuseau IANA du compte; dates ambiguës = clarification, pas de date devinée.
- Les valeurs manquantes restent `null`/absentes avec une couverture explicite; aucune moyenne ne divise par les jours vides.
- Aucun log de contenu utilisateur. Toute instrumentation est échantillonnée, agrégée et contrôlée par flag Preview.

## Étapes de réalisation

1. **Spécifier** — exemples de questions autorisées, contrat de sortie et cas « données insuffisantes »; revue coach + sécurité.
2. **Modéliser** — types de synthèse et fonctions pures, sans nouvelle source ni schéma si possible.
3. **Outiller** — une ou plusieurs queries de lecture étroitement bornées; registre documente sources, limites et garde-fous.
4. **Présenter** — composants accessibles, provenance visible, distinction « constat » / « hypothèse » / « question pour Hugo ».
5. **Vérifier** — tests unitaires des agrégats, tests de registre et de politique, tests multi-fuseaux, isolation de comptes et non-régression UI; checks build/types.
6. **Revoir la Preview** — seulement après autorisation explicite, avec données de test synthétiques, vérification de l'identité de déploiement et zéro mutation de Production.

## Critères d'acceptation

- Chaque nombre affiché peut être reproduit à partir d'une query et d'une fonction déterministe identifiées.
- Les réponses indiquent période et couverture; absence de donnée n'est jamais transformée en zéro.
- Aucune écriture métier, transmission au coach ou promesse de transmission à la suite d'une simple question.
- Les contrôles de détresse et les interdictions santé restent actifs.
- Aucun fournisseur externe, secret, nouveau coût ou transfert de données n'est ajouté sans décision distincte.
- Suite tests + typecheck + build réussis; différences relues; aucun push ni déploiement sans autorisation.

## Risques à traiter en revue

- L'assistant pourrait faire passer une corrélation temporelle pour une explication causale.
- Des données anciennes, partielles ou modifiées par une coach peuvent rendre une synthèse trompeuse; chaque sortie doit rappeler sa date de mise à jour.
- L'extension du contexte peut augmenter le coût/taille des prompts; limiter la fenêtre et les champs au minimum nécessaire.
- Les affirmations de santé dépassent le coaching nutritionnel; garder des formulations factuelles et une escalade humaine.

## Décisions requises avant implémentation

1. Quelles synthèses nutritionnelles sont prioritaires (jour, semaine ou comparaison de période) ?
2. Quelle couverture minimale doit être atteinte avant d'afficher une moyenne ?
3. La provenance doit-elle apparaître directement dans la réponse ou dans un détail repliable ?
4. Toute source nutritionnelle tierce constitue une décision produit/juridique séparée, après analyse dédiée.

## Découpage de lots et estimation de travail

| Sous-lot | Livrable | Estimation | Gate |
|---|---|---:|---|
| D0 — cadrage | Questions autorisées/interdites, seuil de couverture, exemples coach validés | 0,5 j | Accord produit + coach |
| D1 — données | Contrat de synthèse readonly + agrégateur pur basé sur les données G-FLUX existantes | 1 j | Tests exacts des sommes, moyennes, périodes et absences |
| D2 — outils | Query bornée dans le registre fermé, contexte minimal, limites explicites | 0,5–1 j | Revue sécurité/isolation/fact-check |
| D3 — UI | Réponse concise, provenance et détail accessible sur mobile | 0,5–1 j | Revue accessibilité + UX |
| D4 — vérification | Suite, typecheck, build, scénarios Preview synthétiques si autorisés | 0,5–1 j | Identité Preview prouvée, aucune opération Prod |

Ces estimations sont indicatives, hors attente d'approbation, et ne comprennent pas l'intégration d'un fournisseur externe. L'ajout d'une source tierce ferait l'objet d'un sous-projet séparé avec budget, licence, confidentialité et validation de sécurité.

## Matrice minimale de validation

| Cas | Résultat exigé |
|---|---|
| Aucun repas sur la période | Réponse « aucune donnée »; jamais 0 kcal/jour |
| Une journée renseignée sur sept | Total factuel et couverture 1/7; pas de moyenne présentée comme représentative |
| Journée partielle | Statut partiel explicite; règles de couverture appliquées avant toute moyenne |
| Fuseau au passage de minuit / DST | Jour local correct et reproductible |
| Aliment homonyme ou variante distincte | Demande de précision, aucune substitution silencieuse |
| Question de diagnostic/compensation | Refus du conseil prescriptif, réponse sûre et escalade appropriée |
| Question sur un objectif ou plan coach | Lecture seule; aucune mutation ni recommandation de modification autonome |
| Cliente A demande les données de B | Requête refuse/ignore l'identifiant client transmis; seules les données de la session A sont accessibles |
| Fournisseur externe proposé | Pas d'appel ni de transfert avant décision formelle et revue dédiée |

## Plan de retour arrière

Le lot doit rester additif et derrière un flag serveur. En cas d'anomalie, le kill switch désactive le nouvel outil ou la nouvelle présentation sans supprimer les données historiques, changer les objectifs, ni altérer les outils du Journal. Les nouvelles fonctions de synthèse ne doivent créer aucune table, action planifiée ou écriture métier. Toute nouvelle donnée persistée nécessiterait un plan distinct de migration/rétention/suppression et ne fait pas partie de ce Lot D.
