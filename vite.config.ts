import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-netlify';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	// Mission V3.2 — expérimentation scanner (modes A/B + debug) réservée aux
	// builds NETLIFY PREVIEW. ⚠️ import.meta.env.PROD vaut TRUE sur une Deploy
	// Preview (build de production Vite) : il ne peut PAS servir de garde.
	// Le vrai discriminant est le CONTEXTE NETLIFY au build :
	//  - CONTEXT=deploy-preview | branch-deploy → __SCANNER_EXPERIMENT__=true ;
	//  - production / local (dev) → false (sauf dev: utile au diagnostic).
	define: {
		__SCANNER_EXPERIMENT__: JSON.stringify(
			process.env.CONTEXT === 'deploy-preview' || process.env.CONTEXT === 'branch-deploy' || process.env.NODE_ENV !== 'production'
		),
	},
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Adapter Netlify : SSR + routes API servies via Netlify Functions,
			// fichiers statiques publiés dans build/.
			adapter: adapter()
		})
	]
});
