<script lang="ts">
	/**
	 * DÉPENSE SPORTIVE — estimation du volume énergétique lié aux activités
	 * sportives réellement réalisées (semaine après semaine).
	 *
	 * ⚠️ RÈGLE FONDAMENTALE (affichée en pied de page) : la dépense sportive
	 * est DÉJÀ prise en compte dans le plan calorique — ces kcal sont un
	 * repère, jamais un crédit calorique.
	 *
	 * Marche quotidienne : JAMAIS proposée (déjà comptée par les pas) — une
	 * recherche « marche » affiche le message pédagogique + la seule
	 * suggestion autorisée (Marche inclinée sur tapis).
	 * Ajout : récents → recherche → catégories ; durée 30/45/60 + libre ;
	 * date = aujourd'hui par défaut (modifiable) ; intensité quand pertinent.
	 */
	import { onMount } from 'svelte';
	import BackToHome from '$lib/components/BackToHome.svelte';
	import Icon from '$lib/components/Icon.svelte';

	type Activity = {
		_id: string;
		date: string;
		activityId: string;
		name: string;
		durationMinutes: number;
		intensity: string | null;
		estimatedCalories: number | null;
		metMinutes: number;
		source: 'manual' | 'gflux_training';
		trainingSessionId: string | null;
	};
	type WeekData = {
		weekStart: string;
		weekEnd: string;
		today: string;
		activities: Activity[];
		totals: { count: number; durationMin: number; kcal: number; metMinutes: number };
	};
	type CatalogActivity = { id: string; name: string; category: string; hasIntensity: boolean };
	type Catalog = {
		version: string;
		categories: { id: string; label: string }[];
		activities: CatalogActivity[];
		walking: { message: string; suggestionId: string };
		intensityLabels: Record<string, string>;
	};

	let loading = $state(true);
	let err = $state('');
	let week = $state<WeekData | null>(null);
	let catalog = $state<Catalog | null>(null);
	let recents = $state<{ activityId: string; name: string; intensity: string | null }[]>([]);

	/* ── Semaine affichée (lundi → dimanche, fuseau local) ── */
	function isoOf(d: Date): string {
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, '0');
		const dd = String(d.getDate()).padStart(2, '0');
		return `${y}-${m}-${dd}`;
	}
	function mondayOf(d: Date): string {
		const x = new Date(d);
		x.setHours(0, 0, 0, 0);
		const day = x.getDay();
		x.setDate(x.getDate() + (day === 0 ? -6 : 1 - day));
		return isoOf(x);
	}
	function addDays(iso: string, n: number): string {
		const d = new Date(iso + 'T12:00:00');
		d.setDate(d.getDate() + n);
		return isoOf(d);
	}
	let weekStart = $state(mondayOf(new Date()));
	const isCurrentWeek = $derived(weekStart === mondayOf(new Date()));

	function weekLabel(start: string): string {
		const monday = new Date(start + 'T12:00:00');
		const sunday = new Date(monday.getTime() + 6 * 86400000);
		const fmt = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
		const y = monday.getFullYear() !== new Date().getFullYear() ? ` ${monday.getFullYear()}` : '';
		return `Semaine du ${fmt(monday)} au ${fmt(sunday)}${y}`;
	}
	function dayLabel(iso: string): string {
		const d = new Date(iso + 'T12:00:00');
		const today = isoOf(new Date());
		if (iso === today) return "Aujourd'hui";
		return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
	}
	function durationLabel(min: number): string {
		const h = Math.floor(min / 60);
		const m = min % 60;
		if (h === 0) return `${m} min`;
		return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
	}

	async function loadWeek(target?: string) {
		try {
			const r = await fetch(`/api/sport?weekStart=${target ?? weekStart}`).then((x) => x.json());
			if (r.error) throw new Error(r.error);
			week = r as WeekData;
			weekStart = r.weekStart as string;
		} catch (e) {
			// Repli gracieux : backend sans le module (fonctions Convex pas encore
			// déployées) → état vide propre, JAMAIS d'écran bloquant ni d'erreur
			// brute — la règle « ne jamais empêcher la cliente d'utiliser G-FLUX ».
			console.warn('[depense-sportive] chargement semaine :', e instanceof Error ? e.message : e);
			if (!week || target !== weekStart) {
				week = {
					weekStart: target ?? weekStart,
					weekEnd: addDays(target ?? weekStart, 6),
					today: isoOf(new Date()),
					activities: [],
					totals: { count: 0, durationMin: 0, kcal: 0, metMinutes: 0 },
				};
			}
		}
	}
	async function shiftWeek(delta: number) {
		try {
			await loadWeek(addDays(weekStart, delta * 7));
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
		}
	}

	/* ── Feuille d'ajout / modification ── */
	let sheetOpen = $state(false);
	/** editing : _id de l'activité modifiée · duplicating : _id copié · null = ajout. */
	let editingId = $state<string | null>(null);
	let duplicatingId = $state<string | null>(null);
	let formDate = $state('');
	let formActivityId = $state('');
	let formIntensity = $state<string | null>(null);
	let formDuration = $state<number | null>(60);
	let formCustomDuration = $state('');
	let search = $state('');
	let sheetStep = $state<'sport' | 'details'>('sport');
	let saving = $state(false);
	let confirmDeleteId = $state<string | null>(null);

	const formEntry = $derived(catalog?.activities.find((a) => a.id === formActivityId) ?? null);

	const filteredCatalog = $derived.by(() => {
		if (!catalog || !Array.isArray(catalog.activities)) return [];
		const q = search.trim().toLowerCase();
		// Le catalogue est déjà sans marche — la recherche « marche » est
		// interceptée ci-dessous (message pédagogique + suggestion tapis).
		return catalog.activities.filter((a) => !q || a.name.toLowerCase().includes(q));
	});
	const isWalkingSearch = $derived(/march(e|er|es|ons|ez|ent)|promenade|promener|balade|ballade/i.test(search));
	const walkingSuggestion = $derived(catalog?.activities.find((a) => a.id === catalog?.walking.suggestionId) ?? null);

	function grouped(q: CatalogActivity[]) {
		if (!catalog || !Array.isArray(catalog.categories)) return [];
		return catalog.categories
			.map((c) => ({ label: c.label, items: q.filter((a) => a.category === c.id) }))
			.filter((g) => g.items.length > 0);
	}

	function openAdd(prefillActivityId?: string, prefillIntensity?: string | null) {
		editingId = null;
		duplicatingId = null;
		sheetStep = prefillActivityId ? 'details' : 'sport';
		formActivityId = prefillActivityId ?? '';
		formIntensity = prefillIntensity ?? null;
		formDate = isoOf(new Date());
		formDuration = 60;
		formCustomDuration = '';
		search = '';
		sheetOpen = true;
	}
	function openEdit(a: Activity) {
		editingId = a._id;
		duplicatingId = null;
		sheetStep = 'details';
		formActivityId = a.activityId;
		formIntensity = a.intensity;
		formDate = a.date;
		formDuration = a.durationMinutes;
		formCustomDuration = '';
		search = '';
		sheetOpen = true;
	}
	async function openDuplicate(a: Activity) {
		try {
			saving = true;
			const r = await fetch('/api/sport', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ duplicateOf: a._id, date: isoOf(new Date()) }),
			}).then((x) => x.json());
			if (r.error) throw new Error(r.error);
			await loadWeek();
			// Pré-remplie : on ouvre la copie en édition (date/durée ajustables).
			const copy = week?.activities.find((x) => x._id === r._id);
			if (copy) openEdit(copy);
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
		} finally {
			saving = false;
		}
	}
	function pickDuration(m: number) {
		formDuration = m;
		formCustomDuration = '';
	}
	function pickCustomDuration() {
		const n = Math.round(Number(formCustomDuration.replace(',', '.')));
		if (Number.isFinite(n) && n >= 1 && n <= 600) {
			formDuration = n;
		} else if (n >= 600) {
			formDuration = 600;
		}
	}
	async function saveSheet() {
		if (!formActivityId || !formDuration) return;
		saving = true;
		err = '';
		try {
			if (editingId) {
				const r = await fetch('/api/sport', {
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						_id: editingId,
						date: formDate,
						activityId: formActivityId,
						...(formIntensity ? { intensity: formIntensity } : {}),
						durationMinutes: formDuration,
					}),
				}).then((x) => x.json());
				if (r.error) throw new Error(r.error);
			} else {
				const r = await fetch('/api/sport', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						date: formDate,
						activityId: formActivityId,
						...(formIntensity ? { intensity: formIntensity } : {}),
						durationMinutes: formDuration,
					}),
				}).then((x) => x.json());
				if (r.error) throw new Error(r.error);
			}
			sheetOpen = false;
			await loadWeek();
			void loadRecents();
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
		} finally {
			saving = false;
		}
	}
	async function deleteActivity(id: string) {
		try {
			const r = await fetch('/api/sport', {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ _id: id }),
			}).then((x) => x.json());
			if (r.error) throw new Error(r.error);
			confirmDeleteId = null;
			await loadWeek();
			void loadRecents();
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
		}
	}
	async function loadRecents() {
		const r = await fetch('/api/sport?recent=1').then((x) => x.json()).catch(() => ({ recents: [] }));
		// Repli gracieux : erreur backend (module pas encore déployé) → [] ;
		// la section « Récents » disparaît simplement, jamais de crash.
		recents = r && !r.error && Array.isArray(r.recents) ? r.recents : [];
	}

	onMount(async () => {
		try {
			await Promise.all([
				loadWeek(),
				fetch('/api/sport?catalog=1')
					.then((x) => x.json())
					.then((j) => {
						// Repli gracieux : réponse d'erreur backend (module pas encore
						// déployé) → catalogue null (jamais un objet sans activities,
						// qui ferait crasher le rendu de la feuille d'ajout).
						catalog = j && !j.error ? (j as Catalog) : null;
					}),
				loadRecents(),
			]);
		} catch {
			/* silencieux : la page reste utilisable en état vide */
		} finally {
			loading = false;
		}
	});

	/** Groupe la liste par jour (avec libellés). */
	const daysGrouped = $derived.by(() => {
		if (!week) return [];
		const groups: { date: string; items: Activity[] }[] = [];
		for (const a of week.activities) {
			const last = groups[groups.length - 1];
			if (last && last.date === a.date) last.items.push(a);
			else groups.push({ date: a.date, items: [a] });
		}
		return groups;
	});
