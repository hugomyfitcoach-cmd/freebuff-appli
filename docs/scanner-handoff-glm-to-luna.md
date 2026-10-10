# Passage de relais — Scanner G-FLUX (GLM Flash → GPT-6 Luna)

**Date** : 9 oct 2026, 23 h 20 · **Auteur sortant** : GLM Flash (via Buffy/Freebuff)
**Branche** : `fix/barcode-lookup` · **PR** : #18 · **Isolation respectée** : aucun merge, ni `main`, ni PR #16, ni Convex Production touchés.

---

## 1. État du dépôt et déploiement

| Objet | État |
|---|---|
| Dernier commit avant passation | `8f41522` — « V3.5 : passe bande serrée opt-in (recadrage ×1 + TH, démontré IMG_2243) + frame dump diagnostic privé » (poussé sur origin en début de session) |
| Commit de passation | `4c922d3` — ce document + sondes `tools/probe-rotation-v36.mts` et `tools/probe-videos-2223.mts` (poussé sur `fix/barcode-lookup`) |
| Worktree | propre ; notez que `preview-videos/` (vignettes de frames extraites) reste non suivi — jetable |
| Netlify Preview | déploiement déclenché côté Netlify/GitHub ; **le SHA réellement servi en Preview n'a pas pu être revérifié depuis cet environnement** (aucun accès Netlify ici). Vérifier le badge Preview PR #18 ou `GET /api/app/version` sur l'URL Preview : le champ `build` renvoie l'empreinte `BUILD_VERSION`, à comparer au SHA attendu |
| Tests au commit `8f41522` | `npm test` 539/539 · `npm run check` 0 erreur · `npm run build` OK |

---

## 2. Architecture actuelle du scanner (`src/lib/barcodeScanner.ts`, ~1206 lignes)

Pipeline exécuté par `decodeOnce()` à chaque frame, dans l'ordre :

1. **BarcodeDetector natif** si disponible (Chrome Android récent) → `detect(video)` direct, **aucune passe ZXing** (aucun crop, aucun TH).
2. **ZXing (vendored `html5-qrcode/third_party/zxing-js.umd.js`)** :
   - **Passe 1** : plein cadre `MultiFormatReader` léger (sans TRY_HARDER), formats EAN_13/EAN_8/UPC_A/UPC_E/CODE_128/ITF/CODE_39.
   - **Passe 1.5** (1 frame sur 2) : crop app **80 % × 44 %** centré sur y≈48 % du cadre, **upscale ×2 nearest-neighbor**, sans TH.
   - **Passe 2** (« TRY_HARDER » plein cadre), fréquence selon `thStrategy` :
     | Stratégie | Contexte | Fréquence TH |
     |---|---|---|
     | `native` | BarcodeDetector présent | (passe ZXing jamais exécutée) |
     | `fixed-1of4` | défaut ZXing (iPhone/Safari) | 1 frame sur 4 |
     | `adaptive-boost` | `?scannerTH=boost` (Preview) | chaque frame quand `consecutiveNoRead` dépasse le seuil |
     | `adaptive-cooldown` | `?scannerTH=cooldown` | 1 frame sur 2 quand le boost stagne |
   - **Passe « bande serrée » V3.5** (opt-in **`?scannerCrop=tight`** ET garde build `__SCANNER_EXPERIMENT__`, Preview) : crop horizontal **60 % largeur × 18 % hauteur** centré sur le cadre guide, **×1 sans upscale**, TRY_HARDER forcé. Exécutée seulement sur les frames sans passe TH (budget CPU conservé). Instrumentation dédiée : `tightFrames`, `tightMs`.
3. **Porte de confirmation** anti-bruit : `createScanGate(2, SCAN_CONFIRM_GAP_MS)` (mode A) ou `createScanGate(1, …)` (mode B) — 2 lectures identiques rapprochées avant recherche produit ; réinitialisée sur `visibilitychange` et en pause manuelle.

### Caméra
- `getUserMedia({ facingMode: 'environment', width/height: { ideal: … } })` — RESOLUTION_LADDER 1920 puis repli 1280 ; re-négociation `applyConstraints` **une seule fois** si le track démarre < 1280.
- **Autofocus** : `focusMode` = `continuous` si la capability l'offre, sinon `single-shot` ; `pointsOfInterest` posé au centre du cadre guide. Le tout en try/catch silencieux (best-effort, échec non rapporté).
- **Zoom** : zoom initial ×2 (modéré) si la capability zoom l'offre, puis slider manuel uniquement ; aucun zoom automatique pendant le scan, aucune réinitialisation entre sessions (le track vit le temps de la session).

