<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import { fmtNotifDate, notifLabel, notifLink, notifStyle, type CoachNotifKind } from '$lib/notifications';

	type Row = {
		_id: string;
		userId: string;
		prenom: string;
		kind: CoachNotifKind;
		description: string;
		read: boolean;
		createdAt: number;
	};

	let { data } = $props();
	const rows = $derived<Row[]>(data.rows ?? []);
	const toConsult = $derived(rows.filter((r) => !r.read));
	const viewed = $derived(rows.filter((r) => r.read));

	let busy = $state(false);
	let error = $state('');

	/**
	 * Marquages optimistes (ids) : la ligne et le badge passent « vue »
	 * immédiatement, sans attendre l'aller-retour serveur + invalidateAll.
	 */
	let checked = $state(new Set<string>());
	const unread = $derived<number>((data.unread ?? 0) - [...checked].filter((id) => toConsult.some((r) => r._id === id)).length);

	/** Un clic ouvre la fiche cliente sur la section concernée ET marque la notification « vue ». */
	async function open(row: Row) {
		if (row.read || busy) return;
		checked = new Set(checked).add(row._id);
		busy = true;
		try {
			const res = await fetch('/api/coach/notifications', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ notificationId: row._id }),
			});
			if (!res.ok) throw new Error('Erreur');
			await invalidateAll();
		} catch {
			// Échec silencieux : la notification reste « à consulter » au retour.
		} finally {
			busy = false;
		}
	}

	/** Coche individuelle : « à consulter » → « vue » (optimiste + badge live). */
	async function markRead(row: Row) {
		if (row.read || checked.has(row._id)) return;
		checked = new Set(checked).add(row._id);
		try {
			const res = await fetch('/api/coach/notifications', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ notificationId: row._id }),
			});
			if (!res.ok) throw new Error('Erreur');
			await invalidateAll();
		} catch {
			// Échec silencieux : la notification reste « à consulter » (coche retirée).
		} finally {
			const next = new Set(checked);
			next.delete(row._id);
			checked = next;
		}
	}

	/** « Tout marquer comme vu » — un seul appel, le badge retombe à zéro. */
	async function markAllRead() {
		if (busy || toConsult.length === 0) return;
		checked = new Set(toConsult.map((r) => r._id));
		busy = true;
		error = '';
		try {
			const res = await fetch('/api/coach/notifications', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ all: true }),
			});
			const j = await res.json();
			if (!res.ok) throw new Error(j.error ?? 'Erreur');
			await invalidateAll();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Erreur';
		} finally {
			busy = false;
			checked = new Set<string>();
		}
	}
</script>

<svelte:head><title>Notifications — G-Flux (CRM)</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3">
	<div>
		<h1 class="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
			<Icon name="bell" size={22} class="shrink-0 text-brand" /> Notifications
		</h1>
		<p class="mt-1 text-sm text-mist">
			Activité des clientes — poids, mensurations, photos, rendez-vous et bilans, au même endroit.
		</p>
	</div>
	{#if toConsult.length > 0}
		<button
			type="button"
			onclick={markAllRead}
			disabled={busy}
			class="inline-flex items-center gap-1.5 rounded-xl border-2 border-line bg-card px-3.5 py-2 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand disabled:opacity-50"
		>
			<Icon name="check" size={14} class="shrink-0" /> Tout marquer comme vu
		</button>
	{/if}
</div>

{#if error}
	<p class="mt-4 rounded-xl border border-danger/40 bg-danger-light px-4 py-3 text-sm text-danger">{error}</p>
{/if}

<!-- ═══ À consulter ═══ -->
<section class="mt-5">
	<h2 class="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-warn">
		<span class="h-2 w-2 rounded-full bg-warn"></span> À consulter
		{#if unread > 0}<span class="rounded-full bg-warn px-2 py-0.5 text-[11px] font-bold text-white">{unread}</span>{/if}
		<!-- badge = compteur live (marquages optimistes inclus) -->
	</h2>
	{#if toConsult.length === 0}
		<p class="mt-2 rounded-xl border border-dashed border-line bg-card px-4 py-6 text-center text-sm text-mist">
			Rien à consulter ✓
		</p>
	{:else}
		<div class="mt-2 space-y-1.5">
			{#each toConsult as row (row._id)}
				{@const st = notifStyle(row.kind)}
				{@const done = checked.has(row._id)}
				<div
					class="flex items-center gap-3 rounded-xl border border-warn/40 bg-white px-3 py-2.5 transition hover:border-warn hover:bg-warn-light/20 {done ? 'opacity-60' : ''}"
				>
					<a
						href={notifLink(row.userId, row.kind)}
						onclick={() => open(row)}
						class="flex min-w-0 flex-1 items-center gap-3"
					>
						<span class="grid h-9 w-9 shrink-0 place-items-center rounded-full {st.bg} {st.text}">
							<Icon name={st.icon} size={16} />
						</span>
						<span class="min-w-0 flex-1">
							<span class="flex flex-wrap items-baseline gap-x-2">
								<span class="truncate text-sm font-bold text-ink">{row.prenom}</span>
								<span class="truncate text-xs font-semibold {st.text}">{notifLabel(row.kind)}</span>
							</span>
							<span class="mt-0.5 block truncate text-xs text-mist">{row.description}</span>
						</span>
						<span class="shrink-0 text-right text-[11px] leading-tight text-mist">{fmtNotifDate(row.createdAt)}</span>
					</a>
					<button
						type="button"
						aria-label="Marquer comme vu"
						title="Marquer comme vu"
						disabled={done}
						onclick={() => void markRead(row)}
						class="grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-warn/60 text-warn transition hover:border-warn hover:bg-warn hover:text-white disabled:cursor-default disabled:border-brand disabled:bg-brand disabled:text-white"
					>
						<Icon name="check" size={13} />
					</button>
				</div>
			{/each}
		</div>
	{/if}
</section>

<!-- ═══ Vu ═══ -->
{#if viewed.length > 0}
	<section class="mt-6">
		<h2 class="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-mist">
			<Icon name="eye" size={12} class="shrink-0" /> Vu
		</h2>
		<div class="mt-2 space-y-1.5">
			{#each viewed as row (row._id)}
				{@const st = notifStyle(row.kind)}
				<a
					href={notifLink(row.userId, row.kind)}
					class="flex items-center gap-3 rounded-xl border border-line/70 bg-card px-3 py-2.5 transition hover:border-brand/50"
				>
					<span class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-line/60 text-mist">
						<Icon name={st.icon} size={16} />
					</span>
					<span class="min-w-0 flex-1">
						<span class="flex flex-wrap items-baseline gap-x-2">
							<span class="truncate text-sm font-semibold text-ink/70">{row.prenom}</span>
							<span class="truncate text-xs text-mist">{notifLabel(row.kind)}</span>
						</span>
						<span class="mt-0.5 block truncate text-xs text-mist/80">{row.description}</span>
					</span>
					<span class="shrink-0 text-right text-[11px] leading-tight text-mist">{fmtNotifDate(row.createdAt)}</span>
				</a>
			{/each}
		</div>
	</section>
{/if}
