// Logique visuelle de l'écran « Calibrage » — convertie depuis la maquette (état + valeurs dérivées). Données fictives conservées.
// @ts-nocheck — code d'origine (JS) conservé tel quel pour garantir un rendu identique ; à typer à l'intégration.
import { DCLogic } from '$lib/dc/DCLogic.svelte';

export class Logic extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { mode: 'raw' };
  }
  renderVals() {
    const raw = this.state.mode === 'raw';
    const on = { b: '#1db954', bg: '#e8fef0', fg: '#0d7c36' };
    const off = { b: '#E9EDEA', bg: '#F7F9F8', fg: '#3A4540' };
    const r = raw ? on : off, c = raw ? off : on;
    return {
      pickRaw: () => this.setState({ mode: 'raw' }),
      pickCooked: () => this.setState({ mode: 'cooked' }),
      rawOn: raw ? 'true' : 'false', cookedOn: raw ? 'false' : 'true',
      rawBorder: r.b, rawBg: r.bg, rawFg: r.fg,
      cookedBorder: c.b, cookedBg: c.bg, cookedFg: c.fg
    };
  }
}
