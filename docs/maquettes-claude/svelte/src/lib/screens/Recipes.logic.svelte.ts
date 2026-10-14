// Logique visuelle de l'écran « Recipes » — convertie depuis la maquette (état + valeurs dérivées). Données fictives conservées.
// @ts-nocheck — code d'origine (JS) conservé tel quel pour garantir un rendu identique ; à typer à l'intégration.
import { DCLogic } from '$lib/dc/DCLogic.svelte';

export class Logic extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { open: true };
  }
  renderVals() {
    const open = this.state.open;
    return {
      open,
      ariaOpen: open ? 'true' : 'false',
      chevRot: open ? '0deg' : '180deg',
      toggle: () => this.setState({ open: !this.state.open }),
      ingredients: [
        { name: 'Blanc de poulet', qty: '150g' },
        { name: 'Quinoa cuit', qty: '100g' },
        { name: 'Épinards frais', qty: '60g' },
        { name: 'Jus de citron', qty: '1 cs' },
        { name: "Huile d'olive", qty: '5ml' },
        { name: 'Sel, poivre, paprika fumé', qty: 'QS' }
      ],
      steps: [
        { n: '1', text: 'Assaisonner le poulet de sel, poivre et paprika fumé.', color: '#3A4540' },
        { n: '2', text: '[Étape 2 — texte à compléter]', color: '#9AA39E' },
        { n: '3', text: '[Étape 3 — texte à compléter]', color: '#9AA39E' },
        { n: '4', text: "Faire tomber les épinards 1 min à la poêle avec une goutte d'eau.", color: '#3A4540' }
      ]
    };
  }
}
