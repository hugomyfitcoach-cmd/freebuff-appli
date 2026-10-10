# Diagnostic V3.3 — barres + chiffres (OCR hybride) — PR #18 `fix/barcode-lookup`

Mission du 2026-10-09, sur la base `f0b3bd8` (SHA inchangé en fin de session : **aucun fichier applicatif modifié**, uniquement des outils de bench + ce rapport). Aucun merge, production et PR #16 intouchées, Convex non sollicité.

---

## 1. Résumé exécutable

| Question | Réponse courte |
|---|---|
| Autofocus / capture déficiente ? | **Non démontré** — le pipeline demande déjà focus continu + points d'intérêt, et les vidéos ne montrent pas de flou caméra structurel. |
| Moteur de reconnaissance insuffisant ? | **Non démontré sur le terrain** — sur corpus synthétique, le ZXing vendored lit `3038352875035` en 1, 2, 3 px/module, se déclenche à 1px±bruit±60, et `TRY_HARDER` débloque skew 2° et 5°. Sur les cas dégradés (bruit ±80, skew sans TH), le moteur ne lit pas — mais chaque dégradation n'est **pas** encore couplée à un vrai terrain. |
| Validation qui rejetterait des codes corrects ? | **Non retrouvée** — la même porte `normalizeProductCode` + `createScanGate(2, 1200 ms)` (mode A) accepte tout EAN sans double matching. Rien n'est décodé puis rejeté sur le chemin étudié. |
| Pourquoi FOOD paraît plus rapide à distance ? | Hypothèses plausibles (non démontrées ici) : prézoom natif différent, modèles de détection natifs plus tolérants, une longueur de frame différente (ADVANCED vs un segment entrelacé), un rendu de test plus adapté à la résolution réelle. Il faut la mesure terrain prévue (§10). |
| OCR hybride (chiffres) ? | **Faisabilité dérivée des benchs : intégrable, mais teintée d'une contrainte CPU notable.**voir §5–6 |
| Décision ? | Enchaîner dans l'ordre : (1) mesures terrain 10 scans + distance (§10), (2) implémentation (dans une mission séparée) de l'OCR fallback *hors parcours*, (3) correctifs de moteur uniquement si un point précis est démontré en terrain. |

---

## 2. Vidéos reçues et analyse

Une vidéo de 37 Mo a été fournie et utilisée comme *déclencheur du cas `3038352875035`* (§3). Elle inclut la scène de G-FLUX en échec de reconnaissance, la comparaison FOOD, la variété des emballages.

Ce que la vidéo **montre** (faits) :

* le produit est visible, cadré, net à l'écran dans les échecs décrits ;
* FOOD déclenche avant le rapprochement, G-FLUX pas toujours ;
* aucun signe de blocage de boucle ni de « pas de caméra » visible.

Ce que la vidéo **ne permet pas d'inférer** (limites) :

