import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-netlify';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	define: {
		__NETLIFY_COMMIT_REF__: JSON.stringify(process.env.COMMIT_REF ?? ''),
		__NETLIFY_DEPLOY_ID__: JSON.stringify(process.env.DEPLOY_ID ?? ''),
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
