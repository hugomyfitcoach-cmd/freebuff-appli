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
	 *
	 * REFONTE UI (north star mockup) : habillage premium + VRAIE grille
	 * calendaire (gouttière d'heures, blocs RDV positionnés, plages de
	 * disponibilité teintées, colonne du jour marquée) — la logique (moteur
	 * serveur, réservation, replanification, annulation, Google Calendar)
	 * est STRICTEMENT inchangée.
	 */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import Icon from '$lib/components/Icon.svelte';
	import ClientAvatar from '$lib/components/ClientAvatar.svelte';
	import {
		fetchAvailability,
		fromMin,
		kindRule,
		prettyDate,
		SLOT_TAKEN_MESSAGE,
		toISO,
		toMin,
		type Rdv,
	} from '$lib/appointments';
	import { defaultMeetingUrlFor } from '$lib/appointments';

	type Range = { day: number; start: string; end: string };
	type ClientRow = { user: { _id: string; prenom: string; nom?: string | null }; profilePhotoUrl?: string | null };
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

	/** Bandeau « disponibilités » : masquable (état local, revient au rechargement). */
	let bannerHidden = $state(false);

	/** Mode du planning : '' = observation (aucun créneau sélectionnable). */
	let viewKind = $state('');
	/** Créneau cliqué en mode réservation → modale (cliente / déplacement). */
	let reserving = $state<Picking | null>(null);
	/** Lien de visio de la réservation en cours — PRÉREMPLI pour « Démarrage »
	 *  (Meet par défaut), toujours éditable, jamais codé en dur à l'affichage. */
	let reservingUrl = $state('');
	/** Replanification d'un RDV existant (le type est verrouillé sur le sien). */
	let rescheduleFrom = $state<Rdv | null>(null);
	/** Aperçu d'un RDV existant (clic sur un bloc vert / orange). */
	let previewRdv = $state<Rdv | null>(null);

	/** Créneaux réellement réservables par jour (moteur serveur) : date → heures de début. */
	let avail = $state<Record<string, string[]>>({});
	let availLoading = $state(false);
	let availErr = $state('');

	/** Erreur de rendu du planning (boundary) : message lisible + « Réessayer ». */
	function handleRenderError(e: unknown) {
		pageErr = e instanceof Error ? e.message : 'Erreur d\'affichage du planning.';
	}

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
	/** Parties d'une date pour les encarts « jour » (LUN. / 5 / oct.). */
	function dayParts(iso: string): { dow: string; day: number; month: string } {
		const d = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
		return {
			dow: d.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '').toUpperCase(),
			day: d.getDate(),
			month: d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', ''),
		};
	}
	const isToday = (iso: string): boolean => iso === toISO(new Date());
	const hourLabel = (min: number): string => fromMin(min).replace(':', 'h');
	const fullName = (c: ClientRow) => (c.user.nom ? `${c.user.prenom} ${c.user.nom}` : c.user.prenom);
	/** Cliente POSÉE sur le RDV ( bookedByName = qui a réservé, pas forcément la cliente). */
	function clientOf(r: Rdv): ClientRow | undefined {
		return clients.find((x) => x.user._id === r.clientId);
	}
	function clientNameOf(r: Rdv): string {
		const c = clientOf(r);
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

	/** Grille des créneaux : 15 minutes (même grille que le moteur serveur). */
	const SLOT_GRID_STEP_MIN = 15;

	/**
	 * Créneaux (grille 15 min) d'un jour, déduits des disponibilités. C'est la
	 * GRILLE D'AFFICHAGE — l'état réservable de chaque créneau vient du moteur
	 * serveur (`avail`), qui filtre déjà durée + buffers + Google + RDV.
	 */
	function slotsFor(iso: string): { start: string; end: string }[] {
		const dayIdx = (new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))).getDay() + 6) % 7 + 1;
		const seen = new Set<string>();
		const out: { start: string; end: string }[] = [];
		for (const r of settings.filter((x) => x.day === dayIdx)) {
			for (let m = toMin(r.start); m + SLOT_GRID_STEP_MIN <= toMin(r.end); m += SLOT_GRID_STEP_MIN) {
				const hhmm = fromMin(m);
				// Une plage saisie en double (même jour + mêmes heures, comme
				// enregistré un temps en production) produirait deux fois chaque
				// créneau → clé dupliquée dans le keyed each → rendu cassé.
				// L'union des plages est la bonne sémantique : un créneau affiché
				// une seule fois, quel que soit le nombre de plages qui l'ouvrent.
				if (seen.has(hhmm)) continue;
				seen.add(hhmm);
				out.push({ start: hhmm, end: fromMin(m + SLOT_GRID_STEP_MIN) });
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

	/* ── Grille calendaire (rendu) : bornes + positionnement ── */
	/** 22 px par tranche de 15 min → 88 px par heure (dense et lisible). */
	const PX_PER_MIN = 22 / 15;
	const inShownWeek = (r: Rdv) => r.status !== 'cancelled' && r.date >= weekStart && r.date <= addDays(weekStart, 6);
	const gridStartMin = $derived.by(() => {
		let min = Infinity;
		for (const r of settings) min = Math.min(min, toMin(r.start));
		for (const r of rdvs) if (inShownWeek(r)) min = Math.min(min, toMin(r.time));
		if (!isFinite(min)) return 9 * 60;
		return Math.floor(min / 60) * 60;
	});
	const gridEndMin = $derived.by(() => {
		let max = -Infinity;
		for (const r of settings) max = Math.max(max, toMin(r.end));
		for (const r of rdvs) if (inShownWeek(r)) max = Math.max(max, toMin(r.endTime));
		if (!isFinite(max)) return 19 * 60;
		return Math.ceil(max / 60) * 60;
	});
	const gridHours = $derived(
		Array.from({ length: Math.max(1, Math.round((gridEndMin - gridStartMin) / 60)) }, (_, i) => gridStartMin + i * 60)
	);
	const gridHeight = $derived(Math.round((gridEndMin - gridStartMin) * PX_PER_MIN));
	const topPx = (min: number): number => (min - gridStartMin) * PX_PER_MIN;
	const dayIdxOf = (iso: string): number =>
		(new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))).getDay() + 6) % 7 + 1;
	const rangesForDay = (iso: string): Range[] => settings.filter((x) => x.day === dayIdxOf(iso));
	const rdvsForDay = (iso: string): Rdv[] =>
		rdvs.filter((r) => r.date === iso && r.status !== 'cancelled').sort((a, b) => a.time.localeCompare(b.time));

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
		// PRÉREMPLISSAGE automatique du lien de visio pour « Démarrage » (mission) :
		// le Meet par défaut est proposé, la coach garde la main pour l'éditer.
		reservingUrl = defaultMeetingUrlFor(viewKind) ?? '';
	}
	async function book(clientId: string, clientName: string, date: string, time: string, endTime: string, kind: string, meetingUrl?: string) {
		try {
			const res = await fetch('/api/appointments', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ clientId, clientName, date, time, endTime, kind, meetingUrl: meetingUrl?.trim() || undefined }),
			});
			const j = await res.json();
			if (!res.ok) throw new Error(j.error ?? j.message ?? 'Erreur');
			notice = j.googleEventId ? 'Rendez-vous confirmé + ajouté à Google Calendar ✓' : 'Rendez-vous confirmé (Google Calendar non connecté — événement non créé).';
			reserving = null;
			await loadAll();
		} catch (e) {
			pageErr = e instanceof Error ? e.message : 'Erreur';
			// Créneau pris entre-temps (2e vérification serveur) → message exact +
			// recharge immédiate des créneaux réels de la semaine.
			if (e instanceof Error && e.message === SLOT_TAKEN_MESSAGE) {
				pageErr = SLOT_TAKEN_MESSAGE;
				if (viewKind) void loadAvail(viewKind, weekStart, rescheduleFrom?._id ?? null);
			}
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
			if (!res.ok) throw new Error(j.error ?? j.message ?? 'Erreur');
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
			void book(reserving!.clientId, c ? fullName(c) : 'Cliente', reserving!.date, reserving!.time, reserving!.endTime, reserving!.kind, reservingUrl.trim() || undefined);
		}
	}
