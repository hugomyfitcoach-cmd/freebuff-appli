import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  compilerOptions: {
    // Conserve les espaces du HTML d'origine (ex. « 206,9<span> g</span> ») : rendu identique à la maquette.
    preserveWhitespace: true,
    // Les écrans reproduisent à l'identique les maquettes (éléments interactifs en <div>/<a> stylés) :
    // les avertissements a11y du compilateur sont masqués ici pour garder une sortie lisible.
    // À réactiver (et traiter) lors de l'intégration dans G-FLUX.
    warningFilter: (w) => !w.code.startsWith('a11y')
  },
  kit: {
    adapter: adapter({ fallback: 'index.html' })
  }
};
export default config;
