<script lang="ts">
	/**
	 * Rendez-vous (cliente) — présentation réellement mobile (§18), pas une
	 * compression du desktop :
	 * - RDV futur  → carte claire + [Modifier mon rendez-vous] / [Annuler] ;
	 * - sinon      → réservation en 3 gestes : Type → Jour → Créneau.
	 * Booking DIRECT : confirmé immédiatement (aucune attente coach). Selon
	 * l'origine (§12/§13) le message « créé par le coach » ou « tu as choisi »
	 * est affiché. Replanification autonome bloquée à moins de 4 h (§15).
	 */
	import { onMount } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
import {
	clientCanReschedule,
	fetchAvailability,
	fromMin,
	kindRule,
	prettyDate,
	toISO,
	toMin,
	type AvailabilitySlot,
	type Rdv,
} from '$lib/appointments';

	type Range = { day: number; start: string; end: string };

	let loading = $state(true);
	let pageErr = $state('');
	let notice = $state('');
	let rdvs = $state<Rdv[]>([]);

	/* Réservation : type → date → créneaux (moteur serveur). */
	let kind = $state<string>('Suivi');
	let date = $state('');
	let slots = $state<AvailabilitySlot[]>([]);
	let slotsLoading = $state(false);
	let slotsErr = $state('');
	let time = $state('');
	let busy = $state(false);

	/* Replanification du RDV existant. */
	let moving = $state<Rdv | null>(null);

	const today = $derived(toISO(new Date()));
	const next = $derived(
		rdvs
			.filter((r) => r.status === 'on_book' && `${r.date}T${r.time}` >= `${today}T00:00`)
			.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0] ?? null
	);
	const canMove = $derived(next ? clientCanReschedule(next) : false);
	const durationLabel = $derived(`${kindRule(kind).durationMin} min`);

	async function loadRdvs() {
		const r = await fetch('/api/appointments').then((x) => x.json());
		if (r.error) throw new Error(r.error);
		rdvs = r.appointments ?? [];
	}

	onMount(async () => {
		try {
			await loadRdvs();
		} catch (e) {
			pageErr = e instanceof Error ? e.message : 'Chargement impossible.';
		} finally {
			loading = false;
		}
	});

	/** Charge les créneaux réels du moteur (plages − Google − RDV − buffers). */
	async function loadSlots() {
		if (!date) return;
		slotsLoading = true;
		slotsErr = '';
		slots = [];
		time = '';
		try {
			const res = await fetchAvailability({ date, kind, excludeId: moving?._id });
			slots = res.days[0]?.slots ?? [];
			if (slots.length === 0) {
				slotsErr = 'Aucun créneau disponible ce jour — essaie une autre date.';
			}
		} catch (e) {
			slotsErr = e instanceof Error ? e.message : 'Disponibilités indisponibles.';
		} finally {
			slotsLoading = false;
		}
	}

	function startBooking() {
		moving = null;
		date = '';
		slots = [];
		time = '';
	}

	function startMoving(r: Rdv) {
		moving = r;
		date = '';
		slots = [];
		time = '';
		notice = '';
		pageErr = '';
	}

	function endMoving() {
		moving = null;
		date = '';
		slots = [];
		time = '';
	}

	async function confirmBooking() {
		if (!date || !time) return;
		busy = true;
		pageErr = '';
		try {
			const endTime = fromMin(toMin(time) + kindRule(kind).durationMin);
			const res = moving
				? await fetch(`/api/appointments/${moving._id}`, {
						method: 'PATCH',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ date, time, endTime }),
					})
				: await fetch('/api/appointments', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ date, time, endTime, kind }),
					});
			const j = await res.json();
			if (!res.ok) throw new Error(j.error);
			notice = moving
				? 'Ton rendez-vous a été déplacé ✓'
				: '✓ Ton rendez-vous est réservé';
			endMoving();
			await loadRdvs();
		} catch (e) {
			pageErr = e instanceof Error ? e.message : 'Erreur';
			// Créneau pris entre-temps → recharge les créneaux à jour.
			if (date) void loadSlots();
		} finally {
			busy = false;
		}
	}

	let cancelTarget = $state<Rdv | null>(null);
	async function cancelRdv() {
		if (!cancelTarget) return;
		busy = true;
		pageErr = '';
		try {
			const res = await fetch(`/api/appointments/${cancelTarget._id}`, { method: 'DELETE' });
			const j = await res.json();
			if (!res.ok) throw new Error(j.error);
			notice = 'Rendez-vous annulé.';
			cancelTarget = null;
			await loadRdvs();
		} catch (e) {
			pageErr = e instanceof Error ? e.message : 'Erreur';
		} finally {
			busy = false;
		}
	}

	/** Jours proposés : les 14 prochains (le coach ouvre ses disponibilités). */
	const dayOptions = $derived.by(() => {
		const out: string[] = [];
		for (let i = 0; i < 14; i++) {
			const d = new Date();
			d.setDate(d.getDate() + i);
			out.push(toISO(d));
		}
		return out;
	});
	function dayLabel(iso: string): string {
		const d = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
		const lbl = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
		return iso === today ? `Auj. · ${lbl}` : lbl;
	}
