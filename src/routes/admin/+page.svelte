<script lang="ts">
	import BilanCard from '../../lib/components/BilanCard.svelte';

	let { data, form } = $props();

	const clients = $derived(data.clients ?? []);
	const selectedId = $derived(data.selectedId ?? null);
	const checkins = $derived(data.checkins ?? []);
	const selected = $derived(clients.find((c: { user: { _id: string } }) => c.user._id === selectedId) ?? null);

	const totalBilans = $derived(clients.reduce((s: number, c: { count: number }) => s + c.count, 0));
	const totalWaiting = $derived(clients.reduce((s: number, c: { waiting: number }) => s + c.waiting, 0));

	let query = $state('');

	const filtered = $derived(
		query.trim()
			? clients.filter((c: { user: { prenom: string; email: string } }) =>
					`${c.user.prenom} ${c.user.email}`.toLowerCase().includes(query.trim().toLowerCase())
				)
			: clients
	);

	const alert = $derived(form && 'action' in form ? (form as { action: string; error?: string; ok?: string }) : null);
	const initial = (name: string) => name.trim().charAt(0).toUpperCase() || '?';
</script>

<!-- Statistiques -->
<section class="grid gap-3 sm:grid-cols-3">
	<div class="rounded-2xl border border-line bg-card p-4">
		<div class="font-display text-3xl font-semibold text-ink">{clients.length}</div>
		<div class="text-xs font-semibold uppercase tracking-wide text-mist">Client·e·s</div>
	</div>
	<div class="rounded-2xl border border-line bg-card p-4">
		<div class="font-display text-3xl font-semibold text-ink">{totalBilans}</div>
		<div class="text-xs font-semibold uppercase tracking-wide text-mist">Bilans reçus</div>
	</div>
	<div class="rounded-2xl border border-line bg-card p-4">
		<div class="font-display text-3xl font-semibold text-warn">{totalWaiting}</div>
		<div class="text-xs font-semibold uppercase tracking-wide text-mist">Retours à envoyer</div>
	</div>
</section>

