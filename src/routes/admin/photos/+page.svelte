<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import CoachIdentity from '$lib/components/CoachIdentity.svelte';
	import { coachIdentity, type CoachUserLike } from '$lib/coachIdentity';
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
		/** Uniquement sur les lignes de démonstration (Preview). */
		email?: string;
	};

	let { data } = $props();
	// Tri serveur : du plus récent au plus ancien — la première ligne est le
	// dernier dépôt, les anciens dépôts restent accessibles en dessous.
	const deposits = $derived<Deposit[]>(data.deposits ?? []);

	/**
	 * Exemples de démonstration (Preview) : affichés UNIQUEMENT tant qu'aucun
	 * dépôt réel n'existe, pour visualiser le rendu final du module (lignes
	 * riches + miniatures). La recherche et les filtres restent utilisables
	 * dessus ; seul le CTA d'ouverture est désactivé (pas de fiche derrière).
	 */
	const hoursAgo = (h: number): number => Date.now() - h * 3_600_000;
	const isoDay = (ts: number): string => {
		const d = new Date(ts);
		const p = (n: number): string => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
	};
	const DEMO_DEPOSITS: Deposit[] = [
		{ _id: 'demo-1', userId: 'demo-pauline', prenom: 'Pauline', nom: 'Debrie', email: 'paulinedebrie@gmail.com', step: 'mois1', count: 5, createdAt: hoursAgo(2), date: isoDay(hoursAgo(2)), ids: [] },
		{ _id: 'demo-2', userId: 'demo-cristina', prenom: 'Cristina', nom: 'Sobas', email: 'crisobas91@gmail.com', step: 'demarrage', count: 3, createdAt: hoursAgo(26), date: isoDay(hoursAgo(26)), ids: [] },
		{ _id: 'demo-3', userId: 'demo-floriane', prenom: 'Floriane', nom: 'Baud', email: 'floriane.baud26@gmail.com', step: 'mois1', count: 4, createdAt: hoursAgo(8 * 24 + 2), date: isoDay(hoursAgo(8 * 24 + 2)), ids: [] },
		{ _id: 'demo-4', userId: 'demo-estelle', prenom: 'Estelle', nom: 'Delamare', email: 'estelledelamare@yahoo.fr', step: 'mois2', count: 3, createdAt: hoursAgo(12 * 24 + 5), date: isoDay(hoursAgo(12 * 24 + 5)), ids: [] },
		{ _id: 'demo-5', userId: 'demo-marine', prenom: 'Marine', nom: 'Labarre', email: 'labarremarine252@orange.fr', step: 'mois1', count: 6, createdAt: hoursAgo(19 * 24 + 3), date: isoDay(hoursAgo(19 * 24 + 3)), ids: [] },
		{ _id: 'demo-6', userId: 'demo-laetitia', prenom: 'Laetitia', nom: 'Bonfils', email: 'laetitia.bonfils@gmail.com', step: 'mois3', count: 4, createdAt: hoursAgo(26 * 24 + 4), date: isoDay(hoursAgo(26 * 24 + 4)), ids: [] },
		{ _id: 'demo-7', userId: 'demo-dorothee', prenom: 'Dorothée', nom: 'Rostaing', email: 'dorothee.rostaing@gmail.com', step: 'mois1', count: 5, createdAt: hoursAgo(32 * 24 + 6), date: isoDay(hoursAgo(32 * 24 + 6)), ids: [] },
		{ _id: 'demo-8', userId: 'demo-melissa', prenom: 'Melissa', nom: 'Phoutone', email: 'melissa.phoutone@gmail.com', step: 'demarrage', count: 3, createdAt: hoursAgo(36 * 24 + 2), date: isoDay(hoursAgo(36 * 24 + 2)), ids: [] },
	];

	const isDemo = $derived(deposits.length === 0);
	const displayDeposits = $derived(isDemo ? DEMO_DEPOSITS : deposits);

	/* ── Identité coach (haut droit) : session réelle sinon démo — 100 % front. ── */
	const coach = $derived(coachIdentity((data as { user?: CoachUserLike } | null)?.user));

	/* ── Filtres / recherche / tri — UI pure, aucune donnée supplémentaire ── */
	type PeriodFilter = 'all' | 'today' | '7d' | '30d' | 'month' | '3m' | 'year';
	let period = $state<PeriodFilter>('all');
	let query = $state('');
	let sortBy = $state<'recent' | 'photos' | 'name'>('recent');

	const chips = [
		{ id: 'all', label: 'Tous les dépôts' },
		{ id: 'today', label: "Aujourd'hui" },
		{ id: '7d', label: '7 derniers jours' },
		{ id: '30d', label: '30 derniers jours' },
		{ id: 'month', label: 'Ce mois-ci' },
		{ id: '3m', label: '3 derniers mois' },
		{ id: 'year', label: 'Cette année' }
	] as const;

	const fullName = (d: Deposit): string => (d.nom ? `${d.prenom} ${d.nom}` : d.prenom);
	const initial = (n: string): string => n.trim().charAt(0).toUpperCase() || '?';

	/** Date du dépôt (champ `date` "yyyy-mm-dd" du système photo existant). */
	function fmtDate(iso: string): string {
		return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', {
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		});
	}

	/** Heure du dépôt (horodatage réel de l'envoi). */
	function fmtTime(ts: number): string {
		return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
	}

	const dayKey = (x: Date): string => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;

	/** « aujourd'hui à 14:22 » / « hier à 09:04 » / « 25 sept. à 09:14 ». */
	function fmtDepositWhen(ts: number): string {
		const d = new Date(ts);
		const now = new Date();
		if (dayKey(d) === dayKey(now)) return `aujourd'hui à ${fmtTime(ts)}`;
		const yest = new Date(now);
		yest.setDate(now.getDate() - 1);
		if (dayKey(d) === dayKey(yest)) return `hier à ${fmtTime(ts)}`;
		return `${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} à ${fmtTime(ts)}`;
	}

	/** Badge période du dernier dépôt : « Sept. 2026 ». */
	function fmtPeriod(iso: string): string {
		const s = new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
		return s.charAt(0).toUpperCase() + s.slice(1);
	}

	/** Période courante (badge vert) vs mois plus ancien (badge ambré). */
	function isCurrentPeriod(iso: string): boolean {
		const d = new Date(iso + 'T12:00:00');
		const now = new Date();
		return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
	}

	/** Fenêtre de temps du filtre actif (sur le dépôt le plus récent de la cliente). */
	function inPeriod(ts: number, f: PeriodFilter): boolean {
		if (f === 'all') return true;
		const now = new Date();
		if (f === 'today') return dayKey(new Date(ts)) === dayKey(now);
		if (f === '7d') return ts >= now.getTime() - 7 * 86_400_000;
		if (f === '30d') return ts >= now.getTime() - 30 * 86_400_000;
		if (f === 'month') {
			const d = new Date(ts);
			return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
		}
		if (f === '3m') return ts >= new Date(now.getFullYear(), now.getMonth() - 2, 1).getTime();
		return new Date(ts).getFullYear() === now.getFullYear(); // year
	}

	/* ── Agrégation par cliente : une ligne par cliente (dernier dépôt,
	   total photos, période) — simple regroupement des dépôts déjà chargés. ── */
	type ClientRow = {
		userId: string;
		name: string;
		avatar: string;
		/** Email affiché sous le nom (lignes de démonstration uniquement —
		 *  la liste agrégée réelle ne transporte pas les emails). */
		email: string | null;
		demo: boolean;
		lastDeposit: Deposit;
		depositCount: number;
		photoCount: number;
	};
	const clientRows = $derived.by(() => {
		const map = new Map<string, ClientRow>();
		for (const d of displayDeposits) {
			const cur = map.get(d.userId);
			if (!cur) {
				map.set(d.userId, {
					userId: d.userId,
					name: fullName(d),
					avatar: initial(d.prenom),
					email: d.email ?? null,
					demo: isDemo,
					lastDeposit: d,
					depositCount: 1,
					photoCount: d.count
				});
			} else {
				cur.depositCount += 1;
				cur.photoCount += d.count;
				if (d.createdAt > cur.lastDeposit.createdAt) cur.lastDeposit = d;
			}
		}
		return [...map.values()];
	});

	const filteredRows = $derived.by(() => {
		let rows = clientRows.filter((r) => inPeriod(r.lastDeposit.createdAt, period));
		const q = query.trim().toLowerCase();
		if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || (r.email ?? '').toLowerCase().includes(q));
		if (sortBy === 'photos') return [...rows].sort((a, b) => b.photoCount - a.photoCount);
		if (sortBy === 'name') return [...rows].sort((a, b) => a.name.localeCompare(b.name));
		return [...rows].sort((a, b) => b.lastDeposit.createdAt - a.lastDeposit.createdAt);
	});

	/** KPI : total des photos déposées (somme des séries affichées). */
	const totalPhotos = $derived(displayDeposits.reduce((s: number, d: Deposit) => s + d.count, 0));

	/** « Voir les photos » → Vision 360 de la cliente, ouverte sur l'onglet Photos. */
	const photosLink = (userId: string): string => `/admin?client=${encodeURIComponent(userId)}&section=photos`;

	/** Miniatures de démonstration : silhouettes studio (face / profil / dos),
	 *  tournées par ligne pour varier les aperçus. */
	const DEMO_THUMBS = ['/img/photo-demo-face.svg', '/img/photo-demo-side.svg', '/img/photo-demo-back.svg'];
	const demoThumb = (rowIdx: number, i: number): string => DEMO_THUMBS[(rowIdx + i) % DEMO_THUMBS.length];
