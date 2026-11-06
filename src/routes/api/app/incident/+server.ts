import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex, withDeadline } from '$lib/server/convex';
import { SESSION_COOKIE } from '$lib/server/session';
import { api } from '../../../../convex/_generated/api.js';

export const POST: RequestHandler = async (event) => {
	// sendBeacon uses a same-origin POST with a text/plain body.
	if (event.request.headers.get('origin') !== event.url.origin) return new Response(null, { status: 403 });
	const length = Number(event.request.headers.get('content-length') ?? 0);
	if (!Number.isFinite(length) || length > 16000) return new Response(null, { status: 413 });
	try {
		const body = await event.request.text();
		if (body.length > 16000) return new Response(null, { status: 413 });
		const data = JSON.parse(body);
		const result = await withDeadline(convex.mutation(api.appVersion.recordIncident, {
			sessionToken: event.cookies.get(SESSION_COOKIE),
			build: data.build, witness: data.witness, styles: data.styles, controller: data.controller,
			caches: data.caches, userAgent: data.userAgent, action: data.action,
		}));
		return json(result, { headers: { 'cache-control': 'no-store' } });
	} catch {
		return new Response(null, { status: 400, headers: { 'cache-control': 'no-store' } });
	}
};
