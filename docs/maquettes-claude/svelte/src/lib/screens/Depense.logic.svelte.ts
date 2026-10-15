// Logique visuelle de l'écran « Depense » — convertie depuis la maquette (état + valeurs dérivées). Données fictives conservées.
// @ts-nocheck — code d'origine (JS) conservé tel quel pour garantir un rendu identique ; à typer à l'intégration.
import { DCLogic } from '$lib/dc/DCLogic.svelte';

export class Logic extends DCLogic {
  constructor(props) { super(props); this.state = { w: 0 }; }
  renderVals() {
    const mois = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
    const start = new Date(2026, 9, 12 + this.state.w * 7);
    const end = new Date(2026, 9, 18 + this.state.w * 7);
    const lab = 'Semaine du ' + start.getDate() + ' ' + mois[start.getMonth()] + ' au ' + end.getDate() + ' ' + mois[end.getMonth()];
    return { label: lab, prev: () => this.setState({ w: this.state.w - 1 }), next: () => this.setState({ w: this.state.w + 1 }) };
  }
}
