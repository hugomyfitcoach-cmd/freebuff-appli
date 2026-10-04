<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import { fmtNotifDate, notifLabel, notifLink, type CoachNotifKind } from '$lib/notifications';

	/**
	 * Ligne du journal : `prenom` porte déjà « Prénom Nom » (la requête
	 * notifications.list fusionne le nom — la page ne fait que l'afficher
	 * EN PREMIER, puis le type d'événement + le détail).
	 */
	type Row = {
		_id: string;
		userId: string;
		prenom: string;
		kind: CoachNotifKind;
		description: string;
		read: boolean;
		createdAt: number;
	};

	let { data } = $props();

	/* ── Données réelles (chargées par le serveur) ── */
	const rows = $derived<Row[]>(data.rows ?? []);

	/**
	 * Exemples de démonstration (Preview) : affichés UNIQUEMENT quand le
	 * journal est vide, pour visualiser le rendu premium sans données.
	 * Non interactifs (pas de fiche cliente derrière, aucun marquage).
	 */
	const DEMO_ROWS: Row[] = [
		{ _id: 'demo-1', userId: 'demo', prenom: 'Pauline Debre', kind: 'bilan_envoye', description: 'Pauline a complété son bilan hebdomadaire.', read: false, createdAt: Date.now() - 12 * 60_000 },
		{ _id: 'demo-2', userId: 'demo', prenom: 'Cristina Sobas', kind: 'nouveau_poids', description: 'Cristina a ajouté un nouveau poids : 62,3 kg (−0,8 kg).', read: false, createdAt: Date.now() - 3_600_000 },
		{ _id: 'demo-3', userId: 'demo', prenom: 'Floriane Baud', kind: 'nouvelles_mesures', description: 'Floriane a ajouté ses mensurations du mois.', read: false, createdAt: Date.now() - 2 * 3_600_000 },
		{ _id: 'demo-4', userId: 'demo', prenom: 'Marine Labarre', kind: 'rdv_pris', description: 'Marine souhaite planifier un appel de suivi.', read: false, createdAt: Date.now() - 3 * 3_600_000 },
		{ _id: 'demo-5', userId: 'demo', prenom: 'Estelle Delamare', kind: 'bilan_envoye', description: 'Estelle a complété son bilan hebdomadaire.', read: false, createdAt: Date.now() - 5 * 3_600_000 },
		{ _id: 'demo-6', userId: 'demo', prenom: 'Léa Fontaine', kind: 'nouveau_poids', description: 'Léa a ajouté un nouveau poids : 68,1 kg (+0,4 kg).', read: false, createdAt: Date.now() - 8 * 3_600_000 },
		{ _id: 'demo-7', userId: 'demo', prenom: 'Julie Marion', kind: 'nouvelles_mesures', description: 'Julie a ajouté ses mensurations.', read: true, createdAt: Date.now() - 26 * 3_600_000 },
		{ _id: 'demo-8', userId: 'demo', prenom: 'Alice Berthier', kind: 'bilan_envoye', description: 'Alice a complété son bilan mensuel.', read: true, createdAt: Date.now() - 30 * 3_600_000 },
		{ _id: 'demo-9', userId: 'demo', prenom: 'Sophie Bernard', kind: 'rdv_pris', description: 'Sophie a confirmé son rendez-vous du 25 sept. à 14h.', read: true, createdAt: Date.now() - 2 * 86_400_000 },
		{ _id: 'demo-10', userId: 'demo', prenom: 'Manon Girard', kind: 'nouveau_poids', description: 'Manon a ajouté un nouveau poids : 59,4 kg.', read: true, createdAt: Date.now() - 3 * 86_400_000 },
		{ _id: 'demo-11', userId: 'demo', prenom: 'Clara Vasseur', kind: 'nouvelles_photos', description: 'Clara a déposé de nouvelles photos de suivi.', read: true, createdAt: Date.now() - 4 * 86_400_000 },
	];
	const isDemo = $derived(rows.length === 0);
	const displayRows = $derived(isDemo ? DEMO_ROWS : rows);

	/* ── Filtres par type (UI pure, aucun appel ajouté) ── */
	type FilterKey = 'all' | 'bilans' | 'poids' | 'mesures' | 'rdv';
	let filter = $state<FilterKey>('all');

	function matchFilter(kind: CoachNotifKind, f: FilterKey): boolean {
		if (f === 'all') return true;
		if (f === 'bilans') return kind === 'bilan_envoye';
		if (f === 'poids') return kind === 'nouveau_poids';
		if (f === 'mesures') return kind === 'nouvelles_mesures';
		return kind === 'rdv_pris' || kind === 'rdv_annule' || kind === 'rdv_replanifie'; // rdv
	}

	const toConsult = $derived(displayRows.filter((r) => !r.read));
	const viewed = $derived(displayRows.filter((r) => r.read));
	const filteredToConsult = $derived(toConsult.filter((r) => matchFilter(r.kind, filter)));
	const filteredViewed = $derived(viewed.filter((r) => matchFilter(r.kind, filter)));

	const FILTERS: { key: FilterKey; label: string }[] = [
		{ key: 'all', label: 'Toutes' },
		{ key: 'bilans', label: 'Bilans' },
		{ key: 'poids', label: 'Poids' },
		{ key: 'mesures', label: 'Mensurations' },
		{ key: 'rdv', label: 'Rendez-vous' },
	];
	const filterCount = (f: FilterKey): number => displayRows.filter((r) => matchFilter(r.kind, f)).length;

	/* ── Langage visuel par type (pastilles colorées, esprit mockup) ──
	   UI locale uniquement : liens/libellés restent dans lib/notifications.ts. */
	const UI_STYLE: Record<CoachNotifKind, { icon: string; tile: string }> = {
		bilan_envoye: { icon: 'clipboardCheck', tile: 'bg-brand-light text-brand-deep' },
		nouveau_poids: { icon: 'trendingUp', tile: 'bg-warn-light text-warn' },
		nouvelles_mesures: { icon: 'ruler', tile: 'bg-[#f3e8ff] text-[#7c3aed]' },
		nouvelles_photos: { icon: 'camera', tile: 'bg-[#fdeff6] text-[#db2777]' },
		plan_assigned: { icon: 'utensils', tile: 'bg-warn-light text-warn' },
		rdv_pris: { icon: 'calendarCheck', tile: 'bg-[#e8f0fe] text-[#1a73e8]' },
		rdv_replanifie: { icon: 'calendarClock', tile: 'bg-[#e8f0fe] text-[#1a73e8]' },
		rdv_annule: { icon: 'calendarX', tile: 'bg-danger-light text-danger' },
		onboarding_termine: { icon: 'rocket', tile: 'bg-brand-light text-brand-deep' },
		inactivite: { icon: 'bellOff', tile: 'bg-warn-light text-warn' },
	};
	const uiStyle = (kind: CoachNotifKind) => UI_STYLE[kind] ?? { icon: 'bell', tile: 'bg-soft text-ink' };
	const initial = (n: string): string => n.trim().charAt(0).toUpperCase() || '?';

	let busy = $state(false);
	let error = $state('');

	/**
	 * Marquages optimistes (ids) : la ligne et le badge passent « vue »
	 * immédiatement, sans attendre l'aller-retour serveur + invalidateAll.
	 */
	let checked = $state(new Set<string>());
	const unread = $derived<number>((data.unread ?? 0) - [...checked].filter((id) => rows.some((r) => r._id === id && !r.read)).length);

	/** Un clic ouvre la fiche cliente sur la section concernée ET marque la notification « vue ». */
	async function open(row: Row) {
		if (row.read || busy) return;
		checked = new Set(checked).add(row._id);
		busy = true;
		try {
			const res = await fetch('/api/coach/notifications', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ notificationId: row._id }),
			});
			if (!res.ok) throw new Error('Erreur');
			await invalidateAll();
		} catch {
			// Échec silencieux : la notification reste « à consulter » au retour.
		} finally {
			busy = false;
		}
	}

	/** Coche individuelle : « à consulter » → « vue » (optimiste + badge live). */
	async function markRead(row: Row) {
		if (row.read || checked.has(row._id)) return;
		checked = new Set(checked).add(row._id);
		try {
			const res = await fetch('/api/coach/notifications', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ notificationId: row._id }),
			});
			if (!res.ok) throw new Error('Erreur');
			await invalidateAll();
		} catch {
			// Échec silencieux : la notification reste « à consulter » (coche retirée).
		} finally {
			const next = new Set(checked);
			next.delete(row._id);
			checked = next;
		}
	}

	/** « Tout marquer comme vu » — un seul appel, le badge retombe à zéro. */
	async function markAllRead() {
		if (busy || isDemo || toConsult.length === 0) return;
		checked = new Set(toConsult.map((r) => r._id));
		busy = true;
		error = '';
		try {
			const res = await fetch('/api/coach/notifications', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ all: true }),
			});
			const j = await res.json();
			if (!res.ok) throw new Error(j.error ?? 'Erreur');
			await invalidateAll();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Erreur';
		} finally {
			busy = false;
			checked = new Set<string>();
		}
	}