### Modes expérimentaux (URL, Preview uniquement)
| Paramètre | Effet |
|---|---|
| `?scannerDebug=1` | pastille debug (fps, frames L/H, ms TH cum, résolution track, moteur) |
| `?scannerTH=boost\|cooldown` | stratégie TH adaptative |
| `?scannerCrop=tight` | passe bande serrée V3.5 (crop ×1 + TH) |
| `?scannerFrameDump=1` | tap sur la pastille : télécharge la dernière frame (PNG local via `<a download>`), **aucun envoi réseau, aucun stockage** — opt-in triple : `+?scannerDebug=1` + garde Preview |

---

## 3. Corrections déjà réalisées et confirmées

| SHA | Contenu | Preuve |
|---|---|---|
| `2139892` | **V3.4-b (correctif critique)** : bug NotFoundException — un catch unique enveloppait les 3 passes ; sur toute frame en échec, les passes crop et TH **n'exécutaient jamais** (terrain mesuré : 428 frames légères, 0 TH, 0 ms). Chaque passe a désormais son propre try/catch. | repro démontré par `tools/repro-dead-passes.mts` + confirmation terrain : compteur TH non nul dans la pastille debug |
| `8f41522` | **V3.5** : passe bande serrée opt-in + frame dump diagnostic | démonstration sur capture réelle IMG_2243 (§4) ; **terrain non encore testé** |

(V3.4 initial `43f0167` : TRY_HARDER adaptatif opt-in + instrumentation — jamais mesuré terrain.)

---

## 4. Résultats des expérimentations V3.4 et V3.5 — limites

### V3.4 / TH adaptatif
- TRY_HARDER est le mécanisme qui décroche les EAN-13 tenus à distance et légèrement inclinés.
- `adaptive-boost` et `adaptive-cooldown` : **non testés terrain** (A/B manuel iPhone en attente, protocole rédigé dans `docs/mission-barcode-v3-5-distance.md`).

### V3.5 / bande serrée
- `tools/probe-strategies-v2.mts` sur IMG_2243 : la passe tight (crop bandeau 781×432, ×1 sans upscale, TRY_HARDER) est la **seule** des 18 stratégies testées à décoder le code.
- IMG_2241 et IMG_2242 sont **optiquement irrécupérables** : contraste de la scanline 89–97/255, corrélation avec le pattern EAN-13 ≈ hasard (3–5 runs contre 59 attendus). Aucune stratégie logicielle ne peut lire un code dont les barres ne sont plus contrastées — cause sous-exposition (contre-jour/ombre). Action pertinente : **matérielle** (rapprochement/éclairage), pas de modification du décodeur.
- ⚠️ Ces preuves proviennent de **captures d'écran** (aperçu downscalé), pas de frames caméra brutes. Le frame dump (`?scannerDebug=1&scannerFrameDump=1`) est en place pour confirmer sur le flux réel — **en attente de tests terrain**.

---

## 5. Anomalies encore présentes (statut de véracité honnête)

| Anomalie | Analyse | Statut |
|---|---|---|
| **Lecture difficile à distance** | sonde scanline : sous-exposition, barres décontrastées irrécupérables par le logiciel | démontré sur captures d'écran ; à confirmer sur frames brutes |
| **Flou initial / réajustements focus-zoom au démarrage** | `focusMode continuous` posé mais réaction du track non mesurée ; zoom initial ×2 et re-négociation de résolution (1×) provoquent un changement d'image visible au démarrage | hypothèse plausible, jamais chronométrée terrain |
| **Dégradation après plusieurs scans** | boucle de décodage longue durée ; aucune fuite identifiée dans le code, mais aucune mesure de stabilité fps/temps au fil de la session | hypothèse non testée — instrumentable via pastille debug (fps, ms TH cum, tight cum, toutes les 1 s) |
| **Réinitialisations entre scans** | flux jamais stoppé entre deux sessions rapprochées ; la réinitialisation porte uniquement sur la porte/gardes | à mesurer |

