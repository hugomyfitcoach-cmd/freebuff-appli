<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import BackToHome from "$lib/components/BackToHome.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { parisTodayISO, shiftISO } from "$lib/vision360";

  /** Encadrement objectif — même bornes que le module Convex (500–6000 ml,
    révalidées côté serveur de toute façon). */
  const HYDRATION_GOAL_MIN = 500;
  const HYDRATION_GOAL_MAX = 6000;

  let { data } = $props();

  /** Historique brut du loader : { goalMl, days, lastEntries } ou null
	    (backend sans le module — jamais bloquant). */
  type History = {
    goalMl: number;
    days: { date: string; ml: number }[];
    lastEntries: { _id: string; date: string; ml: number; createdAt: number }[];
  };
  const history = $derived(data.history as History | null);

  const todayISO = $derived(parisTodayISO());
  const fmt = (n: number) => n.toLocaleString("fr-FR");

  /* ————— Totaux par jour ————— */
  const byDate = $derived.by(() => {
    const m = new Map<string, number>();
    for (const d of history?.days ?? []) m.set(d.date, d.ml);
    return m;
  });
  /** Fenêtre du graphique : 7 jours GLISSANTS (aujourd'hui inclus) — fidèle
	    à la maquette Claude. Aucune moyenne affichée ici : la règle « 7 jours
	    terminés » de l'app concerne pas/poids ; l'hydratation affiche juste le
	    jour courant et la forme de la semaine. */
  const chartDays = $derived.by(() => {
    const out: { date: string; label: string; total: number | null }[] = [];
    for (let i = 6; i >= 0; i--) {
      const key = shiftISO(todayISO, -i);
      out.push({
        date: key,
        label:
          i === 0
            ? "A"
            : new Date(key + "T12:00:00").toLocaleDateString("fr-FR", {
                weekday: "narrow",
              }),
        total: byDate.get(key) ?? null,
      });
    }
    return out;
  });

  /* ————— Aujourd'hui ————— */
  const todayTotal = $derived(byDate.get(todayISO) ?? null);
  const goal = $derived(history?.goalMl ?? null);
  const pct = $derived(
    todayTotal !== null && goal
      ? Math.min(Math.round((todayTotal / goal) * 100), 999)
      : 0,
  );
  const ringPct = $derived(
    todayTotal !== null && goal ? Math.min(todayTotal / goal, 1) : 0,
  );
  /** r = 48 → circonférence 2π·48 ≈ 301.6 (maquette). */
  const C = 301.6;
  const reached = $derived(
    todayTotal !== null && goal !== null && todayTotal >= goal,
  );

  /* ————— Saisie ————— */
  const QUICK = [150, 250, 500];
  let custom = $state("");
  let lastAdded = $state<{ ml: number } | null>(null);

  async function addWater(ml: number) {
    if (saving || ml < 1 || ml > 5000) return;
    saving = true;
    error = "";
    try {
      const res = await fetch("/api/hydration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: todayISO, ml }),
      });
      const body = await res.json();
      if (!res.ok || body.error)
        throw new Error(body.error ?? "Ajout impossible.");
      lastAdded = { ml };
      await invalidateAll();
    } catch (e) {
      error = e instanceof Error ? e.message : "Ajout impossible.";
    } finally {
      saving = false;
    }
  }

  async function undoLast() {
    const last = history?.lastEntries.find((e) => e.date === todayISO);
    if (!last || saving) return;
    saving = true;
    error = "";
    try {
      const res = await fetch("/api/hydration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId: last._id }),
      });
      const body = await res.json();
      if (!res.ok || body.error)
        throw new Error(body.error ?? "Annulation impossible.");
      await invalidateAll();
    } catch (e) {
      error = e instanceof Error ? e.message : "Annulation impossible.";
    } finally {
      saving = false;
    }
  }

  /* ————— Objectif ————— */
  let goalEdit = $state(false);
  let goalDraft = $state("");
  function openGoalEdit() {
    goalDraft = goal !== null ? String(goal) : "2500";
    goalEdit = !goalEdit;
  }
  const goalOk = $derived.by(() => {
    const n = Number(goalDraft);
    return (
      Number.isInteger(n) && n >= HYDRATION_GOAL_MIN && n <= HYDRATION_GOAL_MAX
    );
  });
  async function saveGoal() {
    const n = Number(goalDraft);
    if (!goalOk || saving) return;
    saving = true;
    error = "";
    try {
      const res = await fetch("/api/hydration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalMl: n }),
      });
      const body = await res.json();
      if (!res.ok || body.error)
        throw new Error(body.error ?? "Enregistrement impossible.");
      goalEdit = false;
      await invalidateAll();
    } catch (e) {
      error = e instanceof Error ? e.message : "Enregistrement impossible.";
    } finally {
      saving = false;
    }
  }

  /* ————— Historique déroulant (une ligne par jour, détail par prise) ————— */
  let openDay = $state<string | null>(null);
  function toggleDay(date: string) {
    openDay = openDay === date ? null : date;
  }
  const entriesByDate = $derived.by(() => {
    const m = new Map<
      string,
      { _id: string; ml: number; createdAt: number }[]
    >();
    for (const e of history?.lastEntries ?? []) {
      const arr = m.get(e.date) ?? [];
      arr.push({ _id: e._id, ml: e.ml, createdAt: e.createdAt });
      m.set(e.date, arr);
    }
    return m;
  });

  function dayLabel(date: string): string {
    if (date === todayISO)
      return `Aujourd'hui · ${new Date(date + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`;
    const d = new Date(date + "T12:00:00");
    return d
      .toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "short",
      })
      .replace(/^./, (c) => c.toUpperCase());
  }
  function timeLabel(ts: number): string {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  async function deleteEntry(id: string) {
    if (saving) return;
    saving = true;
    error = "";
    try {
      const res = await fetch("/api/hydration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId: id }),
      });
      const body = await res.json();
      if (!res.ok || body.error)
        throw new Error(body.error ?? "Suppression impossible.");
      await invalidateAll();
    } catch (e) {
      error = e instanceof Error ? e.message : "Suppression impossible.";
    } finally {
      saving = false;
    }
  }

  /* ————— Barres du graphique —————
	    Hauteur : proportionnelle au total du jour vs objectif, plafonnée —
	    même visualisation que la maquette (max 120px, ligne d'objectif à 80 %). */
  const H = 120;
  const goalLineBottom = $derived.by(() => {
    const maxTotal =
      Math.max(goal ?? 0, ...chartDays.map((d) => d.total ?? 0)) || 1;
    return Math.min(Math.round(((goal ?? maxTotal) / maxTotal) * H), H);
  });

  let saving = $state(false);
  let error = $state("");
