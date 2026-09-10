<script lang="ts">
	import { onMount } from 'svelte';
	import MetricChart from '../../../lib/components/MetricChart.svelte';

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
		{ key: 'weightKg', label: 'POIDS', sub: 'Poids', unit: 'kg', icon: '⚖️', color: '#1db954', group: 'weight' },
		{ key: 'waistCm', label: 'TOUR DE TAILLE', sub: 'Partie la plus fine', unit: 'cm', icon: '📏', color: '#f97316', group: 'mensurations' },
		{ key: 'hipCm', label: 'FESSIERS', sub: 'Circonférence', unit: 'cm', icon: '📐', color: '#ec4899', group: 'mensurations' },
		{ key: 'neckCm', label: 'TOUR DE COU', sub: 'Circonférence', unit: 'cm', icon: '🪢', color: '#3b82f6', group: 'mensurations' },
	];

	let heightCm = $state<number | null>(null);
	let measurements = $state<Measurement[]>([]);
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
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		load();
	});

	/* ————— Séries par métrique ————— */
	function series(key: Metric): { date: string; value: number }[] {
		return measurements
			.filter((m) => m[key] !== undefined && m[key] !== null)
			.map((m) => ({ date: m.date, value: m[key] as number }))
			.sort((a, b) => a.date.localeCompare(b.date));
	}
	function shortDate(iso: string) {
		const d = new Date(iso + 'T12:00:00');
		return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' });
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
		<button type="button" class="mb-3 flex items-center gap-1 text-sm font-semibold text-mist hover:text-ink" onclick={() => (detailKey = null)}>‹ Retour</button>
		<h1 class="font-display text-2xl font-semibold text-ink">{detailMeta.sub}</h1>
		<p class="mt-1 text-sm text-mist">Touche une date pour corriger ou supprimer une valeur.</p>

		<section class="mt-4 rounded-2xl border border-line bg-card p-3 shadow-sm">
			{#if detailRows.length > 0}
				<MetricChart values={detailRows.map((r) => r.value)} labels={[shortDate(detailRows[0].date), shortDate(detailRows[detailRows.length - 1].date)]} color={detailMeta.color} height={220} />
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
	</div>
{:else}
	<!-- ═══════════ Vue principale ═══════════ -->
	<div class="mx-auto w-full max-w-xl px-4 pb-28 pt-4 sm:px-6">
		<h1 class="font-display text-2xl font-semibold text-ink">Ma progression 📈</h1>
		<p class="mt-1 text-sm text-mist">Poids, tour de taille, fessiers et tour de cou — touche une courbe pour la détailler.</p>

		{#if error}
			<div class="mt-4 rounded-xl border-2 border-danger bg-danger-light px-4 py-3 text-sm text-danger">{error}</div>
		{/if}

		<!-- Carte taille -->
		<section class="mt-5 rounded-2xl border border-line bg-card p-4 shadow-sm">
			<div class="flex items-center justify-between gap-3">
				<div class="flex items-center gap-3">
					<div class="grid h-11 w-11 place-items-center rounded-xl bg-brand-light text-xl">📏</div>
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
						<span class="text-2xl" aria-hidden="true">{meta.icon}</span>
					</div>
				</div>
				<button type="button" class="block w-full px-3 pt-2 text-left" aria-label={`Voir la courbe ${meta.sub}`} onclick={() => openDetail(meta.key)}>
					{#if rows.length > 0}
						<MetricChart values={rows.map((r) => r.value)} labels={[shortDate(rows[0].date), shortDate(rows[rows.length - 1].date)]} color={meta.color} height={150} />
					{:else}
						<div class="rounded-xl border-2 border-dashed border-line px-4 py-8 text-center">
							<p class="text-sm text-mist">Aucune prise enregistrée pour {meta.sub.toLowerCase()}.</p>
						</div>
					{/if}
				</button>
				<button type="button" class="flex w-full items-center justify-between border-t border-line px-4 py-3.5 text-sm font-semibold text-ink transition hover:bg-line/40" onclick={() => openLog(meta.group)}>
					<span>Enregistrer une valeur</span>
					<span class="text-mist">›</span>
				</button>
			</section>
		{/each}

		<div class="mt-6 rounded-xl bg-warn-light px-4 py-3 text-xs leading-relaxed text-ink">
			💡 <strong>Le conseil :</strong> pèse-toi le matin, à jeun, dans les mêmes conditions. La tendance compte plus qu'un chiffre isolé.
		</div>
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
					<span class="text-base" aria-hidden="true">⚖️</span>
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
						<span class="text-base" aria-hidden="true">📏</span>
						<span class="min-w-0 flex-1 text-sm font-semibold text-ink">Tour de taille</span>
						<div class="w-24 text-center">
							<input type="text" inputmode="decimal" class="w-full bg-transparent text-center font-display text-xl font-semibold text-ink outline-none" placeholder="—" bind:value={mWaist} />
						</div>
						<span class="w-8 text-sm text-mist">cm</span>
					</div>
				</label>
				<label class="rounded-xl border-2 border-line bg-white p-3">
					<div class="flex items-center gap-2">
						<span class="text-base" aria-hidden="true">📐</span>
						<span class="min-w-0 flex-1 text-sm font-semibold text-ink">Fessiers</span>
						<div class="w-24 text-center">
							<input type="text" inputmode="decimal" class="w-full bg-transparent text-center font-display text-xl font-semibold text-ink outline-none" placeholder="—" bind:value={mHip} />
						</div>
						<span class="w-8 text-sm text-mist">cm</span>
					</div>
				</label>
				<label class="rounded-xl border-2 border-line bg-white p-3">
					<div class="flex items-center gap-2">
						<span class="text-base" aria-hidden="true">🪢</span>
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
					<span class="text-base" aria-hidden="true">{editMeta.icon}</span>
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
				<button type="button" class="grid h-12 w-12 place-items-center rounded-full border-2 border-danger text-lg text-danger transition hover:bg-danger-light disabled:opacity-60" disabled={editSaving} aria-label="Supprimer cette valeur" title="Supprimer cette valeur" onclick={deleteEdit}>🗑</button>
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