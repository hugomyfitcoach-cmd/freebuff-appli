# Guide écran par écran

Pour chaque écran : fichier de maquette, ce qu'il faut reproduire, animations et interactions détectées dans le code de la maquette (les animations sont toutes coupées sous `prefers-reduced-motion`). **Rappel : la maquette est une référence esthétique. Tout ce que l'app actuelle fait en plus (boutons, menus, formulaires, états) doit être conservé.** Les textes et chiffres de la maquette sont des exemples, pas des données.

Animations communes (définies dans chaque maquette, valeurs à reprendre) : `fadeUp` 280 ms (cartes en cascade, délais de 0 à ~180 ms), `screenIn` 240 ms, `sheetUp` 280 ms, `drawIn` 900 ms (courbes), `barIn / barUp` 600 ms, `ringIn` 800 ms, retour tactile `scale(.97)` 150 ms. Courbe : `cubic-bezier(.2,.8,.2,1)`.

## 1 · Liste des repas
- Maquette : `reference/maquettes/Main.dc.html`
- Titres visibles : Ajouter un aliment
- Boutons / liens visibles : Repas · Recherche · Tous les produits · Créés par moi · Ajouter un nouveau repas · Code-barres · Repas IA BÊTA
- Navigation prévue vers : `Foods`, `Meal-AI`, `Meal-Edit`, `Scanner`, `Search`
- Interactions dans la maquette : `item.remove`
- États pilotés par la maquette : `removed`
- Animations : fondu d'écran à l'ouverture; retour tactile (scale .97, 150 ms)

## 2 · Modification d'un repas
- Maquette : `reference/maquettes/Meal-Edit.dc.html`
- À reproduire : Création / modification d'un repas : cartes de macros réduites, liste d'ingrédients défilante plus haute. Valeurs d'exemple FICTIVES.
- Titres visibles : Modifier le repas · Ingrédients
- Boutons / liens visibles : Ajouter un produit · Importer une recette avec l'IA BÊTA · Repas · Enregistrer le repas
- Navigation prévue vers : `Main`
- Interactions dans la maquette : `ing.remove`, `setDesc`, `setName`
- États pilotés par la maquette : `desc`, `name`, `removed`
- Animations : retour tactile (scale .97, 150 ms)
- ⚠ Cette maquette ne déclare pas `prefers-reduced-motion` : le règle globale de `pwa/adapt.css` doit s'appliquer.

## 3 · Aliments créés par moi
- Maquette : `reference/maquettes/Foods.dc.html`
- Titres visibles : Ajouter un aliment
- Boutons / liens visibles : Créés par moi · Recherche · Tous les produits · Repas · Créer un aliment · Code-barres · Repas IA BÊTA
- Navigation prévue vers : `Food-Edit`, `Main`, `Meal-AI`, `Scanner`, `Search`
- Interactions dans la maquette : `item.remove`
- États pilotés par la maquette : `removed`
- Animations : fondu d'écran à l'ouverture; retour tactile (scale .97, 150 ms)

## 4 · Modification d'un aliment
- Maquette : `reference/maquettes/Food-Edit.dc.html`
- Titres visibles : Modifier l'aliment
- Boutons / liens visibles : Prendre une photo · Choisir dans la galerie · Mes aliments · Enregistrer l'aliment
- Navigation prévue vers : `Foods`
- Interactions dans la maquette : `f.set`, `n.set`
- Animations : retour tactile (scale .97, 150 ms)
- ⚠ Cette maquette ne déclare pas `prefers-reduced-motion` : le règle globale de `pwa/adapt.css` doit s'appliquer.