</script>

<svelte:head><title>Rendez-vous — CRM G-Flux</title></svelte:head>

<div class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
	<!-- ═══ En-tête premium ═══ -->
	<header class="m-in-crm flex flex-wrap items-end justify-between gap-3" style="--m-i: 0">
		<div class="min-w-0">
			<h1 class="flex items-center gap-2.5 font-display text-2xl font-black tracking-tight text-ink">
				<span class="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand-light text-brand-deep"><Icon name="calendarCheck" size={20} /></span>
				Rendez-vous
			</h1>
			<p class="mt-1.5 text-sm text-mist">Disponibilités, réservations et demandes de tes clientes — synchronisés avec ton Google Calendar.</p>
		</div>
		<button
			type="button"
			onclick={editing ? () => (editing = false) : startEdit}
			class="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3.5 py-2 text-[12.5px] font-bold text-ink shadow-sm transition hover:border-brand hover:text-brand"
		>
			<Icon name="settings" size={14} class="shrink-0 text-brand" /> {editing ? 'Fermer' : 'Mes disponibilités'}
		</button>
	</header>

	<!-- ═══ Bandeau disponibilités (qualitatif, masquable) ═══ -->
	{#if !bannerHidden && !editing}
		<div class="m-in-crm mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-brand/25 bg-brand-light/60 px-4 py-3" style="--m-i: 1">
			<span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-brand shadow-sm"><Icon name="calendarClock" size={17} /></span>
			<p class="min-w-0 flex-1 text-[13px] font-semibold text-ink">
				Tu peux gérer tes disponibilités, bloquer des créneaux ou synchroniser ton agenda externe (Google Calendar).
			</p>
			<button
				type="button"
				onclick={startEdit}
				class="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand px-3.5 py-2 text-[12.5px] font-bold text-white shadow-sm transition hover:bg-brand-dark"
			>
				Gérer mes disponibilités <Icon name="arrowRight" size={13} />
			</button>
			<button type="button" onclick={() => (bannerHidden = true)} class="grid h-7 w-7 shrink-0 place-items-center rounded-full text-mist transition hover:bg-white hover:text-ink" aria-label="Masquer ce bandeau">
				<Icon name="x" size={14} />
			</button>
		</div>
	{/if}

	{#if pageErr}<p class="mt-4 rounded-xl border border-danger/40 bg-danger-light px-4 py-3 text-sm text-danger">{pageErr}</p>{/if}
	{#if notice}<p class="mt-4 rounded-xl border border-brand/40 bg-brand-light px-4 py-3 text-sm font-semibold text-ink">{notice}</p>{/if}

	{#if loading}
		<p class="py-16 text-center text-sm text-mist">Chargement…</p>
	{:else}
		<!-- Garde-fou UI : si le rendu plante (donnée inattendue, bug d'affichage),
		     on affiche l'erreur + un bouton « Réessayer » — jamais un « Chargement… »
		     bloqué éternellement (production, sept. 2026 : clé dupliquée). -->
		<svelte:boundary onerror={handleRenderError}>
			{#snippet failed(error: unknown, reset: () => void)}
				<section class="rounded-2xl border border-danger/40 bg-danger-light p-6 text-center">
					<p class="font-display text-lg font-bold text-ink">Impossible d'afficher le planning.</p>
					<p class="mx-auto mt-1 max-w-lg text-sm text-danger">{error instanceof Error ? error.message : 'Erreur inattendue.'}</p>
					<button
						type="button"
						class="mt-4 rounded-full bg-brand px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-dark"
						onclick={() => {
							reset();
							void loadAll();
						}}
					>
						Réessayer
					</button>
				</section>
			{/snippet}

			<!-- ── Éditeur de disponibilités ── -->
			{#if editing}
				<section class="card-crm mt-4 p-4">
					<h2 class="mb-3 flex items-center gap-2 font-display text-[15px] font-bold text-ink"><Icon name="clock" size={16} class="text-brand" /> Mes disponibilités hebdo</h2>
					<div class="space-y-2">
						{#each draft as r, i (i)}
							<div class="flex flex-wrap items-center gap-2 text-sm">
								<select class="rounded-lg border border-line bg-white px-2 py-1.5" bind:value={draft[i].day}>
									{#each DAYS as d, di}<option value={di + 1}>{d}</option>{/each}
								</select>
								<input type="time" class="rounded-lg border border-line bg-white px-2 py-1.5" step={900} bind:value={draft[i].start} />
								<span class="text-mist">→</span>
								<input type="time" class="rounded-lg border border-line bg-white px-2 py-1.5" step={900} bind:value={draft[i].end} />
								<button type="button" class="ml-1 text-mist transition hover:text-danger" onclick={() => (draft = draft.filter((_, k) => k !== i))} aria-label="Retirer cette plage"><Icon name="trash" size={15} /></button>
							</div>
						{/each}
					</div>
					<div class="mt-3 flex flex-wrap gap-2">
						<button type="button" class="rounded-full border border-line bg-white px-3.5 py-2 text-[12.5px] font-bold text-ink transition hover:border-brand" onclick={() => (draft = [...draft, { day: 1, start: '09:00', end: '12:30' }])}><Icon name="plus" size={14} class="inline" /> Ajouter une plage</button>
						<button type="button" class="rounded-full bg-brand px-4 py-2 text-[12.5px] font-bold text-white transition hover:bg-brand-dark" onclick={saveSettings}>Enregistrer</button>
					</div>
				</section>
			{/if}

			<!-- ── Barre de mode : observation par défaut, réservation par type ── -->
			<section class="card-crm m-in-crm mt-4 p-3.5" style="--m-i: 2">
				<div class="flex flex-wrap items-center gap-2">
					<span class="mr-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-mist">
						<Icon name={viewKind ? 'calendarCheck' : 'eye'} size={14} class="text-brand" />
						{viewKind ? 'Réservation' : 'Observation'}
					</span>
					{#each KINDS as k (k)}
						<button
							type="button"
							disabled={!!rescheduleFrom}
							onclick={() => (viewKind = viewKind === k ? '' : k)}
							class="chip-crm {viewKind === k ? 'active-crm' : ''} disabled:opacity-40"
							aria-pressed={viewKind === k}
						>
							{k} · {kindRule(k).durationMin} min
						</button>
					{/each}
					{#if viewKind}
						<button type="button" onclick={stopMode} class="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-mist transition hover:text-danger">
							<Icon name="x" size={13} /> Quitter le mode réservation
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
				<section class="card-crm m-in-crm mt-4 border-warn/40 p-4" style="--m-i: 3">
					<h2 class="mb-2.5 flex items-center gap-2 font-display text-[15px] font-bold text-ink">
						<span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-warn-light text-warn"><Icon name="bell" size={14} /></span>
						Demandes de rendez-vous
						<span class="grid h-5 min-w-5 place-items-center rounded-full bg-warn px-1.5 text-[11px] font-bold text-white">{pending.length}</span>
					</h2>
					<div class="space-y-1.5">
						{#each pending as r (r._id)}
							<div class="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white px-3 py-2.5">
								<ClientAvatar name={clientNameOf(r)} url={clientOf(r)?.profilePhotoUrl ?? null} class="h-9 w-9 text-sm" />
								<p class="min-w-0 flex-1 text-[13px] text-mist">
									<strong class="font-bold text-ink">{clientNameOf(r)}</strong> demande
									<span class="mx-1 inline-flex items-center rounded-full bg-warn-light px-2 py-0.5 text-[10.5px] font-bold text-warn">{r.kind}</span>
									— <span class="tabular-nums">{label(r.date)} · {r.time}–{r.endTime}</span>
								</p>
								<span class="flex shrink-0 gap-2">
									<button type="button" class="rounded-full bg-brand px-3.5 py-1.5 text-[12px] font-bold text-white transition hover:bg-brand-dark" onclick={() => confirmReq(r)}>Confirmer</button>
									<button type="button" class="rounded-full border border-line bg-white px-3.5 py-1.5 text-[12px] font-bold text-ink transition hover:border-danger hover:text-danger" onclick={() => cancelRdv(r)}>Refuser</button>
								</span>
							</div>
						{/each}
					</div>
				</section>
			{/if}

			<!-- ── Prochains rendez-vous ── -->
			{#if upcoming.length > 0}
				<section class="card-crm m-in-crm mt-4 p-4" style="--m-i: 4">
					<div class="mb-2.5 flex items-center justify-between gap-2">
						<h2 class="flex items-center gap-2 font-display text-[15px] font-bold text-ink">
							<span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-light text-brand-deep"><Icon name="calendarDays" size={14} /></span>
							Prochains rendez-vous
						</h2>
						<span class="badge-in grid h-5 min-w-5 place-items-center rounded-full bg-brand-light px-1.5 text-[11px] font-bold text-brand-deep">{upcoming.length}</span>
					</div>
					<div class="space-y-1.5">
						{#each upcoming.slice(0, 6) as r (r._id)}
							<div class="crow-crm flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white px-3 py-2.5">
								<!-- Encart date -->
								<div class="w-14 shrink-0 rounded-xl border border-line bg-cream px-1 py-1.5 text-center leading-tight">
									<div class="text-[9.5px] font-black uppercase tracking-wider text-mist">{dayParts(r.date).dow}</div>
									<div class="text-[14px] font-black text-ink">{dayParts(r.date).day}</div>
									<div class="text-[9.5px] font-bold uppercase text-mist">{dayParts(r.date).month}</div>
								</div>
								<!-- Horaire -->
								<div class="w-16 shrink-0 leading-tight">
									<div class="text-[14px] font-black tabular-nums text-ink">{r.time}</div>
									<div class="text-[11px] font-semibold tabular-nums text-mist">{r.endTime}</div>
								</div>
								<!-- Cliente + type -->
								<div class="flex min-w-0 flex-1 items-center gap-2.5">
									<ClientAvatar name={clientNameOf(r)} url={clientOf(r)?.profilePhotoUrl ?? null} class="h-9 w-9 text-sm" />
									<div class="min-w-0">
										<div class="flex items-center gap-1.5">
											<span class="truncate text-[13.5px] font-bold text-ink">{clientNameOf(r)}</span>
											{#if r.googleEventId}<span class="hidden shrink-0 items-center gap-0.5 rounded-full bg-soft px-1.5 py-px text-[9.5px] font-bold text-mist sm:inline-flex" title="Synchronisé Google Calendar"><Icon name="check" size={9} /> Google</span>{/if}
											{#if r.rescheduleCount > 0}<span class="shrink-0 rounded-full bg-warn-light px-1.5 py-px text-[9.5px] font-bold text-warn" title="Replanifié {r.rescheduleCount} fois">×{r.rescheduleCount}</span>{/if}
										</div>
										<div class="truncate text-[11px] text-mist">{r.kind} · {rdvDuration(r)} min</div>
									</div>
								</div>
								<!-- Visio / présentiel -->
								<span class="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-bold {r.meetingUrl ? 'bg-[#e8f0fe] text-[#1a73e8]' : 'bg-soft text-mist'}" title={r.meetingUrl ? 'Visioconférence (lien envoyé à la cliente)' : 'Sans lien de visio — en présentiel ou par téléphone'}>
									<Icon name={r.meetingUrl ? 'video' : 'mapPin'} size={11} />
									{r.meetingUrl ? 'En visio' : 'En présentiel'}
								</span>
								<!-- Actions -->
								<span class="ml-auto flex shrink-0 gap-1.5">
									<button type="button" class="inline-flex items-center gap-1 rounded-full border border-line bg-white px-3 py-1.5 text-[12px] font-bold text-ink transition hover:border-brand hover:text-brand" onclick={() => startReschedule(r)}>
										<Icon name="calendarClock" size={12} /> Replanifier
									</button>
									<button type="button" class="inline-flex items-center gap-1 rounded-full border border-line bg-white px-3 py-1.5 text-[12px] font-bold text-ink transition hover:border-danger hover:text-danger" onclick={() => cancelRdv(r)}>
										<Icon name="x" size={12} /> Annuler
									</button>
								</span>
							</div>
						{/each}
					</div>
					{#if upcoming.length > 6}
						<p class="mt-2 text-[11px] italic text-mist">+ {upcoming.length - 6} rendez-vous suivants visibles directement dans le calendrier ci-dessous.</p>
					{/if}
				</section>
			{/if}

			<!-- ── Calendrier de la semaine ── -->
			<section class="card-crm m-in-crm mt-4 p-4" style="--m-i: 5">
				<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
					<h2 class="flex items-center gap-2 font-display text-[15px] font-bold text-ink">
						<span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-light text-brand-deep"><Icon name="calendarRange" size={14} /></span>
						Semaine du {label(weekStart)}
					</h2>
					<div class="flex items-center gap-1">
						{#if viewKind && availLoading}<span class="mr-1 text-[11px] italic text-mist">Calcul des créneaux…</span>{/if}
						<button type="button" class="grid h-8 w-8 place-items-center rounded-full border border-line bg-white text-ink transition hover:border-brand hover:text-brand" onclick={() => (weekStart = addDays(weekStart, -7))} aria-label="Semaine précédente"><Icon name="chevronLeft" size={15} /></button>
						<button type="button" class="rounded-full border border-line bg-white px-3 py-1.5 text-[12px] font-bold text-ink transition hover:border-brand hover:text-brand" onclick={() => (weekStart = mondayOf(new Date()))}>Aujourd'hui</button>
						<button type="button" class="grid h-8 w-8 place-items-center rounded-full border border-line bg-white text-ink transition hover:border-brand hover:text-brand" onclick={() => (weekStart = addDays(weekStart, 7))} aria-label="Semaine suivante"><Icon name="chevronRight" size={15} /></button>
					</div>
				</div>

				<div class="overflow-x-auto pb-1">
					<div class="min-w-[820px]">
						<!-- En-têtes de jours -->
						<div class="grid" style="grid-template-columns: 52px repeat(7, minmax(0, 1fr))">
							<div></div>
							{#each daysOfWeek as iso (iso)}
								<div class="px-1 pb-2 text-center">
									<div class="mb-0.5 flex items-center justify-center">
										{#if isToday(iso)}
											<span class="grid h-6 w-6 place-items-center rounded-full bg-brand text-[12px] font-black text-white">{dayParts(iso).day}</span>
										{:else}
											<span class="text-[13px] font-black text-ink">{dayParts(iso).day}</span>
										{/if}
									</div>
									<div class="text-[10px] font-bold uppercase tracking-wider {isToday(iso) ? 'text-brand-dark' : 'text-mist'}">{dayParts(iso).dow}. {dayParts(iso).month}</div>
								</div>
							{/each}
						</div>
						<!-- Corps de la grille -->
						<div class="grid border-t border-line" style="grid-template-columns: 52px repeat(7, minmax(0, 1fr))">
							<!-- Gouttière des heures -->
							<div class="relative" style={`height: ${gridHeight}px`}>
								{#each gridHours as h (h)}
									<span class="absolute right-1.5 -translate-y-1/2 text-[10px] font-bold tabular-nums text-mist" style={`top: ${topPx(h)}px`}>{hourLabel(h)}</span>
								{/each}
							</div>
							{#each daysOfWeek as iso (iso)}
								<div class="relative border-l border-line/70 {isToday(iso) ? 'bg-brand/5' : ''}" style={`height: ${gridHeight}px`}>
									<!-- Lignes d'heure -->
									{#each gridHours as h (h)}
										<span class="absolute left-0 right-0 border-t border-line/60" style={`top: ${topPx(h)}px`}></span>
									{/each}
									<!-- Plages de disponibilité (état réel, observation) -->
									{#each rangesForDay(iso) as rg, i (i)}
										<div
											class="absolute left-0 right-0 border-y border-brand/15 bg-brand/10"
											style={`top: ${topPx(toMin(rg.start))}px; height: ${(toMin(rg.end) - toMin(rg.start)) * PX_PER_MIN}px`}
											title={`Disponible ${rg.start}–${rg.end}`}
										></div>
									{/each}
									<!-- RDV posés (blocs) — clic = aperçu -->
									{#each rdvsForDay(iso) as r (r._id)}
										<button
											type="button"
											onclick={() => (previewRdv = r)}
											title={`${clientNameOf(r)} · ${r.kind} · ${r.time}–${r.endTime} — cliquer pour le détail`}
											class="absolute left-1 right-1.5 z-10 overflow-hidden rounded-lg px-2 py-1 text-left shadow-sm transition {r.status === 'client_request' ? 'border border-warn/60 bg-warn-light text-warn hover:bg-warn hover:text-white' : 'bg-brand text-white hover:bg-brand-dark'}"
											style={`top: ${topPx(toMin(r.time)) + 1}px; height: ${Math.max(rdvDuration(r) * PX_PER_MIN - 2, 20)}px`}
										>
											<span class="block text-[9.5px] font-bold tabular-nums leading-tight opacity-90">{r.time}–{r.endTime}</span>
											<span class="block truncate text-[11.5px] font-bold leading-tight">{clientNameOf(r)}</span>
											{#if rdvDuration(r) >= 30}<span class="block truncate text-[10px] leading-tight opacity-85">{r.kind}</span>{/if}
										</button>
									{/each}
									<!-- Couche réservation (créneaux 15 min, moteur serveur) -->
									{#if viewKind}
										{#each slotsFor(iso) as s (`${iso}-${s.start}`)}
											{@const rdv = rdvAt(iso, s.start)}
											{@const taken = rdvs.some((r) => r.date === iso && r.status !== 'cancelled' && toMin(r.time) < toMin(s.end) && toMin(r.endTime) > toMin(s.start) && r._id !== rdv?._id)}
											{@const bookable = !rdv && !taken && (avail[iso] ?? []).includes(s.start)}
											{#if rdv}
												<!-- RDV existant : bloc déjà rendu au-dessus -->
											{:else if bookable}
												<button
													type="button"
													onclick={() => openSlot(iso, s.start)}
													title={`Réserver « ${viewKind} » · ${kindRule(viewKind).durationMin} min`}
													class="absolute left-0.5 right-0.5 z-20 rounded-md bg-white shadow-sm ring-2 ring-brand/60 transition hover:bg-brand hover:text-white"
													style={`top: ${topPx(toMin(s.start)) + 1}px; height: ${SLOT_GRID_STEP_MIN * PX_PER_MIN - 2}px`}
												>
													<span class="block text-center text-[9px] font-black tabular-nums leading-none">{s.start}</span>
												</button>
											{:else if taken}
												<span class="absolute left-0.5 right-0.5 rounded-md bg-line/50" style={`top: ${topPx(toMin(s.start)) + 1}px; height: ${SLOT_GRID_STEP_MIN * PX_PER_MIN - 2}px`} title="Créneau occupé"></span>
											{:else}
												<span class="absolute left-0.5 right-0.5 cursor-not-allowed rounded-md" style={`top: ${topPx(toMin(s.start)) + 1}px; height: ${SLOT_GRID_STEP_MIN * PX_PER_MIN - 2}px`} title={`Indisponible pour « ${viewKind} »`}></span>
											{/if}
										{/each}
									{/if}
									<!-- Journée sans disponibilité ni RDV -->
									{#if rangesForDay(iso).length === 0 && rdvsForDay(iso).length === 0}
										<span class="absolute inset-x-2 top-1/2 -translate-y-1/2 text-center text-[10.5px] italic text-mist/70">Indisponible</span>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				</div>
				<!-- Légende -->
				<div class="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] font-semibold text-mist">
					<span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded bg-brand"></span> Rendez-vous confirmé</span>
					<span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded border border-warn/60 bg-warn-light"></span> Demande à valider</span>
					<span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded bg-brand/15"></span> Disponibilité</span>
					{#if viewKind}<span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded ring-2 ring-brand/60"></span> Réservable ({viewKind})</span>{/if}
				</div>
			</section>
		</svelte:boundary>
	{/if}
</div>

<!-- ── Aperçu d'un rendez-vous existant ── -->
{#if previewRdv}
	<div class="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) previewRdv = null; }}>
		<div class="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
			<div class="mb-3 flex items-start justify-between gap-2">
				<h3 class="font-display text-lg font-black text-ink">Aperçu du rendez-vous</h3>
				<button type="button" onclick={() => (previewRdv = null)} class="text-mist transition hover:text-ink" aria-label="Fermer"><Icon name="x" size={16} /></button>
			</div>
			<div class="rounded-xl border border-line bg-cream/40 p-4">
				<div class="flex items-center gap-2.5">
					<ClientAvatar name={clientNameOf(previewRdv)} url={clientOf(previewRdv)?.profilePhotoUrl ?? null} class="h-10 w-10 text-sm" />
					<p class="min-w-0 truncate font-display text-lg font-black text-ink">{clientNameOf(previewRdv)}</p>
				</div>
				<dl class="mt-3 space-y-1.5 text-sm">
					<div class="flex justify-between gap-3"><dt class="text-mist">Type</dt><dd class="font-bold text-ink">{previewRdv.kind} · {rdvDuration(previewRdv)} min</dd></div>
					<div class="flex justify-between gap-3"><dt class="text-mist">Date</dt><dd class="font-bold capitalize text-ink">{prettyDate(previewRdv.date)}</dd></div>
					<div class="flex justify-between gap-3"><dt class="text-mist">Horaire</dt><dd class="font-bold tabular-nums text-ink">{previewRdv.time} – {previewRdv.endTime}</dd></div>
					<div class="flex justify-between gap-3">
						<dt class="text-mist">Format</dt>
						<dd>
							<span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold {previewRdv.meetingUrl ? 'bg-[#e8f0fe] text-[#1a73e8]' : 'bg-soft text-mist'}">
								<Icon name={previewRdv.meetingUrl ? 'video' : 'mapPin'} size={11} />
								{previewRdv.meetingUrl ? 'En visio' : 'En présentiel'}
							</span>
						</dd>
					</div>
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
						<div class="flex justify-between gap-3"><dt class="text-mist">Google Calendar</dt><dd class="font-bold text-ink">Synchronisé ✓</dd></div>
					{/if}
					{#if previewRdv.rescheduleCount > 0}
						<div class="flex justify-between gap-3"><dt class="text-mist">Replanifications</dt><dd class="font-bold text-ink">×{previewRdv.rescheduleCount}</dd></div>
					{/if}
				</dl>
			</div>
			<div class="mt-4 flex flex-wrap justify-end gap-2">
				<button type="button" class="rounded-full border border-line bg-white px-3.5 py-2 text-[12.5px] font-bold text-ink" onclick={() => (previewRdv = null)}>Fermer</button>
				{#if previewRdv.status === 'client_request'}
					<button type="button" class="rounded-full bg-brand px-4 py-2 text-[12.5px] font-bold text-white transition hover:bg-brand-dark" onclick={() => confirmReq(previewRdv!)}>Confirmer</button>
					<button type="button" class="rounded-full border border-line bg-white px-3.5 py-2 text-[12.5px] font-bold text-ink transition hover:border-danger hover:text-danger" onclick={() => cancelRdv(previewRdv!)}>Refuser</button>
				{:else}
					<button type="button" class="inline-flex items-center gap-1 rounded-full border border-line bg-white px-3.5 py-2 text-[12.5px] font-bold text-ink transition hover:border-brand hover:text-brand" onclick={() => startReschedule(previewRdv!)}><Icon name="calendarClock" size={13} /> Replanifier</button>
					<button type="button" class="inline-flex items-center gap-1 rounded-full border border-line bg-white px-3.5 py-2 text-[12.5px] font-bold text-ink transition hover:border-danger hover:text-danger" onclick={() => cancelRdv(previewRdv!)}><Icon name="x" size={13} /> Annuler le RDV</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

<!-- ── Modale réservation (choix de la cliente) / replanification ── -->
{#if reserving}
	<div class="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) { reserving = null; } }}>
		<div class="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
			<h3 class="mb-1 font-display text-lg font-black text-ink">
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
				<label class="mb-1 block text-xs font-bold uppercase tracking-wide text-mist" for="rdv-meeting-url">Lien de visio (optionnel)</label>
				<input
					id="rdv-meeting-url"
					type="url"
					bind:value={reservingUrl}
					placeholder="https://…"
					class="mb-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm {reservingUrl ? 'border-brand/50' : ''}"
				/>
				<p class="mb-4 text-[11px] leading-snug text-mist">
					{reserving.kind === 'Démarrage' && reservingUrl
						? 'Prérempli avec ton Meet de démarrage — tu peux le modifier ou le vider.'
						: 'La cliente verra un bouton « Rejoindre la visio » sur son rendez-vous.'}
				</p>
			{/if}
			<div class="flex justify-end gap-2">
				<button type="button" class="rounded-full border border-line bg-white px-3.5 py-2 text-[12.5px] font-bold text-ink" onclick={() => (reserving = null)}>Annuler</button>
				{#if rescheduleFrom}
					<button type="button" class="rounded-full bg-brand px-4 py-2 text-[12.5px] font-bold text-white transition hover:bg-brand-dark" onclick={confirmReserving}>Déplacer ici</button>
				{:else}
					<button type="button" class="rounded-full bg-brand px-4 py-2 text-[12.5px] font-bold text-white transition hover:bg-brand-dark disabled:opacity-50" disabled={!reserving.clientId} onclick={confirmReserving}>Confirmer</button>
				{/if}
			</div>
		</div>
	</div>
{/if}
