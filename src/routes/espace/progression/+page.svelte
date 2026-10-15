<script lang="ts">
	import { onMount } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import { appWarm, cacheGet, cacheSet, getSharedMetrics, isFresh, noteSync, restoreScroll, saveScroll, setSharedMetrics } from '../../../lib/navMemory';
	import { clearMetricField, upsertMetricRow, withDerivedBodyFat, type Measurement, type MetricKey, type MetricsSnapshot } from '../../../lib/metrics';
	import MetricTrend from '../../../lib/components/MetricTrend.svelte';
	import BackToHome from '../../../lib/components/BackToHome.svelte';
	import { fade, fly } from 'svelte/transition';
	import { sheetFade, sheetFly } from '../../../lib/sheetMotion';
	import Icon from '../../../lib/components/Icon.svelte';
	import { KEY_MEASURES, MEASURE_IMAGES, MEASURE_TIPS, PHOTO_EXAMPLES, PHOTO_PROTOCOL } from '../../../lib/data/guide';

	type Metric = MetricKey;
	type Group = 'weight' | 'mensurations';

	const METRIC_META: { key: Metric; label: string; sub: string; unit: string; icon: string; color: string; group: Group }[] = [
		{ key: 'weightKg', label: 'POIDS', sub: 'Poids', unit: 'kg', icon: 'scale', color: '#1db954', group: 'weight' },
		{ key: 'waistCm', label: 'TOUR DE TAILLE FINE', sub: 'Partie la plus fine', unit: 'cm', icon: 'ruler', color: '#f97316', group: 'mensurations' },
		{ key: 'hipCm', label: 'FESSIERS', sub: 'Circonférence', unit: 'cm', icon: 'ruler', color: '#ec4899', group: 'mensurations' },
		{ key: 'neckCm', label: 'TOUR DE COU', sub: 'Circonférence', unit: 'cm', icon: 'ruler', color: '#3b82f6', group: 'mensurations' },
	];

	let heightCm = $state<number | null>(null);
	let measurements = $state<Measurement[]>([]);
	let bodyFat = $state<{ date: string; value: number }[]>([]);
	let loading = $state(true);
	let error = $state('');
	let saving = $state(false);

	/* ————— Navigation rapide : identifiant de route ————— */
	const ROUTE = '/espace/progression';

	/* ————— Chargement —————
	   Au retour sur l'onglet : les données déjà connues (cache de navigation
	   ou instantané partagé avec l'Accueil) s'affichent immédiatement ; on ne
	   refetch que si elles ont plus de 30 s. Même source que le fetch — jamais
	   de donnée inventée. */
	const SHARED_TTL_MS = 2 * 60 * 1000;
	/** Publie l'instantané courant vers l'Accueil + le cache de navigation. */
	function publishSnapshot() {
		const snap: MetricsSnapshot = { heightCm, measurements, bodyFat };
		cacheSet(ROUTE, snap);
		setSharedMetrics(snap);
	}
	async function load() {
		/* Instantané PARTAGÉ (Accueil ↔ Progression) : une donnée enregistrée il
		   y a moins de 2 min s'affiche immédiatement — jamais un flash de donnée
		   périmée juste après un enregistrement. */
		const shared = getSharedMetrics();
		const sharedFresh = shared !== undefined && Date.now() - shared.savedAt < SHARED_TTL_MS;
		const cached = cacheGet<MetricsSnapshot>(ROUTE);
		if (sharedFresh && shared) {
			heightCm = shared.heightCm;
			measurements = shared.measurements;
			bodyFat = shared.bodyFat;
			loading = false;
		} else if (cached) {
			heightCm = cached.heightCm;
			measurements = cached.measurements;
			bodyFat = cached.bodyFat;
			loading = false;
		}
		if ((sharedFresh && shared) || (cached && isFresh(ROUTE))) return;
		/* Premier chargement de session : skeleton. Sinon (cache ou session
		   chaude) : revalidation silencieuse en arrière-plan, sans spinner. */
		if (cached || sharedFresh || appWarm()) loading = false;
		error = '';
		try {
			const r = await fetch('/api/metrics');
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			heightCm = j.heightCm ?? null;
			measurements = j.measurements ?? [];
			// Masse grasse : calcul centralisé côté Convex (même source que le CRM).
			bodyFat = j.bodyFat ?? [];
			publishSnapshot();
			noteSync(ROUTE);
		} catch (e) {
			if (!cached && !sharedFresh) error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		load();
		// Lien direct depuis le dashboard : « Ajouter mes mensurations »
		// ouvre directement la feuille de saisie des mensurations.
		const params = new URLSearchParams(window.location.search);
		// Lien « Voir mon historique » de la saisie rapide : détail Poids directement.
		if (params.get('detail') === 'weightKg') openDetail('weightKg');
		if (params.get('action') === 'mensurations') {
			openLog('mensurations');
			/* Lien direct « Ajouter mes mensurations » : au retour automatique
			   post-enregistrement, la bonne carte doit être pointée — jamais Poids. */
			focusOn('waistCm');
		}
		/* Retour sur l'onglet : position de scroll restaurée (après le reset
		   scroll(0,0) que SvelteKit applique en fin de navigation). */
		const y = restoreScroll(ROUTE);
		if (y > 0) setTimeout(() => window.scrollTo(0, y), 0);
	});

	/* Sauvegarde de la position de scroll AVANT la navigation : à ce moment le
	   scroll est encore celui de l'utilisateur (le réajustement de transition
	   arrive plus tard et fausserait la valeur au démontage). */
	beforeNavigate(() => saveScroll(ROUTE));

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
	let detailHoverIdx = $state<number | null>(null);
	const detailMeta = $derived(METRIC_META.find((m) => m.key === detailKey) ?? null);
	const detailRows = $derived(detailKey ? series(detailKey) : []);
	const detailActiveIdx = $derived(
		detailRows.length
			? detailHoverIdx !== null && detailRows[detailHoverIdx]
				? detailHoverIdx
				: detailRows.length - 1
			: null
	);
	const detailActiveRow = $derived(detailActiveIdx !== null ? detailRows[detailActiveIdx] : null);
	const detailPrevDiff = $derived(
		detailActiveIdx !== null && detailActiveIdx > 0
			? Math.round((detailRows[detailActiveIdx].value - detailRows[detailActiveIdx - 1].value) * 10) / 10
			: null
	);
	const detailLast = $derived(detailRows.length ? detailRows[detailRows.length - 1].value : null);
	const detailDelta = $derived(delta(detailRows));
	function openDetail(key: Metric) {
		detailHoverIdx = null;
		detailKey = key;
	}

