# G-Flux — Suivi coaching

Suivi hebdo des client·e·s de coaching **G-Flux** : formulaire de bilan,
espace client (historique + progression) et CRM coach, avec comptes
**email + mot de passe** et données stockées sur **Convex Cloud**
(déploiement `calm-jaguar-475`, uniquement en production).

---

## 🔑 Les accès

| Qui | Page | Compte |
| --- | --- | --- |
| **Coach (toi)** | `/connexion` → `/admin` | email + mot de passe (rôle coach) |
| **Client·e** | `/connexion` → `/espace` | email + mot de passe (rôle client) |
| Formulaire de bilan | `/bilan` | réservé aux comptes clients connectés |
| Guide nutrition & recettes | `/recettes` | tout compte connecté (client **ou** coach) |
| Outils & calibrage | `/outils` | tout compte connecté (client **ou** coach) |
| Page d'accueil | `/` | redirige automatiquement : non connecté → `/connexion`, client → `/espace`, coach → `/admin` |

Ton compte coach (`COACH_EMAIL` / `COACH_PASSWORD`) est dans `.env.local`.
Les comptes clients sont créés **par le coach** depuis le CRM (`/admin`) :
prénom + email + mot de passe, puis tu transmets les identifiants par
WhatsApp. Chaque compte est unique (email) et les mots de passe sont
hashés (PBKDF2, sel aléatoire) — jamais stockés en clair.

## 🚀 Démarrer

```bash
source .tools/activate     # Node est embarqué dans le projet
npm install                # si ce n'est pas déjà fait
cp .env.example .env.local # puis remplis les secrets (voir plus bas)
npm run dev                # Convex (push auto sur le déploiement) + site
```

