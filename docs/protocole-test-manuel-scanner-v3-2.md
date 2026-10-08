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

## 5. Confidentialité

La pastille n'affiche que des mesures techniques. Aucune image n'est
capturée, stockée ou transmise ; aucun identifiant personnel dans les logs.
