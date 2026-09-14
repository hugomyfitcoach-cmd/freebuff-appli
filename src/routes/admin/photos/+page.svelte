<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import { PHOTO_STEP_LABELS, type PhotoStep } from '$lib/photos';

	type Deposit = {
		_id: string;
		userId: string;
		prenom: string;
		nom: string | null;
		step: string;
		count: number;
		createdAt: number;
		date: string;
		ids: string[];
	};

	let { data } = $props();
	// Tri serveur : du plus récent au plus ancien — la première ligne est le
	// dernier dépôt, les anciens dépôts restent accessibles en dessous.
	const deposits = $derived<Deposit[]>(data.deposits ?? []);

	const fullName = (d: Deposit): string => (d.nom ? `${d.prenom} ${d.nom}` : d.prenom);

	/** Date du dépôt (champ `date` "yyyy-mm-dd" du système photo existant). */
	function fmtDate(iso: string): string {
		return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		});
	}

	/** Heure du dépôt (horodatage réel de l'envoi). */
	function fmtTime(ts: number): string {
		return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
	}

	/** « Voir les photos » → Vision 360 de la cliente, ouverte sur l'onglet Photos. */
	const photosLink = (d: Deposit): string => `/admin?client=${encodeURIComponent(d.userId)}&section=photos`;
</script>

<svelte:head><title>Photos — G-Flux (CRM)</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3">
	<div>
		<h1 class="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
			<Icon name="camera" size={22} class="shrink-0 text-brand" /> Photos
		</h1>
		<p class="mt-1 text-sm text-mist">
			Historique permanent des dépôts de photos — du plus récent au plus ancien, jamais supprimé.
		</p>
	</div>
	{#if deposits.length > 0}
		<span class="rounded-full bg-brand-light px-3 py-1 text-xs font-bold text-brand-dark">
			{deposits.length} dépôt{deposits.length > 1 ? 's' : ''}
		</span>
	{/if}
</div>

{#if deposits.length === 0}
	<p class="mt-5 rounded-2xl border border-dashed border-line bg-card px-6 py-12 text-center text-sm text-mist">
		Aucun dépôt de photo pour l'instant. Dès qu'une cliente envoie ses photos de suivi, le dépôt apparaît ici en tête de liste.
	</p>
{:else}
	<div class="mt-5 space-y-2">
		{#each deposits as d (d._id)}
			{@const stepLabel = PHOTO_STEP_LABELS[d.step as PhotoStep] ?? d.step}
			<div class="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-card px-4 py-3 shadow-sm transition hover:border-brand/50">
				<span class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-light text-brand-dark">
					<Icon name="camera" size={17} />
				</span>
				<div class="min-w-0 flex-1">
					<div class="flex flex-wrap items-baseline gap-x-2">
						<span class="truncate text-sm font-bold text-ink">{fullName(d)}</span>
						<span class="rounded-full bg-line/60 px-2 py-0.5 text-[11px] font-semibold text-ink/70">{stepLabel}</span>
						{#if d.count > 0}
							<span class="text-[11px] font-semibold text-mist">
								{d.count} photo{d.count > 1 ? 's' : ''}
							</span>
						{/if}
					</div>
					<p class="mt-0.5 text-xs text-mist">
						{fmtDate(d.date)} · {fmtTime(d.createdAt)}
					</p>
				</div>
				<a
					href={photosLink(d)}
					data-sveltekit-preload-data="tap"
					class="inline-flex shrink-0 items-center gap-1.5 rounded-xl border-2 border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand"
				>
					<Icon name="images" size={15} class="shrink-0" /> Voir les photos
				</a>
			</div>
		{/each}
	</div>
{/if}
