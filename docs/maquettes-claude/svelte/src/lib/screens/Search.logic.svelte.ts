// Logique visuelle de l'écran « Search » — convertie depuis la maquette (état + valeurs dérivées). Données fictives conservées.
// @ts-nocheck — code d'origine (JS) conservé tel quel pour garantir un rendu identique ; à typer à l'intégration.
import { DCLogic } from '$lib/dc/DCLogic.svelte';

export class Logic extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { favOnly: false, favs: { mister: true, pouletdore: true, envia: true, lait: true, creme: true, calin: true, delilight: true, pepsi: true, galette: true, oldelpaso: true } };
  }
  renderVals() {
    const frequent = [
      { id: 'fromage', name: 'Fromage blanc nature 0%MG - 1kg', kcal: '50', meta: '100 g · U', img: '/assets/fromage.png', v: true, h: true },
      { id: 'pain', name: 'Pain complet ou intégral (à la farine T150)', kcal: '234', meta: '100 g', img: '', v: true, h: true },
      { id: 'compote', name: 'Compote Pomme', kcal: '51', meta: '100 g · LIDL', img: '', v: false, h: false },
      { id: 'choco', name: 'Chocolat noir 70 % de cacao environ, de d…', kcal: '591', meta: '100 g', img: '', v: true, h: true },
      { id: 'crisp', name: 'Country Crisp - Chocolat noir 70% cacao', kcal: '446', meta: '100 g · Jordans', img: '/assets/countrycrisp.png', v: true, h: true },
      { id: 'painblanc', name: 'Pain blanc (par ex. : baguette, boule...)', kcal: '287', meta: '100 g', img: '', v: true, h: true },
      { id: 'pouletroti', name: 'Blanc de Poulet - Rôti à la Broche', kcal: '104', meta: '100 g · Fleury Michon', img: '/assets/poulet.png', v: true, h: true },
      { id: 'yaourt', name: 'Yaourt ou lait fermenté, nature', kcal: '50,1', meta: '100 g', img: '', v: true, h: true },
      { id: 'miel', name: 'Miel', kcal: '331', meta: '100 g', img: '', v: true, h: true },
      { id: 'brasse', name: 'Yaourt brassé nature 0% matière grasse', kcal: '34', meta: '100 g · Auchan', img: '', v: true, h: true }
    ];
    const favorites = [
      { id: 'mister', name: 'Mister freeze', kcal: '47', meta: '100 g', img: '/assets/mister.png' },
      { id: 'pouletdore', name: 'Blanc de Poulet - Doré au Four', kcal: '100', meta: '100 g · Fleury Michon', img: '/assets/pouletdore.png' },
      { id: 'envia', name: 'fromage blanc 0%', kcal: '48', meta: '100 g · Envia', img: '/assets/envia.png' },
      { id: 'lait', name: 'Lait écrémé', kcal: '33', meta: '100 g · Délisse', img: '/assets/lait.png' },
      { id: 'creme', name: 'Crème dessert riche en protéines', kcal: '80', meta: '100 g · Envia, Lidl', img: '/assets/creme.png' },
      { id: 'calin', name: 'Câlin Extra 0%', kcal: '61', meta: '100 g · Yoplait', img: '/assets/calin.png' },
      { id: 'delilight', name: "Déli'light - Yaourt nature 0%", kcal: '45', meta: '100 g · Délisse, Marque Repère', img: '/assets/delilight.png' },
      { id: 'pepsi', name: 'Pepsi Max', kcal: '0', meta: '100 g · Pepsi zero, PepsiCo, Pepsi, Pepsi Max', img: '/assets/pepsi.png' },
      { id: 'galette', name: 'Galette de riz chocolat', kcal: '499', meta: '100 g · Vitarice', img: '/assets/galette.png' },
      { id: 'oldelpaso', name: 'Old el paso blé nature', kcal: '299', meta: '100 g · Old el paso', img: '/assets/oldelpaso.png' }
    ].map((f) => Object.assign(f, { v: true, h: true }));
    const favs = this.state.favs;
    const list = (this.state.favOnly ? favorites.filter((f) => favs[f.id]) : frequent);
    const on = this.state.favOnly;
    return {
      favOn: on ? 'true' : 'false',
      favBg: on ? '#1db954' : '#F3F6F4',
      favFg: on ? '#FFFFFF' : '#4A5550',
      favFill: on ? '#FFFFFF' : 'none',
      favShadow: on ? '0 8px 18px -8px rgba(23,163,73,.55)' : 'none',
      toggleFav: () => this.setState({ favOnly: !this.state.favOnly }),
      showHabits: !on,
      items: list.map((p, i) => {
        const isFav = !!favs[p.id];
        return {
          name: p.name, kcal: p.kcal, meta: p.meta, img: p.img,
          hasImg: !!p.img, noImg: !p.img,
          verified: p.v,
          hasHeart: p.h, noHeart: !p.h,
          border: i === 0 ? 'none' : '1px solid #EEF1EF',
          heartColor: isFav ? '#1db954' : '#9AA39E',
          heartFill: isFav ? '#1db954' : 'none',
          toggle: () => { const f = Object.assign({}, this.state.favs); f[p.id] = !f[p.id]; this.setState({ favs: f }); }
        };
      })
    };
  }
}
