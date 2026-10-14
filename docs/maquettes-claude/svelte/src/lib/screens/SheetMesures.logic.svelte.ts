// Logique visuelle de l'écran « Sheet-Mesures » — convertie depuis la maquette (état + valeurs dérivées). Données fictives conservées.
// @ts-nocheck — code d'origine (JS) conservé tel quel pour garantir un rendu identique ; à typer à l'intégration.
import { DCLogic } from '$lib/dc/DCLogic.svelte';

export class Logic extends DCLogic {
  constructor(props) { super(props); this.state = { v: ['', '', ''] }; }
  renderVals() {
    const labels = ['Tour de taille fine', 'Fessiers', 'Tour de cou'];
    return { fields: labels.map((l, i) => ({ label: l, value: this.state.v[i], set: (e) => { const v = this.state.v.slice(); v[i] = e.target.value.replace(/[^0-9,\.]/g, ''); this.setState({ v: v }); } })) };
  }
}
