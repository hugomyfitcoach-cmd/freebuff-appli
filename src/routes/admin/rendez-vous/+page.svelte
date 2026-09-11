<script lang="ts">
	/**
	 * Rendez-vous (coach) — planning hebdo + disponibilités + réservation.
	 *
	 * FLOW DE RÉSERVATION (réutilise le moteur serveur /api/appointments/availability) :
	 * 1. Par défaut, le planning est en MODE OBSERVATION : il montre uniquement
	 *    l'état réel (plages de disponibilités + RDV posés). Aucun créneau
	 *    n'est sélectionnable, aucun état « dispo / pas dispo » lié à une durée.
	 * 2. Pour créer un RDV, on choisit d'abord le TYPE (« Suivi » ou « Démarrage ») :
	 *    la durée réelle (15 / 60 min + buffers) est calculée par le moteur,
	 *    les créneaux impossibles sont grisés, seuls les créneaux réellement
	 *    réservables sont mis en évidence.
	 * 3. Clic sur un créneau réservable → modale de choix de la cliente.
	 * 4. Clic sur un RDV existant (bloc vert / orange) → aperçu : cliente,
	 *    type, horaire / durée — avec replanification et annulation.
	 */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import Icon from '$lib/components/Icon.svelte';
	import {
		fetchAvailability,
		fromMin,
		kindRule,
		prettyDate,
		toISO,
		toMin,
		type Rdv,
	} from '$lib/appointments';

	type Range = { day: number; start: string; end: string };
	type ClientRow = { user: { _id: string; prenom: string; nom?: string | null } };
	type Picking = { date: string; time: string; endTime: string; kind: string; clientId: string };

	const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
	/** §6 : seuls Suivi (15 min) et Démarrage (60 min) sont réservables — les
	 *  anciens types restent affichés sur les RDV historiques, jamais proposés. */
	const KINDS = ['Suivi', 'Démarrage'];

	let loading = $state(true);
	let pageErr = $state('');
	let notice = $state('');
	let settings = $state<Range[]>([]);
	let rdvs = $state<Rdv[]>([]);
	let clients = $state<ClientRow[]>(page.data.clients ?? []);
	let weekStart = $state(mondayOf(new Date()));
	let editing = $state(false);
	let draft = $state<Range[]>([]);

	/** Mode du planning : '' = observation (aucun créneau sélectionnable). */
	let viewKind = $state('');
	/** Créneau cliqué en mode réservation → modale (cliente / déplacement). */
	let reserving = $state<Picking | null>(null);
	/** Replanification d'un RDV existant (le type est verrouillé sur le sien). */
	let rescheduleFrom = $state<Rdv | null>(null);
	/** Aperçu d'un RDV existant (clic sur un bloc vert / orange). */
	let previewRdv = $state<Rdv | null>(null);

	/** Créneaux réellement réservables par jour (moteur serveur) : date → heures de début. */
	let avail = $state<Record<string, string[]>>({});
	let availLoading = $state(false);
	let availErr = $state('');

	function mondayOf(d: Date): string {
		const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate());
		const day = (dt.getDay() + 6) % 7; // 0 = lundi
		dt.setDate(dt.getDate() - day);
		return toISO(dt);
	}
	function addDays(iso: string, n: number): string {
		const d = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
		d.setDate(d.getDate() + n);
		return toISO(d);
	}
	function label(iso: string): string {
		const d = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
		return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
	}
	const fullName = (c: ClientRow) => (c.user.nom ? `${c.user.prenom} ${c.user.nom}` : c.user.prenom);
	/** Cliente POSÉE sur le RDV ( bookedByName = qui a réservé, pas forcément la cliente). */
	function clientNameOf(r: Rdv): string {
		const c = clients.find((x) => x.user._id === r.clientId);
		return c ? fullName(c) : (r.bookedByName ?? 'Cliente');
	}
	function rdvDuration(r: Rdv): number {
		return toMin(r.endTime) - toMin(r.time);
	}

	async function loadAll() {
		pageErr = '';
		try {
			const [s, r] = await Promise.all([
				fetch('/api/appointments/settings').then((x) => x.json()),
				fetch('/api/appointments').then((x) => x.json()),
			]);
			if (s.error) throw new Error(s.error);
			settings = s.settings?.ranges ?? [];
			rdvs = r.appointments ?? [];
		} catch (e) {
			pageErr = e instanceof Error ? e.message : 'Chargement impossible.';
		} finally {
			loading = false;
		}
		// Le planning a changé (RDV posé / annulé / déplacé) → crèneaux à jour.
		if (viewKind) void loadAvail(viewKind, weekStart, rescheduleFrom?._id ?? null);
	}
	onMount(loadAll);

	/** Créneaux réellement réservables (moteur serveur) pour le type et la semaine. */
	async function loadAvail(kind: string, week: string, excludeId: string | null) {
		availLoading = true;
		availErr = '';
		try {
			const res = await fetchAvailability({ date: week, kind, days: 7, excludeId: excludeId ?? undefined });
			const map: Record<string, string[]> = {};
			for (const d of res.days) map[d.date] = d.slots.map((s) => s.start);
			avail = map;
		} catch (e) {
			avail = {};
			availErr = e instanceof Error ? e.message : 'Disponibilités indisponibles.';
		} finally {
			availLoading = false;
		}
	}
	// Changement de type, de semaine ou de replanification → recalcule les créneaux.
	$effect(() => {
		const kind = viewKind;
		const week = weekStart;
		const excludeId = rescheduleFrom?._id ?? null;
		if (!kind) {
			avail = {};
			availErr = '';
			return;
		}
		void loadAvail(kind, week, excludeId);
	});

	/* ── Modes ── */
	function stopMode() {
		viewKind = '';
		rescheduleFrom = null;
	}
	function startReschedule(r: Rdv) {
		previewRdv = null;
		rescheduleFrom = r;
		// Type verrouillé sur celui du RDV (durée réelle identique). Les anciens
		// types historiques retombent sur la durée de repli du moteur (30 min).
		viewKind = r.kind;
	}

	/** Créneaux (grille 30 min) d'un jour, déduits des disponibilités. */
	function slotsFor(iso: string): { start: string; end: string }[] {
		const dayIdx = (new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))).getDay() + 6) % 7 + 1;
		const out: { start: string; end: string }[] = [];
		for (const r of settings.filter((x) => x.day === dayIdx)) {
			for (let m = toMin(r.start); m + 30 <= toMin(r.end); m += 30) {
				out.push({ start: fromMin(m), end: fromMin(m + 30) });
			}
		}
		return out;
	}
	const daysOfWeek = $derived(Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)));
	const rdvAt = (iso: string, start: string) =>
		rdvs.find((r) => r.date === iso && r.time <= start && r.endTime > start && r.status !== 'cancelled');
	const pending = $derived(rdvs.filter((r) => r.status === 'client_request'));
	const upcoming = $derived(
		rdvs
			.filter((r) => r.status === 'on_book' && `${r.date}T${r.time}` >= `${toISO(new Date())}T00:00`)
			.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
	);

	function startEdit() {
		draft = settings.length ? settings.map((r) => ({ ...r })) : [{ day: 1, start: '09:00', end: '12:30' }];
		editing = true;
	}
	async function saveSettings() {
		try {
			const res = await fetch('/api/appointments/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ranges: draft }),
			});
			const j = await res.json();
			if (!res.ok) throw new Error(j.error);
			settings = j.ranges ?? draft;
			editing = false;
			notice = 'Disponibilités enregistrées.';
		} catch (e) {
			pageErr = e instanceof Error ? e.message : 'Erreur';
		}
	}

	/** Clic sur un créneau mis en évidence → modale (cliente ou déplacement). */
	function openSlot(iso: string, start: string) {
		if (!viewKind) return;
		reserving = {
			date: iso,
			time: start,
			endTime: fromMin(toMin(start) + kindRule(viewKind).durationMin),
			kind: viewKind,
			clientId: '',
		};
	}
	async function book(clientId: string, clientName: string, date: string, time: string, endTime: string, kind: string) {
		try {
			const res = await fetch('/api/appointments', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ clientId, clientName, date, time, endTime, kind }),
			});
			const j = await res.json();
			if (!res.ok) throw new Error(j.error);
			notice = j.googleEventId ? 'Rendez-vous confirmé + ajouté à Google Calendar ✓' : 'Rendez-vous confirmé (Google Calendar non connecté — événement non créé).';
			reserving = null;
			await loadAll();
		} catch (e) {
			pageErr = e instanceof Error ? e.message : 'Erreur';
			// Créneau pris entre-temps → recharge les créneaux à jour.
			if (viewKind) void loadAvail(viewKind, weekStart, rescheduleFrom?._id ?? null);
		}
	}
	async function confirmReq(r: Rdv) {
		try {
			const res = await fetch('/api/appointments', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ requestId: r._id }),
			});
			const j = await res.json();
			if (!res.ok) throw new Error(j.error);
			notice = j.wasReschedule
				? 'Replanification confirmée' + (j.googleEventId ? ' — événement Google déplacé ✓' : ' ✓')
				: j.googleEventId
					? 'Rendez-vous confirmé + ajouté à Google Calendar ✓'
					: 'Rendez-vous confirmé (Google Calendar non connecté — événement non créé).';
			previewRdv = null;
			await loadAll();
		} catch (e) {
			pageErr = e instanceof Error ? e.message : 'Erreur';
		}
	}
	async function move(rdv: Rdv, date: string, time: string, endTime: string) {
		try {
			const res = await fetch(`/api/appointments/${rdv._id}${rdv.googleEventId ? `?eventId=${encodeURIComponent(rdv.googleEventId)}` : ''}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ date, time, endTime, googleEventId: rdv.googleEventId }),
			});
			const j = await res.json();
			if (!res.ok) throw new Error(j.error);
			notice = 'Rendez-vous replanifié ✓';
			rescheduleFrom = null;
			reserving = null;
			await loadAll();
		} catch (e) {
			pageErr = e instanceof Error ? e.message : 'Erreur';
			if (viewKind) void loadAvail(viewKind, weekStart, rescheduleFrom?._id ?? null);
		}
	}
	async function cancelRdv(rdv: Rdv) {
		try {
			const res = await fetch(`/api/appointments/${rdv._id}${rdv.googleEventId ? `?eventId=${encodeURIComponent(rdv.googleEventId)}` : ''}`, { method: 'DELETE' });
			const j = await res.json();
			if (!res.ok) throw new Error(j.error);
			notice = 'Rendez-vous annulé.';
			if (previewRdv?._id === rdv._id) previewRdv = null;
			await loadAll();
		} catch (e) {
			pageErr = e instanceof Error ? e.message : 'Erreur';
		}
	}
	function confirmReserving() {
		if (!reserving) return;
		if (rescheduleFrom) {
			void move(rescheduleFrom, reserving.date, reserving.time, reserving.endTime);
		} else {
			const c = clients.find((x) => x.user._id === reserving!.clientId);
			void book(reserving!.clientId, c ? fullName(c) : 'Cliente', reserving!.date, reserving!.time, reserving!.endTime, reserving!.kind);
		}
	}
</script>

<svelte:head><title>Rendez-vous — CRM G-Flux</title></svelte:head>

<div class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
	<header class="mb-5 flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
				<Icon name="calendarCheck" size={22} class="text-brand" /> Rendez-vous
			</h1>
			<p class="mt-0.5 text-sm text-mist">Disponibilités, réservations et demandes de tes clientes — synchronisés avec ton Google Calendar.</p>
		</div>
		<button type="button" onclick={editing ? () => (editing = false) : startEdit} class="inline-flex items-center gap-1 rounded-lg border-2 border-line px-3 py-1.5 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand">
			<Icon name="settings" size={15} /> {editing ? 'Fermer' : 'Disponibilités'}
		</button>
	</header>

	{#if pageErr}<p class="mb-4 rounded-xl border-2 border-danger bg-danger-light px-4 py-3 text-sm text-danger">{pageErr}</p>{/if}
	{#if notice}<p class="mb-4 rounded-xl border border-brand/40 bg-brand-light px-4 py-3 text-sm font-semibold text-ink">{notice}</p>{/if}

	{#if loading}
		<p class="py-16 text-center text-sm text-mist">Chargement…</p>
	{:else}
		<!-- ── Éditeur de disponibilités ── -->
		{#if editing}
			<section class="mb-6 rounded-2xl border border-line bg-card p-4">
				<h2 class="mb-3 flex items-center gap-2 font-display text-lg font-semibold text-ink"><Icon name="clock" size={17} class="text-brand" /> Mes disponibilités hebdo</h2>
				<div class="space-y-2">
					{#each draft as r, i (i)}
						<div class="flex flex-wrap items-center gap-2 text-sm">
							<select class="rounded-lg border border-line bg-white px-2 py-1.5" bind:value={draft[i].day}>
								{#each DAYS as d, di}<option value={di + 1}>{d}</option>{/each}
							</select>
							<input type="time" class="rounded-lg border border-line bg-white px-2 py-1.5" step={1800} bind:value={draft[i].start} />
							<span class="text-mist">→</span>
							<input type="time" class="rounded-lg border border-line bg-white px-2 py-1.5" step={1800} bind:value={draft[i].end} />
							<button type="button" class="ml-1 text-mist transition hover:text-danger" onclick={() => (draft = draft.filter((_, k) => k !== i))} aria-label="Retirer cette plage"><Icon name="trash" size={15} /></button>
						</div>
					{/each}
				</div>
				<div class="mt-3 flex flex-wrap gap-2">
					<button type="button" class="rounded-lg border-2 border-line px-3 py-1.5 text-sm font-semibold text-ink transition hover:border-brand" onclick={() => (draft = [...draft, { day: 1, start: '09:00', end: '12:30' }])}><Icon name="plus" size={14} class="inline" /> Ajouter une plage</button>
					<button type="button" class="rounded-lg bg-brand px-4 py-1.5 text-sm font-bold text-white transition hover:bg-brand-dark" onclick={saveSettings}>Enregistrer</button>
				</div>
			</section>
		{/if}

		<!-- ── Barre de mode : observation par défaut, réservation par type ── -->
		<section class="mb-4 rounded-2xl border border-line bg-card p-3">
			<div class="flex flex-wrap items-center gap-2">
				<span class="mr-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-mist">
					<Icon name={viewKind ? 'calendarCheck' : 'eye'} size={14} class="text-brand" />
					{viewKind ? 'Réservation' : 'Observation'}
				</span>
				{#each KINDS as k (k)}
					<button
						type="button"
						disabled={!!rescheduleFrom}
						onclick={() => (viewKind = viewKind === k ? '' : k)}
						class="rounded-full border-2 px-3 py-1 text-xs font-bold transition {viewKind === k ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink hover:border-brand disabled:opacity-40'}"
					>
						{k} · {kindRule(k).durationMin} min
					</button>
				{/each}
				{#if viewKind}
					<button type="button" onclick={stopMode} class="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-mist transition hover:text-danger">
						<Icon name="x" size={13} /> Fermer
					</button>
				{/if}
			</div>
			<p class="mt-2 text-xs text-mist">
				{#if rescheduleFrom}
					Replanification de <strong class="text-ink">{clientNameOf(rescheduleFrom)}</strong> — clique un créneau en surbrillance pour déplacer son rendez-vous ({kindRule(viewKind).durationMin} min).
				{:else if viewKind}
					Créneaux réellement réservables en <strong class="text-brand-dark">surbrillance</strong> pour « {viewKind} » ({kindRule(viewKind).durationMin} min) — les autres (occupés, buffers, trop courts) sont grisés.
				{:else}
					Consultation simple du planning. Choisis « Suivi » ou « Démarrage » pour réserver un créneau, ou clique un rendez-vous existant pour voir son détail.
				{/if}
			</p>
			{#if availErr}<p class="mt-1 text-xs text-danger">{availErr}</p>{/if}
		</section>

		<!-- ── Demandes à valider ── -->
		{#if pending.length > 0}
			<section class="mb-6 rounded-2xl border border-warn/40 bg-warn-light/40 p-4">
				<h2 class="mb-2 flex items-center gap-2 font-display text-lg font-semibold text-ink"><Icon name="bell" size={17} class="text-warn" /> Demandes de rendez-vous ({pending.length})</h2>
				{#each pending as r (r._id)}
					<div class="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white px-3 py-2 text-sm">
						<span><strong>{clientNameOf(r)}</strong> demande <strong>{r.kind}</strong> — {label(r.date)} · {r.time}–{r.endTime}</span>
						<span class="flex gap-2">
							<button type="button" class="rounded-lg bg-brand px-3 py-1 text-xs font-bold text-white transition hover:bg-brand-dark" onclick={() => confirmReq(r)}>Confirmer</button>
							<button type="button" class="rounded-lg border-2 border-line px-3 py-1 text-xs font-semibold text-ink transition hover:border-danger hover:text-danger" onclick={() => cancelRdv(r)}>Refuser</button>
						</span>
					</div>
				{/each}
			</section>
		{/if}

		<!-- ── Prochains rendez-vous ── -->
		{#if upcoming.length > 0}
			<section class="mb-6 rounded-2xl border border-line bg-card p-4">
				<h2 class="mb-2 flex items-center gap-2 font-display text-lg font-semibold text-ink"><Icon name="calendarDays" size={17} class="text-brand" /> Prochains rendez-vous</h2>
				{#each upcoming.slice(0, 6) as r (r._id)}
					<div class="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-cream/40 px-3 py-2 text-sm">
						<span><strong>{clientNameOf(r)}</strong> · {r.kind} — <span class="tabular-nums">{label(r.date)} · {r.time}–{r.endTime}</span>{r.rescheduleCount > 0 ? ` · replanifié ×${r.rescheduleCount}` : ''}{r.googleEventId ? ' · 📅 Google ✓' : ''}</span>
						<span class="flex gap-2">
							<button type="button" class="rounded-lg border-2 border-line px-3 py-1 text-xs font-semibold text-ink transition hover:border-brand hover:text-brand" onclick={() => startReschedule(r)}>Replanifier</button>
							<button type="button" class="rounded-lg border-2 border-line px-3 py-1 text-xs font-semibold text-ink transition hover:border-danger hover:text-danger" onclick={() => cancelRdv(r)}>Annuler</button>
						</span>
					</div>
				{/each}
			</section>
		{/if}

		<!-- ── Semaine ── -->
		<section class="rounded-2xl border border-line bg-card p-4">
			<div class="mb-3 flex items-center justify-between gap-2">
				<h2 class="flex items-center gap-2 font-display text-lg font-semibold text-ink"><Icon name="calendarRange" size={17} class="text-brand" /> Semaine du {label(weekStart)}</h2>
				<div class="flex items-center gap-1">
					{#if viewKind && availLoading}<span class="mr-1 text-[11px] italic text-mist">Calcul des créneaux…</span>{/if}
					<button type="button" class="rounded-lg border-2 border-line px-2 py-1 text-sm text-ink transition hover:border-brand" onclick={() => (weekStart = addDays(weekStart, -7))} aria-label="Semaine précédente"><Icon name="chevronLeft" size={15} /></button>
					<button type="button" class="rounded-lg border-2 border-line px-2 py-1 text-xs font-semibold text-ink transition hover:border-brand" onclick={() => (weekStart = mondayOf(new Date()))}>Aujourd'hui</button>
					<button type="button" class="rounded-lg border-2 border-line px-2 py-1 text-sm text-ink transition hover:border-brand" onclick={() => (weekStart = addDays(weekStart, 7))} aria-label="Semaine suivante"><Icon name="chevronRight" size={15} /></button>
				</div>
			</div>
			<div class="grid gap-2 overflow-x-auto sm:grid-cols-7">
				{#each daysOfWeek as iso (iso)}
					<div class="min-w-32 rounded-xl border border-line bg-cream/30 p-2">
						<div class="mb-1.5 text-center text-[11px] font-bold uppercase tracking-wide text-mist">{label(iso)}</div>
						{#if slotsFor(iso).length === 0}
							<p class="py-2 text-center text-[11px] italic text-mist">Indisponible</p>
						{:else}
							<div class="space-y-1">
								{#each slotsFor(iso) as s (`${iso}-${s.start}`)}
									{@const rdv = rdvAt(iso, s.start)}
									{@const rdvStarts = rdv?.time === s.start}
									{@const taken = rdvs.some((r) => r.date === iso && r.status !== 'cancelled' && toMin(r.time) < toMin(s.end) && toMin(r.endTime) > toMin(s.start) && r._id !== rdv?._id)}
									{@const bookable = !!viewKind && !rdv && !taken && (avail[iso] ?? []).includes(s.start)}
									{#if rdv}
										<!-- RDV existant : aperçu au clic (vert = confirmé, orange = demande) -->
										<button
											type="button"
											onclick={() => (previewRdv = rdv)}
											title={`${clientNameOf(rdv)} · ${rdv.kind} · ${rdv.time}–${rdv.endTime}`}
											class="w-full rounded-lg px-1.5 py-1 text-[11px] font-semibold tabular-nums transition {rdv.status === 'client_request' ? 'bg-warn-light text-warn hover:bg-warn hover:text-white' : 'bg-brand text-white hover:bg-brand-dark'}"
										>
											{rdvStarts ? `${s.start} · ${rdv.kind}` : s.start}
										</button>
									{:else if taken}
										<span class="block w-full rounded-lg bg-line/40 px-1.5 py-1 text-[11px] font-semibold tabular-nums text-mist line-through">{s.start}</span>
									{:else if bookable}
										<!-- Créneau réellement réservable (moteur : dispo − Google − RDV − buffers) -->
										<button
											type="button"
											onclick={() => openSlot(iso, s.start)}
											title={`Réserver « ${viewKind} » · ${kindRule(viewKind).durationMin} min`}
											class="w-full rounded-lg bg-white px-1.5 py-1 text-[11px] font-bold tabular-nums text-brand-dark ring-2 ring-brand/50 transition hover:bg-brand hover:text-white"
										>
											{s.start}
										</button>
									{:else if viewKind}
										<!-- Impossible pour ce type (occupé, buffer ou durée trop courte) -->
										<span class="block w-full cursor-not-allowed rounded-lg bg-cream/60 px-1.5 py-1 text-[11px] font-semibold tabular-nums text-mist/70" title={`Indisponible pour « ${viewKind} »`}>{s.start}</span>
									{:else}
										<!-- Observation : état réel, non sélectionnable -->
										<span class="block w-full rounded-lg bg-white px-1.5 py-1 text-[11px] font-semibold tabular-nums text-ink">{s.start}</span>
									{/if}
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</section>
	{/if}
</div>

<!-- ── Aperçu d'un rendez-vous existant ── -->
{#if previewRdv}
	<div class="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) previewRdv = null; }}>
		<div class="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
			<div class="mb-3 flex items-start justify-between gap-2">
				<h3 class="font-display text-lg font-semibold text-ink">Aperçu du rendez-vous</h3>
				<button type="button" onclick={() => (previewRdv = null)} class="text-mist transition hover:text-ink" aria-label="Fermer"><Icon name="x" size={16} /></button>
			</div>
			<div class="rounded-xl border border-line bg-cream/40 p-4">
				<p class="flex items-center gap-2 font-display text-lg font-semibold text-ink">
					<Icon name="users" size={18} class="text-brand" /> {clientNameOf(previewRdv)}
				</p>
				<dl class="mt-3 space-y-1.5 text-sm">
					<div class="flex justify-between gap-3"><dt class="text-mist">Type</dt><dd class="font-semibold text-ink">{previewRdv.kind} · {rdvDuration(previewRdv)} min</dd></div>
					<div class="flex justify-between gap-3"><dt class="text-mist">Date</dt><dd class="font-semibold capitalize text-ink">{prettyDate(previewRdv.date)}</dd></div>
					<div class="flex justify-between gap-3"><dt class="text-mist">Horaire</dt><dd class="font-semibold tabular-nums text-ink">{previewRdv.time} – {previewRdv.endTime}</dd></div>
					<div class="flex justify-between gap-3">
						<dt class="text-mist">Statut</dt>
						<dd>
							{#if previewRdv.status === 'client_request'}
								<span class="rounded-full bg-warn-light px-2 py-0.5 text-xs font-bold text-warn">Demande à valider</span>
							{:else}
								<span class="rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-white">Confirmé</span>
							{/if}
						</dd>
					</div>
					{#if previewRdv.googleEventId}
						<div class="flex justify-between gap-3"><dt class="text-mist">Google Calendar</dt><dd class="font-semibold text-ink">Synchronisé ✓</dd></div>
					{/if}
					{#if previewRdv.rescheduleCount > 0}
						<div class="flex justify-between gap-3"><dt class="text-mist">Replanifications</dt><dd class="font-semibold text-ink">×{previewRdv.rescheduleCount}</dd></div>
					{/if}
				</dl>
			</div>
			<div class="mt-4 flex flex-wrap justify-end gap-2">
				<button type="button" class="rounded-lg border-2 border-line px-3 py-1.5 text-sm font-semibold text-ink" onclick={() => (previewRdv = null)}>Fermer</button>
				{#if previewRdv.status === 'client_request'}
					<button type="button" class="rounded-lg bg-brand px-4 py-1.5 text-sm font-bold text-white transition hover:bg-brand-dark" onclick={() => confirmReq(previewRdv!)}>Confirmer</button>
					<button type="button" class="rounded-lg border-2 border-line px-3 py-1.5 text-sm font-semibold text-ink transition hover:border-danger hover:text-danger" onclick={() => cancelRdv(previewRdv!)}>Refuser</button>
				{:else}
					<button type="button" class="rounded-lg border-2 border-line px-3 py-1.5 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand" onclick={() => startReschedule(previewRdv!)}>Replanifier</button>
					<button type="button" class="rounded-lg border-2 border-line px-3 py-1.5 text-sm font-semibold text-ink transition hover:border-danger hover:text-danger" onclick={() => cancelRdv(previewRdv!)}>Annuler le RDV</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

<!-- ── Modale réservation (choix de la cliente) / replanification ── -->
{#if reserving}
	<div class="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) { reserving = null; } }}>
		<div class="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
			<h3 class="mb-1 font-display text-lg font-semibold text-ink">
				{rescheduleFrom ? 'Déplacer le rendez-vous' : `Réserver · ${reserving.kind}`}
			</h3>
			<p class="mb-3 text-xs text-mist">
				{rescheduleFrom
					? `${clientNameOf(rescheduleFrom)} — actuellement ${label(rescheduleFrom.date)} · ${rescheduleFrom.time}. Nouveau créneau :`
					: 'Le créneau confirmé sera ajouté à ton Google Calendar.'}
			</p>
			<div class="mb-4 rounded-xl border border-line bg-cream/40 px-3 py-2 text-sm">
				<strong class="capitalize text-ink">{prettyDate(reserving.date)}</strong>
				<span class="tabular-nums text-ink"> · {reserving.time} – {reserving.endTime}</span>
				<span class="ml-1 rounded-full bg-brand-light px-2 py-0.5 text-[11px] font-bold text-brand-dark">{reserving.kind} · {kindRule(reserving.kind).durationMin} min</span>
			</div>
			{#if !rescheduleFrom}
				<label class="mb-1 block text-xs font-bold uppercase tracking-wide text-mist" for="rdv-client">Cliente</label>
				<select id="rdv-client" class="mb-4 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm" bind:value={reserving.clientId}>
					<option value="" disabled>Choisir une cliente…</option>
					{#each clients as c (c.user._id)}<option value={c.user._id}>{fullName(c)}</option>{/each}
				</select>
			{/if}
			<div class="flex justify-end gap-2">
				<button type="button" class="rounded-lg border-2 border-line px-3 py-1.5 text-sm font-semibold text-ink" onclick={() => (reserving = null)}>Annuler</button>
				{#if rescheduleFrom}
					<button type="button" class="rounded-lg bg-brand px-4 py-1.5 text-sm font-bold text-white transition hover:bg-brand-dark" onclick={confirmReserving}>Déplacer ici</button>
				{:else}
					<button type="button" class="rounded-lg bg-brand px-4 py-1.5 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-50" disabled={!reserving.clientId} onclick={confirmReserving}>Confirmer</button>
				{/if}
			</div>
		</div>
	</div>
{/if}
