// Logique visuelle de l'écran « Foods » — convertie depuis la maquette (état + valeurs dérivées). Données fictives conservées.
// @ts-nocheck — code d'origine (JS) conservé tel quel pour garantir un rendu identique ; à typer à l'intégration.
import { DCLogic } from '$lib/dc/DCLogic.svelte';

export class Logic extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { removed: [] };
  }
  renderVals() {
    const all = [
      { id: 'yaourt', name: 'Yaourt brassé sucré aux copeaux…', kcal: '93', meta: '100 g · Super U' },
      { id: 'veloute', name: 'Velouté de légumes', kcal: '40', meta: '100 g' },
      { id: 'hachis-p', name: 'Hachis Parmentier', kcal: '105', meta: '100 g' },
      { id: 'compote', name: 'Compote Pomme', kcal: '51', meta: '100 g · LIDL' },
      { id: 'valley', name: 'Nature valley', kcal: '400', meta: '100 g' },
      { id: 'hachis', name: 'Hachis', kcal: '150', meta: '100 g' },
      { id: 'hello', name: 'Repas Hello Fresh Mouton', kcal: '500', meta: '100 g' }
    ];
    const removed = this.state.removed;
    return {
      foods: all.filter((f) => removed.indexOf(f.id) === -1).map((f) => ({
        ...f,
        remove: () => this.setState({ removed: removed.concat([f.id]) })
      }))
    };
  }
}
