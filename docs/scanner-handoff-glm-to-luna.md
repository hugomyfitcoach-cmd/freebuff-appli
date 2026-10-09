# Passage de relais — Scanner G-FLUX (GLM Flash → GPT-6 Luna)

**Date** : 9 oct 2026, 23 h 20 · **Auteur sortant** : GLM Flash (via Buffy/Freebuff)
**Branche** : `fix/barcode-lookup` · **PR** : #18 · **Isolation respectée** : aucun merge, ni `main`, ni PR #16, ni Convex Production touchés.

---

## 1. État du dépôt et déploiement

| Objet | État |
|---|---|
| Dernier commit local **et** distant | `8f41522` — « V3.5 : passe bande serrée opt-in (recadrage ×1 + TH, démontré IMG_2243) + frame dump diagnostic privé » |
| Worktree | `fix/barcode-lookup` propre (fichier non suivi : `tools/probe-rotation-v36.mts` — sonde géométrique 90°, voir §7) |
| Netlify Preview | déploiement déclenché côté Netlify/GitHub sur `8f41522` ; **le SHA servi en Preview n'a pas été revérifié depuis cet environnement** (aucun accès Netlify ici). Vérifier le badge Preview PR #18 ou `GET /api/app/version` sur l'URL preview (le champ `build` répond avec l'empreinte `BUILD_VERSION`). |
| Tests au commit | `npm test` 539/539 · `npm run check` 0 erreur · `npm run build` OK |

*(Traçabilité Netlify minée à reconfirmer par Luna : le endpoint version répond `{ build, … }` — le comparer au `BUILD_VERSION` compilé au même SHA.)*

---

## 2. Architecture actuelle du scanner (`src/lib/barcodeScanner.ts`, ~1206 lignes)

Moteur et pipeline, dans l'ordre d'exécution de `decodeOnce()` par frame :

1. **BarcodeDetector natif** si disponible (Chrome Android, flag `native`) → `detect(video)` direct, **aucune passe ZXing** (aucun crop ni TH).
2. **ZXing (vendored html5-qrcode/third_party/zxing-js.umd.js)** :
   - **Passe 1** : plein cadre `MultiFormatReader` léger (sans TRY_HARDER), formats EAN_13/EAN_8/UPC_A/UPC_E/CODE_128/ITF/CODE_39.
   - **Passe 1.5** (1 frame sur 2) : crop app **80 % × 44 %** (scène complète, centré y≈48 %) **upscale ×2 nearest-neighbor**, sans TH.
   - **Passe 2** (« TRY_HARDER » plein cadre) : fréquence selon `thStrategy` :
     | Stratégie | Contexte | Fréquence TH |
     |---|---|---|
     | `native` | BarcodeDetector présent | (passe ZXing désactivée) |
     | `fixed-1of4` | défaut ZXing (iPhone/Safari) | toutes les 4 frames |
     | `adaptive-boost` | `?scannerTH=boost` (Preview) | chaque frame quand `consecutiveNoRead ≥ seuil` |
     | `adaptive-cooldown` | `?scannerTH=cooldown` | 1 sur 2 quand le boost stagne |
   - **Passe « bande serrée » V3.5** (opt-in **`?scannerCrop=tight`** ET garde build `__SCANNER_EXPERIMENT__`) : crop horizontal **60 % largeur × 18 % hauteur** centré sur le cadre guide, **×1 sans upscale**, TH forcé. Exécutée SEULEMENT sur les frames sans passe TH (budget CPU conservé) ; instrumentation dédiée `tightFrames`/`tightMs`.
3. **Porte de confirmation** anti-bruit : `createScanGate(2, SCAN_CONFIRM_GAP_MS)` (mode A) ou `createScanGate(1, …)` (mode B) — 2 lectures identiques rapprochées avant recherche produit ; réinitialisée sur `visibilitychange` et en pause manuelle.

### Caméra (settup dans `startBarcodeScanner`)
- `getUserMedia({ facingMode: 'environment', width: {ideal:…}, height: {ideal:…} })` — la RESOLUTION_LADDER (repli 1280 après 1920 refusé) : **1920×1080 visé**, re-négociation `applyConstraints` UNE fois si le track démarre < 1280.
- **Autofocus** : `focusMode` = `continuous` si la capability l'offre, sinon `single-shot` ; **pointsOfInterest** posé au centre du cadre guide (y = centre de la bande encadrée). Le tout en try/catch silencieux (best-effort, pas de contrôle d'échec).
- **Zoom** : zoom initial modéré (×2 si présent), slider manuel ensuite (aucun changement automatique de zoom pendant le scan, aucune remise à zéro entre sessions — le track vit le temps de la session).
- **Résolutions track** : `trackResolution` mesurée et re-négociée ; exposée via `handle.resolution()` pour objective cervla du terrain.

