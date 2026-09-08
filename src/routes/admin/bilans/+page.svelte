<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';

	type Row = {
		userId: string;
		prenom: string;
		nom?: string | null;
		weekStart: string;
		weekLabel: string;
		checkin: {
			status: 'nouveau' | 'retour_envoye';
			feedback?: string | null;
			feedbackAt?: number | null;
			feedbackReadAt?: number | null;
			_creationTime: number;
		} | null;
	};
	type Board = {
		toTreat: Row[];
		feedbackSent: Row[];
		done: Row[];
		missing: Row[];
		missingWeek: { weekStart: string; weekLabel: string } | null;
		all: Row[];
	};

	let { data } = $props();
	const board = $derived<Board>(data.board ?? { toTreat: [], feedbackSent: [], done: [], missing: [], missingWeek: null, all: [] });
	const weeks = $derived<string[]>(data.weeks ?? []);
	let selectedWeek = $state<string | null>(data.selectedWeek ?? null);

	const fullName = (r: Row): string => (r.nom ? `${r.prenom} ${r.nom}` : r.prenom);

	/** « Semaine du lundi 7 au dimanche 13 septembre » (année ajoutée si ≠ année courante). */
	function weekRange(weekStart: string): string {
		const monday = new Date(weekStart + 'T12:00:00');
		const sunday = new Date(monday.getTime() + 6 * 86400000);
		const fmt = (d: Date, withYear: boolean) =>
			d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' } : {}) });
		const sameYear = monday.getFullYear() === sunday.getFullYear();
		const thisYear = monday.getFullYear() === new Date().getFullYear();
		const y = !thisYear ? ` ${monday.getFullYear()}` : '';
		if (sameYear) return `Semaine du ${fmt(monday, false)} au ${fmt(sunday, false)}${y}`;
		return `Semaine du ${fmt(monday, true)} au ${fmt(sunday, true)}`;
	}

	/** Ligne de la semaine affichée, triées : manquant d'abord ? Non — par statut d'action. */
	const weekRows = $derived.by(() => {
		if (!selectedWeek) return { toTreat: [], feedbackSent: [], done: [], missing: [] };
		const rows = (board.all ?? []).filter((r) => r.weekStart === selectedWeek);
		const isUnread = (c: NonNullable<Row['checkin']>) =>
			c.status === 'retour_envoye' && (c.feedbackReadAt == null || c.feedbackReadAt < (c.feedbackAt ?? c._creationTime));
		const toTreat: Row[] = [];
		const feedbackSent: Row[] = [];
		const done: Row[] = [];
		const missing: Row[] = [];
		for (const r of rows) {
			if (!r.checkin) {
				missing.push(r);
			} else if (r.checkin.status === 'nouveau') {
				toTreat.push(r);
			} else if (isUnread(r.checkin)) {
				feedbackSent.push(r);
			} else {
				done.push(r);
			}
		}
		const byName = (a: Row, b: Row) => fullName(a).localeCompare(fullName(b), 'fr');
		toTreat.sort(byName);
		feedbackSent.sort(byName);
		done.sort(byName);
		missing.sort(byName);
		return { toTreat, feedbackSent, done, missing };
	});

	function fmtReadAt(ts?: number | null): string {
		if (!ts) return '';
		return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
	}
	function fmtSentAt(c: NonNullable<Row['checkin']>): string {
		return new Date(c._creationTime).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
	}
	const open360 = (r: Row) =>
		`/admin?client=${encodeURIComponent(r.userId)}&section=bilans&week=${encodeURIComponent(r.weekStart)}`;
	const totals = $derived({
		aTraiter: weekRows.toTreat.length,
		nonLu: weekRows.feedbackSent.length,
		manquants: weekRows.missing.length,
		lu: weekRows.done.length,
	});
</script>

<svelte:head><title>Bilans — G-Flux (CRM)</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3">
	<div>
		<h1 class="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
			<Icon name="clipboardList" size={22} class="shrink-0 text-brand" /> Bilans
		</h1>
		<p class="mt-1 text-sm text-mist">Tous les bilans des clientes, semaine par semaine — un clic ouvre la Vision 360.</p>
	</div>
	<a
		href="/admin"
		class="inline-flex items-center gap-1.5 rounded-xl border-2 border-line bg-card px-3.5 py-2 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand"
	><Icon name="arrowLeft" size={14} class="shrink-0" /> Client·e·s & tableau de bord</a>
</div>