→ **http://localhost:5173** redirige (connexion / espace / admin selon ton statut),
**/bilan** (formulaire hebdo), **/espace** (côté client), **/admin** (CRM coach),
**/recettes** (guide nutrition — accessible aux deux rôles), **/outils**
(la barre d'outils Calibrage — accessible aux deux rôles).

**Navigation** : une **barre latérale à gauche** (sur mobile : bandeau en
haut défilable) regroupe les pages de chaque espace — logo G-Flux, liens
de navigation, accès au guide recettes et aux outils, et déconnexion en bas.

## 🛡️ Authentification & sécurité

- **Session** : après connexion, un cookie HttpOnly signé par le serveur
  (30 jours). Le jeton n'est jamais exposé au JavaScript navigateur.
- **Toutes** les lectures/écritures Convex passent par le serveur
  SvelteKit, qui vérifie la session à chaque appel ; les fonctions Convex
  vérifient **elles aussi** la session et le rôle — un appel direct à
  l'API sans session valide n'accède à rien.
- **Rôles** : les fonctions du CRM refusent tout utilisateur qui n'est
  pas coach ; le formulaire refuse tout utilisateur qui n'est pas client.
- Retour coach envoyé = bilan **verrouillé** (le client ne peut plus le
  modifier cette semaine-là).

## 🏠 L'espace client (`/espace`)

Barre latérale gauche : **Mon suivi** (tableau de bord), **Journal**
(tracking de calories), **Progression** (courbe de motivation, récap
semaine par semaine, victoires, rappels mensurations / photos),
**Mes bilans** (historique complet + retours de la coach),
**Recettes & nutrition** (le guide) et **Outils & calibrage** (les
petits outils de suivi). Le formulaire hebdo vit sur `/bilan` —
identifié par la session, plus de saisie de prénom/nom. Un visiteur non
connecté qui ouvre `/` ou `/bilan` est envoyé sur la page de connexion.

## 🧑‍💼 Le CRM coach (`/admin`)

Barre latérale gauche : **Tableau de bord** + **Guide nutrition & recettes**
+ **Outils & calibrage**.

- **Créer un compte client** (prénom, email, mot de passe ≥ 8 car.).
- Liste des client·e·s : nb de bilans, en attente, dernier bilan.
- Détail d'un·e client·e : bilan par semaine, **rédaction du retour**
  (texte visible côté client dans « Mes bilans »), passage du statut
  « À traiter » → « Retour envoyé » (verrouille le bilan), copie du
  récap pour WhatsApp.
- Gestion du compte : renommer, changer l'email, réinitialiser le mot de
  passe (ferme les sessions ouvertes), supprimer (avec confirmation).
- **Objectifs journaliers** par client (kcal, glucides, protéines,
  lipides) : définis par la coach, affichés dans le Journal du client.

## 🔐 Premier démarrage d'une machine (compte coach)

1. Copie `.env.example` → `.env.local`.
2. Renseigne `COACH_EMAIL` et `COACH_PASSWORD` (génération :
   `node -e "console.log(require('crypto').randomBytes(15).toString('base64url'))"`).
3. Pose le code de bootstrap côté Convex **et** dans `.env.local` :
   ```bash
   CODE=$(node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))")
   npx convex env set COACH_BOOTSTRAP_CODE "$CODE" --prod
   echo "COACH_BOOTSTRAP_CODE=$CODE" >> .env.local
   ```
4. Crée le premier compte coach (refusé automatiquement s'il existe déjà) :
   ```bash
   npm run setup:coach
   ```

## 🍳 Le guide nutrition & recettes (`/recettes`)

Portage fidèle du guide HTML « G-Flux™ — Recettes » (thème sombre dédié,
Inter + Space Grotesk) : 185 recettes réparties en 10 catégories
(petit-déjeuner → desserts allégés, accompagnements, volume, kéto,
sans lactose & gluten), plus les guides **Repères mémo tracking** et
**Aliments protéines dominantes**. Chaque recette affiche ses macros
(kcal / prot. / glucides / lipides), ingrédients pour 1 portion et les
étapes — carte dépliable, onglets par catégorie, écran d'accueil pour
choisir une section. Accessible depuis la barre latérale de l'espace
client comme du CRM coach.

**Mode clair / sombre** : le guide se règle avec le bouton flottant en bas
à droite (« ☀️ Mode clair » / « 🌙 Mode sombre »). Le mode clair adapte
toute la palette au thème cream/brand de l'appli (fond crème, cartes
blanches, texte encre, accent vert G-Flux) ; le choix est mémorisé dans
le navigateur (`localStorage`, clé `gflux_guide_theme`).

Contenu extrait du fichier HTML fourni :

| Fichier | Rôle |
| --- | --- |
| `src/lib/data/recettes.ts` | les 185 recettes (données) |
| `src/lib/data/guides-html.ts` | contenu statique mémo + protéines |
| `src/routes/recettes/guide.css` | thème sombre du guide |
| `static/logo-guide.png` | logo G-Flux (version guide) |
| `src/routes/recettes/+page.svelte` | page du guide |

Si tu fournis une nouvelle version du HTML, je peux ré-extraire ces
fichiers et adapter la page sans toucher au reste de l'appli.

## 🧰 La barre d'outils Calibrage (`/outils`)

Portage fidèle du HTML « Calibrage — La Méthode G-Flux™ », en **thème
clair** directement adapté à la palette cream/brand de l'appli (fond
crème, cartes blanches, accent vert, ambre foncé lisible sur blanc) —
comme le mode clair du guide recettes. Les outils bonus sont accessibles
via des onglets, depuis la barre latérale de l'espace client comme du
CRM coach :

1. **Cru ⇄ Cuit** — convertisseur poids cru/cuit + calories réelles
   (riz, pâtes, viandes, poissons…).
2. **Calories invisibles** — compteur des ajouts non trackés avec total
   en barre fixe en bas d'écran (équivalent / semaine et / mois).
3. **Mes protéines** — sélection des sources réellement consommées,
   construction automatique de la journée (2 repas, 3 repas ou
   3 + collation) vers un objectif en g/jour.
