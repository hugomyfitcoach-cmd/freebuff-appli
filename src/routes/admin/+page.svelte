<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import BilanCard from '../../lib/components/BilanCard.svelte';

	let { data, form } = $props();

	const clients = $derived(data.clients ?? []);
	const selectedId = $derived(data.selectedId ?? null);
	const view = $derived(data.view ?? null);
	const checkins = $derived(data.checkins ?? []);
	const photos = $derived(data.photos ?? []);
	const selected = $derived(clients.find((c: { user: { _id: string } }) => c.user._id === selectedId) ?? null);

	const totalWaiting = $derived(clients.reduce((s: number, c: { waiting: number }) => s + c.waiting, 0));
	const activeToday = $derived(
		clients.filter((c: { user: { lastSeenAt: number | null } }) => {
			const ts = c.user.lastSeenAt;
			return ts && Date.now() - ts < 24 * 3600 * 1000;
		}).length
	);

	let query = $state('');

	const filtered = $derived(
		query.trim()
			? clients.filter((c: { user: { prenom: string; email: string } }) =>
					`${c.user.prenom} ${c.user.email}`.toLowerCase().includes(query.trim().toLowerCase())
				)
			: clients
	);

	const alert = $derived(form && 'action' in form ? (form as { action: string; error?: string; ok?: string; clientId?: string }) : null);
	const initial = (name: string) => name.trim().charAt(0).toUpperCase() || '?';

	/* ── Formatage ─────────────────────────────────────────────── */
	function fmtLastSeen(ts: number | null): string {
		if (!ts) return 'jamais connecté·e';
		const diff = Date.now() - ts;
		const min = Math.floor(diff / 60000);
		if (min < 1) return 'à l’instant';
		if (min < 60) return `il y a ${min} min`;
		const h = Math.floor(min / 60);
		if (h < 24) return `il y a ${h} h`;
		const d = Math.floor(h / 24);
		if (d === 1) return 'hier';
		if (d < 7) return `il y a ${d} j`;
		return new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
	}

	function fmtDateShort(iso: string): string {
		return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
	}

	function dayLabel(iso: string): string {
		return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short' });
	}

	function todayISO(): string {
		const d = new Date();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}

	/* ── Vue 360° ──────────────────────────────────────────────── */
	const weightDelta = $derived(
		view && view.lastWeight != null && view.firstWeight != null ? Math.round((view.lastWeight - view.firstWeight) * 10) / 10 : null
	);
	const latestMetric = $derived(view?.latestMetric ?? null);
	const goalKcal = $derived(view?.goals?.kcal ?? 2000);
	const weekAvg = $derived(view ? Math.round(view.weekAvgKcal) : 0);
	const kcalTrend = $derived(view && weekAvg > 0 ? Math.round(((weekAvg - goalKcal) / goalKcal) * 100) : 0);
	const loggedDays = $derived(view?.week?.filter((d: { count: number }) => d.count > 0).length ?? 0);

	const chart = $derived.by(() => {
		if (!view) return null;
		const days = view.week ?? [];
		const maxVal = Math.max(goalKcal, ...days.map((d: { kcal: number }) => d.kcal), 100);
		const W = 700, H = 190, top = 12, bottom = 26;
		const innerH = H - top - bottom;
		const bars = days.map((d: { date: string; kcal: number; count: number }, i: number) => {
			const h = Math.max(4, (d.kcal / maxVal) * innerH);
			return {
				x: i * 100 + 22,
				y: H - bottom - h,
				h,
				kcal: d.kcal,
				count: d.count,
				label: dayLabel(d.date),
				full: fmtDateShort(d.date),
				isToday: i === days.length - 1,
			};
		});
		const goalY = H - bottom - (goalKcal / maxVal) * innerH;
		const avgY = weekAvg > 0 ? H - bottom - (weekAvg / maxVal) * innerH : null;
		return { bars, goalY, avgY, maxVal };
	});

	const weightPoints = $derived.by(() => {
		if (!view || (view.weightTrend ?? []).length < 1) return null;
		const pts = view.weightTrend as { date: string; weightKg: number }[];
		const W = 700, H = 170, top = 14, bottom = 26;
		const innerH = H - top - bottom;
		let min = Infinity, max = -Infinity;
		for (const p of pts) {
			if (p.weightKg < min) min = p.weightKg;
			if (p.weightKg > max) max = p.weightKg;
		}
		const span = Math.max(max - min, 2);
		min = min - span * 0.25;
		max = max + span * 0.25;
		const n = pts.length;
		const coords = pts.map((p, i) => {
			const x = n === 1 ? W / 2 : (i / (n - 1)) * (W - 60) + 30;
			const y = top + innerH - ((p.weightKg - min) / (max - min)) * innerH;
			return { x, y, date: p.date, weightKg: p.weightKg };
		});
		return { coords, min: Math.round(min * 10) / 10, max: Math.round(max * 10) / 10 };
	});

	const isOnline = (ts: number | null) => !!ts && Date.now() - ts < 5 * 60 * 1000;

	/* ── Journal alimentaire (la coach agit « en doublon ») ────── */
	const MEALS = [
		{ id: 'petit-dej', label: 'Petit-déjeuner' },
		{ id: 'dejeuner', label: 'Déjeuner' },
		{ id: 'diner', label: 'Dîner' },
		{ id: 'collation', label: 'Collations' },
	];
	const MEAL_LABEL: Record<string, string> = Object.fromEntries(MEALS.map((m) => [m.id, m.label]));

	type Entry = {
		_id: string;
		meal: string;
		name: string;
		brand?: string;
		imageUrl?: string;
		qtyGrams: number;
		kcal: number;
		carbs: number;
		protein: number;
		fat: number;
	};
	type DayData = {
		date: string;
		goals: { kcal: number; carbs: number; protein: number; fat: number };
		entries: Entry[];
		totals: { kcal: number; carbs: number; protein: number; fat: number };
	};
	type FoodHit = {
		_id: string;
		name: string;
		brand?: string;
		kcal100: number;
		carbs100: number;
		protein100: number;
		fat100: number;
		imageUrl?: string;
	};

	let journalDate = $state(todayISO());
	let day = $state<DayData | null>(null);
	let journalBusy = $state(false);
	let journalMsg = $state('');

	let searchOpen = $state(false);
	let searchQ = $state('');
	let searchBusy = $state(false);
	let searchHits = $state<FoodHit[]>([]);
	let addMeal = $state('petit-dej');
	let addQty = $state('100');

	async function loadDay() {
		if (!selectedId) return;
		journalBusy = true;
		journalMsg = '';
		try {
			const res = await fetch(`/api/coach/journal?userId=${selectedId}&date=${journalDate}`);
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? 'Chargement impossible.');
			day = data;
		} catch (e) {
			journalMsg = e instanceof Error ? e.message : 'Chargement impossible.';
		} finally {
			journalBusy = false;
		}
	}

	async function doSearch() {
		if (searchQ.trim().length < 2) return;
		searchBusy = true;
		try {
			const res = await fetch(`/api/coach/search?q=${encodeURIComponent(searchQ.trim())}`);
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? 'Recherche impossible.');
			searchHits = data;
		} catch (e) {
			journalMsg = e instanceof Error ? e.message : 'Recherche impossible.';
		} finally {
			searchBusy = false;
		}
	}

	async function addFood(hit: FoodHit) {
		if (!selectedId) return;
		try {
			const res = await fetch('/api/coach/journal', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					userId: selectedId,
					date: journalDate,
					meal: addMeal,
					foodId: hit._id,
					qtyGrams: Number(addQty) || 100,
				}),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? 'Ajout impossible.');
			searchOpen = false;
			searchHits = [];
			searchQ = '';
			await loadDay();
		} catch (e) {
			journalMsg = e instanceof Error ? e.message : 'Ajout impossible.';
		}
	}

	async function setQty(entry: Entry, qtyGrams: number) {
		if (!selectedId) return;
		try {
			const res = await fetch(`/api/coach/journal/${entry._id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId: selectedId, qtyGrams }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? 'Mise à jour impossible.');
			await loadDay();
		} catch (e) {
			journalMsg = e instanceof Error ? e.message : 'Mise à jour impossible.';
		}
	}

	async function removeEntry(entry: Entry) {
		if (!selectedId) return;
		try {
			const res = await fetch(`/api/coach/journal/${entry._id}?userId=${selectedId}`, { method: 'DELETE' });
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? 'Suppression impossible.');
			await loadDay();
		} catch (e) {
			journalMsg = e instanceof Error ? e.message : 'Suppression impossible.';
		}
	}

	/* ── Mensurations / poids (la coach corrige) ───────────────── */
	type Measurement = {
		_id: string;
		date: string;
		weightKg?: number;
		neckCm?: number;
		waistCm?: number;
		hipCm?: number;
	};
	let measurements = $state<Measurement[]>([]);
	let mDate = $state(todayISO());
	let mWeight = $state('');
	let mWaist = $state('');
	let mHip = $state('');
	let mNeck = $state('');
	let mBusy = $state(false);
	let mMsg = $state('');

	async function loadMeasurements() {
		if (!selectedId) return;
		try {
			const res = await fetch(`/api/coach/metrics?userId=${selectedId}`);
			const data = await res.json();
			if (res.ok && Array.isArray(data.measurements)) {
				measurements = data.measurements;
				const last = data.measurements[data.measurements.length - 1];
				if (last) {
					mDate = last.date;
					mWeight = last.weightKg != null ? String(last.weightKg) : '';
					mWaist = last.waistCm != null ? String(last.waistCm) : '';
					mHip = last.hipCm != null ? String(last.hipCm) : '';
					mNeck = last.neckCm != null ? String(last.neckCm) : '';
				}
			}
		} catch {
			/* silencieux */
		}
	}

	async function saveMeasurement() {
		if (!selectedId) return;
		mBusy = true;
		mMsg = '';
		try {
			const body: Record<string, unknown> = { userId: selectedId, date: mDate };
			if (mWeight) body.weightKg = Number(mWeight);
			if (mWaist) body.waistCm = Number(mWaist);
			if (mHip) body.hipCm = Number(mHip);
			if (mNeck) body.neckCm = Number(mNeck);
			const res = await fetch('/api/coach/metrics', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? 'Enregistrement impossible.');
			mMsg = '✓ Prise enregistrée.';
			await loadMeasurements();
			await invalidateAll();
		} catch (e) {
			mMsg = e instanceof Error ? e.message : 'Enregistrement impossible.';
		} finally {
			mBusy = false;
		}
	}

	async function deleteMetric(date: string, metric: string) {
		if (!selectedId) return;
		try {
			const res = await fetch(`/api/coach/metrics?userId=${selectedId}&date=${date}&metric=${metric}`, { method: 'DELETE' });
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? 'Suppression impossible.');
			await loadMeasurements();
			await invalidateAll();
		} catch (e) {
			mMsg = e instanceof Error ? e.message : 'Suppression impossible.';
		}
	}

	const metricKeys: { key: 'weightKg' | 'waistCm' | 'hipCm' | 'neckCm'; label: string }[] = [
		{ key: 'weightKg', label: 'Poids (kg)' },
		{ key: 'waistCm', label: 'Tour de taille (cm)' },
		{ key: 'hipCm', label: 'Fessiers (cm)' },
		{ key: 'neckCm', label: 'Tour de cou (cm)' },
	];

	/* ── Photos ────────────────────────────────────────────────── */
	const PHOTO_STEP_LABELS: Record<string, string> = {
		demarrage: 'Démarrage',
		mois1: 'Mois 1',
		mois2: 'Mois 2',
		mois3: 'Mois 3',
		mois4: 'Mois 4',
		mois5: 'Mois 5',
		mois6: 'Mois 6',
	};
	const totalPhotos = $derived(photos.reduce((s: number, g: { photos: unknown[] }) => s + g.photos.length, 0));

	/* Quand on ouvre le tiroir 360°, on précharge le journal + les mesures. */
	$effect(() => {
		const id = selectedId;
		if (id) {
			journalDate = todayISO();
			loadDay();
			loadMeasurements();
		}
	});

	/* ── Sections du tiroir 360° ───────────────────────────────── */
	let section = $state('apercu');

	const sectionTabs = $derived([
		{ id: 'apercu', label: 'Aperçu' },
		{ id: 'journal', label: 'Journal' },
		{ id: 'corps', label: 'Poids & mesures' },
		{ id: 'photos', label: `Photos (${totalPhotos})` },
		{ id: 'bilans', label: 'Bilans' },
	]);
</script>

<svelte:head><title>CRM — G-Flux</title></svelte:head>

<!-- Statistiques -->
<section class="grid gap-3 sm:grid-cols-3">
	<div class="rounded-2xl border border-line bg-card p-4">
		<div class="font-display text-3xl font-semibold text-ink">{clients.length}</div>
		<div class="text-xs font-semibold uppercase tracking-wide text-mist">Client·e·s</div>
	</div>
	<div class="rounded-2xl border border-line bg-card p-4">
		<div class="font-display text-3xl font-semibold text-brand">{activeToday}</div>
		<div class="text-xs font-semibold uppercase tracking-wide text-mist">Actif·ve·s aujourd’hui</div>
	</div>
	<div class="rounded-2xl border border-line bg-card p-4">
		<div class="font-display text-3xl font-semibold text-warn">{totalWaiting}</div>
		<div class="text-xs font-semibold uppercase tracking-wide text-mist">Retours à envoyer</div>
	</div>
</section>

{#if alert}
	<div
		class="mt-4 flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm
			{alert.error ? 'border-danger/40 bg-danger-light text-danger' : 'border-brand/40 bg-brand-light text-ink'}"
	>
		<span>{alert.error ?? alert.ok}</span>
		<span class="text-mist">✳️</span>
	</div>
{/if}

<!-- ═══ Tableau unique des clients ═══ -->
<div class="mt-6 rounded-2xl border border-line bg-card shadow-sm">
	<div class="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
		<div class="flex items-center gap-3">
			<h2 class="font-display text-lg font-semibold text-ink">Clients</h2>
			<span class="rounded-full bg-line/60 px-2 py-0.5 text-xs font-semibold text-mist">{filtered.length}</span>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<input
				type="search"
				bind:value={query}
				placeholder="Rechercher (nom, email)…"
				class="rounded-xl border-2 border-line bg-white px-3 py-2 text-sm outline-none transition focus:border-brand"
			/>
			<details class="group relative">
				<summary class="cursor-pointer list-none rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark">
					＋ Créer un client
				</summary>
				<form method="POST" action="?/createClient" class="absolute right-0 top-11 z-20 w-80 rounded-2xl border border-line bg-white p-4 shadow-xl">
					<label class="mb-1 block text-xs font-bold uppercase tracking-wide text-mist" for="nc-prenom">Prénom</label>
					<input id="nc-prenom" name="prenom" required placeholder="Ex. Julie" class="mb-3 w-full rounded-xl border-2 border-line px-3 py-2 text-sm outline-none focus:border-brand" />
					<label class="mb-1 block text-xs font-bold uppercase tracking-wide text-mist" for="nc-email">Email (identifiant de connexion)</label>
					<input id="nc-email" name="email" type="email" required placeholder="julie@exemple.fr" class="mb-3 w-full rounded-xl border-2 border-line px-3 py-2 text-sm outline-none focus:border-brand" />
					<label class="mb-1 block text-xs font-bold uppercase tracking-wide text-mist" for="nc-pass">Mot de passe (8 caractères min.)</label>
					<input id="nc-pass" name="password" type="text" required minlength="8" placeholder="Choisi avec la cliente…" class="mb-4 w-full rounded-xl border-2 border-line px-3 py-2 text-sm outline-none focus:border-brand" />
					<button type="submit" class="w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark">Créer le compte</button>
				</form>
			</details>
		</div>
	</div>

	{#if filtered.length === 0}
		<p class="px-6 py-14 text-center text-sm text-mist">
			Aucun compte client{query.trim() ? ' trouvé' : ' pour l’instant'}.<br />Crée le premier avec « ＋ Créer un client ».
		</p>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full min-w-[760px] text-left">
				<thead>
					<tr class="border-b border-line text-[11px] font-bold uppercase tracking-wider text-mist">
						<th class="px-5 py-3">Client</th>
						<th class="px-3 py-3">Dernière connexion</th>
						<th class="px-3 py-3">Bilans</th>
						<th class="px-3 py-3">Retours</th>
						<th class="px-3 py-3">Dernier bilan</th>
						<th class="px-5 py-3 text-right">360°</th>
					</tr>
				</thead>
				<tbody>
					{#each filtered as client (client.user._id)}
						<tr class="border-b border-line/60 transition hover:bg-cream/60">
							<td class="px-5 py-3">
								<div class="flex items-center gap-3">
									<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/15 font-display text-sm font-semibold text-brand-dark">
										{initial(client.user.prenom)}
									</div>
									<div class="min-w-0">
										<div class="flex items-center gap-2">
											<span class="truncate font-semibold text-ink">{client.user.prenom}</span>
											<span class="h-2 w-2 shrink-0 rounded-full {isOnline(client.user.lastSeenAt) ? 'bg-brand' : 'bg-line'}" title={isOnline(client.user.lastSeenAt) ? 'En ligne' : 'Hors ligne'}></span>
										</div>
										<div class="truncate text-[11px] text-mist">{client.user.email}</div>
									</div>
								</div>
							</td>
							<td class="whitespace-nowrap px-3 py-3 text-sm text-mist">{fmtLastSeen(client.user.lastSeenAt)}</td>
							<td class="px-3 py-3 text-sm text-ink">{client.count}</td>
							<td class="px-3 py-3">
								{#if client.waiting > 0}
									<span class="rounded-full bg-warn px-2 py-0.5 text-[11px] font-bold text-white">{client.waiting}</span>
								{:else}
									<span class="text-sm text-mist">—</span>
								{/if}
							</td>
							<td class="whitespace-nowrap px-3 py-3 text-sm text-mist">{client.latest?.weekLabel ?? '—'}</td>
							<td class="px-5 py-3 text-right">
								<a
									href={`/admin?client=${client.user._id}`}
									class="inline-flex items-center gap-1 rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand"
								>360° →</a>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<!-- ═══ Tiroir 360° ═══ -->
{#if selected && view}
	<button type="button" class="fixed inset-0 z-50 cursor-pointer bg-ink/50" aria-label="Fermer la vue 360°" onclick={() => (window.location.href = '/admin')}></button>
	<aside class="fixed inset-y-0 right-0 z-50 flex w-full max-w-4xl flex-col border-l border-line bg-cream shadow-2xl">
		<!-- En-tête du tiroir -->
		<div class="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-card px-5 py-3">
			<div class="flex items-center gap-3">
				<div class="flex h-10 w-10 items-center justify-center rounded-full bg-brand font-display text-lg font-semibold text-white">
					{initial(selected.user.prenom)}
				</div>
				<div>
					<h2 class="font-display text-lg font-semibold text-ink">{selected.user.prenom}</h2>
					<p class="text-[11px] text-mist">
						{selected.user.email}
						{selected.user.birthDate ? ` · 🎂 ${fmtDateShort(selected.user.birthDate)}` : ''}
						{selected.user.heightCm ? ` · 📏 ${selected.user.heightCm} cm` : ''}
						· 🕒 {fmtLastSeen(selected.user.lastSeenAt)}
					</p>
				</div>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<details class="group relative">
					<summary class="cursor-pointer list-none rounded-lg border-2 border-line px-3 py-1.5 text-sm text-ink transition hover:border-brand hover:text-brand">⚙️ Fiche</summary>
					<form method="POST" action="?/updateFiche" class="absolute right-0 top-10 z-20 w-80 rounded-xl border border-line bg-white p-4 shadow-xl">
						<input type="hidden" name="userId" value={selected.user._id} />
						<label class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist" for="f-prenom">Prénom</label>
						<input id="f-prenom" name="prenom" required value={selected.user.prenom} class="mb-3 w-full rounded-lg border-2 border-line px-2 py-1.5 text-sm outline-none focus:border-brand" />
						<label class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist" for="f-email">Email (identifiant)</label>
						<input id="f-email" name="email" type="email" required value={selected.user.email} class="mb-3 w-full rounded-lg border-2 border-line px-2 py-1.5 text-sm outline-none focus:border-brand" />
						<label class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist" for="f-birth">Date de naissance</label>
						<input id="f-birth" name="birthDate" type="date" value={selected.user.birthDate ?? ''} class="mb-3 w-full rounded-lg border-2 border-line px-2 py-1.5 text-sm outline-none focus:border-brand" />
						<label class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist" for="f-height">Taille (cm)</label>
						<input id="f-height" name="heightCm" type="number" min="80" max="250" step="0.5" value={selected.user.heightCm ?? ''} placeholder="Ex. 168" class="mb-3 w-full rounded-lg border-2 border-line px-2 py-1.5 text-sm outline-none focus:border-brand" />
						<button type="submit" class="w-full rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark">Enregistrer la fiche</button>
					</form>
				</details>
				<details class="group relative">
					<summary class="cursor-pointer list-none rounded-lg border-2 border-line px-3 py-1.5 text-sm text-ink transition hover:border-warn hover:text-warn">Mot de passe</summary>
					<form method="POST" action="?/resetPassword" class="absolute right-0 top-10 z-20 w-72 rounded-xl border border-line bg-white p-3 shadow-xl">
						<input type="hidden" name="userId" value={selected.user._id} />
						<input name="newPassword" type="text" required minlength="8" placeholder="Nouveau mot de passe (8+ car.)" class="mb-2 w-full rounded-lg border-2 border-line px-2 py-1.5 text-sm outline-none focus:border-warn" />
						<button type="submit" class="w-full rounded-lg bg-warn px-3 py-1.5 text-sm font-semibold text-white hover:brightness-95">Réinitialiser</button>
					</form>
				</details>
				<details class="group relative">
					<summary class="cursor-pointer list-none rounded-lg border-2 border-line px-3 py-1.5 text-sm text-danger transition hover:border-danger hover:bg-danger-light">Supprimer</summary>
					<form method="POST" action="?/removeClient" class="absolute right-0 top-10 z-20 w-80 rounded-xl border border-danger/40 bg-white p-3 shadow-xl">
						<input type="hidden" name="userId" value={selected.user._id} />
						<p class="text-xs leading-relaxed text-ink">Supprimer <strong>{selected.user.prenom}</strong> et toutes ses données ? Action irréversible.</p>
						<label class="mt-2 flex items-start gap-2 text-xs text-ink">
							<input type="checkbox" name="confirm" required class="mt-0.5" />
							<span>Je confirme la suppression définitive.</span>
						</label>
						<button type="submit" class="mt-2 w-full rounded-lg bg-danger px-3 py-1.5 text-sm font-semibold text-white hover:brightness-95">Supprimer le compte</button>
					</form>
				</details>
				<a href="/admin" class="rounded-lg bg-ink px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-brand">✕ Fermer</a>
			</div>
		</div>

		<!-- Onglets du 360° -->
		<div class="flex gap-1 overflow-x-auto border-b border-line bg-card px-5 pt-2">
			{#each sectionTabs as t}
				<button
					onclick={() => (section = t.id)}
					class="whitespace-nowrap rounded-t-lg px-3 py-2 text-sm font-semibold transition
						{section === t.id ? 'border-b-2 border-brand text-brand' : 'text-mist hover:text-ink'}"
				>{t.label}</button>
			{/each}
		</div>

		<div class="flex-1 space-y-5 overflow-y-auto px-5 py-5">
			<!-- ═══ Aperçu : dernières données + diagramme calories ═══ -->
			{#if section === 'apercu'}
				<div class="grid gap-3 sm:grid-cols-3">
					<div class="rounded-2xl border border-line bg-card p-4">
						<div class="text-[11px] font-bold uppercase tracking-wider text-mist">⚖️ Poids actuel</div>
						<div class="mt-1 flex items-baseline gap-2">
							<span class="font-display text-3xl font-semibold text-ink">{view.lastWeight != null ? `${String(view.lastWeight).replace('.', ',')} kg` : '—'}</span>
							{#if weightDelta != null}
								<span class="text-sm font-bold {weightDelta <= 0 ? 'text-brand' : 'text-warn'}">{weightDelta <= 0 ? '↓' : '↑'} {String(Math.abs(weightDelta)).replace('.', ',')} kg</span>
							{/if}
						</div>
						<div class="mt-1 text-[11px] text-mist">{latestMetric?.weightKg != null ? `dernière prise ${fmtDateShort(latestMetric.date)}` : 'aucune prise'}</div>
					</div>
					<div class="rounded-2xl border border-line bg-card p-4">
						<div class="text-[11px] font-bold uppercase tracking-wider text-mist">📐 Mensurations</div>
						<div class="mt-1 grid grid-cols-3 gap-2 text-center">
							<div>
								<div class="font-display text-lg font-semibold text-ink">{latestMetric?.waistCm != null ? String(latestMetric.waistCm).replace('.', ',') : '—'}</div>
								<div class="text-[10px] text-mist">taille</div>
							</div>
							<div>
								<div class="font-display text-lg font-semibold text-ink">{latestMetric?.hipCm != null ? String(latestMetric.hipCm).replace('.', ',') : '—'}</div>
								<div class="text-[10px] text-mist">fessiers</div>
							</div>
							<div>
								<div class="font-display text-lg font-semibold text-ink">{latestMetric?.neckCm != null ? String(latestMetric.neckCm).replace('.', ',') : '—'}</div>
								<div class="text-[10px] text-mist">cou</div>
							</div>
						</div>
						<div class="mt-1 text-[11px] text-mist">en cm {latestMetric ? `· ${fmtDateShort(latestMetric.date)}` : '· aucune prise'}</div>
					</div>
					<div class="rounded-2xl border border-line bg-card p-4">
						<div class="text-[11px] font-bold uppercase tracking-wider text-mist">🔥 Calories / jour</div>
						<div class="mt-1 flex items-baseline gap-2">
							<span class="font-display text-3xl font-semibold text-ink">{weekAvg || '—'}</span>
							{#if view && weekAvg > 0}
								<span class="text-sm font-bold {kcalTrend <= 5 ? 'text-brand' : 'text-warn'}">{kcalTrend > 0 ? '+' : ''}{kcalTrend} %</span>
							{/if}
						</div>
						<div class="mt-1 text-[11px] text-mist">moyenne constatée · {loggedDays} jour(s) renseigné(s) sur 7 · objectif {goalKcal}</div>
					</div>
				</div>

				<div class="rounded-2xl border border-line bg-card px-5 py-4 shadow-sm">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<h3 class="font-display text-base font-semibold text-ink">📊 Calories — tendance des 7 derniers jours</h3>
						<span class="text-[11px] text-mist">barres : kcal consommées · ligne pointillée : objectif · ligne verte : moyenne</span>
					</div>
					{#if chart}
						<div class="mt-3 overflow-x-auto">
							<svg viewBox="0 0 700 220" class="h-auto w-full min-w-[560px]" role="img" aria-label="Calories de la semaine">
								{#each chart.bars as bar, i}
									<g>
										<rect x={bar.x} y={chart.goalY - 3} width="56" height="6" rx="3" fill="none" stroke="#999990" stroke-width="1" stroke-dasharray="3 3" class="chart-goal-tick" />
										<rect x={bar.x} y={bar.y} width="56" height={bar.h} rx="6" fill={bar.isToday ? '#1db954' : '#7ce0a5'} class="chart-bar" style={`animation-delay: ${i * 70}ms`}>
											<title>{bar.full} : {bar.kcal} kcal ({bar.count} entrée{bar.count > 1 ? 's' : ''})</title>
										</rect>
										<text x={bar.x + 28} y={bar.y - 6} text-anchor="middle" class="chart-value" font-size="13" font-weight="600" fill="#111110">{bar.kcal > 0 ? bar.kcal : ''}</text>
										<text x={bar.x + 28} y="214" text-anchor="middle" font-size="12" fill="#999990" font-weight="600">{bar.label}</text>
									</g>
								{/each}
								<line x1="0" y1={chart.goalY} x2="700" y2={chart.goalY} stroke="#111110" stroke-width="1.5" stroke-dasharray="6 5" />
								<text x="704" y={chart.goalY - 4} font-size="12" fill="#111110" font-weight="600">🎯</text>
								{#if chart.avgY != null}
									<line x1="0" y1={chart.avgY} x2="700" y2={chart.avgY} stroke="#1db954" stroke-width="2.5" stroke-dasharray="10 6" />
									<text x="704" y={chart.avgY - 4} font-size="12" fill="#1db954" font-weight="700">moy {weekAvg}</text>
								{/if}
							</svg>
						</div>
						<div class="mt-2 rounded-xl bg-brand-light px-4 py-2.5 text-xs text-ink">
							📐 <strong>Moyenne constatée : {weekAvg} kcal/jour</strong> sur {loggedDays} jour(s) renseigné(s) — calcul : somme des calories des jours saisis ÷ nombre de jours saisis (objectif : {goalKcal} kcal).
						</div>
					{:else}
						<p class="mt-3 rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-mist">Aucune donnée de journal sur les 7 derniers jours.</p>
					{/if}
				</div>

				{#if weightPoints && weightPoints.coords.length > 0}
					<div class="rounded-2xl border border-line bg-card px-5 py-4 shadow-sm">
						<div class="flex flex-wrap items-center justify-between gap-2">
							<h3 class="font-display text-base font-semibold text-ink">📉 Tendance du poids</h3>
							<span class="text-[11px] text-mist">{weightPoints.coords.length} prise(s) · {String(weightPoints.min).replace('.', ',')} → {String(weightPoints.max).replace('.', ',')} kg</span>
						</div>
						<div class="mt-3 overflow-x-auto">
							<svg viewBox="0 0 700 180" class="h-auto w-full min-w-[520px]" role="img" aria-label="Courbe du poids">
								<defs>
									<linearGradient id="wgrad" x1="0" y1="0" x2="0" y2="1">
										<stop offset="0%" stop-color="#1db954" stop-opacity="0.25" />
										<stop offset="100%" stop-color="#1db954" stop-opacity="0" />
									</linearGradient>
								</defs>
								{#if weightPoints.coords.length > 1}
									<polygon
										points={`${weightPoints.coords.map((p) => `${p.x},${p.y}`).join(' ')} ${weightPoints.coords[weightPoints.coords.length - 1].x},168 ${weightPoints.coords[0].x},168`}
										fill="url(#wgrad)"
										class="chart-fade"
									/>
									<polyline points={weightPoints.coords.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#1db954" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="chart-line" />
								{/if}
								{#each weightPoints.coords as p}
									<circle cx={p.x} cy={p.y} r="5" fill="#1db954" stroke="#fff" stroke-width="2" class="chart-dot">
										<title>{fmtDateShort(p.date)} : {String(p.weightKg).replace('.', ',')} kg</title>
									</circle>
									<text x={p.x} y={p.y - 11} text-anchor="middle" font-size="11.5" font-weight="600" fill="#111110">{String(p.weightKg).replace('.', ',')}</text>
									<text x={p.x} y="176" text-anchor="middle" font-size="10.5" fill="#999990">{fmtDateShort(p.date)}</text>
								{/each}
							</svg>
						</div>
					</div>
				{/if}

				<!-- Objectifs journaliers -->
				<div class="rounded-2xl border border-line bg-card px-5 py-4 shadow-sm">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<h3 class="font-display text-base font-semibold text-ink">🎯 Objectifs journaliers</h3>
						<span class="text-[11px] text-mist">Affichés dans le Journal de {selected.user.prenom}</span>
					</div>
					{#key selected.user._id}
						<form method="POST" action="?/setGoals" class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
							<input type="hidden" name="userId" value={selected.user._id} />
							<label class="block">
								<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Calories / jour</span>
								<input type="number" name="kcal" required min="800" max="6000" step="50" value={view.goals?.kcal ?? 2000} class="w-full rounded-lg border-2 border-line px-2 py-2 text-sm outline-none focus:border-brand" />
							</label>
							<label class="block">
								<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Glucides (g)</span>
								<input type="number" name="carbs" required min="0" max="1000" step="5" value={view.goals?.carbs ?? 250} class="w-full rounded-lg border-2 border-line px-2 py-2 text-sm outline-none focus:border-brand" />
							</label>
							<label class="block">
								<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Protéines (g)</span>
								<input type="number" name="protein" required min="0" max="400" step="5" value={view.goals?.protein ?? 90} class="w-full rounded-lg border-2 border-line px-2 py-2 text-sm outline-none focus:border-brand" />
							</label>
							<label class="block">
								<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Lipides (g)</span>
								<input type="number" name="fat" required min="0" max="300" step="5" value={view.goals?.fat ?? 65} class="w-full rounded-lg border-2 border-line px-2 py-2 text-sm outline-none focus:border-brand" />
							</label>
							<button type="submit" class="col-span-2 mt-2 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark sm:col-span-4">Enregistrer les objectifs</button>
						</form>
					{/key}
				</div>

			<!-- ═══ Journal alimentaire : la coach agit en doublon ═══ -->
			{:else if section === 'journal'}
				<div class="rounded-2xl border border-line bg-card px-5 py-4 shadow-sm">
					<div class="flex flex-wrap items-center justify-between gap-3">
						<h3 class="font-display text-base font-semibold text-ink">📔 Journal alimentaire de {selected.user.prenom}</h3>
						<div class="flex items-center gap-2">
							<input type="date" bind:value={journalDate} class="rounded-lg border-2 border-line px-2 py-1.5 text-sm outline-none focus:border-brand" />
							<button onclick={loadDay} class="rounded-lg bg-ink px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-brand">Charger</button>
						</div>
					</div>
					<p class="mt-1 text-[11px] text-mist">Tu peux consulter et compléter le journal de ta cliente — « en doublon » avec elle.</p>

					{#if journalMsg && !day}
						<p class="mt-3 rounded-lg bg-danger-light px-3 py-2 text-xs font-semibold text-danger">{journalMsg}</p>
					{/if}

					{#if day}
						<div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
							<div class="rounded-xl bg-line/40 px-3 py-2 text-center">
								<div class="text-[10px] font-bold uppercase tracking-wider text-mist">Calories</div>
								<div class="font-display text-lg font-semibold text-ink">{Math.round(day.totals.kcal)} <span class="text-xs text-mist">/ {day.goals.kcal}</span></div>
							</div>
							<div class="rounded-xl bg-line/40 px-3 py-2 text-center">
								<div class="text-[10px] font-bold uppercase tracking-wider text-mist">Glucides</div>
								<div class="font-display text-lg font-semibold text-ink">{Math.round(day.totals.carbs)} g</div>
							</div>
							<div class="rounded-xl bg-line/40 px-3 py-2 text-center">
								<div class="text-[10px] font-bold uppercase tracking-wider text-mist">Protéines</div>
								<div class="font-display text-lg font-semibold text-ink">{Math.round(day.totals.protein)} g</div>
							</div>
							<div class="rounded-xl bg-line/40 px-3 py-2 text-center">
								<div class="text-[10px] font-bold uppercase tracking-wider text-mist">Lipides</div>
								<div class="font-display text-lg font-semibold text-ink">{Math.round(day.totals.fat)} g</div>
							</div>
						</div>

						{#each MEALS as meal}
							<div class="mt-4">
								<div class="flex items-center justify-between border-b border-line pb-1.5">
									<h4 class="font-display text-sm font-semibold text-ink">{meal.label}</h4>
									<button
										onclick={() => {
											addMeal = meal.id;
											searchOpen = true;
										}}
										class="rounded-lg border-2 border-line px-2 py-1 text-xs font-semibold text-ink transition hover:border-brand hover:text-brand"
									>＋ Ajouter</button>
								</div>
								{#if (day.entries ?? []).filter((e) => e.meal === meal.id).length === 0}
									<p class="py-2 text-xs italic text-mist">Rien pour ce repas.</p>
								{:else}
									<ul class="divide-y divide-line/60">
										{#each day.entries.filter((e) => e.meal === meal.id) as entry (entry._id)}
											<li class="flex items-center gap-3 py-2">
												{#if entry.imageUrl}
													<img src={entry.imageUrl} alt="" class="h-9 w-9 shrink-0 rounded-lg object-cover" />
												{:else}
													<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-line/60 text-sm">🍽️</div>
												{/if}
												<div class="min-w-0 flex-1">
													<div class="truncate text-sm font-semibold text-ink">{entry.name}</div>
													<div class="text-[11px] text-mist">{entry.kcal} kcal · G {entry.carbs} · P {entry.protein} · L {entry.fat}</div>
												</div>
												<div class="flex items-center gap-1">
													<button onclick={() => setQty(entry, Math.max(1, entry.qtyGrams - 10))} class="h-7 w-7 rounded-lg border-2 border-line text-sm font-bold text-ink hover:border-brand">−</button>
													<span class="w-16 text-center text-sm font-semibold text-ink">{entry.qtyGrams} g</span>
													<button onclick={() => setQty(entry, entry.qtyGrams + 10)} class="h-7 w-7 rounded-lg border-2 border-line text-sm font-bold text-ink hover:border-brand">＋</button>
													<button onclick={() => removeEntry(entry)} class="ml-1 rounded-lg border-2 border-line px-2 py-1 text-xs text-danger hover:border-danger" title="Supprimer">🗑</button>
												</div>
											</li>
										{/each}
									</ul>
								{/if}
							</div>
						{/each}
					{:else if !journalBusy}
						<p class="mt-4 rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-mist">Clique sur « Charger » pour afficher la journée.</p>
					{/if}
				</div>

				{#if searchOpen}
					<button type="button" class="fixed inset-0 z-[60] cursor-pointer bg-ink/50" aria-label="Fermer la recherche" onclick={() => (searchOpen = false)}></button>
					<div class="fixed inset-x-0 bottom-0 z-[60] mx-auto w-full max-w-2xl rounded-t-3xl border-t border-line bg-card p-5 shadow-2xl sm:inset-y-0 sm:right-0 sm:left-auto sm:w-96 sm:rounded-l-3xl sm:rounded-tr-none sm:rounded-br-none sm:border-l">
						<div class="flex items-center justify-between">
							<h4 class="font-display text-base font-semibold text-ink">＋ Ajouter un aliment</h4>
							<button onclick={() => (searchOpen = false)} class="rounded-lg px-2 py-1 text-lg text-mist hover:text-ink">✕</button>
						</div>
						<div class="mt-3 flex gap-2">
							<input
								type="search"
								bind:value={searchQ}
								placeholder="Rechercher un aliment (ex. riz)…"
								class="flex-1 rounded-xl border-2 border-line px-3 py-2 text-sm outline-none focus:border-brand"
								onkeydown={(e) => e.key === 'Enter' && doSearch()}
							/>
							<button onclick={doSearch} disabled={searchBusy} class="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">{searchBusy ? '…' : 'Chercher'}</button>
						</div>
						<div class="mt-3 flex items-center gap-3">
							<label class="block">
								<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Repas</span>
								<select bind:value={addMeal} class="rounded-lg border-2 border-line px-2 py-1.5 text-sm outline-none focus:border-brand">
									{#each MEALS as m}
										<option value={m.id}>{m.label}</option>
									{/each}
								</select>
							</label>
							<label class="block">
								<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Quantité (g)</span>
								<input type="number" bind:value={addQty} min="1" max="5000" class="w-24 rounded-lg border-2 border-line px-2 py-1.5 text-sm outline-none focus:border-brand" />
							</label>
						</div>
						<div class="mt-3 max-h-[50vh] space-y-1 overflow-y-auto">
							{#if searchHits.length === 0}
								<p class="py-6 text-center text-xs text-mist">Tape au moins 2 lettres pour chercher dans la base.</p>
							{:else}
								{#each searchHits as hit (hit._id)}
									<button
										onclick={() => addFood(hit)}
										class="flex w-full items-center gap-3 rounded-xl border border-line bg-white px-3 py-2 text-left transition hover:border-brand"
									>
										{#if hit.imageUrl}
											<img src={hit.imageUrl} alt="" class="h-9 w-9 shrink-0 rounded-lg object-cover" />
										{:else}
											<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-line/60 text-sm">🍎</div>
										{/if}
										<div class="min-w-0 flex-1">
											<div class="truncate text-sm font-semibold text-ink">{hit.name}</div>
											<div class="text-[11px] text-mist">{hit.kcal100} kcal/100 g{hit.brand ? ` · ${hit.brand}` : ''}</div>
										</div>
										<span class="text-brand">＋</span>
									</button>
								{/each}
							{/if}
						</div>
					</div>
				{/if}

			<!-- ═══ Poids & mensurations ═══ -->
			{:else if section === 'corps'}
				<div class="rounded-2xl border border-line bg-card px-5 py-4 shadow-sm">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<h3 class="font-display text-base font-semibold text-ink">📏 Poids & mensurations de {selected.user.prenom}</h3>
						<span class="text-[11px] text-mist">Modifications visibles côté cliente.</span>
					</div>
					<div class="mt-4 grid gap-3 sm:grid-cols-3">
						<div class="rounded-xl border border-line p-3">
							<label class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist" for="m-date">Date</label>
							<input id="m-date" type="date" bind:value={mDate} class="w-full rounded-lg border-2 border-line px-2 py-1.5 text-sm outline-none focus:border-brand" />
						</div>
						<div class="rounded-xl border border-line p-3">
							<label class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist" for="m-weight">Poids (kg)</label>
							<input id="m-weight" type="number" min="30" max="350" step="0.1" bind:value={mWeight} placeholder="Ex. 62" class="w-full rounded-lg border-2 border-line px-2 py-1.5 text-sm outline-none focus:border-brand" />
						</div>
						<div class="rounded-xl border border-line p-3">
							<label class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist" for="m-waist">Tour de taille (cm)</label>
							<input id="m-waist" type="number" min="40" max="250" step="0.1" bind:value={mWaist} placeholder="Ex. 68" class="w-full rounded-lg border-2 border-line px-2 py-1.5 text-sm outline-none focus:border-brand" />
						</div>
						<div class="rounded-xl border border-line p-3">
							<label class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist" for="m-hip">Fessiers (cm)</label>
							<input id="m-hip" type="number" min="50" max="300" step="0.1" bind:value={mHip} placeholder="Ex. 98" class="w-full rounded-lg border-2 border-line px-2 py-1.5 text-sm outline-none focus:border-brand" />
						</div>
						<div class="rounded-xl border border-line p-3">
							<label class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist" for="m-neck">Tour de cou (cm)</label>
							<input id="m-neck" type="number" min="20" max="80" step="0.1" bind:value={mNeck} placeholder="Ex. 33" class="w-full rounded-lg border-2 border-line px-2 py-1.5 text-sm outline-none focus:border-brand" />
						</div>
						<div class="flex items-end">
							<button onclick={saveMeasurement} disabled={mBusy} class="w-full rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
								{mBusy ? 'Enregistrement…' : 'Enregistrer la prise'}
							</button>
						</div>
					</div>
					{#if mMsg}
						<p class="mt-3 rounded-lg bg-brand-light px-3 py-2 text-xs font-semibold text-ink">{mMsg}</p>
					{/if}

					<div class="mt-5">
						<h4 class="font-display text-sm font-semibold text-ink">Historique des prises</h4>
						{#if measurements.length === 0}
							<p class="mt-2 text-xs italic text-mist">Aucune prise enregistrée pour l’instant.</p>
						{:else}
							<div class="mt-2 overflow-x-auto">
								<table class="w-full min-w-[560px] text-left text-sm">
									<thead>
										<tr class="border-b border-line text-[11px] font-bold uppercase tracking-wider text-mist">
											<th class="py-2 pr-3">Date</th>
											{#each metricKeys as mk}
												<th class="px-2 py-2">{mk.label}</th>
											{/each}
											<th class="py-2 text-right">Actions</th>
										</tr>
									</thead>
									<tbody>
										{#each [...measurements].reverse() as m (m._id)}
											<tr class="border-b border-line/50">
												<td class="whitespace-nowrap py-2 pr-3 font-semibold text-ink">{fmtDateShort(m.date)}</td>
												{#each metricKeys as mk}
													<td class="px-2 py-2 text-ink">
														{#if m[mk.key] != null}
															<span class="inline-flex items-center gap-1">
																{String(m[mk.key]).replace('.', ',')}
																<button
																	onclick={() => deleteMetric(m.date, mk.key)}
																	class="text-xs text-danger/70 hover:text-danger"
																	title="Supprimer cette valeur"
																>🗑</button>
															</span>
														{:else}
															<span class="text-mist">—</span>
														{/if}
													</td>
												{/each}
												<td class="py-2 text-right">
													<button
														onclick={() => {
															mDate = m.date;
															mWeight = m.weightKg != null ? String(m.weightKg) : '';
															mWaist = m.waistCm != null ? String(m.waistCm) : '';
															mHip = m.hipCm != null ? String(m.hipCm) : '';
															mNeck = m.neckCm != null ? String(m.neckCm) : '';
															window.scrollTo({ top: 0, behavior: 'smooth' });
														}}
														class="rounded-lg border-2 border-line px-2 py-1 text-xs font-semibold text-ink transition hover:border-brand hover:text-brand"
													>Modifier</button>
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}
					</div>
				</div>

			<!-- ═══ Photos de suivi ═══ -->
			{:else if section === 'photos'}
				<div class="rounded-2xl border border-line bg-card px-5 py-4 shadow-sm">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<h3 class="font-display text-base font-semibold text-ink">📸 Photos de suivi de {selected.user.prenom}</h3>
						<span class="text-[11px] text-mist">{photos.length} série(s) · {totalPhotos} photo(s) — conservées définitivement</span>
					</div>
					{#if photos.length === 0}
						<p class="mt-3 rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-mist">
							Aucune photo reçue pour l’instant. Quand {selected.user.prenom} envoie une série, elle apparaît ici.
						</p>
					{:else}
						{#each photos as group (group._id)}
							<div class="mt-4">
								<div class="flex flex-wrap items-center gap-2">
									<span class="rounded-full bg-brand-light px-3 py-1 text-xs font-bold text-brand-dark">{PHOTO_STEP_LABELS[group.step] ?? group.step}</span>
									<span class="text-xs text-mist">reçue le {fmtDateShort(group.date)}</span>
								</div>
								<div class="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
									{#each group.photos as photo}
										<figure class="overflow-hidden rounded-xl border border-line bg-white">
											{#if photo.url}
												<a href={photo.url} target="_blank" rel="noreferrer">
													<img src={photo.url} alt={photo.label} class="h-44 w-full object-cover transition hover:scale-105" loading="lazy" />
												</a>
											{:else}
												<div class="flex h-44 items-center justify-center bg-line/40 text-sm text-mist">Image indisponible</div>
											{/if}
											<figcaption class="truncate px-2 py-1 text-[11px] text-mist">{photo.label}</figcaption>
										</figure>
									{/each}
								</div>
							</div>
						{/each}
					{/if}
				</div>

			<!-- ═══ Bilans ═══ -->
			{:else if section === 'bilans'}
				<div class="space-y-4">
					{#if checkins.length === 0}
						<div class="rounded-2xl border border-dashed border-line bg-card px-6 py-10 text-center">
							<p class="text-2xl">🗓️</p>
							<p class="mt-2 text-sm text-ink">Aucun bilan reçu pour {selected.user.prenom} pour l’instant.</p>
							<p class="mt-1 text-xs text-mist">Transmets ses identifiants (email + mot de passe) pour qu’elle commence son suivi.</p>
						</div>
					{:else}
						{#each checkins as checkin (checkin._id)}
							<BilanCard checkin={checkin} clientName={selected.user.prenom} clientId={selected.user._id} />
						{/each}
					{/if}
				</div>
			{/if}
		</div>
	</aside>
{:else if !selected}
	<div class="mt-6 rounded-2xl border border-dashed border-line bg-card px-6 py-14 text-center">
		<p class="text-3xl">👋</p>
		<p class="mt-3 text-sm text-ink">Crée un compte client pour démarrer le suivi.</p>
	</div>
{/if}

<style>
	.chart-bar {
		transform-origin: bottom;
		animation: barGrow 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) both;
	}
	@keyframes barGrow {
		from {
			transform: scaleY(0);
			opacity: 0;
		}
		to {
			transform: scaleY(1);
			opacity: 1;
		}
	}
	.chart-line {
		stroke-dasharray: 1400;
		stroke-dashoffset: 1400;
		animation: lineDraw 1.2s ease forwards;
	}
	@keyframes lineDraw {
		to {
			stroke-dashoffset: 0;
		}
	}
	.chart-fade {
		opacity: 0;
		animation: fadeIn 0.9s 0.5s ease forwards;
	}
	.chart-dot {
		opacity: 0;
		animation: dotPop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 0.9s forwards;
	}
	@keyframes dotPop {
		from {
			opacity: 0;
			transform: scale(0);
			transform-box: fill-box;
			transform-origin: center;
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}
	@keyframes fadeIn {
		to {
			opacity: 1;
		}
	}
	.chart-goal-tick {
		opacity: 0.55;
	}
</style>