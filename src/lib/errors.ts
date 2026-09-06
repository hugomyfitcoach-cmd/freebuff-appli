/**
 * Extrait un message lisible depuis n'importe quelle erreur attrapée côté client.
 *
 * Convex transmet les `ConvexError` du serveur avec le message dans `.data`
 * (et un `.message` technique sans intérêt) ; les autres erreurs (réseau…)
 * sont des `Error` classiques dont on lit `.message`.
 */
export function errMsg(e: unknown): string {
	if (e && typeof e === 'object') {
		const data = (e as { data?: unknown }).data;
		if (typeof data === 'string' && data) return data;
	}
	return e instanceof Error ? e.message : String(e);
}
