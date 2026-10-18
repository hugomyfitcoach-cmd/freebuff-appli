<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import BackToHome from '$lib/components/BackToHome.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import StepsBars from '$lib/components/StepsBars.svelte';
	import { avgLast7Completed } from '$lib/averages';
	import { parisTodayISO, shiftISO } from '$lib/vision360';
	import { currentLocalDay } from '$lib/currentDay.svelte';

	let { data } = $props();
	const goal = $derived<number | null>(data.history.goal ?? null);
	type Row = {
		date: string;
		count: number;
	};
	const rows = $derived<Row[]>(data.history.rows ?? []);

	/* ————— Fenêtre : les 7 JOURNÉES TERMINÉES J-7 → J-1 —————
	   MÊME SOURCE DE VÉRITÉ que l'Accueil, le CRM et la Vision 360 :
	   parisTodayISO() (Europe/Paris) + le helper partagé — la journée en cours
	   est incomplète et n'entre JAMAIS dans la moyenne ni le graphique.
	   Exemple jeudi : du jeudi précédent au mercredi terminé. */
	const todayISO = $derived(currentLocalDay());
	const serverTodayISO = $derived(parisTodayISO());
	$effect(() => {
		if (todayISO !== serverTodayISO) void invalidateAll();
	});
	const windowDays = $derived.by<{ date: string; count: number | null }[]>(() => {
		const out: { date: string; count: number | null }[] = [];
		for (let i = 7; i >= 1; i--) {
			const key = shiftISO(todayISO, -i);
			const hit = rows.find((r) => r.date === key);
			out.push({
				date: key,
				count: hit ? hit.count : null,
			});
		}
		return out;
	});

	const tracked = $derived(windowDays.filter((d) => d.count !== null));
	const total = $derived(tracked.reduce((s, d) => s + (d.count ?? 0), 0));
	/** MÊME FONCTION que le CRM coach et le backend (lib/averages.ts) :
	   fenêtre J-7 → J-1 + jours sans saisie jamais comptés comme zéro. */
	const avg = $derived(
		avgLast7Completed(
			rows.map((r) => ({ date: r.date, value: r.count })),
			todayISO
		).avg
	);
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
	let weekEditEl = $state<HTMLElement | undefined>(undefined);

	function dayLabel(date: string): { day: string; dateLabel: string } {
		const d = new Date(date + 'T12:00:00');
		const wd = d
			.toLocaleDateString('fr-FR', { weekday: 'short' })
			.replace(/\.$/, '');
		const dl = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
		return { day: wd, dateLabel: dl };
	}

	function startEditing(scrollTo = false) {
		const next: Record<string, string> = {};
		for (const d of windowDays) next[d.date] = d.count !== null ? String(d.count) : '';
		edits = next;
		editsError = '';
		editing = true;
		/* Ouverture depuis l'action sous le graphique : le panneau d'édition
		   (en haut de page) est amené dans le champ de vision. */
		if (scrollTo) setTimeout(() => weekEditEl?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
	}

	async function saveEdits() {
		const changes: { date: string; count: number }[] = [];
		for (const d of windowDays) {
			// bind:value sur <input type="number"> renvoie un nombre : on normalise en chaîne.
			const raw = String(edits[d.date] ?? '').trim();
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

	/* ————— Saisie du jour —————
	   Hiérarchie simple : la valeur du jour est directement éditable (grand
	   champ discret) avec UN seul CTA « Enregistrer ». Plus de signaux
	   multiples (badge « Modifiable », pseudo-lien, bouton d'ouverture) —
	   la sauvegarde passe par la même logique /api/steps qu'avant. */
	let stepsValue = $state('');
	let stepsSaving = $state(false);
	let stepsError = $state('');
	/* Feedback post-enregistrement : rassure et explique que le jour en cours
	   n'entre pas (volontairement) dans la moyenne des 7 jours TERMINÉS. */
	let savedMsg = $state(false);
	let savedTimer: ReturnType<typeof setTimeout> | undefined;
	function noteSaved() {
		savedMsg = true;
		clearTimeout(savedTimer);
		savedTimer = setTimeout(() => (savedMsg = false), 8000);
	}
	onDestroy(() => clearTimeout(savedTimer));
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
			noteSaved();
		} catch (e) {
			stepsError = e instanceof Error ? e.message : 'Enregistrement impossible.';
		} finally {
			stepsSaving = false;
		}
	}

	const fmt = (n: number) => n.toLocaleString('fr-FR');
</script>

<svelte:head><title>Mes pas — G-Flux</title></svelte:head>
<div class="mx-auto w-full max-w-xl pb-28">
	<BackToHome label="Mes pas" />

	<div class="flex items-center gap-3.5">
		<div class="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-[18px] bg-brand-light"><Icon name="footprints" size={26} class="text-brand" /></div>
		<div class="min-w-0 flex-1">
			<h1 class="text-[#0F1512] page-title">Mes pas</h1>
			<p class="mt-1 text-[14px] leading-[1.4] text-[#66716B]">7 derniers jours terminés — aujourd'hui jamais compté dans la moyenne, les jours sans saisie ne comptent pas comme zéro.</p>
		</div>
	</div>

	{#if editing}
		<!-- Mode édition : tous les jours de la fenêtre, y compris rétroactifs -->
		<section bind:this={weekEditEl} class="mt-4 rounded-[24px] border border-[#EEF1EF] bg-white p-4 shadow-[0_1px_2px_rgba(15,21,18,0.04),0_14px_32px_-16px_rgba(15,21,18,0.18)]">
			<div class="flex items-baseline justify-between gap-2">
				<h2 class="text-[11px] font-black uppercase tracking-[0.1em] text-[#7B857F]">Modifier les 7 jours</h2>
				<span class="text-[12.5px] text-[#66716B]">1 valeur par jour</span>
			</div>
			<div class="mt-1.5 flex flex-col divide-y divide-[#EEF1EF]">
				{#each windowDays as d (d.date)}
					{@const lbl = dayLabel(d.date)}
					<div class="flex items-center gap-2.5 py-2">
						<span class="w-[38px] shrink-0 text-[15px] font-black text-[#0F1512]">{lbl.day}</span>
						<span class="w-[56px] shrink-0 text-[13.5px] text-[#66716B]">{lbl.dateLabel}{d.date === todayISO ? ' · auj.' : ''}</span>
						<label class="fld flex h-[48px] min-w-0 flex-1 items-center rounded-[14px] border-[1.5px] border-[#E3E8E5] bg-[#F6F8F6] px-3.5">
							<input
								type="number"
								inputmode="numeric"
								min="0"
								max="150000"
								placeholder={d.count !== null ? String(d.count) : 'Ajouter'}
								bind:value={edits[d.date]}
								class="w-full min-w-0 border-0 bg-transparent text-[16px] font-bold tabular-nums text-[#0F1512] outline-none"
							/>
						</label>
					</div>
				{/each}
			</div>
			{#if editsError}
				<p class="mt-2 text-xs font-semibold text-danger">{editsError}</p>
			{/if}
			<div class="mt-3 flex gap-2.5">
				<button
					type="button"
					onclick={saveEdits}
					disabled={editsSaving}
					class="tap h-[48px] flex-1 rounded-[24px] bg-brand px-4 text-[16px] font-bold text-white shadow-[0_14px_26px_-12px_rgba(23,163,73,0.65)] transition hover:bg-brand-dark disabled:opacity-60"
				>{editsSaving ? 'Enregistrement…' : 'Enregistrer'}</button>
				<button
					type="button"
					onclick={() => (editing = false)}
					disabled={editsSaving}
					class="tap h-[48px] rounded-[24px] border-[1.5px] border-[#E3E8E5] bg-white px-6 text-[16px] font-bold text-[#66716B] transition hover:text-[#0F1512]"
				>Annuler</button>
			</div>
			<p class="mt-2.5 text-[13px] leading-[1.4] text-[#7B857F]">Un champ vide ne change rien : une journée sans saisie n'est jamais comptée comme 0 pas.</p>
		</section>
	{/if}

	<!-- Aujourd'hui : la valeur du jour est directement éditable (grand champ
	     discret, pré-rempli) avec UN seul CTA « Enregistrer ». Fin des signaux
	     multiples — la valeur du jour reste modifiable ICI uniquement (jamais
	     depuis les barres de la semaine). -->
	<section class="mt-4 rounded-[24px] border border-[#EEF1EF] bg-white p-4 shadow-[0_1px_2px_rgba(15,21,18,0.04),0_14px_32px_-16px_rgba(15,21,18,0.18)]">
		<p class="flex items-center gap-2 text-[15.5px] font-black text-[#0F1512]">
			<Icon name="calendarDays" size={20} class="shrink-0 text-brand" />
			Aujourd'hui
		</p>
		<div class="mt-3 flex items-center gap-2.5">
			<label class="sr-only" for="steps-today">Pas d'aujourd'hui — complète ou modifie cette valeur</label>
			<div class="fld flex h-[48px] min-w-0 flex-1 items-center rounded-[14px] border-[1.5px] border-[#E3E8E5] bg-[#F6F8F6] px-3.5">
				<input
					id="steps-today"
					type="number"
					inputmode="numeric"
					min="0"
					max="150000"
					placeholder={todayCount !== null ? String(todayCount) : 'Ex. 8742'}
					bind:value={stepsValue}
					oninput={() => {
						savedMsg = false;
						clearTimeout(savedTimer);
					}}
					aria-describedby={todayCount !== null ? 'steps-today-hint' : undefined}
					class="w-full min-w-0 border-0 bg-transparent text-[20px] font-black tabular-nums text-[#0F1512] outline-none"
				/>
			</div>
			<button
				type="button"
				onclick={saveSteps}
				disabled={stepsSaving}
				class="tap flex h-[48px] w-[104px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-[14px] bg-[#111A15] text-[14px] font-bold text-white transition hover:bg-brand disabled:opacity-60"
			>
				<Icon name="check" size={16} strokeWidth={2.4} class="shrink-0" />
				{stepsSaving ? '…' : 'Enregistrer'}
			</button>
		</div>
		{#if savedMsg}
			<!-- Confirmation : rassure et explique que le graphique (7 jours
			     terminés) n'intègre pas encore aujourd'hui — c'est voulu. -->
			<div class="mt-2.5 flex items-start gap-2 rounded-xl bg-brand-light/60 px-3 py-2.5" role="status">
				<Icon name="circleCheck" size={15} class="mt-0.5 shrink-0 text-brand-dark" />
				<p class="min-w-0 text-xs leading-relaxed text-[#0F1512]">
					<span class="block font-bold text-brand-dark">C'est noté !</span>
					Tes pas du jour sont bien enregistrés. Ils apparaîtront <span class="font-semibold">demain</span> dans la moyenne des 7 derniers jours.
				</p>
			</div>
		{:else if todayCount !== null}
			<p id="steps-today-hint" class="mt-2.5 text-[13px] leading-[1.4] text-[#7B857F]">Déjà {fmt(todayCount)} pas aujourd'hui — change la valeur ci-dessus si besoin.</p>
		{:else}
			<p class="mt-2.5 text-[13px] leading-[1.4] text-[#7B857F]">Renseigne le compteur de ton téléphone ou de ta montre, à la fin de la journée.</p>
		{/if}
		{#if stepsError}
			<p class="mt-1.5 text-xs font-semibold text-danger">{stepsError}</p>
		{/if}
	</section>

	<!-- Graphique 7 derniers jours -->
	<section class="mt-3.5 rounded-[24px] border border-[#EEF1EF] bg-white px-4 pb-2.5 pt-4 shadow-[0_1px_2px_rgba(15,21,18,0.04),0_14px_32px_-16px_rgba(15,21,18,0.18)]">
		<div class="flex items-baseline justify-between gap-2">
			<h2 class="text-[11px] font-black uppercase tracking-[0.1em] text-[#7B857F]">7 derniers jours</h2>
			{#if goal !== null}
				<span class="text-[12px] font-bold text-[#66716B]">Objectif : {fmt(goal)} pas / jour</span>
			{/if}
		</div>

		{#if tracked.length === 0}
			<div class="flex flex-col items-center gap-2 px-4 py-10 text-center">
				<span class="grid h-12 w-12 place-items-center rounded-full bg-[#F6F8F6]"><Icon name="footprints" size={22} class="text-[#66716B]" /></span>
				<p class="font-display text-lg font-black text-[#0F1512]">Pas assez de données</p>
				<p class="text-sm text-[#66716B]">0 / 7 jours renseignés — ajoute tes pas d'aujourd'hui ci-dessus pour voir tes statistiques apparaître.</p>
			</div>
		{:else}
			<div class="mt-2.5">
				<StepsBars days={windowDays} goal={goal} height={150} />
			</div>

			<!-- Statistiques (proportions Steps.svelte) -->
			<div class="mt-1.5 divide-y divide-[#EEF1EF]">
				<div class="flex items-baseline justify-between gap-3 py-3.5">
					<span class="text-[15.5px] text-[#66716B]">Total</span>
					<span class="font-display text-[24px] font-black tabular-nums tracking-[-0.02em] text-[#0F1512]">{fmt(total)} <span class="text-[13px] font-normal text-[#66716B]">pas</span></span>
				</div>
				<div class="flex items-baseline justify-between gap-3 py-3.5">
					<span class="text-[15.5px] text-[#66716B]">Moyenne / jour <span class="text-[12px] text-[#66716B]">(7 j terminés)</span></span>
					<span class="font-display text-[24px] font-black tabular-nums tracking-[-0.02em] text-[#0F1512]">{avg !== null ? fmt(avg) : '—'} <span class="text-[13px] font-normal text-[#66716B]">pas</span></span>
				</div>
				<div class="flex items-baseline justify-between gap-3 py-3.5">
					<span class="text-[15.5px] text-[#66716B]">Meilleur jour</span>
					<span class="text-right">
						<span class="font-display text-[24px] font-black tabular-nums tracking-[-0.02em] text-[#0F1512]">{best ? fmt(best.count) : '—'}</span>
						{#if best}<span class="ml-1 text-[13px] text-[#66716B]">{bestLabel(best.date)}</span>{/if}
					</span>
				</div>
				<div class="flex items-baseline justify-between gap-3 py-3.5">
					<span class="text-[15.5px] text-[#66716B]">Suivi</span>
					<span class="text-[15.5px] font-black tabular-nums text-[#0F1512]">{tracked.length} / 7 jours renseignés</span>
				</div>
				{#if goal !== null}
					<div class="flex items-baseline justify-between gap-3 py-3.5">
						<span class="text-[15.5px] text-[#66716B]">Objectif</span>
						<span class="text-[15.5px] font-black tabular-nums text-[#0F1512]">{fmt(goal)} pas / jour</span>
					</div>
				{/if}
			</div>
		{/if}

		<!-- Action claire et unique pour corriger la semaine (saisie rétroactive
		     inchangée) — remplace l'icône crayon ambiguë de l'en-tête. Masquée
		     quand le panneau d'édition est déjà ouvert. -->
		{#if !editing}
		<button
			type="button"
			onclick={() => startEditing(true)}
			class="tap mb-1.5 mt-2 flex min-h-[64px] w-full items-center justify-between gap-3 rounded-[18px] bg-[#e8fef0] px-3.5 py-3 text-left transition hover:bg-brand-light/80 active:scale-[0.99]"
		>
			<span class="flex min-w-0 items-center gap-3">
				<Icon name="fileText" size={22} class="shrink-0 text-brand" />
				<span class="min-w-0">
					<span class="block text-[15px] font-black text-[#0F1512]">Mettre à jour mes pas de la semaine</span>
					<span class="mt-0.5 block text-[13px] text-[#66716B]">Modifier plusieurs jours en une seule fois</span>
				</span>
			</span>
			<Icon name="chevronRight" size={18} class="shrink-0 text-[#66716B]" />
		</button>
		{/if}
	</section>

	<p class="mt-3.5 flex items-start gap-2.5 px-1.5 text-[13.5px] leading-[1.45] text-[#66716B]">
		<Icon name="lightbulb" size={19} class="mt-0.5 shrink-0 text-[#9AA39E]" />
		<span>La moyenne est calculée sur les jours réellement renseignés : une journée sans saisie n'est jamais comptée comme 0 pas.</span>
	</p>
</div>
