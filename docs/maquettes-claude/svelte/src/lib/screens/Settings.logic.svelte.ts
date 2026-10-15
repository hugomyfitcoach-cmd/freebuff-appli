// Logique visuelle de l'écran « Settings » — convertie depuis la maquette (état + valeurs dérivées). Données fictives conservées.
// @ts-nocheck — code d'origine (JS) conservé tel quel pour garantir un rendu identique ; à typer à l'intégration.
import { DCLogic } from '$lib/dc/DCLogic.svelte';

export class Logic extends DCLogic {
  constructor(props) { super(props); this.state = { name: 'Hugo', saved: 'Hugo' }; }
  renderVals() {
    const dirty = this.state.name.trim().length > 0 && this.state.name !== this.state.saved;
    return {
      name: this.state.name,
      setName: (e) => this.setState({ name: e.target.value }),
      save: () => { if (dirty) this.setState({ saved: this.state.name }); },
      btnBg: dirty ? '#1db954' : 'rgba(29,185,84,.45)',
      btnSh: dirty ? '0 14px 26px -12px rgba(23,163,73,.65)' : 'none'
    };
  }
}
