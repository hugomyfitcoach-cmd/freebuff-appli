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
		lastDeposit: Deposit;
		depositCount: number;
		photoCount: number;
	};
	const clientRows = $derived.by(() => {
		const map = new Map<string, ClientRow>();
		for (const d of deposits) {
			const cur = map.get(d.userId);
			if (!cur) {
				map.set(d.userId, {
					userId: d.userId,
					name: fullName(d),
					avatar: initial(d.prenom),
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
		if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q));
		if (sortBy === 'photos') return [...rows].sort((a, b) => b.photoCount - a.photoCount);
		if (sortBy === 'name') return [...rows].sort((a, b) => a.name.localeCompare(b.name));
		return [...rows].sort((a, b) => b.lastDeposit.createdAt - a.lastDeposit.createdAt);
	});

	/** KPI : total des photos déposées (somme des séries déjà chargées). */
	const totalPhotos = $derived(deposits.reduce((s: number, d: Deposit) => s + d.count, 0));

	/** « Voir les photos » → Vision 360 de la cliente, ouverte sur l'onglet Photos. */
	const photosLink = (userId: string): string => `/admin?client=${encodeURIComponent(userId)}&section=photos`;
</script>

<svelte:head><title>Photos — G-Flux (CRM)</title></svelte:head>

<!-- ═══ En-tête premium : titre + sous-titre · KPI total des photos ═══ -->
<div class="m-in-crm flex flex-wrap items-start justify-between gap-3" style="--m-i: 0">
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
	{#if deposits.length > 0}
		<div class="kpi-crm w-56 shrink-0" style="--kpi-accent: var(--accent); --kpi-tile-bg: var(--accent-light); --kpi-tile-fg: var(--brand-deep)">
			<div class="flex items-center justify-between gap-2">
				<span class="kpi-tile" style="width: 2rem; height: 2rem"><Icon name="camera" size={16} /></span>
				<span class="spark-crm" aria-hidden="true" style="--spark-color: rgba(29, 185, 84, 0.5)">
					<i style="--h: 40; --m-i: 0"></i><i style="--h: 65; --m-i: 1"></i><i style="--h: 50; --m-i: 2"></i><i style="--h: 80; --m-i: 3"></i><i style="--h: 60; --m-i: 4"></i><i style="--h: 100; --m-i: 5"></i>
				</span>
			</div>
			<div class="kpi-num-crm mt-2 text-[1.6rem] text-ink">{totalPhotos}</div>
			<div class="text-[12px] font-bold text-ink">photo{totalPhotos > 1 ? 's' : ''} au total</div>
			<div class="mt-0.5 text-[11px] text-mist">
				{deposits.length} dépôt{deposits.length > 1 ? 's' : ''} · {clientRows.length} cliente{clientRows.length > 1 ? 's' : ''}
			</div>
		</div>
	{/if}
</div>

<!-- ═══ Filtres temporels (chips) ═══ -->
{#if deposits.length > 0}
	<div class="m-in-crm mt-4 flex flex-wrap items-center gap-1.5" style="--m-i: 1" role="group" aria-label="Filtrer par période de dépôt">
		{#each chips as c (c.id)}
			<button type="button" class="chip-crm {period === c.id ? 'active-crm' : ''}" onclick={() => (period = c.id)} aria-pressed={period === c.id}>{c.label}</button>
		{/each}
	</div>
{/if}

{#if deposits.length === 0}
	<!-- Empty state premium -->
	<div class="m-in-crm mt-5 rounded-2xl border border-dashed border-line bg-card px-6 py-14 text-center" style="--m-i: 1">
		<span class="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-light text-brand-deep"><Icon name="camera" size={26} /></span>
		<p class="mt-3 font-display text-base font-bold text-ink">Aucun dépôt de photo pour l'instant</p>
		<p class="mx-auto mt-1 max-w-md text-sm leading-relaxed text-mist">
			Dès qu'une cliente envoie ses photos de suivi depuis son espace (étapes Démarrage → Mois 6), le dépôt apparaît ici en tête de liste — définitivement.
		</p>
	</div>
{:else}
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
				<table class="tbl-crm w-full min-w-[880px] text-left">
					<thead>
						<tr>
							<th class="px-5 py-2.5">Cliente</th>
							<th class="px-3 py-2.5">Dernier dépôt</th>
							<th class="px-3 py-2.5">Photos</th>
							<th class="px-3 py-2.5">Période</th>
							<th class="px-3 py-2.5">Aperçu</th>
							<th class="px-5 py-2.5 text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each filteredRows as r (r.userId)}
							{@const last = r.lastDeposit}
							{@const stepLabel = PHOTO_STEP_LABELS[last.step as PhotoStep] ?? last.step}
							<tr class="crow-crm">
								<td class="px-5 py-3">
									<div class="flex items-center gap-2.5">
										<span class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand text-[13px] font-black text-white">{r.avatar}</span>
										<div class="min-w-0">
											<div class="truncate text-[13.5px] font-bold text-ink">{r.name}</div>
											<div class="text-[11px] text-mist">{r.depositCount} dépôt{r.depositCount > 1 ? 's' : ''}</div>
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
									<span class="inline-block rounded-full bg-soft px-2.5 py-1 text-[11px] font-bold text-ink/70">{fmtPeriod(last.date)}</span>
								</td>
								<td class="px-3 py-3">
									<!-- Aperçu décoratif : les URLs des photos ne transitent pas par cette
									     page (liste agrégée) — la Vision 360 affiche les vraies photos. -->
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
								</td>
								<td class="px-5 py-3 text-right">
									<a
										href={photosLink(r.userId)}
										data-sveltekit-preload-data="tap"
										class="btn-crm inline-flex items-center gap-1 rounded-full border border-line bg-white px-3 py-1.5 text-[12px] font-bold text-ink transition hover:border-brand hover:text-brand"
									>Voir les photos <Icon name="arrowRight" size={12} /></a>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
{/if}
