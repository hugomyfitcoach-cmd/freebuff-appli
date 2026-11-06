import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex, withDeadline } from '$lib/server/convex';
import { SESSION_COOKIE, currentUser } from '$lib/server/session';
import { normalizeIncident, readCappedText } from '$lib/server/incident';
import { api } from '../../../../convex/_generated/api.js';

const NO_STORE = { 'cache-control': 'no-store' };
const ignored = () => new Response(null, { status: 204, headers: NO_STORE });

/**
 * Rapport d'incident de la garde CSS (sendBeacon, corps text/plain).
 *
 * La mutation Convex est publique (un appel direct contourne ce BFF), d'où la
 * défense en profondeur :
 * 1. origine same-origin exigée (sendBeacon est un POST même origine) ;
 * 2. corps lu avec un plafond de 4 Ko SANS croire Content-Length (le flux est
 *    interrompu au-delà → 413) ;
 * 3. corps normalisé dans une liste fermée (énumérations, motifs, longueurs) ;
 * 4. session résolue par le même mécanisme que les autres routes /api :
 *    sans session valide, le rapport est IGNORÉ (204, aucune écriture).
 */
export const POST: RequestHandler = async (event) => {
	if (event.request.headers.get('origin') !== event.url.origin) return new Response(null, { status: 403 });

	const body = await readCappedText(event.request);
	if (body === null) return new Response(null, { status: 413, headers: NO_STORE });

	let raw: unknown;
	try {
		raw = JSON.parse(body);
	} catch {
		return new Response(null, { status: 400, headers: NO_STORE });
	}
	const report = normalizeIncident(raw);
	if (!report) return new Response(null, { status: 400, headers: NO_STORE });

	const user = await currentUser(event);
	if (!user) return ignored();

	try {
		const result = await withDeadline(
			convex.mutation(api.appVersion.recordIncident, {
				sessionToken: event.cookies.get(SESSION_COOKIE),
				build: report.build,
				witness: report.witness,
				styles: report.styles,
				controller: report.controller,
				caches: report.caches,
				userAgent: report.userAgent,
				action: report.action,
			})
		);
		return json(result, { headers: NO_STORE });
	} catch {
		return new Response(null, { status: 400, headers: NO_STORE });
	}
};
