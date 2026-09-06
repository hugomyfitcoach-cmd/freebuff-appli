<script lang="ts">
	import MotivationChart from '../../lib/components/MotivationChart.svelte';
	import RecapBilan from '../../lib/components/RecapBilan.svelte';
	import { answerLines } from '../../lib/labels.js';
	import { mondayISO } from '$lib/week.js';
	import { avgMotivation, countAdherence, series, victories } from '$lib/stats.js';

	let { data } = $props();
	const user = $derived(data.user);
	const checkins = $derived(data.checkins ?? []);
	const latest = $derived(checkins[0] ?? null);
	const points = $derived(series(checkins));
	const avg = $derived(avgMotivation(points));
	const adherent = $derived(points.length ? Math.round((countAdherence(points, 'oui') / points.length) * 100) : null);
	const wins = $derived(victories(checkins));
	const weekDone = $derived(latest?.weekStart === mondayISO());
	const latestLines = $derived(latest ? answerLines(latest).slice(0, 5) : []);
</script>

<svelte:head><title>Mon suivi — G-Flux</title></svelte:head>

<div class="mb-6 flex flex-wrap items-end justify-between gap-3">
	<div>
		<h1 class="font-display text-2xl font-semibold text-ink">Salut {user.prenom} 👋</h1>
		<p class="mt-1 text-sm text-mist">Voici où tu en es dans ton suivi hebdo.</p>
	</div>
	{#if !weekDone}
		<a href="/bilan" class="rounded-xl bg-brand px-5 py-3 font-display font-semibold uppercase tracking-wide text-white transition hover:bg-brand-dark">
			Remplir le bilan de la semaine →
		</a>
	{:else}
		<a href="/espace/historique" class="rounded-xl border-2 border-line px-5 py-3 font-display font-semibold uppercase tracking-wide text-ink transition hover:border-brand hover:text-brand">
			Bilan de la semaine envoyé ✓
		</a>
	{/if}
</div>

{#if latest}
	<div class="grid gap-4 md:grid-cols-[1fr_1.2fr]">
		<!-- Dernier bilan -->
		<section class="rounded-2xl border border-line bg-card p-5 shadow-sm">
			<h2 class="font-display text-lg font-semibold text-ink">Dernier bilan — {latest.weekLabel}</h2>
			<ul class="mt-3 space-y-2 text-sm text-ink">
				{#each latestLines as line}
					<li><span class="font-bold text-mist">{line.header} :</span> {line.text}</li>
				{/each}
			</ul>
			{#if latest.status === 'retour_envoye'}
				<div class="mt-4 rounded-xl bg-brand-light px-4 py-3 text-sm text-ink">💬 Retour de ta coach reçu — <a href="/espace/historique" class="font-semibold underline underline-offset-2">voir dans mes bilans</a></div>
			{/if}
		</section>

		<!-- Motivation -->
		<section class="rounded-2xl border border-line bg-card p-5 shadow-sm">
			<div class="mb-3 flex items-center justify-between">
				<h2 class="font-display text-lg font-semibold text-ink">Ta motivation</h2>
				<span class="text-xs font-semibold uppercase tracking-wide text-mist">sur {points.length} semaine{points.length > 1 ? 's' : ''}</span>
			</div>
			<MotivationChart {points} />
		</section>
	</div>

	<!-- Statistiques -->
	<section class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
		<div class="rounded-2xl border border-line bg-card p-4">
			<div class="font-display text-3xl font-semibold text-ink">{checkins.length}</div>
			<div class="text-xs font-semibold uppercase tracking-wide text-mist">Bilans envoyés</div>
		</div>
		<div class="rounded-2xl border border-line bg-card p-4">
			<div class="font-display text-3xl font-semibold text-ink">{avg ?? '—'}<span class="text-base text-mist">/5</span></div>
			<div class="text-xs font-semibold uppercase tracking-wide text-mist">Motivation moyenne</div>
		</div>
		<div class="rounded-2xl border border-line bg-card p-4">
			<div class="font-display text-3xl font-semibold text-ink">{adherent !== null ? `${adherent}%` : '—'}</div>
			<div class="text-xs font-semibold uppercase tracking-wide text-mist">Semaines alignées</div>
		</div>
		<div class="rounded-2xl border border-line bg-card p-4">
			<div class="font-display text-3xl font-semibold text-ink">{wins.length}</div>
			<div class="text-xs font-semibold uppercase tracking-wide text-mist">Victoires 🏆</div>
		</div>
	</section>
{:else}
	<div class="rounded-2xl border border-dashed border-line bg-card px-6 py-16 text-center">
		<p class="text-4xl">🌱</p>
		<h2 class="mt-4 font-display text-xl font-semibold text-ink">Bienvenue dans ton suivi {user.prenom} !</h2>
		<p class="mx-auto mt-2 max-w-md text-sm leading-relaxed text-mist">
			Chaque fin de semaine, remplis ton bilan depuis le lien que ta coach t'envoie.
			Il apparaîtra ici avec ton historique et ta progression.
		</p>
		<a href="/bilan" class="mt-6 inline-block rounded-xl bg-brand px-6 py-3 font-display font-semibold uppercase tracking-wide text-white transition hover:bg-brand-dark">
			Remplir mon premier bilan →
		</a>
	</div>
{/if}