4. **Ma semaine** — repères maintenance / objectif / pas, saisie jour par
   jour, modulation des jours restants (plancher de sécurité, plafond de
   pas) et perte estimée. Saisies mémorisées dans le navigateur
   (`localStorage`, clé `gflux_semaine`).
5. **Cyclage refeed / diet break** — planification selon le % de graisse
   et la disponibilité énergétique (grille femme/homme, calendrier de
   phases, guides pratiques).

> **Cycle** : l'outil ponctuel a été migré vers une vraie carte du
> Dashboard cliente (et sa jumelle en lecture seule dans la Vision 360 du
> CRM coach) — mêmes questions, mêmes tranches et même formule
> (`src/lib/cycle.ts`), données désormais enregistrées par cliente.

| Fichier | Rôle |
| --- | --- |
| `src/routes/outils/+page.svelte` | les outils bonus (logique + interface) |
| `src/routes/outils/tools.css` | thème clair scopé sous `.tools-root` |
| `static/logo-outils.png` | logo G-Flux (version outils) |

Comme pour le guide recettes, le CSS est entièrement scopé : aucune
variable ni règle ne déborde sur le reste de l'appli.

## 📔 Le Journal alimentaire (`/espace/journal`)

Tracking de calories fidèle à l'appli de référence (FR) :

- **Carte du jour** : calories restantes, barre de progression, objectif
  (défini par la coach dans le CRM), badges macros (glucides / protéines /
  lipides en anneaux), astuce du jour.
- **Navigation par jour** : chevrons ‹ ›, sélecteur de date natif et
  glissement gauche/droite (swipe) pour voir les jours précédents/suivants.
- **Sections repas** (Petit-déjeuner, Déjeuner, Dîner, Collations) :
  chaque aliment avec image, calories et quantité ; clic pour modifier la
  quantité ou supprimer (recalcul automatique des macros).
- **Bouton + (FAB)** : modale de recherche → feuille de quantité
  (portions OFF, paliers 50/100/150/200 g) → choix du repas → ajout.
  Onglets « Tous les produits / Repas / Créés par moi » prêts pour les
  recettes créées par l'utilisateur (à venir).
- **Base alimentaire embarquée** : les **780 000 aliments** du dump Open
  Food Facts filtré (France/Europe, kcal > 0, valeurs nutritionnelles
  complètes) sont importés dans la table `foods` — la recherche est donc
  **locale d'abord** (index plein texte `by_name`, ~150 ms), avec l'API
  OFF en secours quand un produit n'existe pas (`src/convex/off.ts`,
  endpoint v1 `cgi/search.pl` : la v2 ne fait pas de recherche par nom).
- **Backend** : action `searchFoods` et journal (`src/convex/journal.ts` :
  `getDay`, `addEntry`, `updateEntryQty`, `removeEntry`, objectifs,
  `searchLocal`). BFF : `src/routes/api/journal/+server.ts`,
  `api/journal/[id]`, `api/foods/search` — tout passe par la session
  cookie, jamais Convex depuis le navigateur.
- **Objectifs** : définis par la coach dans le CRM (carte « 🎯 Objectifs
  journaliers »), valeurs par défaut 2000 kcal / 250 g / 90 g / 65 g.

## 🗄️ Base Convex (déploiement production uniquement)

Tables : `users` (email, hash, rôle coach/client, prénom),
`sessions` (jetons hashés), `checkins` (bilans par client et semaine,
statut, feedback), `foods` (780 000 aliments OFF France/Europe, valeurs
/100 g, index recherche `by_name`), `diaryEntries` (aliments consommés
par jour et repas), `clientGoals` (objectifs par client).

Déploiement **verrouillé sur la production** `calm-jaguar-475` :

