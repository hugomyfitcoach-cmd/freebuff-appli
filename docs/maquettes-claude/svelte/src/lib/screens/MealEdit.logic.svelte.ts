// Logique visuelle de l'écran « Meal-Edit » — convertie depuis la maquette (état + valeurs dérivées). Données fictives conservées.
// @ts-nocheck — code d'origine (JS) conservé tel quel pour garantir un rendu identique ; à typer à l'intégration.
import { DCLogic } from '$lib/dc/DCLogic.svelte';

export class Logic extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { name: 'Hachis Parmentier', desc: '', removed: [] };
  }
  renderVals() {
    const all = [
      { id: 'pdt', name: 'Purée de pommes de terre', qty: '1 000 g' },
      { id: 'boeuf', name: 'Bœuf haché', qty: '600 g' },
      { id: 'oignon', name: 'Oignons', qty: '300 g' }
    ];
    const removed = this.state.removed;
    const list = all.filter((i) => removed.indexOf(i.id) === -1);
    return {
      mealName: this.state.name,
      mealDesc: this.state.desc,
      setName: (e) => this.setState({ name: e.target.value }),
      setDesc: (e) => this.setState({ desc: e.target.value }),
      count: list.length + (list.length > 1 ? ' produits' : ' produit'),
      empty: list.length === 0,
      ingredients: list.map((i, idx) => ({
        ...i,
        initial: i.name.charAt(0),
        border: idx === 0 ? 'none' : '1px solid #EEF1EF',
        remove: () => this.setState({ removed: removed.concat([i.id]) })
      }))
    };
  }
}