### Modes expérimentaux (URL, tousPreview uniquement)
| Paramètre | Effet |
|---|---|
| `?scannerDebug=1` | pastille debug (fps, frames L/H, ms TH cum, résolution track, moteur) |
| `?scannerTH=boost\|cooldown` | stratégie TH adaptative |
| `?scannerCrop=tight` | passe bande serrée V3.5 (recadrage ×1 + TH) |
| `?scannerFrameDump=1` | tap sur la pastille : télécharge la dernière frame (PNG local, AUCUN envoi réseau, aucun stockage) — **opt-in triple** avec `?scannerDebug=1` + garde Preview. |

---

## 3. Corrections déjà réalisées et confirmées

| SHA | Contenu | Preuve |
|---|---|---|
| `43f0167` | **V3.4** : TRY_HARDER adaptatif opt-in (`?scannerTH`) + instrumentation | passées en revue dans les mips V3.4 ; performance non mesurée terrain (reconnaissance seulement simulée). |
| `2139892` | **V3.4-b (corrige critique)** : bug NotFoundException — un catch unique enveloppait les 3 passes : sur frames en échec, les passes crop **et TH n'exécutaient JAMAIS** (crepro `tools/repro-dead-passes.mts`, terrain 428L/0H · 0 ms TH cum). Après : chaque passe son propre try/catch. | repro démontré + confirmation terrain : compteur TH désormais non-zero dans les pastilles debug. |
| `8f41522` | **V3.5** : passe bande serrée opt-in + frame dump | démonstration sur capture réelle IMG_2243 (voir §4) ; **terrain non testé** (well attappé : le comportement reçu du canal Preview en test réel n'a pas été mesuré à ce jour). |

---

## 4. Résultats des expérimentations V3.4 et V3.5 — limites

### V3.4 / TH adaptatif
- TH est le mécanisme qui décroche EAN-13 **tenus à distance et légèrement inclinés** (ZXing ne tente la rotation 90 CCW du `OneDReader` que SI TRY_HARDER est actif, voir §7).
- `adaptive-boost` (TH chaque frame) et `adaptive-cooldown` (TH 1/frame sur 2) non testés terrain : ces modes exigent un A/B manuel iPhone (protocol V3.4 toujours en attente).

### V3.5 / bande serrée
- Traversée par `tools/probe-strategies-v2.mts` sur **IMG_2243** : secrète passe "tight" (crop bandeau 781×432, ×1 SANS upscale, TRY_HARDER) est la SEULE qui déchiffre le code (24 stratégies testées, dont toutes les variantes ×2/rotations/downscale).
- Réalités de mesure : IMG_2241 et IMG_2242 sont **optiquement irrécupérables** — contraste scanline 89–97/255, corrélation EAN-13 ≈ hasard (3–5 runs contre 59 attendus) : aucune stratégie logicielle ne peut lire un code dont les barres ne sont plus contrastées. Cause : sous-exposition (contre-jour/ombre), voie d'amélioration matérielle : rapprochement/éclairage, pas de logiciel décodeur.
- ⚠️ Ces preuves proviennent **d'écrans de capture screenshot** (aperçu downscalé 1206×2622), pas de frames caméra brutes : le frame dump `?scannerFrameDump=1` est en place pour confirmer sur le flux réel — **EN ATTENTE DE TESTS TERRAIN**.

### Limites générales constatées
- Instrumentation disponible mais aucune mesure A/B terrain complète menée (pas de mesure temps 1re lecture à distance définie).
- File d'attente de validation Android non démarrée (voir protocole dans `docs/mission-barcode-v3-5-distance.md` §4 : BarcodeDetector natif → la passe tight ZXing n'y tourne PAS).

