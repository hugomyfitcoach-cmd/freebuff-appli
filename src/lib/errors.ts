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

/**
 * Message destiné à l'UTILISATEUR final : les erreurs techniques brutes
 * (stack Convex « [CONVEX M(...)] Server Error », « Uncaught TypeError »,
 * Request ID…) ne doivent jamais s'afficher dans la PWA — on renvoie le
 * message ConvexError lisible s'il existe, sinon un texte neutre.
 * La cause réelle reste dans les logs serveur (console.error côté BFF).
 */
export function userErrMsg(e: unknown, fallback: string): string {
	const msg = errMsg(e);
	if (!msg) return fallback;
	if (
		/\[CONVEX|Uncaught|TypeError|ReferenceError|internal error|Request ID|ECONN|fetch failed|timeout of/i.test(msg)
	) {
		return fallback;
	}
	return msg;
}
