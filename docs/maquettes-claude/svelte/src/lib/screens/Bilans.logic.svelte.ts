// Logique visuelle de l'écran « Bilans » — convertie depuis la maquette (état + valeurs dérivées). Données fictives conservées.
// @ts-nocheck — code d'origine (JS) conservé tel quel pour garantir un rendu identique ; à typer à l'intégration.
import { DCLogic } from '$lib/dc/DCLogic.svelte';

export class Logic extends DCLogic {
  renderVals() {
    const rows = [
      ['MOTIVATION', '3/5'],
      ['ADHÉRENCE AU PLAN', 'Partiellement (écarts / repas non maîtrisés)'],
      ['ÉCARTS → DÉFICIT ANNULÉ ?', 'Peut-être, je ne sais pas trop'],
      ['FAIM / ENVIES DIFFICILES', 'Non'],
      ['HYDRATATION', 'Variable / irrégulière'],
      ['DIGESTION', 'Un peu perturbée'],
      ['PAS MOYEN / JOUR', '8 000 – 10 000'],
      ['PHASE DE CYCLE', 'Phase folliculaire (J5 à J14)']
    ];
    return { fields: rows.map((r, i) => ({ label: r[0], value: r[1], border: i === 0 ? 'none' : '1px solid #EEF1EF' })) };
  }
}