| Commande | Effet |
| --- | --- |
| `npm run deploy` | push **production** (clé `prod:` requise, vérifiée) |
| `npm run dev` | dev serveur + push auto **production** à chaque sauvegarde |
| `npx convex env set NOM valeur --prod` | variable d'env du déploiement |

Variables d'environnement Convex utilisées : `COACH_BOOTSTRAP_CODE`.

### Reconstruire / étendre la base alimentaire

Le pipeline qui a produit les 780 000 aliments est dans `.freebuff/` :
`filter-off.py` (filtre France/Europe + kcal > 0 + valeurs complètes du
dump `en.openfoodfacts.org.products.csv.gz`), `select-top-off.py`
(classement popularité/qualité → top 780 K pour rester sous la limite du
plan gratuit) et `spawn-import.py` (import `convex import --table foods
--replace`). L'import complet met ~1 h.

## ☁️ Déploiement Netlify (le site web)

Le front (SvelteKit SSR + routes `/api/*`) est hébergé sur Netlify.
L'adapter `@sveltejs/adapter-netlify` est configuré dans `vite.config.ts`
et `netlify.toml` (build `npm run build`, publication `build/` — la
fonction SSR dans `.netlify/functions-internal` est détectée
automatiquement).

### Étapes (une fois)

1. **Pousse le projet sur GitHub** (il n'y a pas encore de dépôt), puis
   dans Netlify : **Add new site → Import an existing project** → choisis
   le dépôt. Netlify détecte SvelteKit et applique `netlify.toml`.
2. **Variable d'environnement** (Site settings → Environment variables,
   ou Site configuration → Build & deploy) :

   | Variable | Valeur |
   | --- | --- |
   | `PUBLIC_CONVEX_URL` | `https://calm-jaguar-475.eu-west-1.convex.cloud` |

   C'est la seule variable nécessaire côté Netlify : `$env/static/public`
   l'inline **au moment du build**. `COACH_BOOTSTRAP_CODE` vit dans
   l'environnement **Convex** (`npx convex env set … --prod`), pas Netlify.
3. **Déploie.** Le serveur SSR et l'authentification par cookie
   fonctionnent tels quels sur Netlify Functions.

### Alternative sans GitHub (Netlify CLI)

```bash
npx netlify-cli login
npx netlify-cli deploy --build --prod   # après avoir défini PUBLIC_CONVEX_URL
```

### Dépannage Netlify

- **Build échoue sur `Missing $env/static/public value`** → `PUBLIC_CONVEX_URL`
  n'est pas définie dans les variables d'environnement du site.
- **L'application répond 404 / pas de SSR** → vérifie que le build a bien
  produit `.netlify/functions-internal` et que `publish` pointe sur `build`.

## ⚙️ Scripts utiles

```bash
npm run dev           # stack complète (Convex push auto + Vite)
npm run check         # vérification TypeScript / Svelte
npm run build         # build de production (adapter Netlify)
npm run deploy        # déploiement Convex PRODUCTION (script guardé)
npm run setup:coach   # création du premier compte coach (une seule fois)
```

## 🛠️ Dépannage

- **`node: command not found`** → `source .tools/activate` dans ce terminal.
- **« Email ou mot de passe incorrect »** → compte mal saisi, ou mot de
  passe réinitialisé par le coach.
- **`/admin` ou `/espace` renvoie vers la connexion** → session absente
  ou expirée ; reconnecte-toi avec ton email/mot de passe.
- **Port déjà utilisé** → `lsof -ti :5173 | xargs kill` puis relance.

## ⏸️ Notes de développement

- La fenêtre de soumission hebdo (ven 9h → dim 12h) est **désactivée**
  pendant le développement (`src/lib/week.ts` → `isFormOpen` renvoie
  `true`) ; remettre le bloc en commentaire pour la finalisation.
- `/` redirige toujours (connexion / espace / admin) et `/bilan` est
  protégé côté serveur : visiteur → `/connexion`, compte coach → `/admin`.
