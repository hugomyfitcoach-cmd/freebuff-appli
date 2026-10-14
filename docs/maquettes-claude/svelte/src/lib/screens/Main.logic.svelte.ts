// Logique visuelle de l'écran « Main » — convertie depuis la maquette (état + valeurs dérivées). Données fictives conservées.
// @ts-nocheck — code d'origine (JS) conservé tel quel pour garantir un rendu identique ; à typer à l'intégration.
import { DCLogic } from '$lib/dc/DCLogic.svelte';

export class Logic extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { removed: [] };
  }
  renderVals() {
    const all = [
      { id: 'chili', name: 'Chili sin carne', kcal: '1 153', meta: '2 095 g · 55 kcal/100 g', recipe: false, editable: true },
      { id: 'hachis', name: 'Hachis Parmentier', kcal: '1 975', meta: '1 900 g · 104 kcal/100 g', recipe: false, editable: true },
      { id: 'flan', name: 'Flan pâtissier feuilleté', kcal: '3 093', meta: '1 365 g · 227 kcal/100 g', recipe: false, editable: true },
      { id: 'wok', name: 'Wok', kcal: '1 822', meta: '1 395 g · 131 kcal/100 g', recipe: false, editable: true },
      { id: 'poulet', name: 'Blanc poulet mariné yaourt épices riz ba…', kcal: '473', meta: '1 portion', recipe: true, editable: false },
      { id: 'riz', name: 'Riz au lait TM7', kcal: '1 126', meta: '1 222 g · 92 kcal/100 g', recipe: false, editable: true },
      { id: 'bowl', name: 'Bowl fromage blanc framboises amandes', kcal: '190', meta: '1 portion', recipe: true, editable: false },
      { id: 'gateau', name: 'Gâteau', kcal: '425', meta: '200 g · 213 kcal/100 g', recipe: false, editable: true }
    ];
    const removed = this.state.removed;
    return {
      meals: all.filter((m) => removed.indexOf(m.id) === -1).map((m) => ({
        ...m,
        remove: () => this.setState({ removed: removed.concat([m.id]) })
      }))
    };
  }
}
