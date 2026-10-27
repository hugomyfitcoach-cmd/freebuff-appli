<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import Icon from './Icon.svelte';
	import { sheetFade, sheetFly } from '$lib/sheetMotion';
	import { formatDetailValue } from '$lib/foodDetailsFormat';
	import { etatFibres, type BilanJourData } from '$lib/bilanJour';

	/* VOLET « BILAN NUTRITIONNEL DU JOUR » (Mission R5c).
	   Même volet que les autres saisies rapides de l'app (sheetMotion :
	   fondu + glissement, fond cliquable, Échap, safe area iOS), mobile
	   d'abord : feuille ancrée en bas sur téléphone, panneau centré sur
	   desktop. Aucune valeur inventée : `—` quand la source ne publie pas
	   la donnée, et un total partiel est toujours annoncé comme tel. */

	let {
		open,
		date,
		bilan,
		loading = false,
		error = '',
		onClose
	}: {
		open: boolean;
		/** Date affichée du journal ("yyyy-mm-dd"). */
		date: string;
		bilan: BilanJourData | null;
		loading?: boolean;
		error?: string;
		onClose: () => void;
	} = $props();

	const etat = $derived(
		bilan ? etatFibres(bilan.fibres, bilan.repere, bilan.couverture) : null
	);

	const dateLabel = $derived.by(() => {
		const d = new Date(date + 'T12:00:00');
		const label = d.toLocaleDateString('fr-FR', {
			weekday: 'long',
			day: 'numeric',
			month: 'long'
		});
		return label.charAt(0).toUpperCase() + label.slice(1);
	});

	/** Accord du nombre d'aliments (« 1 aliment » · « 10 aliments »). */
	const alimentsWord = $derived((bilan?.aliments ?? 0) > 1 ? 'aliments' : 'aliment');

	const sourcesLabel = $derived(
		(bilan?.sourcesFibres ?? [])
			.map((s) => `${s.name} ${formatDetailValue(s.fibres, 'g')} g`)
			.join(' · ')
	);

	/** « 22 g », « 12,4 g » — une décimale sous 10, virgule (fiche détaillée). */
	const g = (n: number | null) => formatDetailValue(n, 'g');
	const sel = (n: number | null) => formatDetailValue(n, 'salt');
	/** Valeur + unité, sans « — g » quand la source ne donne rien. */
	const avecUnite = (n: number | null, unite: string) =>
		n === null ? formatDetailValue(null, 'g') : `${g(n)} ${unite}`;

	function onKey(e: KeyboardEvent) {
		if (open && e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={onKey} />

{#if open}
	<div
		role="presentation"
		transition:fade={sheetFade()}
		class="fixed inset-0 z-[60] flex items-end justify-center bg-[#0F1512]/38 backdrop-blur-sm sm:items-center sm:p-6"
		onclick={(e) => {
			if (e.target === e.currentTarget) onClose();
		}}
	>
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="bilan-jour-title"
			transition:fly={sheetFly()}
			class="max-h-[88dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-[28px] bg-white px-5 pt-5 shadow-[0_-20px_50px_-20px_rgba(15,21,18,0.35)] sm:rounded-[28px]"
			style="padding-bottom: max(env(safe-area-inset-bottom), 20px);"
		>
			<div class="flex items-start justify-between gap-3">
				<div class="min-w-0">
					<h2
						id="bilan-jour-title"
						class="font-display text-[21px] font-black tracking-[-0.02em] text-ink"
					>
						Bilan nutritionnel du jour
					</h2>
					<p class="mt-0.5 text-[13px] font-semibold text-mist">
						{#if bilan}
							{dateLabel} · {bilan.aliments}
							{alimentsWord} · {bilan.kcal.toLocaleString('fr-FR')} kcal
						{:else}
							{dateLabel}
						{/if}
					</p>
				</div>
				<button
					type="button"
					class="-mr-2 -mt-1.5 grid h-11 w-11 shrink-0 place-items-center rounded-full text-mist hover:bg-soft"
					aria-label="Fermer"
					onclick={onClose}
				>
					<Icon name="x" size={20} />
				</button>
			</div>

			{#if loading}
				<p class="py-8 text-center text-[13px] text-mist">Calcul du bilan…</p>
			{:else if error}
				<p role="alert" class="mt-4 rounded-xl bg-soft px-3 py-3 text-[13px] text-mist">
					{error}
				</p>
			{:else if bilan && etat}
				<p class="mt-2 text-[12.5px] font-semibold text-mist">
					Calculé sur {bilan.couverture} % des calories de la journée
				</p>

				<!-- ─── Fibres : valeur, repère, jauge et principales sources ─── -->
				<section class="mt-4 rounded-[20px] bg-brand-soft px-4 py-4">
					<div class="flex items-baseline justify-between gap-2">
						<h3 class="text-[16px] font-black text-ink">Fibres</h3>
						{#if etat.valeur !== null}
							<p class="text-right tabular-nums">
								{#if etat.mention === 'au-moins'}
									<span class="text-[11px] font-bold uppercase tracking-wide text-mist">au moins </span>
								{/if}
								<span class="text-[22px] font-black leading-none text-brand">{g(etat.valeur)}</span>
								<span class="text-[13px] font-semibold text-mist"> g / {bilan.repere} g</span>
							</p>
						{/if}
					</div>

					{#if etat.jauge}
						<div class="mt-2.5 h-[9px] w-full overflow-hidden rounded-full bg-white" aria-hidden="true">
							<div
								class="h-full rounded-full transition-[width] duration-500 ease-out {etat.niveau === 'complete' ? 'bg-brand' : 'bg-mist'}"
								style:width="{etat.pct}%"
							></div>
						</div>
					{:else}
						<p class="mt-1.5 text-[13px] font-semibold text-mist">
							Pas assez de données aujourd'hui pour un total fiable.
						</p>
					{/if}

					{#if etat.niveau === 'partielle'}
						<p class="mt-1.5 text-[11px] font-semibold text-mist">
							Données incomplètes : le total est un minimum.
						</p>
					{/if}

					<p class="mt-2.5 text-[13px] leading-snug text-ink/80">
						Repère adapté à ton objectif : 15 g pour 1 000 kcal, jamais moins de 25 g.
					</p>
					{#if sourcesLabel}
						<p class="mt-1.5 text-[12.5px] leading-snug text-mist">
							Principales sources : {sourcesLabel}
						</p>
					{/if}
				</section>

				<!-- ─── Sucres · AGS · Sel (lignes sobres, aucun repère) ─── -->
				<section class="mt-3 overflow-hidden rounded-[20px] border border-line bg-white px-4">
					<div class="flex items-baseline justify-between gap-3 border-b border-line/70 py-3">
						<span class="text-[14px] font-bold text-ink">Sucres</span>
						<span class="text-[14px] font-bold text-ink tabular-nums">
							{avecUnite(bilan.sucres, 'g')}
						</span>
					</div>
					<div class="flex items-baseline justify-between gap-3 border-b border-line/70 py-3">
						<span class="shrink-0 text-[14px] font-bold text-ink">Acides gras saturés</span>
						<span class="text-right text-[14px] font-bold text-ink tabular-nums">
							{avecUnite(bilan.ags, 'g')}{#if bilan.ags !== null && bilan.agsPctKcal !== null}<span
									class="font-semibold text-mist"
								>
									· {bilan.agsPctKcal} % des kcal</span
								>{/if}
						</span>
					</div>
					<div class="flex items-baseline justify-between gap-3 py-3">
						<span class="text-[14px] font-bold text-ink"
							>Sel<span class="font-semibold text-mist"> des aliments enregistrés</span></span
						>
						<span class="text-[14px] font-bold text-ink tabular-nums">
							{#if bilan.sel === null}—{:else}{sel(bilan.sel)} g{/if}
						</span>
					</div>
				</section>

				<p class="mt-3 rounded-[16px] bg-warn-light px-4 py-3 text-[12.5px] leading-snug text-ink/80">
					Le sel ajouté en cuisine ou à table n'est pas compté. Tes besoins varient selon ta
					transpiration et ton activité : parles-en à ton coach si tu as un doute.
				</p>

				<p class="mt-3 text-[12px] leading-snug text-mist">
					Les vitamines et minéraux restent consultables aliment par aliment. Ils ne sont pas
					totalisés : trop d'aliments n'ont pas ces valeurs dans les sources, un total serait faux.
				</p>
			{:else}
				<p class="py-8 text-center text-[13px] text-mist">
					Aucun aliment enregistré sur cette journée.
				</p>
			{/if}
		</div>
	</div>
{/if}
