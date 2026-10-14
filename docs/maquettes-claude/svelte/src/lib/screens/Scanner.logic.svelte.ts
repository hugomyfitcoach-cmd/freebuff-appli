// Logique visuelle de l'écran « Scanner » — convertie depuis la maquette (état + valeurs dérivées). Données fictives conservées.
// @ts-nocheck — code d'origine (JS) conservé tel quel pour garantir un rendu identique ; à typer à l'intégration.
import { DCLogic } from '$lib/dc/DCLogic.svelte';

export class Logic extends DCLogic {
  constructor(props) { super(props); this.state = { code: '', flash: false, zoom: 1 }; }
  renderVals() {
    const s = this.state;
    return {
      code: s.code, setCode: (e) => this.setState({ code: e.target.value.replace(/\D/g, '') }),
      goBg: s.code.length >= 8 ? '#1db954' : '#C9D0CC',
      toggleFlash: () => this.setState({ flash: !s.flash }),
      flashOn: s.flash ? 'true' : 'false',
      flashBg: s.flash ? '#1db954' : 'rgba(17,26,21,.7)',
      flashFill: s.flash ? 'currentColor' : 'none',
      toggleZoom: () => this.setState({ zoom: s.zoom === 1 ? 2 : 1 }),
      zoomTxt: s.zoom + '×',
      shade: s.flash ? '0.18' : '0.5'
    };
  }
}
