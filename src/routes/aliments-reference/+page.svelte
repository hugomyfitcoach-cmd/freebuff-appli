<script lang="ts">
	import '../recettes/guide.css';
	import '../outils/tools.css';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import Icon from '$lib/components/Icon.svelte';
	import { kcalMismatchWarning, referenceCookBadge } from '$lib/referenceFoods';
	import { cookingBadge } from '$lib/cookedState';
	import { macroColor } from '$lib/macros';

	let { data } = $props();

	/* ————— ALIMENTS DE RÉFÉRENCE G-FLUX (Mission R3-ter, coach uniquement) —————
	 * Page dédiée (à côté de /recettes) : le coach crée ses aliments de
	 * référence (valeurs /100 g). Ils apparaissent dans « Aliments de référence »
	 * des recherches (journal cliente, fiche cliente, plans) avec le badge
	 * « Référence G-Flux ». Écriture réservée au coach propriétaire (Convex).
	 */
	type ReferenceFood = {
		_id: string;
		name: string;
		kcal: number;
		proteinG: number;
		carbsG: number;
		fatG: number;
		/** Mode de cuisson (valeurs de cookedState.ts) — facultatif. */
		cookingState?: string;
	};
	let refFoods = $state<ReferenceFood[]>([]);
	let refLoading = $state(false);
	let refSaving = $state(false);
	let refMsg = $state('');
	let refMsgOk = $state(false);
	let refConfirmId = $state<string | null>(null);
	let refForm = $state({ id: '', name: '', kcal: '', proteinG: '', carbsG: '', fatG: '', cookingState: '' });

	/** Modes de cuisson proposés (valeurs de cookedState.ts, libellés du badge).
	 *  « Non précisé » = champ absent : la cuisson est détectée d'après le nom. */
	const COOKING_CHOICES = ['cru', 'eau', 'vapeur', 'four', 'poele', 'grille', 'frit', 'conserve'] as const;

	/** Avertissement NON bloquant : kcal ≠ 4P + 4G + 9L à plus de 15 %. */
	const refKcalWarning = $derived(
		kcalMismatchWarning({
			name: refForm.name,
			kcal: Number(refForm.kcal) || 0,
			proteinG: Number(refForm.proteinG) || 0,
			carbsG: Number(refForm.carbsG) || 0,
			fatG: Number(refForm.fatG) || 0,
		})
	);

	async function loadReferenceFoods() {
		refLoading = true;
		try {
			const r = await fetch('/api/coach/reference-foods');
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			refFoods = Array.isArray(j.rows) ? j.rows : [];
		} catch (e) {
			refMsgOk = false;
			refMsg = e instanceof Error ? e.message : String(e);
		} finally {
			refLoading = false;
		}
	}

	function editReferenceFood(food: ReferenceFood) {
		refConfirmId = null;
		refForm = {
			id: food._id,
			name: food.name,
			kcal: String(food.kcal),
			proteinG: String(food.proteinG),
			carbsG: String(food.carbsG),
			fatG: String(food.fatG),
			cookingState: food.cookingState ?? '',
		};
	}

	function resetReferenceForm() {
		refForm = { id: '', name: '', kcal: '', proteinG: '', carbsG: '', fatG: '', cookingState: '' };
	}

	async function saveReferenceFood() {
		if (refSaving) return;
		refSaving = true;
		refMsg = '';
		try {
			const payload = {
				...(refForm.id ? { referenceFoodId: refForm.id } : {}),
				name: refForm.name,
				kcal: Number(refForm.kcal) || 0,
				proteinG: Number(refForm.proteinG) || 0,
				carbsG: Number(refForm.carbsG) || 0,
				fatG: Number(refForm.fatG) || 0,
				cookingState: refForm.cookingState,
			};
			const r = await fetch('/api/coach/reference-foods', {
				method: refForm.id ? 'PATCH' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			refMsgOk = true;
			refMsg = refForm.id ? '✓ Aliment modifié.' : '✓ Aliment de référence créé.';
			resetReferenceForm();
			await loadReferenceFoods();
		} catch (e) {
			refMsgOk = false;
			refMsg = e instanceof Error ? e.message : String(e);
		} finally {
			refSaving = false;
		}
	}

	async function removeReferenceFood(id: string) {
		if (refSaving) return;
		refSaving = true;
		try {
			const r = await fetch(`/api/coach/reference-foods?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			refConfirmId = null;
			if (refForm.id === id) resetReferenceForm();
			refMsgOk = true;
			refMsg = '✓ Aliment supprimé — les entrées passées du journal gardent leurs valeurs.';
			await loadReferenceFoods();
		} catch (e) {
			refMsgOk = false;
			refMsg = e instanceof Error ? e.message : String(e);
		} finally {
			refSaving = false;
		}
	}

	onMount(async () => {
		if (!browser) return;
		await loadReferenceFoods();
	});
</script>

<svelte:head>
	<title>Aliments de référence — G-Flux</title>
</svelte:head>

<div class="guide-root theme-light">
	<div class="home-screen">
		<div class="w-full max-w-[560px]">
			<h1 class="home-title">Aliments de référence</h1>

			<!-- ═══ ENCADRÉ D'EXPLICATION (en haut de la page) ═══ -->
			<section class="recipe-card mt-4 p-4" aria-labelledby="ref-help-title">
				<h2 id="ref-help-title" class="text-base font-black text-ink">Tes aliments de référence</h2>
				<p class="mt-2 text-[13px] leading-relaxed text-ink/80">
					Ajoute ici les aliments que tu recommandes souvent et qui manquent dans la base Ciqual (une préparation précise, un produit que tu utilises avec tes clientes).
				</p>
				<p class="mt-2 text-[13px] leading-relaxed text-ink/80">
					Ce que voient tes clientes : quand elles cherchent un aliment dans leur journal, tes aliments apparaissent dans « Aliments de référence », avec le badge « Référence G-Flux ». À pertinence égale, ils passent avant les aliments Ciqual.
				</p>
				<p class="mt-3 text-[13px] font-bold text-ink">Les bonnes règles :</p>
				<ul class="mt-1 space-y-1 text-[13px] leading-relaxed text-ink/80">
					<li>• Vérifie d'abord que l'aliment n'existe pas déjà dans Ciqual : cherche-le dans un journal.</li>
					<li>• Saisis toujours les valeurs pour 100 g, d'après une source fiable (étiquette, table nutritionnelle).</li>
					<li>• Donne un nom clair, l'aliment d'abord puis les précisions : « Poulet, blanc, sans peau ».</li>
					<li>• Choisis le mode de cuisson : il s'affiche sous le nom pour tes clientes.</li>
					<li>• Modifier ou supprimer un aliment ne change jamais ce que tes clientes ont déjà enregistré.</li>
				</ul>
			</section>

			{#if refMsg}
				<p class="mt-4 rounded-xl px-3 py-2 text-xs font-semibold {refMsgOk ? 'bg-brand-light text-brand' : 'bg-red-50 text-red-600'}" role="status">{refMsg}</p>
			{/if}

			<!-- ═══ FORMULAIRE (création / modification) ═══ -->
			<div class="recipe-card mt-4 p-4">
				<h2 class="text-sm font-black text-ink">{refForm.id ? 'Modifier l’aliment' : 'Nouvel aliment'}</h2>
				<div class="tools-root" style="min-height:0;padding-bottom:0">
					<form
						class="grid grid-cols-1 gap-x-3 sm:grid-cols-2"
						onsubmit={(e) => {
							e.preventDefault();
							saveReferenceFood();
						}}
					>
						<div class="field sm:col-span-2">
							<label for="refName">Nom de l'aliment</label>
							<input id="refName" type="text" maxlength="120" required placeholder="ex. Poulet, blanc, sans peau" bind:value={refForm.name} />
						</div>
						<div class="field">
							<label for="refKcal">kcal / 100 g</label>
							<input id="refKcal" type="number" min="0" max="900" step="0.1" inputmode="decimal" required bind:value={refForm.kcal} />
						</div>
						<div class="field">
							<label for="refProtein">Protéines (g / 100 g)</label>
							<input id="refProtein" type="number" min="0" max="100" step="0.1" inputmode="decimal" required bind:value={refForm.proteinG} />
						</div>
						<div class="field">
							<label for="refCarbs">Glucides (g / 100 g)</label>
							<input id="refCarbs" type="number" min="0" max="100" step="0.1" inputmode="decimal" required bind:value={refForm.carbsG} />
						</div>
						<div class="field">
							<label for="refFat">Lipides (g / 100 g)</label>
							<input id="refFat" type="number" min="0" max="100" step="0.1" inputmode="decimal" required bind:value={refForm.fatG} />
						</div>
						<div class="field sm:col-span-2">
							<label for="refCooking">Mode de cuisson</label>
							<select id="refCooking" bind:value={refForm.cookingState}>
								<option value="">Non précisé</option>
								{#each COOKING_CHOICES as choice (choice)}
									<option value={choice}>{cookingBadge(choice)}</option>
								{/each}
							</select>
						</div>
						{#if refKcalWarning}
							<p class="sm:col-span-2 mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700" role="status">
								⚠️ Les kcal saisies s'écartent de plus de 15 % de 4P + 4G + 9L. Tu peux quand même enregistrer.
							</p>
						{/if}
						<div class="sm:col-span-2">
							<button type="submit" class="cta" disabled={refSaving}>
								{refForm.id ? 'Enregistrer la modification' : 'Créer l’aliment'}
							</button>
							{#if refForm.id}
								<button type="button" class="mt-2 w-full rounded-[11px] border border-line px-4 py-2.5 text-sm font-semibold text-mist" onclick={resetReferenceForm}>Annuler</button>
							{/if}
						</div>
					</form>
				</div>
			</div>

			<!-- ═══ LISTE DES ALIMENTS ═══ -->
			<h2 class="mt-6 text-sm font-black uppercase tracking-widest text-mist">Mes aliments</h2>
			{#if refLoading}
				<p class="mt-3 text-xs text-mist">Chargement…</p>
			{:else if refFoods.length === 0}
				<p class="mt-3 py-6 text-center text-sm text-mist">Aucun aliment pour l'instant.</p>
			{:else}
				<ul class="mt-3 flex flex-col gap-2">
					{#each refFoods as food (food._id)}
						<li class="recipe-card p-3">
							<div class="flex flex-wrap items-start gap-2">
								<div class="min-w-0 flex-1">
									<p class="break-words text-sm font-semibold text-ink">{food.name}</p>
									{#if referenceCookBadge(food)}
										<span class="mt-1 inline-flex rounded-full bg-[#F1F0EC] px-2 py-0.5 text-[9px] font-semibold text-[#6E6A62]">{referenceCookBadge(food)}</span>
									{/if}
									<p class="mt-1 text-xs text-mist tabular-nums">{food.kcal} kcal / 100 g</p>
									<p class="mt-0.5 flex flex-wrap gap-x-2 text-xs font-semibold tabular-nums">
										<span style="color:{macroColor('protein')}">P {food.proteinG} g</span>
										<span style="color:{macroColor('carbs')}">G {food.carbsG} g</span>
										<span style="color:{macroColor('fat')}">L {food.fatG} g</span>
									</p>
								</div>
								<div class="flex shrink-0 flex-wrap items-center gap-1.5">
									<button
										type="button"
										class="grid h-9 w-9 place-items-center rounded-full border border-line text-ink transition hover:border-brand"
										aria-label={`Modifier ${food.name}`}
										title="Modifier"
										onclick={() => editReferenceFood(food)}
									>
										<Icon name="pencil" size={15} />
									</button>
									{#if refConfirmId === food._id}
										<button
											type="button"
											class="rounded-full bg-red-500 px-3 py-1.5 text-[11px] font-semibold text-white"
											onclick={() => removeReferenceFood(food._id)}
										>
											Confirmer la suppression
										</button>
										<button type="button" class="rounded-full border border-line px-3 py-1.5 text-[11px] font-semibold text-mist" onclick={() => (refConfirmId = null)}>
											Annuler
										</button>
									{:else}
										<button
											type="button"
											class="grid h-9 w-9 place-items-center rounded-full border border-red-200 text-red-600 transition hover:border-red-400"
											aria-label={`Supprimer ${food.name}`}
											title="Supprimer"
											onclick={() => (refConfirmId = food._id)}
										>
											<Icon name="trash" size={15} />
										</button>
									{/if}
								</div>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>
</div>
