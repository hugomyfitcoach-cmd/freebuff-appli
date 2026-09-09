<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import BackToHome from '$lib/components/BackToHome.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import StepsBars from '$lib/components/StepsBars.svelte';

	let { data } = $props();
	const goal = $derived<number | null>(data.history.goal ?? null);
	const rows = $derived<{ date: string; count: number }[]>(data.history.rows ?? []);

	/* ————— Fenêtre locale (fuseau de la cliente) : aujourd'hui et les 6 jours précédents ————— */
	function iso(d: Date): string {
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}
	const todayISO = $derived.by(() => {
		const d = new Date();
		return iso(d);
	});
	const windowDays = $derived.by<{ date: string; count: number | null }[]>(() => {
		const out: { date: string; count: number | null }[] = [];
		for (let i = 6; i >= 0; i--) {
			const d = new Date();
			d.setDate(d.getDate() - i);
			const key = iso(d);
			const hit = rows.find((r) => r.date === key);
			out.push({ date: key, count: hit ? hit.count : null });
		}
		return out;
	});

	const tracked = $derived(windowDays.filter((d) => d.count !== null));
	const total = $derived(tracked.reduce((s, d) => s + (d.count ?? 0), 0));
	const avg = $derived(tracked.length > 0 ? Math.round(total / tracked.length) : null);
	const best = $derived.by<{ date: string; count: number } | null>(() => {
		if (tracked.length === 0) return null;
		return tracked.reduce((a, b) => ((b.count ?? 0) > (a.count ?? 0) ? b : a)) as { date: string; count: number };
	});
	const todayCount = $derived(rows.find((r) => r.date === todayISO)?.count ?? null);

	function bestLabel(date: string): string {
		const d = new Date(date + 'T12:00:00');
		return d
			.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' })
			.replace(/^./, (c) => c.toUpperCase());
	}

	/* ————— Saisie rétroactive : mode édition des 7 derniers jours ————— */
	let editing = $state(false);
	let edits = $state<Record<string, string>>({});
	let editsSaving = $state(false);
	let editsError = $state('');

	function dayLabel(date: string): { day: string; dateLabel: string } {
		const d = new Date(date + 'T12:00:00');
		const wd = d
			.toLocaleDateString('fr-FR', { weekday: 'short' })
			.replace(/\.$/, '');
		const dl = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
		return { day: wd, dateLabel: dl };
	}

	function startEditing() {
		const next: Record<string, string> = {};
		for (const d of windowDays) next[d.date] = d.count !== null ? String(d.count) : '';
		edits = next;
		editsError = '';
		editing = true;
	}

	async function saveEdits() {
		const changes: { date: string; count: number }[] = [];
		for (const d of windowDays) {
			const raw = (edits[d.date] ?? '').trim();
			if (raw === '') continue; // champ vide = aucun changement (jour sans donnée ≠ 0)
			const n = Number(raw.replace(/\s/g, ''));
			if (!Number.isInteger(n) || n < 0 || n > 150000) {
				editsError = `Valeur invalide pour le ${dayLabel(d.date).day} ${dayLabel(d.date).dateLabel} : entre 0 et 150 000 pas.`;
				return;
			}
			changes.push({ date: d.date, count: n });
		}
		if (changes.length === 0) {
			editing = false;
			return;
		}
		editsSaving = true;
		editsError = '';
		try {
			// Upsert par date (1 cliente + 1 date = 1 valeur) — jamais de doublon.
			for (const c of changes) {
				const res = await fetch('/api/steps', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(c),
				});
				const body = await res.json();
				if (!res.ok || body.error) throw new Error(body.error ?? 'Enregistrement impossible.');
			}
			editing = false;
			await invalidateAll(); // graphique + total + moyenne + meilleur jour + suivi recalculés
		} catch (e) {
			editsError = e instanceof Error ? e.message : 'Enregistrement impossible.';
		} finally {
			editsSaving = false;
		}
	}

	/* ————— Saisie du jour ————— */
	let stepsValue = $state('');
	let stepsSaving = $state(false);
	let stepsError = $state('');
	$effect(() => {
		if (todayCount !== null && stepsValue === '') stepsValue = String(todayCount);
	});
	async function saveSteps() {
		const n = Number(String(stepsValue).replace(/\s/g, ''));
		if (!Number.isInteger(n) || n < 0 || n > 150000) {
			stepsError = 'Entre un nombre valide (0 à 150 000 pas).';
			return;
		}
		stepsSaving = true;
		stepsError = '';
		try {
			const res = await fetch('/api/steps', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ date: todayISO, count: n }),
			});
			const body = await res.json();
			if (!res.ok || body.error) throw new Error(body.error ?? 'Enregistrement impossible.');
			await invalidateAll();
		} catch (e) {
			stepsError = e instanceof Error ? e.message : 'Enregistrement impossible.';
		} finally {
			stepsSaving = false;
		}
	}

	const fmt = (n: number) => n.toLocaleString('fr-FR');