---

## 5. Anomalies encore présentes (état constaté, non diagnostiquées à la source)

| Anomalie | Hypothèses testées / à tester | Statut véracité |
|---|---|---|
| **Lecture difficile à distance** | cause démontrée par la sonde scanline : sous-exposition / contraste scanline insuffisant (couvre IMG_2241/2242 comme irrécupérables). AMÉLIORATION MATERIELLE REND | démontré sur captures d'écran |
| **Dégradation après plusieurs scans** | re-négociation résolution, boucle `setTimeout` prolongée, mémoire canvas, gaspillage de frames : **non encore instrumentée (la pastille debug par session existe ; comparer évolution fps/TH cum au fil de la session)** | hypothèse non testée |
| **Flou initial** (met du temps à "trouver la netteté au démarrage du scan") | caméra démarre défocus à l'infini : `focusMode continuous` posé mais **pointsOfInterest ne place pas de focus fixe sur Apple** (capability « continuous » certains iPhone/Safari ; réaction du track non mesurée) — jamais chronométré terrain | hypothèse plausible, non démontrée |
| **Impression de réajustement de zoom** | zoom initial ×2 auto au démarrage (mandaté V3, visible en pastille `zoom value` après), et `RESOLUTION_LADDER` peut re-négocier 1× la résolution → image visible "bouge" au démarrage | hypothèse, jamais vérifiée par vidéo frame par frame |
| **Réinitialisations entre scans** | flux jamais stoppé ENTRE deux scans courtes sessions ; NEW ici à viser : la boucle `while (!stopped)` relance un `setTimeout` dépourvu de remain si la page est cachée… | à mesurer |

Le flou initial et le réajustement zent-focus et zoom apparent été aussi notés dans la **vidéo G-FLUX** fournie aujourd'hui (voir §6).

---

## 6. Analyse du comparatif vidéo G-FLUX / FOOD

### Vidéos fournies (extraites par ffmpeg, 2 frames/s)

| Vidéo | App | Durée | Contenu |
|---|---|---|---|
| `ScreenRecording_10-09-2026 22.MP4` | **FOOD (Virtuagym)** | 4,3 s | 9 frames, 1206×2622 |
| `ScreenRecording_10-09-2026 23.MP4` | **G-FLUX** | 10,8 s | 22 frames, 1206×2622 |

Identifié par l'UI : FOOD = "Log food" + pastille de modes barcode/QR ; G-FLUX = pastille verticale verte, bandeau vert encadré, bouton "Rechercher le code", "ÉéETA" Repas IA.

### Mesures objectives (sonde `tools/probe-videos-2223.mts`)
Métrique de netteté = variance du Laplacien (proxy focusn) sur la zone caméra utile (sans UI), 2 fps donc ~0,5 s/frame.