Ces impressions de flou initial et de réajustement focus/zoom sont fortement notées dans la **vidéo G-FLUX** fournie aujourd'hui (§6) — mais **aucun comparatif d'autofocus au démarrage FOOD vs G-FLUX n'est démontré par ces enregistrements**.

---

## 6. Analyse du comparatif vidéo G-FLUX / FOOD (vidéos fournies)

### Vidéos (extraites par ffmpeg, 2 frames/s)

| Vidéo | App | Durée | Frames |
|---|---|---|---|
| `ScreenRecording_10-09-2026 22.MP4` | **FOOD (Virtuagym)** | 4,3 s | 9 frames 1206×2622 |
| `ScreenRecording_10-09-2026 23.MP4` | **G-FLUX** | 10,8 s | 22 frames 1206×2622 |

App identifiée par l'UI : FOOD = titre « Log food » + bascule barcode/QR en haut d'encart ; G-FLUX = cadre coins blancs + « Rechercher le code » + onglets Recherche/Code-barres/Repas IA (BÊTA).

### Mesures (sonde `tools/probe-videos-2223.mts`)
Métrique de netteté = **variance du Laplacien** (proxy focus), zone caméra utile sans UI, 2 fps.

- **FOOD** : f001–f002 phase initiale sombre (lum≈37, sharp≈480–511 — scène quasi fixe) ; f003–f005 déplacement (lum 54→70, sharp 265→203→176 = chute pendant mouvement) ; f006–f009 dernière pose stable sur **fiche produit déjà loggé** (lum≈243, sharp 456–477).
- **G-FLUX** : f001–f018 scène stable plus claire (lum≈92), sharp fluctuant 174–280 (moyen ≈ 230, scan en cours) ; f019–f022 pose claire (lum≈230, sharp 336–344 stable).

### Conclusion honnête
1. Les deux apps suivent le **même schéma** : netteté basse pendant le mouvement, haute une fois la scène stabilisée ; chute nette au changement de scène.
2. **Les vidéos ne démontrent pas que FOOD est « net dès l'ouverture »** ni que son autofocus est plus rapide : les deux enregistrements débutent sur une phase mobile ou une scène numérique (écran), pas une pose comparable au démarrage du scan. L'impression initiale reste une observation subjective, non reproduite par la mesure.
3. **Aucun scan réussi à 90° n'apparaît dans l'une ou l'autre vidéo** : impossible de comparer les deux apps sur l'orientation aujourd'hui.
4. **ZONE** : cadre FOOD nettement plus haut (rectangle ~55 % de la hauteur caméra) ; cadre G-FLUX bande fine (≈ 22 %). MAIS on ne voit la zone analysée d'aucune app : cadre visuel ≠ région analysée (cf. §7).

### Netteté initiale (comparatif au démarrage)
La comparaison FOOD vs G-FLUX sur le comportement focus **au démarrage du scan** n'a pas de fondement aujourd'hui — il faudrait des vidéos synchronisées depuis l'ouverture du scanner en scannant le même objet.

---

## 7. Zone visuelle vs région analysée (et codes 90°)

**Démontré par lecture du code** :
- La bande visuelle encadrée ne borne **rien** : passe 1 et passe TH analysent le **plein cadre**, passe 1.5 le 80 %×44 %, passe tight le 60 %×18 %. Le cadre guide est purement indicatif côté ZXing.
- **ZXing et rotation 90°** : `OneDReader.decode` ne tente la rotation CCW de 90° **que si TRY_HARDER est actif** et si la source supporte la rotation (HTMLCanvasElementLuminanceSource le supporte, true). Donc :
  - passe 1 (léger) : **aucun 90°** ; passe 1.5 (sans TH) : **aucun 90°** ;
  - passe 2 TH et passe tight (TH forcé) : 90° **tenté** sur la fenêtre analysée.
- **Piège potentiel de la passe tight pour un code à 90°** : le crop 60 %×18 % est **horizontal** ; un code vertical (barres verticales sur la canette) voit son axe long traverser la bande de 18 % de hauteur → il peut être **tronqué** par le recadrage (la rotation 90° appliquée ensuite ne reconstitue pas la partie coupée). La passe tight **réduit donc potentiellement la couverture 90°** comparée à la passe TH plein cadre — mais :
  - d'un autre côté, la passe tight ne s'exécute QUE sur les frames sans passe TH, et la passe TH plein cadre reste disponible chaque 4 frames dans le défaut du mode A/B ;
  - **l'effet net sur la latence de détection 90° n'a jamais été mesuré**, ni en simulateur ni terrain. Statut : hypothèse forte, non mesurée. La sonde `tools/probe-rotation-v36.mts` (commitée) est conçue pour trancher : elle applique chaque passe (full léger/TH, tight, crop app) à des captures avec code horizontal vs re-roté à 90°, en recomposant le bloc EAN-13 réel extrait d'une capture qui décode. **À exécuter par Luna** avec des frames caméra `?scannerFrameDump=1`.

