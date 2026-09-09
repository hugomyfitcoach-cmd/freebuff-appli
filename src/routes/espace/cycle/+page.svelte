<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import { currentLocalDay } from '$lib/currentDay.svelte';
	import BackToHome from '$lib/components/BackToHome.svelte';
	import CycleForm from '$lib/components/CycleForm.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import {
		cycleState,
		PHASE_CONTENT,
		CYCLE_NO_ESTIMATE_MSGS,
		type CycleConfig,
	} from '$lib/cycle';

	/* ═══════════ « MON CYCLE » — réutilisation du visuel ORIGINAL du fichier
	   HTML fourni (Outils & calibrage → Cycle) : courbe SVG 480×130 avec
	   dégradé œstrogène → progestérone, tracé animé (stroke-dashoffset) et
	   marqueur pulsé positionné via getPointAtLength à l'emplacement exact du
	   jour actuel. Seul le branding est adapté (vert/ambre G-FLUX, anthracite,
	   préférences de mouvement respectées). ═══════════ */

	let { data } = $props();

	let cfg = $state<CycleConfig | null>((data.cycle ?? null) as CycleConfig | null);
	/* Jour actuel du cycle calculé sur la date locale courante (réactive) :
	   à minuit / à la reprise, le marqueur « Aujourd'hui » et la phase avancent. */
	const cycle = $derived(cycleState(cfg, new Date(currentLocalDay() + 'T12:00:00')));
	let editing = $state(false);

	const GREEN = '#1db954';
	const AMBER = '#ff9500';

	/* ————— Courbe (tracé original, inchangé) ————— */
	const CURVE_D = 'M8,82 C 75,26 130,18 172,48 C 198,68 210,82 232,52 C 258,14 292,22 328,44 C 372,70 408,44 472,82';
	let curvePath: SVGPathElement | undefined = $state();
	let markerX = $state(0);
	let markerY = $state(0);
	let markerLabelY = $state(0);
	let markerReady = $state(false);
	let animTimers: ReturnType<typeof setTimeout>[] = [];

	function positionMarker(fraction: number) {
		if (!curvePath) return;
		const pl = curvePath.getTotalLength();
		const point = curvePath.getPointAtLength(fraction * pl);
		markerX = point.x;
		markerY = point.y;
		markerLabelY = point.y > 30 ? point.y - 14 : point.y + 24;
		markerReady = false;
		void curvePath.getBoundingClientRect();
		requestAnimationFrame(() => {
			markerReady = true;
		});
	}

	function runCurveAnim() {
		if (cycle.kind !== 'tracked' || !curvePath) return;
		const reduced =
			typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const fraction = (cycle.cycleDay - 1) / cycle.cycleLength;
		const pl = curvePath.getTotalLength();
		curvePath.style.strokeDasharray = String(pl);
		if (reduced) {
			curvePath.style.transition = 'none';
			curvePath.style.strokeDashoffset = '0';
			positionMarker(fraction);
			return;
		}
		// 1) Le tracé se dessine progressivement…
		curvePath.style.transition = 'none';
		curvePath.style.strokeDashoffset = String(pl);
		void curvePath.getBoundingClientRect();
		curvePath.style.transition = 'stroke-dashoffset 1.3s cubic-bezier(.65,0,.35,1)';
		requestAnimationFrame(() => {
			if (curvePath) curvePath.style.strokeDashoffset = '0';
		});
		// 2) …puis le marqueur « Aujourd'hui » apparaît et pulse.
		const t = setTimeout(() => positionMarker(fraction), 950);
		animTimers.push(t);
	}

	$effect(() => {
		// Rejoue l'animation à chaque changement de configuration (ou 1er rendu).
		if (cycle.kind === 'tracked') runCurveAnim();
	});

	onMount(() => {
		return () => {
			for (const t of animTimers) clearTimeout(t);
			animTimers = [];
		};
	});

	/* ————— Modification ————— */
	async function savedCycle(next: CycleConfig) {
		cfg = next;
		editing = false;
		await invalidateAll();
	}

	const switchPct = $derived(
		cycle.kind === 'tracked' ? (((cycle.ovulationDay - 1) / cycle.cycleLength) * 100).toFixed(1) + '%' : '50%'
	);
	const content = $derived(cycle.kind === 'tracked' ? PHASE_CONTENT[cycle.key] : null);

	function dimLabel(s: string) {
		return s === 'up' ? 'EN HAUSSE' : s === 'watch' ? 'À SURVEILLER' : 'NORMAL';
	}
	function dimClass(s: string) {
		return s === 'up'
			? 'bg-orange-l text-warn'
			: s === 'watch'
				? 'bg-brand-light text-brand-dark'
				: 'bg-line/50 text-mist';
	}