- **FOOD (vid 22) — d'un régime joueur de vidéo-contrasted sombre → clair.** Les frames f003–f005 prennent une scène plus lumineuse (lum 54→70) mais **la netteté chute 265→203→176** puis remoutée f006-f009 (sharp 456–477, lum≈243 : pose stable sur l'écran de fiche PRODUIT, IMG "Coca cola" — FOOD a DEJÀ loggé). Interprétation : FOOD la netteté chuter pendant un déplacement (netteté chiffre bas pendant scene change), et est **haute (456–477) sur la fiche produit une fois le scan TERMINÉ**. **Rien dans cette vidéo ne montre un autofocus FOOD significativement plus rapide — obs. uniquement des phases de stable : pas comparable sur la netteté startup.**
- **G-FLUX (vid 23)** : 18 frames en scène moyennement sombre (lum 92±1) ; netteté MÉDIAN (sharp 174–280, moyen 230) PUIS la scene se résout en pose claire (lum 230, sharp 336–344 static). Le passage f018→f019 (changement de scelle) : la netteté chute à 130 pendant le mouvement, remonte après résolution. **Mêmes caractéristiques que FOOD.**
- **Conclusion honnête** : les deux apps présentent le même schéma netteté basse pendant le mouvement, haute après stabilisation. **La vidéo ne démontre PAS que FOOD est "net dès l'ouverture"** — les deux vidéos commencent par une phase mobile ; il n'existe aujourd'hui **aucune preuve mesurée d'avantage autofocus côté FOOD** dans ces enregistrements. C'était le cas dans l'observation utilisateur initiale (impression subjective), non reproduit par mesure.

### Zone de lecture (constat direct sur les frames)
- **G-FLUX** : bandeau horizontal FAIBLE hauteur (gauche frame). Code nipple visible dans le downgrade du code, mais hauteur du bandeau guidé ≈ 22 % de la hauteur caméra, bandeau horizontal fin, encadré = **bande fine, tut suite de RAW image analysée (les passes plein cadre + crop 80×44 % + tight 60×18 % analysent des zones nettement plus grandes que le bandeau VISIBLE ; voir §7).**
- **FOOD** : rectangle TBI VERT hauteur très supérieure (~55 % de la zone caméra de scan), en hauteur d'encart. Il NE FAUT PAS croire que l'UI FOOD a la zone de décodage FUANT ANALYSIS réellement plus grande — **on ne voit pas le code de décodage respecter ce cadre visuel** dans les frames : aucune preuve réalisée que sa zone analysée == zone UI ; mais le cadre FOOD est plus hospitable.

### 90° (codes rotés) — constat vidéo uniquement
- L'utilisateur rapporte (peši visuel) que FOOD lit un code à 90° sur la canette. Cette vidéo ne contient AUCUN scan à 90° réussi des deux apps — pas de preuve chiffrable n de comparaison directe de rotation. **Non qualifiable terrain aujourd'hui.**

### Netteté initiale et comportement focus (remonte à §5)
- Les deux vidéos filtrent les réajustements de focus pendant le mouvement ; OBLIGÉMENT, tant que la netteté "descend" pendant analyse de la stabilité, **aucun comparatif focus startup FOOD vs G-FLUX uniforme n'est supporté par ces vidéos**.

---

## 7. Zone visuelle vs zone réellement analysée (et codes 90°)

