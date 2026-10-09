# Scanner V3.2 — Protocole A/B + debug + distances (Preview uniquement)

Complète [protocole-test-manuel-scanner-v3.md](protocole-test-manuel-scanner-v3.md).
À exécuter sur la **Deploy Preview de la PR #18** uniquement.

## 1. Modes de test

| URL | Mode | Comportement |
|---|---|---|
| `…/?scannerMode=A&scannerDebug=1` | A (défaut) | 2 lectures identiques ≤ 1200 ms (fenêtre glissante) |
| `…/?scannerMode=B&scannerDebug=1` | B (expérimental) | 1 lecture valide suffit — checksum GS1 et anti-doublon conservés |

- Ces paramètres sont **ignorés en production** (double garde dans le code, testée).
- La pastille debug (haut-gauche) affiche : moteur, résolutions track/vidéo,
  FPS de décodage, zoom, délai 1re lecture, délai confirmation, erreurs.

## 2. Grille distances (même téléphone, même emballage, même lumière)

Pour **chaque mode** (A puis B), 5 essais par distance, chronométrage
présentation → ouverture de la fiche (la pastille debug donne aussi
« 1re lecture » et « confirm » en ms — les noter) :

| Distance | Mode A : médiane / réussite | Mode B : médiane / réussite |
|---|---|---|
| 10 cm | | |
| 15 cm | | |
| 20 cm | | |
| 25 cm | | |
| 30 cm | | |

Répéter la même grille avec **FOOD** (10, 20, 30 cm suffisent — l'app ne
fournit pas de mesures internes ; chronométrage manuel uniquement).

## 3. Cas anti-régression mode B (obligatoires avant tout maintien)

- [ ] Deux codes différents présentés successivement → 2 fiches distinctes,
      jamais de fiche ouverte avec le mauvais code (anti-doublon 1,2 s).
- [ ] Code logistique / QR / étiquette partielle → aucun déclenchement.
- [ ] Re-présentation du même code après fermeture de fiche → 1 seule
      réouverture (verrou DUPLICATE_MS).
- [ ] Taux de lectures erronées noté sur ≥ 20 lectures par mode.

## 4. Lecture de la pastille debug (diagnostic caméra)

- `track 1280×720` ou plus : résolution OK. `track 640×480` : le modèle
  bride le track → la re-négociation V3 a échoué, noter le modèle.
- `fps décodage` < 5 : boucle trop lente (ZXing actif ? CPU saturé ?).
- `engine zxing` sur un Chrome Android récent : BarcodeDetector absent ou
  constructeur en échec → investiguer.
- `confirm` élevé (> 800 ms) en mode A alors que « 1re lecture » est rapide :
  c'est la signature exacte de l'hypothèse n° 1 (double lecture) — le mode B
  devrait l'annuler.

## 5. Test « 10 scans successifs » (ralentissement après plusieurs produits)

Sur la Preview (SHA ≥ 52c92bd), mode debug actif. Pour CHAQUE scan i de 1 à 10 :
produit différent, fermer la fiche, re-scanner. Noter depuis la pastille :

| # | ouverture caméra (s) | 1re lecture (ms) | confirm (ms) | fiche affichée (s) | sessions x/y | streams | maxLoops |
|---|---|---|---|---|---|---|---|
| 1…10 | | | | | | | |

**Lecture :**
- `sessions x/y` doit rester **x = 1** après chaque fermeture de fiche (1 seule
  session vivante). Si x progresse (2, 3…) → fuite confirmée, noter le SHA.
- `streams` doit retomber à 0/1 entre deux scans (caméra libérée).
- `maxLoops` doit rester **≤ 1** en permanence (jamais de boucles concurrentes).
- Si les temps « 1re lecture » se dégradent alors que sessions/streams restent
  stables → le ralentissement n'est PAS une fuite : suspecter l'appareil
  (thermique, cache navigateur) — comparer avec FOOD dans les mêmes conditions.

**Montage/démontage répété** : alterner Journal ⇄ autre écran 10× avec le
scanner ouvert avant chaque navigation. La pastille (réouverte ensuite) doit
montrer sessions alive = 1 et streams = 1 après réouverture — jamais plus.

## 6. Mission V3.4 — moteur actif + TRY_HARDER adaptatif

### 6.1 Identifier le moteur RÉELLEMENT actif (obligatoire avant tout test TH)

Ouvrir le scan avec `?scannerDebug=1` (mode A suffit) et lire la 1re ligne de
la pastille :

- `zxing · th=fixed-1of4` → le ZXing vendored est actif (iOS/Safari ou Chrome
  sans BarcodeDetector) : **les tests TH ci-dessous s'appliquent**.
- `native · th=native` → BarcodeDetector est actif (Chrome/Samsung Internet
  Android récents) : **la passe TRY_HARDER est sans objet** (elle n'exécute
  jamais de ZXing) — ne pas tester les URLs ?scannerTH sur ce téléphone, la
  comparaison serait invalide.

### 6.2 Comparaison des stratégies TH (mêmes emballages, même téléphone, même lumière)

Trois URLs, à tester à la SUITE l'une de l'autre, mêmes conditions :

| Étape | URL | Stratégie |
|---|---|---|
| R (référence) | `…/?scannerMode=A&scannerDebug=1` | fixed-1of4 (historique) |
| S1 | `…/?scannerMode=A&scannerDebug=1&scannerTH=boost` | TH à chaque frame après ~8 frames sans lecture |
| S2 | `…/?scannerMode=A&scannerDebug=1&scannerTH=cooldown` | TH une frame sur 2 après ~12 frames sans lecture |

Ces URLs sont **ignorées en production** (garde `__SCANNER_EXPERIMENT__`,
testée) et sans effet sur un téléphone où `native` est affiché.

Pour chaque stratégie : **10 scans successifs** (§5), 3 distances (15/25/30 cm).
Noter depuis la pastille à chaque scan :

| # | 1re lecture (ms) | confirm (ms) | fps ≈ | L/H (frames légères/profondes) | TH cum (ms) |
|---|---|---|---|---|---|
| 1…10 | | | | | |

**Lecture des mesures :**
- `L/H` est la répartition réelle des passes : en fixed-1of4 le ratio doit
  approcher 3/1 ; en boost il doit s'inverser après ~0,5 s sans lecture.
- `TH cum` croît vite en boost : si la caméra devient saccadée (aperçu
  haché) → la stratégie sature le CPU sur ce téléphone, le noter (S1 à
  proscrire sur cet appareil ; S2 reste l'alternative).
- Un gain se voit UNIQUEMENT sur « 1re lecture » : S1 ou S2 < R de façon
  reproductible (≥ 3 scans plus rapides sur 10, aucun plus lent de > 500 ms)
  → le gain est démontré, sinon on garde fixed-1of4 (défaut).
- `fps ≈` ne doit PAS chuter de plus de ~20 % en S1/S2 par rapport à R
  (sinon la cadence globale souffre malgré le gain par passe).

**Distances** : sur la meilleure stratégie (R, S1 ou S2 selon les 10 scans
précédents), rejouer la grille de distances §2 (10/15/20/25/30 cm) et noter
la distance maximale avec 1re lecture < 2 s — c'est le critère « reconnu de
plus loin » demandé, mesuré et non supposé.

## 7. Confidentialité

La pastille n'affiche que des mesures techniques. Aucune image n'est
capturée, stockée ou transmise ; aucun identifiant personnel dans les logs.
