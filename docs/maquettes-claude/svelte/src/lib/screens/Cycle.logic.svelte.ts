// Logique visuelle de l'écran « Cycle » — convertie depuis la maquette (état + valeurs dérivées). Données fictives conservées.
// @ts-nocheck — code d'origine (JS) conservé tel quel pour garantir un rendu identique ; à typer à l'intégration.
import { DCLogic } from '$lib/dc/DCLogic.svelte';

export class Logic extends DCLogic {
  constructor(props) { super(props); this.state = { edit: false, opt: 0, irr: false }; }
  renderVals() {
    const labels = ['Non, ou stérilet en cuivre', 'Stérilet hormonal (Mirena, Kyleena…)', 'Pilule, patch, anneau, implant ou injection'];
    return {
      view: !this.state.edit, edit: this.state.edit,
      openEdit: () => this.setState({ edit: true }),
      closeEdit: () => this.setState({ edit: false }),
      opts: labels.map((l, i) => ({ label: l, on: this.state.opt === i,
        bd: this.state.opt === i ? '#1db954' : '#E3E8E5', bg: '#FFFFFF',
        fg: this.state.opt === i ? '#0F1512' : '#66716B', fw: this.state.opt === i ? 900 : 700,
        pick: () => this.setState({ opt: i }) })),
      irr: this.state.irr, toggleIrr: () => this.setState({ irr: !this.state.irr }),
      irrBd: this.state.irr ? '#1db954' : '#C9D0CC', irrBg: this.state.irr ? '#1db954' : '#FFFFFF'
    };
  }
}