## 5 · Accueil
- Maquette : `reference/maquettes/Home.dc.html`
- À reproduire : Carte Calories compactée (chiffre 44 px). Carte « HYDRATATION » sous « Pas ». En-tête : logo G-FLUX (variante « lockup »), bouton actualiser et avatar « HG » (placeholder), 34 px visibles avec zone sensible de 44 px ; l'en-tête reste fixe au scroll avec un léger dégradé de fondu en dessous. Carte Performance (colonnes MOYENNE / OBJECTIF / DÉFICIT, barre de progression, pastille « Voir › »), histogramme des pas, raccourcis (Entraînement, Recettes, Drive, Bilans), barre du bas flottante à 3 onglets. À l'arrivée sur l'onglet, les cartes se « rafraîchissent » en cascade : règle ouverture / retour d'onglet dans `reference/passation/Handoff-PWA.dc.html` (section 9).
- Titres visibles : Bonjour Hugo · Aujourd'hui
- Boutons / liens visibles : Entraînement · Ajouter · HG · Recettes · Drive · Bilans · Accueil · Journal · Progression
- Navigation prévue vers : `Bilans`, `Cycle`, `Depense`, `Drive`, `Hydratation`, `Journal`, `Nutrition`, `Performance`, `Progress`, `Recap`, `Steps`
- Animations : fondu d'écran à l'ouverture; tracé de courbe animé (drawIn); barre horizontale qui se remplit; barres verticales qui montent; anneau qui se remplit; retour tactile (scale .97, 150 ms)

## 5b · Mon hydratation (nouveau)
- Maquette : `reference/maquettes/Hydratation.dc.html` (route `/hydratation`). Accessible depuis la carte « HYDRATATION » de l'accueil, placée juste sous la carte « Pas » (carte entièrement cliquable).
- À reproduire : en-tête identique à « Mes pas » (retour Accueil, actualiser, avatar). Carte « Aujourd'hui » : anneau de progression (112 px), total en ml, objectif, pastille « Il reste X ml » / « Objectif atteint », bouton « Objectif » qui ouvre l'édition de l'objectif quotidien (500–6 000 ml). Carte « Ajouter de l'eau » : boutons rapides +150 / +250 / +500 ml, saisie libre en ml, lien « Annuler le dernier ajout ». Carte « 7 derniers jours » : histogramme avec ligne d'objectif en pointillé (barres vertes si objectif atteint, noires sinon). Carte « Historique par jour » : 7 lignes (total, %, jauge), dépliables pour voir les prises horodatées.
- Interactions dans la maquette : `add`, `addCustom`, `setCustom`, `toggleGoal`, `setGoalDraft`, `saveGoal`, `undo`, `r.toggle`
- Données fictives : 7 jours (7 au 13 oct.), objectif 2 500 ml ; à remplacer par les vraies données. Aucune persistance dans la maquette.
- Carte accueil : valeurs figées (1 250 / 2 500 ml, 50 %) ; la carte et l'écran ne partagent pas d'état dans la maquette.
- Animations : fondu d'écran, cascade fadeUp, anneau (ringIn + transition de dasharray), barres (barUp), pulsation du total à l'ajout (popA 300 ms), jauge de l'historique (transition largeur 400 ms) ; désactivées avec `prefers-reduced-motion`.

## 6 · Progression
- Maquette : `reference/maquettes/Progress.dc.html`
- À reproduire : Progression : cartes de courbes interactives (survol / toucher = infobulle), accès aux pages de détail (Poids, Partie la plus fine, Fessiers, Tour de cou, Masse grasse).
- Titres visibles : Ma progression
- Boutons / liens visibles : HG · Accueil · Modifier · Enregistrer une valeur · Journal · Progression
- Navigation prévue vers : `Home`, `Journal`, `Sheet-Taille`
- Interactions dans la maquette : `c.leave`, `c.move`
- États pilotés par la maquette : `hov`
- Animations : fondu d'écran à l'ouverture; tracé de courbe animé (drawIn); retour tactile (scale .97, 150 ms)

## 7 · Journal
- Maquette : `reference/maquettes/Journal.dc.html`
- À reproduire : Sections repas compactes (4 pictogrammes de repas minimalistes), lignes d'aliments compactes, calendrier en popover, barre flottante des macros (à conserver), jauge de calories dont la couleur suit la règle officielle (vert / orange / rouge, voir CHARTE_GRAPHIQUE.md). Jours futurs : macros grisées `#9aa19a`.
- Boutons / liens visibles : Aujourd'hui · Accueil · Journal · Progression
- Navigation prévue vers : `Home`, `Progress`, `Search`
- Interactions dans la maquette : `closeTip`, `d.pick`, `goToday`, `it.toggle`, `nextDay`, `nextMonth`, `prevDay`, `prevMonth`, `toggleCal`
- États pilotés par la maquette : `cal`, `cm`, `day`, `done`, `scrolled`, `tipOpen`
- Animations : fondu d'écran à l'ouverture; retour tactile (scale .97, 150 ms)