</script>

<svelte:head><title>Mon hydratation — G-Flux</title></svelte:head>
<div class="mx-auto w-full max-w-xl pb-28">
  <BackToHome label="Mon hydratation" />

  <div class="flex items-center gap-3">
    <div
      class="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-light"
    >
      <Icon name="droplet" size={22} class="text-brand" />
    </div>
    <div class="min-w-0 flex-1">
      <h1 class="font-display text-2xl font-bold tracking-tight text-ink">
        Mon hydratation
      </h1>
      <p class="text-sm text-mist">
        Ajoute ce que tu bois, suis ton objectif du jour et ta régularité sur 7
        jours.
      </p>
    </div>
  </div>

  {#if history === null}
    <!-- Backend sans le module (déploiement en cours) : non bloquant. -->
    <section
      class="mt-5 rounded-3xl border border-line bg-card p-6 text-center shadow-sm"
    >
      <span
        class="mx-auto grid h-12 w-12 place-items-center rounded-full bg-soft"
        ><Icon name="droplet" size={22} class="text-mist" /></span
      >
      <p class="mt-2 font-display text-lg font-semibold text-ink">
        Suivi en route…
      </p>
      <p class="mt-1 text-sm text-mist">
        Le suivi de l'hydratation arrive sur ton espace — réessaie dans quelques
        minutes.
      </p>
    </section>
  {:else}
    <!-- Aujourd'hui : anneau de progression + total + objectif éditable -->
    <section class="mt-4 rounded-3xl border border-line bg-card p-4 shadow-sm">
      <div class="flex items-center justify-between gap-2">
        <p class="flex items-center gap-1.5 text-sm font-bold text-ink">
          <Icon name="droplet" size={17} class="shrink-0 text-brand" />
          Aujourd'hui
        </p>
        <button
          type="button"
          onclick={openGoalEdit}
          aria-expanded={goalEdit}
          class="tap flex items-center gap-1.5 rounded-full border-2 border-line px-3 py-1.5 text-xs font-bold text-mist transition hover:border-brand/50 hover:text-ink"
        >
          <Icon name="pencil" size={13} class="shrink-0" />
          Objectif
        </button>
      </div>

      <div class="mt-3.5 flex items-center gap-4">
        <!-- Anneau (r=48, stroke 10) — fidèle à la maquette, proportions réduites -->
        <div class="relative h-[100px] w-[100px] shrink-0">
          <svg
            width="100"
            height="100"
            viewBox="0 0 112 112"
            aria-hidden="true"
          >
            <circle
              cx="56"
              cy="56"
              r="48"
              fill="none"
              class="stroke-line"
              stroke-width="10"
            />
            <circle
              cx="56"
              cy="56"
              r="48"
              fill="none"
              class="stroke-brand transition-all duration-500"
              stroke-width="10"
              stroke-linecap="round"
              stroke-dasharray={`${(ringPct * C).toFixed(1)} ${C}`}
              transform="rotate(-90 56 56)"
            />
          </svg>
          <span
            class="absolute inset-0 grid place-items-center font-display text-2xl font-black tracking-tight text-ink"
            >{pct} %</span
          >
        </div>
        <div class="min-w-0 flex-1">
          <p
            class="font-display text-4xl font-black leading-none tracking-tight text-ink tabular-nums"
          >
            {#key todayTotal}{todayTotal !== null ? fmt(todayTotal) : "—"}{/key}
            <span class="text-base font-bold text-mist">ml</span>
          </p>
          <p class="mt-1.5 text-sm text-mist">
            sur {goal !== null ? fmt(goal) : "—"} ml
          </p>
          <span
            class="mt-2.5 inline-block rounded-full px-3 py-1 text-xs font-black {reached
              ? 'bg-brand text-white'
              : todayTotal === null
                ? 'bg-soft text-mist'
                : 'bg-brand-light text-brand-deep'}"
          >
            {#if reached}Objectif atteint{:else if todayTotal === null}Commence
              ta journée{:else}Il reste {fmt(
                Math.max((goal ?? 0) - todayTotal, 0),
              )} ml{/if}
          </span>
        </div>
      </div>

      {#if error}<p class="mt-2 text-xs font-semibold text-danger">
          {error}
        </p>{/if}

      {#if goalEdit}
        <div class="mt-4 border-t border-line pt-4">
          <p class="text-[11px] font-black uppercase tracking-widest text-mist">
            Objectif quotidien
          </p>
          <div class="mt-2.5 flex gap-2.5">
            <label
              class="flex h-[48px] min-w-0 flex-1 items-center gap-2 rounded-2xl border-2 border-line bg-soft px-3.5"
            >
              <span class="sr-only">Objectif quotidien en millilitres</span>
              <input
                type="text"
                inputmode="numeric"
                bind:value={goalDraft}
                placeholder="Ex. 2500"
                class="w-full min-w-0 border-0 bg-transparent font-display text-xl font-black tracking-tight text-ink outline-none tabular-nums"
              />
              <span class="shrink-0 text-sm font-bold text-mist">ml</span>
            </label>
            <button
              type="button"
              onclick={saveGoal}
              disabled={!goalOk || saving}
              class="flex h-[48px] shrink-0 items-center justify-center gap-1.5 rounded-2xl bg-ink px-4 text-sm font-bold text-white transition hover:bg-brand disabled:opacity-50"
            >
              <Icon name="check" size={15} class="shrink-0" />
              Enregistrer
            </button>
          </div>
          <p class="mt-2 text-xs text-mist">
            Entre une valeur entre 500 et 6 000 ml.
          </p>
        </div>
      {/if}
    </section>

    <!-- Ajouter de l'eau : raccourcis + quantité libre + annulation -->
    <section class="mt-3.5 rounded-3xl border border-line bg-card p-4 shadow-sm">
      <p class="flex items-center gap-1.5 text-sm font-bold text-ink">
        <Icon name="plus" size={17} class="shrink-0 text-brand" />
        Ajouter de l'eau
      </p>
      <div class="mt-3 grid grid-cols-3 gap-2.5">
        {#each QUICK as q (q)}
          <button
            type="button"
            onclick={() => addWater(q)}
            disabled={saving}
            class="tap flex h-[56px] flex-col items-center justify-center gap-0.5 rounded-2xl bg-brand-light text-brand-deep transition hover:bg-brand-light/80 active:scale-[0.97] disabled:opacity-50"
          >
            <span
              class="font-display text-[22px] font-black leading-none tracking-tight"
              >+{q}</span
            >
            <span class="text-xs font-bold text-mist">ml</span>
          </button>
        {/each}
      </div>
      <div class="mt-3 flex gap-2.5">
        <label
          class="flex h-[48px] min-w-0 flex-1 items-center gap-2 rounded-2xl border-2 border-line bg-soft px-3.5"
        >
          <span class="sr-only">Quantité personnalisée en millilitres</span>
          <input
            type="text"
            inputmode="numeric"
            bind:value={custom}
            placeholder="Ex. 330"
            class="w-full min-w-0 border-0 bg-transparent font-display text-xl font-black tracking-tight text-ink outline-none tabular-nums"
          />
          <span class="shrink-0 text-sm font-bold text-mist">ml</span>
        </label>
        <button
          type="button"
          onclick={() => addWater(Number(custom) || 0)}
          disabled={saving || !(Number(custom) >= 1)}
          class="flex h-[48px] shrink-0 items-center justify-center gap-1.5 rounded-2xl bg-ink px-4 text-sm font-bold text-white transition hover:bg-brand disabled:opacity-50"
        >
          <Icon name="plus" size={15} class="shrink-0" />
          Ajouter
        </button>
      </div>
      {#if history.lastEntries.some((e) => e.date === todayISO)}
        <button
          type="button"
          onclick={undoLast}
          disabled={saving}
          class="tap mt-2.5 flex items-center gap-1.5 px-1 py-1 text-[13px] font-bold text-mist transition hover:text-ink disabled:opacity-50"
        >
          <Icon name="undo" size={14} class="shrink-0" />
          Annuler le dernier ajout&nbsp;
          <span class="text-ink"
            >+{fmt(history.lastEntries.find((e) => e.date === todayISO)!.ml)} ml</span
          >
        </button>
      {/if}
    </section>

    <!-- 7 derniers jours (glissants, aujourd'hui inclus) — ligne d'objectif -->
    <section
      class="mt-3.5 rounded-3xl border border-line bg-card p-4 pb-2 shadow-sm"
    >
      <div class="flex items-baseline justify-between gap-2">
        <h2 class="text-[11px] font-black uppercase tracking-widest text-mist">
          7 derniers jours
        </h2>
        <span class="text-xs font-bold text-mist"
          >Objectif : {goal !== null ? fmt(goal) : "—"} ml / jour</span
        >
      </div>
      <div class="relative mt-3">
        <!-- Ligne d'objectif pointillée + étiquette (position 80 % de la zone, maquette) -->
        {#if goal}
          <div
            class="pointer-events-none absolute left-0 right-0 border-t-2 border-dashed border-brand/30"
            style={`bottom:${goalLineBottom + 24}px`}
            aria-hidden="true"
          ></div>
          <span
            class="pointer-events-none absolute right-0 rounded-full bg-brand-light px-2.5 py-0.5 text-[11px] font-black text-brand-deep transition-all"
            style={`bottom:${goalLineBottom + 14}px`}>{fmt(goal)}</span
          >
        {/if}
        <div class="grid grid-cols-7 gap-1">
          {#each chartDays as d (d.date)}
            {@const h =
              d.total !== null && goal
                ? Math.min(Math.round((d.total / goal) * (H * 0.8)), H)
                : 4}
            <div class="flex flex-col items-center justify-end gap-1.5">
              <div
                class="flex h-[132px] w-full flex-col items-center justify-end"
              >
                <div
                  class={`w-[26px] rounded-full transition-all duration-400 ${d.total !== null && goal !== null && d.total >= goal ? "bg-brand" : d.total !== null ? "bg-ink" : "bg-line"}`}
                  style={`height:${d.total !== null ? Math.max(h, 8) : 8}px`}
                  title={d.total !== null
                    ? `${fmt(d.total)} ml`
                    : "Aucune donnée"}
                ></div>
              </div>
              <span
                class={`text-xs font-bold ${d.date === todayISO ? "text-brand-deep" : "text-ink"}`}
                >{d.label}</span
              >
            </div>
          {/each}
        </div>
      </div>
      <div
        class="mt-1 flex items-center gap-4 border-t border-line py-2.5 text-xs text-mist"
      >
        <span class="flex items-center gap-1.5"
          ><span class="h-2.5 w-2.5 rounded-full bg-brand"></span> Objectif atteint</span
        >
        <span class="flex items-center gap-1.5"
          ><span class="h-2.5 w-2.5 rounded-full bg-ink"></span> Sous l'objectif</span
        >
      </div>
    </section>

    <!-- Historique par jour (du plus récent au plus ancien), détail par prise -->
    <section
      class="mt-3.5 rounded-3xl border border-line bg-card p-4 pb-2.5 shadow-sm"
    >
      <h2 class="text-[11px] font-black uppercase tracking-widest text-mist">
        Historique par jour
      </h2>
      <div class="mt-2">
        {#if history.days.length === 0}
          <p class="px-1 py-6 text-center text-sm text-mist">
            Aucune prise enregistrée pour l'instant — commence avec « +250 ml »
            ci-dessus.
          </p>
        {/if}
        {#each history.days as d (d.date)}
          {@const p = goal ? Math.min(Math.round((d.ml / goal) * 100), 999) : 0}
          {@const open = openDay === d.date}
          <button
            type="button"
            onclick={() => toggleDay(d.date)}
            aria-expanded={open}
            class="block w-full border-t border-line px-0 py-3 text-left last:border-b-0"
          >
            <span class="flex items-center justify-between gap-2.5">
              <span class="min-w-0">
                <span class="block truncate text-[15px] font-black text-ink"
                  >{dayLabel(d.date)}</span
                >
                <span class="mt-0.5 block text-[13px] text-mist"
                  >{entriesByDate.get(d.date)?.length ?? 0}
                  {(entriesByDate.get(d.date)?.length ?? 0) > 1
                    ? "prises"
                    : "prise"}</span
                >
              </span>
              <span class="flex shrink-0 items-center gap-2">
                <span class="text-right">
                  <span
                    class={`block text-[15.5px] font-black ${goal !== null && d.ml >= goal ? "text-brand-deep" : "text-ink"}`}
                    >{fmt(d.ml)} ml</span
                  >
                  <span class="mt-0.5 block text-xs font-bold text-mist"
                    >{p} %</span
                  >
                </span>
                <span
                  class="text-mist transition-transform duration-200"
                  style={`transform:rotate(${open ? 90 : 0}deg)`}
                  ><Icon name="chevronRight" size={15} /></span
                >
              </span>
            </span>
            <span
              class="mt-2.5 block h-1.5 overflow-hidden rounded-full bg-line"
              ><span
                class="block h-1.5 rounded-full bg-brand transition-all duration-400"
                style={`width:${Math.min(p, 100)}%`}
              ></span></span
            >
          </button>
          {#if open}
            <div class="mb-2 ml-0.5 border-l-2 border-brand-light pl-3.5">
              {#each [...(entriesByDate.get(d.date) ?? [])].reverse() as e (e._id)}
                <div class="flex items-center justify-between gap-2 py-1.5">
                  <span class="text-[13.5px] text-mist"
                    >{timeLabel(e.createdAt)}</span
                  >
                  <span class="flex items-center gap-2">
                    <span class="text-sm font-bold text-ink"
                      >+{fmt(e.ml)} ml</span
                    >
                    <button
                      type="button"
                      onclick={() => deleteEntry(e._id)}
                      disabled={saving}
                      aria-label={`Supprimer la prise de ${timeLabel(e.createdAt)}`}
                      class="tap grid h-7 w-7 place-items-center rounded-full text-mist transition hover:bg-soft hover:text-danger disabled:opacity-50"
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </span>
                </div>
              {/each}
            </div>
          {/if}
        {/each}
      </div>
    </section>
  {/if}
</div>
