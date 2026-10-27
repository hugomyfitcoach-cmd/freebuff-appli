<script lang="ts">
	/**
	 * ALIMENTS DE RÉFÉRENCE G-FLUX (Mission R3-ter, coach uniquement).
	 * Page déplacée dans l'espace coach (/admin/aliments-reference) : elle hérite
	 * du cadre CRM (menu de gauche, en-tête, marges) et du contrôle d'accès
	 * coach du layout /admin. Mise en page identique à /admin/templates
	 * (mêmes classes card-crm / m-in-crm, mêmes champs et bouton vert).
	 * AUCUN changement de comportement : mêmes appels API, mêmes validations,
	 * même avertissement 4P + 4G + 9L.
	 */
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import Icon from '$lib/components/Icon.svelte';
	import { kcalMismatchWarning, referenceCookBadge } from '$lib/referenceFoods';
	import { cookingBadge } from '$lib/cookedState';
	import { macroColor } from '$lib/macros';

	type ReferenceFood = {
		_id: string;
		name: string;
		kcal: number;
		proteinG: number;
		carbsG: number;
		fatG: number;
		/** Mode de cuisson (valeurs de cookedState.ts) — facultatif. */
		cookingState?: string;
		/** Détail nutritionnel /100 g (R5a) — facultatif. */
		sugarsG?: number;
		fiberG?: number;
		saturatedFatG?: number;
		saltG?: number;
	};
	let refFoods = $state<ReferenceFood[]>([]);
	let refLoading = $state(false);
	let refSaving = $state(false);
	let refMsg = $state('');
	let refMsgOk = $state(false);
	let refConfirmId = $state<string | null>(null);
	let refForm = $state({
		id: '',
		name: '',
		kcal: '',
		proteinG: '',
		carbsG: '',
		fatG: '',
		cookingState: '',
		/* Détail facultatif /100 g (R5a) — vide = non renseigné. */
		sugarsG: '',
		fiberG: '',
		saturatedFatG: '',
		saltG: '',
	});

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
			sugarsG: food.sugarsG !== undefined ? String(food.sugarsG) : '',
			fiberG: food.fiberG !== undefined ? String(food.fiberG) : '',
			saturatedFatG: food.saturatedFatG !== undefined ? String(food.saturatedFatG) : '',
			saltG: food.saltG !== undefined ? String(food.saltG) : '',
		};
	}

	function resetReferenceForm() {
		refForm = {
			id: '',
			name: '',
			kcal: '',
			proteinG: '',
			carbsG: '',
			fatG: '',
			cookingState: '',
			sugarsG: '',
			fiberG: '',
			saturatedFatG: '',
			saltG: '',
		};
	}

	/** Champ facultatif du formulaire : vide → absent, sinon nombre.
	 *  `bind:value` d'un input number rend un nombre (ou undefined) : on
	 *  normalise en texte avant de tester le vide. */
	function optionalFormValue(raw: unknown): number | undefined {
		const text = String(raw ?? '').trim();
		return text === '' ? undefined : Number(text);
	}

	async function saveReferenceFood() {
		if (refSaving) return;
		refSaving = true;
		refMsg = '';
		try {
			// Détail facultatif (R5a) — champ vide = absent.
			const sugarsG = optionalFormValue(refForm.sugarsG);
			const fiberG = optionalFormValue(refForm.fiberG);
			const saturatedFatG = optionalFormValue(refForm.saturatedFatG);
			const saltG = optionalFormValue(refForm.saltG);
			const payload = {
				...(refForm.id ? { referenceFoodId: refForm.id } : {}),
				name: refForm.name,
				kcal: Number(refForm.kcal) || 0,
				proteinG: Number(refForm.proteinG) || 0,
				carbsG: Number(refForm.carbsG) || 0,
				fatG: Number(refForm.fatG) || 0,
				cookingState: refForm.cookingState,
				...(sugarsG !== undefined ? { sugarsG } : {}),
				...(fiberG !== undefined ? { fiberG } : {}),
				...(saturatedFatG !== undefined ? { saturatedFatG } : {}),
				...(saltG !== undefined ? { saltG } : {}),
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
	<title>Aliments de référence — CRM G-Flux</title>
</svelte:head>

<!-- ═══ En-tête (identique à /admin/templates) ═══ -->
<div class="m-in-crm flex flex-wrap items-start justify-between gap-3" style="--m-i: 0">
	<div class="min-w-0">
		<h1 class="flex items-center gap-2.5 font-display text-2xl font-black tracking-tight text-ink">
			<span class="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand-light text-brand-deep"><Icon name="salad" size={20} /></span>
			<span class="min-w-0">Aliments de référence</span>
		</h1>
		<p class="mt-1.5 text-sm text-mist">Ajoute tes propres aliments, visibles par tes clientes dans leur recherche.</p>
	</div>
</div>

<!-- ═══ Encadré d'explication, replié par défaut ═══ -->
<details class="m-in-crm card-crm mt-4 p-5" style="--m-i: 1">
	<summary class="flex cursor-pointer list-none items-center justify-between gap-2 font-display text-[15px] font-bold text-ink">
		<span class="flex min-w-0 items-center gap-2">
			<span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-light text-brand-deep"><Icon name="info" size={13} /></span>
			<span class="min-w-0">À quoi sert cette page ?</span>
		</span>
		<Icon name="chevronDown" size={15} class="shrink-0 text-mist" />
	</summary>
	<div class="mt-4 border-t border-line pt-4">
		<h2 class="text-base font-black text-ink">Tes aliments de référence</h2>
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
	</div>
</details>

{#if refMsg}
	<p
		class="m-in-crm mt-3 rounded-xl px-3 py-2 text-xs font-semibold {refMsgOk ? 'bg-brand-light text-brand' : 'bg-red-50 text-red-600'}"
		style="--m-i: 2"
		role="status">{refMsg}</p
	>
{/if}

<!-- ═══ Deux colonnes : formulaire (gauche) + liste (droite) ═══ -->
<div class="m-in-crm mt-4 grid items-start gap-4 lg:grid-cols-5" style="--m-i: 2">
	<!-- COLONNE GAUCHE : nouvel aliment -->
	<div class="min-w-0 lg:col-span-2">
		<section class="card-crm p-5">
			<h2 class="font-display text-[15px] font-bold text-ink">{refForm.id ? 'Modifier l’aliment' : 'Nouvel aliment'}</h2>
			<form
				class="mt-4 grid gap-3"
				onsubmit={(e) => {
					e.preventDefault();
					saveReferenceFood();
				}}
			>
				<label class="block">
					<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Nom de l'aliment</span>
					<input
						id="refName"
						type="text"
						maxlength="120"
						required
						placeholder="ex. Poulet, blanc, sans peau"
						bind:value={refForm.name}
						class="w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm font-semibold text-ink outline-none transition focus:border-brand"
					/>
				</label>
				<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
					<label class="block">
						<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">kcal / 100 g</span>
						<input
							id="refKcal"
							type="number"
							min="0"
							max="900"
							step="0.1"
							inputmode="decimal"
							required
							bind:value={refForm.kcal}
							class="w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm font-semibold tabular-nums text-ink outline-none transition focus:border-brand"
						/>
					</label>
					<label class="block">
						<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Protéines (g / 100 g)</span>
						<input
							id="refProtein"
							type="number"
							min="0"
							max="100"
							step="0.1"
							inputmode="decimal"
							required
							bind:value={refForm.proteinG}
							class="w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm font-semibold tabular-nums text-ink outline-none transition focus:border-brand"
						/>
					</label>
					<label class="block">
						<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Glucides (g / 100 g)</span>
						<input
							id="refCarbs"
							type="number"
							min="0"
							max="100"
							step="0.1"
							inputmode="decimal"
							required
							bind:value={refForm.carbsG}
							class="w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm font-semibold tabular-nums text-ink outline-none transition focus:border-brand"
						/>
					</label>
					<label class="block">
						<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Lipides (g / 100 g)</span>
						<input
							id="refFat"
							type="number"
							min="0"
							max="100"
							step="0.1"
							inputmode="decimal"
							required
							bind:value={refForm.fatG}
							class="w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm font-semibold tabular-nums text-ink outline-none transition focus:border-brand"
						/>
					</label>
					<!-- Détail nutritionnel facultatif (R5a) — même style, non requis. -->
					<label class="block">
						<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Sucres (g / 100 g) — facultatif</span>
						<input
							id="refSugars"
							type="number"
							min="0"
							max="100"
							step="0.1"
							inputmode="decimal"
							placeholder="—"
							bind:value={refForm.sugarsG}
							class="w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm font-semibold tabular-nums text-ink outline-none transition focus:border-brand"
						/>
					</label>
					<label class="block">
						<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Fibres (g / 100 g) — facultatif</span>
						<input
							id="refFiber"
							type="number"
							min="0"
							max="100"
							step="0.1"
							inputmode="decimal"
							placeholder="—"
							bind:value={refForm.fiberG}
							class="w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm font-semibold tabular-nums text-ink outline-none transition focus:border-brand"
						/>
					</label>
					<label class="block">
						<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">AGS (g / 100 g) — facultatif</span>
						<input
							id="refSatFat"
							type="number"
							min="0"
							max="100"
							step="0.1"
							inputmode="decimal"
							placeholder="—"
							bind:value={refForm.saturatedFatG}
							class="w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm font-semibold tabular-nums text-ink outline-none transition focus:border-brand"
						/>
					</label>
					<label class="block">
						<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Sel (g / 100 g) — facultatif</span>
						<input
							id="refSalt"
							type="number"
							min="0"
							max="100"
							step="0.1"
							inputmode="decimal"
							placeholder="—"
							bind:value={refForm.saltG}
							class="w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm font-semibold tabular-nums text-ink outline-none transition focus:border-brand"
						/>
					</label>
				</div>
				<label class="block">
					<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Mode de cuisson</span>
					<select
						id="refCooking"
						bind:value={refForm.cookingState}
						class="w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm font-semibold text-ink outline-none transition focus:border-brand"
					>
						<option value="">Non précisé</option>
						{#each COOKING_CHOICES as choice (choice)}
							<option value={choice}>{cookingBadge(choice)}</option>
						{/each}
					</select>
				</label>
				{#if refKcalWarning}
					<p class="rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700" role="status">
						⚠️ Les kcal saisies s'écartent de plus de 15 % de 4P + 4G + 9L. Tu peux quand même enregistrer.
					</p>
				{/if}
				<div>
					<button
						type="submit"
						disabled={refSaving}
						class="flex w-full items-center justify-center gap-2 rounded-full bg-brand px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-brand-dark active:scale-[0.99] disabled:opacity-40"
					>
						{refForm.id ? 'Enregistrer la modification' : 'Créer l’aliment'}
					</button>
					{#if refForm.id}
						<button
							type="button"
							class="mt-2 flex w-full items-center justify-center gap-2 rounded-full border-2 border-line bg-white px-4 py-2.5 text-sm font-bold text-ink transition hover:border-brand hover:text-brand"
							onclick={resetReferenceForm}>Annuler</button
						>
					{/if}
				</div>
			</form>
		</section>
	</div>

	<!-- COLONNE DROITE : mes aliments -->
	<div class="min-w-0 lg:col-span-3">
		<section class="card-crm p-5">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<h2 class="flex items-center gap-2 font-display text-[15px] font-bold text-ink">
					<span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand text-white"><Icon name="salad" size={13} /></span>
					Mes aliments
				</h2>
				<span class="rounded-full bg-soft px-2.5 py-1 text-[10.5px] font-bold text-mist">{refFoods.length}</span>
			</div>

			{#if refLoading}
				<p class="mt-4 text-xs text-mist">Chargement…</p>
			{:else if refFoods.length === 0}
				<p class="mt-4 py-6 text-center text-sm text-mist">Aucun aliment pour l’instant.</p>
			{:else}
				<ul class="mt-4 space-y-2">
					{#each refFoods as food (food._id)}
						<li class="rounded-xl border border-line bg-white p-3">
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
										class="grid h-9 w-9 place-items-center rounded-full border border-line bg-white text-ink transition hover:border-brand"
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
										<button
											type="button"
											class="rounded-full border border-line bg-white px-3 py-1.5 text-[11px] font-semibold text-mist"
											onclick={() => (refConfirmId = null)}
										>
											Annuler
										</button>
									{:else}
										<button
											type="button"
											class="grid h-9 w-9 place-items-center rounded-full border border-red-200 bg-white text-red-600 transition hover:border-red-400"
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
		</section>
	</div>
</div>
