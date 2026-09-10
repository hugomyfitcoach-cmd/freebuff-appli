<script lang="ts">
	/**
	 * Rendez-vous (coach) — planning hebdo + disponibilités + réservation.
	 * Interface restaurée à l'identique de la version d'hier :
	 * - navigation par semaine (créneaux issus des disponibilités) ;
	 * - édition des disponibilités (jours + plages horaires) ;
	 * - réservation pour une cliente (poussée Google Calendar) ;
	 * - traitement des demandes clientes (confirmer = réserver).
	 */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import Icon from '$lib/components/Icon.svelte';

	type Range = { day: number; start: string; end: string };
	type Rdv = {
		_id: string;
		clientId: string;
		date: string;
		time: string;
		endTime: string;
		kind: string;
		status: 'on_book' | 'client_request' | 'cancelled';
		bookedByName: string | null;
		rescheduleCount: number;
		googleEventId: string | null;
	};
	type ClientRow = { user: { _id: string; prenom: string; nom?: string | null } };

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
	let reserving = $state<Rdv | null>(null); // créneau cliqué → modale réservation
	let rescheduleFrom = $state<Rdv | null>(null); // replanification d'un RDV existant

	function mondayOf(d: Date): string {
		const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate());
		const day = (dt.getDay() + 6) % 7; // 0 = lundi
		dt.setDate(dt.getDate() - day);
		return toISO(dt);
	}
	function toISO(d: Date): string {
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
	function toMin(h: string): number {
		const [hh, mm] = h.split(':');
		return Number(hh) * 60 + Number(mm);
	}
	function fromMin(m: number): string {
		return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
	}
	const fullName = (c: ClientRow) => (c.user.nom ? `${c.user.prenom} ${c.user.nom}` : c.user.prenom);

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
	}
	onMount(loadAll);

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
		}
	}
	async function cancelRdv(rdv: Rdv) {
		try {
			const res = await fetch(`/api/appointments/${rdv._id}${rdv.googleEventId ? `?eventId=${encodeURIComponent(rdv.googleEventId)}` : ''}`, { method: 'DELETE' });
			const j = await res.json();
			if (!res.ok) throw new Error(j.error);
			notice = 'Rendez-vous annulé.';
			await loadAll();
		} catch (e) {
			pageErr = e instanceof Error ? e.message : 'Erreur';
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

		<!-- ── Demandes à valider ── -->
		{#if pending.length > 0}
			<section class="mb-6 rounded-2xl border border-warn/40 bg-warn-light/40 p-4">
				<h2 class="mb-2 flex items-center gap-2 font-display text-lg font-semibold text-ink"><Icon name="bell" size={17} class="text-warn" /> Demandes de rendez-vous ({pending.length})</h2>
				{#each pending as r (r._id)}
					<div class="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white px-3 py-2 text-sm">
						<span><strong>{r.bookedByName ?? 'Cliente'}</strong> demande <strong>{r.kind}</strong> — {label(r.date)} · {r.time}–{r.endTime}</span>
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
						<span><strong>{r.bookedByName ?? 'Cliente'}</strong> · {r.kind} — <span class="tabular-nums">{label(r.date)} · {r.time}–{r.endTime}</span>{r.rescheduleCount > 0 ? ` · replanifié ×${r.rescheduleCount}` : ''}{r.googleEventId ? ' · 📅 Google ✓' : ''}</span>
						<span class="flex gap-2">
							<button type="button" class="rounded-lg border-2 border-line px-3 py-1 text-xs font-semibold text-ink transition hover:border-brand hover:text-brand" onclick={() => { rescheduleFrom = r; reserving = { ...r }; }}>Replanifier</button>
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
									{@const taken = rdvs.some((r) => r.date === iso && r.status !== 'cancelled' && toMin(r.time) < toMin(s.end) && toMin(r.endTime) > toMin(s.start) && r._id !== rdv?._id)}
									<button
										type="button"
										disabled={taken}
										onclick={() => { rescheduleFrom = null; reserving = { _id: '', clientId: '', date: iso, time: s.start, endTime: s.end, kind: 'Suivi', status: 'on_book', bookedByName: null, rescheduleCount: 0, googleEventId: null }; }}
										class="w-full rounded-lg px-1.5 py-1 text-[11px] font-semibold tabular-nums transition
											{rdv ? (rdv.status === 'client_request' ? 'bg-warn-light text-warn' : 'bg-brand text-white') : taken ? 'cursor-not-allowed bg-line/40 text-mist line-through' : 'bg-white text-ink hover:bg-brand-light'}"
									>
										{s.start}{rdv ? ` · ${rdv.kind}` : ''}
									</button>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</section>
	{/if}
</div>

<!-- ── Modale réservation / replanification ── -->
{#if reserving}
	<div class="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) { reserving = null; rescheduleFrom = null; } }}>
		<div class="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
			<h3 class="mb-1 font-display text-lg font-semibold text-ink">
				{rescheduleFrom ? 'Replanifier le rendez-vous' : `Réserver · ${label(reserving.date)} · ${reserving.time}–${reserving.endTime}`}
			</h3>
			<p class="mb-3 text-xs text-mist">
				{rescheduleFrom ? `${rescheduleFrom.bookedByName ?? 'Cliente'} — actuellement ${label(rescheduleFrom.date)} ${rescheduleFrom.time}` : 'Le créneau confirmé sera ajouté à ton Google Calendar.'}
			</p>
			{#if !rescheduleFrom}
				<label class="mb-1 block text-xs font-bold uppercase tracking-wide text-mist" for="rdv-client">Cliente</label>
				<select id="rdv-client" class="mb-3 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm" bind:value={reserving.clientId}>
					<option value="" disabled>Choisir une cliente…</option>
					{#each clients as c (c.user._id)}<option value={c.user._id}>{fullName(c)}</option>{/each}
				</select>
				<label class="mb-1 block text-xs font-bold uppercase tracking-wide text-mist" for="rdv-kind">Type</label>
				<select id="rdv-kind" class="mb-4 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm" bind:value={reserving.kind}>
					{#each KINDS as k}<option value={k}>{k}</option>{/each}
				</select>
			{:else}
				<label class="mb-1 block text-xs font-bold uppercase tracking-wide text-mist" for="rdv-kind2">Type</label>
				<select id="rdv-kind2" class="mb-4 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm" bind:value={reserving.kind}>
					{#each KINDS as k}<option value={k}>{k}</option>{/each}
				</select>
			{/if}
			<div class="flex justify-end gap-2">
				<button type="button" class="rounded-lg border-2 border-line px-3 py-1.5 text-sm font-semibold text-ink" onclick={() => { reserving = null; rescheduleFrom = null; }}>Annuler</button>
				{#if rescheduleFrom && reserving}
					<button type="button" class="rounded-lg bg-brand px-4 py-1.5 text-sm font-bold text-white transition hover:bg-brand-dark" onclick={() => move(rescheduleFrom!, reserving!.date, reserving!.time, reserving!.endTime)}>Déplacer ici</button>
				{:else if reserving}
					<button type="button" class="rounded-lg bg-brand px-4 py-1.5 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-50" disabled={!reserving.clientId} onclick={() => { const c = clients.find((x) => x.user._id === reserving!.clientId); book(reserving!.clientId, c ? fullName(c) : 'Cliente', reserving!.date, reserving!.time, reserving!.endTime, reserving!.kind); }}>Confirmer</button>
				{/if}
			</div>
		</div>
	</div>
{/if}
