# Mission V3.5 — Reconnaissance à distance (recadrage serré)

**Branche** `fix/barcode-lookup` · **PR #18** · **Base** `2139892` (V3.4-b) · **Expérimentation opt-in Preview uniquement**

## 1. Mesures sur captures réelles (IMG_2241/2242/2243, 13 h 21)

Outil : [tools/probe-strategies-v2.mts](../tools/probe-strategies-v2.mts) — 18 stratégies par image, mêmes pixels pour toutes.

| Stratégie | IMG_2241 | IMG_2242 | IMG_2243 |
|---|---|---|---|
| A1 plein cadre léger (passe 1 app) | — | — | — |
| A2 plein cadre + TH (passe 2) | — | — | — |
| A3 crop app 0.8×0.44 ×2 sans TH (passe 1.5 réelle) | — | — | — |
| A4 crop app ×2 + TH | — | — | — |
| **B1 crop serré bandeau ×1 + TH** | — | — | **✅ 3038352875035** |
| B2/B3 crop serré ×2 (NN / bilinéaire) + TH | — | — | — |
| B4 crop serré ×2 bilinéaire sans TH | — | — | — |
| C rotations ±2/4/6° + TH | — | — | — |
| D1/D2 downscale ×0.5 / ×0.75 + TH | — | — | — |
| E1 projection 1D ≈2 px/module | — | — | — |

- Géométrie identique sur les trois : bandeau y≈1097–1350, code x 213..993, **8,22 px/module**.
- **IMG_2243 décodée par B1 uniquement** : crop serré du bandeau (781×432), **×1 sans upscale**, TRY_HARDER.
- **IMG_2241/2242 : info optiquement absente** — sonde [probe-scanline.mts](../tools/probe-scanline.mts) : contraste 89–97/255, corrélation avec le pattern EAN-13 ≈ 49–58 % (= hasard, 3–5 runs contre 59 attendus). Aucune stratégie logicielle ne peut lire une frame où les barres ne sont plus contrastées. Cause : sous-exposition (contre-jour/ombre) — voie matérielle (lampe) ou rapprochement.

### Pourquoi le recadrage serré réussit là où tout le reste échoue

1. **HybridBinarizer** binarise par blocs locaux : sur le plein cadre (1206×2622), le bloc moyen est dominé par le fond (clavier sombre, boîte rouge) → le seuil local du bandeau fin est faussé, les barres fondent ou fusionnent.
2. Sur le **crop serré**, la fenêtre locale ≈ le bandeau : le seuil local sépare réellement barres/inter-barres.
3. **L'upscale ×2 du crop app (passe 1.5) aggrave le cas** : il augmente la taille des blocs du binarizer relatif au code et échantillonne du flou (NN duplique les pixels, bilinéaire les mélange) — A3/A4 échouent sur les trois images.
4. À 8,2 px/module, l'upscale est inutile (ZXing lit dès ~1–2 px/module au bench V3.3) : **×1 suffit et préserve le profil**.
5. TH est requis sur cette image (tenue à distance légèrement inclinée) : B4 (sans TH) échoue.

⚠️ **Honnêteté de mesure** : ce sont des captures d'écran (aperçu downscalé), pas des frames caméra brutes. Le mécanisme de frame dump (ci-dessous) permet de confirmer sur le flux réel.

## 2. Expérimentation V3.5 (livrée, réversible)

Dans [src/lib/barcodeScanner.ts](../src/lib/barcodeScanner.ts) :

- **Passe « bande serrée »** : recadrage horizontal fixe (60 % largeur × 18 % hauteur, centré sur le cadre guide), **×1 sans upscale**, TH forcé. Exécutée uniquement sur les frames SANS passe TH (le budget CPU de la passe profonde n'augmente pas).
- **Activation double-garde** : `?scannerCrop=tight` **ET** `__SCANNER_EXPERIMENT__` (CONTEXT=deploy-preview/branch-deploy). Hors Preview ou sans paramètre : comportement **bit-identique à V3.4-b** (défaut inchangé, conformément à la consigne).
- **Pastille debug** : `tight Np (X ms)` quand active — cadence et coût CPU de la passe.

### Frame dump diagnostic (temporaire, opt-in TRIPLE, privé)

`?scannerDebug=1&scannerFrameDump=1` **ET** garde Preview :
- un **tap sur la pastille** télécharge la dernière frame décodée (`gflux-frame-<ts>.png`, `<a download>` local) ;
- **aucun envoi réseau, aucun stockage automatique** — testé par V3.5-S4 (aucun `fetch`/`sendBeacon`/XHR dans le fichier) ;
- la frame est écrasée à chaque itération, rien n'est conservé au-delà ;
- `captureLastFrame` est absente du handle sans le flag (interface optionnelle, V3.5-S5).

### Mesures de terrain (protocole, Preview `?scannerDebug=1`)

| Métrique | Où | Objectif |
|---|---|---|
| 1re lecture (double base) | pastille `1re lecture X ms (session Y)` | X < 2000 ms |
| Distance de reconnaissance | protocole : 30/40/50 cm | le code se lit en tenant le code **dans le tiers central** |
| Cadence | pastille `fps ≈` | pas de chute > 20 % vs V3.4-b |
| Coût CPU passes | pastille `H (ms TH cum)` + `tight Np (ms)` | tight < TH cum |
| Validation A/B | même boîte, même distance : session sans `?scannerCrop=tight` puis avec | pastille + temps de 1re lecture |

## 3. Vérifications

| Contrôle | Résultat |
|---|---|
| `npm test` | **539/539** (+5 : V3.5-S1…S5) |
| `npm run check` | 0 erreur (41 warnings préexistants) |
| `npm run build` | OK |
| Périmètre | `fix/barcode-lookup` uniquement, aucun merge, main/PR #16/Convex intouchés |

## 4. Protocole de validation Android (après iPhone)

Android utilise souvent BarcodeDetector **natif** (Chrome) → la passe tight (ZXing) n'y tournera **pas** : ne pas conclure d'iPhone à Android. Points à vérifier séparément :

1. Moteur réel affiché par la pastille (`native` ou `zxing`) sur les Android cibles.
2. Si `native` : la passe tight V3.5 n'a aucun effet ; un équivalent natif (regionOfInterest ou crop avant `detect()`) devra être expérimenté séparément.
3. Si `zxing` (Chrome sans BarcodeDetector, Samsung Internet) : même protocole A/B que l'iPhone ; surveiller la résolution du track (Android démarre parfois à 640 px malgré `ideal:1920`, cf. commentaire code V3) — la distance de reconnaissance sera mécaniquement moindre.
4. Mesurer fps/tight cum sur 2–3 téléphones Android avant toute généralisation.

## 5. Prochaines étapes possibles (hors périmètre de cette livraison)

- Si le terrain A/B valide la passe tight → la promouvoir **défaut** en ZXing (et concevoir l'équivalent natif), avec bascule conservée.
- Voie sous-exposition : préconisation lampe/torch dans l'UI quand la scanline est plate (nécessite l'analyse par frame — coût à évaluer).
- Purger les outils de diagnostic `tools/probe-*` de `/tmp` une fois le chantier clos.