</script>

<svelte:head><title>Mes pas — G-Flux</title></svelte:head>

<div class="mx-auto w-full max-w-xl px-4 pb-28 pt-4 sm:px-6">
	<BackToHome label="Mes pas" />

	<div class="flex items-center gap-3">
		<div class="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-light"><Icon name="footprints" size={22} class="text-brand" /></div>
		<div class="min-w-0 flex-1">
			<h1 class="font-display text-2xl font-semibold tracking-tight text-ink">Mes pas</h1>
			<p class="text-sm text-mist">7 derniers jours — les jours sans saisie ne comptent pas comme zéro.</p>
		</div>
		{#if !editing}
			<button
				type="button"
				onclick={startEditing}
				class="grid h-11 w-11 shrink-0 place-items-center rounded-full text-mist transition hover:bg-line/50 hover:text-ink"
				aria-label="Modifier les 7 derniers jours"
				title="Modifier les 7 jours"
			><Icon name="pencil" size={18} /></button>
		{/if}
	</div>

	{#if editing}
		<!-- Mode édition : tous les jours de la fenêtre, y compris rétroactifs -->
		<section class="mt-5 rounded-3xl border border-line bg-card p-4 shadow-sm">
			<div class="flex items-center justify-between gap-2">
				<h2 class="text-[11px] font-bold uppercase tracking-widest text-mist">Modifier les 7 jours</h2>
				<span class="text-[11px] text-mist">1 valeur par jour</span>
			</div>
			<div class="mt-1 flex flex-col divide-y divide-line/60">
				{#each windowDays as d (d.date)}
					{@const lbl = dayLabel(d.date)}
					<div class="flex items-center gap-2 py-2">
						<span class="w-12 shrink-0 text-[13px] font-semibold text-ink">{lbl.day}</span>
						<span class="w-[4.5rem] shrink-0 text-xs text-mist">{lbl.dateLabel}{d.date === todayISO ? ' · auj.' : ''}</span>
						<input
							type="number"
							inputmode="numeric"
							min="0"
							max="150000"
							placeholder={d.count !== null ? String(d.count) : 'Ajouter'}
							bind:value={edits[d.date]}
							class="w-full min-w-0 flex-1 rounded-xl border-2 border-line bg-soft px-3 py-2 text-sm font-semibold tabular-nums text-ink outline-none transition focus:border-brand"
						/>
					</div>
				{/each}
			</div>
			{#if editsError}
				<p class="mt-2 text-xs font-semibold text-danger">{editsError}</p>
			{/if}
			<div class="mt-3 flex gap-2">
				<button
					type="button"
					onclick={saveEdits}
					disabled={editsSaving}
					class="flex-1 rounded-xl bg-brand px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-60"
				>{editsSaving ? 'Enregistrement…' : 'Enregistrer'}</button>
				<button
					type="button"
					onclick={() => (editing = false)}
					disabled={editsSaving}
					class="rounded-xl border-2 border-line px-4 py-2.5 text-sm font-semibold text-mist transition hover:text-ink"
				>Annuler</button>
			</div>
			<p class="mt-2 text-[11px] leading-snug text-mist">Un champ vide ne change rien : une journée sans saisie n'est jamais comptée comme 0 pas.</p>
		</section>
	{/if}

	<!-- Saisie du jour -->
	<section class="mt-5 rounded-3xl border border-line bg-card p-4 shadow-sm">
		<p class="flex items-center gap-1.5 text-sm font-bold text-ink">
			<Icon name="calendarDays" size={16} class="shrink-0 text-brand" />
			Aujourd'hui
			{#if todayCount !== null}
				<span class="rounded-full bg-brand-light px-2 py-0.5 text-xs font-bold text-brand-dark">{fmt(todayCount)} pas</span>
			{/if}
		</p>
		<div class="mt-2.5 flex items-center gap-2">
			<input
				type="number"
				inputmode="numeric"
				min="0"
				max="150000"
				placeholder="Ex. 8742"
				bind:value={stepsValue}
				class="w-full flex-1 rounded-2xl border-2 border-line bg-soft px-4 py-3 text-lg font-semibold tabular-nums text-ink outline-none transition focus:border-brand"
			/>
			<button
				type="button"
				onclick={saveSteps}
				disabled={stepsSaving}
				class="shrink-0 rounded-2xl bg-ink px-5 py-3 text-sm font-bold text-white transition hover:bg-brand disabled:opacity-60"
			>
				{stepsSaving ? '…' : todayCount !== null ? 'Modifier' : 'Enregistrer'}
			</button>
		</div>
		{#if stepsError}
			<p class="mt-1.5 text-xs font-semibold text-danger">{stepsError}</p>
		{/if}
	</section>

	<!-- Graphique 7 derniers jours -->
	<section class="mt-4 rounded-3xl border border-line bg-card p-4 shadow-sm">
		<div class="flex items-center justify-between gap-2">
			<h2 class="text-[11px] font-bold uppercase tracking-widest text-mist">7 derniers jours</h2>
			{#if goal !== null}
				<span class="text-[11px] font-semibold text-mist">Objectif : {fmt(goal)} pas / jour</span>
			{/if}
		</div>

		{#if tracked.length === 0}
			<div class="flex flex-col items-center gap-2 px-4 py-10 text-center">
				<span class="grid h-12 w-12 place-items-center rounded-full bg-soft"><Icon name="footprints" size={22} class="text-mist" /></span>
				<p class="font-display text-lg font-semibold text-ink">Pas assez de données</p>
				<p class="text-sm text-mist">0 / 7 jours renseignés — enregistre tes pas ci-dessus pour voir tes statistiques apparaître.</p>
			</div>
		{:else}
			<div class="mt-3">
				<StepsBars days={windowDays} goal={goal} height={160} />
			</div>

			<!-- Statistiques -->
			<div class="mt-4 divide-y divide-line/70 border-t border-line">
				<div class="flex items-baseline justify-between gap-3 py-2.5">
					<span class="text-sm text-mist">Total</span>
					<span class="font-display text-xl font-bold tabular-nums tracking-tight text-ink">{fmt(total)} <span class="text-xs font-semibold text-mist">pas</span></span>
				</div>
				<div class="flex items-baseline justify-between gap-3 py-2.5">
					<span class="text-sm text-mist">Moyenne / jour</span>
					<span class="font-display text-xl font-bold tabular-nums tracking-tight text-ink">{avg !== null ? fmt(avg) : '—'} <span class="text-xs font-semibold text-mist">pas</span></span>
				</div>
				<div class="flex items-baseline justify-between gap-3 py-2.5">
					<span class="text-sm text-mist">Meilleur jour</span>
					<span class="text-right">
						<span class="font-display text-xl font-bold tabular-nums tracking-tight text-ink">{best ? fmt(best.count) : '—'}</span>
						{#if best}<span class="ml-1 text-xs text-mist">{bestLabel(best.date)}</span>{/if}
					</span>
				</div>
				<div class="flex items-baseline justify-between gap-3 py-2.5">
					<span class="text-sm text-mist">Suivi</span>
					<span class="text-sm font-semibold tabular-nums text-ink">{tracked.length} / 7 jours renseignés</span>
				</div>
				{#if goal !== null}
					<div class="flex items-baseline justify-between gap-3 py-2.5">
						<span class="text-sm text-mist">Objectif</span>
						<span class="text-sm font-semibold tabular-nums text-ink">{fmt(goal)} pas / jour</span>
					</div>
				{/if}
			</div>
		{/if}
	</section>

	<p class="mt-3 flex items-start gap-1.5 px-1 text-xs leading-relaxed text-mist">
		<Icon name="lightbulb" size={13} class="mt-0.5 shrink-0" />
		<span>La moyenne est calculée sur les jours réellement renseignés : une journée sans saisie n'est jamais comptée comme 0 pas.</span>
	</p>
</div>