/* ————— Masse grasse estimée (US Navy femme — lecture seule) —————
   Les points viennent du calcul CENTRALISÉ côté Convex (metrics.list) :
   exactement la même source que la Vision 360 du CRM. À chaque jour où
   une mesure est ajoutée ou modifiée, l'estimation est recalculée avec
   les dernières valeurs connues de chaque mesure (report en avant) —
   aucune exigence qu'elles aient été prises le même jour. */
	const BF_COLOR = '#a855f7';

	const bfRows = $derived(bodyFat);
	let bfHoverIdx = $state<number | null>(null);
	const bfActiveIdx = $derived(
		bfRows.length ? (bfHoverIdx !== null && bfRows[bfHoverIdx] ? bfHoverIdx : bfRows.length - 1) : null
	);
	const bfActiveRow = $derived(bfActiveIdx !== null ? bfRows[bfActiveIdx] : null);
	const bfPrevDiff = $derived(
		bfActiveIdx !== null && bfActiveIdx > 0
			? Math.round((bfRows[bfActiveIdx].value - bfRows[bfActiveIdx - 1].value) * 10) / 10
			: null
	);
	const bfLast = $derived(bodyFat.length ? bodyFat[bodyFat.length - 1].value : null);
	const bfDelta = $derived(delta(bodyFat));
	let bfDetail = $state(false);

	/* ————— Guide « Mesures & photos » (pédagogique, lecture seule) ————— */
	let guideOpen = $state(false);
	function openGuide() {
		guideOpen = true;
		/* Le DOM se met à jour après le flush Svelte : on remonte en haut une
		   fois la vue guide montée (même logique que restoreScroll). */
		setTimeout(() => window.scrollTo(0, 0), 0);
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

	/** Métrique mise en avant (carte surlignée « Mis à jour ✓ ») — retombe
	 *  seule après ~2,5 s (jamais permanent, une seule minuterie active). */
	let focusMetric = $state<Metric | null>(null);
	let focusTimer: ReturnType<typeof setTimeout> | undefined;
	function focusOn(metric: Metric, opts: { scroll?: boolean } = {}) {
		clearTimeout(focusTimer);
		focusMetric = metric;
		focusTimer = setTimeout(() => (focusMetric = null), 2500);
		if (opts.scroll) {
			/* Le DOM n'existe plus si on vient de quitter la vue détail : le scroll
			   part juste après le changement de vue. */
			setTimeout(() => {
				document.getElementById(`metric-card-${metric}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
			}, 60);
		}
	}
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
	/** Retour automatique sur la carte de la métrique enregistrée — simple
	 *  changement d'état local + scroll doux, JAMAIS de rechargement de page. */
	function returnToCard(metric: Metric) {
		if (detailKey === metric) {
			focusOn(metric); // déjà sur la courbe de cette métrique
			return;
		}
		detailKey = null;
		bfDetail = false;
		focusOn(metric, { scroll: true });
	}
	async function submitLog() {
		if (saving) return; // anti double-clic : un seul enregistrement à la fois
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
		const openedGroup = logType;
		try {
			/* UI optimiste : la nouvelle mesure apparaît IMMÉDIATEMENT (historique,
			   courbe, carte, Accueil) — sans attendre le serveur, qui revalide
			   ensuite silencieusement. */
			const patch: Partial<Record<MetricKey, number>> = {};
			for (const k of ['weightKg', 'waistCm', 'hipCm', 'neckCm'] as MetricKey[]) {
				const v = body[k];
				if (typeof v === 'number') patch[k] = v;
			}
			measurements = upsertMetricRow(measurements, logDate, patch);
			bodyFat = withDerivedBodyFat({ heightCm, measurements, bodyFat }).bodyFat;
			publishSnapshot();
			const target: Metric =
				openedGroup === 'weight'
					? 'weightKg'
					: typeof patch.waistCm === 'number'
						? 'waistCm'
						: typeof patch.hipCm === 'number'
							? 'hipCm'
							: 'neckCm';
			logType = null;
			returnToCard(target);
			/* Revalidation silencieuse en arrière-plan (source de vérité serveur). */
			const r = await fetch('/api/metrics', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			await load();
		} catch (e) {
			/* Échec serveur : on réaffiche la feuille avec l'erreur et les valeurs
			   saisies, puis on restaure la vérité serveur. */
			logError = e instanceof Error ? e.message : String(e);
			logType = openedGroup;
			await load().catch(() => {});
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
		if (!edit || editSaving) return; // anti double-clic
		const val = parseFloat(editValue.replace(',', '.'));
		if (!isFinite(val) || editValue.trim() === '') {
			editError = 'Saisis une valeur valide.';
			return;
		}
		editSaving = true;
		editError = '';
		const { metric, date } = edit;
		try {
			/* Optimiste : courbe + historique + carte mis à jour tout de suite. */
			const patch: Partial<Record<MetricKey, number>> = {};
			patch[metric] = val;
			measurements = upsertMetricRow(measurements, date, patch);
			bodyFat = withDerivedBodyFat({ heightCm, measurements, bodyFat }).bodyFat;
			publishSnapshot();
			edit = null;
			const r = await fetch('/api/metrics', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ date, metric, value: val }),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			await load();
		} catch (e) {
			editError = e instanceof Error ? e.message : String(e);
			edit = { metric, date };
			await load().catch(() => {});
		} finally {
			editSaving = false;
		}
	}
	async function deleteEdit() {
		if (!edit || editSaving) return; // anti double-clic
		editSaving = true;
		editError = '';
		const { metric, date } = edit;
		try {
			/* Optimiste : la valeur disparaît aussitôt (ligne entière si le jour
			   n'a plus aucune mesure — même sémantique que le serveur). */
			measurements = clearMetricField(measurements, date, metric);
			bodyFat = withDerivedBodyFat({ heightCm, measurements, bodyFat }).bodyFat;
			publishSnapshot();
			edit = null;
			const r = await fetch(`/api/metrics?date=${date}&metric=${metric}`, { method: 'DELETE' });
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			await load();
		} catch (e) {
			editError = e instanceof Error ? e.message : String(e);
			edit = { metric, date };
			await load().catch(() => {});
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
		if (saving) return; // anti double-clic
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
	<!-- ═══════════ Vue détail d'une métrique (maquette Claude v2 Poids / PartieFine / Fessiers / Cou) ═══════════ -->
	<div class="mx-auto w-full max-w-xl pb-28">
		<div class="mb-4 flex items-center gap-2">
			<button
				type="button"
				onclick={() => (detailKey = null)}
				class="tap inline-flex h-[44px] items-center gap-1 rounded-[22px] border border-[#E9EDEA] bg-white pl-2.5 pr-4 text-[14px] font-bold text-[#0d7c36] shadow-[0_1px_2px_rgba(15,21,18,0.04),0_8px_20px_-8px_rgba(15,21,18,0.14)]"
			>
				<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1db954" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"></path></svg>
				<span>Retour</span>
			</button>
		</div>

		<h1 class="text-[#0F1512] page-title">{detailMeta.sub}</h1>
		<p class="mt-1 text-[14px] leading-[1.4] text-[#66716B]">Touche une date pour corriger ou supprimer une valeur.</p>

		<section class="mt-4 rounded-[24px] border border-[#EEF1EF] bg-white px-4 pb-3 pt-[18px] shadow-[0_1px_2px_rgba(15,21,18,0.04),0_14px_32px_-16px_rgba(15,21,18,0.18)]">
			{#if detailActiveRow !== null}
				<div class="flex items-end justify-between gap-2.5 px-1">
					<div>
						<div class="flex items-baseline gap-1.5">
							<span class="font-display text-[48px] font-black leading-none tracking-[-0.04em] text-[#0F1512] tabular-nums">
								{fmt(Math.round(detailActiveRow.value * 10) / 10)}
							</span>
							<span class="text-[18px] font-bold text-[#66716B]">{detailMeta.unit}</span>
						</div>
						<div class="mt-1 text-[13.5px] text-[#66716B]">{longDate(detailActiveRow.date)}</div>
					</div>
					<div class="text-right">
						{#if detailPrevDiff !== null}
							<span class="inline-flex items-center gap-1 rounded-[12px] bg-[#F3F6F4] px-[11px] py-[6px] text-[13px] font-black text-[#2F3A34] tabular-nums">
								{#if detailPrevDiff > 0}
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"></path></svg>
								{:else if detailPrevDiff < 0}
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"></path></svg>
								{:else}
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"></path></svg>
								{/if}
								{fmt(Math.abs(detailPrevDiff))} {detailMeta.unit}
							</span>
						{:else if detailDelta !== null}
							<span class="inline-flex items-center gap-1 rounded-[12px] bg-[#F3F6F4] px-[11px] py-[6px] text-[13px] font-black text-[#2F3A34] tabular-nums">
								{detailDelta <= 0 ? '↓' : '↑'} {fmt(Math.abs(detailDelta))} {detailMeta.unit}
							</span>
						{/if}
					</div>
				</div>
			{/if}

			{#if detailRows.length >= 2}
				<div class="mt-1">
					<MetricTrend
						points={detailRows}
						color={detailMeta.color}
						unit={detailMeta.unit}
						height={214}
						width={340}
						showGridLabels={true}
						showEndpoints={true}
						bind:activeIdx={detailHoverIdx}
					/>
				</div>
			{:else if detailRows.length === 1 && detailLast !== null}
				<div class="px-4 py-6 text-center">
					<p class="mt-1 text-xs text-[#66716B]">1 mesure enregistrée — la tendance apparaîtra après une prochaine mesure.</p>
				</div>
			{:else}
				<div class="px-4 py-12 text-center">
					<p class="text-sm text-[#66716B]">Aucune donnée pour {detailMeta.sub.toLowerCase()}.</p>
				</div>
			{/if}
		</section>

		<button
			type="button"
			class="tap mt-3.5 flex h-[56px] w-full items-center justify-center rounded-[28px] bg-[#111A15] text-[16px] font-bold text-white shadow-[0_14px_28px_-12px_rgba(15,21,18,0.5)] transition hover:bg-[#0F1512]"
			onclick={() => openLog(detailMeta.group)}
		>
			Enregistrer une valeur
		</button>

		<!-- Historique (maquette Claude v2 : carte 24px, lignes 40px, surbrillance #f3fcf7) -->
		<section class="mt-3.5 overflow-hidden rounded-[24px] border border-[#EEF1EF] bg-white shadow-[0_1px_2px_rgba(15,21,18,0.04),0_14px_32px_-16px_rgba(15,21,18,0.18)]">
			<h2 class="px-[18px] pb-[9px] pt-[13px] text-[15px] font-black leading-none text-[#0F1512]">Historique</h2>
			{#if detailRows.length === 0}
				<p class="border-t border-[#EEF1EF] px-4 py-8 text-center text-sm text-[#66716B]">Aucune prise enregistrée — ajoute-en une avec « Enregistrer une valeur ».</p>
			{:else}
				<div class="border-t border-[#EEF1EF]">
					{#each detailRows as r, idx (r.date)}
						{@const isSel = detailActiveIdx === idx}
						<div
							class="flex h-[42px] items-center justify-between px-[18px] transition {idx > 0 ? 'border-t border-[#EEF1EF]' : ''}"
							style="background:{isSel ? '#f3fcf7' : '#FFFFFF'}"
						>
							<div class="flex items-center gap-2">
								<button
									type="button"
									class="text-left text-[14px] font-bold leading-none text-[#0F1512]"
									onclick={() => (detailHoverIdx = idx)}
								>
									{longDate(r.date)}
								</button>
								<button
									type="button"
									class="tap grid h-[30px] w-[30px] place-items-center rounded-full bg-[#F3F6F4] text-[#66716B] transition hover:text-[#0F1512]"
									aria-label={`Modifier ${longDate(r.date)}`}
									onclick={() => openEdit(detailMeta.key, r.date, r.value)}
								>
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z"></path><path d="M13.5 8.5l3 3"></path></svg>
								</button>
							</div>
							<button
								type="button"
								class="text-[14px] font-black leading-none text-[#0F1512] tabular-nums"
								onclick={() => openEdit(detailMeta.key, r.date, r.value)}
							>
								{fmt(Math.round(r.value * 10) / 10)} {detailMeta.unit}
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</section>
	</div>	{:else if bfDetail}
	<!-- ═══════════ Vue détail : masse grasse estimée (lecture seule, maquette MasseGrasse.svelte) ═══════════ -->
	<div class="mx-auto w-full max-w-xl pb-28">
		<div class="mb-4 flex items-center gap-2">
			<button
				type="button"
				onclick={() => (bfDetail = false)}
				class="tap inline-flex h-[44px] items-center gap-1 rounded-[22px] border border-[#E9EDEA] bg-white pl-2.5 pr-4 text-[14px] font-bold text-[#0d7c36] shadow-[0_1px_2px_rgba(15,21,18,0.04),0_8px_20px_-8px_rgba(15,21,18,0.14)]"
			>
				<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1db954" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"></path></svg>
				<span>Retour</span>
			</button>
		</div>
		<h1 class="text-[#0F1512] page-title">Masse grasse estimée</h1>
		<p class="mt-1 text-[14px] leading-[1.4] text-[#66716B]">Estimation indicative calculée avec la méthode US Navy — elle n'est pas modifiable.</p>

		<section class="mt-4 rounded-[24px] border border-[#EEF1EF] bg-white px-4 pb-3 pt-[18px] shadow-[0_1px_2px_rgba(15,21,18,0.04),0_14px_32px_-16px_rgba(15,21,18,0.18)]">
			{#if bfActiveRow !== null}
				<div class="flex items-end justify-between gap-2.5 px-1">
					<div>
						<div class="flex items-baseline gap-1.5">
							<span class="font-display text-[48px] font-black leading-none tracking-[-0.04em] text-[#0F1512] tabular-nums">{fmt(bfActiveRow.value)}</span>
							<span class="text-[18px] font-bold text-[#66716B]">%</span>
						</div>
						<div class="mt-1 text-[13.5px] text-[#66716B]">{longDate(bfActiveRow.date)}</div>
					</div>
					{#if bfPrevDiff !== null}
						<span class="inline-flex items-center gap-1 rounded-[12px] bg-[#F3F6F4] px-[11px] py-[6px] text-[13px] font-black text-[#2F3A34] tabular-nums">
							{bfPrevDiff <= 0 ? '↓' : '↑'} {fmt(Math.abs(bfPrevDiff))} %
						</span>
					{:else if bfDelta !== null}
						<span class="inline-flex items-center gap-1 rounded-[12px] bg-[#F3F6F4] px-[11px] py-[6px] text-[13px] font-black text-[#2F3A34] tabular-nums">
							{bfDelta <= 0 ? '↓' : '↑'} {fmt(Math.abs(bfDelta))} %
						</span>
					{/if}
				</div>
			{/if}

			{#if bfRows.length >= 2}
				<div class="mt-1">
					<MetricTrend
						points={bfRows}
						color={BF_COLOR}
						unit="%"
						height={214}
						width={340}
						showGridLabels={true}
						showEndpoints={true}
						bind:activeIdx={bfHoverIdx}
					/>
				</div>
			{:else if bfRows.length === 1 && bfLast !== null}
				<div class="px-4 py-6 text-center">
					<p class="mt-1 text-xs text-[#66716B]">1 estimation — la tendance apparaîtra après une prochaine mesure.</p>
				</div>
			{:else}
				<div class="px-4 py-12 text-center">
					<p class="text-sm text-[#66716B]">Renseigne ta taille et tes mensurations pour obtenir ton estimation.</p>
				</div>
			{/if}
		</section>

		<!-- Historique (lecture seule — pas de correction possible) -->
		<section class="mt-3.5 overflow-hidden rounded-[24px] border border-[#EEF1EF] bg-white shadow-[0_1px_2px_rgba(15,21,18,0.04),0_14px_32px_-16px_rgba(15,21,18,0.18)]">
			<h2 class="px-[18px] pb-[9px] pt-[13px] text-[15px] font-black leading-none text-[#0F1512]">Historique des estimations</h2>
			{#if bfRows.length === 0}
				<p class="border-t border-[#EEF1EF] px-4 py-8 text-center text-sm text-[#66716B]">Aucune estimation pour l'instant — elle apparaîtra dès que ta taille et au moins un tour de taille fine, fessiers ou tour de cou seront enregistrés.</p>
			{:else}
				<div class="border-t border-[#EEF1EF]">
					{#each bfRows as r, idx (r.date)}
						<button
							type="button"
							onclick={() => (bfHoverIdx = idx)}
							class="flex h-[40px] w-full items-center justify-between px-[18px] text-left transition {idx > 0 ? 'border-t border-[#EEF1EF]' : ''}"
							style="background:{bfActiveIdx === idx ? '#f3fcf7' : '#FFFFFF'}"
						>
							<span class="text-[14px] font-bold text-[#0F1512]">{longDate(r.date)}</span>
							<span class="text-[14px] font-black text-[#0F1512] tabular-nums">{fmt(r.value)} %</span>
						</button>
					{/each}
				</div>
				<p class="border-t border-[#EEF1EF] px-[18px] py-3 text-xs text-[#66716B]">Estimation indicative — méthode US Navy, calculée automatiquement depuis tes mensurations.</p>
			{/if}
		</section>
	</div>
	{:else if guideOpen}
	<!-- ═══════════ Vue guide : Comment bien prendre mes mesures & mes photos (lecture seule) ═══════════ -->
	<div class="mx-auto w-full max-w-xl pb-28">
		<div class="mb-3 flex items-center gap-1 text-sm font-semibold text-mist">
			<button type="button" class="flex min-h-9 items-center gap-1 rounded-lg pr-2 transition hover:text-ink" onclick={() => (guideOpen = false)}><Icon name="chevronLeft" size={16} /> Retour</button>
			<span class="text-mist/50" aria-hidden="true">·</span>
			<a href="/espace" class="flex min-h-9 items-center gap-1 rounded-lg px-1 transition hover:text-ink"><Icon name="arrowLeft" size={16} /> Accueil</a>
		</div>
		<h1 class="text-ink page-title">Bien prendre tes mesures &amp; tes photos</h1>
		<p class="mt-1 text-sm text-mist">Le guide complet — à lire avant ta première prise, puis à chaque semaine de suivi.</p>

		<!-- Mensurations : les 3 mesures clés -->
		<section class="mt-5 rounded-2xl border border-line bg-card shadow-sm">
			<h2 class="flex items-center gap-2 border-b border-line px-4 py-3 font-display text-sm font-semibold text-ink">
				<Icon name="ruler" size={16} class="text-brand" />
				Les 3 mesures clés
				<span class="ml-auto rounded-full bg-brand-light px-2 py-0.5 text-[11px] font-bold text-brand-dark">Essentiel</span>
			</h2>
			<ul class="divide-y divide-line/70">
				{#each KEY_MEASURES as m (m.key)}
					<li class="px-4 py-3">
						<p class="text-sm font-semibold text-ink">{m.name}</p>
						<p class="mt-0.5 text-xs text-mist">{m.how}</p>
					</li>
				{/each}
			</ul>
			<div class="px-4 pb-4">
				<div class="flex items-start gap-1.5 rounded-xl bg-brand-light/40 px-3 py-2.5 text-xs leading-relaxed text-ink">
					<Icon name="lightbulb" size={13} class="mt-0.5 shrink-0" />
					<span>Ces 3 mesures alimentent la <strong>formule US Navy</strong> pour estimer ton taux de masse grasse chaque semaine.</span>
				</div>
			</div>
		</section>

		<!-- Visuels : points de mesure + technique mètre ruban -->
		<section class="mt-4 rounded-2xl border border-line bg-card p-3 shadow-sm">
			{#each MEASURE_IMAGES as img (img.alt)}
				<figure class="mb-3 last:mb-0">
					<img src={img.src} alt={img.alt} loading="lazy" class="w-full rounded-xl border border-line" />
					<figcaption class="mt-1.5 px-1 text-center text-xs text-mist">{img.caption}</figcaption>
				</figure>
			{/each}
		</section>

		<!-- Conseils pour bien mesurer -->
		<section class="mt-4 rounded-2xl border border-warn/30 bg-warn-light p-4 shadow-sm">
			<h2 class="flex items-center gap-2 font-display text-sm font-semibold text-ink">
				<Icon name="triangleAlert" size={16} class="text-warn" />
				Conseils pour bien mesurer
			</h2>
			<ul class="mt-2.5 space-y-1.5">
				{#each MEASURE_TIPS as tip (tip.strong)}
					<li class="flex items-start gap-1.5 text-sm leading-relaxed text-ink">
						<span class="mt-2 h-1 w-1 shrink-0 rounded-full bg-warn" aria-hidden="true"></span>
						<span><strong>{tip.strong}</strong>{tip.rest}</span>
					</li>
				{/each}
			</ul>
		</section>

		<!-- Photos : pourquoi c'est essentiel -->
		<section class="mt-5 rounded-2xl border border-line bg-card shadow-sm">
			<h2 class="flex items-center gap-2 border-b border-line px-4 py-3 font-display text-sm font-semibold text-ink">
				<Icon name="camera" size={16} class="text-brand" />
				Les photos avant
			</h2>
			<p class="px-4 py-3 text-sm leading-relaxed text-ink">La balance ne dit pas tout. Les photos <strong>révèlent ce que les chiffres cachent</strong> — et beaucoup regrettent de ne pas en avoir pris au départ.</p>
		</section>

		<!-- Exemple : face · profil · dos -->
		<section class="mt-4 rounded-2xl border border-line bg-card p-3 shadow-sm">
			<h2 class="px-1 pb-2 text-[11px] font-bold uppercase tracking-wide text-mist">Exemple · face · profil · dos</h2>
			<div class="grid grid-cols-3 gap-2">
				{#each PHOTO_EXAMPLES as p (p.label)}
					<figure>
						<img src={p.src} alt={p.alt} loading="lazy" class="aspect-[5/12] w-full rounded-xl border border-line object-cover object-top" />
						<figcaption class="mt-1 text-center text-xs font-semibold text-ink">{p.label}</figcaption>
					</figure>
				{/each}
			</div>
			<p class="mt-2 px-1 text-xs text-mist">↑ Feuille A4 avec prénom + date + « G-Flux » · position naturelle sans rentrer le ventre.</p>
		</section>

		<!-- Protocole photos -->
		<section class="mt-4 rounded-2xl border border-line bg-card shadow-sm">
			<h2 class="flex items-center gap-2 border-b border-line px-4 py-3 font-display text-sm font-semibold text-ink">
				<Icon name="listChecks" size={16} class="text-brand" />
				Protocole photos
				<span class="ml-auto rounded-full bg-warn-light px-2 py-0.5 text-[11px] font-bold text-warn">Important</span>
			</h2>
			<ol class="divide-y divide-line/70">
				{#each PHOTO_PROTOCOL as step, i (step.title)}
					<li class="flex items-start gap-3 px-4 py-3">
						<span class="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-light text-xs font-bold text-brand-dark">{i + 1}</span>
						<div>
							<p class="text-sm font-semibold text-ink">{step.title}</p>
							<p class="mt-0.5 text-xs leading-relaxed text-mist">{step.desc}</p>
						</div>
					</li>
				{/each}
			</ol>
		</section>
	</div>
	{:else}
	<!-- ═══════════ Vue principale ═══════════ -->
	<div class="mx-auto w-full max-w-xl pb-28">
		<BackToHome label="Ma progression" />
		<h1 class="flex items-center gap-2.5 text-ink page-title">Ma progression <Icon name="trendingUp" size={26} strokeWidth={2.4} class="text-brand" /></h1>
		<p class="mt-1 text-sm text-mist">Poids, mensurations et masse grasse estimée — touche une courbe pour la détailler.</p>

		{#if error}
			<div class="mt-4 rounded-xl border-2 border-danger bg-danger-light px-4 py-3 text-sm text-danger">{error}</div>
		{/if}

		<!-- Carte taille (maquette Progress.svelte : radius 26, ombre Claude, bouton pilule) -->
		<section class="mt-4 rounded-[22px] border border-[#EEF1EF] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,21,18,0.04),0_12px_26px_-18px_rgba(15,21,18,0.2)]">
			<div class="flex items-center justify-between gap-3">
				<div class="flex min-w-0 items-center gap-3">
					<div class="grid h-[40px] w-[40px] shrink-0 place-items-center rounded-[13px] bg-brand-light text-brand"><Icon name="ruler" size={20} /></div>
					<div class="min-w-0">
						<p class="text-[11px] font-black uppercase tracking-[0.12em] text-[#66716B]">Taille</p>
						<p class="mt-0.5 flex items-baseline gap-1">
							{#if heightCm !== null}
								<span class="font-display text-[26px] font-black leading-[1.1] tracking-[-0.03em] tabular-nums text-[#0F1512]">{fmt(heightCm)}</span>
								<span class="text-[14px] font-bold text-[#66716B]">cm</span>
							{:else}
								<span class="font-display text-xl font-bold text-[#0F1512]">Non renseignée</span>
							{/if}
						</p>
					</div>
				</div>
				<button type="button" class="tap shrink-0 h-[36px] rounded-[18px] border border-[#DDE3DF] bg-white px-4 text-[14px] font-bold text-[#0F1512] transition hover:border-brand" onclick={openHeight}>{heightCm !== null ? 'Modifier' : 'Ajouter'}</button>
			</div>
			<p class="mt-2 text-[12px] leading-[1.45] text-[#66716B]">La taille est renseignée une seule fois — elle reste associée à ton profil.</p>
		</section>

		<!-- Cartes métriques (maquette Progress.svelte : radius 28, ombre Claude, courbe interactive 132px + dates d0/d1) -->
		{#each METRIC_META as meta (meta.key)}
			{@const rows = series(meta.key)}
			{@const d = delta(rows)}
			{@const last = rows[rows.length - 1]?.value ?? null}
			<section id="metric-card-{meta.key}" class="mt-4 scroll-mt-20 overflow-hidden rounded-[28px] border bg-white shadow-[0_1px_2px_rgba(15,21,18,0.04),0_18px_40px_-18px_rgba(15,21,18,0.2)] transition {focusMetric === meta.key ? 'border-brand ring-2 ring-brand/30' : 'border-[#EEF1EF]'}">
				<div class="px-5 pb-1 pt-5">
					<div class="flex items-start justify-between gap-3">
						<div>
							<p class="text-[12px] font-black uppercase tracking-[0.12em] text-[#66716B]">{meta.label}</p>
							<div class="mt-2.5 flex flex-wrap items-center gap-2.5">
								<span class="flex items-baseline gap-[6px]">
									<span class="font-display text-[48px] font-black leading-none tracking-[-0.04em] tabular-nums text-[#0F1512]">
										{last !== null ? fmt(Math.round(last * 10) / 10) : '—'}
									</span>
									<span class="text-[18px] font-bold text-[#66716B]">{meta.unit}</span>
								</span>
								{#if d !== null}
									<span class="inline-flex items-center gap-1 rounded-[12px] px-[11px] py-[6px] text-[13px] font-bold {d <= 0 ? 'bg-brand-light text-brand-deep' : 'bg-[#FFF1E6] text-[#f97316]'}">
										{d <= 0 ? '↓' : '↑'} {fmt(Math.abs(d))} {meta.unit}
									</span>
								{/if}
								{#if focusMetric === meta.key}
									<span class="inline-flex items-center gap-1 rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-white">
										<Icon name="circleCheck" size={12} /> Mis à jour
									</span>
								{/if}
							</div>
							<p class="mt-1.5 text-[14px] text-[#66716B]">{meta.sub}</p>
						</div>
						<span class="relative grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[12px]" style:background="color-mix(in srgb, {meta.color} 15%, white)">
							<Icon name={meta.icon} size={19} style={`color:${meta.color}`} />
						</span>
					</div>
				</div>
				<div role="button" tabindex="0" aria-label={`Voir la courbe ${meta.sub}`} class="block w-full cursor-pointer px-[18px] pb-1.5 pt-1.5 text-left outline-none" onclick={() => openDetail(meta.key)} onkeydown={(e) => { if (e.key === 'Enter') openDetail(meta.key); }}>
					{#if rows.length >= 2}
						<MetricTrend points={rows} color={meta.color} unit={meta.unit} height={132} width={318} showEndpoints={true} />
					{:else if rows.length === 1}
						<div class="px-2 pb-4 pt-2">
							<p class="flex items-start gap-1.5 text-xs text-[#66716B]"><Icon name="lightbulb" size={13} class="mt-0.5 shrink-0" /><span>Tendance disponible après une prochaine mesure.</span></p>
						</div>
					{:else}
						<div class="mb-3 mt-1 rounded-xl border-2 border-dashed border-[#EEF1EF] px-4 py-4 text-center">
							<p class="text-xs text-[#66716B]">Aucune prise enregistrée pour {meta.sub.toLowerCase()}.</p>
						</div>
					{/if}
				</div>
				<button type="button" class="tap flex w-full items-center gap-3 border-t border-[#EEF1EF] bg-white px-[20px] py-4 text-left text-[15px] font-bold text-[#0F1512] transition hover:bg-[#F6F8F6]" onclick={() => openLog(meta.group)}>
					<span class="grid h-[28px] w-[28px] shrink-0 place-items-center rounded-full bg-brand-light text-brand"><Icon name="plus" size={16} strokeWidth={2.6} /></span>
					<span class="flex-1">Enregistrer une valeur</span>
					<Icon name="chevronRight" size={18} class="text-[#9AA39E]" />
				</button>
			</section>
		{/each}

		<!-- Carte masse grasse estimée (calcul automatique US Navy — lecture seule, style Progress.svelte) -->
		<section class="mt-4 overflow-hidden rounded-[28px] border border-[#EEF1EF] bg-white shadow-[0_1px_2px_rgba(15,21,18,0.04),0_18px_40px_-18px_rgba(15,21,18,0.2)]">
			<div class="px-5 pb-1 pt-5">
				<div class="flex items-start justify-between gap-3">
					<div>
						<p class="text-[12px] font-black uppercase tracking-[0.12em] text-[#66716B]">% de masse grasse estimé</p>
						<div class="mt-2.5 flex flex-wrap items-center gap-2.5">
							<span class="flex items-baseline gap-[6px]">
								<span class="font-display text-[48px] font-black leading-none tracking-[-0.04em] tabular-nums text-[#0F1512]">
									{bfLast !== null ? fmt(bfLast) : '—'}
								</span>
								<span class="text-[18px] font-bold text-[#66716B]">%</span>
							</span>
							{#if bfDelta !== null}
								<span class="inline-flex items-center gap-1 rounded-[12px] px-[11px] py-[6px] text-[13px] font-bold {bfDelta <= 0 ? 'bg-brand-light text-brand-deep' : 'bg-[#FFF1E6] text-[#f97316]'}">
									{bfDelta <= 0 ? '↓' : '↑'} {fmt(Math.abs(bfDelta))} % depuis le démarrage
								</span>
							{/if}
						</div>
						<p class="mt-1.5 text-[14px] text-[#66716B]">Estimation indicative — méthode US Navy</p>
					</div>
					<span class="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[12px] bg-[#F3E8FF] text-[#A855F7]"><Icon name="target" size={19} /></span>
				</div>
			</div>
			{#if bfRows.length >= 2}
				<div role="button" tabindex="0" aria-label="Voir l'historique de la masse grasse estimée" class="block w-full cursor-pointer px-[18px] pb-1.5 pt-1.5 text-left outline-none" onclick={() => (bfDetail = true)} onkeydown={(e) => { if (e.key === 'Enter') bfDetail = true; }}>
					<MetricTrend points={bfRows} color={BF_COLOR} unit="%" height={132} width={318} showEndpoints={true} />
				</div>
				<p class="flex items-start gap-2.5 border-t border-[#EEF1EF] bg-[#FBFCFB] px-5 py-4 text-[13px] leading-[1.5] text-[#66716B]"><Icon name="lightbulb" size={18} class="mt-0.5 shrink-0 text-[#9AA39E]" /> <span>Calcul automatique depuis tes mensurations — impossible à modifier. Touche la courbe pour voir l'historique.</span></p>
			{:else if bfRows.length === 1}
				<div role="button" tabindex="0" aria-label="Voir l'historique de la masse grasse estimée" class="block w-full cursor-pointer px-5 pt-2 text-left outline-none" onclick={() => (bfDetail = true)} onkeydown={(e) => { if (e.key === 'Enter') bfDetail = true; }}>
					<p class="flex items-start gap-1.5 pb-4 text-xs text-[#66716B]"><Icon name="lightbulb" size={13} class="mt-0.5 shrink-0" /><span>Calcul automatique depuis tes mensurations — impossible à modifier. Tendance disponible après une prochaine mesure.</span></p>
				</div>
			{:else}
				<div class="px-5 pt-2">
					<div class="rounded-xl border-2 border-dashed border-[#EEF1EF] px-4 py-8 text-center">
						<p class="text-sm text-[#66716B]">Renseigne ta taille et tes mensurations (tour de taille fine, fessiers, tour de cou) pour obtenir ton estimation.</p>
					</div>
				</div>
				<p class="mt-2 flex items-start gap-2.5 border-t border-[#EEF1EF] bg-[#FBFCFB] px-5 py-4 text-[13px] leading-[1.5] text-[#66716B]"><Icon name="lightbulb" size={18} class="mt-0.5 shrink-0 text-[#9AA39E]" /> <span>Estimation indicative — méthode US Navy, calculée automatiquement.</span></p>
			{/if}
		</section>

		<div class="mt-4 rounded-[22px] border border-[#FDE3CC] bg-[#FFF6EE] px-5 py-4 text-[13px] leading-[1.5] text-[#8A4A12]">
			<span class="inline-flex items-start gap-1.5"><Icon name="lightbulb" size={14} class="mt-0.5 shrink-0" /><span><strong>Le conseil :</strong> pèse-toi le matin, à jeun, dans les mêmes conditions. La tendance compte plus qu'un chiffre isolé.</span></span>
		</div>

		<!-- Photos de progression (tout en bas) -->
		<section class="mt-4 rounded-[24px] border border-[#EEF1EF] bg-white p-5 shadow-[0_1px_2px_rgba(15,21,18,0.04),0_14px_32px_-16px_rgba(15,21,18,0.18)]">
			<a href="/espace/photos" class="flex items-center justify-between gap-3">
				<div class="flex items-center gap-3.5">
					<div class="grid h-12 w-12 shrink-0 place-items-center rounded-[16px] bg-brand-light"><Icon name="camera" size={22} class="text-brand" /></div>
					<div>
						<p class="text-[11px] font-black uppercase tracking-[0.1em] text-[#66716B]">Photos de progression</p>
						<p class="font-display text-lg font-black text-[#0F1512]">Ajouter mes photos</p>
					</div>
				</div>
				<Icon name="chevronRight" size={18} class="text-[#9AA39E]" />
			</a>
			<p class="mt-2.5 text-[13px] leading-[1.45] text-[#66716B]">Une série de photos par mois, pour voir les changements invisibles sur la balance. Une fois tes photos envoyées à chaque évolution, ton coach t'enverra la comparaison avant-après.</p>
		</section>

		<!-- Guide pédagogique : comment bien prendre ses mesures & ses photos (lecture seule) -->
		<section class="mt-4 rounded-[24px] border border-[#EEF1EF] bg-white p-5 shadow-[0_1px_2px_rgba(15,21,18,0.04),0_14px_32px_-16px_rgba(15,21,18,0.18)]">
			<button type="button" class="flex w-full items-center justify-between gap-3 text-left" onclick={openGuide}>
				<div class="flex items-center gap-3.5">
					<div class="grid h-12 w-12 shrink-0 place-items-center rounded-[16px] bg-brand-light"><Icon name="ruler" size={22} class="text-brand" /></div>
					<div>
						<p class="text-[11px] font-black uppercase tracking-[0.1em] text-[#66716B]">Le guide</p>
						<p class="font-display text-lg font-black text-[#0F1512]">Comment bien prendre mes mesures &amp; mes photos</p>
					</div>
				</div>
				<Icon name="chevronRight" size={18} class="text-[#9AA39E]" />
			</button>
			<p class="mt-2.5 text-[13px] leading-[1.45] text-[#66716B]">Points de mesure, technique du mètre ruban et protocole photos — tout ce qu'il faut pour des données fiables.</p>
		</section>
	</div>
{/if}

<!-- ═══════════ Feuille POIDS (unique, maquette SheetPoids.svelte) ═══════════ -->
{#if logType === 'weight'}
	<div role="presentation" transition:fade={sheetFade()} class="fixed inset-0 z-[60] flex items-end justify-center bg-[#0F1512]/38 backdrop-blur-sm sm:items-center sm:p-6" onclick={(e) => { if (e.target === e.currentTarget && !saving) logType = null; }} onkeydown={(e) => { if (e.key === 'Escape' && !saving) logType = null; }}>
		<div transition:fly={sheetFly()} class="w-full max-w-lg rounded-t-[30px] bg-white px-5 pb-7 pt-[22px] shadow-[0_-20px_50px_-20px_rgba(15,21,18,0.35)] sm:rounded-[30px] {saving ? 'pointer-events-none' : ''}">
			<div class="flex items-start justify-between">
				<h2 class="font-display text-[20px] font-black tracking-[-0.02em] text-[#0F1512]">Enregistrer mon poids</h2>
				<button type="button" class="grid h-11 w-11 -mr-2 -mt-1.5 place-items-center rounded-full text-[#66716B] hover:bg-[#F6F8F6]" aria-label="Fermer" onclick={() => (logType = null)}>
					<Icon name="x" size={20} />
				</button>
			</div>

			<div class="mt-[18px] text-[11.5px] font-black uppercase tracking-[0.1em] text-[#7B857F]">Date</div>
			<label class="fld mt-2 flex h-[52px] items-center rounded-[16px] border-[1.5px] border-[#E3E8E5] bg-[#F6F8F6] px-4">
				<input id="metric-date" type="date" bind:value={logDate} class="flex-1 border-0 bg-transparent text-[16px] font-bold text-[#0F1512] outline-none" />
			</label>

			<div class="mt-3.5">
				<label class="fld flex h-[56px] items-center gap-3 rounded-[18px] border-[1.5px] border-[#E3E8E5] bg-white px-4">
					<Icon name="scale" size={22} class="shrink-0 text-brand" />
					<span class="min-w-0 flex-1 text-[16px] font-black text-[#0F1512]">Poids</span>
					<input type="text" inputmode="decimal" class="w-24 border-0 bg-transparent text-right font-display text-[18px] font-black text-[#0F1512] outline-none" placeholder="—" bind:value={wWeight} />
					<span class="w-6 text-[14px] text-[#7B857F]">kg</span>
				</label>
			</div>

			{#if logError}
				<p class="mt-3 rounded-xl bg-danger-light px-3 py-2 text-sm text-danger">{logError}</p>
			{/if}

			<button type="button" class="tap mt-[18px] flex h-[56px] w-full items-center justify-center rounded-[28px] bg-[#111A15] text-[16px] font-bold text-white shadow-[0_14px_28px_-12px_rgba(15,21,18,0.5)] transition hover:bg-[#0F1512]" disabled={saving} onclick={submitLog}>
				{saving ? 'Enregistrement…' : 'Enregistrer le poids'}
			</button>
		</div>
	</div>
{/if}

<!-- ═══════════ Feuille MENSURATIONS (groupées, maquette SheetMesures.svelte) ═══════════ -->
{#if logType === 'mensurations'}
	<div role="presentation" transition:fade={sheetFade()} class="fixed inset-0 z-[60] flex items-end justify-center bg-[#0F1512]/38 backdrop-blur-sm sm:items-center sm:p-6" onclick={(e) => { if (e.target === e.currentTarget && !saving) logType = null; }} onkeydown={(e) => { if (e.key === 'Escape' && !saving) logType = null; }}>
		<div transition:fly={sheetFly()} class="w-full max-w-lg rounded-t-[30px] bg-white px-5 pb-7 pt-[22px] shadow-[0_-20px_50px_-20px_rgba(15,21,18,0.35)] sm:rounded-[30px] {saving ? 'pointer-events-none' : ''}">
			<div class="flex items-start justify-between">
				<h2 class="font-display text-[20px] font-black tracking-[-0.02em] text-[#0F1512]">Enregistrer mes mensurations</h2>
				<button type="button" class="grid h-11 w-11 -mr-2 -mt-1.5 place-items-center rounded-full text-[#66716B] hover:bg-[#F6F8F6]" aria-label="Fermer" onclick={() => (logType = null)}>
					<Icon name="x" size={20} />
				</button>
			</div>

			<div class="mt-[18px] text-[11.5px] font-black uppercase tracking-[0.1em] text-[#7B857F]">Date</div>
			<label class="fld mt-2 flex h-[52px] items-center rounded-[16px] border-[1.5px] border-[#E3E8E5] bg-[#F6F8F6] px-4">
				<input type="date" bind:value={logDate} class="flex-1 border-0 bg-transparent text-[16px] font-bold text-[#0F1512] outline-none" />
			</label>

			<div class="mt-3.5 flex flex-col gap-2.5">
				<label class="fld flex h-[56px] items-center gap-3 rounded-[18px] border-[1.5px] border-[#E3E8E5] bg-white px-4">
					<Icon name="ruler" size={22} class="shrink-0 text-brand" />
					<span class="min-w-0 flex-1 text-[16px] font-black text-[#0F1512]">Tour de taille fine</span>
					<input type="text" inputmode="decimal" class="w-20 border-0 bg-transparent text-right font-display text-[18px] font-black text-[#0F1512] outline-none" placeholder="—" bind:value={mWaist} />
					<span class="w-6 text-[14px] text-[#7B857F]">cm</span>
				</label>
				<label class="fld flex h-[56px] items-center gap-3 rounded-[18px] border-[1.5px] border-[#E3E8E5] bg-white px-4">
					<Icon name="ruler" size={22} class="shrink-0 text-brand" />
					<span class="min-w-0 flex-1 text-[16px] font-black text-[#0F1512]">Fessiers</span>
					<input type="text" inputmode="decimal" class="w-20 border-0 bg-transparent text-right font-display text-[18px] font-black text-[#0F1512] outline-none" placeholder="—" bind:value={mHip} />
					<span class="w-6 text-[14px] text-[#7B857F]">cm</span>
				</label>
				<label class="fld flex h-[56px] items-center gap-3 rounded-[18px] border-[1.5px] border-[#E3E8E5] bg-white px-4">
					<Icon name="ruler" size={22} class="shrink-0 text-brand" />
					<span class="min-w-0 flex-1 text-[16px] font-black text-[#0F1512]">Tour de cou</span>
					<input type="text" inputmode="decimal" class="w-20 border-0 bg-transparent text-right font-display text-[18px] font-black text-[#0F1512] outline-none" placeholder="—" bind:value={mNeck} />
					<span class="w-6 text-[14px] text-[#7B857F]">cm</span>
				</label>
			</div>

			{#if logError}
				<p class="mt-3 rounded-xl bg-danger-light px-3 py-2 text-sm text-danger">{logError}</p>
			{/if}

			<button type="button" class="tap mt-[18px] flex h-[56px] w-full items-center justify-center rounded-[28px] bg-[#111A15] text-[16px] font-bold text-white shadow-[0_14px_28px_-12px_rgba(15,21,18,0.5)] transition hover:bg-[#0F1512]" disabled={saving} onclick={submitLog}>
				{saving ? 'Enregistrement…' : 'Enregistrer les mensurations'}
			</button>
		</div>
	</div>
{/if}

<!-- ═══════════ Feuille édition / suppression d'une valeur ═══════════ -->
{#if edit && editMeta}
	<div role="presentation" transition:fade={sheetFade()} class="fixed inset-0 z-[60] flex items-end justify-center bg-[#0F1512]/38 backdrop-blur-sm sm:items-center sm:p-6" onclick={(e) => { if (e.target === e.currentTarget && !editSaving) edit = null; }} onkeydown={(e) => { if (e.key === 'Escape' && !editSaving) edit = null; }}>
		<div transition:fly={sheetFly()} class="w-full max-w-lg rounded-t-[30px] bg-white px-5 pb-7 pt-[22px] shadow-[0_-20px_50px_-20px_rgba(15,21,18,0.35)] sm:rounded-[30px]">
			<div class="flex items-start justify-between">
				<h2 class="font-display text-[20px] font-black tracking-[-0.02em] text-[#0F1512]">Modifier {editMeta.sub.toLowerCase()}</h2>
				<button type="button" class="grid h-11 w-11 -mr-2 -mt-1.5 place-items-center rounded-full text-[#66716B] hover:bg-[#F6F8F6]" aria-label="Fermer" onclick={() => (edit = null)}>
					<Icon name="x" size={20} />
				</button>
			</div>

			<div class="mt-[18px] text-[11.5px] font-black uppercase tracking-[0.1em] text-[#7B857F]">Date</div>
			<div class="mt-2 flex h-[52px] items-center rounded-[16px] border-[1.5px] border-[#E3E8E5] bg-[#F6F8F6] px-4 text-[16px] font-bold text-[#0F1512]">
				{longDate(edit.date)}
			</div>

			<label class="fld mt-3.5 flex h-[56px] items-center gap-3 rounded-[18px] border-[1.5px] border-[#E3E8E5] bg-white px-4">
				<Icon name={editMeta.icon} size={22} class="shrink-0 text-brand" />
				<span class="min-w-0 flex-1 text-[16px] font-black text-[#0F1512]">{editMeta.sub}</span>
				<input type="text" inputmode="decimal" class="w-24 border-0 bg-transparent text-right font-display text-[18px] font-black text-[#0F1512] outline-none" bind:value={editValue} />
				<span class="w-6 text-[14px] text-[#7B857F]">{editMeta.unit}</span>
			</label>

			{#if editError}
				<p class="mt-3 rounded-xl bg-danger-light px-3 py-2 text-sm text-danger">{editError}</p>
			{/if}

			<div class="mt-[18px] flex gap-2.5">
				<button type="button" class="grid h-[56px] w-[56px] shrink-0 place-items-center rounded-full border-2 border-danger text-danger transition hover:bg-danger-light disabled:opacity-60" disabled={editSaving} aria-label="Supprimer cette valeur" title="Supprimer cette valeur" onclick={deleteEdit}><Icon name="trash" size={20} /></button>
				<button type="button" class="tap flex h-[56px] flex-1 items-center justify-center rounded-[28px] bg-[#111A15] text-[16px] font-bold text-white shadow-[0_14px_28px_-12px_rgba(15,21,18,0.5)] transition hover:bg-[#0F1512] disabled:opacity-60" disabled={editSaving} onclick={saveEdit}>
					{editSaving ? 'Enregistrement…' : 'Enregistrer la modification'}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- ═══════════ Édition de la taille (maquette SheetTaille.svelte) ═══════════ -->
{#if heightEdit}
	<div role="presentation" transition:fade={sheetFade()} class="fixed inset-0 z-[60] flex items-end justify-center bg-[#0F1512]/38 backdrop-blur-sm sm:items-center sm:p-6" onclick={(e) => { if (e.target === e.currentTarget && !saving) heightEdit = false; }} onkeydown={(e) => { if (e.key === 'Escape' && !saving) heightEdit = false; }}>
		<div transition:fly={sheetFly()} class="w-full max-w-lg rounded-t-[30px] bg-white px-5 pb-7 pt-[22px] shadow-[0_-20px_50px_-20px_rgba(15,21,18,0.35)] sm:rounded-[30px]">
			<h2 class="font-display text-[20px] font-black tracking-[-0.02em] text-[#0F1512]">Ta taille</h2>
			<p class="mt-1 text-[13.5px] text-[#66716B]">Renseignée une seule fois (cm).</p>
			<div class="mt-4 flex items-center gap-2.5">
				<label class="fld flex h-[64px] flex-1 items-center justify-center rounded-[20px] border-[1.5px] border-[#E3E8E5] bg-[#F6F8F6]">
					<input type="text" inputmode="decimal" class="w-full border-0 bg-transparent text-center font-display text-[28px] font-black text-[#0F1512] outline-none" bind:value={heightInput} placeholder="Ex. 168" />
				</label>
				<span class="w-6 text-[14px] font-semibold text-[#7B857F]">cm</span>
			</div>
			{#if heightError}
				<p class="mt-3 rounded-xl bg-danger-light px-3 py-2 text-sm text-danger">{heightError}</p>
			{/if}
			<button type="button" class="tap mt-[18px] flex h-[56px] w-full items-center justify-center rounded-[28px] bg-[#111A15] text-[16px] font-bold text-white shadow-[0_14px_28px_-12px_rgba(15,21,18,0.5)] transition hover:bg-[#0F1512]" disabled={saving} onclick={saveHeight}>
				{saving ? 'Enregistrement…' : 'Enregistrer la taille'}
			</button>
		</div>
	</div>
{/if}