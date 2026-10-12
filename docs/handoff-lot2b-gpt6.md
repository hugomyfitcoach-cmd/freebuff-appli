# Passage de relais — Assistant IA G-FLUX (Lot 2B) · GLM Flash → GPT-6 Luna

*Généré le 2026-10-09, fin de session GLM Flash. STOP respecté : aucun
nouveau développement, aucun merge, aucun force-push, Convex Production
intouchée, PR #18 (scanner) non sollicitée.*

---

## 1. État exact du projet

| Élément | Valeur vérifiée |
|---|---|
| Branche | `feat/assistant-gflux-v1` (worktree `d3cd6bf0-98bb-44ae-9c07-820c20e2c828`) |
| PR | #16 (Deploy Preview `https://deploy-preview-16--g-flux.netlify.app`) |
| Dernier commit | `e371b7e` — « Lot 2B : qualifierifs distinctifs — les varietes ne se substituent plus » |
| Local == Origin | **Oui** (`git rev-parse origin/feat/assistant-gflux-v1` = `e371b7e`) |
| Modifications non commitées | **Aucune** — working tree propre (aucun `git status` entrée) |
| SHA déployé Netlify Preview #16 | Confirme `e371b7e` (diagnostic endpoint + check `node /tmp/checks.mjs e371b7e`) |
| Convex attaché | `joyous-tortoise-596.eu-west-1.convex.cloud` (Preview, `isProdLike: false`) — **recréé à chaque build** |
| Supports | `npm test` 620/620 ✓ · `npm run check` 0 erreur ✓ · `npm run build` exit 0 ✓ |
| Écritures outils réelles | `toolErrors` tracé dans le diagnostic (preview seulement) |

### Commits clés de cette session (chronologie)

```
e371b7e      qualifierifs distinctifs (blanc/complet, demi/ecreme) — varietes ne se substituent plus
578a067      idem
6a8643d      noyau aliment partagé dans nameCovers
d79165b      le retry generique re-couvre TOUJOURS la demande complete
122cb69      recherche generique Ciqual retente sur la demande tronquée
9b70483      valeurs nutritionnelles recitees du modele retirees des items
07dc8de      qualificatifs d'origine ignores (fruit de la passion de Tahiti)
0ce1ba3      IDs Convex fabriques neutralisés (resolveRef try/catch) + relance prepare 2 rounds
05ea829      détour update (prepare refuse sur tour court si action pending)
f088fed      quotas Assistant compte beta reset au re-seed
c32b275      ref. incohérente jetée + re-resolution par Nom ; fil frais par scenario E2E
4b3e0ac      recouvrement SOME (1 mot) au lieu de EVERY
0b4aeb0      fidélité serveur : items hors demande filtrés avant écriture
681b37b      trace toolErrors (diagnostic preview)
8aafab7      tier 3 Ciqual + fusion serveur ajoute l'aliment clarifié
... (précédés des livraisons Lot 2B antérieures)
```

---

## 2. Bilan fonctionnel

### 2.1. Corrigés (grace au diagnostic `toolErrors`)

Pour chaque bug du document mission, l'état est :