### Captures IMG_2265..2297 (photos courbes, carnet de test)
Prises hors scanner (aucun cadre guide) ; ZXing ne décode rien sur ces images dans aucune stratégie testée. Ces photos **ne prouvent rien** sur le comportement réel du scanner (flux caméra, cadrage). **À ne pas utiliser comme preuve.**

---

## 8. Tests restants et recommandation prioritaire

### Tests à mener (protocole détaillé : `docs/mission-barcode-v3-5-distance.md` §2, §4)
1. **A/B iPhone** : même boîte, même distance ; session sans `?scannerCrop=tight` puis avec ; objectif 1re lecture < 2000 ms ; mesurer la pastille debug (+ tight Np/ms quand active).
2. **Frame dump** sur frames caméra brutes : `?scannerDebug=1&scannerFrameDump=1` → tap pastille → relancer `tools/probe-strategies-v2.mts` et `probe-rotation-v36.mts` sur ces PNG.
3. **90°** : reproduire la pose « canette verticale, code à 90° » côte à côte avec/sans `?scannerCrop=tight` ; comparer temps 1re lecture.
4. **Android** (2–3 appareils) : pastille moteur — si `native`, la passe tight ZXing n'existe pas ; évaluer le crop avant `detect()` séparément.
5. **Netteté initiale** : chronométrer 1re frame → 1re lecture ; afficher `focusMode` dans la pastille debug (non affiché aujourd'hui).
6. **Robustesse long scan** : suivre fps / ms TH cum / tight cum pendant une session de plusieurs scans.

### Recommandation unique (à évaluer, PAS à développer sans accord utilisateur)
> **Priorité : valider en terrain iPhone la passe tight V3.5 (A/B `?scannerCrop=tight` + frame dump sur frames brutes). Si le mécanisme est confirmé, le chantier suivant le plus probable est la couverture 90° de la passe tight (crop vertical en plus du crop horizontal, ou rotation 90° CCW avant analyse) — car l'orientation 90° est aujourd'hui le seul angle d'amélioration à la fois non couvert par les passes par défaut et présumé pénalisé par le tight. Ne rien développer avant ces mesures.**

Rappel du diagnostic précédent : l'avantage de la passe tight a été démontré sur **un seul** cas (IMG_2243, screenshot) ; les tensions restantes (flou initial, dégradation au fil des scans, 90°) n'ont **aucune** démonstration causale à ce jour.

---

## 9. Consignes de sécurité pour GPT-6 Luna

- PR #18 exclusivement ; **aucun merge** ; `main` et PR #16 intouchés ; Convex Production jamais écrit — tout travail de schéma/fonctions doit cibler le Convex Preview `barcode-lookup-preview` (documenté dans `netlify.toml`).
- **Aucun force-push** ; comportement par défaut inchangé : toute nouvelle expérimentation doit rester opt-in (URL) + garde Preview (`__SCANNER_EXPERIMENT__`), réversible, et testée d'abord iPhone puis Android.
- Distinguer systématiquement : démontré (sondes/code lu) / plausible (hypothèse) / non testé. Les conclusions fondées sur captures d'écran doivent être confirmées sur frames caméra brutes avant d'être traitées comme des faits.
- Sondes dispo : `tools/probe-strategies-v2.mts`, `tools/probe-scanline.mts`, `tools/probe-rotation-v36.mts`, `tools/repro-dead-passes.mts`, `tools/probe-videos-2223.mts` (usage : `node --experimental-strip-types tools/<nom>.mts <PNG...>` ; les frames brutes du frame dump sont des PNG 1206×2622, directement consommables).
- La documentation de fond reste : `docs/mission-barcode-v3-5-distance.md` (V3.5) et `docs/diagnostic-scanner-v3-3.md`.

---

**STOP — aucun développement supplémentaire. La passation s'arrête ici.**