</script>

<svelte:head><title>Photos — G-Flux (CRM)</title></svelte:head>

<!-- ═══ En-tête premium : titre + sous-titre · cloche + identité coach ═══ -->
<header class="m-in-crm flex flex-wrap items-start justify-between gap-3" style="--m-i: 0">
	<div class="min-w-0">
		<h1 class="flex items-center gap-2.5 font-display text-2xl font-black tracking-tight text-ink">
			<span class="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand-light text-brand-deep">
				<Icon name="camera" size={20} />
			</span>
			Photos
		</h1>
		<p class="mt-1.5 text-sm text-mist">
			Historique permanent des photos de tes clientes — du plus récent au plus ancien, jamais supprimé.
		</p>
	</div>
	<div class="flex shrink-0 items-center gap-2">
		<a
			href="/admin/notifications"
			aria-label="Notifications"
			title="Notifications"
			class="btn-crm relative grid h-10 w-10 place-items-center rounded-full border border-line bg-white text-ink transition hover:border-brand hover:text-brand"
		>
			<Icon name="bell" size={17} />
			{#if Number(data.notificationsBadge ?? 0) > 0}
				<span class="badge-in absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-warn px-1 text-[10px] font-bold text-white ring-2 ring-white">{Number(data.notificationsBadge)}</span>
			{/if}
		</a>
		<CoachIdentity prenom={coach.prenom} nom={coach.nom} email={coach.email} />
	</div>
</header>

{#if isDemo}
	<p class="m-in-crm mt-3 inline-flex items-center gap-1.5 rounded-full bg-soft px-3 py-1 text-[11px] font-bold text-mist" style="--m-i: 0">
		<Icon name="info" size={12} class="shrink-0" /> Exemples de démonstration — cette page affichera les dépôts réels de tes clientes dès les premiers envois.
	</p>
{/if}

<!-- ═══ Périodes (chips) · KPI total des photos ═══ -->
<div class="m-in-crm mt-4 flex flex-wrap items-start justify-between gap-3" style="--m-i: 1">
	<div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrer par période de dépôt">
		{#each chips as c (c.id)}
			<button type="button" class="chip-crm {period === c.id ? 'active-crm' : ''}" onclick={() => (period = c.id)} aria-pressed={period === c.id}>{c.label}</button>
		{/each}
	</div>
	<div class="kpi-crm card-crm-hover flex w-full max-w-xs items-center gap-3.5 sm:w-64" style="--kpi-accent: var(--accent); --kpi-tile-bg: var(--accent-light); --kpi-tile-fg: var(--brand-deep)">
		<span class="kpi-tile-lg shrink-0"><Icon name="camera" size={20} /></span>
		<div class="min-w-0 flex-1">
			<div class="kpi-num-crm text-[1.7rem] leading-none text-ink">{totalPhotos}</div>
			<div class="mt-1 text-[11.5px] font-bold text-ink">dépôts photos au total</div>
			<div class="mt-0.5 text-[10.5px] text-mist">
				{displayDeposits.length} dépôt{displayDeposits.length > 1 ? 's' : ''} · {clientRows.length} cliente{clientRows.length > 1 ? 's' : ''}
			</div>
		</div>
		<span class="spark-crm shrink-0" aria-hidden="true" style="--spark-color: rgba(29, 185, 84, 0.5)">
			<i style="--h: 40; --m-i: 0"></i><i style="--h: 65; --m-i: 1"></i><i style="--h: 50; --m-i: 2"></i><i style="--h: 80; --m-i: 3"></i><i style="--h: 60; --m-i: 4"></i><i style="--h: 100; --m-i: 5"></i>
		</span>
	</div>
</div>

<!-- ═══ Carte principale : dépôts par cliente (recherche + tri + CTA) ═══ -->
<section class="card-crm m-in-crm mt-4 overflow-hidden" style="--m-i: 2">
	<div class="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
		<div class="flex min-w-0 items-center gap-2.5">
			<span class="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand-light text-brand-deep"><Icon name="users" size={15} /></span>
			<h2 class="h2-crm text-base">Dépôts photos des clientes</h2>
			<span class="badge-in rounded-full bg-brand-light px-2 py-0.5 text-[11px] font-bold text-brand-deep">{filteredRows.length}</span>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<label class="relative">
				<span class="sr-only">Rechercher une cliente</span>
				<Icon name="search" size={14} class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mist" />
				<input
					type="search"
					bind:value={query}
					placeholder="Rechercher une cliente…"
					class="w-44 rounded-full border border-line bg-white py-1.5 pl-8 pr-3 text-[13px] outline-none transition placeholder:text-mist focus:border-brand md:w-52"
				/>
			</label>
			<details class="group relative">
				<summary class="btn-crm inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-[12.5px] font-bold text-ink transition hover:border-brand hover:text-brand">
					<Icon name="settings" size={13} class="shrink-0" /> Filtres
				</summary>
				<div class="absolute right-0 top-10 z-20 w-52 rounded-xl border border-line bg-white p-1.5 shadow-xl">
					<p class="px-2.5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-mist">Trier par</p>
					<button type="button" class="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[13px] font-semibold text-ink transition hover:bg-soft" onclick={() => (sortBy = 'recent')}>
						Dernier dépôt {#if sortBy === 'recent'}<Icon name="check" size={13} class="shrink-0 text-brand" />{/if}
					</button>
					<button type="button" class="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[13px] font-semibold text-ink transition hover:bg-soft" onclick={() => (sortBy = 'photos')}>
						Nombre de photos {#if sortBy === 'photos'}<Icon name="check" size={13} class="shrink-0 text-brand" />{/if}
					</button>
					<button type="button" class="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[13px] font-semibold text-ink transition hover:bg-soft" onclick={() => (sortBy = 'name')}>
						Nom (A→Z) {#if sortBy === 'name'}<Icon name="check" size={13} class="shrink-0 text-brand" />{/if}
					</button>
				</div>
			</details>
			<a
				href="/admin/templates"
				class="btn-crm inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-[12.5px] font-bold text-white shadow-sm transition hover:bg-brand-dark"
			><Icon name="messageCircle" size={13} class="shrink-0" /> Relancer une cliente</a>
		</div>
	</div>

	{#if filteredRows.length === 0}
		<p class="px-6 py-12 text-center text-sm text-mist">Aucune cliente ne correspond à cette recherche ou à cette période.</p>
	{:else}
		<div class="table-wrap overflow-x-auto">
			<table class="tbl-crm w-full min-w-[920px] text-left">
				<thead>
					<tr>
						<th class="px-5 py-2.5">Cliente</th>
						<th class="px-3 py-2.5">Dernier dépôt</th>
						<th class="px-3 py-2.5">Nombre de photos</th>
						<th class="px-3 py-2.5">Période</th>
						<th class="px-3 py-2.5">Aperçu</th>
						<th class="px-5 py-2.5 text-right">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each filteredRows as r, rowIdx (r.userId)}
						{@const last = r.lastDeposit}
						{@const stepLabel = PHOTO_STEP_LABELS[last.step as PhotoStep] ?? last.step}
						<tr class="crow-crm">
							<td class="px-5 py-3">
								<div class="flex items-center gap-2.5">
									<span class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand text-[13px] font-black text-white">{r.avatar}</span>
									<div class="min-w-0 max-w-[190px]">
										<div class="truncate text-[13.5px] font-bold text-ink">{r.name}</div>
										<div class="truncate text-[11px] text-mist">{r.email ?? `${r.depositCount} dépôt${r.depositCount > 1 ? 's' : ''}`}</div>
									</div>
								</div>
							</td>
							<td class="whitespace-nowrap px-3 py-3">
								<div class="text-[13px] font-semibold text-ink">{fmtDepositWhen(last.createdAt)}</div>
								<div class="text-[11px] text-mist">{fmtDate(last.date)}</div>
							</td>
							<td class="whitespace-nowrap px-3 py-3">
								<span class="inline-flex items-center gap-1.5 text-[13px] font-bold text-ink"><Icon name="images" size={14} class="text-mist" /> {r.photoCount}</span>
								<span class="ml-1.5 inline-block rounded-full bg-brand-light px-2 py-0.5 text-[10px] font-bold text-brand-deep">{stepLabel}</span>
							</td>
							<td class="whitespace-nowrap px-3 py-3">
								<span class="inline-block rounded-full px-2.5 py-1 text-[11px] font-bold {isCurrentPeriod(last.date) ? 'bg-brand-light text-brand-deep' : 'bg-warn-light text-warn'}">{fmtPeriod(last.date)}</span>
							</td>
							<td class="px-3 py-3">
								{#if r.demo}
									<!-- Miniatures de démonstration : vrais rendus <img> (pose
									     face / profil / dos) pour préfigurer le module final. -->
									<div class="flex items-center gap-1.5">
										{#each Array.from({ length: Math.min(4, Math.max(1, r.photoCount)) }) as _, i (i)}
											<img
												src={demoThumb(rowIdx, i)}
												alt=""
												aria-hidden="true"
												loading="lazy"
												class="h-10 w-[30px] rounded-md object-cover ring-1 ring-line"
											/>
										{/each}
										{#if r.photoCount > 4}
											<span class="grid h-10 w-[30px] place-items-center rounded-md bg-soft text-[10px] font-bold text-ink">+{r.photoCount - 4}</span>
										{/if}
									</div>
								{:else}
									<!-- Aperçu décoratif : les URLs des photos ne transitent pas par
									     cette page (liste agrégée) — la Vision 360 affiche les vraies. -->
									<div class="flex items-center gap-1" aria-hidden="true">
										{#each Array.from({ length: Math.min(3, Math.max(1, r.photoCount)) }) as _, i (i)}
											<span class="grid h-9 w-7 place-items-center rounded-md border border-line bg-gradient-to-b from-brand-light to-white text-brand-deep" style={`opacity: ${1 - i * 0.18}`}>
												<Icon name="images" size={13} />
											</span>
										{/each}
										{#if r.photoCount > 3}
											<span class="grid h-9 w-7 place-items-center rounded-md bg-soft text-[10px] font-bold text-ink">+{r.photoCount - 3}</span>
										{/if}
									</div>
								{/if}
							</td>
							<td class="px-5 py-3 text-right">
								{#if r.demo}
									<button
										type="button"
										disabled
										title="Exemple de démonstration — aucun dépôt réel derrière"
										class="btn-crm inline-flex cursor-not-allowed items-center gap-1 rounded-full border border-line bg-white px-3 py-1.5 text-[12px] font-bold text-ink opacity-60"
									>Voir les photos <Icon name="arrowRight" size={12} /></button>
								{:else}
									<a
										href={photosLink(r.userId)}
										data-sveltekit-preload-data="tap"
										class="btn-crm inline-flex items-center gap-1 rounded-full border border-line bg-white px-3 py-1.5 text-[12px] font-bold text-ink transition hover:border-brand hover:text-brand"
									>Voir les photos <Icon name="arrowRight" size={12} /></a>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>
