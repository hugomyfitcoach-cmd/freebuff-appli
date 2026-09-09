<script lang="ts">
	import type { CycleConfig, CycleContra } from '$lib/cycle';

	/**
	 * Questionnaire de configuration du suivi de cycle — mêmes questions que
	 * l'outil historique « Cycle » : contraception hormonale, « je n'ai plus de
	 * règles régulières », premier jour des dernières règles, durée moyenne.
	 * Enregistre via POST /api/cycle (stockage `users.cycle`, par cliente).
	 */
	let {
		config = null,
		onSaved,
		onCancel,
		compact = false,
	}: {
		config?: CycleConfig | null;
		onSaved: (cfg: CycleConfig) => void;
		onCancel?: () => void;
		/** Mode compact (carte Accueil) vs page complète (Mon cycle). */
		compact?: boolean;
	} = $props();

	let cContra = $state<CycleContra>(config?.contra ?? 'none');
	let cNoDate = $state(config ? config.noDate : false);
	let cLmp = $state(config?.lmp ?? '');
	let cLen = $state(String(config?.len ?? 28));
	let cErr = $state('');
	let cSaving = $state(false);

	function pickContra(v: CycleContra) {
		cContra = v;
		if (v === 'hormonal') cNoDate = false;
	}

	async function save() {
		if (cContra !== 'hormonal' && !cNoDate && !cLmp) {
			cErr = 'Indique le premier jour de tes dernières règles.';
			return;
		}
		cSaving = true;
		cErr = '';
		try {
			const res = await fetch('/api/cycle', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					contra: cContra,
					noDate: cContra === 'hormonal' ? false : cNoDate,
					lmp: cContra !== 'hormonal' && !cNoDate ? cLmp : undefined,
					len: cContra !== 'hormonal' && !cNoDate ? parseInt(cLen, 10) : undefined,
				}),
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok || body.error) throw new Error(body.error || "Impossible d'enregistrer.");
			onSaved({
				contra: cContra,
				noDate: cContra === 'hormonal' ? false : cNoDate,
				lmp: cContra !== 'hormonal' && !cNoDate ? cLmp : undefined,
				len: cContra !== 'hormonal' && !cNoDate ? parseInt(cLen, 10) : undefined,
				updatedAt: Date.now(),
			});
		} catch (e) {
			cErr = e instanceof Error ? e.message : "Impossible d'enregistrer.";
		} finally {
			cSaving = false;
		}
	}

	const pad = (n: number) => String(n).padStart(2, '0');
	/** Aujourd'hui (locale) — borne max du sélecteur de date. */
	const maxLmp = $derived.by(() => {
		const d = new Date();
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	});
</script>

<div>
	<p class="text-sm font-bold text-ink">Es-tu sous contraception hormonale ?</p>
	<div class="mt-2 flex flex-col gap-1.5">
		<button
			type="button"
			onclick={() => pickContra('none')}
			class="rounded-xl border-2 px-3 py-2 text-left text-sm font-semibold transition {cContra === 'none' ? 'border-brand bg-white text-ink' : 'border-line bg-white/50 text-mist hover:border-brand/60'}"
		>Non, ou stérilet en cuivre</button>
		<button
			type="button"
			onclick={() => pickContra('iud-hormonal')}
			class="rounded-xl border-2 px-3 py-2 text-left text-sm font-semibold transition {cContra === 'iud-hormonal' ? 'border-brand bg-white text-ink' : 'border-line bg-white/50 text-mist hover:border-brand/60'}"
		>Stérilet hormonal (Mirena, Kyleena…)</button>
		<button
			type="button"
			onclick={() => pickContra('hormonal')}
			class="rounded-xl border-2 px-3 py-2 text-left text-sm font-semibold transition {cContra === 'hormonal' ? 'border-brand bg-white text-ink' : 'border-line bg-white/50 text-mist hover:border-brand/60'}"
		>Pilule, patch, anneau, implant ou injection</button>
	</div>

	{#if cContra !== 'hormonal'}
		<label class="mt-3 flex items-center gap-2.5 text-sm text-ink">
			<input
				type="checkbox"
				class="h-4.5 w-4.5 rounded border-2 border-line accent-brand"
				bind:checked={cNoDate}
			/>
			Je n'ai plus de règles régulières
		</label>

		{#if !cNoDate}
			<div class={compact ? 'mt-3' : 'mt-4'}>
				<p class="text-[11px] font-bold uppercase tracking-widest text-mist">Premier jour des dernières règles</p>
				<input
					type="date"
					max={maxLmp}
					bind:value={cLmp}
					class="mt-1.5 w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm font-semibold text-ink outline-none transition focus:border-brand"
				/>
			</div>

			<div class="mt-3">
				<p class="text-[11px] font-bold uppercase tracking-widest text-mist">Durée moyenne</p>
				<select
					bind:value={cLen}
					class="mt-1.5 w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm font-semibold text-ink outline-none transition focus:border-brand"
				>
					{#each Array.from({ length: 12 }, (_, i) => i + 21) as n (n)}
						<option value={n}>{n} jours</option>
					{/each}
				</select>
				<p class="mt-1.5 text-[11px] leading-snug text-mist">Indique une moyenne plutôt que ton tout dernier cycle : il est normal que la durée varie de quelques jours d'un mois à l'autre.</p>
			</div>
		{/if}
	{/if}

	{#if cErr}
		<p class="mt-3 rounded-xl bg-danger-light px-3 py-2 text-sm text-danger">{cErr}</p>
	{/if}

	<div class="mt-4 flex gap-2">
		<button
			type="button"
			onclick={save}
			disabled={cSaving}
			class="flex-1 rounded-xl bg-brand px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-60 sm:flex-none sm:px-5"
		>{cSaving ? 'Enregistrement…' : 'Enregistrer'}</button>
		{#if onCancel}
			<button
				type="button"
				onclick={onCancel}
				disabled={cSaving}
				class="rounded-xl border-2 border-line px-4 py-2.5 text-sm font-semibold text-mist transition hover:text-ink"
			>Annuler</button>
		{/if}
	</div>
</div>