## 8 · Recherche · Tous les produits
- Maquette : `reference/maquettes/Search.dc.html`
- Titres visibles : Ajouter un aliment · TES ALIMENTS FRÉQUENTS
- Boutons / liens visibles : Tous les produits · Recherche · Repas · Créés par moi · Code-barres · Repas IA BÊTA
- Navigation prévue vers : `Food-Detail`, `Foods`, `Journal`, `Main`, `Meal-AI`, `Scanner`
- Interactions dans la maquette : `p.toggle`, `toggleFav`
- États pilotés par la maquette : `favOnly`, `favs`
- Animations : fondu d'écran à l'ouverture; retour tactile (scale .97, 150 ms)

## 9 · Drive
- Maquette : `reference/maquettes/Drive.dc.html`
- À reproduire : Tuiles de fichiers (images / documents) réorganisées, texte centré dans la carte.
- Titres visibles : Drive
- Boutons / liens visibles : HG · Accueil · Journal · Progression
- Navigation prévue vers : `Home`, `Journal`, `Progress`
- Animations : retour tactile (scale .97, 150 ms)
- ⚠ Cette maquette ne déclare pas `prefers-reduced-motion` : le règle globale de `pwa/adapt.css` doit s'appliquer.

## 10 · Mes bilans
- Maquette : `reference/maquettes/Bilans.dc.html`
- Titres visibles : Mes bilans
- Boutons / liens visibles : HG · REMPLIR LA SEMAINE · Accueil · Journal · Progression
- Navigation prévue vers : `Home`, `Journal`, `Progress`
- Animations : retour tactile (scale .97, 150 ms)
- ⚠ Cette maquette ne déclare pas `prefers-reduced-motion` : le règle globale de `pwa/adapt.css` doit s'appliquer.