</script>

<svelte:head><title>Rendez-vous — G-Flux</title></svelte:head>

<div class="mx-auto w-full max-w-md px-4 pb-5 pt-3">
	<header class="mb-4">
		<h1 class="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
			<Icon name="calendarCheck" size={22} class="text-brand" /> Rendez-vous
		</h1>
		<p class="mt-0.5 text-sm text-mist">Ton prochain rendez-vous avec ton coach.</p>
	</header>

	{#if pageErr}<p class="mb-4 rounded-xl border-2 border-danger bg-danger-light px-4 py-3 text-sm text-danger">{pageErr}</p>{/if}
	{#if notice}<p class="mb-4 rounded-xl border border-brand/40 bg-brand-light px-4 py-3 text-sm font-semibold text-ink">{notice}</p>{/if}

	{#if loading}
		<p class="py-16 text-center text-sm text-mist">Chargement…</p>
	{:else if !moving}
		<!-- ── RDV ACTUEL (§17 : le contenu dépend de l'état) ── -->
		<section class="mb-5">
			{#if next}
				<div class="rounded-3xl border border-brand/40 bg-gradient-to-br from-brand-light via-brand-light/60 to-white p-5 shadow-sm">
					<p class="text-[11px] font-bold uppercase tracking-widest text-brand-dark">
						{next.bookingSource === 'coach' ? 'Ton prochain rendez-vous' : '✓ Ton rendez-vous est réservé'}
					</p>
					<p class="mt-2 font-display text-xl font-semibold capitalize text-ink">{prettyDate(next.date)}</p>
					<p class="mt-0.5 text-sm font-semibold tabular-nums text-ink">{next.time} · {next.kind}</p>
					<p class="mt-1 text-xs text-mist">
						{next.bookingSource === 'coach'
							? 'Ton coach a planifié ce rendez-vous avec toi.'
							: 'Tu as choisi ce créneau pour ton prochain échange avec ton coach.'}
					</p>
					<div class="mt-3 grid gap-2">
						<button
							type="button"
							class="rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark"
							onclick={() => startMoving(next)}
						>Modifier mon rendez-vous</button>
						<button
							type="button"
							class="rounded-xl border-2 border-line bg-white px-5 py-2.5 text-sm font-semibold text-ink transition hover:border-danger hover:text-danger"
							onclick={() => (cancelTarget = next)}
						>Annuler</button>
					</div>
				</div>
			{:else}
				<div class="rounded-3xl border border-line bg-card p-5 text-center shadow-sm">
					<p class="grid place-items-center"><Icon name="calendarDays" size={26} class="text-mist" /></p>
					<p class="mt-2 font-display text-lg font-semibold text-ink">Aucun rendez-vous prévu</p>
					<p class="mt-0.5 text-sm text-mist">Choisis un créneau dans les disponibilités de ton coach.</p>
					<button type="button" class="mt-3 rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark" onclick={startBooking}>
						Planifier un rendez-vous
					</button>
				</div>
			{/if}
		</section>

		<!-- ── RÉSERVATION (visible quand aucun RDV futur, ou accès direct) ── -->
		{#if !next}
			<section class="rounded-3xl border border-line bg-card p-5 shadow-sm">
				<h2 class="mb-3 flex items-center gap-2 font-display text-lg font-semibold text-ink">
					<Icon name="calendarDays" size={17} class="text-brand" /> Réserver
				</h2>

				<!-- 1 · Type : le client réserve UNIQUEMENT un « Suivi » (le
			     « Démarrage » est réservé au coach) — pas de sélecteur. -->
				<p class="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-mist">1 · Type de rendez-vous</p>
				<div class="rounded-2xl border-2 border-brand bg-brand-light/60 px-3 py-3">
					<span class="block text-sm font-bold text-ink">Suivi</span>
					<span class="mt-0.5 block text-[11px] text-mist">{kindRule('Suivi').durationMin} min — point régulier avec ton coach</span>
				</div>

				<!-- 2 · Jour -->
				<p class="mb-1.5 mt-4 text-[11px] font-bold uppercase tracking-wider text-mist">2 · Jour</p>
				<div class="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
					{#each dayOptions as d (d)}
						<button
							type="button"
							onclick={() => { date = d; void loadSlots(); }}
							class="shrink-0 rounded-xl border-2 px-3 py-2 text-xs font-bold transition {date === d ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink hover:border-brand/50'}"
						>{dayLabel(d)}</button>
					{/each}
				</div>

				<!-- 3 · Créneau -->
				<p class="mb-1.5 mt-4 text-[11px] font-bold uppercase tracking-wider text-mist">3 · Créneau ({durationLabel})</p>
				{#if !date}
					<p class="text-sm italic text-mist">Choisis d'abord un jour.</p>
				{:else if slotsLoading}
					<p class="text-sm italic text-mist">Recherche des créneaux disponibles…</p>
				{:else if slotsErr}
					<p class="text-sm italic text-mist">{slotsErr}</p>
				{:else}
					<div class="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
						{#each slots as s (s.start)}
							<button
								type="button"
								onclick={() => (time = s.start)}
								class="rounded-xl px-2 py-2 text-xs font-bold tabular-nums transition {time === s.start ? 'bg-brand text-white' : 'bg-brand-light text-brand-dark hover:bg-brand hover:text-white'}"
							>{s.start}</button>
						{/each}
					</div>
					<button
						type="button"
						disabled={!time || busy}
						class="mt-4 w-full rounded-xl bg-brand px-5 py-3 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-50"
						onclick={confirmBooking}
					>
						{busy ? 'Réservation…' : `Confirmer · ${prettyDate(date)} · ${time || '—'}`}
					</button>
					<p class="mt-2 text-center text-[11px] text-mist">Confirmé immédiatement — ton coach voit ton créneau en direct.</p>
				{/if}
			</section>
		{/if}

		<!-- ── Historique ── -->
		{#if rdvs.filter((r) => r.status !== 'on_book' || `${r.date}T${r.time}` < `${today}T00:00`).length > 0}
			<section class="mt-5 rounded-3xl border border-line bg-card p-5">
				<h2 class="mb-2 flex items-center gap-2 font-display text-lg font-semibold text-ink"><Icon name="listTodo" size={17} class="text-brand" /> Historique</h2>
				{#each [...rdvs].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)) as r (r._id)}
					{#if r.status !== 'on_book' || `${r.date}T${r.time}` < `${today}T00:00`}
						<div class="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 py-2 text-sm last:border-0">
							<span class="tabular-nums"><strong class="capitalize">{prettyDate(r.date)}</strong> · {r.time} · {r.kind}</span>
							<span class="rounded-full px-2 py-0.5 text-xs font-bold {r.status === 'on_book' ? 'bg-brand text-white' : 'bg-line text-mist'}">
								{r.status === 'on_book' ? 'passé' : 'annulé'}
							</span>
						</div>
					{/if}
				{/each}
			</section>
		{/if}
	{:else}
		<!-- ── REPLANIFICATION du RDV existant (même RDV, même événement Google) ── -->
		<section class="rounded-3xl border border-line bg-card p-5 shadow-sm">
			<h2 class="mb-1 flex items-center gap-2 font-display text-lg font-semibold text-ink">
				<Icon name="calendarClock" size={17} class="text-brand" /> Modifier mon rendez-vous
			</h2>
			<p class="mb-4 text-sm text-mist">
				Actuellement : <strong class="capitalize text-ink">{prettyDate(moving.date)}</strong> · {moving.time} · {moving.kind}
				— le même rendez-vous est déplacé, rien n'est dupliqué.
			</p>
			{#if canMove}
				<p class="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-mist">Nouveau jour</p>
				<div class="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
					{#each dayOptions as d (d)}
						<button
							type="button"
							onclick={() => { date = d; void loadSlots(); }}
							class="shrink-0 rounded-xl border-2 px-3 py-2 text-xs font-bold transition {date === d ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink hover:border-brand/50'}"
						>{dayLabel(d)}</button>
					{/each}
				</div>
				{#if date}
					<p class="mb-1.5 mt-4 text-[11px] font-bold uppercase tracking-wider text-mist">Nouveau créneau ({kindRule(moving.kind).durationMin} min)</p>
					{#if slotsLoading}
						<p class="text-sm italic text-mist">Recherche des créneaux disponibles…</p>
					{:else if slotsErr}
						<p class="text-sm italic text-mist">{slotsErr}</p>
					{:else if slots.length === 0}
						<p class="text-sm italic text-mist">Choisis un jour pour voir les créneaux.</p>
					{:else}
						<div class="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
							{#each slots as s (s.start)}
								<button
									type="button"
									onclick={() => (time = s.start)}
									class="rounded-xl px-2 py-2 text-xs font-bold tabular-nums transition {time === s.start ? 'bg-brand text-white' : 'bg-brand-light text-brand-dark hover:bg-brand hover:text-white'}"
								>{s.start}</button>
							{/each}
						</div>
					{/if}
				{/if}
				<div class="mt-4 grid gap-2">
					<button
						type="button"
						disabled={!time || busy}
						class="rounded-xl bg-brand px-5 py-3 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-50"
						onclick={confirmBooking}
					>{busy ? 'Déplacement…' : 'Déplacer mon rendez-vous ici'}</button>
					<button
						type="button"
						class="rounded-xl border-2 border-line px-5 py-2.5 text-sm font-semibold text-ink transition hover:border-brand"
						onclick={endMoving}
					>Retour</button>
				</div>
			{:else}
				<div class="rounded-xl border border-warn/40 bg-warn-light/40 px-4 py-3 text-sm text-ink">
					Ton rendez-vous approche. Pour le modifier, contacte directement ton coach.
				</div>
				<button type="button" class="mt-3 w-full rounded-xl border-2 border-line px-5 py-2.5 text-sm font-semibold text-ink transition hover:border-brand" onclick={endMoving}>Retour</button>
			{/if}
		</section>
	{/if}
</div>

<!-- ── Confirmation d'annulation (§5 : demander confirmation) ── -->
{#if cancelTarget}
	<div class="fixed inset-0 z-50 grid place-items-end bg-ink/50 p-4 sm:place-items-center" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) cancelTarget = null; }}>
		<div class="w-full max-w-sm rounded-3xl bg-white p-5 shadow-xl">
			<h3 class="font-display text-lg font-semibold text-ink">Annuler ce rendez-vous ?</h3>
			<p class="mt-1 text-sm text-mist">
				<strong class="capitalize text-ink">{prettyDate(cancelTarget.date)}</strong> · {cancelTarget.time} · {cancelTarget.kind}
				— le créneau sera immédiatement libéré et l'événement Google supprimé.
			</p>
			<div class="mt-4 grid gap-2">
				<button type="button" disabled={busy} class="rounded-xl bg-danger px-5 py-2.5 text-sm font-bold text-white transition hover:bg-danger-dark disabled:opacity-50" onclick={cancelRdv}>
					{busy ? 'Annulation…' : 'Oui, annuler'}
				</button>
				<button type="button" class="rounded-xl border-2 border-line px-5 py-2.5 text-sm font-semibold text-ink" onclick={() => (cancelTarget = null)}>Garder mon rendez-vous</button>
			</div>
		</div>
	</div>
{/if}
