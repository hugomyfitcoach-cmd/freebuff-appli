import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dateISOInTimeZone, shiftISO } from '../src/lib/vision360.ts';
import { wallTimeToUtcMs } from '../src/lib/wallTime.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const helpers = read('src/convex/helpers.ts');
const journal = read('src/convex/journal.ts');
const hydration = read('src/convex/hydration.ts');
const journalApi = read('src/routes/api/journal/+server.ts');
const plannedApi = read('src/routes/api/journal/planned/+server.ts');
const stepsApi = read('src/routes/api/steps/+server.ts');
const currentDay = read('src/lib/currentDay.svelte.ts');
const journalDay = read('src/lib/components/JournalDay.svelte');
const stepsPage = read('src/routes/espace/pas/+page.svelte');

const instant = (date, hhmm, zone = 'Europe/Paris') => wallTimeToUtcMs(date, hhmm, zone);

test('date ISO Europe/Paris suit minuit toute l’année (horloge simulée)', () => {
	const checks = [
		['2026-01-14', '23:59', '2026-01-14'],
		['2026-01-15', '00:00', '2026-01-15'],
		['2026-01-15', '00:01', '2026-01-15'],
		['2026-01-15', '00:30', '2026-01-15'],
		['2026-01-15', '01:30', '2026-01-15'],
		['2026-01-15', '02:30', '2026-01-15'],
		['2026-07-14', '23:59', '2026-07-14'],
		['2026-07-15', '00:00', '2026-07-15'],
		['2026-07-15', '00:01', '2026-07-15'],
		['2026-07-15', '00:30', '2026-07-15'],
		['2026-07-15', '01:30', '2026-07-15'],
		['2026-07-15', '02:30', '2026-07-15'],
	];
	for (const [date, time, expected] of checks) {
		assert.equal(dateISOInTimeZone(instant(date, time)), expected, `${date} ${time} Europe/Paris`);
	}
});

test('minuit parisien au printemps et à l’automne résout le bon instant UTC', () => {
	const spring = instant('2026-03-29', '00:00');
	const fall = instant('2026-10-25', '00:00');
	assert.equal(new Date(spring).toISOString(), '2026-03-28T23:00:00.000Z');
	assert.equal(dateISOInTimeZone(spring - 1), '2026-03-28');
	assert.equal(dateISOInTimeZone(spring), '2026-03-29');
	assert.equal(new Date(fall).toISOString(), '2026-10-24T22:00:00.000Z');
	assert.equal(dateISOInTimeZone(fall - 1), '2026-10-24');
	assert.equal(dateISOInTimeZone(fall), '2026-10-25');
	assert.equal(shiftISO('2026-03-28', 1), '2026-03-29');
	assert.equal(shiftISO('2026-10-24', 1), '2026-10-25');
});

test('la régression était bien UTC : 00 h 30 à Paris valait encore hier en UTC', () => {
	const parisNow = instant('2026-07-15', '00:30');
	assert.equal(new Date(parisNow).toISOString().slice(0, 10), '2026-07-14');
	assert.equal(dateISOInTimeZone(parisNow), '2026-07-15');
	assert.match(helpers, /localTodayISO\(now: Date = new Date\(\)\): string \{\s*return dateISOInTimeZone\(now\.getTime\(\), "Europe\/Paris"\);/);
	assert.match(journal, /function localTodayOfTs\(\): string \{\s*return dateISOInTimeZone\(Date\.now\(\), "Europe\/Paris"\);/);
});

test('une journée planning devient consommable à minuit, pas avant; une date future garde son planning', () => {
	const priorTonight = instant('2026-07-14', '23:59');
	const midnight = instant('2026-07-15', '00:00');
	const clientDate = dateISOInTimeZone(midnight);
	const previousClientDate = dateISOInTimeZone(priorTonight);
	const serverUtcDate = new Date(midnight).toISOString().slice(0, 10);
	assert.equal(previousClientDate, '2026-07-14');
	assert.equal(serverUtcDate, '2026-07-14');
	assert.equal(clientDate, '2026-07-15');
	assert.ok(clientDate > serverUtcDate, 'reproduction du refus serveur antérieur à 02 h en été');
	assert.match(journalApi, /clientDate: typeof body\.clientDate === 'string' \? body\.clientDate : undefined/);
	assert.equal((journalApi.match(/clientDate: typeof body\.clientDate/g) ?? []).length, 1);
	assert.equal((plannedApi.match(/clientDate: typeof body\.clientDate/g) ?? []).length, 2);
	assert.match(journal, /const future = date > today;/);
	assert.match(journal, /if \(p\.date > today\) \{\s*throw new ConvexError\("Impossible de valider « Mangé » sur une date future\."\);/);
	assert.match(journal, /const future = targetDate > today;/);
	assert.match(journalDay, /day\.date > currentLocalDay\(\)/);
});

test('pas : date choisie explicitement conservée, validation future en date parisienne; séries hebdo restent alignées par clé ISO', () => {
	assert.match(stepsApi, /const local = dateISOInTimeZone\(Date\.now\(\), 'Europe\/Paris'\)/);
	assert.match(stepsApi, /const date = typeof body\.date === 'string' && body\.date \? String\(body\.date\) : local/);
	assert.match(stepsApi, /const maxISO = addDaysISO\(local, 1\)/);
	assert.match(stepsApi, /date,\s*count: Number\(body\.count\)/);
	assert.match(stepsPage, /const todayISO = \$derived\(currentLocalDay\(\)\)/);
	assert.match(stepsPage, /rows\.find\(\(r\) => r\.date === key\)/);
	assert.match(stepsPage, /\$effect\(\(\) => \{\s*if \(todayISO !== serverTodayISO\) void invalidateAll\(\);/);
	assert.match(currentDay, /nextParisMidnightUtcMs\(\) - Date\.now\(\)/);
	assert.match(currentDay, /dispatchEvent\(new CustomEvent\('gflux:day-changed'\)\)/);
});

test('hydratation : une prise du jour parisien n’est plus éliminée par la borne UTC', () => {
	const atParis0030 = instant('2026-07-15', '00:30');
	const utcToday = new Date(atParis0030).toISOString().slice(0, 10);
	const parisToday = dateISOInTimeZone(atParis0030);
	assert.equal(utcToday, '2026-07-14');
	assert.equal(parisToday, '2026-07-15');
	assert.ok('2026-07-15' > utcToday, 'l’ancien filtre UTC masquait l’entrée fraîchement saisie');
	assert.match(hydration, /const today = dateISOInTimeZone\(Date\.now\(\), "Europe\/Paris"\);\s*const notFuture = \(r: \{ date: string \}\) => r\.date <= today;/);
	assert.match(hydration, /for \(const r of filtered\)\s*byDate\.set\(r\.date, \(byDate\.get\(r\.date\) \?\? 0\) \+ r\.ml\)/);
});

test('« Tout manger » conserve son action; titres, kcal prévues et bouton se replient sans chevauchement', () => {
	assert.match(journalDay, /onclick=\{\(\) => onEatAllMeal\(meal\.id\)\}/);
	assert.match(journalDay, /Tout manger/);
	assert.match(journalDay, /h2 class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"/);
	assert.match(journalDay, /<span class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0\.5">/);
	assert.match(journalDay, /<span class="max-w-full whitespace-normal text-\[12\.5px\] font-bold text-brand-deep tabular-nums">/);
	assert.match(journalDay, /\{#if planned\.length > 0 && canEat && onEatAllMeal\}/);
});
