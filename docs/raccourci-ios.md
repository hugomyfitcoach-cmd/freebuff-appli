# 🍎 Raccourci iOS « G-FLUX — Synchroniser mes pas »

Ce guide explique comment créer **une seule fois** le raccourci iOS qui
synchronise les pas **Apple Santé → G-FLUX** pour les 7 derniers jours,
puis comment le partager et brancher son lien dans G-FLUX.

> ⚠️ **Aucun lien iCloud fictif n'est fourni** : le raccourci se crée à la
> main dans l'app **Raccourcis** (5 minutes). Tant que
> `PUBLIC_HEALTH_SHORTCUT_URL` n'est pas renseignée, G-FLUX tente de lancer
> le raccourci **par son nom** — le bouton affiche alors une explication
> claire s'il n'est pas installé, et la saisie manuelle reste toujours
> disponible.

---

## 1. Ce que fait le raccourci

1. Il reçoit un **jeton court** de G-FLUX (via le presse-papiers, voir §5).
2. Il lit les pas **Apple Santé** des **7 derniers jours** (aujourd'hui + 6).
3. Il envoie les **7 couples date + pas** au backend G-FLUX.
4. Le backend enregistre chaque journée : **la valeur Apple Santé remplace
   l'ancienne valeur Apple Santé du jour**, jamais la correction manuelle,
   jamais en additionnant, et **aucun jour vide n'est créé en « 0 »**.

## 2. Permissions Apple Santé nécessaires

À la première exécution, iOS demande automatiquement l'autorisation :

- **Autoriser « Raccourcis » à lire : Activité → Pas (Steps)** — en
  **« Autoriser tout »** sur la date (accès à l'historique).

Si la cliente refuse ou limite, le raccourci renvoie une erreur et G-FLUX
affiche un message simple ; la saisie manuelle n'est jamais bloquée.
Pour vérifier/corriger : **Réglages → Santé → Accès aux données et
appareils → Apps → Raccourcis → Autoriser « Pas »**.

## 3. Créer le raccourci (une seule fois, par la coach ou la cliente)

Ouvrir l'app **Raccourcis** → **+** (nouveau raccourci) → renommer
exactement **« G-FLUX — Synchroniser mes pas »** (ⓘ en haut → Renommer),
puis ajouter les actions **dans cet ordre** :

### Action 1 — Récupérer le jeton G-FLUX

- **« Obtenir le presse-papiers »** (`Get Clipboard`)
  - *pourquoi* : G-FLUX place le jeton dans le presse-papiers avant
    d'ouvrir le raccourci (voir §5) — aucun ID cliente, aucun cookie,
    jeton expirant en 15 minutes, jamais stocké dans une URL permanente.

> Variante sans presse-papiers (plus robuste) : **« Demander à saisir »**
> (`Ask for Input`) — type *Texte*, question « Coller le jeton G-FLUX »,
> et l'cliente colle le jeton affiché dans G-FLUX. À retenir si le
> presse-papiers est écrasé trop vite sur son iPhone.

### Action 2 — Préparer la liste des 7 derniers jours

- **« Répéter » pour chaque jour** n'est pas nécessaire : on construit la
  fenêtre directement avec les actions Date.

Ajouter, dans l'ordre :

1. **« Date »** (`Date`) — laisser *« Date actuelle »* → c'est aujourd'hui.
2. **« Ajuster la date »** (`Adjust Date`) — branchée sur la sortie de
   l'action Date ci-dessus, réglée sur **« Ajouter » / « −1 » jour** pour
   l'itération précédente… En pratique le plus simple et le plus fiable :

   **Méthode recommandée (7 paires explicites, sans boucle)** — dupliquer
   le petit bloc suivant 7 fois (aujourd'hui, −1, −2 … −6) :

   - **« Date »** → *Aujourd'hui* (bloc n°1 uniquement ; pour les blocs
     suivants : **« Date »** puis **« Ajuster la date » −1, −2 … −6 jours**).
   - **« Formater la date »** (`Format Date`) → **Personnalisé : `yyyy-MM-dd`**
     → *ne pas cocher* l'heure. Sortie = `2026-09-16`.
   - **« Trouver échantillons santé »** (`Find Health Samples`)
     - *Type* : **Pas (Steps)**
     - *Trouver* : « Échantillons » où **« Date » est aujourd'hui** →
       relier le champ date à la **sortie de « Ajuster la date »** du bloc
       (plage *« le jour de »*).
     - *Limiter* : **1** échantillon, *Trié par* : **plus récent d'abord**
       (inutile de garder plusieurs échantillons — voir §6).
   - **« Obtenir les détails de l'échantillon santé »** (`Get Health Sample
     Details`) branchée sur la sortie de « Trouver échantillons santé » :
     cocher **« Valeur »** (nombre de pas).

   → Chaque bloc produit une **date `yyyy-MM-dd`** et une **valeur de pas**
   (0 si aucune donnée ce jour-là — c'est voulu, voir §6 pour la nuance).

3. **« Dictionnaire »** (`Dictionary`) — par bloc : ajouter la paire
   - clé **`date`** → sortie de « Formater la date » ;
   - clé **`count`** → sortie de « Obtenir les détails → Valeur ».

   Puis **« Ajouter à une liste »** (`Add to Variable` → liste `days`) ou,
   plus simple : **« Répéter avec chaque »** ne s'applique pas ici — on
   empile les dictionnaires dans une **liste** avec l'action
   **« Ajouter à la liste »** (`Append to List`), variable `days`.

### Action 3 — Envoyer les 7 couples au backend G-FLUX

- **« Obtenir le contenu de l'URL »** (`Get Contents of URL`)
  - *URL* : `https://g-flux.netlify.app/api/health/import` *(l'URL réelle
    du site G-FLUX en production — demander à Hugo si elle change)*
  - *Méthode* : **POST**
  - *En-têtes* : `Content-Type` = `application/json`
  - *Corps (JSON)* :
    ```json
    {
      "token": "<sortie de l'action 1 — Obtenir le presse-papiers>",
      "days": "<variable days — la liste des 7 dictionnaires>"
    }
    ```
    (Dans Raccourcis, insérer les variables directement dans les champs du
    corps JSON : `token` = presse-papiers, `days` = liste.)
- **« Obtenir les détails du fichier JSON »** n'est pas nécessaire : on
  affiche simplement la réponse.
- **« Afficher le résultat »** (`Show Result`) — optionnel mais utile la
  première fois : doit afficher `{"ok":true,"updated":7}`.

### Récapitulatif de la séquence complète

```
1. Obtenir le presse-papiers                          → jeton
2. Date (aujourd'hui) → Ajuster −0j → Formater yyyy-MM-dd
   → Trouver échantillons santé (Pas, ce jour, limite 1)
   → Obtenir détails → Valeur
   → Dictionnaire {date, count} → Ajouter à la liste `days`
3. Idem −1 jour … jusqu'à −6 jours                    → liste `days` (7 items)
4. Obtenir le contenu de l'URL
   POST https://<g-flux>/api/health/import
   Corps JSON { "token": jeton, "days": liste }
5. Afficher le résultat
```

## 4. Lancer le raccourci depuis G-FLUX

Sur l'écran **Mes pas** (iPhone), la cliente appuie sur
**« Connecter Apple Santé »** (première fois) puis **« Synchroniser mes
pas »** :

- G-FLUX demande au serveur un **jeton court** (15 min) et ouvre le
  raccourci via `shortcuts://run-shortcut?name=G-FLUX%20—%20Synchroniser%20mes%20pas`
  (ou, tant que le lien n'est pas branché : propose l'installation via
  `shortcuts://import-workflow/?url=…` dès que `PUBLIC_HEALTH_SHORTCUT_URL`
  est définie).
- L'cliente revient dans G-FLUX : l'écran se met à jour dès que le serveur
  confirme la synchro (polling 2,5 s) et affiche « Pas synchronisés » +
  « Dernière synchro : HH:MM ».

## 5. Transmettre le jeton (2 options — en choisir UNE)

**Option A — presse-papiers (automatique, recommandée).** G-FLUX écrit le
jeton dans le presse-papiers juste avant d'ouvrir le raccourci (iOS
affiche « G-FLUX a collé… » une fois). Le raccourci le lit avec
« Obtenir le presse-papiers ». *Limite honnête* : si la cliente copie autre
chose entre-temps, le jeton est invalide → G-FLUX affiche « jeton expiré,
relance la synchro ». C'est l'option implémentée aujourd'hui côté G-FLUX
(le jeton reste également disponible en secours : voir option B).

