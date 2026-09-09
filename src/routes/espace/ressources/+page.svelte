<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import BackToHome from '$lib/components/BackToHome.svelte';

	let { data } = $props();

	type Resource = {
		_id: string;
		kind: 'note' | 'file';
		title: string;
		body?: string | null;
		visibility: 'private' | 'shared';
		name?: string | null;
		mime?: string | null;
		size?: number | null;
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
	function fileKind(r: Resource): string {
		const m = (r.mime ?? '').toLowerCase();
		if (m.startsWith('image/')) return 'image';
		if (m === 'application/pdf') return 'pdf';
		return 'file';
	}
	const kindIcon = (kind: string) =>
		kind === 'note' ? 'fileText' : kind === 'image' ? 'image' : kind === 'pdf' ? 'fileText' : 'fileText';
</script>

<svelte:head><title>Ressources — G-Flux</title></svelte:head>

<BackToHome label="Ressources" />

<header class="mb-5">
	<h1 class="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
		<Icon name="bookOpen" size={22} class="shrink-0 text-brand" /> Ressources
	</h1>
	<p class="mt-1 text-sm text-mist">Documents et récap partagés par ta coach — plus récents en premier.</p>
</header>

{#if rows.length === 0}
	<div class="rounded-3xl border border-dashed border-line bg-card px-6 py-14 text-center">
		<p class="grid place-items-center"><Icon name="bookOpen" size={30} class="text-mist" /></p>
		<p class="mt-3 text-sm font-semibold text-ink">Rien pour l'instant</p>
		<p class="mx-auto mt-1 max-w-xs text-sm text-mist">Quand ta coach partagera un document, un récap ou une comparaison, tu le retrouveras ici.</p>
	</div>
{:else}
	<ul class="space-y-3">
		{#each rows as row (row._id)}
			{@const kind = fileKind(row)}
			<li class="overflow-hidden rounded-3xl border border-line bg-card shadow-sm">
				<div class="flex items-start gap-3 px-5 py-4">
					<span class="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand-light">
						<Icon name={kindIcon(kind)} size={18} class="text-brand" />
					</span>
					<div class="min-w-0 flex-1">
						<p class="text-[11px] font-bold uppercase tracking-wide text-mist">{dateLabel(row.createdAt)}</p>
						<h2 class="mt-0.5 break-words text-[15px] font-bold leading-snug text-ink">{row.title}</h2>
						{#if row.kind === 'note' && row.body}
							<p class="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-ink/80">{row.body}</p>
						{:else if row.name}
							<p class="mt-1 truncate text-xs text-mist">
								{row.name}{row.size ? ` · ${sizeLabel(row.size)}` : ''}
							</p>
						{/if}
					</div>
				</div>

				{#if row.kind === 'file' && row.url}
					<div class="border-t border-line px-5 py-3">
						<a
							href={row.url}
							target="_blank"
							rel="noopener noreferrer"
							download={row.name ?? undefined}
							class="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-ink px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand"
						>
							<Icon name={kind === 'image' ? 'eye' : 'download'} size={15} class="shrink-0" />
							{kind === 'image' ? 'Voir le document' : 'Ouvrir le document'}
							<Icon name="externalLink" size={14} class="shrink-0 opacity-70" />
						</a>
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
