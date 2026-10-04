<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import ClientAvatar from '$lib/components/ClientAvatar.svelte';

	type Row = {
		userId: string;
		prenom: string;
		nom?: string | null;
		/** Photo de profil (système existant) résolue par bilansBoard — null si aucune. */
		profilePhotoUrl?: string | null;
		weekStart: string;
		weekLabel: string;
		checkin: {
			status: 'nouveau' | 'retour_envoye';
			/** Réponses du bilan — `evolution` : "baisse" | "stable" | "hausse". */
			answers?: { evolution?: string | null } | null;
			feedback?: string | null;
			feedbackAt?: number | null;
			feedbackReadAt?: number | null;
			_creationTime: number;
		} | null;
	};
	type MissingWeek = {
		weekStart: string;
		weekLabel: string;
		clients: { userId: string; prenom: string; nom: string | null; profilePhotoUrl?: string | null }[];
	};
	type Board = {
		toTreat: Row[];
		feedbackSent: Row[];
		done: Row[];
		missing: Row[];
		missingWeek: { weekStart: string; weekLabel: string } | null;
		missingByWeek?: MissingWeek[];
		all: Row[];
	};

	let { data } = $props();
	const board = $derived<Board>(data.board ?? { toTreat: [], feedbackSent: [], done: [], missing: [], missingWeek: null, all: [] });
	const weeks = $derived<string[]>(data.weeks ?? []);
	// Réactif : changer d'onglet semaine recharge data et recalcule tout.
	const selectedWeek = $derived<string | null>(data.selectedWeek ?? null);

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
	/** Version compacte pour les pastilles de navigation : « 28 sept. – 4 oct. ». */
	function weekShort(weekStart: string): string {
		const monday = new Date(weekStart + 'T12:00:00');
		const sunday = new Date(monday.getTime() + 6 * 86400000);
		const fmt = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
		return `${fmt(monday)} – ${fmt(sunday)}`;
	}
	/** Numéro de semaine ISO (affichage des pastilles, ex. « S40 »). */
	function isoWeekNumber(weekStart: string): number {
		const d = new Date(weekStart + 'T12:00:00');
		const day = (d.getDay() + 6) % 7;
		d.setDate(d.getDate() - day + 3); // jeudi de la semaine ISO
		const firstThursday = new Date(d.getFullYear(), 0, 4);
		const fday = (firstThursday.getDay() + 6) % 7;
		firstThursday.setDate(firstThursday.getDate() - fday + 3);
		return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000));
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
		// Manquants calculés côté serveur POUR CHAQUE semaine : on complète la
		// liste (déjà présente dans all pour la semaine de référence).
		const knownMissing = new Set(missing.map((r) => r.userId));
		const missingWeekData = (board.missingByWeek ?? []).find((w) => w.weekStart === selectedWeek);
		for (const c of missingWeekData?.clients ?? []) {
			if (!knownMissing.has(c.userId)) {
				missing.push({ userId: c.userId, prenom: c.prenom, nom: c.nom, profilePhotoUrl: c.profilePhotoUrl, weekStart: selectedWeek, weekLabel: missingWeekData?.weekLabel ?? '', checkin: null });
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
	/** Date + heure de dépôt (liste globale). */
	function fmtDepot(c: NonNullable<Row['checkin']>): string {
		return new Date(c._creationTime).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
	}
	const open360 = (r: Row) =>
		`/admin?client=${encodeURIComponent(r.userId)}&section=bilans&week=${encodeURIComponent(r.weekStart)}`;
	const totals = $derived({
		deposes: weekRows.toTreat.length + weekRows.feedbackSent.length + weekRows.done.length,
		aTraiter: weekRows.toTreat.length,
		lu: weekRows.done.length,
		manquants: weekRows.missing.length,
	});
	const kpis = $derived([
		{ icon: 'clipboardCheck', label: 'bilans cette semaine', value: totals.deposes, accent: 'var(--brand)', tileBg: 'rgba(29, 185, 84, 0.15)', tileFg: 'var(--brand-deep)' },
		{ icon: 'clipboardPen', label: 'à traiter', value: totals.aTraiter, accent: '#f59e0b', tileBg: 'rgba(245, 158, 11, 0.14)', tileFg: '#b45309' },
		{ icon: 'circleCheck', label: 'retours lus', value: totals.lu, accent: '#0ea5e9', tileBg: 'rgba(14, 165, 233, 0.12)', tileFg: '#0369a1' },
		{ icon: 'hourglass', label: 'bilans manquants', value: totals.manquants, accent: '#ef4444', tileBg: 'rgba(239, 68, 68, 0.12)', tileFg: '#b91c1c' },
	]);

	/* ── Liste globale des bilans (toutes semaines) : recherche + filtre statut ──
	   UI pure : filtre les lignes DÉJÀ renvoyées par bilansBoard — aucun appel
	   ajouté, aucune donnée inventée. */
	type StatusKey = 'all' | 'aTraiter' | 'nonLu' | 'lu' | 'manquant';
	let search = $state('');
	let statusFilter = $state<StatusKey>('all');

	const isUnreadRow = (c: NonNullable<Row['checkin']>) =>
		c.status === 'retour_envoye' && (c.feedbackReadAt == null || c.feedbackReadAt < (c.feedbackAt ?? c._creationTime));
	const statusOf = (r: Row): Exclude<StatusKey, 'all'> => {
		if (!r.checkin) return 'manquant';
		if (r.checkin.status === 'nouveau') return 'aTraiter';
		if (isUnreadRow(r.checkin)) return 'nonLu';
		return 'lu';
	};
	const STATUS_BADGE: Record<Exclude<StatusKey, 'all'>, { label: string; cls: string }> = {
		aTraiter: { label: 'À traiter', cls: 'bg-warn-light text-warn' },
		nonLu: { label: 'Retour envoyé · non lu', cls: 'bg-brand-light text-brand-dark' },
		lu: { label: 'Retour lu', cls: 'bg-line text-mist' },
		manquant: { label: 'Manquant', cls: 'bg-danger-light text-danger' },
	};
	/** Évolution déclarée par la cliente dans SON bilan (jamais calculée ici). */
	const evolutionOf = (r: Row): { sym: string; label: string } | null => {
		const e = r.checkin?.answers?.evolution;
		if (e === 'baisse') return { sym: '↓', label: 'Baisse' };
		if (e === 'hausse') return { sym: '↑', label: 'Hausse' };
		if (e === 'stable') return { sym: '→', label: 'Stable' };
		return null;
	};
	const allRows = $derived(
		[...(board.all ?? [])].sort((a, b) => b.weekStart.localeCompare(a.weekStart) || fullName(a).localeCompare(fullName(b), 'fr'))
	);
	const filteredAll = $derived(
		allRows.filter((r) => {
			if (statusFilter !== 'all' && statusOf(r) !== statusFilter) return false;
			const q = search.trim().toLowerCase();
			if (!q) return true;
			return fullName(r).toLowerCase().includes(q);
		})
	);
	const STATUS_FILTERS: { key: StatusKey; label: string }[] = [
		{ key: 'all', label: 'Tous' },
		{ key: 'aTraiter', label: 'À traiter' },
		{ key: 'nonLu', label: 'Non lus' },
		{ key: 'lu', label: 'Lus' },
		{ key: 'manquant', label: 'Manquants' },
	];

	/* ── Navigation semaine (précédent / suivant dans les semaines couvertes) ── */
	const weekIdx = $derived(weeks.indexOf(selectedWeek ?? ''));
	const olderWeek = $derived(weekIdx >= 0 && weekIdx + 1 < weeks.length ? weeks[weekIdx + 1] : null);
	const newerWeek = $derived(weekIdx > 0 ? weeks[weekIdx - 1] : null);

	/* ── Bilans manquants DE LA SEMAINE SÉLECTIONNÉE ───────────────────
	   Chaque onglet de semaine a son propre état : le compteur et la liste
	   ne comptent que les bilans absents de CETTE semaine (calculés côté
	   serveur, bilansBoard.missingByWeek). Un intervalle de 30 s revalide
	   la page — la liste suit les soumissions en direct, sans recharger
	   manuellement. ── */
	let missingTimer: ReturnType<typeof setInterval> | null = null;

	onMount(() => {
		missingTimer = setInterval(() => void invalidateAll(), 30000);
		return () => {
			if (missingTimer) clearInterval(missingTimer);
		};
	});
</script>

<svelte:head><title>Bilans — G-Flux (CRM)</title></svelte:head>

<!-- ═══ En-tête premium ═══ -->
<div class="m-in-crm flex flex-wrap items-end justify-between gap-3" style="--m-i: 0">
	<div class="min-w-0">
		<h1 class="flex items-center gap-2.5 font-display text-2xl font-black tracking-tight text-ink">
			<span class="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand-light text-brand-deep"><Icon name="clipboardList" size={20} /></span>
			Bilans
		</h1>
		<p class="mt-1.5 text-sm text-mist">Tous les bilans des clientes, semaine par semaine — un clic ouvre la Vision 360.</p>
	</div>
	<a
		href="/admin"
		class="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3.5 py-2 text-[12.5px] font-bold text-ink shadow-sm transition hover:border-brand hover:text-brand"
	><Icon name="arrowLeft" size={14} class="shrink-0 text-brand" /> Client·e·s & tableau de bord</a>
</div>

<!-- ═══ KPI de la semaine sélectionnée ═══ -->
{#if selectedWeek}
	<div class="m-in-crm mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4" style="--m-i: 1">
		{#each kpis as k (k.label)}
			<div class="kpi-crm" style={`--kpi-accent: ${k.accent}; --kpi-tile-bg: ${k.tileBg}; --kpi-tile-fg: ${k.tileFg}`}>
				<div class="flex items-center gap-3">
					<span class="kpi-tile shrink-0"><Icon name={k.icon} size={18} /></span>
					<div class="min-w-0">
						<div class="font-display text-[1.55rem] font-black leading-none tracking-tight text-ink">{k.value}</div>
						<div class="mt-1 truncate text-[11.5px] font-semibold text-mist">{k.label}</div>
					</div>
				</div>
			</div>
		{/each}
	</div>
{/if}

<!-- ═══ Navigation par semaine ═══ -->
{#if weeks.length > 0}
	<div class="m-in-crm mt-4 flex items-center gap-2" style="--m-i: 2">
		{#if olderWeek}
			<a
				href={`/admin/bilans?week=${olderWeek}`}
				class="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-white text-ink shadow-sm transition hover:border-brand hover:text-brand"
				aria-label="Semaine précédente"
			><Icon name="chevronLeft" size={15} /></a>
		{:else}
			<span class="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line/60 bg-white text-mist/50"><Icon name="chevronLeft" size={15} /></span>
		{/if}
		<div class="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-1">
			{#each weeks as w (w)}
				<a
					href={`/admin/bilans?week=${w}`}
					class="flex shrink-0 flex-col items-center rounded-2xl border px-3.5 py-1.5 text-center transition {w === selectedWeek
						? 'border-brand bg-brand text-white shadow-sm'
						: 'border-line bg-white text-ink hover:border-brand hover:text-brand'}"
					aria-current={w === selectedWeek ? 'page' : undefined}
				>
					<span class="font-display text-[13.5px] font-black leading-tight">S{isoWeekNumber(w)}</span>
					<span class="text-[9.5px] font-semibold {w === selectedWeek ? 'text-white/80' : 'text-mist'}">{weekShort(w)}</span>
				</a>
			{/each}
		</div>
		{#if newerWeek}
			<a
				href={`/admin/bilans?week=${newerWeek}`}
				class="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-white text-ink shadow-sm transition hover:border-brand hover:text-brand"
				aria-label="Semaine suivante"
			><Icon name="chevronRight" size={15} /></a>
		{:else}
			<span class="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line/60 bg-white text-mist/50"><Icon name="chevronRight" size={15} /></span>
		{/if}
	</div>
{/if}

{#if selectedWeek}
	<!-- ═══ Blocs de la semaine : À traiter + Manquants (côte à côte) ═══ -->
	<div class="m-in-crm mt-4 grid gap-4 lg:grid-cols-2" style="--m-i: 3">
		<!-- À traiter cette semaine -->
		<section class="card-crm p-4">
			<div class="mb-2.5 flex items-center justify-between gap-2">
				<h2 class="flex items-center gap-2 font-display text-[15px] font-bold text-ink">
					<span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-warn-light text-warn"><Icon name="clipboardPen" size={14} /></span>
					À traiter cette semaine
				</h2>
				<span class="badge-in grid h-5 min-w-5 place-items-center rounded-full bg-warn px-1.5 text-[11px] font-bold text-white">{weekRows.toTreat.length}</span>
			</div>
			{#if weekRows.toTreat.length === 0}
				<p class="rounded-xl border border-dashed border-line px-3 py-6 text-center text-[12.5px] text-mist">Aucun bilan en attente de retour ✓</p>
			{:else}
				<div class="space-y-1.5">
					{#each weekRows.toTreat as r (r.userId)}
						<a href={open360(r)} class="crow-crm flex items-center gap-2.5 rounded-xl border border-line bg-white px-3 py-2.5">
							<ClientAvatar name={fullName(r)} url={r.profilePhotoUrl} class="h-9 w-9 text-sm" />
							<div class="min-w-0 flex-1">
								<div class="truncate text-[13.5px] font-bold text-ink">{fullName(r)}</div>
								<div class="truncate text-[11px] text-mist">Bilan reçu{r.checkin ? ` le ${fmtSentAt(r.checkin)}` : ''} · retour à écrire</div>
							</div>
							<span class="badge-in shrink-0 rounded-full bg-warn-light px-2 py-0.5 text-[10.5px] font-bold text-warn">Nouveau</span>
							<span class="shrink-0 text-[11.5px] font-bold text-brand-dark">Vision 360 <Icon name="arrowRight" size={11} class="inline" /></span>
						</a>
					{/each}
				</div>
			{/if}
		</section>

		<!-- Bilans manquants cette semaine -->
		<section class="card-crm p-4">
			<div class="mb-2.5 flex items-center justify-between gap-2">
				<h2 class="flex items-center gap-2 font-display text-[15px] font-bold text-ink">
					<span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-danger-light text-danger"><Icon name="hourglass" size={14} /></span>
					Bilans manquants
				</h2>
				{#if weekRows.missing.length > 0}
					<span class="badge-in grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1.5 text-[11px] font-bold text-white">{weekRows.missing.length}</span>
				{/if}
			</div>
			{#if weekRows.missing.length === 0}
				<p class="rounded-xl border border-dashed border-line px-3 py-6 text-center text-[12.5px] text-mist">Tout le monde a envoyé son bilan pour cette semaine ✓</p>
			{:else}
				<div class="space-y-1.5">
					{#each weekRows.missing as r (r.userId)}
						<a href={open360(r)} class="crow-crm flex items-center gap-2.5 rounded-xl border border-line bg-white px-3 py-2.5">
							<ClientAvatar name={fullName(r)} url={r.profilePhotoUrl} class="h-9 w-9 text-sm" />
							<div class="min-w-0 flex-1">
								<div class="truncate text-[13.5px] font-bold text-ink">{fullName(r)}</div>
								<div class="truncate text-[11px] text-mist">Bilan attendu — pas encore envoyé</div>
							</div>
							<span class="shrink-0 text-[11.5px] font-bold text-brand-dark">Vision 360 <Icon name="arrowRight" size={11} class="inline" /></span>
						</a>
					{/each}
				</div>
			{/if}
			<p class="mt-2 text-[10.5px] italic text-mist"><Icon name="refreshCw" size={10} class="inline" /> actualisé toutes les 30 s</p>
		</section>
	</div>

	<!-- ═══ Retours envoyés · non lus + Retours lus ═══ -->
	{#if weekRows.feedbackSent.length + weekRows.done.length > 0}
		<div class="m-in-crm mt-4 grid gap-4 lg:grid-cols-2" style="--m-i: 4">
			{#if weekRows.feedbackSent.length > 0}
				<section class="card-crm p-4">
					<div class="mb-2.5 flex items-center justify-between gap-2">
						<h2 class="flex items-center gap-2 font-display text-[15px] font-bold text-ink">
							<span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-light text-brand-deep"><Icon name="bellRing" size={14} /></span>
							Retour envoyé · non lu
						</h2>
						<span class="badge-in grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-white">{weekRows.feedbackSent.length}</span>
					</div>
					<div class="space-y-1.5">
						{#each weekRows.feedbackSent as r (r.userId)}
							<a href={open360(r)} class="crow-crm flex items-center gap-2.5 rounded-xl border border-line bg-white px-3 py-2.5">
								<ClientAvatar name={fullName(r)} url={r.profilePhotoUrl} class="h-9 w-9 text-sm" />
								<div class="min-w-0 flex-1">
									<div class="truncate text-[13.5px] font-bold text-ink">{fullName(r)}</div>
									<div class="truncate text-[11px] text-mist"><span class="font-bold text-warn">Non lu</span> · retour envoyé{r.checkin?.feedbackAt ? ` le ${fmtReadAt(r.checkin.feedbackAt)}` : ''}</div>
								</div>
								<span class="shrink-0 text-[11.5px] font-bold text-brand-dark">Vision 360 <Icon name="arrowRight" size={11} class="inline" /></span>
							</a>
						{/each}
					</div>
				</section>
			{/if}
			{#if weekRows.done.length > 0}
				<section class="card-crm p-4">
					<div class="mb-2.5 flex items-center justify-between gap-2">
						<h2 class="flex items-center gap-2 font-display text-[15px] font-bold text-ink">
							<span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-soft text-ink"><Icon name="circleCheck" size={14} /></span>
							Retours lus
						</h2>
						<span class="badge-in grid h-5 min-w-5 place-items-center rounded-full bg-line px-1.5 text-[11px] font-bold text-mist">{weekRows.done.length}</span>
					</div>
					<div class="space-y-1.5">
						{#each weekRows.done as r (r.userId)}
							<a href={open360(r)} class="crow-crm flex items-center gap-2.5 rounded-xl border border-line bg-white px-3 py-2.5 opacity-90">
								<ClientAvatar name={fullName(r)} url={r.profilePhotoUrl} class="h-9 w-9 text-sm" />
								<div class="min-w-0 flex-1">
									<div class="truncate text-[13.5px] font-bold text-ink">{fullName(r)}</div>
									<div class="truncate text-[11px] text-mist">✓ Lu{r.checkin?.feedbackReadAt ? ` le ${fmtReadAt(r.checkin.feedbackReadAt)}` : ''}</div>
								</div>
								<span class="shrink-0 text-[11.5px] font-bold text-mist">Vision 360 <Icon name="arrowRight" size={11} class="inline" /></span>
							</a>
						{/each}
					</div>
				</section>
			{/if}
		</div>
	{/if}

	<!-- ═══ Liste globale des bilans (toutes semaines) ═══ -->
	<section class="card-crm m-in-crm mt-4 overflow-hidden" style="--m-i: 5">
		<div class="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
			<h2 class="flex items-center gap-2 font-display text-[15px] font-bold text-ink">
				<span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-light text-brand-deep"><Icon name="clipboardList" size={14} /></span>
				Liste des bilans
				<span class="badge-in grid h-5 min-w-5 place-items-center rounded-full bg-brand-light px-1.5 text-[11px] font-bold text-brand-deep">{filteredAll.length}</span>
			</h2>
			<div class="flex flex-wrap items-center gap-2">
				<label class="relative">
					<span class="sr-only">Rechercher une cliente</span>
					<Icon name="search" size={14} class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mist" />
					<input
						type="search"
						bind:value={search}
						placeholder="Rechercher une cliente…"
						class="w-44 rounded-full border border-line bg-white py-1.5 pl-8 pr-3 text-[13px] outline-none transition placeholder:text-mist focus:border-brand md:w-52"
					/>
				</label>
				<div class="flex flex-wrap items-center rounded-full border border-line bg-white p-0.5" role="group" aria-label="Filtrer par statut">
					{#each STATUS_FILTERS as f (f.key)}
						<button type="button" class="chip-crm {statusFilter === f.key ? 'active-crm' : ''}" onclick={() => (statusFilter = f.key)} aria-pressed={statusFilter === f.key}>{f.label}</button>
					{/each}
				</div>
			</div>
		</div>
		{#if filteredAll.length === 0}
			<p class="px-6 py-12 text-center text-sm text-mist">Aucun bilan{search.trim() || statusFilter !== 'all' ? ' pour ces critères' : ' pour l’instant'}.</p>
		{:else}
			<div class="table-wrap overflow-x-auto">
				<table class="tbl-crm w-full min-w-[760px] text-left">
					<thead>
						<tr>
							<th class="px-5 py-2.5">Cliente</th>
							<th class="px-3 py-2.5">Date dépôt</th>
							<th class="px-3 py-2.5">Semaine</th>
							<th class="px-3 py-2.5">Évolution</th>
							<th class="px-3 py-2.5">Statut</th>
							<th class="px-5 py-2.5 text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each filteredAll as r (r.userId + '-' + r.weekStart)}
							{@const st = statusOf(r)}
							{@const evo = evolutionOf(r)}
							<tr class="crow-crm border-b border-line/50 last:border-0">
								<td class="px-5 py-2.5">
									<a href={open360(r)} class="flex items-center gap-2.5">
										<ClientAvatar name={fullName(r)} url={r.profilePhotoUrl} class="h-9 w-9 text-sm" />
										<div class="min-w-0">
											<div class="truncate text-[13.5px] font-bold text-ink">{fullName(r)}</div>
										</div>
									</a>
								</td>
								<td class="whitespace-nowrap px-3 py-2.5 text-[13px] text-mist">{r.checkin ? fmtDepot(r.checkin) : '—'}</td>
								<td class="whitespace-nowrap px-3 py-2.5 text-[13px] font-semibold text-ink">{r.weekLabel.replace(/^S\d+\s*-\s*/, '')}</td>
								<td class="px-3 py-2.5">
									{#if evo}
										<span class="inline-flex items-center gap-1 rounded-full bg-soft px-2 py-0.5 text-[11px] font-bold text-ink" title="Évolution déclarée par la cliente dans son bilan">{evo.sym} {evo.label}</span>
									{:else}
										<span class="text-[13px] text-mist">—</span>
									{/if}
								</td>
								<td class="px-3 py-2.5">
									<span class="rounded-full px-2.5 py-1 text-[11.5px] font-bold {STATUS_BADGE[st].cls}">{STATUS_BADGE[st].label}</span>
								</td>
								<td class="px-5 py-2.5 text-right">
									<a
										href={open360(r)}
										class="btn-crm inline-flex items-center gap-1 rounded-full border border-line bg-white px-3 py-1.5 text-[12px] font-bold text-ink transition hover:border-brand hover:text-brand"
									>Vision 360 <Icon name="arrowRight" size={12} /></a>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
{:else}
	<div class="mt-6 rounded-2xl border border-dashed border-line bg-card px-6 py-16 text-center">
		<p class="grid place-items-center"><Icon name="clipboardList" size={34} class="text-mist" /></p>
		<p class="mt-3 text-sm text-mist">Aucun bilan pour l'instant — les semaines apparaîtront ici dès la première soumission.</p>
	</div>
{/if}
