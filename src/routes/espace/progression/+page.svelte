<script lang="ts">
	import MotivationChart from '../../../lib/components/MotivationChart.svelte';
	import { avgMotivation, countAdherence, series, trackingWeeks, victories, ADHERENCE_LABEL } from '$lib/stats.js';

	let { data } = $props();
	const checkins = $derived(data.checkins ?? []);
	const points = $derived(series(checkins)); // du plus ancien au plus récent
	const wins = $derived(victories(checkins));
	const tracking = $derived(trackingWeeks(checkins));
	const avg = $derived(avgMotivation(points));

	const evolve = (v: string | null) => (v === 'baisse' ? '🟢 baisse' : v === 'hausse' ? '🔴 hausse' : v === 'stable' ? '⚪ stable' : '—');
	const pasLabel = (v: string | null) =>
		v === 'moins5000' ? '🔴 <5k' : v === '5000-8000' ? '🟠 5-8k' : v === '8000-10000' ? '🟢 8-10k' : v === 'plus10000' ? '🟢 10k+' : '—';
</script>

<svelte:head><title>Ma progression — G-Flux</title></svelte:head>

<h1 class="font-display text-2xl font-semibold text-ink">Ma progression 📈</h1>
<p class="mt-1 text-sm text-mist">Tes réponses semaine après semaine, pour voir la tendance plutôt que le détail.</p>

{#if points.length === 0}
	<div class="mt-8 rounded-2xl border border-dashed border-line bg-card px-6 py-16 text-center">
		<p class="text-4xl">📊</p>
		<p class="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-mist">
			Ta progression s'affichera ici après ton premier bilan. Rends-toi sur la page d'accueil pour commencer.
		</p>
		<a href="/bilan" class="mt-5 inline-block rounded-xl bg-brand px-5 py-2.5 font-display font-semibold uppercase tracking-wide text-white hover:bg-brand-dark">Remplir mon bilan →</a>
	</div>
{:else}
	<!-- Courbe de motivation -->
	<section class="mt-6 rounded-2xl border border-line bg-card p-5 shadow-sm">
		<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
			<h2 class="font-display text-lg font-semibold text-ink">Motivation — tendance</h2>
			<span class="rounded-full bg-brand-light px-3 py-1 text-xs font-bold text-brand-dark">Moyenne : {avg ?? '—'}/5</span>
		</div>
		<MotivationChart {points} height={180} />
	</section>

	<!-- Récapitulatif semaine par semaine -->
	<section class="mt-6 rounded-2xl border border-line bg-card shadow-sm">
		<h2 class="border-b border-line px-5 py-4 font-display text-lg font-semibold text-ink">Semaine par semaine</h2>
		<div class="overflow-x-auto">
			<table class="w-full min-w-[560px] text-sm">
				<thead>
					<tr class="border-b border-line text-left text-[11px] font-bold uppercase tracking-wide text-mist">
						<th class="px-5 py-3">Semaine</th>
						<th class="px-3 py-3">Motivation</th>
						<th class="px-3 py-3">Plan</th>
						<th class="px-3 py-3">Évolution perçue</th>
						<th class="px-3 py-3">Pas / jour</th>
						<th class="px-3 py-3">Retour</th>
					</tr>
				</thead>
				<tbody>
					{#each points as p (p.weekStart)}
						<tr class="border-b border-line/60 last:border-0">
							<td class="px-5 py-3 font-semibold text-ink">{p.label}</td>
							<td class="px-3 py-3">
								{#if p.motivation !== null}
									<span class="inline-flex items-center gap-1.5">
										<span class="h-2.5 w-2.5 rounded-full" style:background={p.motivation <= 2 ? '#ff4444' : p.motivation === 3 ? '#f0c000' : '#1db954'}></span>
										{p.motivation}/5
									</span>
								{:else}—{/if}
							</td>
							<td class="px-3 py-3">{p.adherence ? ADHERENCE_LABEL[p.adherence] ?? p.adherence : '—'}</td>
							<td class="px-3 py-3">{evolve(p.evolution)}</td>
							<td class="px-3 py-3">{pasLabel(p.pas)}</td>
							<td class="px-3 py-3">{p.status === 'retour_envoye' ? '💬 envoyé' : '⏳ à venir'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<div class="mt-6 grid gap-4 lg:grid-cols-2">
		<!-- Victoires -->
		<section class="rounded-2xl border border-line bg-card p-5 shadow-sm">
			<h2 class="font-display text-lg font-semibold text-ink">Tes victoires 🏆</h2>
			{#if wins.length > 0}
				<ul class="mt-3 space-y-3">
					{#each wins as win (win.weekLabel)}
						<li class="rounded-xl bg-brand-light/60 px-4 py-3">
							<div class="text-[11px] font-bold uppercase tracking-wide text-mist">{win.weekLabel}</div>
							<p class="mt-0.5 text-sm text-ink">“{win.text}”</p>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="mt-3 text-sm italic text-mist">Aucune victoire notée pour l'instant — pense à la partager dans ton bilan 💪</p>
			{/if}
		</section>

		<!-- Mensurations & photos -->
		<section class="rounded-2xl border border-line bg-card p-5 shadow-sm">
			<h2 class="font-display text-lg font-semibold text-ink">Suivi corporel 📏</h2>
			{#if tracking.length > 0}
				<ul class="mt-3 divide-y divide-line/70">
					{#each tracking as t (t.weekLabel)}
						<li class="flex items-center justify-between gap-3 py-2.5 text-sm">
							<span class="font-semibold text-ink">{t.weekLabel}</span>
							<span class="text-mist">
								{t.mensurations ? '📏 mensurations ✓' : ''}
								{t.mensurations && t.photos ? ' · ' : ''}
								{t.photos ? '📸 photos ✓' : ''}
								{t.mensurations || t.photos ? '' : '—'}
							</span>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="mt-3 text-sm italic text-mist">Les semaines de mensurations et de photos apparaîtront ici.</p>
			{/if}
			<div class="mt-4 rounded-xl bg-warn-light px-4 py-3 text-xs leading-relaxed text-ink">
				💡 <strong>Le rappel :</strong> la tendance compte plus qu'un chiffre isolé — l'important c'est la régularité.
			</div>
		</section>
	</div>
{/if}
