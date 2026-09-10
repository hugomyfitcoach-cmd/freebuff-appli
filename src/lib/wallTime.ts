/**
 * Horaire "mural" (date ISO + "HH:mm") → instant UTC réel (ms), fuseau IANA.
 * Version navigateur de convex/helpers.wallTimeToUtcMs — mêmes résultats,
 * DST inclus (itération sur l'offset réel du fuseau).
 */
export function wallTimeToUtcMs(dateISO: string, hhmm: string, timeZone = 'Europe/Paris'): number {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
	if (!m || !/^\d{2}:\d{2}$/.test(hhmm)) return NaN;
	const [h, mi] = hhmm.split(':').map(Number);
	const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h, mi);
	const fmt = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hourCycle: 'h23',
	});
	let guess = target;
	for (let i = 0; i < 4; i++) {
		const p = fmt.formatToParts(new Date(guess));
		const g = (type: string) => Number(p.find((x) => x.type === type)?.value ?? '0');
		const wallNaive = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
		const offset = wallNaive - guess;
		const next = target - offset;
		if (next === guess) break;
		guess = next;
	}
	return guess;
}
