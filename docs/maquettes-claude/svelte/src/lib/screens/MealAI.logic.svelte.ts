// Logique visuelle de l'écran « Meal-AI » — convertie depuis la maquette (état + valeurs dérivées). Données fictives conservées.
// @ts-nocheck — code d'origine (JS) conservé tel quel pour garantir un rendu identique ; à typer à l'intégration.
import { DCLogic } from '$lib/dc/DCLogic.svelte';

export class Logic extends DCLogic {
  constructor(props) { super(props); this.state = { meal: 1, text: '' }; }
  renderVals() {
    const meals = [['Petit-déjeuner', '<path d="M3 18h18M7 18a5 5 0 0 1 10 0M12 6v3M5.5 9.5L7 11M18.5 9.5L17 11"/>'], ['Déjeuner', '<path d="M5.5 3v5.5a2.5 2.5 0 0 0 5 0V3"/><path d="M8 3v6.5M8 11v10"/><path d="M17 21V3c-2.5 1.2-3.5 4-3.5 8H17"/>'], ['Dîner', '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>'], ['Collations', '<path d="M20 12a8 8 0 1 1-8-8c0 2 1.5 3 3 3 0 1.5 1 3 3 3 1 0 2 .5 2 2Z"/><path d="M9 10h.01M13 14h.01M9 15h.01"/>']];
    const ok = this.state.text.trim().length > 0;
    return {
      meals: meals.map((m, i) => ({ label: m[0], i0: i === 0, i1: i === 1, i2: i === 2, i3: i === 3, bg: this.state.meal === i ? '#1db954' : '#F3F6F4', fg: this.state.meal === i ? '#FFFFFF' : '#66716B', fw: this.state.meal === i ? 900 : 700, pick: () => this.setState({ meal: i }) })),
      text: this.state.text, setText: (e) => this.setState({ text: e.target.value }),
      btnBg: ok ? '#1db954' : 'rgba(29,185,84,.45)', btnSh: ok ? '0 14px 26px -12px rgba(23,163,73,.65)' : 'none'
    };
  }
}