</script>

<svelte:head><title>Dépense sportive — G-Flux</title></svelte:head>

<div class="mx-auto w-full max-w-md px-4 pb-10 pt-3">
	<BackToHome label="Dépense sportive" />

	{#if loading}
		<p class="py-16 text-center text-sm text-mist">Chargement…</p>
	{:else}
		<!-- ═══ Entête + navigation semaine ═══ -->
		<header class="mt-1 flex items-center justify-between gap-2">
			<h1 class="font-display text-2xl font-semibold tracking-tight text-ink">Dépense sportive</h1>
			<button
				type="button"
				onclick={() => openAdd()}
				class="flex items-center gap-1 rounded-xl bg-brand px-3 py-2 text-xs font-bold text-white transition hover:bg-brand-dark"
			>
				<Icon name="plus" size={14} /> Ajouter
			</button>
		</header>

		<div class="mt-3 flex items-center justify-between gap-2 rounded-2xl border border-line bg-card px-3 py-2">
			<button
				type="button"
				onclick={() => shiftWeek(-1)}
				class="rounded-lg px-2 py-1 text-mist transition hover:bg-line/50 hover:text-ink"
				aria-label="Semaine précédente"
			>
				<Icon name="chevronLeft" size={17} />
			</button>
			<p class="text-center text-xs font-semibold text-ink">{weekLabel(weekStart)}</p>
			<button
				type="button"
				onclick={() => shiftWeek(1)}
				disabled={isCurrentWeek}
				class="rounded-lg px-2 py-1 text-mist transition hover:bg-line/50 hover:text-ink disabled:opacity-30"
				aria-label="Semaine suivante"
			>
				<Icon name="chevronRight" size={17} />
			</button>
		</div>

		{#if err}
			<p class="mt-3 rounded-xl bg-danger-light px-3 py-2 text-xs font-semibold text-danger">{err}</p>
		{/if}

		<!-- ═══ Résumé de la semaine ═══ -->
		<section class="mt-4 grid grid-cols-3 gap-2" aria-label="Résumé de la semaine">
			<div class="rounded-2xl border border-line bg-card p-3 text-center">
				<p class="font-display text-xl font-bold text-ink tabular-nums">{week?.totals.count ?? 0}</p>
				<p class="text-[11px] font-semibold uppercase tracking-wide text-mist">activité{((week?.totals.count ?? 0) > 1) ? 's' : ''}</p>
			</div>
			<div class="rounded-2xl border border-line bg-card p-3 text-center">
				<p class="font-display text-xl font-bold text-ink tabular-nums">{durationLabel(week?.totals.durationMin ?? 0)}</p>
				<p class="text-[11px] font-semibold uppercase tracking-wide text-mist">de sport</p>
			</div>
			<div class="rounded-2xl border border-line bg-card p-3 text-center">
				<p class="font-display text-xl font-bold text-ink tabular-nums">≈ {week?.totals.kcal ?? 0}</p>
				<p class="text-[11px] font-semibold uppercase tracking-wide text-mist">kcal estimées</p>
			</div>
		</section>

		<!-- ═══ Liste par jour ═══ -->
		{#if !week || week.activities.length === 0}
			<div class="mt-6 rounded-2xl border border-dashed border-line px-4 py-10 text-center">
				<Icon name="zap" size={22} class="mx-auto text-mist" />
				<p class="mt-2 text-sm font-semibold text-ink">
					{isCurrentWeek ? 'Aucune activité cette semaine' : 'Aucune activité cette semaine-là'}
				</p>
				<p class="mx-auto mt-1 max-w-xs text-xs text-mist">
					{isCurrentWeek ? 'Ajoute tes activités sportives réalisées — même en dehors de tes séances G-FLUX.' : 'Les semaines passées restent consultables ici.'}
				</p>
				{#if isCurrentWeek}
					<button
						type="button"
						onclick={() => openAdd()}
						class="mt-4 rounded-xl bg-brand px-4 py-2 text-xs font-bold text-white transition hover:bg-brand-dark"
					>
						+ Ajouter une activité
					</button>
				{/if}
			</div>
		{:else}
			<div class="mt-5 space-y-4">
				{#each daysGrouped as g (g.date)}
					<section>
						<h2 class="mb-1.5 px-1 text-[11px] font-bold uppercase tracking-widest text-mist">{dayLabel(g.date)}</h2>
						<div class="overflow-hidden rounded-2xl border border-line bg-card">
							{#each g.items as a, i (a._id)}
								<button
									type="button"
									onclick={() => (confirmDeleteId === a._id ? (confirmDeleteId = null) : (confirmDeleteId = a._id))}
									class="flex w-full items-center gap-3 px-3.5 py-3 text-left transition hover:bg-line/20 {i > 0 ? 'border-t border-line/50' : ''}"
								>
									<span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-light text-brand-dark">
										<Icon name={a.source === 'gflux_training' ? 'dumbbell' : 'zap'} size={16} />
									</span>
									<span class="min-w-0 flex-1">
										<span class="block truncate text-sm font-bold text-ink">{a.name}</span>
										<span class="block text-xs text-mist">
											{a.durationMinutes} min{a.intensity && catalog?.intensityLabels[a.intensity] ? ` · ${catalog.intensityLabels[a.intensity]}` : ''}
											· ≈ {a.estimatedCalories ?? '—'}{a.estimatedCalories != null ? ' kcal' : ' (pas de pesée)'}
											{#if a.source === 'gflux_training'}· séance G-FLUX{/if}
										</span>
									</span>
									<Icon name="chevronRight" size={15} class="shrink-0 text-mist" />
								</button>
								{#if confirmDeleteId === a._id}
									<div class="flex flex-wrap items-center gap-1.5 border-t border-line/50 bg-cream/50 px-3.5 py-2">
										<button type="button" onclick={() => openEdit(a)} class="rounded-lg border-2 border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-brand">Modifier</button>
										<button type="button" onclick={() => openDuplicate(a)} disabled={saving} class="rounded-lg border-2 border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-brand disabled:opacity-50">Dupliquer</button>
										<button type="button" onclick={() => deleteActivity(a._id)} class="rounded-lg border-2 border-danger/40 bg-white px-3 py-1.5 text-xs font-semibold text-danger transition hover:border-danger">Supprimer</button>
										<button type="button" onclick={() => (confirmDeleteId = null)} class="ml-auto rounded-lg px-2 py-1.5 text-xs font-semibold text-mist transition hover:text-ink">Fermer</button>
									</div>
								{/if}
							{/each}
						</div>
					</section>
				{/each}
			</div>
		{/if}

		<!-- ═══ Rappel fondamental (jamais un crédit calorique) ═══ -->
		<p class="mt-6 flex items-start gap-2 rounded-2xl bg-cream/60 px-4 py-3 text-xs leading-snug text-ink">
			<Icon name="info" size={14} class="mt-0.5 shrink-0 text-brand" />
			<span>
				Ta dépense sportive est <strong>déjà prise en compte</strong> dans ton plan calorique. Ce suivi permet simplement d'observer l'évolution de ton volume de sport.
			</span>
		</p>
	{/if}
</div>

<!-- ═══════════ Bottom sheet : ajout / modification ═══════════ -->
{#if sheetOpen}
	<button
		type="button"
		class="fixed inset-0 z-[70] cursor-pointer bg-ink/50"
		aria-label="Fermer"
		onclick={() => (sheetOpen = false)}
	></button>
	<div class="fixed inset-x-0 bottom-0 z-[80] mx-auto w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl">
		<div class="flex items-center justify-between">
			<h2 class="font-display text-base font-semibold text-ink">
				{editingId ? 'Modifier' : duplicatingId ? 'Dupliquer' : sheetStep === 'details' ? 'Détails' : 'Quel sport ?'}
			</h2>
			<button type="button" onclick={() => (sheetOpen = false)} class="rounded-lg px-2 py-1 text-lg text-mist hover:text-ink" aria-label="Fermer">✕</button>
		</div>

		{#if sheetStep === 'sport'}
			<!-- Recherche -->
			<input
				type="search"
				bind:value={search}
				placeholder="Rechercher un sport…"
				class="mt-3 w-full rounded-xl border-2 border-line px-3 py-2.5 text-sm outline-none focus:border-brand"
			/>
			{#if isWalkingSearch}
				<!-- Marche quotidienne : JAMAIS un sport standard (déjà dans les pas) -->
				<p class="mt-2 rounded-xl bg-warn-light px-3 py-2 text-xs leading-snug text-ink">{catalog?.walking.message}</p>
				{#if walkingSuggestion}
					<button
						type="button"
						onclick={() => { formActivityId = walkingSuggestion.id; formIntensity = null; sheetStep = 'details'; }}
						class="mt-2 flex w-full items-center justify-between rounded-xl border-2 border-brand/40 bg-brand-light/40 px-3 py-2.5 text-left text-sm font-semibold text-ink transition hover:border-brand"
					>
						{walkingSuggestion.name}
						<Icon name="chevronRight" size={15} class="text-brand" />
					</button>
				{/if}
			{/if}

			<!-- Récents -->
			{#if !search && recents.length > 0}
				<p class="mt-3 text-[11px] font-bold uppercase tracking-widest text-mist">Récents</p>
				<div class="mt-1.5 flex flex-wrap gap-1.5">
					{#each recents as r (r.activityId)}
						<button
							type="button"
							onclick={() => { formActivityId = r.activityId; formIntensity = r.intensity; sheetStep = 'details'; }}
							class="rounded-full border-2 border-line px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-brand"
						>
							{r.name}
						</button>
					{/each}
				</div>
			{/if}

			<!-- Catalogue par catégories -->
			<div class="mt-3 max-h-[38vh] space-y-3 overflow-y-auto pr-0.5">
				{#each grouped(filteredCatalog) as g (g.label)}
					<div>
						<p class="text-[11px] font-bold uppercase tracking-widest text-mist">{g.label}</p>
						<div class="mt-1 grid grid-cols-2 gap-1.5">
							{#each g.items as a (a.id)}
								<button
									type="button"
									onclick={() => { formActivityId = a.id; formIntensity = null; sheetStep = 'details'; }}
									class="rounded-xl border-2 border-line px-3 py-2 text-left text-xs font-semibold text-ink transition hover:border-brand {formActivityId === a.id ? 'border-brand bg-brand-light/40' : ''}"
								>
									{a.name}
								</button>
							{/each}
						</div>
					</div>
				{/each}
				{#if !isWalkingSearch && filteredCatalog.length === 0}
					<p class="py-4 text-center text-xs text-mist">Aucun sport ne correspond.</p>
				{/if}
			</div>
		{:else if formEntry}
			<!-- Détails : date + durée + intensité -->
			<p class="mt-2 flex items-center gap-1.5 text-sm font-bold text-ink">
				<Icon name="zap" size={15} class="text-brand" /> {formEntry.name}
			</p>

			<label class="mt-3 block">
				<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Date</span>
				<input type="date" bind:value={formDate} max={isoOf(new Date())} class="w-full rounded-xl border-2 border-line px-3 py-2.5 text-sm outline-none focus:border-brand" />
			</label>

			<p class="mt-3 text-[10px] font-bold uppercase tracking-wider text-mist">Durée</p>
			<div class="mt-1 flex gap-1.5">
				{#each [30, 45, 60] as m (m)}
					<button
						type="button"
						onclick={() => pickDuration(m)}
						class="flex-1 rounded-xl border-2 py-2 text-sm font-bold transition {formDuration === m && !formCustomDuration ? 'border-brand bg-brand text-white' : 'border-line text-ink hover:border-brand'}"
					>
						{m} min
					</button>
				{/each}
				<input
					type="number"
					inputmode="numeric"
					min="1"
					max="600"
					bind:value={formCustomDuration}
					oninput={pickCustomDuration}
					placeholder="Libre"
					class="w-20 rounded-xl border-2 border-line px-2 py-2 text-center text-sm tabular-nums outline-none focus:border-brand {formCustomDuration ? 'border-brand' : ''}"
				/>
			</div>

			{#if formEntry.hasIntensity}
				<p class="mt-3 text-[10px] font-bold uppercase tracking-wider text-mist">Intensité</p>
				<div class="mt-1 grid grid-cols-3 gap-1.5">
					{#each ['legere', 'moderee', 'intense'] as it (it)}
						<button
							type="button"
							onclick={() => (formIntensity = it)}
							class="rounded-xl border-2 py-2 text-sm font-bold transition {formIntensity === it ? 'border-brand bg-brand text-white' : 'border-line text-ink hover:border-brand'}"
						>
							{catalog?.intensityLabels[it] ?? it}
						</button>
					{/each}
				</div>
			{/if}

			{#if err}
				<p class="mt-2 rounded-lg bg-danger-light px-3 py-2 text-xs font-semibold text-danger">{err}</p>
			{/if}

			<button
				type="button"
				disabled={saving || !formDuration || (formEntry.hasIntensity && !formIntensity)}
				onclick={saveSheet}
				class="mt-4 w-full rounded-xl bg-brand px-5 py-3 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-60"
			>
				{saving ? 'Enregistrement…' : editingId ? 'Enregistrer' : 'Enregistrer'}
			</button>
		{/if}
	</div>
{/if}
