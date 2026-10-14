// Logique visuelle de l'écran « Food-Edit » — convertie depuis la maquette (état + valeurs dérivées). Données fictives conservées.
// @ts-nocheck — code d'origine (JS) conservé tel quel pour garantir un rendu identique ; à typer à l'intégration.
import { DCLogic } from '$lib/dc/DCLogic.svelte';

export class Logic extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { name: 'Compote Pomme', brand: 'LIDL', kcal: '51', carbs: '11,2', protein: '0,4', fat: '0,1', fiber: '', salt: '', portion: '' };
  }
  renderVals() {
    const s = this.state;
    const set = (k) => (e) => this.setState({ [k]: e.target.value });
    return {
      textFields: [
        { label: 'Nom', opt: '', value: s.name, set: set('name'), placeholder: 'ex. Hachis parmentier' },
        { label: 'Marque', opt: '(optionnel)', value: s.brand, set: set('brand'), placeholder: 'Marque' }
      ],
      numFields: [
        { label: 'Calories / 100 g', dot: '#1db954', value: s.kcal, set: set('kcal'), placeholder: 'ex. 120', unit: 'kcal', opt: '', span: 'auto' },
        { label: 'Glucides / 100 g', dot: '#ec4899', value: s.carbs, set: set('carbs'), placeholder: 'ex. 15', unit: 'g', opt: '', span: 'auto' },
        { label: 'Protéines / 100 g', dot: '#3B82F6', value: s.protein, set: set('protein'), placeholder: 'ex. 10', unit: 'g', opt: '', span: 'auto' },
        { label: 'Lipides / 100 g', dot: '#F97316', value: s.fat, set: set('fat'), placeholder: 'ex. 4', unit: 'g', opt: '', span: 'auto' },
        { label: 'Fibres / 100 g', dot: '#C7CFCA', value: s.fiber, set: set('fiber'), placeholder: 'ex. 3', unit: 'g', opt: 'Optionnel', span: 'auto' },
        { label: 'Sel / 100 g', dot: '#C7CFCA', value: s.salt, set: set('salt'), placeholder: 'ex. 1,2', unit: 'g', opt: 'Optionnel', span: 'auto' },
        { label: 'Portion habituelle', dot: '#C7CFCA', value: s.portion, set: set('portion'), placeholder: 'ex. 200', unit: 'g', opt: 'Optionnel', span: '1 / -1' }
      ]
    };
  }
}