<!-- ═══ Sélecteur de semaine ═══ -->
{#if weeks.length > 0}
	<div class="mt-5 flex items-center gap-2 overflow-x-auto pb-1">
		<span class="shrink-0 text-[11px] font-bold uppercase tracking-wider text-mist">Semaine</span>
		{#each weeks as w (w)}
			<a
				href={`/admin/bilans?week=${w}`}
				class="whitespace-nowrap rounded-full border-2 px-3 py-1.5 text-xs font-semibold transition
					{w === selectedWeek ? 'border-brand bg-brand text-white' : 'border-line bg-card text-ink hover:border-brand hover:text-brand'}"
			>{weekRange(w)}</a>
		{/each}
	</div>
{/if}

{#if selectedWeek}
	<!-- ═══ Bilan de la semaine sélectionnée ═══ -->
	<section class="mt-4 rounded-2xl border border-line bg-card p-5 shadow-sm">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<h2 class="font-display text-lg font-semibold text-ink">{weekRange(selectedWeek)}</h2>
			<div class="flex flex-wrap gap-1.5 text-[11px] font-bold">
				{#if totals.aTraiter > 0}<span class="rounded-full bg-warn-light px-2 py-0.5 text-warn">À traiter {totals.aTraiter}</span>{/if}
				{#if totals.nonLu > 0}<span class="rounded-full bg-brand-light px-2 py-0.5 text-brand-dark">Retour envoyé · non lu {totals.nonLu}</span>{/if}
				{#if totals.manquants > 0}<span class="rounded-full bg-danger-light px-2 py-0.5 text-danger">Manquants {totals.manquants}</span>{/if}
				{#if totals.lu > 0}<span class="rounded-full bg-line px-2 py-0.5 text-mist">Lus {totals.lu}</span>{/if}
			</div>
		</div>

		{#if weekRows.toTreat.length + weekRows.feedbackSent.length + weekRows.done.length + weekRows.missing.length === 0}
			<p class="mt-4 rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-mist">Aucun bilan pour cette semaine.</p>
		{:else}
			<div class="mt-4 grid gap-5 lg:grid-cols-2">
				{#if weekRows.toTreat.length > 0}
					<div>
						<h3 class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-warn"><span class="h-2 w-2 rounded-full bg-warn"></span> À traiter</h3>
						<div class="mt-2 space-y-1.5">
							{#each weekRows.toTreat as r (r.userId)}
								<a href={open360(r)} class="flex items-center gap-2 rounded-xl border border-line/70 bg-white px-3 py-2.5 transition hover:border-warn/60 hover:bg-warn-light/30">
									<div class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-warn/15 font-display text-sm font-semibold text-warn">{r.prenom.charAt(0).toUpperCase()}</div>
									<div class="min-w-0 flex-1">
										<div class="truncate text-sm font-semibold text-ink">{fullName(r)}</div>
										<div class="truncate text-[11px] text-mist">Bilan reçu{r.checkin ? ` le ${fmtSentAt(r.checkin)}` : ''} · retour à écrire</div>
									</div>
									<span class="shrink-0 text-xs font-bold text-warn">Vision 360 →</span>
								</a>
							{/each}
						</div>
					</div>
				{/if}

				{#if weekRows.feedbackSent.length > 0}
					<div>
						<h3 class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-brand-dark"><span class="h-2 w-2 rounded-full bg-brand"></span> Retour envoyé · non lu</h3>
						<div class="mt-2 space-y-1.5">
							{#each weekRows.feedbackSent as r (r.userId)}
								<a href={open360(r)} class="flex items-center gap-2 rounded-xl border border-line/70 bg-white px-3 py-2.5 transition hover:border-brand/60 hover:bg-brand-light/30">
									<div class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand/15 font-display text-sm font-semibold text-brand-dark">{r.prenom.charAt(0).toUpperCase()}</div>
									<div class="min-w-0 flex-1">
										<div class="truncate text-sm font-semibold text-ink">{fullName(r)}</div>
										<div class="truncate text-[11px] text-mist"><span class="font-bold text-warn">Non lu</span> · retour envoyé{r.checkin?.feedbackAt ? ` le ${fmtReadAt(r.checkin.feedbackAt)}` : ''}</div>
									</div>
									<span class="shrink-0 text-xs font-bold text-brand-dark">Vision 360 →</span>
								</a>
							{/each}
						</div>
					</div>
				{/if}

				{#if weekRows.missing.length > 0}
					<div>
						<h3 class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-danger"><span class="h-2 w-2 rounded-full bg-danger"></span> Bilans manquants</h3>
						<div class="mt-2 space-y-1.5">
							{#each weekRows.missing as r (r.userId)}
								<a href={open360(r)} class="flex items-center gap-2 rounded-xl border border-line/70 bg-white px-3 py-2.5 transition hover:border-danger/60 hover:bg-danger-light/30">
									<div class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-danger/10 font-display text-sm font-semibold text-danger">{r.prenom.charAt(0).toUpperCase()}</div>
									<div class="min-w-0 flex-1">
										<div class="truncate text-sm font-semibold text-ink">{fullName(r)}</div>
										<div class="truncate text-[11px] text-mist">Bilan non reçu</div>
									</div>
									<span class="shrink-0 text-xs font-bold text-danger">Vision 360 →</span>
								</a>
							{/each}
						</div>
					</div>
				{/if}

				{#if weekRows.done.length > 0}
					<div>
						<h3 class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-mist"><Icon name="check" size={12} class="shrink-0" /> Retour lu</h3>
						<div class="mt-2 space-y-1.5">
							{#each weekRows.done as r (r.userId)}
								<a href={open360(r)} class="flex items-center gap-2 rounded-xl border border-line/70 bg-white px-3 py-2.5 transition hover:border-brand/60 hover:bg-brand-light/30">
									<div class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-line/70 font-display text-sm font-semibold text-mist">{r.prenom.charAt(0).toUpperCase()}</div>
									<div class="min-w-0 flex-1">
										<div class="truncate text-sm font-semibold text-ink">{fullName(r)}</div>
										<div class="truncate text-[11px] text-mist">✓ Lu{r.checkin?.feedbackReadAt ? ` le ${fmtReadAt(r.checkin.feedbackReadAt)}` : ''}</div>
									</div>
									<span class="shrink-0 text-xs font-bold text-mist">Vision 360 →</span>
								</a>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</section>
{:else}
	<div class="mt-6 rounded-2xl border border-dashed border-line bg-card px-6 py-16 text-center">
		<p class="grid place-items-center"><Icon name="clipboardList" size={34} class="text-mist" /></p>
		<p class="mt-3 text-sm text-mist">Aucun bilan pour l'instant — les semaines apparaîtront ici dès la première soumission.</p>
	</div>
{/if}