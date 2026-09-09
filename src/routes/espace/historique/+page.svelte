<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import BackToHome from '$lib/components/BackToHome.svelte';
	import RecapBilan from '../../../lib/components/RecapBilan.svelte';

	let { data } = $props();
	const checkins = $derived(data.checkins ?? []);
	const media = $derived((data.media ?? {}) as Record<string, unknown[]>);
	const done = $derived(checkins.filter((c: { status: string }) => c.status === 'retour_envoye').length);
</script>

<svelte:head><title>Mes bilans — G-Flux</title></svelte:head>

<BackToHome label="Mes bilans" />

<div class="mb-6 flex flex-wrap items-end justify-between gap-2">
	<div>
		<h1 class="flex items-center gap-2 font-display text-2xl font-semibold text-ink"><Icon name="clipboardCheck" size={22} class="shrink-0 text-brand" /> Mes bilans</h1>
		<p class="mt-1 text-sm text-mist">
			{checkins.length} bilan{checkins.length > 1 ? 's' : ''} envoyé{checkins.length > 1 ? 's' : ''}
			{#if done > 0} · {done} avec retour de ta coach{/if}
		</p>
	</div>
	<a href="/bilan" class="rounded-xl bg-brand px-4 py-2.5 font-display text-sm font-semibold uppercase tracking-wide text-white transition hover:bg-brand-dark">Remplir la semaine →</a>
</div>

{#if checkins.length === 0}
	<div class="rounded-2xl border border-dashed border-line bg-card px-6 py-16 text-center">
		<p class="grid place-items-center"><Icon name="calendarDays" size={34} class="text-mist" /></p>
		<p class="mt-3 text-sm text-mist">Aucun bilan pour l'instant. Ton premier bilan apparaîtra ici, avec le retour de ta coach.</p>
	</div>
{:else}
	<div class="space-y-4">
		{#each checkins as checkin (checkin._id)}
			<RecapBilan {checkin} media={(media[checkin._id] ?? []) as never} />
		{/each}
	</div>
{/if}