## 11 · Calibrage
- Maquette : `reference/maquettes/Calibrage.dc.html`
- Titres visibles : Calibrage · Convertisseur cru · cuit · À entrer dans ton app
- Boutons / liens visibles : HG · Cru Cuit · Calories invisibles · Mes protéines · Ma semaine · Cyclage · Cru (avant cuisson) · Cuit (dans l'assiette) · Accueil · Journal · Progression
- Navigation prévue vers : `Home`, `Journal`, `Progress`
- Interactions dans la maquette : `pickCooked`, `pickRaw`
- États pilotés par la maquette : `mode`
- Animations : retour tactile (scale .97, 150 ms)
- ⚠ Cette maquette ne déclare pas `prefers-reduced-motion` : le règle globale de `pwa/adapt.css` doit s'appliquer.

## 12 · Nutrition & recettes
- Maquette : `reference/maquettes/Nutrition.dc.html`
- Titres visibles : Nutrition & recettes · RECETTES · ACCOMPAGNEMENTS · GUIDES SPÉCIAUX
- Boutons / liens visibles : HG · Accueil · Petit-déjeuner 20 · Déjeuner 30 · Dîner 30 · Snacks 20 · Desserts allégés 5 · Féculents 15 · Légumes & épices 15 · Repas volume 10 · Kéto 15 · Journal · Progression
- Navigation prévue vers : `Home`, `Journal`, `Progress`, `Recipes`
- Animations : retour tactile (scale .97, 150 ms)
- ⚠ Cette maquette ne déclare pas `prefers-reduced-motion` : le règle globale de `pwa/adapt.css` doit s'appliquer.

## 13 · Recettes
- Maquette : `reference/maquettes/Recipes.dc.html`
- Titres visibles : Recettes · DÉJEUNER · 30 RECETTES · 1 PORTION · Bowl poulet rôti quinoa épinards citron
- Boutons / liens visibles : PETIT-DÉJEUNER 20 · DÉJEUNER 30 · DÎNER 30 · Dans Mes repas · Toutes les sections · Accueil · Journal · Progression
- Navigation prévue vers : `Home`, `Journal`, `Nutrition`, `Progress`
- Interactions dans la maquette : `toggle`
- États pilotés par la maquette : `open`
- Animations : retour tactile (scale .97, 150 ms)
- ⚠ Cette maquette ne déclare pas `prefers-reduced-motion` : le règle globale de `pwa/adapt.css` doit s'appliquer.

## 14 · Messages
- Maquette : `reference/maquettes/Messages.dc.html`
- Titres visibles : Messages
- Boutons / liens visibles : HG · Accueil · Journal · Progression
- Navigation prévue vers : `Home`, `Journal`, `Progress`
- Animations : fondu d'écran à l'ouverture; apparition des cartes en cascade (fadeUp, délais inline); retour tactile (scale .97, 150 ms)

## 15 · Dépense sportive
- Maquette : `reference/maquettes/Depense.dc.html`
- Titres visibles : Dépense sportive
- Boutons / liens visibles : HG · Ajouter · Ajouter une activité · Accueil · Journal · Progression
- Navigation prévue vers : `Home`, `Journal`, `Progress`
- Interactions dans la maquette : `next`, `prev`
- États pilotés par la maquette : `w`
- Animations : fondu d'écran à l'ouverture; apparition des cartes en cascade (fadeUp, délais inline); retour tactile (scale .97, 150 ms)

## 16 · Guide des mesures & photos
- Maquette : `reference/maquettes/Guide.dc.html`
- Titres visibles : Bien prendre tes mesures & tes photos
- Boutons / liens visibles : HG · Progression · Accueil · Journal
- Navigation prévue vers : `Home`, `Journal`, `Progress`
- Animations : fondu d'écran à l'ouverture; apparition des cartes en cascade (fadeUp, délais inline); retour tactile (scale .97, 150 ms)

## 17 · Poids · historique
- Maquette : `reference/maquettes/Poids.dc.html`
- À reproduire : Détail : grande valeur + pastille de variation (flèche haut / bas / stable + valeur + unité, sans texte « depuis la dernière prise »), courbe interactive, bouton « Enregistrer une valeur » (ouvre Sheet-Poids), historique compact (lignes de 40 px, stylo d'édition à côté de la date).
- Titres visibles : Poids
- Boutons / liens visibles : HG · Retour · Enregistrer une valeur · Accueil · Journal · Progression
- Navigation prévue vers : `Home`, `Journal`, `Progress`, `Sheet-Poids`
- Interactions dans la maquette : `leave`, `move`, `r.pick`
- États pilotés par la maquette : `hov`
- Animations : fondu d'écran à l'ouverture; apparition des cartes en cascade (fadeUp, délais inline); tracé de courbe animé (drawIn); retour tactile (scale .97, 150 ms)

## 18 · Partie la plus fine
- Maquette : `reference/maquettes/Partie-fine.dc.html`
- À reproduire : Même gabarit que Poids ; « Enregistrer une valeur » ouvre Sheet-Mesures.
- Titres visibles : Partie la plus fine
- Boutons / liens visibles : HG · Retour · Enregistrer une valeur · Accueil · Journal · Progression
- Navigation prévue vers : `Home`, `Journal`, `Progress`, `Sheet-Mesures`
- Interactions dans la maquette : `leave`, `move`, `r.pick`
- États pilotés par la maquette : `hov`
- Animations : fondu d'écran à l'ouverture; apparition des cartes en cascade (fadeUp, délais inline); tracé de courbe animé (drawIn); retour tactile (scale .97, 150 ms)

## 19 · Performance
- Maquette : `reference/maquettes/Performance.dc.html`
- À reproduire : Page Performance de la semaine : anneaux et barres animés. Seuils d'état d'origine de la maquette conservés, simplement recolorés.
- Titres visibles : Performance
- Boutons / liens visibles : HG · Accueil · Journal · Progression
- Navigation prévue vers : `Home`, `Journal`, `Progress`
- Interactions dans la maquette : `d.pick`
- États pilotés par la maquette : `sel`
- Animations : fondu d'écran à l'ouverture; apparition des cartes en cascade (fadeUp, délais inline); barres verticales qui montent; retour tactile (scale .97, 150 ms)

## 20 · Mon cycle
- Maquette : `reference/maquettes/Cycle.dc.html`
- Titres visibles : Mon cycle · Menstruations
- Boutons / liens visibles : HG · Modifier mes informations · Je n'ai plus de règles régulières · Enregistrer · Annuler · Accueil · Journal · Progression
- Navigation prévue vers : `Home`, `Journal`, `Progress`
- Interactions dans la maquette : `closeEdit`, `o.pick`, `openEdit`, `toggleIrr`
- États pilotés par la maquette : `edit`, `irr`, `opt`
- Animations : fondu d'écran à l'ouverture; apparition des cartes en cascade (fadeUp, délais inline); tracé de courbe animé (drawIn); retour tactile (scale .97, 150 ms)

## 21 · Mes pas
- Maquette : `reference/maquettes/Steps.dc.html`
- Titres visibles : Mes pas
- Boutons / liens visibles : HG · Enregistrer · Annuler · Accueil · Journal · Progression
- Navigation prévue vers : `Home`, `Journal`, `Progress`
- Interactions dans la maquette : `closeWeek`, `openWeek`, `r.set`, `saveToday`, `saveWeek`, `setToday`
- États pilotés par la maquette : `draft`, `saved`, `today`, `view`
- Animations : fondu d'écran à l'ouverture; apparition des cartes en cascade (fadeUp, délais inline); retour tactile (scale .97, 150 ms)

## 22 · Paramètres
- Maquette : `reference/maquettes/Settings.dc.html`
- Titres visibles : Paramètres
- Boutons / liens visibles : HG · Enregistrer · Mettre à jour · Se déconnecter · Retour · Accueil · Journal · Progression
- Navigation prévue vers : `Home`, `Journal`, `Progress`, `Recap`
- Interactions dans la maquette : `save`, `setName`
- États pilotés par la maquette : `name`, `saved`
- Animations : fondu d'écran à l'ouverture; apparition des cartes en cascade (fadeUp, délais inline); retour tactile (scale .97, 150 ms)

## 23 · Récap de la semaine · menu profil
- Maquette : `reference/maquettes/Recap.dc.html`
- Boutons / liens visibles : HG · G-FLUX est installée · Modifier ma photo · Retirer ma photo · Déconnexion · Accueil · Journal · Progression · Paramètres
- Navigation prévue vers : `Home`, `Journal`, `Progress`, `Settings`
- Interactions dans la maquette : `close`, `toggle`
- États pilotés par la maquette : `open`
- Animations : fondu d'écran à l'ouverture; apparition des cartes en cascade (fadeUp, délais inline); feuille qui monte du bas (sheetUp); anneau qui se remplit; retour tactile (scale .97, 150 ms)

## 24 · Saisie des mensurations
- Maquette : `reference/maquettes/Sheet-Mesures.dc.html`
- À reproduire : Feuille de saisie des mensurations.
- Boutons / liens visibles : Enregistrer les mensurations
- Navigation prévue vers : `Progress`
- Interactions dans la maquette : `f.set`
- États pilotés par la maquette : `v`
- Animations : fondu d'écran à l'ouverture; feuille qui monte du bas (sheetUp); voile qui apparaît (scrimIn); retour tactile (scale .97, 150 ms)

## 25 · Saisie de la taille
- Maquette : `reference/maquettes/Sheet-Taille.dc.html`
- Boutons / liens visibles : Enregistrer la taille
- Navigation prévue vers : `Progress`
- Interactions dans la maquette : `set`
- États pilotés par la maquette : `v`
- Animations : fondu d'écran à l'ouverture; feuille qui monte du bas (sheetUp); voile qui apparaît (scrimIn); retour tactile (scale .97, 150 ms)

## 26 · Fiche aliment · ajout
- Maquette : `reference/maquettes/Food-Detail.dc.html`
- À reproduire : Fiche aliment (ajout) : titre, onglets Grammes / Repères G-FLUX, quantité au centre avec − / + et pastilles de quantités, 4 colonnes de macros (Calories / Glucides / Protéines / Lipides, sans pictogrammes), sélecteur de repas à 4 boutons avec pictogrammes, cœur favori vert animé. Aucun scroll : tout tient sur un écran, actions fixes en bas. Les chiffres glissent à chaque changement de quantité.
- Titres visibles : Fromage blanc nature 0%MG - 1kg
- Boutons / liens visibles : Ajouter au journal
- Navigation prévue vers : `Journal`, `Search`
- Interactions dans la maquette : `c.pick`, `m.pick`, `minus`, `plus`, `t.pick`, `toggleFav`
- États pilotés par la maquette : `amt`, `fav`, `meal`, `tab`
- Animations : fondu d'écran à l'ouverture; apparition des cartes en cascade (fadeUp, délais inline); chiffres qui glissent à chaque changement; fondu/glissement entre onglets; pulsation du cœur favori; éclat sur le cœur; retour tactile (scale .97, 150 ms)

## 27 · Fiche aliment · édition
- Maquette : `reference/maquettes/Food-Banane.dc.html`
- À reproduire : Fiche aliment (édition d'une entrée du journal) : même structure que Food-Detail + boutons Supprimer (danger `#ff4444`), Enregistrer, Remettre en planifié. Aucun scroll. Prévoir en réel un titre limité à 2 lignes.
- Titres visibles : Banane, chair sans peau, crue
- Boutons / liens visibles : Supprimer · Enregistrer · Remettre en planifié
- Navigation prévue vers : `Journal`
- Interactions dans la maquette : `c.pick`, `m.pick`, `minus`, `plus`, `t.pick`
- États pilotés par la maquette : `amt`, `fav`, `meal`, `tab`
- Animations : fondu d'écran à l'ouverture; apparition des cartes en cascade (fadeUp, délais inline); chiffres qui glissent à chaque changement; fondu/glissement entre onglets; retour tactile (scale .97, 150 ms)

## 28 · Scanner de codes-barres
- Maquette : `reference/maquettes/Scanner.dc.html`
- À reproduire : Aperçu caméra (cadre large et bas pour codes-barres, ligne de balayage), bouton flash rond en haut à gauche (vert quand actif), croix de fermeture en haut à droite, pastille de zoom « 1× / 2× » en bas, champ de saisie du code avec flèche de validation intégrée (grise tant que < 8 chiffres : seuil de la maquette, à remplacer par la validation existante), barre de mode à 3 entrées (Recherche / Code-barres / Repas IA BÊTA).
- Boutons / liens visibles : Recherche · Code-barres · Repas IA BÊTA
- Navigation prévue vers : `Food-Detail`, `Meal-AI`, `Search`
- Interactions dans la maquette : `setCode`, `toggleFlash`, `toggleZoom`
- États pilotés par la maquette : `code`, `flash`, `zoom`
- Animations : fondu d'écran à l'ouverture; apparition des cartes en cascade (fadeUp, délais inline); apparition de la caméra; apparition de la barre de mode; ligne de balayage; retour tactile (scale .97, 150 ms)

## 29 · Analyse ton repas (IA)
- Maquette : `reference/maquettes/Meal-AI.dc.html`
- À reproduire : « Analyse ton repas » : sélecteur de repas avec les mêmes pictogrammes que le Journal, zone de saisie / photo, bouton d'analyse. Transition discrète lors du changement de mode dans la barre du bas.
- Boutons / liens visibles : Prendre une photo · Photothèque · Analyser mon repas
- Navigation prévue vers : `Journal`
- Interactions dans la maquette : `m.pick`, `setText`
- États pilotés par la maquette : `meal`, `text`
- Animations : fondu d'écran à l'ouverture; apparition des cartes en cascade (fadeUp, délais inline); feuille qui monte du bas (sheetUp); voile qui apparaît (scrimIn); retour tactile (scale .97, 150 ms)

## 30 · Journal · sélection
- Maquette : `reference/maquettes/Journal-Select.dc.html`
- À reproduire : Mode sélection du Journal : mêmes cartes macros que le Journal classique (anneaux), SANS pictogrammes. La liste défile, la barre d'actions reste fixe.
- Titres visibles : Petit-déjeuner · Déjeuner · Dîner · Collations
- Boutons / liens visibles : Dupliquer · Repas · Planifier · Supprimer · Annuler
- Navigation prévue vers : `Journal`
- Interactions dans la maquette : `del`, `it.toggle`, `selectAll`
- États pilotés par la maquette : `items`
- Animations : fondu d'écran à l'ouverture; apparition des cartes en cascade (fadeUp, délais inline); barre horizontale qui se remplit; anneau qui se remplit; retour tactile (scale .97, 150 ms)

## 31 · Connexion
- Maquette : `reference/maquettes/Login.dc.html`
- À reproduire : Connexion : fond doux, carte de saisie, logo, pied de page avec logo dans le flux (pas en absolu), safe areas. « Mot de passe oublié ? » et la bascule Espace coach / client sont purement visuels dans la maquette : garder la logique d'authentification existante.
- Titres visibles : Connexion à G-FLUX
- Boutons / liens visibles : Espace coach · Espace client · Mot de passe oublié ? · Se connecter
- Navigation prévue vers : `Home`
- Interactions dans la maquette : `pickClient`, `pickCoach`, `setEmail`, `setPwd`, `toggleShow`
- États pilotés par la maquette : `email`, `pwd`, `role`, `show`
- Animations : fondu d'écran à l'ouverture; retour tactile (scale .97, 150 ms)

## 32 · Fessiers · détail
- Maquette : `reference/maquettes/Fessiers.dc.html`
- À reproduire : Même gabarit que Poids ; « Enregistrer une valeur » ouvre Sheet-Mesures.
- Titres visibles : Fessiers
- Boutons / liens visibles : HG · Retour · Enregistrer une valeur · Accueil · Journal · Progression
- Navigation prévue vers : `Home`, `Journal`, `Progress`, `Sheet-Mesures`
- Interactions dans la maquette : `leave`, `move`, `r.pick`
- États pilotés par la maquette : `hov`
- Animations : fondu d'écran à l'ouverture; apparition des cartes en cascade (fadeUp, délais inline); tracé de courbe animé (drawIn); retour tactile (scale .97, 150 ms)

## 33 · Tour de cou · détail
- Maquette : `reference/maquettes/Cou.dc.html`
- À reproduire : Même gabarit que Poids ; « Enregistrer une valeur » ouvre Sheet-Mesures.
- Titres visibles : Tour de cou
- Boutons / liens visibles : HG · Retour · Enregistrer une valeur · Accueil · Journal · Progression
- Navigation prévue vers : `Home`, `Journal`, `Progress`, `Sheet-Mesures`
- Interactions dans la maquette : `leave`, `move`, `r.pick`
- États pilotés par la maquette : `hov`
- Animations : fondu d'écran à l'ouverture; apparition des cartes en cascade (fadeUp, délais inline); tracé de courbe animé (drawIn); retour tactile (scale .97, 150 ms)

## 34 · Masse grasse · détail
- Maquette : `reference/maquettes/Masse-grasse.dc.html`
- À reproduire : Même gabarit, mais valeur NON éditable (calculée) : pas de stylo ni de bouton d'enregistrement. Courbe violette `#A855F7` : couleur absente de la charte, à arbitrer (voir CHARTE_GRAPHIQUE.md).
- Titres visibles : % de masse grasse estimé
- Boutons / liens visibles : HG · Retour · Accueil · Journal · Progression
- Navigation prévue vers : `Home`, `Journal`, `Progress`
- Interactions dans la maquette : `leave`, `move`, `r.pick`
- États pilotés par la maquette : `hov`
- Animations : fondu d'écran à l'ouverture; apparition des cartes en cascade (fadeUp, délais inline); tracé de courbe animé (drawIn); retour tactile (scale .97, 150 ms)

## 35 · Saisie du poids
- Maquette : `reference/maquettes/Sheet-Poids.dc.html`
- À reproduire : Feuille de saisie du poids (distincte de la saisie des mensurations).
- Boutons / liens visibles : Enregistrer le poids
- Navigation prévue vers : `Progress`
- Interactions dans la maquette : `set`
- États pilotés par la maquette : `v`
- Animations : fondu d'écran à l'ouverture; feuille qui monte du bas (sheetUp); voile qui apparaît (scrimIn); retour tactile (scale .97, 150 ms)