</script>

<svelte:head><title>Notifications — G-Flux (CRM)</title></svelte:head>

<!-- ═══ En-tête premium + « Tout marquer comme vu » ═══ -->
<div class="m-in-crm flex flex-wrap items-start justify-between gap-3" style="--m-i: 0">
	<div class="min-w-0">
		<h1 class="flex items-center gap-2.5 font-display text-2xl font-black tracking-tight text-ink">
			<span class="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand-light text-brand-deep"><Icon name="bell" size={20} /></span>
			Notifications
		</h1>
		<p class="mt-1.5 text-sm text-mist">Reste informé des dernières actions de tes clientes.</p>
	</div>
	{#if !isDemo && toConsult.length > 0}
		<button
			type="button"
			onclick={markAllRead}
			disabled={busy}
			class="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3.5 py-2 text-[12.5px] font-bold text-ink shadow-sm transition hover:border-brand hover:text-brand disabled:opacity-50"
		>
			<Icon name="check" size={14} class="shrink-0 text-brand" /> Tout marquer comme vu
		</button>
	{/if}
</div>

{#if isDemo}
	<p class="m-in-crm mt-3 inline-flex items-center gap-1.5 rounded-full bg-soft px-3 py-1 text-[11px] font-bold text-mist" style="--m-i: 0">
		<Icon name="info" size={12} class="shrink-0" /> Exemples de démonstration — le journal affichera ici l'activité réelle de tes clientes.
	</p>
{/if}

{#if error}
	<p class="mt-4 rounded-xl border border-danger/40 bg-danger-light px-4 py-3 text-sm text-danger">{error}</p>
{/if}

<!-- ═══ Filtres par type (chips + compteurs) ═══ -->
<div class="m-in-crm mt-4 flex flex-wrap items-center gap-1.5" style="--m-i: 1" role="group" aria-label="Filtrer les notifications">
	{#each FILTERS as f (f.key)}
		{@const n = filterCount(f.key)}
		<button type="button" class="chip-crm {filter === f.key ? 'active-crm' : ''}" onclick={() => (filter = f.key)} aria-pressed={filter === f.key}>
			{f.label}{#if n > 0}&nbsp;<span class="ml-0.5 inline-block rounded-full px-1.5 py-px text-[10px] font-bold {filter === f.key ? 'bg-white/70 text-brand-deep' : 'bg-line/70 text-ink/70'}">{n}</span>{/if}
		</button>
	{/each}
</div>

<!-- ═══ À consulter ═══ -->
<section class="card-crm m-in-crm mt-4 overflow-hidden" style="--m-i: 2">
	<div class="flex items-center justify-between gap-2 border-b border-line px-5 py-3.5">
		<h2 class="flex items-center gap-2 font-display text-[15px] font-bold text-ink">
			<span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-warn-light text-warn"><Icon name="bell" size={13} /></span>
			À consulter
		</h2>
		{#if !isDemo && unread > 0}
			<span class="grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1.5 text-[11px] font-bold text-white">{unread}</span>
		{:else if filteredToConsult.length > 0}
			<span class="grid h-5 min-w-5 place-items-center rounded-full bg-warn px-1.5 text-[11px] font-bold text-white">{filteredToConsult.length}</span>
		{/if}
	</div>
	{#if filteredToConsult.length === 0}
		<p class="px-5 py-8 text-center text-sm text-mist">Rien à consulter ✓</p>
	{:else}
		<ul class="divide-y divide-line/70">
			{#each filteredToConsult as row (row._id)}
				{@const st = uiStyle(row.kind)}
				{@const done = checked.has(row._id)}
				<li class="crow-crm flex items-center gap-3 px-4 py-3 {done ? 'opacity-60' : ''}">
					{#if isDemo}
						<span class="flex min-w-0 flex-1 items-center gap-3">
							<span class="relative shrink-0">
								<span class="grid h-10 w-10 place-items-center rounded-full bg-brand text-[13px] font-black text-white">{initial(row.prenom)}</span>
								<span class="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-brand ring-2 ring-white" aria-hidden="true"></span>
							</span>
							<span class="min-w-0 flex-1">
								<span class="block truncate font-display text-[14px] font-black tracking-tight text-ink">{row.prenom}</span>
								<span class="mt-0.5 flex min-w-0 items-center gap-1.5">
									<span class="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold {st.tile}">
										<Icon name={st.icon} size={10} /> {notifLabel(row.kind)}
									</span>
									<span class="truncate text-xs text-mist">{row.description}</span>
								</span>
							</span>
							<span class="flex shrink-0 items-center gap-2 text-right">
								<span class="text-[11px] leading-tight text-mist">{fmtNotifDate(row.createdAt)}</span>
								<span class="h-2 w-2 rounded-full bg-brand" aria-hidden="true"></span>
							</span>
						</span>
					{:else}
						<a
							href={notifLink(row.userId, row.kind)}
							onclick={() => open(row)}
							class="flex min-w-0 flex-1 items-center gap-3"
						>
							<span class="relative shrink-0">
								<span class="grid h-10 w-10 place-items-center rounded-full bg-brand text-[13px] font-black text-white">{initial(row.prenom)}</span>
								<span class="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-brand ring-2 ring-white" aria-hidden="true"></span>
							</span>
							<span class="min-w-0 flex-1">
								<span class="block truncate font-display text-[14px] font-black tracking-tight text-ink">{row.prenom}</span>
								<span class="mt-0.5 flex min-w-0 items-center gap-1.5">
									<span class="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold {st.tile}">
										<Icon name={st.icon} size={10} /> {notifLabel(row.kind)}
									</span>
									<span class="truncate text-xs text-mist">{row.description}</span>
								</span>
							</span>
							<span class="flex shrink-0 items-center gap-2 text-right">
								<span class="text-[11px] leading-tight text-mist">{fmtNotifDate(row.createdAt)}</span>
								<span class="h-2 w-2 rounded-full bg-brand" aria-hidden="true"></span>
							</span>
						</a>
						<button
							type="button"
							aria-label="Marquer comme vu"
							title="Marquer comme vu"
							disabled={done}
							onclick={() => void markRead(row)}
							class="grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-warn/60 text-warn transition hover:border-warn hover:bg-warn hover:text-white disabled:cursor-default disabled:border-brand disabled:bg-brand disabled:text-white"
						>
							<Icon name="check" size={13} />
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<!-- ═══ Vu ═══ -->
{#if filteredViewed.length > 0}
	<section class="card-crm m-in-crm mt-4 overflow-hidden" style="--m-i: 3">
		<div class="flex items-center justify-between gap-2 border-b border-line px-5 py-3.5">
			<h2 class="flex items-center gap-2 font-display text-[15px] font-bold text-ink">
				<span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-soft text-ink"><Icon name="circleCheck" size={13} /></span>
				Vu
			</h2>
			<span class="grid h-5 min-w-5 place-items-center rounded-full bg-line px-1.5 text-[11px] font-bold text-mist">{filteredViewed.length}</span>
		</div>
		<ul class="divide-y divide-line/70">
			{#each filteredViewed as row (row._id)}
				{@const st = uiStyle(row.kind)}
				<li class="crow-crm flex items-center gap-3 px-4 py-3 opacity-80">
					{#if isDemo}
						<span class="flex min-w-0 flex-1 items-center gap-3">
							<span class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-line text-[13px] font-black text-mist">{initial(row.prenom)}</span>
							<span class="min-w-0 flex-1">
								<span class="block truncate font-display text-[14px] font-bold tracking-tight text-ink/60">{row.prenom}</span>
								<span class="mt-0.5 flex min-w-0 items-center gap-1.5">
									<span class="inline-flex shrink-0 items-center gap-1 rounded-full bg-line/50 px-2 py-0.5 text-[10.5px] font-bold text-mist">
										<Icon name={st.icon} size={10} /> {notifLabel(row.kind)}
									</span>
									<span class="truncate text-xs text-mist/80">{row.description}</span>
								</span>
							</span>
							<span class="flex shrink-0 items-center gap-2 text-right">
								<span class="text-[11px] leading-tight text-mist">{fmtNotifDate(row.createdAt)}</span>
								<span class="h-2 w-2 rounded-full bg-line" aria-hidden="true"></span>
							</span>
						</span>
					{:else}
						<a href={notifLink(row.userId, row.kind)} class="flex min-w-0 flex-1 items-center gap-3">
							<span class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-line text-[13px] font-black text-mist">{initial(row.prenom)}</span>
							<span class="min-w-0 flex-1">
								<span class="block truncate font-display text-[14px] font-bold tracking-tight text-ink/60">{row.prenom}</span>
								<span class="mt-0.5 flex min-w-0 items-center gap-1.5">
									<span class="inline-flex shrink-0 items-center gap-1 rounded-full bg-line/50 px-2 py-0.5 text-[10.5px] font-bold text-mist">
										<Icon name={st.icon} size={10} /> {notifLabel(row.kind)}
									</span>
									<span class="truncate text-xs text-mist/80">{row.description}</span>
								</span>
							</span>
							<span class="flex shrink-0 items-center gap-2 text-right">
								<span class="text-[11px] leading-tight text-mist">{fmtNotifDate(row.createdAt)}</span>
								<span class="h-2 w-2 rounded-full bg-line" aria-hidden="true"></span>
							</span>
						</a>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}