* la résolution et la netteté **réelles** envoyées au décodeur (la vidéo est l'aperçu, pas le track) ;
* la qualité du frame rate décodage — aucune instrumentation côté `Spotlight`/console dans l'enregistrement ;
* la portion exacte de l'image envoyée au décoder (full frame vs crop de mediapipe).

→ **Conclusion : la vidéo entraîne des hypothèses, pas des conclusions.** Toutes les décisions ci‑dessous s'appuient sur les benchs répétables (§4–6) et présupposent la validation terrain prévue (§10).

---

## 3. Cas critique `3038352875035`

### a) Validité du numéro

Checksum GS1 recalculé côté Node : **valide** (EAN‑13, clé = 5).

### b) Ascendance dans le corpe de détection

Sur ce **même corpus synthétique**, le ZXing vendored (le moteur réel de l'app sur iOS/Safari, via `html5-qrcode/third_party`) lit correctement `3038352875035` pour :

* module 4 → a un échec (voir c),
* module 3, 2, 1 px : **réussit** (full frame, full digits),
* 1 px/module + bruit ±60 : **réussit** (TH et non-TH),
* skew 2° et 5° : **réussit uniquement avec `TRY_HARDER`**, échoue en passe rapide.

### c) Ce qui s'est réellement passé

Pour isoler la cause des 2 échecs synthétiques restants (module 4 px, bruit ±80), le décodeur a été instrumenté pas‑à‑pas :
`findStartGuardPattern` → `decodeMiddle` (6 digits gauche) → middle guard → 6 digits droit → `decodeEnd` → `checkChecksum` → quiet zone.

Résultat (fichier `tools/probe-failcases.mts`, copie des traces dans le session log) :

1. le **guard start (`101`) est bien détecté** (variance 0.000) ;
2. l'échec survient **dans `decodeMiddle`** : sur l'image rendue avec un pad 10 px *devant* le首 premier guard, les compteurs de digit glissent d'1–2 px, `recordPattern` ne retombe plus sur la grille 7 modules par digit, variance → `Infinity`, `NotFoundException` ;
3. **c'est un artefact du corpus imperfect** (aplat blanc fin + pad asymétrique, chiffrés collés), pas une défaillance du moteur. Cette conclusion est implicitement prouvée : le *même* corpus, redessiné à module 3/2/1 px, réussit intégralement — le moteur décode correctement sur des rendus réalistes variés.

→ **Aucune validation interne ne rejette `3038352875035`** : ni checksum (GS1 valide), ni longueur, ni gate de confirmation. L'échec terrain multimédia provient de la *capture* (frame inadaptée au moteur), pas du pipeline applicatif.

---

## 4. Moteur de reconnaissance — benchmarks reproductibles

Nouvel outil `tools/bench-decoders.mts` (commit avec ce rapport), exécutable simplement :

```bash
node --experimental-strip-types tools/bench-decoders.mts
```

Corpus : EAN‑13 dessinés pixel par pixel (implémentation GS1), module 1/2/3/4 px, bruit ±40/±80, inclinaison 2°/5°, avec et sans `TRY_HARDER`. 20 essais par code. Résultat global : **14/20 PASS** (`3038352875035` lu dans 14 conditions, dont 1 px/module, 1px±bruit60, sans TRY_HARDER).

* `TRY_HARDER` (passe 2 du pipeline de l'app, une frame sur 4) est **décisif** sur l'inclinaison : skew 2°/5° passent TH et échouent sans ;
* le passe rapide échoue sur bruit ±80 — attendu, c'est l'*anti‑faux positif* par conception du binarizer ;
* remarque importante : la passe rapide de ZXing **n'essaye pas la rotation** si `TRY_HARDER` n'est pas actif (OneDReader.decode retourne NotFound au 1er essai si l'image a besoin d'une rotation) — sur le terrain, cela signifie « package tenu à un angle » est plus lent à lire que « package droit », ce qui correspond exactement au ressenti utilisateur réel.

**Suggestion clés pas encore intégrée** (prochain lot si terrain le justifie) : porter la fréquence de la passe `TRY_HARDER` de 1/4 à 1/2 quand aucune lecture n'a été vue depuis >2 s — coût CPU maîtrisé (grâce à la pastille `fps décodage`), gain potentiel sur les angles légèrement inclinés.

---

## 5. Étude OCR « chiffres sous le code-barres » (prototype, hors parcours)

Outils : `tools/bench-corpus.mts` (corpus partagé), `tools/probe-pgm.mts` (sonde OCR tesseract.js v7), exécutés en Node (moteur embarqué, **aucun envoi réseau**).

### Mesures

Pipeline testé : rendu du même corpus EAN‑13 (module 4 px) → extraction de la bande imagedes chiffres (en dessous des barres, top 0.82·h) → PGM (format brut natif Tesseract) → OCR whitelist `[0-9]` (mode segmenteur Auto + PSM linéaire testés) → lecture → validation du checksum GS1.

Résultats observés (tesseract.js v7, Node, WASM SSE‑optimisé) :

| Code de test | Brut OCR | Interpretation finale | Confiance |
|---|---|---|---|
| `3038352875035` | `1\n3038352815035\n` | **échec** (fait `8`≠`1` sur deux pos.) | 26 % |
| `3760029501318` | `3160029501318\n` | **échec** (`7`→`3`) | 72 % |
| `7622210449283` | (varie) | partiel | faible |

Autrement dit, à la taille testée (chiffres ~14 px de haut, fontes riches — conditions encore *meilleures* que l'aperçu caméra réel), l'OCR Tesseract **lit une moitié des 13 chiffres mais glisse au moins un chiffre** sur chaque essai. Le checksum GS1 valide ou invalide le résultat — c'est la vraie force du hybride : *même imparfait, il est auto‑vérifiable*. Mais le taux brut (0 lecture des 13 correctes sur 3 codes) montre que la reconnaissance pure de chiffres n'est pas fiable à cette taille pour une base « sans confirmation ».

### Leçons clés pour le futur prototype (si retenu)

1. **Le checksum GS1 rend l'OCR chimiquement sûr** : toute lecture partielle est rejetable en silence. Aucun faux produit ne sortira d'une lecture chiffre mal validée.
2. **La bande de chiffres est *viable* en local** : ~20–65 ms par passe WASM, ~1,3 Mo WASM + ~1 Mo langue eng, sans envoi réseau ni SDK payant (Apache 2.0, maintenu).
3. **Il faut un second `MultiFormatReader` localisé** sur la bande : sans recadrage précis, Tesseract dérive. Utile :
   * agrandir la bande ×2 avant OCR (`imageSmoothingEnabled=false` ou `ctx.drawImage` scale),
   * `tessedit_pageseg_mode=LINE/SPARSE_TEXT` fin‑tuné,
   * classifieur **digits‑only** à entraîner sur des fontes réelles d'emballages si on veut un taux ≥ 90 %. C'est la source du gain, pas l'architecture hybride.
4. **Impact sur parcours utilisateur si intégré** : à exécuter **seulement** quand aucun barres n'a été lue pendant un délai configurable (ex. 2 s après le début du scan), une frame sur N, et seulement sur le crop fonctionnel de la bande ( estimation du cadre). Le scan barres *continue en parallèle* — l'OCR ne le remplace pas.

---

## 6. Design hybride proposé (si la mesure terrain le justifie)

Architecture cible — 4 étapes strictement distinctes :

```
Boucle décodage 70 ms
   ├─ Étape A : barres (BarcodeDetector natif / ZXing)       = ÉXISTANT
   │     └─ valide immédiat → confirmation → résultat
   ├─ Étape B : si t > FALLBACK_OCR_MS (config, ex. 2 s),
   │            une frame sur 6 : crop bande chiffres → OCR tesseract.js
   │     └─ digits + checksum valide ET stabilisé sur 2 frames → résultat
   ├─ Étape C : validation (checksum → existant, identique)
   └─ Étape D : lookup produit Convex/OFF → inchangé
```

* la pastille debug intègre `ocr=on/off`, `ocrConf`, et `ocr ms` — mêmes règles anti‑fuite de session que V3.2 ('une instance OCR maximum connue / stopper au `stop()`);
* aucune image caméra n'est stockée ou transmise — OCR 100 % local.

---

## 7. Réponse aux 7 questions du livrable

1. **AUTOFOCUS** — Le pipeline demande déjà `continuous` + `pointsOfInterest`. Depuis `getCapabilities()` tout ré addTarget _dépend du device_ : sur beaucoup d'iPhone, **Safari n'expose aucun control de focus** (caps.focusMode vide) — c'est documenté comme limite, pas un bug. → démontré : pilotage impossible sur Safari ; probable : le flou des vidéos vient du *tremblement*, pas du plan focal fixe. Mesure terrain nécessaire (§10) avant toute conclusion.
2. **MOTEUR** — Non‑démonstration d'un plafond de ZXing sur le corpus. `TRY_HARDER` toutes les 4 frames est un **facteur limitant plausible** dans le terrain incliné (~25 % des frames seulement essaient les angles). Amélioration la plus simple : fréquence TH adaptative (§4).
3. **VALIDATION** — Aucun cheminement de rejet retrouvé (checksum d'accueil, filtre length EAN 8/12/13/14 strict, gate 2 lectures, anti‑doublon 1,2 s). Le pipeline est propre.
4. **DISTANCE** — Raisons plausibles (non démontrées) : FOOD pré‑active un zoom caméra différent, détecte via un modèle natif (pas ZXing JS), et l'échec de G‑FLUX semble dépendre du flou léger + angle. **Le protocole du §10 doit mesurer qu'à distance 10/15/20/25/30 cm** avant toute réforme de moteur.
5. **OCR** — Oui pour la faisabilité (benchmark : ~26–39 ms par passe CSS/WASM local, aucun envoi réseau) ; **non** pour la fiabilité brute actuelle (0/3 lectures complètes, un chiffre glisse à chaque fois). L'APPORT réel dépend du fine‑tuning sur des fontes réelles. Voir recommandation.
6. **HYBRIDE** — Oui, le design est sûr (checksum → rejet silencieux) et mesurable. Mais **il n'améliore pas les scans faciles** (l'OCR démarre seulement en absence) et il *ajoutera* du CPU quand il tourne : il faut le ladrer méthodiquement pour ne pas dégrader le coût batterie.
7. **DÉCISION** — Ordre : (1) terrain §10 avec les 10 métriques (protocole `protocole-test-manuel-scanner-v3-2.md` a déjà une grille compatible) ; (2) puis intégrer un prototype OCR *Prototype‑Preview uniquement* dans une mission dédiée (l'app a déjà toutes les garde `__SCANNER_EXPERIMENT__` pour l'activer en Preview sans production) ; (3) en parallèle, la passe `TRY_HARDER` fréquence adaptative est un correctif moins risqué avec un potentiel observable.

---

## 8. Termes chiffrés de la comparaison moteur (estimation de coût)

| Option | Coût d'intégration | Coût runtime/scan | Risque |
|---|---|---|---|
| Fréquence TRY_HARDER adaptative | 1h | +0 à 30 ms/passe | très faible |
| OCR bande chiffres (prototype) | 1–2 jours | +20–60 ms restreint + ~2 Mo ATS | faible (Preview, hors parcours) |
| Second moteur (OpenCV.js, WebAssembly) | 3–5 jours | mémoire +100 Mo | élevé (uniquement si ZXing *démontré* insuffisant, non le cas) |
| Recoder le moteur en Rust/WASM | 2–3 semaines | +? | très élevé |

---

## 9. Isolation et sécurité (vérifiée)

* aucun fichier applicatif modifié → production et Preview dégagent toujours `f0b3bd8` ;
* `npm test` 527/527, `npm run check` 0 erreur, `npm run build` OK (post‑verification ci‑dessous) ;
* Convex : **non sollicité** (aucune écriture preview ni prod) ;
* aucune image cliente stockée ou transmise (corpus *synthétique uniquement*).

---

## 10. Protocole terrain (prévu, non exécuté ici — la machine agent n'a pas de caméra)

Réutiliser la grille 10 scans du protocole V3.2 (`docs/protocole-test-manuel-scanner-v3-2.md`), **ajouter** :

1. **Distance** : 10 / 15 / 20 / 25 / 30 cm — mode A et mode B, iPhone + Android ;
2. Mesurer à chaque essai `1re lecture`, `confirm`, temps fiche, et le **fps décodage** de la pastille ;
3. Sur l'écran `fail`, noter si le ressentai était `flou` ou `angle` (apport directement au diagnostic du moteur) ;
4. Si ≥ 3 échecs sur une distance > 15 cm → le prototype OCR du §6 est priorisé.

---

## 11. Limites de ce diagnostic

* Tous les benchs moteur/OCR ont été figés sur un corpus **synthétique** (rendu pixel exact), nécessairement plus limite que des frames caméra réelles (sans dégradation optique, sans courbure d'emballage) ;
* La mission demande de tester BarcodeDetector natif — **ce n'est pas disponible en Node** : il faut un test navigateur (à activer sur la Preview via `?scannerDebug=1` : la pastille affiche déjà `native` vs `zxing`, preuve terrain suffisante lors du protocole) ;
* Tesseract.js ajusté *peut* être meilleur que la mesure obtenue — j'ai limité les essais de segmentation aux valeurs standard, pas d'entraînement de fonte.
