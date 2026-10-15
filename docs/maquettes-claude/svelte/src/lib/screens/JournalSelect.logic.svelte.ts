// Logique visuelle de l'écran « Journal-Select » — convertie depuis la maquette (état + valeurs dérivées). Données fictives conservées.
// @ts-nocheck — code d'origine (JS) conservé tel quel pour garantir un rendu identique ; à typer à l'intégration.
import { DCLogic } from '$lib/dc/DCLogic.svelte';

export class Logic extends DCLogic {
  constructor(props) { super(props); this.state = { items: [
    { id: 'c', name: 'Country Crisp 4 Baies', kcal: '605', qty: '140 g', img: '/assets/countrycrisp.png', on: true },
    { id: 'b', name: 'Banane, chair sans peau, crue', kcal: '88', qty: '100 g', img: '', on: true },
    { id: 's', name: 'Skyr nature', kcal: '180', qty: '300 g', img: '/assets/delilight.png', on: false } ] }; }
  renderVals() {
    const items = this.state.items;
    const n = items.filter((i) => i.on).length;
    const allOn = n === items.length;
    return {
      hasItems: items.length > 0,
      items: items.map((it, i) => ({ name: it.name, kcal: it.kcal, qty: it.qty, img: it.img, hasImg: !!it.img, noImg: !it.img,
        border: i ? '1px solid #EEF1EF' : 'none',
        ring: it.on ? '#1db954' : '#DDE3DF', fill: it.on ? '#1db954' : '#FFFFFF', check: it.on ? 1 : 0, sc: it.on ? 1 : 0.4,
        toggle: () => this.setState({ items: items.map((x) => x.id === it.id ? Object.assign({}, x, { on: !x.on }) : x) }) })),
      selectAll: () => this.setState({ items: items.map((x) => Object.assign({}, x, { on: !allOn })) }),
      selLabel: allOn ? 'Tout désélectionner' : 'Tout sélectionner',
      count: n + (n > 1 ? ' sélectionnés' : ' sélectionné'),
      del: () => this.setState({ items: items.filter((x) => !x.on) })
    };
  }
}