</script>

<svelte:head>
	<title>Mon cycle — G-Flux</title>
	<!-- Animation du marqueur « Aujourd'hui » — CSS global (l'animation est référencée par attribut style inline). -->
	<style>
		@keyframes cyclePulse {
			0% {
				r: 5px;
				opacity: 0.55;
			}
			100% {
				r: 16px;
				opacity: 0;
			}
		}
	</style>
</svelte:head>

<div class="mx-auto w-full max-w-xl px-4 pb-28 pt-4 sm:px-6">
	<BackToHome label="Mon cycle" />

	<div class="flex items-center gap-3">
		<div class="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-light">
			<Icon name="flower2" size={22} class="text-brand" />
		</div>
		<div>
			<h1 class="font-display text-2xl font-semibold tracking-tight text-ink">Mon cycle</h1>
			<p class="text-sm text-mist">Où tu en es, selon ta configuration.</p>
		</div>
	</div>

	{#if editing}
		<!-- Questionnaire initial (réutilisé) — UNIQUEMENT via « Modifier mes informations » -->
		<section class="mt-5 rounded-3xl border border-line bg-card p-4 shadow-sm">
			<p class="mb-3 text-sm font-bold text-ink">Modifier mes informations</p>
			<CycleForm config={cfg} onSaved={savedCycle} onCancel={() => (editing = false)} />
		</section>
	{:else if cycle.kind === 'empty'}
		<section class="mt-5 rounded-3xl border border-line bg-card p-6 text-center shadow-sm">
			<div class="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-brand-light">
				<Icon name="flower2" size={26} class="text-brand" />
			</div>
			<p class="font-display text-lg font-semibold text-ink">Cycle non configuré</p>
			<p class="mx-auto mt-1 max-w-xs text-sm text-mist">Renseigne ta situation pour suivre ton cycle ici.</p>
			<button
				type="button"
				onclick={() => (editing = true)}
				class="mt-4 rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark"
			>Configurer mon cycle</button>
		</section>
	{:else if cycle.kind === 'hormonal' || cycle.kind === 'nodate'}
		<!-- Pas de fausse prédiction : message explicatif identique à l'outil d'origine -->
		<section class="mt-5 rounded-3xl border border-line bg-card p-5 shadow-sm">
			<div class="flex items-center gap-2">
				<span class="grid h-10 w-10 place-items-center rounded-full bg-brand-light">
					<Icon name="flower2" size={18} class="text-brand" />
				</span>
				<p class="font-display text-lg font-semibold text-ink">
					{cycle.kind === 'hormonal' ? 'Suivi adapté à ta contraception' : 'Règles irrégulières'}
				</p>
			</div>
			<p class="mt-3 text-sm leading-relaxed text-ink/90">
				{cycle.kind === 'hormonal' ? CYCLE_NO_ESTIMATE_MSGS.hormonal : CYCLE_NO_ESTIMATE_MSGS.irregular}
			</p>
			<button
				type="button"
				onclick={() => (editing = true)}
				class="mt-4 inline-flex items-center gap-1.5 rounded-xl border-2 border-line px-4 py-2 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand-dark"
			><Icon name="pencil" size={14} /> Modifier mes informations</button>
		</section>
	{:else}
		<!-- ═══════ Vue détaillée : position actuelle + courbe originale ═══════ -->
		<section class="mt-5 rounded-3xl border border-line bg-card p-4 shadow-sm">
			<div class="flex items-center justify-between gap-2">
				<span class="inline-flex items-center gap-1.5 rounded-full bg-brand-light px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-brand-dark">
					<Icon name="circleCheck" size={12} class="shrink-0" /> Aujourd'hui · Jour {cycle.cycleDay}
				</span>
				<span class="text-[11px] font-semibold text-mist">Cycle de {cycle.cycleLength} jours</span>
			</div>

			<h2 class="mt-3 font-display text-2xl font-semibold tracking-tight text-ink">{cycle.label}</h2>
			<p class="mt-1 text-sm leading-relaxed text-ink/85">{cycle.blurb}</p>

			<!-- Courbe ORIGINALE du fichier HTML (dégradé œstrogène → progestérone) -->
			<div class="mt-4 rounded-2xl bg-soft px-2 pb-1 pt-3">
				<svg viewBox="0 0 480 130" class="block h-auto w-full overflow-visible">
					<defs>
						<linearGradient id="cycleCurveGradient" x1="0" y1="0" x2="1" y2="0">
							<stop offset="0%" style={`stop-color:${GREEN}`} />
							<stop offset={switchPct} style={`stop-color:${GREEN}`} />
							<stop offset={switchPct} style={`stop-color:${AMBER}`} />
							<stop offset="100%" style={`stop-color:${AMBER}`} />
						</linearGradient>
					</defs>
					<line x1="8" y1="110" x2="472" y2="110" stroke="#e5e3dc" stroke-width="1" />
					<text x="8" y="126" class="fill-mist" font-size="10" font-family="inherit">Règles</text>
					<text x="232" y="126" class="fill-mist" font-size="10" text-anchor="middle" font-family="inherit">Ovulation estimée</text>
					<text x="472" y="126" class="fill-mist" font-size="10" text-anchor="end" font-family="inherit">Prémenstruel</text>
					<path
						bind:this={curvePath}
						d={CURVE_D}
						fill="none"
						stroke="url(#cycleCurveGradient)"
						stroke-width="2.4"
						stroke-linecap="round"
					/>
					<g opacity={markerReady ? 1 : 0} style="transform-box:fill-box;transform-origin:center;transition:opacity .4s ease, transform .5s cubic-bezier(.34,1.56,.64,1);{markerReady ? 'transform:scale(1)' : 'transform:scale(.4)'}">
						<circle
							cx={markerX}
							cy={markerY}
							r="5"
							fill="none"
							stroke={GREEN}
							stroke-width="1.5"
							style={markerReady ? `animation:cyclePulse 2.2s ease-out infinite` : ''}
						/>
						<circle cx={markerX} cy={markerY} r="5" fill={GREEN} />
						<text
							x={markerX}
							y={markerLabelY}
							text-anchor="middle"
							class="fill-ink"
							font-size="12"
							font-weight="600"
							font-family="inherit"
						>J{cycle.cycleDay}</text>
					</g>
				</svg>

				<div class="flex flex-wrap items-center gap-x-4 gap-y-1 pb-2 pl-1 text-[11px] text-mist">
					<span class="flex items-center gap-1.5"><i class="h-2 w-2 rounded-full" style={`background:${GREEN}`}></i> Dominante œstrogène</span>
					<span class="flex items-center gap-1.5"><i class="h-2 w-2 rounded-full" style={`background:${AMBER}`}></i> Dominante progestérone</span>
					<span class="italic opacity-75">(simplifié)</span>
				</div>
			</div>

			<!-- Cartes détaillées par phase (contenu original) -->
			{#if content}
				<div class="mt-4 flex flex-col gap-2">
					{#each content.dims as d (d.t)}
						<div class="rounded-xl border border-line bg-soft px-3.5 py-2.5">
							<div class="flex items-center justify-between gap-2">
								<span class="text-[13px] font-bold text-ink">{d.t}</span>
								<span class={`rounded-full px-2 py-0.5 text-[10px] font-bold ${dimClass(d.s)}`}>{dimLabel(d.s)}</span>
							</div>
							<p class="mt-0.5 text-xs leading-relaxed text-ink/80">{d.x}</p>
						</div>
					{/each}
				</div>

				{#if content.warn}
					<div class="mt-3 flex gap-2 rounded-xl bg-warn/10 px-3.5 py-2.5 text-xs leading-relaxed text-ink/85">
						<Icon name="triangleAlert" size={15} class="mt-0.5 shrink-0 text-warn" />
						<span>{content.warn}</span>
					</div>
				{/if}

				<p class="mt-4 text-[11px] font-bold uppercase tracking-widest text-mist">Pourquoi ?</p>
				<p class="mt-1.5 text-xs leading-relaxed text-ink/80">{content.why}</p>
			{/if}

			<p class="mt-4 text-[11px] italic text-mist">Estimation basée sur ton cycle déclaré. Le jour d'ovulation réel peut varier — considère ceci comme un repère, pas une certitude.</p>

			<button
				type="button"
				onclick={() => (editing = true)}
				class="mt-4 inline-flex items-center gap-1.5 rounded-xl border-2 border-line px-4 py-2 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand-dark"
			><Icon name="pencil" size={14} /> Modifier mes informations</button>
		</section>
	{/if}
</div>