| Bug | État | Mécanisme du fix |
|---|---|---|
| §3 Actions réapparaissant | **Corrigé** | Détour update (`prepareJournalEntry` refuse sur tour court si action pending) + cycle de vie stricte (`resolveAction` ne réactrive jamais) |
| §4 Annonce sans action | **Corrigé** | Relance prepare 2 rounds ( miscar d'outils → retry), pattern `ANNOUNCE_WITHOUT_TOOL_RE` étendu ; toolErrors tracent tout échec |
| §5 Aliments non demandés | **Corrigé** | Filet de fidélité serveur (recouvrement minimum 1 mot, `refineMatch` pour classification), recitations retirées, `refineMatch + nameCovers` exige le noyau aliment |
| §6 Doublons | **Corrigé** | Détection doublon mesuré + refused mesuré (vérifié en E2E C6 : « déjà enregistré », pas d'écriture) |
| §7 Fiabilité calories/macros | **Corrigé** | Toute valeur nutritionnel récité par le modèle est **retirée des items** avant préparation (fix 9b70483). Serveur seul calcule depuis Ciqual/ANSES |
| §8 Cohérence conversationnelle | **Corrigé** | Multi-jours indicatif (jamais prétendu enregistré), patterns announcements étendus |
| §9 Tests E2E 20 scénarios | **20/21 PASS** | Batterie `tests/e2e-lot2b-scenarios.mjs` avec **fil frais par scénario** (`{ newThread: true }`) |
| §10 Architecture | | Corrigé, jamais reconstruit — fixes serveur ciblés |
| §11 Sécurité | **Intacte** | Convex preview隔离 : `joyous-tortoise-596` (recréé à chaque build), `isProdLike: false`. Productionoque `calm-jaguar-475` jamais ciblé. `requireAssistantClient` + isolation userId partout |

### 2.2. Bugs encore présents / intermittents

**Pass2 20/21 (2026-10-09, session en cours)** — 1 échec :

- **C8** « après clarifications : les 2 aliments fidèles, lait corrigé » —
  la preview lit `["Lait écrémé, pasteurisé"]` au lieu des 2 lignes
  attendues. Cause probable (non 100% confirmée) : le modèle appelle
  `updateJournalEntry` avec LE SEUL lait de la ligne corrigée ; le détour
  update (05ea829) exige puis refuse prepare — mais le LAIT est alors
  le SEUL aliment de la preview qui remplace la preview de 2 lignes.
  Parmi les pistes : 1) error renvoyée par `updateJournalEntry` quand un
  item ne recouvre PAS une ligne existante (pas d'ajout brut prévu ?), la
  preview serait alors écrasée par la nouvelle. 2) le `update` doit être
  CAS cautionné quand il ne couvre pas la ligne existante.

**Pass1 21/21 ✓** (2026-10-09, session en cours).

Les toolErrors ne montrent **plus** de crash (aucune erreur non catchée) ;
l'erreur « Aliment introuvable en base : « beignet d elfe » » est le A6
scénario (comportement attendu = refus, pas un bug).

### 2.3. Tests

| Test | Dernier résultat |
|---|---|
| `npm test` | **620/620 pass** (session en cours) |
| `npm run check` | **0 erreur** |
| `npm run build` | **exit 0** |
| E2E pass1 | **21/21 PASS** |
| E2E pass2 | **20/21 PASS** (C8 lacte écrasé) |
| toolErrors | Plus d'erreur non-catchée (`beignet d elfe` = refus attendu A6) |

### 2.4. Isolation

- Convex preview `joyous-tortoise-596` (recréé à chaque build Netlify) —
  production `calm-jaguar-475` **jamai ciblé** (`scripts/deploy.mjs` exige
  une clé `prod:` uniquement pour la production ; build-preview refuse tout
  lien prod depuis une preview).
- Seed : `previewSeed.ts` (bêta contact@myfit-coach.fr + reset quotas à
  chaque re-seed diag POST) + `previewSeedAssistant.ts` (Sophie Martin).
- Données réelles des clientes jamais touchées.
- PR #18 scanner : jamais sollicitée.
- Production Netlify : jamais déployée.

---

## 3. Reprise du développement

### 3.1. Anomalie restante (20/21)

- **Fichier**: `src/convex/assistantTools.ts` — mutation `updatePendingJournalEntry`.
- **Symptôme** : mise à jour d'une preview AVEC 2 lignesANTS (avoine + lait
  demi-écrémé) produit une preview contenant UNIQUEMENT la ligne corrigée
  (« Lait écrémé, pasteurisé ») — les autres lignes SONT LOST.
