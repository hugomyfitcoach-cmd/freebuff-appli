<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import BackToHome from '$lib/components/BackToHome.svelte';
	import { onNotificationCounts } from '$lib/notificationPoll';

	let { data } = $props();

	/* Mécanisme central de propagation : si un contenu vient d'être partagé
	   pendant que la cliente est déjà sur cette page (compteur Drive qui
	   monte), la liste se revalide toute seule — aucun refresh manuel. */
	let prevDrive: number | null = null;
	$effect(() => {
		return onNotificationCounts((c) => {
			if (prevDrive != null && c.drive > prevDrive) void invalidateAll().catch(() => {});
			prevDrive = c.drive;
		});
	});

	type Attachment = {
		storageId: string;
		mime: string;
		name: string;
		size: number;
		url: string | null;
	};
	type Resource = {
		_id: string;
		kind: 'note' | 'file';
		title: string;
		body?: string | null;
		visibility: 'private' | 'shared';
		name?: string | null;
		mime?: string | null;
		size?: number | null;
		attachmentsWithUrls?: Attachment[] | null;
		createdAt: number;
		updatedAt: number;
		url: string | null;
	};
	const rows = $derived<Resource[]>((data.rows ?? []) as Resource[]);

	function dateLabel(ts: number): string {
		const d = new Date(ts);
		const today = new Date();
		const sameYear = d.getFullYear() === today.getFullYear();
		const fmt: Intl.DateTimeFormatOptions = sameYear
			? { day: 'numeric', month: 'long' }
			: { day: 'numeric', month: 'long', year: 'numeric' };
		return d.toLocaleDateString('fr-FR', fmt).replace(/^./, (c) => c.toUpperCase());
	}
	function sizeLabel(bytes?: number | null): string {
		if (!bytes) return '';
		if (bytes < 1024) return `${bytes} o`;
		if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
		return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
	}
	function fileKind(mime?: string | null): string {
		const m = (mime ?? '').toLowerCase();
		if (m.startsWith('image/')) return 'image';
		if (m === 'application/pdf') return 'pdf';
		return 'file';
	}
	const kindIcon = (kind: string) =>
		kind === 'note' ? 'fileText' : kind === 'image' ? 'image' : kind === 'pdf' ? 'fileText' : 'fileText';
	/** Pièces jointes de l'entrée : forme historique (1 fichier) ou attachments. */
	function rowFiles(r: Resource): Attachment[] {
		if (r.kind !== 'file') return [];
		const atts = r.attachmentsWithUrls ?? [];
		if (atts.length > 0) return atts;
		if (r.url && r.name) {
			return [{ storageId: '', mime: r.mime ?? '', name: r.name, size: r.size ?? 0, url: r.url }];
		}
		return [];
	}
</script>

<svelte:head><title>Drive — G-Flux</title></svelte:head>

<BackToHome label="Drive" />

<header class="mb-5">
	<h1 class="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
		<Icon name="cloud" size={22} class="shrink-0 text-brand" /> Drive
	</h1>
	<p class="mt-1 text-sm text-mist">Documents et récap partagés par ton coach — plus récents en premier.</p>
</header>

{#if rows.length === 0}
	<div class="rounded-3xl border border-dashed border-line bg-card px-6 py-14 text-center">
		<p class="grid place-items-center"><Icon name="cloud" size={30} class="text-mist" /></p>
		<p class="mt-3 text-sm font-semibold text-ink">Rien pour l'instant</p>
		<p class="mx-auto mt-1 max-w-xs text-sm text-mist">Quand ton coach partagera un document, un récap ou une comparaison, tu le retrouveras ici.</p>
	</div>
{:else}
	<ul class="space-y-3">
		{#each rows as row (row._id)}
			{@const files = rowFiles(row)}
			<li class="overflow-hidden rounded-3xl border border-line bg-card shadow-sm">
				<div class="flex items-start gap-3 px-5 py-4">
					<span class="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand-light">
						<Icon name={row.kind === 'note' ? 'fileText' : files.length > 1 ? 'images' : kindIcon(fileKind(files[0]?.mime))} size={18} class="text-brand" />
					</span>
					<div class="min-w-0 flex-1">
						<p class="text-[11px] font-bold uppercase tracking-wide text-mist">{dateLabel(row.createdAt)}</p>
						<h2 class="mt-0.5 break-words text-[15px] font-bold leading-snug text-ink">{row.title}</h2>
						{#if row.body}
							<p class="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-ink/80">{row.body}</p>
						{/if}
					</div>
				</div>

				{#if files.length > 0}
					<ul class="space-y-1.5 border-t border-line px-5 py-3">
						{#each files as f, i (f.storageId + f.name + i)}
							{@const kind = fileKind(f.mime)}
							<li>
								{#if f.url}
									<a
										href={f.url}
										target="_blank"
										rel="noopener noreferrer"
										download={f.name}
										class="flex w-full items-center gap-2.5 rounded-xl border border-line px-3 py-2.5 transition hover:border-brand"
									>
										<Icon name={kindIcon(kind)} size={15} class="shrink-0 text-mist" />
										<span class="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{f.name}</span>
										{#if f.size}<span class="shrink-0 text-[11px] text-mist">{sizeLabel(f.size)}</span>{/if}
										<Icon name={kind === 'image' ? 'eye' : 'download'} size={15} class="shrink-0 text-brand" />
									</a>
								{:else}
									<div class="flex w-full items-center gap-2.5 rounded-xl border border-line px-3 py-2.5">
										<Icon name={kindIcon(kind)} size={15} class="shrink-0 text-mist" />
										<span class="min-w-0 flex-1 truncate text-sm font-semibold text-mist">{f.name}</span>
										{#if f.size}<span class="shrink-0 text-[11px] text-mist">{sizeLabel(f.size)}</span>{/if}
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
