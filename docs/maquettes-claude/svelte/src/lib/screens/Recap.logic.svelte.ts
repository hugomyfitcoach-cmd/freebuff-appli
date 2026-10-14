// Logique visuelle de l'écran « Recap » — convertie depuis la maquette (état + valeurs dérivées). Données fictives conservées.
// @ts-nocheck — code d'origine (JS) conservé tel quel pour garantir un rendu identique ; à typer à l'intégration.
import { DCLogic } from '$lib/dc/DCLogic.svelte';

export class Logic extends DCLogic {
  constructor(props) { super(props); this.state = { open: true }; }
  renderVals() {
    return { open: this.state.open, toggle: () => this.setState({ open: !this.state.open }), close: () => this.setState({ open: false }) };
  }
}
