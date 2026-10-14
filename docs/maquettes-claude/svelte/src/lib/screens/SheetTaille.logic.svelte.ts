// Logique visuelle de l'écran « Sheet-Taille » — convertie depuis la maquette (état + valeurs dérivées). Données fictives conservées.
// @ts-nocheck — code d'origine (JS) conservé tel quel pour garantir un rendu identique ; à typer à l'intégration.
import { DCLogic } from '$lib/dc/DCLogic.svelte';

export class Logic extends DCLogic {
  constructor(props) { super(props); this.state = { v: '173' }; }
  renderVals() { return { v: this.state.v, set: (e) => this.setState({ v: e.target.value.replace(/\D/g, '') }) }; }
}