**Option B — saisie manuelle (100 % fiable).** Dans le raccourci,
remplacer l'action 1 par **« Demander à saisir »** (Texte, « Collez le
jeton G-FLUX ») et G-FLUX affiche le jeton dans un champ copiable avant
d'ouvrir Raccourcis. Aucune dépendance au presse-papiers.

> Ces deux options n'exposent **jamais** l'ID cliente ni le cookie de
> session : le jeton est aléatoire, hashé côté serveur, expiré en 15 min.

## 6. Précision des pas — ce que Raccourcis peut et ne peut pas faire

**La limite honnête.** Apple Santé (app Santé → Pas) affiche un total
journalier **dédupliqué** : quand iPhone **et** Apple Watch portent le
même pas, la source prioritaire (la Watch, généralement) est retenue et
l'autre ignorée. Cette déduplication utilise des métadonnées internes
(« `WasUserEntered` », priorités de sources, fenêtres d'échantillons)
**que l'app Raccourcis n'expose pas**.

Conséquences pratiques :

- **Somme naïve de tous les échantillons = double comptage** (iPhone +
  Watch → presque 2× le vrai total). **À proscrire.**
- **`Get Health Sample Details` sur la journée** (un seul échantillon
  agrégé par jour) : la méthode retenue ci-dessus. iOS agrège par défaut
  l'échantillon « Pas » de la journée **selon la même priorité de sources
  que l'app Santé** → résultat en pratique **identique ou très proche**
  du total affiché (à quelques unités près selon les écritures tardives
  des appareils pendant la journée).
- Si un écart jour par jour est constaté (rare), il vient des écritures
  d'appareils tierces (Garmin etc.) qui réécrivent la journée plus tard :
  **relancer la synchro** le lendemain corrige la journée (c'est prévu :
  les jours déjà présents sont resynchronisés).

**Méthode la plus fiable imposée ici** : « Trouver échantillons santé »
+ « Obtenir les détails » **par jour** (pas de somme d'échantillons),
**limite 1** par jour. C'est la plus proche du total affiché par Apple
Santé, sans double comptage possible.

## 7. Partager le raccourci

1. Dans Raccourcis, appui long sur **« G-FLUX — Synchroniser mes pas »** →
   **Partager** → **Copier le lien iCloud**.
2. Ce lien sert à l'**installation** : il ouvre Raccourcis et propose
   « Ajouter le raccourci ».
3. ⚠️ Le lien iCloud contient **le raccourci, pas des données** : la
   cliente de la coach doit revalider la permission Apple Santé chez elle
   (permission par appareil, jamais par lien).

## 8. Brancher le lien dans G-FLUX

1. Copier l'URL iCloud du raccourci (ex.
   `https://www.icloud.com/shortcuts/abcd1234…`).
2. La renseigner dans la variable d'environnement Netlify :
   `PUBLIC_HEALTH_SHORTCUT_URL` (Site settings → Environment variables) —
   et dans `.env.local` pour le dev. Voir `.env.example`.
3. Redéployer. Le bouton de l'écran Pas installe alors le raccourci au
   premier clic (`shortcuts://import-workflow/?url=…`) puis lance la
   synchro les fois suivantes.

> Si la variable reste vide, le bouton fonctionne quand même **par nom**
> : « G-FLUX — Synchroniser mes pas » doit alors exister sur l'iPhone.

## 9. Erreurs possibles et messages G-FLUX

| Situation | Message affiché dans G-FLUX |
| --- | --- |
| Permission Apple Santé refusée | « La synchronisation n'est pas arrivée — vérifie que le raccourci […] autorise Apple Santé » |
| Raccourci absent / non lancé | idem, avec rappel que la saisie manuelle reste disponible |
| Erreur réseau du raccourci | « Import impossible. » (réponse serveur) — relancer |
| Jeton expiré (> 15 min) | « Connexion expirée. Relance la synchronisation depuis l'app. » |
| Récupération OK | « Pas synchronisés » + « Dernière synchro : HH:MM » |

## 10. Ce que la synchro ne fait JAMAIS

- ❌ additionner la nouvelle valeur à l'ancienne ;
- ❌ écraser une correction manuelle (`manualCount` prioritaire) ;
- ❌ créer un « 0 pas » pour une journée sans donnée Apple Santé ;
- ❌ toucher aux autres données de la cliente (aucune migration).

La valeur **effective** reste, pour chaque journée : `manualCount ?? healthCount`.

## 11. Checklist de tests (validation avant mise en production)

| # | Scénario | Résultat attendu |
| --- | --- | --- |
| 1 | Première connexion (bouton « Connecter Apple Santé », iPhone) | Raccourci ouvert, jeton dans le presse-papiers, permission Pas demandée |
| 2 | Installation/lancement du raccourci | Raccourci ajouté puis lancé depuis G-FLUX ; sans lien iCloud configuré, lancement par le nom |
| 3 | Import des 7 derniers jours | 7 lignes créées/mises à jour (`healthCount`), `count` = valeur Apple Santé, « Pas synchronisés » + « Dernière synchro : HH:MM » |
| 4 | Nouvelle synchro le même jour | `healthCount` remplacé par la nouvelle valeur (jamais additionnée), `manualCount` intact |
| 5 | Mise à jour d'un ancien jour déjà importé | Ce jour-là `healthCount` mis à jour, les autres jours aussi, aucune perte |
| 6 | Journée sans donnée Apple Santé | Aucune ligne créée, jour absent des stats (pas de faux 0) |
| 7 | Modification manuelle après synchro | `manualCount` enregistré, affichage = correction, badge « Corrections manuelles » visible |
| 8 | Nouvelle synchro après modification manuelle | `healthCount` mis à jour, `manualCount` conservé, affichage = correction |
| 9 | Conservation de la correction (exemple de la mission : AS 8 000 → correction 9 000 → AS 8 400) | `healthCount` 8 400, `manualCount` 9 000, affiché 9 000 |
| 10 | « Revenir à la valeur Apple Santé » | `manualCount` supprimé, affichage = dernière valeur AS ; sans valeur AS : erreur explicite, rien d'effacé |
| 11 | Refus permission Apple Santé | Message simple côté G-FLUX, saisie manuelle intacte |
| 12 | Raccourci absent | Message « La synchronisation n'est pas arrivée… » + saisie manuelle intacte |
| 13 | Erreur réseau / jeton expiré (15 min) | Message « Connexion expirée. Relance la synchronisation depuis l'app. » |
| 14 | Retour dans G-FLUX après synchro | Écran actualisé automatiquement (polling 2,5 s), Accueil et CRM alignés (même table) |

> Tests 1 à 14 réalisables sur l'iPhone de la cliente **après** création du
> raccourci (§3) ; les scénarios 6, 9 et 10 se vérifient en 2 minutes depuis
> l'écran « Mes pas ».
