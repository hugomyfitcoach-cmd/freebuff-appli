# Scanner codes-barres V3 — Protocole de test manuel (Android / iPhone)

Objectif : mesurer l'amélioration réelle de reconnaissance à distance, sans
supposition. À exécuter sur la Deploy Preview de la branche `fix/barcode-lookup`
(avant/après : comparer avec la Preview de `origin/main` — chaque branche
expose son propre scanner sur son propre Convex Preview).

## 0. Mesure de la résolution réelle (nouveauté V3)

Ouvrir la console navigateur à distance (Android : `chrome://inspect` via USB ;
iOS : Safari → Développer) et, pendant le scan, exécuter :

```js
document.querySelectorAll('video').forEach(v => console.log(v.videoWidth, v.videoHeight));
```

Noter la valeur : si ≥ 1280, le track est bon. Si 640 : le téléphone est
limité — la re-négociation V3 aura déjà tenté 1920 (vérifier en console via
`navigator.mediaDevices.getUserMedia` debug si besoin).

## 1. Conditions

- Emballages : 1 petit code (bouteille), 1 grand (conserve), 1 emballage brillant.
- Éclairage : intérieur standard, puis lampe torche off/on.
- Distances : ~10–15 cm, ~20–25 cm, ~30–35 cm (si lisible à l'œil).
- Chaque essai : chronométrage « présentation du code → ouverture de la fiche ».
- 5 essais par configuration ; noter les échecs.

## 2. Grille de mesure

| Configuration | Android avant | Android après | iPhone avant | iPhone après |
|---|---|---|---|---|
| 10–15 cm, éclairage standard | | | | |
| 20–25 cm | | | | |
| 30–35 cm | | | | |
| Petit code, 20–25 cm | | | | |
| Grand code, 20–25 cm | | | | |
| Emballage brillant | | | | |
| Léger mouvement de la main | | | | |

Mesures par case : temps médian (s), % réussite, nb tentatives, faux positifs.

## 3. Cas fonctionnels à vérifier sur chaque appareil

- [ ] Code valide → fiche ouverte, bon produit.
- [ ] Aucun faux positif (pas de fiche sur un code logistique / QR / partielle).
- [ ] Saisie manuelle : toujours fonctionnelle (champ + « Rechercher le code »).
- [ ] Mode manuel : caméra repliée, « Reprendre le scan » relance correctement.
- [ ] Mise en arrière-plan puis retour : pas de lecture fantôme, pas de doublon.
- [ ] Fiche produit fermée → retour au scanner : l'aperçu se relance (pas de noir).
- [ ] Réouverture après navigation : flux vidéo unique (pas de double caméra).
- [ ] Permission refusée : message dédié + « Réessayer ».
- [ ] Zoom slider : démarre sur la valeur réellement appliquée (V3).
- [ ] Lampe : marche/arrêt, sans conflit avec le décodage.
- [ ] Consigne lisible au-dessus des contrôles, aucune superposition.

## 4. Cible indicative

Lecture < 2 s dans la grande majorité des cas quand le code est net et
suffisamment visible. Non garantie universellement (matériel, éclairage).

## 5. Non-objectifs

- Pas de validation de l'amélioration « Android » sans ce protocole exécuté
  sur un Android réel (les tests automatisés ne remplacent pas la caméra).
- Aucune image/vidéo conservée : tout reste local à l'appareil de test.