{#if alert}
	<div
		class="mt-4 flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm
			{alert.error ? 'border-danger/40 bg-danger-light text-danger' : 'border-brand/40 bg-brand-light text-ink'}"
	>
		<span>{alert.error ?? alert.ok}</span>
		<span class="text-mist">✳️</span>
	</div>
{/if}

<div class="mt-6 grid items-start gap-6 lg:grid-cols-[320px_1fr]">
	<!-- Colonne gauche : comptes clients -->
	<aside class="space-y-4">
		<details class="group rounded-2xl border border-line bg-card shadow-sm" open={false}>
			<summary class="cursor-pointer list-none px-5 py-4 font-display font-semibold text-ink transition hover:text-brand">
				<span class="group-open:hidden">＋ Créer un compte client</span>
				<span class="hidden group-open:inline">－ Masquer</span>
			</summary>
			<form method="POST" action="?/createClient" class="border-t border-line px-5 py-4">
				<label class="mb-1 block text-xs font-bold uppercase tracking-wide text-mist" for="nc-prenom">Prénom</label>
				<input id="nc-prenom" name="prenom" required placeholder="Ex. Julie" class="mb-3 w-full rounded-xl border-2 border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand" />
				<label class="mb-1 block text-xs font-bold uppercase tracking-wide text-mist" for="nc-email">Email (identifiant de connexion)</label>
				<input id="nc-email" name="email" type="email" required placeholder="julie@exemple.fr" class="mb-3 w-full rounded-xl border-2 border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand" />
				<label class="mb-1 block text-xs font-bold uppercase tracking-wide text-mist" for="nc-pass">Mot de passe (8 caractères min.)</label>
				<input id="nc-pass" name="password" type="text" required minlength="8" placeholder="Choisi avec la cliente…" class="mb-4 w-full rounded-xl border-2 border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand" />
				<button type="submit" class="w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark">
					Créer le compte
				</button>
			</form>
		</details>

		<div class="rounded-2xl border border-line bg-card p-3 shadow-sm">
			<input
				type="search"
				bind:value={query}
				placeholder="Rechercher (nom, email)…"
				class="w-full rounded-xl border-2 border-line bg-white px-3 py-2 text-sm outline-none transition focus:border-brand"
			/>
			<nav class="mt-3 max-h-[62vh] space-y-1.5 overflow-y-auto pr-1" aria-label="Clients">
				{#if filtered.length === 0}
					<p class="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-mist">
						Aucun compte client{query.trim() ? ' trouvé' : ' pour l’instant'}.<br />Crée le premier avec le bouton ci-dessus ☝️
					</p>
				{:else}
					{#each filtered as client (client.user._id)}
						<a
							href={`/admin?client=${client.user._id}`}
							class="block w-full rounded-xl border-2 px-3 py-2.5 transition
								{selectedId === client.user._id ? 'border-brand bg-brand-light' : 'border-transparent bg-white hover:border-line'}"
						>
							<div class="flex items-center justify-between gap-2">
								<span class="truncate text-sm font-semibold text-ink">{client.user.prenom}</span>
								{#if client.waiting > 0}
									<span class="shrink-0 rounded-full bg-warn px-2 py-0.5 text-[10px] font-bold text-white">{client.waiting}</span>
								{/if}
							</div>
							<div class="mt-0.5 truncate text-[11px] text-mist">{client.user.email}</div>
							<div class="mt-0.5 flex justify-between gap-2 text-[11px] text-mist">
								<span>{client.count} bilan{client.count > 1 ? 's' : ''}</span>
								<span>{client.latest?.weekLabel ?? 'aucun bilan'}</span>
							</div>
						</a>
					{/each}
				{/if}
			</nav>
		</div>
	</aside>

	<!-- Détail client -->
	<section>
		{#if selected}
			<div class="rounded-2xl border border-line bg-card px-5 py-4 shadow-sm">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div class="flex items-center gap-3">
						<div class="flex h-12 w-12 items-center justify-center rounded-full bg-brand font-display text-xl font-semibold text-white">
							{initial(selected.user.prenom)}
						</div>
						<div>
							<h2 class="font-display text-xl font-semibold text-ink">{selected.user.prenom}</h2>
							<p class="text-xs text-mist">
								{selected.user.email} · {selected.count} bilan{selected.count > 1 ? 's' : ''} · {selected.waiting} retour{selected.waiting > 1 ? 's' : ''} à envoyer
								{selected.latest ? ` · dernier : ${selected.latest.weekLabel}` : ''}
							</p>
						</div>
					</div>

					<div class="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
						<details class="group relative">
							<summary class="cursor-pointer list-none rounded-lg border-2 border-line px-3 py-1.5 text-sm text-ink transition hover:border-brand hover:text-brand">Renommer</summary>
							<form method="POST" action="?/rename" class="absolute right-0 top-9 z-10 w-60 rounded-xl border border-line bg-white p-3 shadow-lg">
								<input type="hidden" name="userId" value={selected.user._id} />
								<input name="prenom" required value={selected.user.prenom} class="mb-2 w-full rounded-lg border-2 border-line px-2 py-1.5 text-sm outline-none focus:border-brand" />
								<button type="submit" class="w-full rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark">Enregistrer</button>
							</form>
						</details>

						<details class="group relative">
							<summary class="cursor-pointer list-none rounded-lg border-2 border-line px-3 py-1.5 text-sm text-ink transition hover:border-brand hover:text-brand">Email</summary>
							<form method="POST" action="?/updateEmail" class="absolute right-0 top-9 z-10 w-72 rounded-xl border border-line bg-white p-3 shadow-lg">
								<input type="hidden" name="userId" value={selected.user._id} />
								<input name="email" type="email" required value={selected.user.email} class="mb-2 w-full rounded-lg border-2 border-line px-2 py-1.5 text-sm outline-none focus:border-brand" />
								<button type="submit" class="w-full rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark">Changer l'email</button>
							</form>
						</details>

						<details class="group relative">
							<summary class="cursor-pointer list-none rounded-lg border-2 border-line px-3 py-1.5 text-sm text-ink transition hover:border-warn hover:text-warn">Mot de passe</summary>
							<form method="POST" action="?/resetPassword" class="absolute right-0 top-9 z-10 w-72 rounded-xl border border-line bg-white p-3 shadow-lg">
								<input type="hidden" name="userId" value={selected.user._id} />
								<input name="newPassword" type="text" required minlength="8" placeholder="Nouveau mot de passe (8+ car.)" class="mb-2 w-full rounded-lg border-2 border-line px-2 py-1.5 text-sm outline-none focus:border-warn" />
								<button type="submit" class="w-full rounded-lg bg-warn px-3 py-1.5 text-sm font-semibold text-white hover:brightness-95">Réinitialiser</button>
							</form>
						</details>

						<details class="group relative">
							<summary class="cursor-pointer list-none rounded-lg border-2 border-line px-3 py-1.5 text-sm text-danger transition hover:border-danger hover:bg-danger-light">Supprimer</summary>
							<form method="POST" action="?/removeClient" class="absolute right-0 top-9 z-10 w-80 rounded-xl border border-danger/40 bg-white p-3 shadow-lg">
								<input type="hidden" name="userId" value={selected.user._id} />
								<p class="text-xs leading-relaxed text-ink">
									Supprimer <strong>{selected.user.prenom}</strong> et ses {selected.count} bilan{selected.count > 1 ? 's' : ''} ? Action irréversible.
								</p>
								<label class="mt-2 flex items-start gap-2 text-xs text-ink">
									<input type="checkbox" name="confirm" required class="mt-0.5" />
									<span>Je confirme la suppression définitive.</span>
								</label>
								<button type="submit" class="mt-2 w-full rounded-lg bg-danger px-3 py-1.5 text-sm font-semibold text-white hover:brightness-95">Supprimer le compte</button>
							</form>
						</details>
					</div>
				</div>
			</div>

			<!-- Objectifs journaliers (Journal alimentaire) -->
			<div class="mt-4 rounded-2xl border border-line bg-card px-5 py-4 shadow-sm">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<h3 class="font-display text-base font-semibold text-ink">🎯 Objectifs journaliers</h3>
					<span class="text-[11px] text-mist">Objectifs calories & macros affichés dans le Journal de {selected.user.prenom}</span>
				</div>
				{#key selected.user._id}
					<form method="POST" action="?/setGoals" class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
						<input type="hidden" name="userId" value={selected.user._id} />
						<label class="block">
							<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Calories / jour</span>
							<input type="number" name="kcal" required min="800" max="6000" step="50" value={data.goals?.kcal ?? 2000} class="w-full rounded-lg border-2 border-line px-2 py-2 text-sm outline-none focus:border-brand" />
						</label>
						<label class="block">
							<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Glucides (g)</span>
							<input type="number" name="carbs" required min="0" max="1000" step="5" value={data.goals?.carbs ?? 250} class="w-full rounded-lg border-2 border-line px-2 py-2 text-sm outline-none focus:border-brand" />
						</label>
						<label class="block">
							<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Protéines (g)</span>
							<input type="number" name="protein" required min="0" max="400" step="5" value={data.goals?.protein ?? 90} class="w-full rounded-lg border-2 border-line px-2 py-2 text-sm outline-none focus:border-brand" />
						</label>
						<label class="block">
							<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Lipides (g)</span>
							<input type="number" name="fat" required min="0" max="300" step="5" value={data.goals?.fat ?? 65} class="w-full rounded-lg border-2 border-line px-2 py-2 text-sm outline-none focus:border-brand" />
						</label>
						<button type="submit" class="col-span-2 mt-2 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark sm:col-span-4">Enregistrer les objectifs</button>
					</form>
				{/key}
			</div>

			<div class="mt-4 space-y-4">
				{#if checkins.length === 0}
					<div class="rounded-2xl border border-dashed border-line bg-card px-6 py-12 text-center">
						<p class="text-2xl">🗓️</p>
						<p class="mt-2 text-sm text-ink">Aucun bilan pour {selected.user.prenom} pour l'instant.</p>
						<p class="mt-1 text-xs text-mist">Transmets son identifiant de connexion (email + mot de passe) pour qu'elle commence son suivi.</p>
					</div>
				{:else}
					{#each checkins as checkin (checkin._id)}
						<BilanCard checkin={checkin} clientName={selected.user.prenom} clientId={selected.user._id} />
					{/each}
				{/if}
			</div>
		{:else}
			<div class="rounded-2xl border border-dashed border-line bg-card px-6 py-14 text-center">
				<p class="text-3xl">👋</p>
				<p class="mt-3 text-sm text-ink">Crée un compte client pour démarrer le suivi.</p>
			</div>
		{/if}
	</section>
</div>
