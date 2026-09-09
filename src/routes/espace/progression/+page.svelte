<script lang="ts">
	import { onMount } from 'svelte';
	import MetricTrend from '../../../lib/components/MetricTrend.svelte';
	import BackToHome from '../../../lib/components/BackToHome.svelte';
	import Icon from '../../../lib/components/Icon.svelte';

	type Measurement = {
		_id: string;
		date: string;
		weightKg?: number;
		neckCm?: number;
		waistCm?: number;
		hipCm?: number;
	};

	type Metric = 'weightKg' | 'neckCm' | 'waistCm' | 'hipCm';
	type Group = 'weight' | 'mensurations';

	const METRIC_META: { key: Metric; label: string; sub: string; unit: string; icon: string; color: string; group: Group }[] = [
		{ key: 'weightKg', label: 'POIDS', sub: 'Poids', unit: 'kg', icon: 'scale', color: '#1db954', group: 'weight' },
		{ key: 'waistCm', label: 'TOUR DE TAILLE', sub: 'Partie la plus fine', unit: 'cm', icon: 'ruler', color: '#f97316', group: 'mensurations' },
		{ key: 'hipCm', label: 'FESSIERS', sub: 'Circonférence', unit: 'cm', icon: 'ruler', color: '#ec4899', group: 'mensurations' },
		{ key: 'neckCm', label: 'TOUR DE COU', sub: 'Circonférence', unit: 'cm', icon: 'ruler', color: '#3b82f6', group: 'mensurations' },
	];

	let heightCm = $state<number | null>(null);
	let measurements = $state<Measurement[]>([]);
	let bodyFat = $state<{ date: string; value: number }[]>([]);
	let loading = $state(true);
	let error = $state('');
	let saving = $state(false);

	/* ————— Chargement ————— */
	async function load() {
		loading = true;
		error = '';
		try {
			const r = await fetch('/api/metrics');
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			heightCm = j.heightCm ?? null;
			measurements = j.measurements ?? [];
			// Masse grasse : calcul centralisé côté Convex (même source que le CRM).
			bodyFat = j.bodyFat ?? [];
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		load();
		// Lien direct depuis le dashboard : « Ajouter mes mensurations »
		// ouvre directement la feuille de saisie des mensurations.
		const params = new URLSearchParams(window.location.search);
		if (params.get('action') === 'mensurations') {
			openLog('mensurations');
		}
	});

	/* ————— Séries par métrique ————— */
	function series(key: Metric): { date: string; value: number }[] {
		return measurements
			.filter((m) => m[key] !== undefined && m[key] !== null)
			.map((m) => ({ date: m.date, value: m[key] as number }))
			.sort((a, b) => a.date.localeCompare(b.date));
	}
	function longDate(iso: string) {
		const d = new Date(iso + 'T12:00:00');
		return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
	}
	function delta(rows: { value: number }[]) {
		if (rows.length < 2) return null;
		return Math.round((rows[rows.length - 1].value - rows[0].value) * 10) / 10;
	}
	function fmt(n: number) {
		return n.toLocaleString('fr-FR');
	}
	function todayISO() {
		const d = new Date();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}

	/* ————— Vue détail d'une métrique (courbe + historique) ————— */
	let detailKey = $state<Metric | null>(null);
	const detailMeta = $derived(METRIC_META.find((m) => m.key === detailKey) ?? null);
	const detailRows = $derived(detailKey ? series(detailKey) : []);
	const detailLast = $derived(detailRows.length ? detailRows[detailRows.length - 1].value : null);
	const detailDelta = $derived(delta(detailRows));
	function openDetail(key: Metric) {
		detailKey = key;
	}

	/* ————— Masse grasse estimée (US Navy femme — lecture seule) —————
	   Les points viennent du calcul CENTRALISÉ côté Convex (metrics.list) :
	   exactement la même source que la Vision 360 du CRM. Un point n'existe
	   que lorsqu'un MÊME relevé contient tour de taille + fessiers + tour de
	   cou + la taille du profil — une pesée seule ne crée jamais d'estimation. */
	const BF_COLOR = '#a855f7';

	const bfRows = $derived(bodyFat);
	const bfLast = $derived(bodyFat.length ? bodyFat[bodyFat.length - 1].value : null);
	const bfDelta = $derived(delta(bodyFat));
	let bfDetail = $state(false);

	/* ————— Feuilles d'enregistrement (poids seul / mensurations groupées) ————— */
	let logType = $state<Group | null>(null);
	let logDate = $state('');
	// poids
	let wWeight = $state('');
	// mensurations
	let mWaist = $state('');
	let mHip = $state('');
	let mNeck = $state('');
	let logError = $state('');

	function openLog(group: Group) {
		logType = group;
		logDate = todayISO();
		logError = '';
		if (group === 'weight') {
			wWeight = '';
		} else {
			mWaist = '';
			mHip = '';
			mNeck = '';
		}
	}
	const numOr = (v: string) => {
		const n = parseFloat(v.replace(',', '.'));
		return v.trim() === '' || !isFinite(n) ? undefined : n;
	};
	async function submitLog() {
		const body: Record<string, unknown> = { date: logDate };
		if (logType === 'weight') {
			body.weightKg = numOr(wWeight);
			if (body.weightKg === undefined) {
				logError = 'Saisis ton poids.';
				return;
			}
		} else {
			body.waistCm = numOr(mWaist);
			body.hipCm = numOr(mHip);
			body.neckCm = numOr(mNeck);
			if (body.waistCm === undefined && body.hipCm === undefined && body.neckCm === undefined) {
				logError = 'Saisis au moins une mensuration.';
				return;
			}
		}
		saving = true;
		logError = '';
		try {
			const r = await fetch('/api/metrics', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			logType = null;
			await load();
		} catch (e) {
			logError = e instanceof Error ? e.message : String(e);
		} finally {
			saving = false;
		}
	}

	/* ————— Édition / suppression d'une valeur (depuis la courbe) ————— */
	let edit = $state<{ metric: Metric; date: string } | null>(null);
	let editValue = $state('');
	let editError = $state('');
	let editSaving = $state(false);
	const editMeta = $derived(edit ? METRIC_META.find((m) => m.key === edit?.metric) ?? null : null);

	function openEdit(metric: Metric, date: string, value: number) {
		edit = { metric, date };
		editValue = String(value);
		editError = '';
	}
	async function saveEdit() {
		if (!edit) return;
		const val = parseFloat(editValue.replace(',', '.'));
		if (!isFinite(val) || editValue.trim() === '') {
			editError = 'Saisis une valeur valide.';
			return;
		}
		editSaving = true;
		editError = '';
		try {
			const r = await fetch('/api/metrics', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ date: edit.date, metric: edit.metric, value: val }),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			edit = null;
			await load();
		} catch (e) {
			editError = e instanceof Error ? e.message : String(e);
		} finally {
			editSaving = false;
		}
	}
	async function deleteEdit() {
		if (!edit) return;
		editSaving = true;
		editError = '';
		try {
			const r = await fetch(`/api/metrics?date=${edit.date}&metric=${edit.metric}`, { method: 'DELETE' });
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			edit = null;
			await load();
		} catch (e) {
			editError = e instanceof Error ? e.message : String(e);
		} finally {
			editSaving = false;
		}
	}

	/* ————— Taille ————— */
	let heightEdit = $state(false);
	let heightInput = $state('');
	let heightError = $state('');
	function openHeight() {
		heightInput = heightCm !== null ? String(heightCm) : '';
		heightEdit = true;
		heightError = '';
	}
	async function saveHeight() {
		const h = parseFloat(heightInput.replace(',', '.'));
		if (!isFinite(h) || h < 80 || h > 250) {
			heightError = 'Entre une taille valide (80 à 250 cm).';
			return;
		}
		saving = true;
		heightError = '';
		try {
			const r = await fetch('/api/metrics', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ heightCm: h }),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			heightCm = h;
			heightEdit = false;
		} catch (e) {
			heightError = e instanceof Error ? e.message : String(e);
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head><title>Ma progression — G-Flux</title></svelte:head>

{#if detailKey !== null && detailMeta}
	<!-- ═══════════ Vue détail d'une métrique ═══════════ -->
	<div class="mx-auto w-full max-w-xl px-4 pb-28 pt-4 sm:px-6">
		<div class="mb-3 flex items-center gap-1 text-sm font-semibold text-mist">
			<button type="button" class="flex min-h-9 items-center gap-1 rounded-lg pr-2 transition hover:text-ink" onclick={() => (detailKey = null)}><Icon name="chevronLeft" size={16} /> Retour</button>
			<span class="text-mist/50" aria-hidden="true">·</span>
			<a href="/espace" class="flex min-h-9 items-center gap-1 rounded-lg px-1 transition hover:text-ink"><Icon name="arrowLeft" size={16} /> Accueil</a>
		</div>
		<h1 class="font-display text-2xl font-semibold text-ink">{detailMeta.sub}</h1>
		<p class="mt-1 text-sm text-mist">Touche une date pour corriger ou supprimer une valeur.</p>

		<section class="mt-4 rounded-2xl border border-line bg-card p-3 shadow-sm">
			{#if detailRows.length >= 2}
				<MetricTrend points={detailRows} color={detailMeta.color} unit={detailMeta.unit} height={220} width={600} />
			{:else if detailRows.length === 1 && detailLast !== null}
				<div class="px-4 py-6 text-center">
					<p class="text-sm font-semibold text-ink">{fmt(Math.round(detailLast * 10) / 10)} {detailMeta.unit}</p>
					<p class="mt-1 text-xs text-mist">1 mesure enregistrée — la tendance apparaîtra après une prochaine mesure.</p>
				</div>
			{:else}
				<div class="px-4 py-12 text-center">
					<p class="text-sm text-mist">Aucune donnée pour {detailMeta.sub.toLowerCase()}.</p>
				</div>
			{/if}
		</section>

		{#if detailLast !== null}
			<div class="mt-4 text-center">
				<p class="font-display text-4xl font-semibold text-ink">{fmt(Math.round(detailLast * 10) / 10)} <span class="text-base font-semibold text-mist">{detailMeta.unit}</span></p>
				{#if detailDelta !== null}
					<p class="mt-1 text-sm text-mist">
						{detailDelta <= 0 ? '↓' : '↑'} {fmt(Math.abs(detailDelta))} {detailMeta.unit} depuis ta première prise
					</p>
				{/if}
			</div>
		{/if}

		<button type="button" class="mt-5 w-full rounded-full bg-ink py-3.5 text-sm font-bold text-white transition hover:bg-ink/90" onclick={() => openLog(detailMeta.group)}>
			Enregistrer une valeur
		</button>

		<!-- Historique -->
		<section class="mt-5 rounded-2xl border border-line bg-card shadow-sm">
			<h2 class="border-b border-line px-4 py-3 font-display text-sm font-semibold text-ink">Historique</h2>
			{#if detailRows.length === 0}
				<p class="px-4 py-8 text-center text-sm text-mist">Aucune prise enregistrée — ajoute-en une avec « Enregistrer une valeur ».</p>
			{:else}
				<ul class="divide-y divide-line/70">
					{#each detailRows as r (r.date)}
						<li class="flex items-center gap-2 px-2 py-1">
							<button type="button" class="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-line/40" onclick={() => openEdit(detailMeta.key, r.date, r.value)}>
								<span class="text-sm font-semibold text-ink">{longDate(r.date)}</span>
								<span class="text-sm font-bold text-ink">{fmt(Math.round(r.value * 10) / 10)} {detailMeta.unit}</span>
							</button>
							<button type="button" class="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm text-mist transition hover:bg-danger-light hover:text-danger" aria-label={`Modifier ${longDate(r.date)}`} onclick={() => openEdit(detailMeta.key, r.date, r.value)}>✎</button>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>	{:else if bfDetail}
	<!-- ═══════════ Vue détail : masse grasse estimée (lecture seule) ═══════════ -->
	<div class="mx-auto w-full max-w-xl px-4 pb-28 pt-4 sm:px-6">
		<div class="mb-3 flex items-center gap-1 text-sm font-semibold text-mist">
			<button type="button" class="flex min-h-9 items-center gap-1 rounded-lg pr-2 transition hover:text-ink" onclick={() => (bfDetail = false)}><Icon name="chevronLeft" size={16} /> Retour</button>
			<span class="text-mist/50" aria-hidden="true">·</span>
			<a href="/espace" class="flex min-h-9 items-center gap-1 rounded-lg px-1 transition hover:text-ink"><Icon name="arrowLeft" size={16} /> Accueil</a>
		</div>
		<h1 class="font-display text-2xl font-semibold text-ink">Masse grasse estimée</h1>
		<p class="mt-1 text-sm text-mist">Estimation indicative calculée avec la méthode US Navy — elle n'est pas modifiable.</p>

		<section class="mt-4 rounded-2xl border border-line bg-card p-3 shadow-sm">
			{#if bfRows.length >= 2}
				<MetricTrend points={bfRows} color={BF_COLOR} unit="%" height={220} width={600} />
			{:else if bfRows.length === 1 && bfLast !== null}
				<div class="px-4 py-6 text-center">
					<p class="text-sm font-semibold text-ink">{fmt(bfLast)} %</p>
					<p class="mt-1 text-xs text-mist">1 estimation — la tendance apparaîtra après une prochaine mesure.</p>
				</div>
			{:else}
				<div class="px-4 py-12 text-center">
					<p class="text-sm text-mist">Renseigne ta taille et tes mensurations pour obtenir ton estimation.</p>
				</div>
			{/if}
		</section>

		{#if bfLast !== null}
			<div class="mt-4 text-center">
				<p class="font-display text-4xl font-semibold text-ink">{fmt(bfLast)} <span class="text-base font-semibold text-mist">%</span></p>
				{#if bfDelta !== null}
					<p class="mt-1 text-sm text-mist">{bfDelta <= 0 ? '↓' : '↑'} {fmt(Math.abs(bfDelta))} % depuis ta première estimation</p>
				{/if}
			</div>
		{/if}

		<!-- Historique (lecture seule — pas de correction possible) -->
		<section class="mt-5 rounded-2xl border border-line bg-card shadow-sm">
			<h2 class="border-b border-line px-4 py-3 font-display text-sm font-semibold text-ink">Historique des estimations</h2>
			{#if bfRows.length === 0}
				<p class="px-4 py-8 text-center text-sm text-mist">Aucune estimation pour l'instant — elle apparaîtra dès qu'un relevé de mensurations complet (taille, tour de taille, fessiers, tour de cou) est enregistré.</p>
			{:else}
				<ul class="divide-y divide-line/70 px-2 py-1">
					{#each bfRows as r (r.date)}
						<li class="flex items-center gap-2 px-2 py-2.5">
							<span class="min-w-0 flex-1 text-sm font-semibold text-ink">{longDate(r.date)}</span>
							<span class="text-sm font-bold text-ink">{fmt(r.value)} %</span>
						</li>
					{/each}
				</ul>
				<p class="border-t border-line px-4 py-3 text-xs text-mist">Estimation indicative — méthode US Navy, calculée automatiquement depuis tes mensurations.</p>
			{/if}
		</section>
	</div>
	{:else}
	<!-- ═══════════ Vue principale ═══════════ -->
	<div class="mx-auto w-full max-w-xl px-4 pb-28 pt-4 sm:px-6">
		<BackToHome label="Ma progression" />
		<h1 class="font-display text-2xl font-semibold text-ink">Ma progression <Icon name="trendingUp" size={22} class="inline -mt-1 text-brand" /></h1>
		<p class="mt-1 text-sm text-mist">Poids, mensurations et masse grasse estimée — touche une courbe pour la détailler.</p>

		{#if error}
			<div class="mt-4 rounded-xl border-2 border-danger bg-danger-light px-4 py-3 text-sm text-danger">{error}</div>
		{/if}

		<!-- Carte taille -->
		<section class="mt-5 rounded-2xl border border-line bg-card p-4 shadow-sm">
			<div class="flex items-center justify-between gap-3">
				<div class="flex items-center gap-3">
					<div class="grid h-11 w-11 place-items-center rounded-xl bg-brand-light"><Icon name="ruler" size={22} class="text-brand" /></div>
					<div>
						<p class="text-[11px] font-bold uppercase tracking-wide text-mist">Taille</p>
						<p class="font-display text-xl font-semibold text-ink">{heightCm !== null ? `${fmt(heightCm)} cm` : 'Non renseignée'}</p>
					</div>
				</div>
				<button type="button" class="rounded-full border-2 border-line px-4 py-2 text-xs font-bold text-ink transition hover:border-brand hover:text-brand" onclick={openHeight}>{heightCm !== null ? 'Modifier' : 'Ajouter'}</button>
			</div>
			<p class="mt-2 text-xs text-mist">La taille est renseignée une seule fois — elle reste associée à ton profil.</p>
		</section>

		<!-- Cartes métriques -->
		{#each METRIC_META as meta (meta.key)}
			{@const rows = series(meta.key)}
			{@const d = delta(rows)}
			{@const last = rows[rows.length - 1]?.value ?? null}
			<section class="mt-4 overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
				<div class="px-4 pt-4">
					<div class="flex items-start justify-between gap-3">
						<div>
							<p class="text-[11px] font-bold uppercase tracking-wide text-mist">{meta.label}</p>
							<div class="mt-1 flex items-center gap-2">
								<span class="font-display text-3xl font-semibold text-ink">
									{last !== null ? `${fmt(Math.round(last * 10) / 10)} ` : '— '}
									<span class="text-base font-semibold text-mist">{meta.unit}</span>
								</span>
								{#if d !== null}
									<span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold {d <= 0 ? 'bg-brand-light text-brand-dark' : 'bg-warn-light text-warn'}">
										{d <= 0 ? '↓' : '↑'} {fmt(Math.abs(d))} {meta.unit}
									</span>
								{/if}
							</div>
							<p class="mt-1 text-xs text-mist">{meta.sub}</p>
						</div>
						<Icon name={meta.icon} size={28} class="shrink-0 text-mist" />
					</div>
				</div>
				<div role="button" tabindex="0" aria-label={`Voir la courbe ${meta.sub}`} class="block w-full cursor-pointer px-3 pt-2 text-left outline-none" onclick={() => openDetail(meta.key)} onkeydown={(e) => { if (e.key === 'Enter') openDetail(meta.key); }}>
					{#if rows.length >= 2}
						<MetricTrend points={rows} color={meta.color} unit={meta.unit} height={110} />
					{:else if rows.length === 1}
						<div class="px-4 pb-4">
							<p class="flex items-start gap-1.5 text-xs text-mist"><Icon name="lightbulb" size={13} class="mt-0.5 shrink-0" /><span>Tendance disponible après une prochaine mesure.</span></p>
						</div>
					{:else}
						<div class="mx-3 mb-3 rounded-xl border-2 border-dashed border-line px-4 py-4 text-center">
							<p class="text-xs text-mist">Aucune prise enregistrée pour {meta.sub.toLowerCase()}.</p>
						</div>
					{/if}
				</div>
				<button type="button" class="flex w-full items-center justify-between border-t border-line px-4 py-3.5 text-sm font-semibold text-ink transition hover:bg-line/40" onclick={() => openLog(meta.group)}>
					<span>Enregistrer une valeur</span>
					<span class="text-mist">›</span>
				</button>
			</section>
		{/each}

		<!-- Carte masse grasse estimée (calcul automatique US Navy — lecture seule) -->
		<section class="mt-4 overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
			<div class="px-4 pt-4">
				<div class="flex items-start justify-between gap-3">
					<div>
						<p class="text-[11px] font-bold uppercase tracking-wide text-mist">% de masse grasse estimé</p>
						<div class="mt-1 flex items-center gap-2">
							<span class="font-display text-3xl font-semibold text-ink">
								{bfLast !== null ? `${fmt(bfLast)} %` : '—'}
							</span>
							{#if bfDelta !== null}
								<span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold {bfDelta <= 0 ? 'bg-brand-light text-brand-dark' : 'bg-warn-light text-warn'}">
									{bfDelta <= 0 ? '↓' : '↑'} {fmt(Math.abs(bfDelta))} %
								</span>
							{/if}
						</div>
						<p class="mt-1 text-xs text-mist">Estimation indicative — méthode US Navy</p>
					</div>
					<span class="grid place-items-center"><Icon name="target" size={22} class="text-brand" /></span>
				</div>
			</div>
			{#if bfRows.length >= 2}
				<div role="button" tabindex="0" aria-label="Voir l'historique de la masse grasse estimée" class="block w-full cursor-pointer px-3 pt-2 text-left outline-none" onclick={() => (bfDetail = true)} onkeydown={(e) => { if (e.key === 'Enter') bfDetail = true; }}>
					<MetricTrend points={bfRows} color={BF_COLOR} unit="%" height={110} />
				</div>
				<p class="flex items-start gap-1.5 border-t border-line px-4 py-3 text-xs text-mist"><Icon name="lightbulb" size={13} class="mt-0.5 shrink-0" /> <span>Calcul automatique depuis tes mensurations — impossible à modifier. Touche la courbe pour voir l'historique.</span></p>
			{:else if bfRows.length === 1}
				<div role="button" tabindex="0" aria-label="Voir l'historique de la masse grasse estimée" class="block w-full cursor-pointer px-3 pt-1 text-left outline-none" onclick={() => (bfDetail = true)} onkeydown={(e) => { if (e.key === 'Enter') bfDetail = true; }}>
					<p class="flex items-start gap-1.5 px-4 pb-4 text-xs text-mist"><Icon name="lightbulb" size={13} class="mt-0.5 shrink-0" /><span>Calcul automatique depuis tes mensurations — impossible à modifier. Tendance disponible après une prochaine mesure.</span></p>
				</div>
			{:else}
				<div class="px-3 pt-2">
					<div class="rounded-xl border-2 border-dashed border-line px-4 py-8 text-center">
						<p class="text-sm text-mist">Renseigne ta taille et tes mensurations (tour de taille, fessiers, tour de cou) pour obtenir ton estimation.</p>
					</div>
				</div>
				<p class="mt-2 flex items-start gap-1.5 border-t border-line px-4 py-3 text-xs text-mist"><Icon name="lightbulb" size={13} class="mt-0.5 shrink-0" /> <span>Estimation indicative — méthode US Navy, calculée automatiquement.</span></p>
			{/if}
		</section>

		<div class="mt-4 rounded-xl bg-warn-light px-4 py-3 text-xs leading-relaxed text-ink">				<span class="inline-flex items-start gap-1.5"><Icon name="lightbulb" size={13} class="mt-0.5 shrink-0" /><span><strong>Le conseil :</strong> pèse-toi le matin, à jeun, dans les mêmes conditions. La tendance compte plus qu'un chiffre isolé.</span></span>
		</div>

		<!-- Photos de progression (tout en bas) -->
		<section class="mt-4 rounded-2xl border border-line bg-card p-4 shadow-sm">
			<a href="/espace/photos" class="flex items-center justify-between gap-3">
				<div class="flex items-center gap-3">
					<div class="grid h-11 w-11 place-items-center rounded-xl bg-brand-light"><Icon name="camera" size={22} class="text-brand" /></div>
					<div>
						<p class="text-[11px] font-bold uppercase tracking-wide text-mist">Photos de progression</p>
						<p class="font-display text-lg font-semibold text-ink">Ajouter mes photos</p>
					</div>
				</div>
				<span class="text-lg text-mist">›</span>
			</a>
			<p class="mt-2 text-xs text-mist">Une série de photos par mois, pour voir les changements invisibles sur la balance. Une fois tes photos envoyées à chaque évolution, ton coach t'enverra la comparaison avant-après.</p>
		</section>
	</div>
{/if}

<!-- ═══════════ Feuille POIDS (unique) ═══════════ -->
{#if logType === 'weight'}
	<div role="presentation" class="fixed inset-0 z-[60] flex items-end justify-center bg-ink/40 backdrop-blur-sm sm:items-center sm:p-6" onclick={(e) => { if (e.target === e.currentTarget && !saving) logType = null; }} onkeydown={(e) => { if (e.key === 'Escape' && !saving) logType = null; }}>
		<div class="w-full max-w-lg rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl">
			<div class="flex items-center justify-between">
				<h2 class="font-display text-lg font-semibold text-ink">Enregistrer mon poids</h2>
				<button type="button" class="grid h-9 w-9 place-items-center rounded-full text-lg text-mist hover:bg-line/50" aria-label="Fermer" onclick={() => (logType = null)}>✕</button>
			</div>

			<label class="mt-4 block">
				<span class="mb-1 block text-[11px] font-bold uppercase tracking-wide text-mist">Date</span>
				<input id="metric-date" type="date" bind:value={logDate} class="w-full rounded-xl border-2 border-line bg-cream px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-brand" />
			</label>

			<div class="mt-4 rounded-xl border-2 border-brand bg-brand-light/30 p-3">
				<div class="flex items-center gap-2">
					<Icon name="scale" size={18} class="shrink-0 text-brand" />
					<span class="min-w-0 flex-1 text-sm font-semibold text-ink">Poids</span>
					<div class="w-28 text-center">
						<input type="text" inputmode="decimal" class="w-full bg-transparent text-center font-display text-2xl font-semibold text-ink outline-none" placeholder="—" bind:value={wWeight} />
					</div>
					<span class="w-8 text-sm text-mist">kg</span>
				</div>
			</div>

			{#if logError}
				<p class="mt-3 rounded-xl bg-danger-light px-3 py-2 text-sm text-danger">{logError}</p>
			{/if}

			<button type="button" class="mt-4 w-full rounded-full bg-ink py-3.5 text-sm font-bold text-white transition hover:bg-ink/90" disabled={saving} onclick={submitLog}>
				{saving ? 'Enregistrement…' : 'Enregistrer le poids'}
			</button>
		</div>
	</div>
{/if}

<!-- ═══════════ Feuille MENSURATIONS (groupées) ═══════════ -->
{#if logType === 'mensurations'}
	<div role="presentation" class="fixed inset-0 z-[60] flex items-end justify-center bg-ink/40 backdrop-blur-sm sm:items-center sm:p-6" onclick={(e) => { if (e.target === e.currentTarget && !saving) logType = null; }} onkeydown={(e) => { if (e.key === 'Escape' && !saving) logType = null; }}>
		<div class="w-full max-w-lg rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl">
			<div class="flex items-center justify-between">
				<h2 class="font-display text-lg font-semibold text-ink">Enregistrer mes mensurations</h2>
				<button type="button" class="grid h-9 w-9 place-items-center rounded-full text-lg text-mist hover:bg-line/50" aria-label="Fermer" onclick={() => (logType = null)}>✕</button>
			</div>

			<label class="mt-4 block">
				<span class="mb-1 block text-[11px] font-bold uppercase tracking-wide text-mist">Date</span>
				<input type="date" bind:value={logDate} class="w-full rounded-xl border-2 border-line bg-cream px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-brand" />
			</label>

			<div class="mt-4 flex flex-col gap-3">
				<label class="rounded-xl border-2 border-line bg-white p-3">
					<div class="flex items-center gap-2">
						<Icon name="ruler" size={18} class="shrink-0 text-brand" />
						<span class="min-w-0 flex-1 text-sm font-semibold text-ink">Tour de taille</span>
						<div class="w-24 text-center">
							<input type="text" inputmode="decimal" class="w-full bg-transparent text-center font-display text-xl font-semibold text-ink outline-none" placeholder="—" bind:value={mWaist} />
						</div>
						<span class="w-8 text-sm text-mist">cm</span>
					</div>
				</label>
				<label class="rounded-xl border-2 border-line bg-white p-3">
					<div class="flex items-center gap-2">
						<Icon name="ruler" size={18} class="shrink-0 text-brand" />
						<span class="min-w-0 flex-1 text-sm font-semibold text-ink">Fessiers</span>
						<div class="w-24 text-center">
							<input type="text" inputmode="decimal" class="w-full bg-transparent text-center font-display text-xl font-semibold text-ink outline-none" placeholder="—" bind:value={mHip} />
						</div>
						<span class="w-8 text-sm text-mist">cm</span>
					</div>
				</label>
				<label class="rounded-xl border-2 border-line bg-white p-3">
					<div class="flex items-center gap-2">
						<Icon name="ruler" size={18} class="shrink-0 text-brand" />
						<span class="min-w-0 flex-1 text-sm font-semibold text-ink">Tour de cou</span>
						<div class="w-24 text-center">
							<input type="text" inputmode="decimal" class="w-full bg-transparent text-center font-display text-xl font-semibold text-ink outline-none" placeholder="—" bind:value={mNeck} />
						</div>
						<span class="w-8 text-sm text-mist">cm</span>
					</div>
				</label>
			</div>

			{#if logError}
				<p class="mt-3 rounded-xl bg-danger-light px-3 py-2 text-sm text-danger">{logError}</p>
			{/if}

			<button type="button" class="mt-4 w-full rounded-full bg-ink py-3.5 text-sm font-bold text-white transition hover:bg-ink/90" disabled={saving} onclick={submitLog}>
				{saving ? 'Enregistrement…' : 'Enregistrer les mensurations'}
			</button>
		</div>
	</div>
{/if}

<!-- ═══════════ Feuille édition / suppression d'une valeur ═══════════ -->
{#if edit && editMeta}
	<div role="presentation" class="fixed inset-0 z-[60] flex items-end justify-center bg-ink/40 backdrop-blur-sm sm:items-center sm:p-6" onclick={(e) => { if (e.target === e.currentTarget && !editSaving) edit = null; }} onkeydown={(e) => { if (e.key === 'Escape' && !editSaving) edit = null; }}>
		<div class="w-full max-w-lg rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl">
			<div class="flex items-center justify-between">
				<h2 class="font-display text-lg font-semibold text-ink">Modifier {editMeta.sub.toLowerCase()}</h2>
				<button type="button" class="grid h-9 w-9 place-items-center rounded-full text-lg text-mist hover:bg-line/50" aria-label="Fermer" onclick={() => (edit = null)}>✕</button>
			</div>

			<label class="mt-4 block">
				<span class="mb-1 block text-[11px] font-bold uppercase tracking-wide text-mist">Date</span>
				<input type="text" class="w-full rounded-xl border-2 border-line bg-cream px-3 py-2.5 text-sm font-semibold text-ink" value={longDate(edit.date)} disabled />
			</label>

			<div class="mt-4 rounded-xl border-2 border-brand bg-brand-light/30 p-3">
				<div class="flex items-center gap-2">
					<Icon name={editMeta.icon} size={18} class="shrink-0 text-brand" />
					<span class="min-w-0 flex-1 text-sm font-semibold text-ink">{editMeta.label}</span>
					<div class="w-28 text-center">
						<input type="text" inputmode="decimal" class="w-full bg-transparent text-center font-display text-2xl font-semibold text-ink outline-none" bind:value={editValue} />
					</div>
					<span class="w-8 text-sm text-mist">{editMeta.unit}</span>
				</div>
			</div>

			{#if editError}
				<p class="mt-3 rounded-xl bg-danger-light px-3 py-2 text-sm text-danger">{editError}</p>
			{/if}

			<div class="mt-4 flex gap-2">
				<button type="button" class="grid h-12 w-12 place-items-center rounded-full border-2 border-danger text-danger transition hover:bg-danger-light disabled:opacity-60" disabled={editSaving} aria-label="Supprimer cette valeur" title="Supprimer cette valeur" onclick={deleteEdit}><Icon name="trash" size={20} /></button>
				<button type="button" class="flex-1 rounded-full bg-ink py-3.5 text-sm font-bold text-white transition hover:bg-ink/90 disabled:opacity-60" disabled={editSaving} onclick={saveEdit}>
					{editSaving ? 'Enregistrement…' : 'Enregistrer la modification'}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- ═══════════ Édition de la taille ═══════════ -->
{#if heightEdit}
	<div role="presentation" class="fixed inset-0 z-[60] flex items-end justify-center bg-ink/40 backdrop-blur-sm sm:items-center sm:p-6" onclick={(e) => { if (e.target === e.currentTarget && !saving) heightEdit = false; }} onkeydown={(e) => { if (e.key === 'Escape' && !saving) heightEdit = false; }}>
		<div class="w-full max-w-lg rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl">
			<h2 class="font-display text-lg font-semibold text-ink">Ta taille</h2>
			<p class="mt-1 text-xs text-mist">Renseignée une seule fois (cm).</p>
			<div class="mt-4 flex items-center justify-between gap-3">
				<input type="text" inputmode="decimal" class="w-full flex-1 rounded-xl border-2 border-line bg-cream px-3 py-2.5 text-center font-display text-2xl font-semibold text-ink outline-none focus:border-brand" bind:value={heightInput} placeholder="Ex. 168" />
				<span class="text-sm font-semibold text-mist">cm</span>
			</div>
			{#if heightError}
				<p class="mt-3 rounded-xl bg-danger-light px-3 py-2 text-sm text-danger">{heightError}</p>
			{/if}
			<button type="button" class="mt-4 w-full rounded-full bg-ink py-3.5 text-sm font-bold text-white transition hover:bg-ink/90" disabled={saving} onclick={saveHeight}>
				{saving ? 'Enregistrement…' : 'Enregistrer la taille'}
			</button>
		</div>
	</div>
{/if}