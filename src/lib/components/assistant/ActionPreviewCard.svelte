<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';

	/**
	 * PRÉVISUALISATION AVANT ENREGISTREMENT (§16) — le cœur du garde-fou
	 * « jamais d'écriture silencieuse ».
	 *
	 * Le contenu (`preview`) a été CALCULÉ PAR LE SERVEUR (outil prepare*) :
	 * ce composant ne fait que l'afficher. Le clic « Enregistrer » appelle
	 * `POST /api/assistant/action` avec l'`actionId` seul — aucun payload
	 * n'est reconstruit côté client.
	 */
	type PreviewLine = {
		label: string;
		detail?: string;
		kcal?: number;
		carbs?: number;
		protein?: number;
		fat?: number;
		estimated?: boolean;
		source?: string;
	};
	type Preview = {
		title: string;
		lines: PreviewLine[];
		totals?: { kcal: number; carbs: number; protein: number; fat: number };
		notice?: string;
	};

	let {
		preview,
		status = 'pending',
		result = '',
		busy = false,
		onconfirm,
		oncancel,
		onundo,
	}: {
		preview: Preview;
		status?: 'pending' | 'confirmed' | 'undone';
		result?: string;
		busy?: boolean;
		onconfirm?: () => void;
		oncancel?: () => void;
		onundo?: () => void;
	} = $props();

	const SOURCE_LABEL: Record<string, string> = {
		product: 'Base G-FLUX',
		personal: 'Aliment créé par moi',
		reference: 'Référence Ciqual – ANSES',
		portion: 'Portion mémorisée',
		user: 'Ta quantité',
		correction: 'Correction',
		ai: 'Estimation IA',
	};

	const fmt = (n: number) => (Math.round(n * 10) / 10).toString().replace('.', ',');
</script>

<div
	class="overflow-hidden rounded-3xl border border-brand/30 bg-card shadow-sm"
	role="group"
	aria-label={preview.title}
>
	<div class="flex items-center gap-2 border-b border-brand/20 bg-brand-light px-4 py-3">
		<span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand text-white">
			<Icon name={status === 'confirmed' ? 'check' : 'eye'} size={15} strokeWidth={2.6} />
		</span>
		<p class="min-w-0 flex-1 truncate text-[13px] font-black text-brand-dark">
			{status === 'confirmed' ? 'Enregistré' : status === 'undone' ? 'Annulé' : 'Prévisualisation avant enregistrement'}
		</p>
	</div>

	<div class="px-4 py-3">
		<p class="text-[13px] font-bold text-ink">{preview.title}</p>

		<ul class="mt-2 space-y-2">
			{#each preview.lines as line (line.label + (line.detail ?? ''))}
				<li class="flex items-start justify-between gap-3 rounded-2xl bg-soft/70 px-3 py-2">
					<div class="min-w-0">
						<p class="truncate text-[13px] font-semibold text-ink">
							{line.label}
							{#if line.estimated}
								<span class="ml-1 rounded-full bg-warn-light px-1.5 py-0.5 text-[10px] font-black uppercase text-warn">≈ estimation</span>
							{/if}
						</p>
						{#if line.detail}
							<p class="mt-0.5 truncate text-[11px] text-mist">{line.detail}</p>
						{/if}
						{#if line.source && SOURCE_LABEL[line.source]}
							<p class="mt-0.5 text-[10.5px] font-semibold text-mist-strong">Source : {SOURCE_LABEL[line.source]}</p>
						{/if}
					</div>
					{#if line.kcal !== undefined}
						<p class="shrink-0 whitespace-nowrap text-[13px] font-black text-ink tabular-nums">
							{line.estimated ? '≈ ' : ''}{Math.round(line.kcal)} kcal
						</p>
					{/if}
				</li>
			{/each}
		</ul>

		{#if preview.totals}
			<div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-line bg-cream/50 px-3 py-2">
				<p class="text-[13px] font-black text-ink tabular-nums">Total ≈ {Math.round(preview.totals.kcal)} kcal</p>
				<p class="text-[11.5px] font-semibold text-mist-strong tabular-nums">
					G {fmt(preview.totals.carbs)} · P {fmt(preview.totals.protein)} · L {fmt(preview.totals.fat)}
				</p>
			</div>
		{/if}

		{#if preview.notice}
			<p class="mt-2 text-[11.5px] leading-snug text-mist-strong">{preview.notice}</p>
		{/if}

		{#if status === 'pending'}
			<div class="mt-3 flex gap-2">
				<button
					type="button"
					class="min-h-11 flex-1 rounded-full border-2 border-line bg-white text-[13px] font-bold text-ink transition hover:border-ink/30 disabled:opacity-60"
					disabled={busy}
					onclick={() => oncancel?.()}
				>
					Modifier
				</button>
				<button
					type="button"
					class="min-h-11 flex-1 rounded-full bg-brand text-[13px] font-black text-white transition hover:bg-brand-dark disabled:opacity-60"
					disabled={busy}
					onclick={() => onconfirm?.()}
				>
					{busy ? 'Enregistrement…' : 'Enregistrer'}
				</button>
			</div>
		{:else if status === 'confirmed' && result}
			<div class="mt-3 flex flex-wrap items-center justify-between gap-2">
				<p class="text-[12px] font-bold text-brand-dark">{result}</p>
				{#if onundo}
					<button
						type="button"
						class="inline-flex min-h-9 items-center gap-1 rounded-full border border-line px-3 text-[12px] font-bold text-mist-strong transition hover:text-ink disabled:opacity-60"
						disabled={busy}
						onclick={() => onundo?.()}
					>
						<Icon name="undo" size={13} /> Annuler
					</button>
				{/if}
			</div>
		{/if}
	</div>
</div>