- **Cause hypothétique (implémentée, pas confirmée)** : le modèle appelle
  update avec des items qui ne recouvrent AUCUNE ligne existante (car la
  ligne existante « Lait demi-écrémé » n'est PAS raffinée par « Lait
  écrémé » depuis le fix des qualificatifs distinctifs — correctement !
  L'ancienne ligne devrait rester) et la logique de fusion en `taken`
  (l.1012+) ne la garde que si `taken.length < current.length` ...
  Le programme de vérification recommandé est de tracer `changed` dans le
  toolErrors et compte de lignes current avant/après la fusion.
- **Piste de correction prioritaire** : dans `updatePendingJournalEntry`,
  si un item de clarification ne recouvre AUCUNE ligne existante, il est
  ADDITIONNÉ (correct selon B5). MAIS si un item remplacant recouvre la
  ligne existante AVEC un qualificatif distinctif opposé (demi-écrémé →
  écrémé), `refineMatch` peut échouer (par design) → l'item est ajouté
  comme NOUVEAU et **l'ancien lait demi-écrémé devrait rester**. Vérifier
  pourquoi `current` final ne contient que la ligne corrigée.
- **Hypothèse la plus probable** : le modèle **s'est dégenre et appelle
  `prepareJournalEntry` au lieu de `updateJournalEntry`** après le refus
  B2/B5, et prepare a passé les 2 lignes... Vous POUVEZ le confirmer via
  `toolErrors` (l'option trace prepare echoué sur le détour-update
  existe déjà) puis ajouter un compteur de `items.length` dans le post à
  la preview `prepareJournalEntry` (après la fidélité check).

### 3.2. Tests précis à relancer pour vérifier la correction

```bash
# 1. Batterie complète (fil neuf par scénario) — DEUX passages
curl -s -X POST https://deploy-preview-16--g-flux.netlify.app/api/preview/diag > /dev/null
node tests/e2e-lot2b-scenarios.mjs pass1
curl -s -X POST https://deploy-preview-16--g-flux.netlify.app/api/preview/diag > /dev/null
node tests/e2e-lot2b-scenarios.mjs pass2
# (re-seed : les quotas Assistant du compte bêta sont remis à zéro par chaque POST diag)

# 2. Vérifier terraze du scenario C8 isolé :
#    "Ajoute 30 g de flocons d'avoine et 200 ml de lait demi-écrémé à mon petit-déjeuner."
#    suivi de "Lait écrémé plutôt."
#    Attendu : preview de 2 lignes (avoine + écrémé), PAS une seule ligne.

# 3. Vérifier la lecture exacte de la fidélité du modèle :
#    curl -s https://deploy-preview-16--g-flux.netlify.app/api/preview/diag | python3 -c "…toolErrors…"
#    → confirme que prepare (et pas update) a été appelé pendant C8

# 4. Unitaires :
npm test && npm run check && npm run build
```

### 3.3. État de la batterie (§9)

| Passage | Résultat | Cause des échecs |
|---|---|---|
| pass1 (2026-10-09, session) | 21/21 PASS | — |
| pass2 (2026-10-09, session) | 20/21 PASS | C8 : preview écrasée (zoom dessus §3.1) |

**Les deux critères cibles (CE = 21/21 × 2 passages consécutifs) ne sont
PAS encore atteints** (pass2 un echec C8).

---

## 4. Instructions pour la reprise (GPT-6 Luna)

1. **Ne re-fait pas** les fixes déjà livrés — le travail d'e371b7e et
   antérieur est validé par 620 tests unitaires + pass1 21/21.
2. **C8 : lire le diagnostic `toolErrors`** avant tout nouveau code.
3. **Conventions** : mutations Convex uniquement sous `src/convex/**` ;
   gardes via `requireAssistantClient` + `assertThread` ; tout nouveau
   champ de schéma dans `assistantMessages` doit être `v.optional` (pas
   de migration destructive) ; toolErrors = max 12 strings de 120 chars.
4. **Sécurité** : `feat/assistant-gflux-v1` uniquement. PR #18 scanner
   jamais sollicitée. Pas de merge sur main. Pas de force-push. Convex
   prod `calm-jaguar-475` jamais ciblé depuis la preview (les scripts
   build-preview refusent, ils continuent de couvrir). `Fruit` le nombre d'items
   préparés doit être TRACÉ si un doute apparaît (toolErrors).
5. **Validations** : `npm run check` / `npm test` avant tout push ; les
   deux passages E2E (§3.3) sont le critère de livraison finale du Lot
   2B ; **STOP après** rapport final §13 (ne pas lancer Lot 3).
6. **Scripts utiles** :
   - `/tmp/checks.mjs <sha>` — attendre le déploiement Netlify du SHA
     (diag fonction présent, seed OK).
   - `/tmp/mini.mjs` — login bêta + 1 send (mini repro).
   - `/tmp/repro-seq.mjs` — séquence B3→B4→B5→C1 complète en script.
7. **Historique de debug** — pour éviter tout ressasiement : les causes
   racines sont CHAQUE trace dans les commits (voir §1 liste) ; le diag
   `toolErrors` reste la boussole.

### Ce qui est ENTRE vos mains — couche immédiate (non livrée)

- **Rien en attente de commit** — working tree est PROPRE à `e371b7e`.
- **Não** nouvelle fonction, nouveau modèle, nouveau framework, pas de
  Lot 3, pas de refonte visuelle, pas de publication production.

---

## 5. Données factuelles de la session

- **Nombre de déploiements Netlify** de la session : ~12 builds de
  preview interrogés via `/tmp/checks.mjs` (recréés à chaque push →
  nouveaux environnements Convex preview à chaque fois — `rare-ant-657`,
  `perceptive-camel-5`, `strong-ostrich-992`, `fleet-bandicoot-776`,
  `joyous-tortoise-596`, `focused-sandpiper-923`, etc.).
- **Durée estimée de la session** GLM Flash sur le Lot 2B : ~40-50
  heures de travail effectif (depuis la première discussion de stratégie
  jusqu'à e371b7e).
- **Livrables de la mission** (bugs §3 à §9 dudit document) : 9 correctifs
  majeurs, 1 batterie de 21 scénarios E2E, traçabilité `toolErrors`.
- **Échecs intermédiaires résolus** : quotas Assistant (reset bêta
  manquant), pollution inter-scénarios du fil (fil frais par scénario),
  substitution de fiche (qualificatifs), IDs Convex fabriqués,
  recitations du modèle, détour update.

*Fin du passage de relais. STOP respecté.*