**Démontré par lecture du code** ([barcodeScanner.ts](../src/lib/barcodeScanner.ts)) :
- L'UI encadre une bande fine ; ST le CODE analyse **la frame ENTIÈRE** en passe 1 et passe TH (plein cadre), le 80 %×44 % en passe 1.5, et le 60%×18% à la passe tight. La zone visuelle ne borne DOnc RIEN côté ZXing.
- **Rotations ZXing** : `OneDReader.decode` **ne tente la rotation 90° CCW QUE si `TRY_HARDER` est posé** ET que `isRotateSupported()` — HTMLCanvasElementLuminanceSource supporte la rotation (true). Donc : **passe 1 (léger) : 0 % de 90°** ; passe 1.5 (crop ×2 sans TH) : 0 % ; passe 2 TH : 90° disponible ; passe tight (TH forcé) : 90° disponible. **Attention au piège de la passe tight** : le crop 60 %×18 % est HORIZONTAL — un code à 90° sur la canette (barres verticales) se réduit à l'inclusion dans le crop : sa longueur d'axe est VERTICALE — la bande 18 % de hauteur peut ne capturer qu'une portion courte du code (seg. inférieure) ; la passe tight **ne re-rotte PAS le crop après extraction** — seuls les pixels du bandeau horizontal sont vus, donc 90° n'est PAS garanti par la passe tight (la rotation 90° CCW s'applique au crop, mais découpe 18% de hauteur peut COUPER le code). C'est une **hypothèse forte, non mesurée** à confirmer par une sonde géométrique (fichier non committé `tools/probe-rotation-v36.mts` écrit et capable de tester le rotage 90° du tight vs pleincadre).

**Ce que les captures IMG_2265..2297 suggèrent (photos du carnet de test)** : ces photos ont été prises HORS scanner (pas de cadre guide), pas un flux caméra représentatif du scan réel ; aucune extrait de code déchiffré par ZXing dans aucune stratégie sur ces captures — elles ne prouvent RIEN aujourd'hui.

---

## 8. Tests restants et recommandation prioritaire

### Tests à mener (protocol écrit dans `docs/mission-barcode-v3-5-distance.md`)
1. **A/B iPhone** : même boîte, même distance : session sans `?scannerCrop=tight` puis avec — mesurer temps de 1re lecture (objectif < 2000 ms), pastille debug ; identifier comment la passe tight change le manchettes (temps, distance, kg).
2. **Frame dump** : confirmer le mécanisme Tight sur **frames caméra BRUTES** (pas captures screenshot) :  `?scannerDebug=1&scannerFrameDump=1`, tap pastille, puis relancer `tools/probe-strategies-v2.mts` sur la frame reconstituée (l'outil accepte un PNG].
3. **Android** (2–3 appareils) : pastille moteur — si `native`, la passe tight ZXing n'existe pas : évaluer séparément la reconnaissance native ou cropper la frame avant `detect()`.
4. **Étude netteté initiale** (flou startup) : chronométrer le délai 1re frame→1re lecture et regarder si `focusMode continuous` est supporté (pastille : `track caps focusMode` — à afficher dans la pastille debug, **pas encore affiché**).
5. Robustesse long scan : surveiller fps/TH cum/tight cum au fil de la pastille (toutes les 1 s) : dégradation d'une session à l'autre.

### Recommandation unique (à évaluer MAIS pas à développer avant validation utilisateur)
> **Priorité : valider la passe tight V3.5 en terrain iPhone (A/B `?scannerCrop=tight`) et le frame dump brutes ; uniquement si les résultats confirment le mécanisme recadrage serré,                          envisager ensuite de permettre la passe tight d'exécuter les deux orientations (crop horizontal + crop vertical, ou rotation 90° CCW avant analyse), car la rotation ZXing n'est testée que si TH et l'orientation 90° est aujourd'hui le trou connu (aucune mesure).**

C'est la suite de le diagnostic précédent : **l'avantage de la passe tight est démontrablement réel sur un seul cas étudié (IMG_2243 screenshot)** ; il n'est pas generalisé, et les tensions restantes (flou initial, dégradation au fil des scans, 90°) n'ont pas encore de démonstration causale.

---

## 9. Instructions de sécurité — à rappeler à GPT-6 Luna

- PR #18 exclusivement ; **aucun merge** ; `main` et PR #16 intouchés ; Convex Production jamais écrit : tout le travail de schéma/fonctions (si nécessaire) doit cibler le Convex Preview `barcode-lookup-preview` (déjà documenté dans netlify.toml).
- Aucun force-push ;xBD comportement par défaut inchangé : toute nouvelle expérimentation doit rester opt-in URL + garde Preview (`__SCANNER_EXPERIMENT__`).
- Ne PAS présenter d'hypothèse comme démontrée : le dossier "preuve" complet au point §4–§7 ; les items tirés des captures d'écran sont à confirmer sur frames caméra brutes avant de conclure.
- Les outils de sonde dans `tools/probe-*.mts` sont des scripts Node (`node --experimental-strip-types tools/<name>.mts <PNG...>`) : PNG screenshotted acceptés ; il existe `probe-strategies-v2.mts`, `probe-scanline.mts`, `probe-rotation-v36.mts` (non committed, vérifier le worktree), `probe-distance-v3.mts`, `probe-videos-2223.mts` (n étact).

---

**STOP — aucun développement supplémentaire. La passation s'arrête ici ; la suite est entre les mains de GPT-6 Luna avec le consentement de l'utilisatrice.**
