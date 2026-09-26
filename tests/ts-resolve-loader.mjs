/**
 * Hook de résolution TS pour node --test : retente `./mod` → `./mod.ts`
 * (puis .tsx / index.ts / .js) quand la résolution brute échoue — les
 * modules internes du projet importent leurs voisins SANS extension
 * (résolus par Vite, pas par Node).
 *
 * Branché via `--import ./tests/ts-resolve.mjs` dans le script `npm test`.
 * Aucun effet sur les imports qui résolvent déjà (JS, node_modules…).
 */
export async function resolve(specifier, context, next) {
	try {
		return await next(specifier, context);
	} catch (err) {
		if (specifier.startsWith('.') || specifier.startsWith('file:') || specifier.startsWith('/')) {
			for (const suffix of ['.ts', '.tsx', '/index.ts', '.js']) {
				try {
					return await next(specifier + suffix, context);
				} catch {
					/* on tente la variante suivante */
				}
			}
		}
		throw err;
	}
}
