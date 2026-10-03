# G-FLUX Espace Coach — Refonte UX/UI Premium · Preview V1

**Branche** : `refonte/ux-ui-premium-espace-coach`
**Statut** : preview UI uniquement — données 100 % fictives, aucun backend, **Convex intact** (aucune requête, aucun déploiement, aucun schéma modifié).

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Source de la preview (références CSS/JS séparées) |
| `preview.html` | **Version autonome inlinée** — c'est elle qui est ouverte dans l'onglet Preview |
| `gflux-refonte.css` | Design system complet (tokens + composants) |
| `app.js` | Interactions (navigation, filtres, onglets, générateur de templates) |

> Après toute modification de `index.html` / `gflux-refonte.css` / `app.js`, régénérer `preview.html` (inlining automatique).

## Direction visuelle (north star = dashboard mockup validé)

- **Typo** : Lato uniquement — `900` titres/H1/chiffres (letter-spacing −0.03em, line-height 1.02), `700` boutons/labels/navigation/badges, `400` texte courant. Poids fins supprimés.
- **Couleurs** : univers G-FLUX conservé (vert `#1db954`, crème `#f7f5f0`) + accents category (warn, danger, blue, violet, pink) pour la hiérarchie visuelle.
- **Sidebar** : sections labellisées (Pilotage / Suivi clientes / Coaching), item actif noir plein, badges pastille.
- **KPI cards** : liseré coloré vertical, icône en tuile douce, chiffre Lato 900, sparkline, pied de tendance.
- **Tables** : en-têtes uppercase discret sur fond soft, hover vert très léger, cellules riches (avatar + statut + présence).
- **Cartes** : coins 18 px, bordure fine, ombre douce, titres Lato 800.
- **Espacements** : respiration généreuse (grille 14/18/24 px), 4 KPI par rangée.

## Écrans couverts (8)

1. **Dashboard** — salutation « Bonjour Hugo », 4 KPI cards, « À traiter aujourd'hui », agenda Google Calendar (jour + mini-semaine), message global (sortant uniquement), vue rapide clientes filtrable.
2. **Notifications** — filtres par catégorie (Toutes/Bilans/Poids/Mensurations/RDV), distinction **À consulter** (liseré ambre) vs **Vu**, coche de marquage, « tout marquer comme vu ».
3. **Photos** — filtres période, cartes dépôt avec strip d'aperçus, tags période/mois.
4. **Bilans** — 4 KPI, sélecteur de semaines, colonnes **À traiter** / **Manquants**, liste table complète avec statuts.
5. **Rendez-vous** — demandes à valider, prochains RDV, planning semaine 7 colonnes avec modes réservation Suivi/Démarrage (créneaux disponibles en vert).
6. **Templates** — workflow 3 étapes numérotées (situation → variables → génération) + aperçu WhatsApp-like + copier/réinitialiser/sauvegarder.
7. **Vision 360** — header client premium, onglets (Aperçu, Analyse, Entraînement, Photos, Bilans, RDV), cartes de synthèse, message du coach du jour, accès rapides, timeline d'activité ; **Analyse** : calories/pas en barres + KPIs + objectifs journaliers (calories/répartition %/macros, maintenance, pas).
8. **Entraînement** — KPIs, grille de programmes (cards avec cover), éditeur 3 colonnes (séances / exercices / prescription avec steppers, tempo, muscles ciblés), bibliothèque filtrable.

## Contrainte produit respectée

- Aucune messagerie entrante/inbox : uniquement des outils d'envoi sortant (message du coach du jour, message global, templates).
- Aucune logique métier modifiée : la preview est statique, les interactions sont locales.

## Portage vers l'app réelle (étapes suivantes)

1. `src/app.html` : charger Lato 400/700/800/900 (aujourd'hui 300/400/700).
2. `src/routes/layout.css` : ajouter les tokens du design system (nouvelle map `--color-*` Tailwind 4 + utilitaires `.card`, `.kpi`, `.tbl`…).
3. `AppShell.svelte` (rôle coach uniquement) : sidebar sectionnée, item actif noir, aide + profil en pied.
4. Pages : `admin/+page.svelte` (dashboard + Vision 360), `notifications`, `photos`, `bilans`, `rendez-vous`, `templates`, `entrainement` — même ordre que la preview.
5. Garde-fous : aucune modification `src/convex/**`, aucune route API, aucun schéma. Front-end uniquement.

## Sécurité Convex

Cette preview ne fait **aucun** appel réseau : tout est inline dans le HTML. La clé Convex locale n'a jamais été utilisée, aucun backend (prod ou preview) n'a été contacté.
