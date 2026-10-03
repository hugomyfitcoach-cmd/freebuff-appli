<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { tick, untrack } from 'svelte';
	import AudioPlayer from '../../lib/components/AudioPlayer.svelte';
	import BilanCard from '../../lib/components/BilanCard.svelte';
	import CoachMedia from '../../lib/components/CoachMedia.svelte';
	import DossierPanel from '../../lib/components/DossierPanel.svelte';
	import FoodImg from '../../lib/components/FoodImg.svelte';
	import Icon from '../../lib/components/Icon.svelte';
	import JournalDay from '../../lib/components/JournalDay.svelte';
	import MetricTrend from '../../lib/components/MetricTrend.svelte';
	import WeeklyTrendChart from '../../lib/components/WeeklyTrendChart.svelte';
	import TrainingPanel from '../../lib/components/TrainingPanel.svelte';
	import { cycleState } from '../../lib/cycle.js';
	import { kindRule, SLOT_TAKEN_MESSAGE, toISO } from '../../lib/appointments.js';
	import { fmtMs } from '../../lib/media.js';
	import { warmFoodImages } from '../../lib/foodImageWarm.js';
	import { labelFor } from '../../lib/labels.js';
	import { ONBOARDING_SECTIONS, readableAnswer } from '../../lib/onboarding.js';
	import { avgLast7Completed } from '$lib/averages';
	import { createFoodSearch } from '$lib/foodSearch.svelte';
	import CountUp from '$lib/components/CountUp.svelte';

	let { data, form } = $props();
	/* « vivant » uniquement côté navigateur : la date/heure du hero est locale
	   à la coach, jamais celle du serveur (SSR : ligne date absente). L'effet
	   ci-dessous bascule l'état après hydratation — le titre SSR neutre évite
	   tout flash d'heure serveur et toute hydromismatch. */		let dashLive = $state(false);
	$effect(() => {
		dashLive = true;
	});

	/* ── Photo de profil coach (100 % frontend, aucun backend) : choix de
	   fichier → recadrage carré 128 px → dataURL léger persisté en localStorage. ── */
	let coachAvatar = $state<string | null>(null);
	$effect(() => {
		// Restaure la photo persistée (client uniquement, après hydratation).
		try {
			coachAvatar = localStorage.getItem('coach-avatar');
		} catch {
			/* navigation privée — aperçu de session seul */
		}
	});
	function handleAvatarPick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		const img = new Image();
		img.onload = () => {
			const c = document.createElement('canvas');
			c.width = 128;
			c.height = 128;
			const ctx = c.getContext('2d');
			if (!ctx) return;
			const side = Math.min(img.naturalWidth, img.naturalHeight);
			ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 128, 128);
			const url = c.toDataURL('image/jpeg', 0.85);
			try {
				localStorage.setItem('coach-avatar', url);
			} catch {
				/* quota dépassé — l'aperçu reste actif pour la session */
			}
			coachAvatar = url;
			URL.revokeObjectURL(img.src);
		};
		img.onerror = () => URL.revokeObjectURL(img.src);
		img.src = URL.createObjectURL(file);
		input.value = '';
	}

	const clients = $derived(data.clients ?? []);
	const selectedId = $derived(data.selectedId ?? null);
	// Semaine d'origine quand le 360 est ouvert depuis « Bilans » (vue par semaine).
	const weekParam = $derived(data.weekParam ?? null);
	const view = $derived(data.view ?? null);
	const checkins = $derived(data.checkins ?? []);
	const photos = $derived(data.photos ?? []);
	const mediaAll = $derived(data.media ?? []);
	// Onboarding de démarrage : formulaire initial + statuts des deux étapes.
	const onboardingView = $derived(data.onboardingView ?? null);
	// Médias coach → cliente : ceux du message du jour + filtrage par bilan.
	// Seul l'audio ACTIF du message est montré dans le composeur — les audios
	// plus anciens vivent dans l'historique (messageLog), pour la réécoute.
	const selected = $derived(clients.find((c: { user: { _id: string } }) => c.user._id === selectedId) ?? null);
	// Médias coach → cliente : ceux du message du jour + filtrage par bilan.
	// Seul l'audio ACTIF du message est montré dans le composeur — les audios
	// plus anciens vivent dans l'historique (messageLog), pour la réécoute.
	const messageAudio = $derived(
		selected?.user.coachMessageAudioId
			? mediaAll.filter((m: { _id: string }) => m._id === selected.user.coachMessageAudioId)
			: []
	);
	const mediaFor = (checkinId: string) =>
		mediaAll.filter((m: { checkinId: string | null }) => m.checkinId === checkinId);
	// Journal des messages envoyés (historique daté, lu/non lu, réécoute audio).
	const messageLog = $derived<MessageLogRow[]>((data.messageLog ?? []) as MessageLogRow[]);
	type MessageLogRow = {
		_id: string;
		text: string | null;
		audio: { mediaId: string; durationMs: number | null; url: string } | null;
		publishedAt: number;
		publishedDay: string;
		readAt: number | null;
		isGlobal?: boolean;
	};
	/* ── Message global (Tableau de bord) : un envoi à toutes les clientes actives ──
	   La notification, la carte et le journal côté cliente sont identiques à un
	   message classique — seule la logistique coach diffère (envoi groupé,
	   retrait possible, disparition du bloc CRM après 24 h). */
	const globalMessage = $derived<GlobalMessageRow | null>((data.globalMessage ?? null) as GlobalMessageRow | null);
	type GlobalMessageRow = {
		_id: string;
		text: string;
		publishedAt: number;
		publishedDay: string;
		expiresAt: number;
		recipientCount: number;
		readCount: number;
	};
	const globalRemainingMs = $derived(globalMessage ? Math.max(0, globalMessage.expiresAt - Date.now()) : 0);
	function fmtRemaining(ms: number): string {
		const h = Math.floor(ms / 3600000);
		const m = Math.floor((ms % 3600000) / 60000);
		return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
	}
	let msgAudioDraft = $state('');
	// Suivi de cycle de la cliente — mêmes données que le dashboard cliente (une seule source de vérité).
	const selCycle = $derived(selected?.user.cycle ?? null);
	const selCycleState = $derived(cycleState(selCycle));

	const totalWaiting = $derived(clients.reduce((s: number, c: { waiting: number }) => s + c.waiting, 0));

	/* ── Google Calendar (connexion OAuth du coach) ── */
	const google = $derived(data.google ?? null);
	const googleBanner = $derived(data.googleBanner ?? null);
	let googleBusy = $state(false);
	async function googleDisconnect() {
		if (googleBusy) return;
		googleBusy = true;
		try {
			await fetch('/api/google/disconnect', { method: 'POST' });
			await invalidateAll();
		} finally {
			googleBusy = false;
		}
	}
	const activeToday = $derived(
		clients.filter((c: { user: { lastSeenAt: number | null } }) => {
			const ts = c.user.lastSeenAt;
			return ts && Date.now() - ts < 24 * 3600 * 1000;
		}).length
	);
	// Cible du message global : activité des 5 derniers jours (même critère côté Convex).
	const active5d = $derived(
		clients.filter((c: { user: { lastSeenAt: number | null } }) => {
			const ts = c.user.lastSeenAt;
			return ts && Date.now() - ts < 5 * 24 * 3600 * 1000;
		}).length
	);

	/* ── Message du coach du jour : éphémère, expire au minuit local de la cliente
	   (coachMessageExpiresAt calculé dans SON fuseau à la publication ; replis
	   compat 24 h fixes puis jour exact) — la carte coach se réinitialise d'elle-même. ── */
	const msgActive = $derived.by(() => {
		const u = selected?.user;
		if (!u) return false;
		if (u.coachMessageExpiresAt != null) return Date.now() < u.coachMessageExpiresAt;
		const at = u.coachMessageAt ?? null;
		if (at) return Date.now() - at < 24 * 3600 * 1000;
		return !!u.coachMessageDate && u.coachMessageDate === new Date().toISOString().slice(0, 10);
	});
	const msgRead = $derived.by(() => {
		const u = selected?.user;
		const at = u?.coachMessageAt ?? null;
		return !!at && (u?.coachMessageReadAt ?? 0) >= at;
	});
	const msgHasContent = $derived(!!selected?.user.coachMessage || messageAudio.length > 0);

	let query = $state('');

	/** « Prénom Nom » quand le nom est renseigné, sinon simple prénom (cliente existante). */
	const fullName = (u: { prenom: string; nom?: string | null }): string =>
		u.nom ? `${u.prenom} ${u.nom}` : u.prenom;

	/** Téléchargement réel de la photo originale depuis le storage (jamais la vignette).
	    Nom propre : {prenom}_{date}_{label|photo-N}.{ext} — données réelles, non hardcodées. */
	function slugify(s: string): string {
		return s
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '');
	}
	async function downloadPhoto(photo: { url: string | null; label?: string }, group: { date: string }, idx: number, prenom: string) {
		if (!photo.url) return;
		const ext = (photo.url.match(/\.(jpe?g|png|webp|heic|avif|gif)(?:\?|$)/i)?.[1] ?? 'jpg').toLowerCase();
		const slug = slugify(prenom);
		const label = photo.label ? slugify(photo.label) : '';
		const base = label && !/^(photo|img|image)/i.test(label) ? label : `photo-${idx + 1}`;
		const filename = `${slug}_${group.date}_${base}.${ext}`;
		try {
			// fetch du vrai fichier → blob → download local. L'URL stockage peut être
			// cross-origin (Convex) : l'attribut download ne suffirait pas toujours.
			const res = await fetch(photo.url, { credentials: 'omit' });
			if (!res.ok) throw new Error('fetch failed');
			const blob = await res.blob();
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = filename;
			document.body.appendChild(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(a.href), 2000);
		} catch {
			// Repli : ouverture du fichier original dans un onglet (téléchargement manuel possible).
			window.open(photo.url, '_blank', 'noopener');
		}
	}

	const alert = $derived(form && 'action' in form ? (form as { action: string; error?: string; ok?: string; clientId?: string }) : null);
	const initial = (name: string) => name.trim().charAt(0).toUpperCase() || '?';

	/* ── PASS 2 (fidélité mockup) : état « Vue rapide des clientes » ──
	   Filtres UI purs (aucune donnée supplémentaire, aucun backend) — même
	   liste `clients` déjà chargée, tri et statuts dérivés localement. */
	type ClientFilter = 'all' | 'active' | 'inactive';
	let clientFilter = $state<ClientFilter>('all');
	/** Statut dérivé : active = dernière connexion < 24 h (même critère KPI). */
	function statusLabel(lastSeenAt: number | null): { label: string; cls: string } {
		return lastSeenAt && Date.now() - lastSeenAt < 24 * 3600 * 1000
			? { label: 'Active', cls: 'bg-brand-light text-brand-deep' }
			: { label: 'Inactive', cls: 'bg-danger-light text-danger' };
	}
	const clientCounts = $derived.by(() => {
		const active = clients.filter((c: { user: { lastSeenAt: number | null } }) => {
			const ts = c.user.lastSeenAt;
			return ts && Date.now() - ts < 24 * 3600 * 1000;
		}).length;
		return { all: clients.length, active, inactive: clients.length - active };
	});
	const filteredClients = $derived.by(() => {
		let list = clients;
		if (clientFilter === 'active') {
			list = list.filter((c: { user: { lastSeenAt: number | null } }) => {
				const ts = c.user.lastSeenAt;
				return ts && Date.now() - ts < 24 * 3600 * 1000;
			});
		} else if (clientFilter === 'inactive') {
			list = list.filter((c: { user: { lastSeenAt: number | null } }) => {
				const ts = c.user.lastSeenAt;
				return !ts || Date.now() - ts >= 24 * 3600 * 1000;
			});
		}
		if (!query.trim()) return list;
		const q = query.trim().toLowerCase();
		return list.filter((c: { user: { prenom: string; nom?: string | null; email: string } }) =>
			`${fullName(c.user)} ${c.user.email}`.toLowerCase().includes(q)
		);
	});

	/** Âge calculé depuis la date de naissance (jamais saisi à la main) — jour/mois d'anniversaire inclus. */
	const ageOf = $derived.by(() => {
		const b = selected?.user.birthDate;
		if (!b) return null;
		const birth = new Date(b + 'T12:00:00');
		if (isNaN(birth.getTime())) return null;
		const now = new Date();
		let age = now.getFullYear() - birth.getFullYear();
		const m = now.getMonth() - birth.getMonth();
		if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
		return age;
	});
	/** « Membre depuis le » — début du suivi si renseigné, sinon création du compte. */
	const memberSince = $derived.by(() => {
		const u = selected?.user;
		if (!u) return null;
		if (u.startDate) return fmtDateShort(u.startDate);
		if (u.createdAt) return fmtDateShort(new Date(u.createdAt).toISOString().slice(0, 10));
		return null;
	});

	/* ── Formatage ─────────────────────────────────────────────── */
	function fmtLastSeen(ts: number | null): string {
		if (!ts) return 'jamais connecté·e';
		const diff = Date.now() - ts;
		const min = Math.floor(diff / 60000);
		if (min < 1) return 'à l’instant';
		if (min < 60) return `il y a ${min} min`;
		const h = Math.floor(min / 60);
		if (h < 24) return `il y a ${h} h`;
		const d = Math.floor(h / 24);
		if (d === 1) return 'hier';
		if (d < 7) return `il y a ${d} j`;
		return new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
	}

	function fmtDateShort(iso: string): string {
		return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
	}

	function fmtTs(ts: number | null | undefined): string {
		if (!ts) return '';
		return new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
	}

	/* ── Onboarding (état dérivé du formulaire initial + données réelles) ── */
	const obAnswers = $derived<Record<string, unknown>>(
		(onboardingView?.intake?.answers as Record<string, unknown> | undefined) ?? {}
	);
	type ObSection = (typeof ONBOARDING_SECTIONS)[number];
	const obAnswered = $derived.by(() => {
		const out: { section: ObSection; items: { q: ObSection['questions'][number]; v: string }[] }[] = [];
		for (const s of ONBOARDING_SECTIONS) {
			const items: { q: ObSection['questions'][number]; v: string }[] = [];
			for (const q of s.questions) {
				const raw = obAnswers[q.id];
				if (raw == null || String(raw).trim() === '') continue;
				if (q.showWhen && obAnswers[q.showWhen.field] !== q.showWhen.value) continue;
				items.push({ q, v: readableAnswer(q.id, raw) });
			}
			if (items.length) out.push({ section: s, items });
		}
		return out;
	});

	function todayISO(): string {
		const d = new Date();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}

	/* ── Vue 360° ──────────────────────────────────────────────── */
	const weightDelta = $derived(
		view && view.lastWeight != null && view.firstWeight != null ? Math.round((view.lastWeight - view.firstWeight) * 10) / 10 : null
	);
	const latestMetric = $derived(view?.latestMetric ?? null);
	/** Dernière valeur par métrique, en date de mesure (source : client360).
	 *  Sert aux cartes Aperçu : le cou noté seul à une autre date reste affiché. */
	type LatestMetricPoint = { value: number; date: string } | null;
	const latestByMetric = $derived(
		(view?.latestByMetric ?? null) as
			| { weightKg: LatestMetricPoint; waistCm: LatestMetricPoint; hipCm: LatestMetricPoint; neckCm: LatestMetricPoint }
			| null
	);
	/** Valeur de secours (anciens cachets du server sans latestByMetric) : dernier relevé utile. */
	const latestAny = $derived(
		latestByMetric ?? {
			weightKg: latestMetric?.weightKg != null ? { value: latestMetric.weightKg, date: latestMetric.date } : null,
			waistCm: latestMetric?.waistCm != null ? { value: latestMetric.waistCm, date: latestMetric.date } : null,
			hipCm: latestMetric?.hipCm != null ? { value: latestMetric.hipCm, date: latestMetric.date } : null,
			neckCm: latestMetric?.neckCm != null ? { value: latestMetric.neckCm, date: latestMetric.date } : null,
		}
	);
	const fmtCm = (n: number) => String(n).replace('.', ',');
	/** Date du relevé mensurations affiché = la plus récente des 3 valeurs (peut différer de la pesée). */
	const mensDate = $derived.by(() => {
		const dates = [latestAny.waistCm?.date, latestAny.hipCm?.date, latestAny.neckCm?.date].filter((d): d is string => !!d);
		return dates.length ? dates.sort()[dates.length - 1] : null;
	});
	const goalKcal = $derived(view?.goals?.kcal ?? 2000);
	/** VISION 360 LIVE — les données du cockpit sont servies déjà recalculées
	   sur les 7 JOURNÉES CALENDAIRES COMPLÈTES (J-7 → J-1, Europe/Paris) au
	   MOMENT de la consultation (client360 recalculé à chaque requête — photo
	   live, jamais figée à la date d'envoi du bilan). Les replis locaux ci-
	   dessous ne servent que pour un cachet serveur ancien, jamais aujourd'hui. */
	const visionWindowInfo = $derived(
		(view?.visionWindow ?? null) as { start: string; end: string; today: string } | null
	);
	const weekAvg = $derived.by(() => {
		if (!view) return 0;
		const served = cockpit?.calories?.avg;
		// Moyenne LIVE (jours exploitables, garde-fou) servie par le backend.
		if (typeof served === 'number' && served > 0) return served;
		const days = (view.week ?? []) as { date: string; kcal: number; count: number }[];
		return avgLast7Completed(days.map((d) => ({ date: d.date, value: d.count > 0 ? d.kcal : null })), todayISO()).avg ?? 0;
	});
	const kcalTrend = $derived(view && weekAvg > 0 ? Math.round(((weekAvg - (view?.cockpit?.calories?.goal ?? goalKcal)) / (view?.cockpit?.calories?.goal ?? goalKcal)) * 100) : 0);
	const loggedDays = $derived(view?.week?.filter((d: { count: number }) => d.count > 0).length ?? 0);

	/** Barres calories des 7 JOURNÉES TERMINÉES (J-7 → J-1, le serveur sert
	   déjà la bonne fenêtre) — jour sans entrée = null (≠ 0), jamais la journée
	   partielle d'aujourd'hui dans le graphe ni la moyenne. */
	const calBars = $derived.by<{ date: string; value: number | null; count: number; isToday: boolean }[]>(() => {
		const days = (view?.week ?? []) as { date: string; kcal: number; count: number }[];
		return days.map((d) => ({
			date: d.date,
			value: d.count > 0 ? d.kcal : null,
			count: d.count,
			isToday: false,
		}));
	});

	/* ── Pas — tendance des 7 JOURNÉES TERMINÉES J-7 → J-1 (mêmes règles :
	   null = non renseigné, jamais aujourd'hui dans la fenêtre) ── */
	const stepGoalVal = $derived(((view?.goals as { stepGoal?: number } | undefined)?.stepGoal) ?? null);
	const stepWeek = $derived((view?.stepsLast7 ?? []) as { date: string; count: number | null }[]);
	const stepBars = $derived(
		stepWeek.map((d) => ({ date: d.date, value: d.count, isToday: false }))
	);
	/** MÊME FONCTION que la cliente et le backend (lib/averages.ts) :
	   7 journées terminées J-7 → J-1, jours sans saisie jamais comptés 0. */
	const stepsAvgResult = $derived(avgLast7Completed(stepWeek.map((d) => ({ date: d.date, value: d.count })), todayISO()));
	const stepsTracked = $derived(stepsAvgResult.trackedDays);
	const stepsTotal = $derived(stepBars.reduce((s, b) => s + (b.value ?? 0), 0));
	/** Moyenne UNIQUEMENT sur les jours réellement renseignés — jamais divisée par 7. */
	const stepsAvg = $derived(stepsAvgResult.avg ?? 0);
	/** Écarts moyenne ↔ objectif (cartes « Analyses » de la Vision 360). */
	const kcalGoalVal = $derived(view?.cockpit?.calories?.goal ?? goalKcal);
	const kcalGap = $derived(weekAvg > 0 ? Math.round(weekAvg - kcalGoalVal) : null);
	const stepsGap = $derived(stepsAvg > 0 && stepGoalVal ? Math.round(stepsAvg - stepGoalVal) : null);
	const fmtN = (n: number) => Math.round(n).toLocaleString('fr-FR');

	const weightPoints = $derived.by(() => {
		if (!view || (view.weightTrend ?? []).length < 1) return null;
		const pts = view.weightTrend as { date: string; weightKg: number }[];
		const W = 700, H = 170, top = 14, bottom = 26;
		const innerH = H - top - bottom;
		let min = Infinity, max = -Infinity;
		for (const p of pts) {
			if (p.weightKg < min) min = p.weightKg;
			if (p.weightKg > max) max = p.weightKg;
		}
		const span = Math.max(max - min, 2);
		min = min - span * 0.25;
		max = max + span * 0.25;
		const n = pts.length;
		const coords = pts.map((p, i) => {
			const x = n === 1 ? W / 2 : (i / (n - 1)) * (W - 60) + 30;
			const y = top + innerH - ((p.weightKg - min) / (max - min)) * innerH;
			return { x, y, date: p.date, weightKg: p.weightKg };
		});
		return { coords, min: Math.round(min * 10) / 10, max: Math.round(max * 10) / 10 };
	});

	const isOnline = (ts: number | null) => !!ts && Date.now() - ts < 5 * 60 * 1000;

	/* ── Refonte UX/UI premium (north star : docs/refonte-preview) ─────────
	   Hero dashboard : salutation « Bonjour {prenom} 👋 » + date longue du jour
	   + sous-titre métier, selon le mockup validé. Côté serveur (SSR) : titre
	   neutre « Tableau de bord — CRM coach » (aucune information d'heure, la
	   date vivant côté navigateur pour suivre le fuseau de la coach) ; après
	   hydratation le titre devient « Bonjour Hugo 👋 » et la ligne date se
	   révèle — stable pendant TOUTE la session (pas de re-rendu à la minute). */
	const dashNow = $derived.by(() => {
		if (!dashLive) return null;
		return new Date();
	});
	/** Prénom du coach : fourni par le layout /admin (prop `data` des pages
	 *  enfants — cf. `let { data, children } = $props()` du layout). SSR compris.
	 *  Repli : prénom de la cliente (« Démo ») sur le backend de démo. */
	const dashGreetingPrenom = $derived(
		(data as { user?: { prenom?: string } } | null)?.user?.prenom
			?? (clients[0] as { user?: { prenom?: string } } | undefined)?.user?.prenom
			?? 'coach'
	);
	const dashTitle = $derived(
		dashLive ? `Bonjour ${dashGreetingPrenom} 👋` : 'Tableau de bord — Espace coach'
	);
	const dashDateLine = $derived.by(() => {
		if (!dashNow) return '';
		const long = dashNow.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
		const time = dashNow.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
		// Numéro de semaine ISO 8601 (semaine commençant lundi).
		const thursday = new Date(dashNow.getFullYear(), dashNow.getMonth(), dashNow.getDate() + 3 - ((dashNow.getDay() + 6) % 7));
		const week = 1 + Math.round((thursday.getTime() - new Date(thursday.getFullYear(), 0, 4).getTime()) / 604_800_000);
		return `${long.charAt(0).toUpperCase()}${long.slice(1)} · ${time} · semaine ${week}`;
	});
	/** KPI : clientes actives sur les 24 dernières heures — même définition
	 *  que le compteur existant « Actif·ve·s aujourd’hui » (lastSeenAt). */
	const dashKpiClients = $derived(clients.length);
	const dashKpiActive = $derived(
		clients.filter((c: { user: { lastSeenAt: number | null } }) => {
			const ts = c.user.lastSeenAt;
			return ts && Date.now() - ts < 24 * 3600 * 1000;
		}).length
	);
	const dashKpiWaiting = $derived(totalWaiting);
	/* ── KPI « Rendez-vous du jour » — API existante GET /api/appointments (tous
	   les RDV du coach), simple lecture côté client : aucun changement backend. ── */
	type DashRdv = { _id: string; date: string; time: string; clientName?: string };
	let kpiRdvAll = $state<DashRdv[]>([]);
	let kpiRdvLoading = $state(true);
	$effect(() => {
		void (async () => {
			try {
				const j = await fetch('/api/appointments').then((x) => x.json());
				kpiRdvAll = (j.appointments ?? []) as DashRdv[];
			} catch {
				kpiRdvAll = [];
			} finally {
				kpiRdvLoading = false;
			}
		})();
	});
	/** RDV dont la date locale (yyyy-mm-dd) est aujourd'hui, triés par heure. */
	const kpiRdvToday = $derived.by(() => {
		const n = new Date();
		const key = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
		return kpiRdvAll.filter((r) => r.date === key).sort((a, b) => a.time.localeCompare(b.time));
	});
	/** 5 actions prioritaires max, dérivées de données déjà chargées — aucune
	 *  requête ajoutée, aucune logique métier modifiée (simple réordonnancement). */
	type DashTodo = {
		key: string;
		icon: string;
		title: string;
		subtitle: string;
		tone: 'warn' | 'danger' | 'brand' | 'blue';
		toneLabel: string;
		href: string;
	};
	const dashTodos = $derived.by<DashTodo[]>(() => {
		const out: DashTodo[] = [];
		// 1) Bilans déposés en attente de retour (client.waiting déjà calculé côté Convex).
		for (const c of [...clients].sort((a: { waiting: number }, b: { waiting: number }) => b.waiting - a.waiting)) {
			if (c.waiting <= 0) break;
			out.push({
				key: `waiting-${c.user._id}`,
				icon: 'clipboardCheck',
				title: `Bilan de ${fullName(c.user)} à traiter`,
				subtitle: c.latest?.weekLabel ? `${c.waiting} retour${c.waiting > 1 ? 's' : ''} à écrire · dernier bilan ${c.latest.weekLabel}` : 'Retour à écrire',
				tone: 'warn',
				toneLabel: 'À traiter',
				href: `/admin?client=${c.user._id}&section=bilans`,
			});
			if (out.length >= 3) break;
		}
		// 2) Inactivité 24 h : la coach voit d'un œil qui n'a pas ouvert l'app.
		const inactive = clients.filter((c: { user: { lastSeenAt: number | null } }) => {
			const ts = c.user.lastSeenAt;
			return !ts || Date.now() - ts >= 24 * 3600 * 1000;
		}).slice(0, 2);
		for (const c of inactive) {
			out.push({
				key: `idle-${c.user._id}`,
				icon: 'bellOff',
				title: `${fullName(c.user)} n'a pas ouvert l'app`,
				subtitle: fmtLastSeen(c.user.lastSeenAt),
				tone: 'blue',
				toneLabel: 'À relancer',
				href: `/admin?client=${c.user._id}`, // ouverture sur l'Aperçu (section=apercu par défaut)
			});
		}
		return out.slice(0, 5);
	});

	/* ── Objectifs journaliers : deux modes de saisie ────────────── */
	/*
	 * Mode « répartition » : on entre un total calorique + des pourcentages
	 * (glucides/protéines/lipides) qui doivent faire 100 % ; les grammes en
	 * sont déduits (1 g glucides/protéines = 4 kcal, 1 g lipides = 9 kcal).
	 * Mode « macros » : on entre les grammes, et le total calorique se calcule
	 * automatiquement (4·g + 4·g + 9·g). Le stockage reste identique (grammes).
	 */
	type GoalsMode = 'pct' | 'grams';
	let goalsMode = $state<GoalsMode>('pct');
	let pctKcal = $state(2000);
	let pctCarbs = $state(40);
	let pctProtein = $state(30);
	let pctFat = $state(30);
	let gCarbs = $state(250);
	let gProtein = $state(90);
	let gFat = $state(65);
	/** Maintenance calorique (filet de sécurité) — saisie manuelle, optionnelle. */
	let maintenanceKcal = $state('');
	/** Maintenance déjà enregistrée en base (le fallback DEFAULT_GOALS n'a pas le champ). */
	const savedMaintenance = $derived(
		view && view.goals && 'maintenanceKcal' in view.goals && typeof view.goals.maintenanceKcal === 'number'
			? view.goals.maintenanceKcal
			: null
	);
	/** Objectif quotidien de pas — saisi manuellement par la coach, optionnel. */
	let stepGoal = $state('');
	/** Objectif de pas déjà enregistré en base (le fallback DEFAULT_GOALS n'a pas le champ). */
	const savedStepGoal = $derived(
		view && view.goals && 'stepGoal' in view.goals && typeof view.goals.stepGoal === 'number'
			? view.goals.stepGoal
			: null
	);

	const goalsValues = $derived.by(() => {
		if (goalsMode === 'pct') {
			const kcal = Math.max(0, Math.round(pctKcal) || 0);
			const carbs = Math.round(((kcal * (pctCarbs || 0)) / 100) / 4);
			const protein = Math.round(((kcal * (pctProtein || 0)) / 100) / 4);
			const fat = Math.round(((kcal * (pctFat || 0)) / 100) / 9);
			return { kcal, carbs, protein, fat };
		}
		const carbs = Math.max(0, Math.round(gCarbs) || 0);
		const protein = Math.max(0, Math.round(gProtein) || 0);
		const fat = Math.max(0, Math.round(gFat) || 0);
		return { kcal: 4 * carbs + 4 * protein + 9 * fat, carbs, protein, fat };
	});
	const pctSum = $derived((pctCarbs || 0) + (pctProtein || 0) + (pctFat || 0));
	const pctOk = $derived(Math.abs(pctSum - 100) <= 0.5);
	const goalsError = $derived.by(() => {
		if (goalsMode === 'pct' && !pctOk) {
			return `La répartition doit faire 100 % (actuellement ${pctSum} %).`;
		}
		const { kcal, carbs, protein, fat } = goalsValues;
		if (kcal < 800 || kcal > 6000) return 'Calories hors plage (800 à 6000 kcal).';
		if (carbs < 0 || carbs > 1000) return 'Glucides hors plage (0 à 1000 g).';
		if (protein < 0 || protein > 400) return 'Protéines hors plage (0 à 400 g).';
		if (fat < 0 || fat > 300) return 'Lipides hors plage (0 à 300 g).';
		return '';
	});

	function switchGoalsMode(m: GoalsMode) {
		if (m === goalsMode) return;
		const { kcal, carbs, protein, fat } = goalsValues;
		if (m === 'pct') {
			pctKcal = kcal;
			if (kcal > 0) {
				pctCarbs = Math.round(((carbs * 4) / kcal) * 100);
				pctProtein = Math.round(((protein * 4) / kcal) * 100);
				pctFat = Math.max(0, 100 - pctCarbs - pctProtein);
			} else {
				pctCarbs = 40;
				pctProtein = 30;
				pctFat = 30;
			}
		} else {
			gCarbs = carbs;
			gProtein = protein;
			gFat = fat;
		}
		goalsMode = m;
	}

	/*
	 * Initialise les champs depuis les objectifs enregistrés (grammes), UNIQUEMENT
	 * quand on change de client : `untrack` évite que l'effet se relance à chaque
	 * frappe (ce qui écraserait la saisie de la coach).
	 */
	$effect(() => {
		const id = selectedId;
		if (!id) return;
		const g = untrack(() => view?.goals);
		if (!g) return;
		const kcal = g.kcal ?? 2000;
		const carbs = g.carbs ?? 250;
		const protein = g.protein ?? 90;
		const fat = g.fat ?? 65;
		pctKcal = kcal;
		gCarbs = carbs;
		gProtein = protein;
		gFat = fat;
		maintenanceKcal = 'maintenanceKcal' in g && g.maintenanceKcal ? String(g.maintenanceKcal) : '';
		stepGoal = 'stepGoal' in g && g.stepGoal ? String(g.stepGoal) : '';
		if (kcal > 0) {
			// Attention : ne JAMAIS relire pctCarbs/pctProtein ici — ils deviendraient
			// des dépendances de l'effet et chaque frappe dans Glucides/Protéines
			// relancerait l'initialisation, écrasant la saisie de la coach.
			const c = Math.round(((carbs * 4) / kcal) * 100);
			const p = Math.round(((protein * 4) / kcal) * 100);
			pctCarbs = c;
			pctProtein = p;
			pctFat = Math.max(0, 100 - c - p);
		} else {
			pctCarbs = 40;
			pctProtein = 30;
			pctFat = 30;
		}
	});

	/* ── Journal alimentaire (la coach agit « en doublon ») ────── */
	const MEALS = [
		{ id: 'petit-dej', label: 'Petit-déjeuner' },
		{ id: 'dejeuner', label: 'Déjeuner' },
		{ id: 'diner', label: 'Dîner' },
		{ id: 'collation', label: 'Collations' },
	];
	const MEAL_LABEL: Record<string, string> = Object.fromEntries(MEALS.map((m) => [m.id, m.label]));

	type Entry = {
		_id: string;
		meal: string;
		name: string;
		brand?: string;
		imageUrl?: string;
		/** Miniature miroir G-FLUX (copie OFF 100 px) — prioritaire sur imageUrl. */
		thumbUrl?: string;
		qtyGrams: number;
		kcal: number;
		carbs: number;
		protein: number;
		fat: number;
	};
	type DayData = {
		date: string;
		goals: { kcal: number; carbs: number; protein: number; fat: number };
		entries: Entry[];
		totals: { kcal: number; carbs: number; protein: number; fat: number };
	};
	type FoodHit = {
		_id: string;
		name: string;
		brand?: string;
		kcal100: number;
		carbs100: number;
		protein100: number;
		fat100: number;
		/** Garde-fou kcal↔macros : kcal OFF incohérentes, valeur recalculée affichée. */
		kcalRecalculated?: boolean;
		imageUrl?: string;
		/** Miniature miroir G-FLUX prête (copie OFF 100 px) — prioritaire sur imageUrl. */
		thumbUrl?: string;
		/** Fiche de RÉFÉRENCE Ciqual (ANSES) — _id = libellé officiel exact. */
		ciqual?: boolean;
	};

	let journalDate = $state(todayISO());
	let day = $state<DayData | null>(null);
	let journalBusy = $state(false);
	let journalMsg = $state('');

	let searchOpen = $state(false);
	/**
	 * Moteur de recherche partagé avec la PWA cliente (foodSearch.svelte.ts) :
	 * mêmes endpoints (`/api/foods/search`, `/api/foods/ciqual`), mêmes repères
	 * Ciqual, même ranking OFF — recherche réactive pendant la frappe
	 * (debounce 300 ms, seuil 2 caractères, anti-course : une réponse ancienne
	 * ne peut jamais remplacer une requête plus récente).
	 */
	const foodSearch = createFoodSearch();
	let addMeal = $state('petit-dej');
	let addQty = $state('100');

	/*
	 * Garde-fou anti-course : si la coach change la date plusieurs fois vite
	 * (roue iOS / double-clic), seule la réponse de la DERNIÈRE date demandée
	 * est appliquée — sinon un jour déjà quitté peut réapparaître.
	 */
	let journalReq = 0;
	/** Décale d'un jour (locale, T12:00 — aucun décalage UTC) et recharge immédiatement. */
	function shiftDay(delta: number) {
		const d = new Date(journalDate + 'T12:00:00');
		d.setDate(d.getDate() + delta);
		journalDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		loadDay();
	}
	/** On ne peut jamais aller au-delà d'aujourd'hui (flèche › désactivée). */
	const journalAtToday = $derived(journalDate >= todayISO());
	async function loadDay() {
		if (!selectedId) return;
		const req = ++journalReq;
		journalBusy = true;
		journalMsg = '';
		// Jour différent de celui affiché : on retire l'ancienne journée pour ne
		// jamais laisser croire que les aliments visibles sont ceux de la date demandée.
		if (day && day.date !== journalDate) day = null;
		try {
			const res = await fetch(`/api/coach/journal?userId=${selectedId}&date=${journalDate}`);
			const data = await res.json();
			if (req !== journalReq) return;
			if (!res.ok) throw new Error(data.error ?? 'Chargement impossible.');
			day = data;
		} catch (e) {
			if (req !== journalReq) return;
			journalMsg = e instanceof Error ? e.message : 'Chargement impossible.';
		} finally {
			if (req === journalReq) journalBusy = false;
		}
	}

	async function addFood(hit: FoodHit) {
		if (!selectedId) return;
		// Préchauffage du miroir (fire-and-forget) — jamais dans le chemin critique.
		warmFoodImages([hit]);
		try {
			const res = await fetch('/api/coach/journal', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					userId: selectedId,
					date: journalDate,
					meal: addMeal,
					...(hit.ciqual ? { ciqualLabel: hit._id } : { foodId: hit._id }),
					qtyGrams: Number(addQty) || 100,
				}),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? 'Ajout impossible.');
			searchOpen = false;
			foodSearch.clear();
			await loadDay();
		} catch (e) {
			journalMsg = e instanceof Error ? e.message : 'Ajout impossible.';
		}
	}

	async function setQty(entry: Entry, qtyGrams: number) {
		if (!selectedId) return;
		try {
			const res = await fetch(`/api/coach/journal/${entry._id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId: selectedId, qtyGrams }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? 'Mise à jour impossible.');
			await loadDay();
		} catch (e) {
			journalMsg = e instanceof Error ? e.message : 'Mise à jour impossible.';
		}
	}

	async function removeEntry(entry: Entry) {
		if (!selectedId) return;
		try {
			const res = await fetch(`/api/coach/journal/${entry._id}?userId=${selectedId}`, { method: 'DELETE' });
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? 'Suppression impossible.');
			await loadDay();
		} catch (e) {
			journalMsg = e instanceof Error ? e.message : 'Suppression impossible.';
		}
	}

	/* ── Mensurations / poids (la coach corrige) ─────────────────
	   Chaque métrique possède SON PROPRE historique : une prise n'écrit que
	   SON champ sur la ligne de la date (upsert), une modification ne touche
	   que la métrique ciblée (updateOne), une suppression ne retire que cette
	   valeur. Le % de masse grasse est dérivé côté Convex (même source que
	   l'espace cliente) avec les dernières valeurs connues de chaque mesure —
	   jamais saisi à la main. */
	type Measurement = {
		_id: string;
		date: string;
		weightKg?: number;
		neckCm?: number;
		waistCm?: number;
		hipCm?: number;
		heightCm?: number;
	};
	type BodyMetricKey = 'weightKg' | 'waistCm' | 'hipCm' | 'neckCm';
	const BODY_METRICS: { key: BodyMetricKey; label: string; unit: string; icon: string; color: string; min: number; max: number }[] = [
		{ key: 'weightKg', label: 'Poids', unit: 'kg', icon: 'scale', color: '#1db954', min: 30, max: 350 },
		{ key: 'waistCm', label: 'Tour de taille fine', unit: 'cm', icon: 'ruler', color: '#f97316', min: 40, max: 250 },
		{ key: 'hipCm', label: 'Fessiers', unit: 'cm', icon: 'ruler', color: '#ec4899', min: 50, max: 300 },
		{ key: 'neckCm', label: 'Tour de cou', unit: 'cm', icon: 'ruler', color: '#3b82f6', min: 20, max: 80 },
	];

	let measurements = $state<Measurement[]>([]);
	let heightCm = $state<number | null>(null);
	let bodyFat = $state<{ date: string; value: number }[]>([]);
	/** Vue détaillée par métrique dans l'onglet Poids & mesures (null = grille des cartes). */
	let corpsDetail = $state<{ kind: 'metric'; key: BodyMetricKey } | { kind: 'height' } | { kind: 'bodyfat' } | null>(null);
	/** Métrique affichée en détail (dérivée de corpsDetail, pour un typage net dans le markup). */
	const corpsMeta = $derived.by(() => {
		const d = corpsDetail;
		if (!d || d.kind !== 'metric') return null;
		return BODY_METRICS.find((m) => m.key === d.key) ?? null;
	});
	const corpsRows = $derived.by(() => {
		const d = corpsDetail;
		if (!d || d.kind !== 'metric') return [];
		return bmSeries(d.key);
	});
	// un brouillon (date + valeur) par métrique + un pour la taille
	// (bind:value sur <input type="number"> renvoie un nombre en Svelte 5)
	let bmDraft = $state<Record<string, { date: string; value: string | number }>>({});
	let bmEdit = $state<{ key: string; date: string } | null>(null);
	let bmBusy = $state(false);
	let bmMsg = $state('');
	let hDraft = $state({ date: todayISO(), value: '' });
	let hBusy = $state(false);

	async function loadMeasurements() {
		if (!selectedId) return;
		try {
			const res = await fetch(`/api/coach/metrics?userId=${selectedId}`);
			const data = await res.json();
			if (res.ok && Array.isArray(data.measurements)) {
				measurements = data.measurements;
				heightCm = data.heightCm ?? null;
				bodyFat = data.bodyFat ?? [];
			}
		} catch {
			/* silencieux */
		}
	}

	function initBodyDrafts() {
		const t = todayISO();
		bmDraft = {
			weightKg: { date: t, value: '' },
			waistCm: { date: t, value: '' },
			hipCm: { date: t, value: '' },
			neckCm: { date: t, value: '' },
		};
		bmEdit = null;
		hDraft = { date: t, value: heightCm != null ? String(heightCm).replace('.', ',') : '' };
	}

	/** Série datée d'une métrique — indépendante des autres. */
	function bmSeries(key: BodyMetricKey): { date: string; value: number }[] {
		return measurements
			.filter((m) => m[key] !== undefined && m[key] !== null)
			.map((m) => ({ date: m.date, value: m[key] as number }))
			.sort((a, b) => a.date.localeCompare(b.date));
	}

	/** Évolution depuis la première valeur enregistrée (dernière − première), ou null si < 2 valeurs. */
	function metricDelta(rows: { value: number }[]): number | null {
		if (rows.length < 2) return null;
		return Math.round((rows[rows.length - 1].value - rows[0].value) * 10) / 10;
	}
	/** « +1,2 » / « -3,8 » — signe explicite, virgule française. */
	function fmtSigned(n: number): string {
		return `${n > 0 ? '+' : ''}${String(n).replace('.', ',')}`;
	}
	const heightSeries = $derived(
		measurements
			.filter((m) => m.heightCm !== undefined && m.heightCm !== null)
			.map((m) => ({ date: m.date, value: m.heightCm as number }))
			.sort((a, b) => a.date.localeCompare(b.date))
	);
	const bfPoints = $derived(bodyFat);
	const bfLast = $derived(bfPoints.length ? bfPoints[bfPoints.length - 1].value : null);
	const bfDelta = $derived(
		bfPoints.length > 1 && bfLast !== null ? Math.round((bfLast - bfPoints[0].value) * 10) / 10 : null
	);

	/** Ajoute UNE mesure : n'écrit que son champ sur la ligne de la date. */
	async function addBodyMetric(key: BodyMetricKey) {
		if (!selectedId) return;
		const d = bmDraft[key];
		const raw = String(d?.value ?? '');
		if (!d || !d.date || raw.trim() === '') {
			bmMsg = 'Renseigne la date et la valeur.';
			return;
		}
		const value = Number(raw.replace(',', '.'));
		if (!isFinite(value)) {
			bmMsg = 'Valeur invalide.';
			return;
		}
		bmBusy = true;
		bmMsg = '';
		try {
			const res = await fetch('/api/coach/metrics', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId: selectedId, date: d.date, [key]: value }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? 'Enregistrement impossible.');
			bmMsg = '✓ Valeur ajoutée.';
			bmDraft[key] = { date: d.date, value: '' };
			await loadMeasurements();
			await invalidateAll();
		} catch (e) {
			bmMsg = e instanceof Error ? e.message : 'Enregistrement impossible.';
		} finally {
			bmBusy = false;
		}
	}

	/** Modifie UNIQUEMENT la valeur de cette métrique pour cette date. */
	async function editBodyMetric(key: BodyMetricKey) {
		if (!selectedId || !bmEdit) return;
		const d = bmDraft[key];
		const raw = String(d?.value ?? '');
		if (!d || !d.date || raw.trim() === '') {
			bmMsg = 'Renseigne la date et la valeur.';
			return;
		}
		const value = Number(raw.replace(',', '.'));
		if (!isFinite(value)) {
			bmMsg = 'Valeur invalide.';
			return;
		}
		bmBusy = true;
		bmMsg = '';
		try {
			const res = await fetch('/api/coach/metrics', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId: selectedId, date: d.date, metric: key, value }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? 'Modification impossible.');
			bmMsg = '✓ Valeur modifiée.';
			bmDraft[key] = { date: d.date, value: '' };
			bmEdit = null;
			await loadMeasurements();
			await invalidateAll();
		} catch (e) {
			bmMsg = e instanceof Error ? e.message : 'Modification impossible.';
		} finally {
			bmBusy = false;
		}
	}

	function startBmEdit(key: BodyMetricKey, date: string, value: number) {
		bmEdit = { key, date };
		bmDraft[key] = { date, value };
		bmMsg = '';
		document.getElementById(`bm-form-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}

	async function deleteMetric(date: string, metric: string) {
		if (!selectedId) return;
		try {
			const res = await fetch(`/api/coach/metrics?userId=${selectedId}&date=${date}&metric=${metric}`, { method: 'DELETE' });
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? 'Suppression impossible.');
			await loadMeasurements();
			await invalidateAll();
		} catch (e) {
			bmMsg = e instanceof Error ? e.message : 'Suppression impossible.';
		}
	}

	async function saveHeightCrm() {
		if (!selectedId) return;
		const h = Number(hDraft.value.replace(',', '.'));
		if (!isFinite(h) || hDraft.value.trim() === '') {
			bmMsg = 'Renseigne une taille valide (80 à 250 cm).';
			return;
		}
		hBusy = true;
		bmMsg = '';
		try {
			const res = await fetch('/api/coach/metrics', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId: selectedId, heightCm: h }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? 'Enregistrement impossible.');
			bmMsg = '✓ Taille enregistrée.';
			hDraft = { date: todayISO(), value: '' };
			await loadMeasurements();
			await invalidateAll();
		} catch (e) {
			bmMsg = e instanceof Error ? e.message : 'Enregistrement impossible.';
		} finally {
			hBusy = false;
		}
	}

	/* ── Ajout rapide depuis l'Aperçu ────────────────────────────
	   Les cartes « Poids actuel » et « Mensurations » ouvrent une petite
	   fenêtre de saisie SANS quitter l'Aperçu. L'enregistrement réutilise
	   exactement la logique de l'onglet « Poids & mesures » (POST
	   /api/coach/metrics → upsertForCoach : n'écrit que les champs fournis
	   sur la ligne de la date). Les champs laissés vides des mensurations
	   ne sont PAS envoyés → ils ne bloquent rien et n'écrasent rien. */
	type QuickSheetKind = 'weight' | 'mensurations';
	let quickSheet = $state<{ kind: QuickSheetKind } | null>(null);
	let quickWeight = $state<{ date: string; value: string | number }>({ date: todayISO(), value: '' });
	let quickMes = $state({ date: todayISO(), waistCm: '' as string | number, hipCm: '' as string | number, neckCm: '' as string | number });
	let quickBusy = $state(false);
	let quickMsg = $state('');

	function openQuickSheet(kind: QuickSheetKind) {
		const t = todayISO();
		quickSheet = { kind };
		quickWeight = { date: t, value: '' };
		quickMes = { date: t, waistCm: '', hipCm: '', neckCm: '' };
		quickMsg = '';
	}

	/** Même convention de saisie que « Poids & mesures » : virgule française
	   acceptée ; champ vide → undefined (non envoyé, ancienne valeur conservée). */
	function parseQuick(raw: string | number): number | undefined {
		const t = String(raw ?? '').trim();
		if (t === '') return undefined;
		const v = Number(t.replace(',', '.'));
		return isFinite(v) ? v : NaN;
	}

	async function saveQuickWeight() {
		if (!selectedId) return;
		const w = parseQuick(quickWeight.value);
		if (!quickWeight.date || w === undefined || !isFinite(w)) {
			quickMsg = 'Renseigne la date et le poids.';
			return;
		}
		quickBusy = true;
		quickMsg = '';
		try {
			const res = await fetch('/api/coach/metrics', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId: selectedId, date: quickWeight.date, weightKg: w }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? 'Enregistrement impossible.');
			await loadMeasurements();
			await invalidateAll(); // recharge la vue 360° → cartes de l'Aperçu à jour immédiatement
			quickSheet = null;
		} catch (e) {
			quickMsg = e instanceof Error ? e.message : 'Enregistrement impossible.';
		} finally {
			quickBusy = false;
		}
	}

	async function saveQuickMesures() {
		if (!selectedId) return;
		if (!quickMes.date) {
			quickMsg = 'Renseigne la date.';
			return;
		}
		const waist = parseQuick(quickMes.waistCm);
		const hip = parseQuick(quickMes.hipCm);
		const neck = parseQuick(quickMes.neckCm);
		if ([waist, hip, neck].every((v) => v === undefined)) {
			quickMsg = 'Saisis au moins une valeur — les champs vides sont ignorés.';
			return;
		}
		if ([waist, hip, neck].some((v) => v !== undefined && !isFinite(v))) {
			quickMsg = 'Valeur invalide.';
			return;
		}
		quickBusy = true;
		quickMsg = '';
		try {
			const res = await fetch('/api/coach/metrics', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					userId: selectedId,
					date: quickMes.date,
					// Seuls les champs SAISIS partent à l'upsert — les autres sont conservés.
					...(waist !== undefined ? { waistCm: waist } : {}),
					...(hip !== undefined ? { hipCm: hip } : {}),
					...(neck !== undefined ? { neckCm: neck } : {}),
				}),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? 'Enregistrement impossible.');
			await loadMeasurements();
			await invalidateAll();
			quickSheet = null;
		} catch (e) {
			quickMsg = e instanceof Error ? e.message : 'Enregistrement impossible.';
		} finally {
			quickBusy = false;
		}
	}

	/* ── Photos ────────────────────────────────────────────────── */
	const PHOTO_STEP_LABELS: Record<string, string> = {
		demarrage: 'Démarrage',
		mois1: 'Mois 1',
		mois2: 'Mois 2',
		mois3: 'Mois 3',
		mois4: 'Mois 4',
		mois5: 'Mois 5',
		mois6: 'Mois 6',
	};
	const totalPhotos = $derived(photos.reduce((s: number, g: { photos: unknown[] }) => s + g.photos.length, 0));

	/* ── Cockpit hebdo de l'onglet Bilans (calculé côté Convex, même période que le bilan) ── */
	const cockpit = $derived(view?.cockpit ?? null);
	/** Bloc Dépense sportive (source : client360.sport) — nullable-safe :
	 *  les anciens cachets serveur sans ce bloc sont tolérés. */
	type SportBlock = {
		weekStart: string;
		activities: number;
		durationMin: number;
		kcal: number;
		metMinutes: number;
		manualCount: number;
		trainingCount: number;
		trend: 'up' | 'down' | 'stable' | null;
		previous: { weekStart: string; durationMin: number; kcal: number }[];
	};
	const sport360 = $derived(((cockpit as Record<string, unknown> | null)?.sport ?? null) as SportBlock | null);
	/** Encart « Aperçu » : mêmes données que la carte Bilans, mais semaine
	 *  calendaire courante (indépendante du dernier bilan). La carte Bilans
	 *  garde `sport360` (semaine du bilan) — les deux se complètent. */
	const sportOverview = $derived((data.sport360Overview ?? null) as SportBlock | null);
	/** Série des 7 derniers jours (pas) pour le mini-graphique — mêmes données que la cliente. */
	const stepsLast7 = $derived((view?.stepsLast7 ?? []) as { date: string; count: number | null }[]);
	/** Initiales L→D de la série (lundi → dimanche de la fenêtre affichée). */
	const stepsLetters = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
	const weekPhotos = $derived.by(() => {
		if (!cockpit) return null;
		const groups = (photos ?? []).filter(
			(g: { date: string }) => g.date >= cockpit.weekStart && g.date <= cockpit.weekEnd
		);
		const n = groups.reduce((s: number, g: { photos: unknown[] }) => s + g.photos.length, 0);
		return n > 0 ? { count: n } : null;
	});		/** Protéines du cockpit — moyenne LIVE sur les MÊMES jours exploitables
	    que les calories (une seule définition d'une journée complète, garde-
	    fou alimentaire). Repli local sur view.week pour un cachet ancien. */
	const proteinCard = $derived.by(() => {
		const served = cockpit?.protein;
		const goal = served?.goal ?? view?.goals?.protein ?? 90;
		if (served) return { avg: served.avg, goal, trackedDays: served.trackedDays, partialExcluded: served.partialExcluded ?? 0 };
		const week = (view?.week ?? []) as { protein: number; count: number }[];
		const tracked = week.filter((d) => d.count > 0);
		if (tracked.length === 0) return { avg: null, goal, trackedDays: 0, partialExcluded: 0 };
		const sum = tracked.reduce((s, d) => s + d.protein, 0);
		return { avg: Math.round(sum / tracked.length), goal, trackedDays: tracked.length, partialExcluded: 0 };
	});
	/** Dépense sportive LIVE : 7 journées complètes (J-7 → J-1) — activité
	    d'aujourd'hui jamais incluse (partielle). Repli : bloc semaines. */
	const sport7 = $derived((view?.sport7 ?? null) as { activities: number; durationMin: number; kcal: number; metMinutes: number; manualCount: number; trainingCount: number } | null);
	const sportCard = $derived(sport7 ?? sport360);
	/** Dates des deux pesées comparées (Vision 360 Poids). */
	const weightLast = $derived((cockpit?.weight?.last ?? null) as { date: string; weightKg: number } | null);
	const weightPrevLast = $derived((cockpit?.weight?.prevLast ?? null) as { date: string; weightKg: number } | null);
	const cockpitPill = $derived.by(() => {
		const b = cockpit?.bilan ?? null;
		if (!b) return null;
		if (b.status === 'retour_envoye') {
			// Comme WhatsApp : non lu tant que la cliente n'a pas ouvert le retour.
			const unread = b.readAt == null || b.readAt < (b.feedbackAt ?? b.receivedAt);
			return unread
				? { label: 'Retour publié · non lu', cls: 'bg-warn-light text-warn' }
				: { label: 'Retour lu', cls: 'bg-brand-light text-brand-dark' };
		}
		if (b.draft) return { label: 'Brouillon', cls: 'bg-line/70 text-mist' };
		return { label: 'À traiter', cls: 'bg-warn-light text-warn' };
	});
	function fmtVal(n: number): string {
		return String(Math.round(n * 10) / 10).replace('.', ',');
	}
	function fmtRangeShort(iso: string): string {
		return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
	}
	function fmtDaysAgo(n: number): string {
		if (n <= 0) return "aujourd'hui";
		if (n === 1) return 'hier';
		return `il y a ${n} jours`;
	}
	function fmtDateTime(ts: number): string {
		return new Date(ts).toLocaleString('fr-FR', { weekday: 'long', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
	}
	/** Date ISO courte pour un RDV (date seule, sans heure) — ex. « ven. 25 sept. ». */
	function fmtRdvDate(iso: string): string {
		return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
	}
	/** Date ISO décalée de n jours (même clé locale que le reste de la page). */
	function addDaysISO(n: number): string {
		const d = new Date();
		d.setDate(d.getDate() + n);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}
	/** Date du dernier envoi photo (toutes périodes) — « Dernier envoi : le … ». */
	const lastPhotoDate = $derived(
		(photos as { date: string }[]).reduce<string | null>((max, g) => (max === null || g.date > max ? g.date : max), null)
	);

	/* Quand on ouvre le tiroir 360°, on précharge le journal + les mesures. */
	$effect(() => {
		const id = selectedId;
		if (id) {
			// untrack : seuls les changements de client doivent relancer ce
			// préchargement. Sans cela, lire journalDate/day via loadDay() ferait
			// repartir l'effet à chaque changement de date → la journée revenait
			// toujours à aujourd'hui et les requêtes s'empilaient (état « chargement »).
			untrack(() => {
				journalDate = todayISO();
				initBodyDrafts();
				loadDay();
				loadMeasurements();
			});
		}
	});

	/* ── Plan de repas (assignation coach → cliente) ──────────── */
	type PlanRow = { _id: string; name: string; totalKcal: number; updatedAt: number; clients: number };
	type AssignmentRow = {
		_id: string;
		templateId: string;
		templateName: string;
		totalKcal: number;
		startDate: string;
		endDate: string;
		weekdays: number[];
		removedAt: number | null;
	};
	let plansList = $state<PlanRow[]>([]);
	let assignments = $state<AssignmentRow[]>([]);
	let planLoading = $state(false);
	let planMsg = $state('');
	let assignOpen = $state(false);
	let assignTemplateId = $state('');
	let assignStart = $state(todayISO());
	let assignEnd = $state('');
	let assignDays = $state<number[]>([1, 2, 3, 4, 5, 6, 7]);
	let assignBusy = $state(false);
	const DAY_LABELS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']; // index 0 = lundi
	const activeAssignment = $derived(assignments.find((a) => !a.removedAt) ?? null);

	async function loadPlans() {
		planLoading = true;
		try {
			const [pr, ar] = await Promise.all([
				fetch('/api/coach/meal-plans').then((r) => r.json()),
				selectedId ? fetch(`/api/coach/meal-plan-assignments?userId=${selectedId}`).then((r) => r.json()) : Promise.resolve([]),
			]);
			plansList = pr.error ? [] : pr;
			assignments = Array.isArray(ar) ? ar : [];
			// Pré-sélection : plan visé via ?client-plan=… (bouton « Assigner » de la bibliothèque)
			const wanted = page.url.searchParams.get('client-plan');
			if (wanted && plansList.some((p) => p._id === wanted)) {
				assignTemplateId = wanted;
				assignOpen = true;
			}
		} catch {
			/* silencieux */
		} finally {
			planLoading = false;
		}
	}

	function toggleAssignDay(d: number) {
		assignDays = assignDays.includes(d) ? assignDays.filter((x) => x !== d) : [...assignDays, d].sort();
	}

	async function confirmAssign() {
		if (!selectedId || !assignTemplateId) return;
		assignBusy = true;
		planMsg = '';
		try {
			const r = await fetch('/api/coach/meal-plan-assignments', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					userId: selectedId,
					templateId: assignTemplateId,
					startDate: assignStart,
					endDate: assignEnd || assignStart,
					weekdays: assignDays.length === 7 ? undefined : assignDays,
				}),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			assignOpen = false;
			planMsg = 'Plan assigné — les aliments apparaissent dans le journal aux dates concernées (état planifié, gris).';
			await loadPlans();
		} catch (e) {
			planMsg = e instanceof Error ? e.message : 'Assignation impossible.';
		} finally {
			assignBusy = false;
		}
	}

	async function removePlan(assignmentId: string) {
		if (!confirm('Retirer le plan ? Les propositions futures disparaissent du journal — historique et données déjà consommées restent intacts, les planifications personnelles de ta cliente sont conservées.')) return;
		try {
			const r = await fetch(`/api/coach/meal-plan-assignments?assignmentId=${assignmentId}`, { method: 'DELETE' });
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			planMsg = 'Plan retiré.';
			await loadPlans();
		} catch (e) {
			planMsg = e instanceof Error ? e.message : 'Retrait impossible.';
		}
	}

	function fmtISO(iso: string) {
		return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
	}

	/* ── Sections du tiroir 360° ───────────────────────────────── */
	let section = $state('apercu');

	const sectionTabs = $derived([
		{ id: 'apercu', label: 'Vision 360' },
		{ id: 'journal', label: 'Journal' },
		{ id: 'plan', label: 'Plan de repas' },
		{ id: 'entrainement', label: 'Entraînement' },
		{ id: 'corps', label: 'Poids & mesures' },
		{ id: 'photos', label: `Photos (${totalPhotos})` },
		{ id: 'bilans', label: 'Bilans' },
		{ id: 'rdv', label: 'Rendez-vous' },
		{ id: 'dossier', label: 'Drive' },
		{ id: 'demarrage', label: 'Démarrage' },
	]);

	/** Bloc « Accès rapide » (Vision 360) : navigation directe vers les onglets
	 *  métier — simple raccourci UI, aucune donnée ni action ajoutée. */
	const quickAccess = [
		{ id: 'journal', label: 'Journal alimentaire', icon: 'bookOpen' },
		{ id: 'plan', label: 'Plan de repas', icon: 'utensils' },
		{ id: 'entrainement', label: "Programme d'entraînement", icon: 'dumbbell' },
		{ id: 'corps', label: 'Poids & mesures', icon: 'scale' },
		{ id: 'photos', label: 'Photos', icon: 'camera' },
		{ id: 'bilans', label: 'Bilans hebdomadaires', icon: 'clipboardList' },
		{ id: 'rdv', label: 'Rendez-vous', icon: 'calendarDays' },
		{ id: 'dossier', label: 'Drive & documents', icon: 'cloud' },
		{ id: 'demarrage', label: 'Formulaire de démarrage', icon: 'rocket' },
	] as const;

	// Deep-link : un lien de la file des bilans ouvre le 360° directement sur
	// l'onglet Bilans (?section=bilans). Un simple clic d'onglet reste libre.
	$effect(() => {
		const fromUrl = page.url.searchParams.get('section');
		if (fromUrl && sectionTabs.some((t) => t.id === fromUrl)) {
			section = fromUrl;
		}
	});

	/* ── Navigation Vision 360° ↔ tableau de bord ────────────────
	   Navigation CLIENT (goto, jamais window.location) : le tableau de bord
	   n'est jamais démonté → la recherche (query) et le tri survivent, et
	   noScroll préserve la position de scroll à l'ouverture comme au retour. */
	let dashScrollY = 0;
	async function openClient(clientId: string) {
		dashScrollY = window.scrollY;
		await goto(`/admin?client=${clientId}`, { noScroll: true });
	}
	/** Ferme la Vision 360° et revient au tableau de bord (même scroll, même recherche). */
	async function closeVision() {
		const q = new URLSearchParams(page.url.searchParams);
		q.delete('client');
		q.delete('section');
		const qs = q.toString();
		await goto(qs ? `/admin?${qs}` : '/admin', { noScroll: true });
		await tick();
		if (Math.abs(window.scrollY - dashScrollY) > 1) window.scrollTo(0, dashScrollY);
	}

	/* Onglet Plan de repas : chargé à l'ouverture du tiroir (changement de cliente). */
	$effect(() => {
		const id = selectedId;
		if (!id) return;
		untrack(() => loadPlans());
	});

	/* ── Onglet Rendez-vous (Vision 360) — la cliente est DÉJÀ connue : le
	   clientId de la fiche ouverte est la source de vérité (§11). Aucun champ
	   identité (nom, prénom, téléphone, email) n'est jamais demandé. ── */
	type RdvRow = {
		_id: string;
		clientId: string;
		date: string;
		time: string;
		endTime: string;
		kind: string;
		status: 'on_book' | 'client_request' | 'cancelled';
		bookedByName: string | null;
		bookingSource: 'coach' | 'client' | null;
		rescheduleCount: number;
		googleEventId: string | null;
	};
	const RDV_KINDS = ['Suivi', 'Démarrage']; // seuls types réservables (§6)
	function rdvToMin(h: string): number {
		const [hh, mm] = h.split(':');
		return Number(hh) * 60 + Number(mm);
	}
	function rdvFromMin(m: number): string {
		return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
	}
	let rdvList = $state<RdvRow[]>([]);
	let rdvLoading = $state(false);
	let rdvNotice = $state('');
	let rdvErr = $state('');
	let rdvKind = $state<string>('Suivi');
	let rdvDate = $state('');
	let rdvSlots = $state<{ start: string; end: string }[]>([]);
	let rdvSlotsLoading = $state(false);
	let rdvMoving = $state<RdvRow | null>(null); // RDV en cours de replanification

	/**
	 * Chargement STRICTEMENT filtré par cliente (§1) : la requête serveur
	 * (`?userId=` → index by_client côté Convex) renvoie UNIQUEMENT les RDV
	 * de la cliente ouverte — jamais une liste globale masquée côté UI.
	 */
	async function loadRdvs() {
		const id = selectedId;
		if (!id) return;
		rdvLoading = true;
		rdvErr = '';
		try {
			const r = await fetch(`/api/appointments?userId=${encodeURIComponent(id)}`).then((x) => x.json());
			if (r.error) throw new Error(r.error);
			rdvList = r.appointments ?? [];
		} catch (e) {
			rdvErr = e instanceof Error ? e.message : 'Chargement impossible.';
		} finally {
			rdvLoading = false;
		}
	}
	$effect(() => {
		const id = selectedId;
		if (!id) return;
		untrack(() => loadRdvs());
	});

	const rdvNext = $derived(
		rdvList
			.filter((r) => r.status === 'on_book' && `${r.date}T${r.time}` >= `${toISO(new Date())}T00:00`)
			.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0] ?? null
	);
	const rdvHistory = $derived(
		rdvList.filter((r) => r.status === 'cancelled' || `${r.date}T${r.time}` < `${toISO(new Date())}T00:00`)
	);

	/** Créneaux du MOTEUR (plages − Google − RDV − buffers, durée selon type). */
	async function loadRdvSlots() {
		if (!rdvDate) return;
		rdvSlotsLoading = true;
		rdvErr = '';
		rdvSlots = [];
		try {
			const p = new URLSearchParams({ date: rdvDate, type: rdvKind });
			if (rdvMoving) p.set('excludeId', rdvMoving._id);
			const j = await fetch(`/api/appointments/availability?${p.toString()}`).then((x) => x.json());
			if (j.error) throw new Error(j.error);
			rdvSlots = j.days?.[0]?.slots ?? [];
		} catch (e) {
			rdvErr = e instanceof Error ? e.message : 'Disponibilités indisponibles.';
		} finally {
			rdvSlotsLoading = false;
		}
	}

	async function rdvBook(date: string, time: string) {
		const id = selectedId;
		if (!id) return;
		rdvErr = '';
		try {
			const res = await fetch('/api/appointments', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					clientId: id,
					clientName: fullName(selected!.user),
					date,
					time,
					endTime: rdvFromMin(rdvToMin(time) + kindRule(rdvKind).durationMin),
					kind: rdvKind,
				}),
			});
			const j = await res.json();
			if (!res.ok) throw new Error(j.error ?? j.message ?? 'Erreur');
			rdvNotice = j.googleEventId ? 'Rendez-vous confirmé + ajouté à Google Calendar ✓' : 'Rendez-vous confirmé (Google Calendar non connecté — événement non créé).';
			rdvDate = '';
			rdvSlots = [];
			await loadRdvs();
		} catch (e) {
			rdvErr = e instanceof Error ? e.message : 'Erreur';
			// Créneau pris entre-temps (2e vérification serveur) → message exact +
			// recharge immédiate des créneaux réels.
			if (e instanceof Error && e.message === SLOT_TAKEN_MESSAGE) {
				rdvErr = SLOT_TAKEN_MESSAGE;
				if (rdvDate) void loadRdvSlots();
			}
		}
	}
	async function rdvMove(date: string, time: string) {
		if (!rdvMoving) return;
		rdvErr = '';
		try {
			const res = await fetch(`/api/appointments/${rdvMoving._id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					date,
					time,
					endTime: rdvFromMin(rdvToMin(time) + kindRule(rdvMoving.kind).durationMin),
				}),
			});
			const j = await res.json();
			if (!res.ok) throw new Error(j.error);
			rdvNotice = j.googleEventId ? 'Rendez-vous replanifié — même événement Google déplacé ✓' : 'Rendez-vous replanifié ✓';
			rdvMoving = null;
			rdvDate = '';
			rdvSlots = [];
			await loadRdvs();
		} catch (e) {
			rdvErr = e instanceof Error ? e.message : 'Erreur';
		}
	}
	async function rdvCancel(r: RdvRow) {
		rdvErr = '';
		try {
			const res = await fetch(`/api/appointments/${r._id}`, { method: 'DELETE' });
			const j = await res.json();
			if (!res.ok) throw new Error(j.error);
			rdvNotice = 'Rendez-vous annulé — créneau libéré.';
			await loadRdvs();
		} catch (e) {
			rdvErr = e instanceof Error ? e.message : 'Erreur';
		}
	}
</script>

<svelte:head><title>Espace Coach — G-Flux</title></svelte:head>
<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && quickSheet) quickSheet = null; }} />

<!-- ══════════ TOP HEADER COCKPIT (PASS 2 — mockup) ══════════
     Salutation + sous-titre à gauche · recherche cliente / cloche notifications
     / coach à droite. Réutilise `query` (liste clientes) et le badge existant —
     aucun backend ajouté. -->
<header class="topbar-crm m-in-crm flex flex-wrap items-center justify-between gap-3" style="--m-i: 0">
	<div class="min-w-0">
		<h1 class="h1-crm text-[1.55rem] sm:text-[1.8rem]">{dashTitle}</h1>
		<p class="mt-0.5 text-sm font-medium text-mist">Voici ce qui demande ton attention aujourd'hui.{#if dashLive}&nbsp;<span class="hidden lg:inline">· {dashDateLine}</span>{/if}</p>
	</div>
	<div class="ml-auto flex items-center gap-2 sm:gap-2.5">
		<label class="relative hidden sm:block">
			<span class="sr-only">Rechercher une cliente</span>
			<Icon name="search" size={15} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mist" />
			<input
				type="search"
				bind:value={query}
				placeholder="Rechercher une cliente (nom, email)…"
				class="w-44 rounded-xl border border-line bg-white py-2 pl-9 pr-3 text-sm text-ink outline-none transition placeholder:text-mist focus:border-brand md:w-56"
			/>
		</label>
		<a
			href="/admin/notifications"
			aria-label="Notifications"
			title="Notifications"
			class="btn-crm relative grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line bg-white text-ink transition hover:border-brand hover:text-brand"
		>
			<Icon name="bell" size={17} />
			{#if Number(data.notificationsBadge ?? 0) > 0}
				<span class="badge-in absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-warn px-1 text-[10px] font-bold text-white ring-2 ring-white">{Number(data.notificationsBadge)}</span>
			{/if}
		</a>
		<div class="flex shrink-0 items-center gap-2.5 rounded-full border border-line bg-white py-1 pl-1 pr-3">
			<label class="group relative block h-8 w-8 shrink-0 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brand" title="Changer la photo de profil">
				<span class="sr-only">Changer la photo de profil</span>
				{#if coachAvatar}
					<img src={coachAvatar} alt="Avatar de {dashGreetingPrenom}" class="h-8 w-8 rounded-full object-cover ring-1 ring-line" />
				{:else}
					<span class="grid h-8 w-8 place-items-center rounded-full bg-brand text-[13px] font-black text-white">{initial(dashGreetingPrenom)}</span>
				{/if}
				<!-- Indicateur d'édition discret -->
				<span class="absolute -bottom-0.5 -right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-white text-ink shadow-sm ring-1 ring-line transition group-hover:bg-brand group-hover:text-white" aria-hidden="true">
					<Icon name="camera" size={8} strokeWidth={2.8} />
				</span>
				<input type="file" accept="image/*" class="hidden" onchange={handleAvatarPick} />
			</label>
			<span class="hidden min-w-0 leading-tight md:block">
				<span class="block truncate text-[13px] font-bold text-ink">{dashGreetingPrenom}</span>
				<span class="block text-[10.5px] font-medium text-mist">Coach G-FLUX</span>
			</span>
		</div>
	</div>
</header>


<!-- ══════════ KPI CARDS (PASS 2 — tuile XL + sparkline, mockup) ══════════
     Valeurs réelles existantes ; sparklines décoratives (pur CSS). -->
<section class="m-in-crm mt-1 grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4" style="--m-i: 2">
	<div class="kpi-crm kpi-crm-plain card-crm-hover" style="--kpi-tile-bg: var(--accent-light); --kpi-tile-fg: var(--brand-deep); --m-i: 0">
		<div class="flex items-start justify-between gap-2">
			<span class="kpi-tile-lg"><Icon name="users" size={20} /></span>
			<span class="spark-crm" aria-hidden="true" style="--spark-color: rgba(29, 185, 84, 0.5)">
				<i style="--h: 30; --m-i: 0"></i><i style="--h: 46; --m-i: 1"></i><i style="--h: 38; --m-i: 2"></i><i style="--h: 62; --m-i: 3"></i><i style="--h: 54; --m-i: 4"></i><i style="--h: 80; --m-i: 5"></i><i style="--h: 100; --m-i: 6"></i>
			</span>
		</div>
		<div class="kpi-num-crm mt-2.5 text-[2rem] text-ink"><CountUp value={dashKpiClients} /></div>
		<div class="mt-0.5 text-[13px] font-bold text-ink">clientes</div>
		<div class="mt-2 flex items-center gap-1.5 border-t border-line/60 pt-2 text-[11.5px] text-mist">
			<span class="inline-flex items-center gap-1 font-bold text-brand-deep"><Icon name="trendingUp" size={12} /> {dashKpiActive}</span>
			<span>active{dashKpiActive > 1 ? 's' : ''} aujourd'hui</span>
		</div>
	</div>
	<div class="kpi-crm kpi-crm-plain card-crm-hover" style="--kpi-tile-bg: var(--accent-light); --kpi-tile-fg: var(--brand-deep); --m-i: 1">
		<div class="flex items-start justify-between gap-2">
			<span class="kpi-tile-lg"><Icon name="trendingUp" size={20} /></span>
			<span class="spark-crm" aria-hidden="true" style="--spark-color: rgba(29, 185, 84, 0.5)">
				<i style="--h: 42; --m-i: 0"></i><i style="--h: 58; --m-i: 1"></i><i style="--h: 50; --m-i: 2"></i><i style="--h: 70; --m-i: 3"></i><i style="--h: 88; --m-i: 4"></i><i style="--h: 76; --m-i: 5"></i><i style="--h: 100; --m-i: 6"></i>
			</span>
		</div>
		<div class="kpi-num-crm mt-2.5 text-[2rem] text-ink"><CountUp value={dashKpiActive} /></div>
		<div class="mt-0.5 text-[13px] font-bold text-ink">actives aujourd'hui</div>
		<div class="mt-2 flex items-center gap-1.5 border-t border-line/60 pt-2 text-[11.5px] text-mist">
			<span class="inline-flex items-center gap-1 font-bold text-brand-deep"><Icon name="trendingUp" size={12} /> {dashKpiClients > 0 ? Math.round((dashKpiActive / dashKpiClients) * 100) : 0} %</span>
			<span>de ton total</span>
		</div>
	</div>
	<div class="kpi-crm kpi-crm-plain card-crm-hover" style="--kpi-tile-bg: var(--warn-light); --kpi-tile-fg: var(--warn); --m-i: 2">
		<div class="flex items-start justify-between gap-2">
			<span class="kpi-tile-lg"><Icon name="clipboardCheck" size={20} /></span>
			<span class="spark-crm" aria-hidden="true" style="--spark-color: rgba(255, 149, 0, 0.55)">
				<i style="--h: 90; --m-i: 0"></i><i style="--h: 45; --m-i: 1"></i><i style="--h: 70; --m-i: 2"></i><i style="--h: 100; --m-i: 3"></i><i style="--h: 60; --m-i: 4"></i><i style="--h: 82; --m-i: 5"></i><i style="--h: 50; --m-i: 6"></i>
			</span>
		</div>
		<div class="kpi-num-crm mt-2.5 text-[2rem] text-ink"><CountUp value={dashKpiWaiting} /></div>
		<div class="mt-0.5 text-[13px] font-bold text-ink">retours à envoyer</div>
		<div class="mt-2 flex items-center gap-1.5 border-t border-line/60 pt-2 text-[11.5px] text-mist">
			{#if dashKpiWaiting > 0}
				<span class="inline-flex items-center gap-1 font-bold text-warn"><Icon name="clock" size={12} /> À traiter aujourd'hui</span>
			{:else}
				<span class="inline-flex items-center gap-1 font-bold text-brand-deep"><Icon name="circleCheck" size={12} /> Tout est traité ✓</span>
			{/if}
		</div>
	</div>
	<div class="kpi-crm kpi-crm-plain card-crm-hover" style="--kpi-tile-bg: var(--accent-light); --kpi-tile-fg: var(--brand-deep); --m-i: 3">
		<div class="flex items-start justify-between gap-2">
			<span class="kpi-tile-lg"><Icon name="calendarCheck" size={20} /></span>
			<span class="spark-crm" aria-hidden="true" style="--spark-color: rgba(29, 185, 84, 0.5)">
				<i style="--h: 45; --m-i: 0"></i><i style="--h: 60; --m-i: 1"></i><i style="--h: 35; --m-i: 2"></i><i style="--h: 70; --m-i: 3"></i><i style="--h: 50; --m-i: 4"></i><i style="--h: 85; --m-i: 5"></i><i style="--h: 65; --m-i: 6"></i>
			</span>
		</div>
		<div class="kpi-num-crm mt-2.5 text-[2rem] text-ink"><CountUp value={kpiRdvToday.length} /></div>
		<div class="mt-0.5 text-[13px] font-bold text-ink">rendez-vous du jour</div>
		<div class="mt-2 flex items-center gap-1.5 border-t border-line/60 pt-2 text-[11.5px] text-mist">
			{#if kpiRdvLoading}
				<span>Chargement des rendez-vous…</span>
			{:else if kpiRdvToday.length === 0}
				<a href="/admin/rendez-vous" class="inline-flex items-center gap-1 transition hover:text-brand"><Icon name="calendarRange" size={12} /> Aucun rendez-vous aujourd'hui</a>
			{:else}
				<a href="/admin/rendez-vous" class="inline-flex min-w-0 items-center gap-1 font-bold text-brand-deep transition hover:text-brand"><Icon name="clock" size={12} class="shrink-0" /> Prochain : {kpiRdvToday[0].time}{#if kpiRdvToday[0].clientName}&nbsp;· <span class="truncate">{kpiRdvToday[0].clientName}</span>{/if}</a>
			{/if}
		</div>
	</div>
</section>

<!-- ══════════ GRILLE COCKPIT (PASS 2) : GAUCHE = À traiter · DROITE = Google Calendar + Message global ══════════ -->
<div class="m-in-crm mt-1 grid items-start gap-3.5 xl:grid-cols-12" style="--m-i: 3">
	<!-- Colonne gauche : À traiter aujourd'hui -->
	<div class="min-w-0 xl:col-span-5">
		<section class="card-crm p-4">
			<div class="flex items-center justify-between gap-2">
				<h2 class="h2-crm flex items-center gap-2 text-[15px]">
					<span class="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-white"><Icon name="check" size={13} strokeWidth={3} /></span>
					À traiter aujourd'hui
				</h2>
				<a href="/admin/bilans" class="btn-crm inline-flex items-center gap-1 rounded-full border border-line bg-white px-2 py-0.5 text-[11px] font-bold text-ink transition hover:border-brand hover:text-brand">
					Voir tout <Icon name="arrowRight" size={12} />
				</a>
			</div>
			{#if dashTodos.length === 0}
				<p class="mt-3 rounded-xl border border-dashed border-line px-4 py-5 text-center text-[13px] text-mist">Rien à traiter — toutes tes clientes sont à jour ✓</p>
			{:else}
				<div class="mt-3 grid gap-1.5">
					{#each dashTodos as t, i (t.key)}
						<a href={t.href} class="todo-row-crm group" style={`transition-delay: ${i * 25}ms`}>
							<span class="todo-tile-crm {t.tone === 'warn' ? 'bg-warn-light text-warn' : t.tone === 'danger' ? 'bg-danger-light text-danger' : t.tone === 'blue' ? 'bg-soft text-ink' : 'bg-brand-light text-brand-deep'}">
								<Icon name={t.icon} size={14} />
							</span>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-[13px] font-bold text-ink">{t.title}</span>
								<span class="block truncate text-[11px] text-mist">{t.subtitle}</span>
							</span>
							<span class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold {t.tone === 'warn' ? 'bg-warn-light text-warn' : t.tone === 'danger' ? 'bg-danger-light text-danger' : t.tone === 'blue' ? 'bg-soft text-ink' : 'bg-brand-light text-brand-deep'}">{t.toneLabel}</span>
							<Icon name="chevronRight" size={14} class="shrink-0 text-mist transition group-hover:translate-x-0.5 group-hover:text-brand" />
						</a>
					{/each}
				</div>
				{#if dashTodos.length >= 3}
					<a href="/admin/bilans" class="mt-2.5 block text-center text-[11.5px] font-bold text-mist transition hover:text-brand">Voir tout →</a>
				{/if}
			{/if}
		</section>
	</div>

	<!-- Colonne droite : Google Calendar (haut) + Message global (bas) -->
	<div class="min-w-0 grid gap-3.5 xl:col-span-7">
		{#if alert && !(selected && view)}
			<div class="flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm {alert.error ? 'border-danger/40 bg-danger-light text-danger' : 'border-brand/40 bg-brand-light text-ink'}">
				<span>{alert.error ?? alert.ok}</span>
				<Icon name="info" size={15} class="shrink-0 text-mist" />
			</div>
		{/if}
		{#if googleBanner}
			<div class="flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm {googleBanner.startsWith('google-error') ? 'border-danger/40 bg-danger-light text-danger' : 'border-brand/40 bg-brand-light text-ink'}">
				<span>
					{#if googleBanner === 'google-ok'}
						<strong>Google Calendar connecté ✓</strong> — les rendez-vous peuvent être synchronisés avec ton agenda.
					{:else}
						<strong>Connexion Google échouée :</strong> {googleBanner.slice('google-error:'.length)}
					{/if}
				</span>
				<Icon name={googleBanner.startsWith('google-error') ? 'info' : 'calendarCheck'} size={15} class="shrink-0 text-mist" />
			</div>
		{/if}

		<!-- ══ Google Calendar (compte du coach) — logique conservée, carte cockpit ══ -->			<section class="card-crm p-4">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<div class="flex min-w-0 items-center gap-2">
						<h2 class="h2-crm flex items-center gap-2 text-[15px]"><Icon name="calendarCheck" size={16} class="shrink-0 text-brand" /> Google Calendar</h2>
					{#if google}
						<span class="rounded-full bg-brand px-2 py-0.5 text-[10.5px] font-bold text-white">Connecté ✓</span>
					{:else}
						<span class="rounded-full bg-cream px-2 py-0.5 text-[10.5px] font-bold text-mist">Non connecté</span>
					{/if}
				</div>
				{#if google}
					<button
						type="button"
						onclick={googleDisconnect}
						disabled={googleBusy}
						class="btn-crm rounded-full border border-line bg-white px-3 py-1.5 text-[12px] font-bold text-ink transition hover:border-danger hover:text-danger disabled:opacity-50"
					>Gérer</button>
				{:else}
					<a
						href="/api/google/connect"
						class="btn-crm inline-flex items-center gap-1 rounded-full bg-brand px-3.5 py-1.5 text-[12px] font-bold text-white transition hover:bg-brand-dark"
					><Icon name="calendarRange" size={13} class="shrink-0" /> Connecter</a>
				{/if}
			</div>
			<div class="mt-2.5 flex items-center gap-3 rounded-xl bg-soft/70 px-3 py-2.5">
				<img src="/img/google-calendar.svg" alt="Logo Google Calendar" class="h-9 w-9 shrink-0" />
				<div class="min-w-0">
					<p class="truncate text-[13px] font-bold text-ink">{google ? (google.email || 'Compte Google connecté') : 'Compte Google non connecté'}</p>
					<p class="text-[11.5px] text-mist">{google ? 'Tes rendez-vous sont synchronisés automatiquement.' : 'Connecte ton agenda pour synchroniser tes rendez-vous.'}</p>
				</div>
			</div>
			{#if google}
				<p class="mt-1.5 text-[10px] text-mist">Tokens chiffrés côté serveur · déconnexion possible à tout moment.</p>
			{/if}
		</section>

		<!-- ══ Message global — mêmes actions, composition compacte ══
		     Côté cliente, rien ne change : la notification, la carte « Message de ton
		     coach » et l'historique sont exactement ceux d'un message classique. -->			<section class="card-crm p-4">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<h2 class="h2-crm flex items-center gap-2 text-[15px]"><Icon name="messageCircle" size={16} class="shrink-0 text-brand" /> Message global <span class="text-[10.5px] font-medium text-mist">(optionnel)</span></h2>
					<a href="/admin/templates" class="btn-crm rounded-full border border-line bg-white px-2 py-0.5 text-[11px] font-bold text-ink transition hover:border-brand hover:text-brand">Voir les modèles</a>
				</div>

			{#if globalMessage}
				<!-- Envoi en cours : statut + retrait immédiat (disparaît seul après 24 h) -->
				<div class="mt-2 rounded-xl border border-brand/40 bg-brand-light/50 p-2.5">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<div class="flex flex-wrap items-center gap-2">
							<span class="rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Envoi en cours</span>
							<span class="text-[11px] text-mist">Publié {fmtDateTime(globalMessage.publishedAt)} · {globalMessage.recipientCount} destinataire{globalMessage.recipientCount > 1 ? 's' : ''} · {globalMessage.readCount} lu{globalMessage.readCount > 1 ? 's' : ''}</span>
						</div>
						<form
							method="POST"
							action="?/withdrawGlobalMessage"
							onsubmit={(e) => {
								if (!confirm('Retirer le message global de l\'accueil de toutes les clientes, maintenant ?')) e.preventDefault();
							}}
						>
							<button type="submit" class="rounded-lg border-2 border-line bg-white px-2.5 py-1 text-[11.5px] font-semibold text-ink transition hover:border-danger hover:text-danger">
								Retirer maintenant
							</button>
						</form>
					</div>
					<p class="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-ink">{globalMessage.text}</p>
					<p class="mt-1 text-[10.5px] text-mist"><Icon name="timer" size={11} class="mr-0.5 inline shrink-0" /> Disparaît automatiquement dans {fmtRemaining(globalRemainingMs)}.</p>
				</div>
			{:else}
				<!-- Aucun envoi actif : composeur (fermé tant qu'un message global est actif) -->
				<form method="POST" action="?/sendGlobalMessage" class="mt-2">
					<textarea
						name="message"
						rows="2"
						maxlength="500"
						placeholder="Message commun à toutes tes clientes…"
						class="min-h-0 w-full rounded-xl border border-line bg-white px-3 py-1.5 text-[13px] leading-snug text-ink outline-none transition placeholder:text-mist focus:border-brand"
					></textarea>
					<div class="mt-1.5 flex flex-wrap items-center justify-between gap-2">
						<span class="inline-flex min-w-0 items-center gap-1.5 text-[11px] text-mist">
							<Icon name="users" size={12} class="shrink-0" />
							Actives sur 5 jours ({active5d})
						</span>
						<button
							type="submit"
							disabled={active5d === 0}
							class="btn-crm inline-flex items-center gap-1 rounded-full bg-brand px-3 py-1.5 text-[12px] font-bold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
						>
							<Icon name="arrowRight" size={12} class="shrink-0" /> Envoyer à toutes
						</button>
					</div>
					<p class="mt-1 text-[10.5px] leading-relaxed text-mist">
						Visible 24 h max · notification identique · retire-le à tout moment.{#if active5d === 0} Aucune cliente active sur 5 jours — envoi désactivé.{/if}
					</p>
				</form>
			{/if}
		</section>
	</div>
</div>

<!-- ══════════ VUE RAPIDE DES CLIENTES (PASS 2) ══════════ -->
<section class="card-crm m-in-crm mt-3.5 overflow-hidden" style="--m-i: 4">
	<div class="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
		<div class="flex min-w-0 items-center gap-2.5">
			<span class="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand-light text-brand-deep"><Icon name="users" size={16} /></span>
			<h2 class="h2-crm text-base">Vue rapide des clientes</h2>
			<span class="badge-in rounded-full bg-brand-light px-2 py-0.5 text-[11px] font-bold text-brand-deep">{clientCounts.all}</span>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<label class="relative">
				<span class="sr-only">Rechercher une cliente</span>
				<Icon name="search" size={14} class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mist" />
				<input
					type="search"
					bind:value={query}
					placeholder="Rechercher une cliente…"
					class="w-44 rounded-full border border-line bg-white py-1.5 pl-8 pr-3 text-[13px] outline-none transition placeholder:text-mist focus:border-brand md:w-52"
				/>
			</label>
			<div class="flex items-center rounded-full border border-line bg-white p-0.5" role="group" aria-label="Filtrer les clientes">
				<button type="button" class="chip-crm {clientFilter === 'all' ? 'active-crm' : ''}" onclick={() => (clientFilter = 'all')} aria-pressed={clientFilter === 'all'}>Toutes</button>
				<button type="button" class="chip-crm {clientFilter === 'active' ? 'active-crm' : ''}" onclick={() => (clientFilter = 'active')} aria-pressed={clientFilter === 'active'}>Actives ({clientCounts.active})</button>
				<button type="button" class="chip-crm {clientFilter === 'inactive' ? 'active-crm' : ''}" onclick={() => (clientFilter = 'inactive')} aria-pressed={clientFilter === 'inactive'}>Inactives ({clientCounts.inactive})</button>
			</div>
			<details class="group relative">
				<summary class="btn-crm inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-[12.5px] font-bold text-white shadow-sm transition hover:bg-brand-dark">
					<Icon name="plus" size={14} strokeWidth={2.6} class="shrink-0" /> Ajouter une cliente
				</summary>
				<form method="POST" action="?/createClient" class="absolute right-0 top-11 z-20 w-80 rounded-2xl border border-line bg-white p-4 shadow-xl">
					<label class="mb-1 block text-xs font-bold uppercase tracking-wide text-mist" for="nc-prenom">Prénom</label>
					<input id="nc-prenom" name="prenom" required placeholder="Ex. Julie" class="mb-3 w-full rounded-xl border-2 border-line px-3 py-2 text-sm outline-none focus:border-brand" />
					<label class="mb-1 block text-xs font-bold uppercase tracking-wide text-mist" for="nc-email">Email (identifiant de connexion)</label>
					<input id="nc-email" name="email" type="email" required placeholder="julie@exemple.fr" class="mb-3 w-full rounded-xl border-2 border-line px-3 py-2 text-sm outline-none focus:border-brand" />
					<label class="mb-1 block text-xs font-bold uppercase tracking-wide text-mist" for="nc-pass">Mot de passe (8 caractères min.)</label>
					<input id="nc-pass" name="password" type="text" required minlength="8" placeholder="Choisi avec la cliente…" class="mb-4 w-full rounded-xl border-2 border-line px-3 py-2 text-sm outline-none focus:border-brand" />
					<button type="submit" class="w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark">Créer le compte</button>
				</form>
			</details>
		</div>
	</div>

	{#if filteredClients.length === 0}
		<p class="px-6 py-14 text-center text-sm text-mist">
			Aucune cliente{query.trim() || clientFilter !== 'all' ? ' trouvée' : ' pour l’instant'}.<br />Crée la première avec « Ajouter une cliente ».
		</p>
	{:else}
		<div class="table-wrap overflow-x-auto">
			<table class="tbl-crm w-full min-w-[860px] text-left">
				<thead>
					<tr>
						<th class="px-5 py-2.5">Cliente</th>
						<th class="px-3 py-2.5">Dernière connexion</th>
						<th class="px-3 py-2.5">Bilans</th>
						<th class="px-3 py-2.5">Retours</th>
						<th class="px-3 py-2.5">Dernier bilan</th>
						<th class="px-3 py-2.5">Statut</th>
						<th class="px-5 py-2.5 text-right">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each filteredClients as client (client.user._id)}
						<tr
							class="crow-crm border-b border-line/50 last:border-0"
							tabindex="0"
							role="link"
							onclick={() => openClient(client.user._id)}
							onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openClient(client.user._id); } }}
							aria-label={`Ouvrir la Vision 360° de ${fullName(client.user)}`}
						>
							<td class="px-5 py-2.5">
								<div class="flex items-center gap-3">
									<div class="avatar-crm h-9 w-9 text-sm">
										{initial(client.user.prenom)}
									</div>
									<div class="min-w-0">
										<div class="flex items-center gap-2">
											<span class="truncate font-bold text-ink">{fullName(client.user)}</span>
											<span class="presence-crm {isOnline(client.user.lastSeenAt) ? 'on' : ''}" title={isOnline(client.user.lastSeenAt) ? 'En ligne' : 'Hors ligne'}></span>
										</div>
										<div class="truncate text-[11px] text-mist">{client.user.email}</div>
									</div>
								</div>
							</td>
							<td class="whitespace-nowrap px-3 py-2.5 text-[13px] text-mist">{fmtLastSeen(client.user.lastSeenAt)}</td>
							<td class="px-3 py-2.5 text-[13px] font-semibold text-ink">{client.count}</td>
							<td class="px-3 py-2.5">
								{#if client.waiting > 0}
									<span class="badge-in grid h-5 min-w-5 place-items-center rounded-full bg-warn px-1.5 text-[11px] font-bold text-white">{client.waiting}</span>
								{:else}
									<span class="text-[13px] text-mist">—</span>
								{/if}
							</td>
							<td class="whitespace-nowrap px-3 py-2.5 text-[13px] text-mist">{client.latest?.weekLabel ?? '—'}</td>
							<td class="px-3 py-2.5">
								<span class="rounded-full px-2.5 py-1 text-[11.5px] font-bold {statusLabel(client.user.lastSeenAt).cls}">{statusLabel(client.user.lastSeenAt).label}</span>
							</td>
							<td class="px-5 py-2.5 text-right">
								<a
									href={`/admin?client=${client.user._id}`}
									onclick={(e) => { e.preventDefault(); openClient(client.user._id); }}
									class="btn-crm inline-flex items-center gap-1 rounded-full border border-line bg-white px-3 py-1.5 text-[12px] font-bold text-ink transition hover:border-brand hover:text-brand"
								>Vision 360 <Icon name="arrowRight" size={12} /></a>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>

<!-- ═══ Vision 360° : occupe TOUT l'espace restant à droite de la sidebar
	     CRM (md:pl-64 = largeur sidebar). Sur mobile, plein écran. ═══ -->
	{#if selected && view}
		<button type="button" class="fixed inset-0 z-50 cursor-pointer bg-ink/50 md:left-64" aria-label="Fermer la vue 360°" onclick={closeVision}></button>
		<aside class="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-cream shadow-2xl md:left-64 md:w-auto">
		<!-- Flèche retour : collée au bord GAUCHE de la fiche 360°, à mi-hauteur.
		     Le tiroir lui-même est fixed et ne défile jamais (seule la div
		     intérieure scrolle) → ce bouton reste visible pendant TOUT le scroll.
		     Mobile : entièrement dans l'écran ; desktop : à cheval sur la bordure. -->
		<button
			type="button"
			onclick={closeVision}
			class="absolute left-0 top-1/2 z-20 grid h-9 w-9 -translate-y-1/2 translate-x-2 place-items-center rounded-full border-2 border-line bg-card text-ink shadow-md transition hover:border-brand hover:text-brand md:-translate-x-1/2"
			aria-label="Retour au tableau de bord"
			title="Retour au tableau de bord"
		><Icon name="arrowLeft" size={16} /></button>
		<!-- En-tête du tiroir — premium (north star : docs/refonte-preview) : identité forte,
		     statut Active + infos rapides organisées (membre depuis / dernière connexion),
		     actions intégrées (Fiche / Mot de passe / Supprimer). -->
		<div class="m-in-crm flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-line bg-card px-5 py-4">
			<div class="flex min-w-0 items-center gap-3.5">
				<div class="avatar-crm h-14 w-14 shrink-0 text-xl text-white" style="background: linear-gradient(135deg, #21d05e, var(--brand-dark)); box-shadow: 0 4px 14px rgba(29, 185, 84, 0.3)">
					{initial(selected.user.prenom)}
				</div>
				<div class="min-w-0">
					<div class="flex flex-wrap items-center gap-2">
						<h2 class="truncate font-display text-[1.35rem] font-black leading-tight tracking-tight text-ink">{fullName(selected.user)}</h2>
						<span class="presence-crm {isOnline(selected.user.lastSeenAt) ? 'on' : ''}" title={isOnline(selected.user.lastSeenAt) ? 'En ligne' : 'Hors ligne'}></span>
						<span class="rounded-full px-2.5 py-1 text-[11px] font-bold {statusLabel(selected.user.lastSeenAt).cls}">{statusLabel(selected.user.lastSeenAt).label}</span>
					</div>
					<p class="mt-0.5 flex items-center gap-1.5 text-[12.5px] font-medium text-mist">
						<Icon name="mail" size={12} class="shrink-0" />
						<span class="truncate">{selected.user.email}</span>
					</p>
					<div class="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11.5px] font-medium text-mist">
						{#if ageOf != null}
							<span class="inline-flex items-center gap-1"><Icon name="cake" size={12} class="shrink-0" /> {ageOf} ans</span>
						{/if}
						{#if selected.user.heightCm}
							<span class="inline-flex items-center gap-1"><Icon name="ruler" size={12} class="shrink-0" /> {selected.user.heightCm} cm</span>
						{/if}
						{#if memberSince}
							<span class="inline-flex items-center gap-1"><Icon name="calendarDays" size={12} class="shrink-0" /> Membre depuis le {memberSince}</span>
						{/if}
						<span class="inline-flex items-center gap-1"><Icon name="clock3" size={12} class="shrink-0" /> Dernière connexion : {fmtLastSeen(selected.user.lastSeenAt)}</span>
					</div>
					{#if selected.user.gsheetUrl}
						<a
							href={selected.user.gsheetUrl}
							target="_blank"
							rel="noopener noreferrer"
							class="mt-1.5 inline-flex items-center gap-1 rounded-lg border border-brand/40 bg-brand-light/50 px-2 py-1 text-[11px] font-semibold text-brand-dark transition hover:border-brand hover:bg-brand-light"
						><Icon name="externalLink" size={12} class="shrink-0" /> Ouvrir le tableur G-FLUX</a>
					{/if}
				</div>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<details class="group relative">
					<summary class="flex cursor-pointer list-none items-center gap-1.5 rounded-xl border border-line bg-white px-3.5 py-2 text-[13px] font-bold text-ink shadow-sm transition hover:border-brand hover:text-brand"><Icon name="clipboardList" size={14} class="shrink-0 text-brand" /> Fiche</summary>
					<form method="POST" action="?/updateFiche&client={selected.user._id}&section={section}" class="absolute right-0 top-10 z-20 w-80 rounded-xl border border-line bg-white p-4 shadow-xl">
						<input type="hidden" name="userId" value={selected.user._id} />
						<label class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist" for="f-prenom">Prénom</label>
						<input id="f-prenom" name="prenom" required value={selected.user.prenom} class="mb-3 w-full rounded-lg border-2 border-line px-2 py-1.5 text-sm outline-none focus:border-brand" />
						<label class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist" for="f-nom">Nom</label>
						<input id="f-nom" name="nom" value={selected.user.nom ?? ''} placeholder="Ex. Dupont" class="mb-3 w-full rounded-lg border-2 border-line px-2 py-1.5 text-sm outline-none focus:border-brand" />
						<label class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist" for="f-email">Email (identifiant)</label>
						<input id="f-email" name="email" type="email" required value={selected.user.email} class="mb-3 w-full rounded-lg border-2 border-line px-2 py-1.5 text-sm outline-none focus:border-brand" />
						<label class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist" for="f-birth">Date de naissance</label>
						<input id="f-birth" name="birthDate" type="date" value={selected.user.birthDate ?? ''} class="mb-3 w-full rounded-lg border-2 border-line px-2 py-1.5 text-sm outline-none focus:border-brand" />
						<label class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist" for="f-start">Date de démarrage du suivi</label>
						<input id="f-start" name="startDate" type="date" value={selected.user.startDate ?? ''} class="mb-3 w-full rounded-lg border-2 border-line px-2 py-1.5 text-sm outline-none focus:border-brand" />
						<p class="-mt-1 mb-3 text-[10px] text-mist">Ancre les échéances : mensurations tous les 15 jours, photos tous les mois.</p>
						<label class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist" for="f-height">Taille (cm)</label>
						<input id="f-height" name="heightCm" type="number" min="80" max="250" step="0.5" value={selected.user.heightCm ?? ''} placeholder="Ex. 168" class="mb-3 w-full rounded-lg border-2 border-line px-2 py-1.5 text-sm outline-none focus:border-brand" />
						<label class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist" for="f-gsheet">Tableur de suivi G-FLUX (lien Google Sheets)</label>
						<input id="f-gsheet" name="gsheetUrl" type="url" value={selected.user.gsheetUrl ?? ''} placeholder="https://docs.google.com/spreadsheets/d/…" class="mb-3 w-full rounded-lg border-2 border-line px-2 py-1.5 text-sm outline-none focus:border-brand" />
						<p class="-mt-1.5 mb-3 text-[10px] text-mist">Réservé au coach — jamais visible côté cliente. S'ouvre dans un nouvel onglet.</p>
						<div class="mb-3 rounded-lg border-2 border-dashed border-line bg-cream/50 px-3 py-2.5">
							<label class="flex cursor-pointer items-start gap-2 text-sm text-ink">
								<input type="checkbox" name="onboardingEnabled" value="1" checked={selected.user.onboardingEnabled} class="accent-brand" />
								<span>
									<span class="block text-[10px] font-bold uppercase tracking-wider text-mist">Onboarding de démarrage requis</span>
									<span class="mt-0.5 block text-[11px] leading-snug text-mist">Affiche le parcours 2 étapes (formulaire + mensurations/photos) côté cliente tant qu'il n'est pas terminé. Les réponses déjà envoyées sont conservées si tu désactives.</span>
								</span>
							</label>
							<input type="hidden" name="onboardingEnabled" value="0" />
						</div>
						<button type="submit" class="w-full rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark">Enregistrer la fiche</button>
					</form>
				</details>
				<details class="group relative">
					<summary class="flex cursor-pointer list-none items-center gap-1.5 rounded-xl border border-line bg-white px-3.5 py-2 text-[13px] font-bold text-ink shadow-sm transition hover:border-warn hover:text-warn"><Icon name="lock" size={13} class="shrink-0" /> Mot de passe</summary>
					<form method="POST" action="?/resetPassword&client={selected.user._id}&section={section}" class="absolute right-0 top-10 z-20 w-72 rounded-xl border border-line bg-white p-3 shadow-xl">
						<input type="hidden" name="userId" value={selected.user._id} />
						<input name="newPassword" type="text" required minlength="8" placeholder="Nouveau mot de passe (8+ car.)" class="mb-2 w-full rounded-lg border-2 border-line px-2 py-1.5 text-sm outline-none focus:border-warn" />
						<button type="submit" class="w-full rounded-lg bg-warn px-3 py-1.5 text-sm font-semibold text-white hover:brightness-95">Réinitialiser</button>
					</form>
				</details>
				<details class="group relative">
					<summary class="flex cursor-pointer list-none items-center gap-1.5 rounded-xl border border-danger/30 bg-white px-3.5 py-2 text-[13px] font-bold text-danger shadow-sm transition hover:bg-danger-light"><Icon name="trash" size={13} class="shrink-0" /> Supprimer</summary>
					<form method="POST" action="?/removeClient" class="absolute right-0 top-10 z-20 w-80 rounded-xl border border-danger/40 bg-white p-3 shadow-xl">
						<input type="hidden" name="userId" value={selected.user._id} />
						<p class="text-xs leading-relaxed text-ink">Supprimer <strong>{selected.user.prenom}</strong> et toutes ses données ? Action irréversible.</p>
						<label class="mt-2 flex items-start gap-2 text-xs text-ink">
							<input type="checkbox" name="confirm" required class="mt-0.5" />
							<span>Je confirme la suppression définitive.</span>
						</label>
						<button type="submit" class="mt-2 w-full rounded-lg bg-danger px-3 py-1.5 text-sm font-semibold text-white hover:brightness-95">Supprimer le compte</button>
					</form>
				</details>
				<a
					href="/admin"
					onclick={(e) => { e.preventDefault(); closeVision(); }}
					class="grid h-9 w-9 place-items-center rounded-lg bg-ink text-white transition hover:bg-brand"
					aria-label="Fermer la vue 360° et revenir à la liste des clientes"
					title="Fermer la Vision 360°"
				><Icon name="x" size={16} /></a>
			</div>
		</div>

		<!-- Onglets du 360° — pills premium (tous les onglets métier conservés) -->
		<div class="border-b border-line bg-card px-5 py-2.5">
			<div class="tabs-crm w-fit max-w-full overflow-x-auto">
				{#each sectionTabs as t (t.id)}
					<button
						onclick={() => (section = t.id)}
						aria-pressed={section === t.id}
						class="tab-crm {section === t.id ? 'active-crm' : ''}"
					>{t.label}</button>
				{/each}
			</div>
		</div>

		<div class="flex-1 overflow-y-auto px-5 py-5">
			<!-- {#key section} : rejoue le fondu d'entrée à chaque changement d'onglet
			     (180 ms, opacity seule — zéro CLS) et remonte le scroll en haut. -->
			{#key section}
			<div class="tabfade-crm space-y-5">
			<!-- Feedback discret après une sauvegarde (le tiroir reste ouvert) -->
			{#if alert}
				<div
					class="flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm
						{alert.error ? 'border-danger/40 bg-danger-light text-danger' : 'border-brand/40 bg-brand-light text-ink'}"
				>
					<span>{alert.error ?? alert.ok}</span>
					<Icon name="info" size={15} class="shrink-0 text-mist" />
				</div>
			{/if}

			<!-- ═══ Vision 360 (onglet principal) : synthèse + analyses + objectifs ═══ -->
			{#if section === 'apercu'}
				<!-- Zone haute : statut onboarding (gauche) + message du coach (droite) -->
				<div class="m-in-crm grid gap-3 lg:grid-cols-2" style="--m-i: 0">
				<!-- Raccourci formulaire de démarrage (onboarding) — carte statut premium -->
				<div class="rounded-2xl border p-4 shadow-sm" style="border-color: rgba(29, 185, 84, 0.35); background: linear-gradient(135deg, var(--brand-soft, #f3fcf7), #fff 45%)">
					<div class="flex flex-wrap items-center justify-between gap-3">
						<div class="flex items-center gap-2.5">
							<span class="kpi-tile" style="--kpi-tile-bg: var(--accent-light); --kpi-tile-fg: var(--brand-deep)"><Icon name="rocket" size={17} /></span>
							<div class="min-w-0">
								<p class="text-[11px] font-bold uppercase tracking-wider text-mist">Onboarding de démarrage</p>
								<p class="mt-0.5 text-xs text-mist">
									{#if onboardingView?.enabled}
										Actif — {onboardingView.step1.done ? 'formulaire ✓' : 'formulaire à faire'}
										·
										{onboardingView.step2.done ? 'mensurations & photos ✓' : 'mensurations & photos à compléter'}
									{:else}
										Non activé pour cette cliente (<span class="inline-flex items-center gap-0.5"><Icon name="settings" size={11} class="shrink-0" /> Fiche pour l'activer</span>)
									{/if}
								</p>
							</div>
						</div>
						<button
							type="button"
							onclick={() => (section = 'demarrage')}
							class="shrink-0 rounded-lg border-2 border-line px-3 py-1.5 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand"
						>
							Voir le formulaire de démarrage →
						</button>
					</div>
				</div>

				<!-- Message du coach du jour (champ dédié, éphémère — visible par la cliente 24 h après publication) -->
				<div class="rounded-2xl border border-line bg-card p-4 shadow-sm">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<div class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-mist"><Icon name="messageCircle" size={13} class="shrink-0 text-brand" /> Message du coach du jour</div>
						<div class="flex items-center gap-1.5">
							{#if msgActive && msgHasContent}
								<span class="rounded-full bg-brand-light px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-dark">Publié · {selected.user.coachMessageDate ? fmtDateShort(selected.user.coachMessageDate) : ''}</span>
							{/if}
							{#if msgActive && msgHasContent}
								<span class="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide {msgRead ? 'bg-line/70 text-mist' : 'bg-warn-light text-warn'}">{msgRead ? '✓ Lu' : 'Non lu'}</span>
							{/if}
						</div>
					</div>
					<p class="mt-1 text-xs text-mist">Apparaît tout en haut du dashboard de la cliente pendant 24 h après publication (texte et/ou audio), puis est retiré automatiquement. Une note interne n’est jamais affichée automatiquement.</p>
					<form method="POST" action="?/setCoachMessage&client={selected.user._id}&section={section}" class="mt-2">
						<input type="hidden" name="userId" value={selected.user._id} />
						<input type="hidden" name="audioId" value={msgAudioDraft} />
						<div class="flex flex-col gap-2 sm:flex-row">
							<textarea
								name="message"
								rows="2"
								placeholder="Ex. Belle régularité cette semaine, continue comme ça"
								class="min-h-14 flex-1 rounded-xl border-2 border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand"
							>{msgActive ? (selected.user.coachMessage ?? '') : ''}</textarea>
							<div class="flex shrink-0 gap-2">
								<button type="submit" name="publish" value="1" class="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark">
									Publier
								</button>
								<button type="submit" name="clear" value="1" class="rounded-xl border-2 border-line px-4 py-2 text-sm font-semibold text-mist transition hover:border-danger hover:text-danger">
									Effacer
								</button>
							</div>
						</div>
						<!-- Audio du message : enregistrement possible + état actuel (brouillon jamais publié tant qu'on n'envoie pas). -->
						<div class="mt-2 rounded-xl border border-line bg-card/60 p-3">
							<p class="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-mist"><Icon name="mic" size={12} /> Avec un message audio (optionnel)</p>
						<CoachMedia
							mode="message"
							userId={selected.user._id}
							existing={messageAudio}
							bind:stagedAudioId={msgAudioDraft}
						/>
					</div>
				</form>
			</div>
				</div>

				<!-- Poids actuel / Mensurations / Calories / Cycle — cartes de synthèse premium
				     (liseré coloré + tuile icône + chiffre Lato 900 ; données et actions
				     strictement identiques : mêmes boutons quick-sheet, mêmes valeurs). -->
				<div class="m-in-crm grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5" style="--m-i: 1">
					<button
						type="button"
						onclick={() => openQuickSheet('weight')}
						class="kpi-crm card-crm-hover group cursor-pointer text-left active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-brand"
						style="--kpi-accent: var(--accent); --kpi-tile-bg: var(--accent-light); --kpi-tile-fg: var(--brand-deep)"
						aria-label="Ajouter une prise de poids"
					>
						<div class="flex items-center justify-between gap-1 text-[11px] font-bold uppercase tracking-wider text-mist">
							<span class="flex items-center gap-2"><span class="kpi-tile" style="width:1.75rem;height:1.75rem"><Icon name="scale" size={14} /></span> Poids actuel</span>
							<span class="grid h-5 w-5 place-items-center rounded-full border border-line text-mist transition group-hover:border-brand group-hover:text-brand"><Icon name="plus" size={11} /></span>
						</div>
						<div class="mt-1 flex items-baseline gap-2">
							<span class="kpi-num-crm text-[1.65rem] text-ink">{latestAny.weightKg != null ? `${String(latestAny.weightKg.value).replace('.', ',')} kg` : '—'}</span>
							{#if weightDelta != null}
								<span class="text-sm font-bold {weightDelta <= 0 ? 'text-brand' : 'text-warn'}">{weightDelta <= 0 ? '↓' : '↑'} {String(Math.abs(weightDelta)).replace('.', ',')} kg</span>
							{/if}
						</div>
						<div class="mt-1 text-[11px] text-mist">{latestAny.weightKg != null ? `dernière prise ${fmtDateShort(latestAny.weightKg.date)}` : 'aucune prise'}</div>
					</button>
					<button
						type="button"
						onclick={() => openQuickSheet('mensurations')}
						class="kpi-crm card-crm-hover group cursor-pointer text-left active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-brand"
						style="--kpi-accent: var(--orange); --kpi-tile-bg: var(--warn-light); --kpi-tile-fg: var(--orange)"
						aria-label="Ajouter des mensurations"
					>
						<div class="flex items-center justify-between gap-1 text-[11px] font-bold uppercase tracking-wider text-mist">
							<span class="flex items-center gap-2"><span class="kpi-tile" style="width:1.75rem;height:1.75rem"><Icon name="ruler" size={14} /></span> Mensurations</span>
							<span class="grid h-5 w-5 place-items-center rounded-full border border-line text-mist transition group-hover:border-brand group-hover:text-brand"><Icon name="plus" size={11} /></span>
						</div>
						<div class="mt-1 grid grid-cols-3 gap-2 text-center">
							<div>
								<div class="kpi-num-crm text-[1.65rem] text-ink">{latestAny.waistCm != null ? fmtCm(latestAny.waistCm.value) : '—'}</div>
								<div class="text-[10px] text-mist">taille fine</div>
							</div>
							<div>
								<div class="kpi-num-crm text-[1.65rem] text-ink">{latestAny.hipCm != null ? fmtCm(latestAny.hipCm.value) : '—'}</div>
								<div class="text-[10px] text-mist">fessiers</div>
							</div>
							<div>
								<div class="kpi-num-crm text-[1.65rem] text-ink">{latestAny.neckCm != null ? fmtCm(latestAny.neckCm.value) : '—'}</div>
								<div class="text-[10px] text-mist">cou</div>
							</div>
						</div>
						<div class="mt-1 text-[11px] text-mist">en cm {mensDate ? `· ${fmtDateShort(mensDate)}` : '· aucune prise'}</div>
					</button>
					<div class="kpi-crm" style="--kpi-accent: var(--warn); --kpi-tile-bg: var(--warn-light); --kpi-tile-fg: var(--warn)">
						<div class="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-mist"><span class="kpi-tile" style="width:1.75rem;height:1.75rem"><Icon name="flame" size={14} /></span> Calories / jour</div>
						<div class="mt-1 flex items-baseline gap-2">
							<span class="kpi-num-crm text-[1.65rem] text-ink">{weekAvg || '—'}</span>
							{#if view && weekAvg > 0}
								<span class="text-sm font-bold {kcalTrend <= 5 ? 'text-brand' : 'text-warn'}">{kcalTrend > 0 ? '+' : ''}{kcalTrend} %</span>
							{/if}
						</div>
						<div class="mt-1 text-[11px] text-mist">
							moyenne constatée · {loggedDays} jour(s) renseigné(s) sur 7 terminés · objectif {(view?.cockpit?.calories?.goal ?? goalKcal).toLocaleString('fr-FR')} kcal
							{#if view?.cockpit?.calories?.goalChanged && (view?.cockpit?.calories?.distinctGoals ?? []).length > 1}
								<span class="italic">· fenêtre traversant un changement ( {(view?.cockpit?.calories?.distinctGoals ?? []).map((g) => g.toLocaleString('fr-FR')).join(' → ')} kcal, évalué jour par jour)</span>
							{/if}
						</div>
					</div>
					<!-- Cycle — mêmes données et formule que le dashboard de la cliente -->
					<div class="kpi-crm" style="--kpi-accent: #ec4899; --kpi-tile-bg: #fdeff6; --kpi-tile-fg: #db2777">
						<div class="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-mist"><span class="kpi-tile" style="width:1.75rem;height:1.75rem"><Icon name="flower2" size={14} /></span> Cycle</div>
						{#if selCycleState.kind === 'empty'}
							<div class="mt-1.5 text-sm text-mist">Non renseigné</div>
						{:else if selCycleState.kind === 'hormonal'}
							<div class="mt-1 font-display text-base font-semibold text-ink">Non concernée</div>
							<div class="mt-0.5 text-[11px] leading-snug text-mist">contraception hormonale — pas d'estimation</div>
						{:else if selCycleState.kind === 'nodate'}
							<div class="mt-1 font-display text-base font-semibold text-ink">Règles irrégulières</div>
							<div class="mt-0.5 text-[11px] leading-snug text-mist">pas d'estimation fiable sans date de règles</div>
						{:else}
							<div class="mt-1 font-display text-2xl font-semibold text-ink">J{selCycleState.cycleDay}<span class="text-sm font-semibold text-mist"> / {selCycleState.cycleLength}</span></div>
							<div class="text-sm font-semibold text-ink">{selCycleState.label}</div>
							<div class="mt-1 text-[11px] leading-snug text-mist">règles : {selCycle?.lmp ? fmtDateShort(selCycle.lmp) : '—'} · durée {selCycle?.len ?? '—'} j · ovulation ~ J{selCycleState.ovulationDay}</div>
						{/if}
					</div>

				<!-- DÉPENSE SPORTIVE — même encart que l'onglet Bilans, mais sur la
			     semaine CALENDAIRE courante (indépendante du dernier bilan).
			     kcal = REPÈRE, jamais un crédit calorique. Tendance calculée sur
			     les semaines closes uniquement (jamais la semaine partielle). -->
				<div class="kpi-crm" style="--kpi-accent: var(--accent); --kpi-tile-bg: var(--accent-light); --kpi-tile-fg: var(--brand-deep)">
					<div class="flex items-center justify-between gap-2">
						<div class="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-mist"><span class="kpi-tile" style="width:1.75rem;height:1.75rem"><Icon name="zap" size={14} /></span> Dépense sportive</div>
						{#if sportOverview?.trainingCount}
							<span class="rounded-full bg-soft px-2 py-0.5 text-[10px] font-semibold text-mist">{sportOverview.trainingCount} séance{sportOverview.trainingCount > 1 ? 's' : ''} G-FLUX</span>
						{:else if sportOverview?.manualCount}
							<span class="rounded-full bg-soft px-2 py-0.5 text-[10px] font-semibold text-mist">{sportOverview.manualCount} manuelle{sportOverview.manualCount > 1 ? 's' : ''}</span>
						{/if}
					</div>
					{#if sportOverview && (sportOverview.activities > 0 || (sportOverview.previous ?? []).some((p) => p.durationMin > 0))}
						<div class="mt-1 flex flex-wrap items-baseline gap-x-2">
							<span class="kpi-num-crm text-[1.65rem] text-ink">≈ {sportOverview.kcal.toLocaleString('fr-FR')} kcal</span>
							{#if sportOverview.trend === 'up'}
								<span class="rounded-full bg-brand-light px-1.5 py-0.5 text-[10px] font-bold text-brand-dark">↑ Volume sportif</span>
							{:else if sportOverview.trend === 'down'}
								<span class="rounded-full bg-warn-light px-1.5 py-0.5 text-[10px] font-bold text-warn">↓ Volume sportif</span>
							{:else if sportOverview.trend === 'stable'}
								<span class="rounded-full bg-soft px-1.5 py-0.5 text-[10px] font-bold text-ink">Volume stable</span>
							{/if}
						</div>
						<p class="mt-0.5 text-[11px] text-mist">
							{sportOverview.activities} activité{sportOverview.activities > 1 ? 's' : ''}
							· {Math.floor(sportOverview.durationMin / 60)} h {String(sportOverview.durationMin % 60).padStart(2, '0')} cette semaine
						</p>
						<button type="button" onclick={() => (section = 'bilans')} class="mt-2 flex w-full items-center gap-1 border-t border-line/60 pt-2 text-left text-[10.5px] font-semibold text-mist transition hover:text-brand">
							Historique semaine par semaine : onglet Bilans <Icon name="arrowRight" size={11} class="shrink-0" />
						</button>
					{:else}
						<p class="mt-1 text-sm italic text-mist">Aucune activité cette semaine</p>
					{/if}
				</div>
				</div>

				<!-- Ajout rapide depuis l'Aperçu : même endpoint que « Poids & mesures »,
			     la vue est rechargée après enregistrement → cartes à jour immédiatement. -->
				{#if quickSheet}
					<button type="button" class="qs-backdrop-crm fixed inset-0 z-[80] cursor-pointer bg-ink/45 backdrop-blur-[2px]" aria-label="Fermer" onclick={() => (quickSheet = null)}></button>
					<div class="fixed inset-x-4 top-1/2 z-[80] mx-auto max-w-sm -translate-y-1/2 sm:left-1/2 sm:right-auto sm:-translate-x-1/2" role="dialog" aria-modal="true">
						<div class="qs-card-crm rounded-2xl bg-white p-5 shadow-2xl">
						<div class="flex items-center justify-between gap-2 border-b border-line pb-3">
							<h4 class="flex items-center gap-2.5 font-display text-base font-bold text-ink">
								<span class="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand-light text-brand-deep"><Icon name={quickSheet.kind === 'weight' ? 'scale' : 'ruler'} size={15} /></span>
								{quickSheet.kind === 'weight' ? 'Ajouter un poids' : 'Ajouter des mensurations'}
							</h4>
							<button type="button" onclick={() => (quickSheet = null)} class="grid h-7 w-7 place-items-center rounded-full text-mist transition hover:bg-soft hover:text-ink" aria-label="Fermer"><Icon name="x" size={14} /></button>
						</div>

						{#if quickSheet.kind === 'weight'}
							<div class="mt-4 flex flex-wrap items-end gap-2">
								<label class="block">
									<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Date</span>
									<input type="date" bind:value={quickWeight.date} class="rounded-lg border-2 border-line px-2.5 py-2 text-sm outline-none focus:border-brand" />
								</label>
								<label class="block">
									<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Poids (kg)</span>
									<input type="number" inputmode="decimal" min="30" max="350" step="0.1" bind:value={quickWeight.value} placeholder="Ex. 59,5" class="w-28 rounded-lg border-2 border-line px-2.5 py-2 text-sm outline-none focus:border-brand" />
								</label>
							</div>
							<button type="button" onclick={saveQuickWeight} disabled={quickBusy} class="mt-4 w-full rounded-full bg-brand px-3 py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-60">
								{quickBusy ? 'Enregistrement…' : 'Enregistrer'}
							</button>
						{:else}
							<div class="mt-4">
								<label class="block">
									<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Date</span>
									<input type="date" bind:value={quickMes.date} class="w-full rounded-lg border-2 border-line px-2.5 py-2 text-sm outline-none focus:border-brand" />
								</label>
								<div class="mt-2 grid grid-cols-3 gap-2">
									<label class="block">
										<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Taille (cm)</span>
										<input type="number" inputmode="decimal" min="40" max="250" step="0.1" bind:value={quickMes.waistCm} placeholder="—" class="w-full rounded-lg border-2 border-line px-2 py-2 text-sm outline-none focus:border-brand" />
									</label>
									<label class="block">
										<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Fessiers (cm)</span>
										<input type="number" inputmode="decimal" min="50" max="300" step="0.1" bind:value={quickMes.hipCm} placeholder="—" class="w-full rounded-lg border-2 border-line px-2 py-2 text-sm outline-none focus:border-brand" />
									</label>
									<label class="block">
										<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Cou (cm)</span>
										<input type="number" inputmode="decimal" min="20" max="80" step="0.1" bind:value={quickMes.neckCm} placeholder="—" class="w-full rounded-lg border-2 border-line px-2 py-2 text-sm outline-none focus:border-brand" />
									</label>
								</div>
								<p class="mt-2 text-[11px] leading-snug text-mist">Un ou deux champs suffisent — les champs vides sont ignorés et n'écrasent pas les anciennes valeurs.</p>
							</div>
							<button type="button" onclick={saveQuickMesures} disabled={quickBusy} class="mt-4 w-full rounded-full bg-brand px-3 py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-60">
								{quickBusy ? 'Enregistrement…' : 'Enregistrer'}
							</button>
						{/if}

						{#if quickMsg}
							<p class="mt-2 rounded-lg bg-warn-light px-3 py-2 text-xs font-semibold text-ink">{quickMsg}</p>
						{/if}
						</div>
					</div>
				{/if}				<!-- Analyses des 7 derniers jours — calories + pas côte à côte (fenêtre J-7 → J-1, aujourd'hui exclu) -->
				<section class="m-in-crm rounded-2xl border border-line bg-card px-5 py-4 shadow-sm" style="--m-i: 2">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<div class="min-w-0">
							<h3 class="flex items-center gap-2 font-display text-base font-semibold text-ink"><Icon name="chartBar" size={17} class="shrink-0 text-brand" /> Analyses des 7 derniers jours</h3>
							<p class="mt-0.5 text-xs text-mist">Suivi des calories et de l'activité par rapport aux objectifs — 7 journées terminées (J-7 → J-1, aujourd'hui exclu).</p>
						</div>
						<span class="rounded-full bg-soft px-2.5 py-1 text-[10.5px] font-bold text-mist">7 derniers jours</span>
					</div>
					<div class="mt-3 grid gap-3 xl:grid-cols-2">
						<div class="rounded-xl border border-line/70 bg-white p-3.5">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<h4 class="flex items-center gap-1.5 text-[13px] font-bold text-ink"><Icon name="flame" size={14} class="shrink-0 text-warn" /> Calories consommées par jour</h4>
								<span class="text-[10px] text-mist">barres : consommé · pointillé : objectif · verte : moyenne</span>
							</div>
							<div class="mt-2 grid grid-cols-3 gap-2">
								<div class="rounded-lg bg-soft/80 px-2.5 py-1.5">
									<div class="text-[9.5px] font-bold uppercase tracking-wider text-mist">Moyenne</div>
									<div class="text-[13px] font-bold tabular-nums text-ink">{weekAvg || '—'} kcal {#if view && weekAvg > 0}<span class="text-[10px] font-bold {kcalTrend <= 0 ? 'text-brand' : 'text-warn'}">{kcalTrend > 0 ? '+' : ''}{kcalTrend} %</span>{/if}</div>
								</div>
								<div class="rounded-lg bg-soft/80 px-2.5 py-1.5">
									<div class="text-[9.5px] font-bold uppercase tracking-wider text-mist">Objectif</div>
									<div class="text-[13px] font-bold tabular-nums text-ink">{kcalGoalVal.toLocaleString('fr-FR')} kcal</div>
								</div>
								<div class="rounded-lg bg-soft/80 px-2.5 py-1.5">
									<div class="text-[9.5px] font-bold uppercase tracking-wider text-mist">Écart / jour</div>
									<div class="text-[13px] font-bold tabular-nums {kcalGap == null ? 'text-mist' : kcalGap <= 0 ? 'text-brand' : 'text-warn'}">{kcalGap == null ? '—' : `${kcalGap > 0 ? '+' : ''}${fmtN(kcalGap)} kcal`}</div>
								</div>
							</div>
							{#if calBars.some((b) => b.value != null)}
								<div class="mt-2.5">
									<WeeklyTrendChart bars={calBars} goal={kcalGoalVal} avg={weekAvg} fmt={fmtN} ariaLabel="Calories de la semaine" />
								</div>								<p class="mt-2 text-[10.5px] leading-relaxed text-mist"><strong class="text-ink">Moyenne : {weekAvg} kcal/jour</strong> sur {cockpit?.calories?.trackedDays ?? loggedDays} jour(s) exploitable(s) · seuil journée complète {cockpit?.calories?.thresholdKcal ?? 960} kcal = max(800, 60 % de l'objectif){cockpit?.calories?.partialExcluded ? ` · ${cockpit.calories.partialExcluded} partielle(s) exclue(s)` : ''} — le Journal reste intact.</p>
							{:else}
								<p class="mt-2.5 rounded-lg border border-dashed border-line px-3 py-6 text-center text-[13px] text-mist">Aucune donnée de journal sur les 7 derniers jours.</p>
							{/if}
						</div>
						<div class="rounded-xl border border-line/70 bg-white p-3.5">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<h4 class="flex items-center gap-1.5 text-[13px] font-bold text-ink"><Icon name="footprints" size={14} class="shrink-0 text-brand" /> Nombre de pas par jour</h4>
								<span class="text-[10px] text-mist">barres : pas · pointillé : objectif · verte : moyenne</span>
							</div>
							<div class="mt-2 grid grid-cols-3 gap-2">
								<div class="rounded-lg bg-soft/80 px-2.5 py-1.5">
									<div class="text-[9.5px] font-bold uppercase tracking-wider text-mist">Moyenne</div>
									<div class="text-[13px] font-bold tabular-nums text-ink">{stepsAvg > 0 ? fmtN(stepsAvg) : '—'} pas {#if stepsGap != null}<span class="text-[10px] font-bold {stepsGap <= 0 ? 'text-brand' : 'text-warn'}">{stepsGap > 0 ? '+' : ''}{Math.round((stepsAvg - (stepGoalVal ?? stepsAvg)) / (stepGoalVal ?? stepsAvg) * 100)} %</span>{/if}</div>
								</div>
								<div class="rounded-lg bg-soft/80 px-2.5 py-1.5">
									<div class="text-[9.5px] font-bold uppercase tracking-wider text-mist">Objectif</div>
									<div class="text-[13px] font-bold tabular-nums text-ink">{stepGoalVal ? `${fmtN(stepGoalVal)} pas` : '—'}</div>
								</div>
								<div class="rounded-lg bg-soft/80 px-2.5 py-1.5">
									<div class="text-[9.5px] font-bold uppercase tracking-wider text-mist">Écart / jour</div>
									<div class="text-[13px] font-bold tabular-nums {stepsGap == null ? 'text-mist' : stepsGap <= 0 ? 'text-brand' : 'text-warn'}">{stepsGap == null ? '—' : `${stepsGap > 0 ? '+' : ''}${fmtN(stepsGap)} pas`}</div>
								</div>
							</div>
							{#if stepsTracked > 0}
								<div class="mt-2.5">
									<WeeklyTrendChart bars={stepBars} goal={stepGoalVal} avg={stepsAvg} fmt={fmtN} unit=" pas" ariaLabel="Pas de la semaine" />
								</div>
								<p class="mt-2 text-[10.5px] leading-relaxed text-mist"><strong class="text-ink">Moyenne : {fmtN(stepsAvg)} pas/jour</strong> sur {stepsTracked} jour(s) renseigné(s) · total {fmtN(stepsTotal)} pas — somme des 7 journées terminées (J-7 → J-1, aujourd'hui exclu).</p>
							{:else}
								<p class="mt-2.5 rounded-lg border border-dashed border-line px-3 py-6 text-center text-[13px] text-mist">Aucun pas renseigné sur les 7 derniers jours.</p>
							{/if}
						</div>
					</div>
				</section>

				{#if weightPoints && weightPoints.coords.length > 0}
					<div class="rounded-2xl border border-line bg-card px-5 py-4 shadow-sm">
						<div class="flex flex-wrap items-center justify-between gap-2">
							<h3 class="flex items-center gap-2 font-display text-base font-semibold text-ink"><Icon name="chartLine" size={17} class="shrink-0 text-brand" /> Tendance du poids</h3>
							<span class="text-[11px] text-mist">{weightPoints.coords.length} prise(s) · {String(weightPoints.min).replace('.', ',')} → {String(weightPoints.max).replace('.', ',')} kg</span>
						</div>
						<div class="mt-3 overflow-x-auto">
							<svg viewBox="0 0 700 180" class="h-auto w-full min-w-[520px]" role="img" aria-label="Courbe du poids">
								<defs>
									<linearGradient id="wgrad" x1="0" y1="0" x2="0" y2="1">
										<stop offset="0%" stop-color="#1db954" stop-opacity="0.25" />
										<stop offset="100%" stop-color="#1db954" stop-opacity="0" />
									</linearGradient>
								</defs>
								{#if weightPoints.coords.length > 1}
									<polygon
										points={`${weightPoints.coords.map((p) => `${p.x},${p.y}`).join(' ')} ${weightPoints.coords[weightPoints.coords.length - 1].x},168 ${weightPoints.coords[0].x},168`}
										fill="url(#wgrad)"
										class="chart-fade"
									/>
									<polyline points={weightPoints.coords.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#1db954" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="chart-line" />
								{/if}
								{#each weightPoints.coords as p}
									<circle cx={p.x} cy={p.y} r="5" fill="#1db954" stroke="#fff" stroke-width="2" class="chart-dot">
										<title>{fmtDateShort(p.date)} : {String(p.weightKg).replace('.', ',')} kg</title>
									</circle>
									<text x={p.x} y={p.y - 11} text-anchor="middle" font-size="11.5" font-weight="600" fill="#111110">{String(p.weightKg).replace('.', ',')}</text>
									<text x={p.x} y="176" text-anchor="middle" font-size="10.5" fill="#999990">{fmtDateShort(p.date)}</text>
								{/each}
							</svg>
						</div>
					</div>
				{/if}

				<!-- Objectifs journaliers -->
				<div class="rounded-2xl border border-line bg-card px-5 py-4 shadow-sm">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<h3 class="flex items-center gap-2 font-display text-base font-semibold text-ink"><Icon name="target" size={17} class="shrink-0 text-brand" /> Objectifs journaliers</h3>
						<span class="text-[11px] text-mist">Affichés dans le Journal de {selected.user.prenom}</span>
					</div>
					{#key selected.user._id}
						<form method="POST" action="?/setGoals&client={selected.user._id}&section={section}" class="mt-3">
							<input type="hidden" name="userId" value={selected.user._id} />

							<div class="grid gap-3 xl:grid-cols-5">
							<div class="min-w-0 xl:col-span-3">
							<!-- Choix du mode de saisie -->
							<div class="mb-3 flex gap-1 rounded-full border border-line bg-white p-1 text-xs font-semibold sm:text-sm" role="radiogroup" aria-label="Mode de saisie des objectifs">
								<button
									type="button"
									class="flex-1 rounded-full px-3 py-2 transition {goalsMode === 'pct' ? 'bg-brand text-white' : 'text-ink hover:bg-soft'}"
									onclick={() => switchGoalsMode('pct')}													><span class="inline-flex items-center gap-1.5"><Icon name="target" size={14} /> Calories + répartition %</span></button>
								<button
									type="button"
									class="flex-1 rounded-full px-3 py-2 transition {goalsMode === 'grams' ? 'bg-brand text-white' : 'text-ink hover:bg-soft'}"
									onclick={() => switchGoalsMode('grams')}													><span class="inline-flex items-center gap-1.5"><Icon name="drumstick" size={14} /> Méthode macros (g)</span></button>
							</div>

							{#if goalsMode === 'pct'}
								<!-- Répartition macros — même langage visuel que la PWA cliente
								     (MacroLine : Glucides #ec4899 · Protéines #3b82f6 · Lipides #f97316) -->
								<div class="grid grid-cols-2 gap-2.5">
									<label class="rounded-xl border-2 border-line bg-white px-3 py-2.5 transition focus-within:border-brand">
										<span class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-mist"><Icon name="flame" size={12} class="shrink-0 text-warn" /> Calories / jour</span>
										<div class="mt-1 flex items-baseline gap-1">
											<input type="number" name="kcal" required min="800" max="6000" bind:value={pctKcal} class="w-24 border-0 bg-transparent p-0 font-display text-xl font-bold text-ink outline-none" />
											<span class="text-[11px] font-semibold text-mist">kcal</span>
										</div>
									</label>
									<label class="rounded-xl border-2 border-line bg-white px-3 py-2.5 transition focus-within:border-brand">
										<span class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider" style="color:#ec4899"><span class="h-2 w-2 shrink-0 rounded-full" style="background:#ec4899"></span> Glucides</span>
										<div class="mt-1 flex items-baseline gap-1">
											<input type="number" min="0" max="100" step="1" bind:value={pctCarbs} class="w-14 border-0 bg-transparent p-0 font-display text-xl font-bold text-ink outline-none" />
											<span class="text-[11px] font-semibold text-mist">% · ≈ {goalsValues.carbs} g</span>
										</div>
									</label>
									<label class="rounded-xl border-2 border-line bg-white px-3 py-2.5 transition focus-within:border-brand">
										<span class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider" style="color:#3b82f6"><span class="h-2 w-2 shrink-0 rounded-full" style="background:#3b82f6"></span> Protéines</span>
										<div class="mt-1 flex items-baseline gap-1">
											<input type="number" min="0" max="100" step="1" bind:value={pctProtein} class="w-14 border-0 bg-transparent p-0 font-display text-xl font-bold text-ink outline-none" />
											<span class="text-[11px] font-semibold text-mist">% · ≈ {goalsValues.protein} g</span>
										</div>
									</label>
									<label class="rounded-xl border-2 border-line bg-white px-3 py-2.5 transition focus-within:border-brand">
										<span class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider" style="color:#f97316"><span class="h-2 w-2 shrink-0 rounded-full" style="background:#f97316"></span> Lipides</span>
										<div class="mt-1 flex items-baseline gap-1">
											<input type="number" min="0" max="100" step="1" bind:value={pctFat} class="w-14 border-0 bg-transparent p-0 font-display text-xl font-bold text-ink outline-none" />
											<span class="text-[11px] font-semibold text-mist">% · ≈ {goalsValues.fat} g</span>
										</div>
									</label>
								</div>
								<p class="mt-2 text-xs font-semibold {pctOk ? 'text-brand' : 'text-danger'}">
									Répartition : {pctSum} %{pctOk ? ' ✓' : ' — doit faire 100 %'}
								</p>
								<input type="hidden" name="carbs" value={goalsValues.carbs} />
								<input type="hidden" name="protein" value={goalsValues.protein} />
								<input type="hidden" name="fat" value={goalsValues.fat} />
							{:else}
								<div class="grid grid-cols-2 gap-2.5">
									<div class="rounded-xl border-2 border-brand/40 bg-brand-light px-3 py-2.5">
										<span class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-brand"><Icon name="flame" size={12} class="shrink-0" /> Calories calculées</span>
										<span class="mt-1 block font-display text-xl font-bold text-brand-dark">{goalsValues.kcal} <span class="text-xs font-semibold text-mist">kcal</span></span>
									</div>
									<label class="rounded-xl border-2 border-line bg-white px-3 py-2.5 transition focus-within:border-brand">
										<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider " style="color:#ec4899"><span class="h-2 w-2 shrink-0 rounded-full" style="background:#ec4899"></span> Glucides (g)</span>										<input type="number" name="carbs" required min="0" max="1000" bind:value={gCarbs} class="w-full rounded-lg border-2 border-line px-2 py-2 text-sm outline-none focus:border-brand" />
											</label>
											<label class="block">
												<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider " style="color:#3b82f6"><span class="h-2 w-2 shrink-0 rounded-full" style="background:#3b82f6"></span> Protéines (g)</span>
												<input type="number" name="protein" required min="0" max="400" bind:value={gProtein} class="w-full rounded-lg border-2 border-line px-2 py-2 text-sm outline-none focus:border-brand" />
											</label>
											<label class="block">
												<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider " style="color:#f97316"><span class="h-2 w-2 shrink-0 rounded-full" style="background:#f97316"></span> Lipides (g)</span>
												<input type="number" name="fat" required min="0" max="300" bind:value={gFat} class="w-full rounded-lg border-2 border-line px-2 py-2 text-sm outline-none focus:border-brand" />
									</label>
								</div>
								<p class="mt-2 text-xs text-mist">1 g glucides = 4 kcal · 1 g protéines = 4 kcal · 1 g lipides = 9 kcal</p>
								<input type="hidden" name="kcal" value={goalsValues.kcal} />
							{/if}

							{#if goalsError}
								<p class="mt-2 rounded-lg bg-danger-light px-3 py-2 text-xs font-semibold text-danger">{goalsError}</p>
							{/if}
							</div>

							<!-- Colonne droite : filets de sécurité + enregistrement -->
							<div class="grid content-start gap-3 xl:col-span-2">
							<!-- Filet de sécurité : maintenance calorique (repère secondaire, jamais une 2ᵉ cible) -->
							<div class="rounded-xl border-2 border-dashed border-brand/30 bg-brand-light/50 px-3 py-2.5">
								<label class="flex items-center justify-between gap-3">
									<span class="min-w-0">
										<span class="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-brand-dark"><Icon name="lifeBuoy" size={12} class="shrink-0" /> Maintenance calorique (optionnel)</span>
										<span class="mt-0.5 block text-[11px] leading-snug text-mist">Filet de sécurité : repère discret côté cliente si elle dépasse légèrement son objectif. Doit rester &gt; l'objectif. Laisse vide pour désactiver.</span>
									</span>
									<input
										type="number"
										name="maintenanceKcal"
										min="800"
										max="10000"
										step="50"
										placeholder="Ex. 2350"
										bind:value={maintenanceKcal}
										class="w-32 rounded-lg border-2 border-line px-2 py-2 text-right text-sm font-semibold outline-none focus:border-brand"
									/>
								</label>
								{#if !maintenanceKcal && savedMaintenance}
									<label class="mt-2 flex cursor-pointer items-center gap-1.5 text-[11px] text-mist">
										<input type="checkbox" name="clearMaintenance" value="1" class="accent-brand" />
										Retirer le filet de sécurité enregistré ({savedMaintenance} kcal)
									</label>
								{/if}
							</div>

							<!-- Objectif quotidien de pas (saisi manuellement, propre à chaque cliente) -->
							<div class="rounded-xl border-2 border-dashed border-line bg-cream/50 px-3 py-2.5">
								<label class="flex items-center justify-between gap-3">
									<span class="min-w-0">
										<span class="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-mist"><Icon name="footprints" size={12} class="shrink-0" /> Objectif quotidien de pas (optionnel)</span>
										<span class="mt-0.5 block text-[11px] leading-snug text-mist">Visible côté cliente sur son Accueil (« Pas aujourd'hui ») et utilisé dans le récap hebdo et le cockpit Bilans. Laisse vide pour ne pas afficher d'objectif.</span>
									</span>
									<input
										type="number"
										name="stepGoal"
										min="500"
										max="100000"
										step="500"
										placeholder="Ex. 10000"
										bind:value={stepGoal}
										class="w-32 rounded-lg border-2 border-line px-2 py-2 text-right text-sm font-semibold outline-none focus:border-brand"
									/>
								</label>
								{#if !stepGoal && savedStepGoal}
									<label class="mt-2 flex cursor-pointer items-center gap-1.5 text-[11px] text-mist">
										<input type="checkbox" name="clearStepGoal" value="1" class="accent-brand" />
										Retirer l'objectif de pas enregistré ({savedStepGoal.toLocaleString('fr-FR')} pas)
									</label>
								{/if}
							</div>

							<button type="submit" disabled={!!goalsError} class="w-full rounded-full bg-brand px-3 py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-60">
								Enregistrer les objectifs
							</button>
							</div>
							</div>
						</form>
					{/key}
				</div>

				<!-- Blocs secondaires : accès rapide (onglets métier) + dernières activités (données existantes) -->
				<div class="m-in-crm grid gap-3 lg:grid-cols-2" style="--m-i: 5">
					<div class="rounded-2xl border border-line bg-card p-4 shadow-sm">
						<div class="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-mist"><Icon name="zap" size={13} class="shrink-0 text-brand" /> Accès rapide</div>
						<div class="mt-2.5 grid gap-1.5">
							{#each quickAccess as q (q.id)}
								<button type="button" onclick={() => (section = q.id)} class="group flex items-center gap-2.5 rounded-xl border border-line bg-white px-3 py-2 text-left transition hover:border-brand/50 hover:bg-brand-light/30">
									<span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-soft text-ink transition group-hover:bg-brand-light group-hover:text-brand-deep"><Icon name={q.icon} size={13} /></span>
									<span class="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{q.label}{#if q.id === 'photos'} ({totalPhotos}){/if}</span>
									<Icon name="chevronRight" size={13} class="shrink-0 text-mist transition group-hover:translate-x-0.5 group-hover:text-brand" />
								</button>
							{/each}
						</div>
					</div>
					<div class="rounded-2xl border border-line bg-card p-4 shadow-sm">
						<div class="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-mist"><Icon name="clock3" size={13} class="shrink-0 text-brand" /> Dernières activités</div>
						<div class="mt-2.5 grid gap-1.5">
							{#if selected.user.lastSeenAt}
								<div class="flex items-center gap-2.5 rounded-xl border border-line/70 bg-white px-3 py-2">
									<span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-light text-brand-deep"><Icon name="smartphone" size={13} /></span>
									<span class="min-w-0 flex-1">
										<span class="block text-[13px] font-semibold text-ink">Connexion</span>
										<span class="block text-[11px] text-mist">{fmtLastSeen(selected.user.lastSeenAt)}</span>
									</span>
								</div>
							{/if}
							{#if latestAny.weightKg}
								<div class="flex items-center gap-2.5 rounded-xl border border-line/70 bg-white px-3 py-2">
									<span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-light text-brand-deep"><Icon name="scale" size={13} /></span>
									<span class="min-w-0 flex-1">
										<span class="block text-[13px] font-semibold text-ink">Poids enregistré</span>
										<span class="block text-[11px] text-mist">{String(latestAny.weightKg.value).replace('.', ',')} kg · {fmtDateShort(latestAny.weightKg.date)}</span>
									</span>
								</div>
							{/if}
							{#if mensDate}
								<div class="flex items-center gap-2.5 rounded-xl border border-line/70 bg-white px-3 py-2">
									<span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-warn-light text-warn"><Icon name="ruler" size={13} /></span>
									<span class="min-w-0 flex-1">
										<span class="block text-[13px] font-semibold text-ink">Mensurations</span>
										<span class="block text-[11px] text-mist">mises à jour le {fmtDateShort(mensDate)}</span>
									</span>
								</div>
							{/if}
							{#if sportOverview && sportOverview.activities > 0}
								<div class="flex items-center gap-2.5 rounded-xl border border-line/70 bg-white px-3 py-2">
									<span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-light text-brand-deep"><Icon name="dumbbell" size={13} /></span>
									<span class="min-w-0 flex-1">
										<span class="block text-[13px] font-semibold text-ink">Entraînement</span>
										<span class="block text-[11px] text-mist">{sportOverview.activities} activité{sportOverview.activities > 1 ? 's' : ''} · {Math.floor(sportOverview.durationMin / 60)} h {String(sportOverview.durationMin % 60).padStart(2, '0')} cette semaine</span>
									</span>
								</div>
							{/if}
							{#if lastPhotoDate}
								<div class="flex items-center gap-2.5 rounded-xl border border-line/70 bg-white px-3 py-2">
									<span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-soft text-ink"><Icon name="camera" size={13} /></span>
									<span class="min-w-0 flex-1">
										<span class="block text-[13px] font-semibold text-ink">Photos</span>
										<span class="block text-[11px] text-mist">{totalPhotos} photo{totalPhotos > 1 ? 's' : ''} · dernière le {fmtDateShort(lastPhotoDate)}</span>
									</span>
								</div>
							{/if}
							{#if messageLog.length > 0}
								<div class="flex items-center gap-2.5 rounded-xl border border-line/70 bg-white px-3 py-2">
									<span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-light text-brand-deep"><Icon name="messageCircle" size={13} /></span>
									<span class="min-w-0 flex-1">
										<span class="block text-[13px] font-semibold text-ink">Message publié</span>
										<span class="block text-[11px] text-mist">{fmtDateTime(messageLog[0].publishedAt)}{#if messageLog[0].isGlobal} · global{/if}</span>
									</span>
								</div>
							{/if}
							{#if !selected.user.lastSeenAt && !latestAny.weightKg && !mensDate && !(sportOverview && sportOverview.activities > 0) && !lastPhotoDate && messageLog.length === 0}
								<p class="rounded-xl border border-dashed border-line px-3 py-5 text-center text-[13px] text-mist">Aucune activité pour le moment.</p>
							{/if}
						</div>
					</div>
				</div>

				<!-- Historique des messages envoyés (journal CRM : daté, lu/non lu, réécoute) —
				     DERNIÈRE section de l'Aperçu : les infos opérationnelles passent d'abord. -->
				<div class="rounded-2xl border border-line bg-card p-4 shadow-sm">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<div class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-mist"><Icon name="clock3" size={13} class="shrink-0 text-brand" /> Historique des messages envoyés</div>
						<span class="text-[11px] text-mist">{messageLog.length} publication{messageLog.length > 1 ? 's' : ''}</span>
					</div>
					{#if messageLog.length === 0}
						<p class="mt-2 text-xs leading-relaxed text-mist">
							Aucun message publié pour le moment — chaque publication (texte et/ou audio) apparaîtra ici, datée, avec son état lu/non lu et la réécoute de l'audio.
						</p>
					{:else}
						<ul class="mt-3 space-y-2">
							{#each messageLog as msg (msg._id)}
								<li class="rounded-xl border border-line bg-white p-3">
									<div class="flex flex-wrap items-center justify-between gap-2">
										<span class="flex flex-wrap items-center gap-1.5">
											<span class="text-xs font-bold text-ink">{fmtDateTime(msg.publishedAt)}</span>
											{#if msg.isGlobal}
												<span class="rounded-full bg-ink px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white" title="Envoyé via le message global du Tableau de bord (clientes actives sur les 5 derniers jours)">Global</span>
											{/if}
										</span>
										<span class="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide {msg.readAt ? 'bg-line/70 text-mist' : 'bg-warn-light text-warn'}">{msg.readAt ? `✓ Lu le ${fmtDateTime(msg.readAt)}` : 'Non lu'}</span>
									</div>
									{#if msg.text}
										<p class="mt-1 text-sm leading-relaxed text-ink">{msg.text}</p>
									{/if}
									{#if msg.audio}
										<div class="mt-2 rounded-xl bg-brand-light/60 p-2.5">
											<p class="mb-1 inline-flex items-center gap-1.5 text-[11px] font-semibold text-brand-dark"><Icon name="mic" size={12} /> Message audio · {fmtMs(msg.audio.durationMs)}</p>
											<AudioPlayer src={msg.audio.url} durationMs={msg.audio.durationMs} accent="ink" />
										</div>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</div>

			<!-- ═══ Démarrage : formulaire initial + statuts de l'onboarding ═══ -->
			{:else if section === 'demarrage'}
				<div class="rounded-2xl border border-line bg-card px-5 py-4 shadow-sm">
					<div class="flex flex-wrap items-center justify-between gap-3">
						<div>
							<h3 class="flex items-center gap-2 font-display text-base font-semibold text-ink"><Icon name="rocket" size={17} class="shrink-0 text-brand" /> Onboarding de démarrage</h3>
							<p class="mt-0.5 text-xs leading-relaxed text-mist">
								Le formulaire initial sert de point de départ à l'accompagnement. Les étapes sont
								validées automatiquement côté cliente — aucune saisie manuelle ici.
							</p>
						</div>
						<form method="POST" action="?/setOnboarding&client={selected.user._id}&section={section}" class="shrink-0">
							<input type="hidden" name="userId" value={selected.user._id} />
							<input type="hidden" name="enabled" value={onboardingView?.enabled ? '0' : '1'} />
							<button
								type="submit"
								class="rounded-lg px-3 py-1.5 text-sm font-semibold transition {onboardingView?.enabled
									? 'bg-line text-ink hover:bg-line/70'
									: 'bg-brand text-white hover:bg-brand-dark'}"
							>
								{onboardingView?.enabled ? "Désactiver l'onboarding" : "Activer l'onboarding"}
							</button>
						</form>
					</div>

					<!-- Statut global + deux étapes (dérivés des données réelles) -->
					<div class="mt-3 grid gap-2 sm:grid-cols-4">
						<div class="rounded-xl bg-line/40 px-3 py-2 text-center">
							<div class="text-[10px] font-bold uppercase tracking-wider text-mist">Statut global</div>
							<div class="mt-0.5 text-sm font-bold {onboardingView?.done ? 'text-brand' : onboardingView?.enabled ? 'text-warn' : 'text-mist'}">
								{onboardingView
									? onboardingView.done
										? `Terminé ✓${onboardingView.completedAt ? ` · ${fmtTs(onboardingView.completedAt)}` : ''}`
										: onboardingView.enabled
											? 'En cours'
											: 'Inactif'
									: '—'}
							</div>
						</div>
						<div class="rounded-xl bg-line/40 px-3 py-2 text-center">
							<div class="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-mist"><Icon name="clipboardPen" size={12} class="shrink-0" /> Formulaire</div>
							<div class="mt-0.5 text-sm font-bold {onboardingView?.step1.done ? 'text-brand' : 'text-mist'}">
								{onboardingView?.step1.done ? '✓ Complété' : '○ En attente'}
							</div>
						</div>
						<div class="rounded-xl bg-line/40 px-3 py-2 text-center">
							<div class="flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wider text-mist"><Icon name="ruler" size={11} /> Mensurations</div>
							<div class="mt-0.5 text-sm font-bold {onboardingView?.step2.measurements ? 'text-brand' : 'text-mist'}">
								{onboardingView?.step2.measurements ? '✓ Complétées' : '○ En attente'}
							</div>
						</div>
						<div class="rounded-xl bg-line/40 px-3 py-2 text-center">
							<div class="flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wider text-mist"><Icon name="camera" size={11} /> Photos</div>
							<div class="mt-0.5 text-sm font-bold {onboardingView?.step2.photos ? 'text-brand' : 'text-mist'}">
								{onboardingView?.step2.photos ? '✓ Déposées' : '○ En attente'}
							</div>
						</div>
					</div>
				</div>

				<!-- Formulaire lu seul : questions + réponses de la cliente, groupées -->
				{#if onboardingView?.intake}
					<div class="rounded-2xl border border-line bg-card px-5 py-4 shadow-sm">
						<div class="flex flex-wrap items-center justify-between gap-2">
							<h3 class="flex items-center gap-2 font-display text-base font-semibold text-ink"><Icon name="clipboardList" size={17} class="shrink-0 text-brand" /> Formulaire de démarrage</h3>
							<div class="text-right text-[11px] text-mist">
								{#if onboardingView.intake.status === 'submitted'}
									<p class="font-semibold text-brand">Soumis{onboardingView.intake.submittedAt ? ` le ${fmtTs(onboardingView.intake.submittedAt)}` : ''}</p>
								{:else}
									<p class="font-semibold text-warn">Brouillon en cours — non soumis</p>
								{/if}
								<p>Modifié le {fmtTs(onboardingView.intake.updatedAt)}</p>
							</div>
						</div>
						<div class="mt-4 space-y-4">
							{#each obAnswered as block (block.section.id)}
								<div>										<h4 class="flex items-center gap-1.5 border-b border-line pb-1 text-[11px] font-bold uppercase tracking-widest text-mist">
											<Icon name={block.section.icon} size={14} class="shrink-0 text-brand" /> {block.section.title}
										</h4>
									<div class="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
										{#each block.items as item (item.q.id)}
											<div>
												<div class="text-[11px] font-semibold text-mist">{item.q.label}</div>
												<div class="text-sm font-medium text-ink">{item.v}</div>
											</div>
										{/each}
									</div>
								</div>
							{/each}
						</div>
					</div>
				{:else}
					<div class="rounded-2xl border border-dashed border-line bg-card px-5 py-8 text-center">
						<p class="grid place-items-center"><Icon name="inbox" size={36} class="text-mist" /></p>
						<p class="mt-2 text-sm font-semibold text-ink">Aucun formulaire pour l'instant</p>
						<p class="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-mist">
							Quand {selected.user.prenom} commencera son formulaire de démarrage (brouillon ou soumission),
							tes réponses apparaîtront ici en temps réel.
						</p>
					</div>
				{/if}

			<!-- ═══ Journal alimentaire : la coach agit en doublon ═══ -->
			{:else if section === 'journal'}
				<div class="rounded-2xl border border-line bg-card px-5 py-4 shadow-sm">
					<div class="flex flex-wrap items-center justify-between gap-3">
						<h3 class="flex items-center gap-1.5 font-display text-base font-semibold text-ink"><Icon name="notebook" size={17} class="shrink-0 text-brand" /> Journal alimentaire de {fullName(selected.user)}</h3>
						<div class="flex items-center gap-1.5">
							<!-- ‹ / › : navigation immédiate, une seule source de vérité (journalDate). -->
							<button
								type="button"
								onclick={() => shiftDay(-1)}
								disabled={journalBusy}
								aria-label="Jour précédent"
								title="Jour précédent"
								class="grid h-9 w-9 shrink-0 place-items-center rounded-lg border-2 border-line text-ink transition hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-40"
							>
								<Icon name="chevronLeft" size={16} />
							</button>
							<input
								type="date"
								value={journalDate}
								max={todayISO()}
								onchange={(e) => {
									const v = (e.currentTarget as HTMLInputElement).value;
									if (!v) return;
									journalDate = v;
									loadDay();
								}}
								class="rounded-lg border-2 border-line px-2 py-1.5 text-sm outline-none focus:border-brand"
							/>
							<button
								type="button"
								onclick={() => shiftDay(1)}
								disabled={journalBusy || journalAtToday}
								aria-label="Jour suivant"
								title="Jour suivant"
								class="grid h-9 w-9 shrink-0 place-items-center rounded-lg border-2 border-line text-ink transition hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-40"
							>
								<Icon name="chevronRight" size={16} />
							</button>
							<button onclick={loadDay} disabled={journalBusy} class="rounded-lg bg-ink px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-brand disabled:opacity-60">
								{journalBusy ? 'Chargement…' : 'Charger'}
							</button>
						</div>
					</div>
					<p class="mt-1 text-[11px] text-mist">Tu peux consulter et compléter le journal de ta cliente — « en doublon » avec elle. Le changement de date charge la journée automatiquement.</p>

					{#if journalMsg}
						<p class="mt-3 rounded-lg bg-danger-light px-3 py-2 text-xs font-semibold text-danger">{journalMsg}</p>
					{/if}

					{#if day}
						<!-- Même interface que l'espace cliente (composant partagé JournalDay). -->
						<div class="mt-4">
							<JournalDay
								{day}
								mode="coach"
							onAdd={(meal) => {
								addMeal = meal;
								foodSearch.clear(); // panneau propre à chaque ouverture
								searchOpen = true;
							}}
								onQty={setQty}
								onRemove={removeEntry}
							/>
						</div>
					{:else if !journalBusy}
						<p class="mt-4 rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-mist">Clique sur « Charger » pour afficher la journée.</p>
					{/if}
				</div>

				{#if searchOpen}
					<button type="button" class="fixed inset-0 z-[60] cursor-pointer bg-ink/50" aria-label="Fermer la recherche" onclick={() => (searchOpen = false)}></button>
					<div class="fixed inset-x-0 bottom-0 z-[60] mx-auto w-full max-w-2xl rounded-t-3xl border-t border-line bg-card p-5 shadow-2xl sm:inset-y-0 sm:right-0 sm:left-auto sm:w-96 sm:rounded-l-3xl sm:rounded-tr-none sm:rounded-br-none sm:border-l">
						<div class="flex items-center justify-between">
							<h4 class="font-display text-base font-semibold text-ink">＋ Ajouter un aliment</h4>
							<button onclick={() => (searchOpen = false)} class="rounded-lg px-2 py-1 text-lg text-mist hover:text-ink">✕</button>
						</div>
						<!-- Recherche RÉACTIVE (moteur PWA) : les résultats se mettent à
						     jour pendant la frappe (debounce 300 ms) — Enter reste un
						     accéléateur, jamais obligatoire. Plus de bouton « Chercher ». -->
						<div class="mt-3 flex items-center gap-2 rounded-xl border-2 border-line bg-cream px-3 py-2 focus-within:border-brand">
							<Icon name="search" size={17} class="shrink-0 text-mist" />
							<input
								type="search"
								bind:value={foodSearch.state.q}
								oninput={() => foodSearch.setQuery(foodSearch.state.q)}
								onkeydown={(e) => e.key === 'Enter' && foodSearch.runNow()}
								placeholder="Rechercher un aliment (ex. riz)…"
								class="w-full bg-transparent text-sm text-ink outline-none placeholder:text-mist"
							/>
							{#if foodSearch.state.q}
								<button
									type="button"
									class="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-line/70 text-mist transition hover:bg-line"
									aria-label="Effacer la recherche"
									onclick={() => foodSearch.clear()}
								><Icon name="x" size={13} /></button>
							{/if}
						</div>
						<div class="mt-3 flex items-center gap-3">
							<label class="block">
								<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Repas</span>
								<select bind:value={addMeal} class="rounded-lg border-2 border-line px-2 py-1.5 text-sm outline-none focus:border-brand">
									{#each MEALS as m}
										<option value={m.id}>{m.label}</option>
									{/each}
								</select>
							</label>
							<label class="block">
								<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Quantité (g)</span>
								<input type="number" bind:value={addQty} min="1" max="5000" class="w-24 rounded-lg border-2 border-line px-2 py-1.5 text-sm outline-none focus:border-brand" />
							</label>
							{#if foodSearch.state.searching}<span class="ml-auto text-[11px] text-mist">Recherche…</span>{/if}
						</div>
						<div class="mt-3 max-h-[50vh] space-y-1 overflow-y-auto">
							{#if foodSearch.state.error}
								<p class="py-6 text-center text-xs text-danger">{foodSearch.state.error}</p>
							{:else if foodSearch.state.q.trim().length < 2}
								<p class="py-6 text-center text-xs text-mist">Tape au moins 2 lettres pour chercher dans la base.</p>
							{:else if foodSearch.state.products.length === 0 && foodSearch.state.ciqual.length === 0 && !foodSearch.state.searching}
								<p class="py-6 text-center text-xs text-mist">Aucun résultat pour « {foodSearch.state.q.trim()} ».</p>
							{:else}
								<!-- 1. CIQUAL : aliments de RÉFÉRENCE (génériques) — bloc séparé,
								     toujours en tête ; aucun résultat pertinent = pas de bloc. -->
								{#if foodSearch.state.ciqual.length > 0}
									<div class="flex items-baseline justify-between px-1 pb-1">
										<p class="text-[10px] font-bold uppercase tracking-widest text-mist">Aliments de référence</p>
										<span class="text-[10px] text-mist">Ciqual – ANSES</span>
									</div>
									<div class="space-y-1">
										{#each foodSearch.state.ciqual as hit (hit._id)}
											<button
												onclick={() => addFood(hit)}
												class="flex w-full items-center gap-3 rounded-xl border border-brand/30 bg-brand-light/40 px-3 py-2 text-left transition hover:border-brand"
											>
												<span class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-light"><Icon name="salad" size={18} class="text-brand" /></span>
												<div class="min-w-0 flex-1">
													<div class="truncate text-sm font-semibold text-ink">{hit.name}</div>
													<div class="text-[11px] text-mist">{hit.kcal100} kcal/100 g · <span class="font-bold text-brand">Référence Ciqual – ANSES</span> · Idéal pour un suivi précis</div>
												</div>
												<span class="text-brand">＋</span>
											</button>
										{/each}
									</div>
								{/if}
								<!-- 2. PRODUITS : Open Food Facts (moteur classé PWA, ranking
								     identique côté cliente ; la liste reste affichée pendant
								     une nouvelle frappe, sans clignotement). -->
								{#if foodSearch.state.products.length > 0}
									<p class="px-1 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-mist">Produits · Open Food Facts</p>
									<div class="space-y-1 transition-opacity {foodSearch.state.searching ? 'opacity-50' : ''}">
										{#each foodSearch.state.products as hit (hit._id)}
											<button
												onclick={() => addFood(hit)}
												class="flex w-full items-center gap-3 rounded-xl border border-line bg-white px-3 py-2 text-left transition hover:border-brand"
											>
												{#if hit.thumbUrl || hit.imageUrl}
													<FoodImg src={hit.thumbUrl} fallbackSrc={hit.imageUrl} alt="" class="h-9 w-9 shrink-0 rounded-lg" />
												{:else}
													<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-line/60"><Icon name="apple" size={16} class="text-mist" /></div>
												{/if}
												<div class="min-w-0 flex-1">
													<div class="truncate text-sm font-semibold text-ink">{hit.name}</div>
													<div class="text-[11px] text-mist">{hit.kcal100} kcal/100 g{#if hit.kcalRecalculated}<span class="ml-1 rounded bg-line/70 px-1 py-px text-[9px] font-semibold text-mist">Valeur recalculée</span>{/if}{hit.brand ? ` · ${hit.brand}` : ''}</div>
												</div>
												<span class="text-brand">＋</span>
											</button>
										{/each}
									</div>
									{#if foodSearch.state.loadingMore}<p class="py-2 text-center text-xs text-mist">Chargement…</p>{/if}
								{/if}
							{/if}
						</div>
					</div>
				{/if}

			{:else if section === 'entrainement'}
			<!-- ═══ Entraînement : assignation & suivi (module dédié) ═══ -->
			{#if selectedId}
				<TrainingPanel userId={selectedId} />
			{/if}

			{:else if section === 'plan'}
			<!-- ═══ Plan de repas : assignation coach → cliente ═══ -->
			<div class="rounded-2xl border border-line bg-card px-5 py-4 shadow-sm">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<h3 class="flex items-center gap-1.5 font-display text-base font-semibold text-ink"><Icon name="utensils" size={17} class="shrink-0 text-brand" /> Plan de repas de {fullName(selected.user)}</h3>
					<div class="flex items-center gap-1.5">
						<a href="/admin/plans" class="rounded-lg border-2 border-line px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-brand hover:text-brand">Bibliothèque des plans →</a>
						{#if activeAssignment}
							<button type="button" onclick={() => { assignOpen = true; }} class="rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand">Changer</button>
							<button type="button" onclick={() => removePlan(activeAssignment._id)} class="rounded-lg border-2 border-line px-3 py-1.5 text-xs font-semibold text-danger transition hover:border-danger">Retirer le plan</button>
						{:else}
							<button type="button" onclick={() => { assignOpen = true; }} disabled={plansList.length === 0} class="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50" title={plansList.length === 0 ? 'Crée d’abord un plan dans la bibliothèque.' : ''}>Assigner un plan</button>
						{/if}
					</div>
				</div>

				{#if planMsg}
					<p class="mt-3 rounded-lg bg-brand-light px-3 py-2 text-xs font-semibold text-ink">{planMsg}</p>
				{/if}

				{#if planLoading}
					<p class="py-8 text-center text-sm text-mist">Chargement…</p>
				{:else if !activeAssignment}
					<div class="mt-4 rounded-xl border border-dashed border-line px-4 py-10 text-center">
						<p class="text-sm font-semibold text-ink">Aucun plan actif</p>
						<p class="mx-auto mt-1 max-w-sm text-xs text-mist">Assigne une journée type : les aliments apparaissent automatiquement dans le journal de {selected.user.prenom} aux dates concernées — en gris (planifié), sans impact sur ses calories consommées tant qu'elle ne valide pas « Mangé ».</p>
						{#if plansList.length === 0}
							<p class="mt-3 text-xs text-mist">Crée d'abord un plan dans la <a href="/admin/plans" class="font-semibold text-brand underline">bibliothèque</a>.</p>
						{:else}
							<button type="button" onclick={() => (assignOpen = true)} class="mt-3 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-dark">Assigner un plan</button>
						{/if}
					</div>
				{:else}
					<!-- PLAN ACTIF -->
					<div class="mt-4 rounded-xl border border-brand/40 bg-brand-light/30 p-4">
						<p class="text-[10px] font-bold uppercase tracking-widest text-brand-dark">Plan actif</p>
						<p class="mt-1 font-display text-lg font-semibold text-ink">{activeAssignment.templateName}</p>
						{#if activeAssignment.totalKcal > 0}
							<p class="text-xs text-mist tabular-nums">≈ {activeAssignment.totalKcal.toLocaleString('fr-FR')} kcal / jour</p>
						{/if}
						<p class="mt-2 text-xs text-ink">Du <strong>{fmtISO(activeAssignment.startDate)}</strong> au <strong>{fmtISO(activeAssignment.endDate)}</strong></p>
						{#if activeAssignment.weekdays.length < 7}
							<p class="mt-0.5 text-[11px] text-mist">Jours concernés : {[1, 2, 3, 4, 5, 6, 7].filter((d) => activeAssignment.weekdays.includes(d)).map((d) => DAY_LABELS[d - 1]).join(' ')}</p>
						{/if}
					</div>
				{/if}

				{#if assignments.filter((a) => a.removedAt).length > 0}
					<details class="mt-3">
						<summary class="cursor-pointer text-xs font-semibold text-mist hover:text-ink">Historique des plans retirés ({assignments.filter((a) => a.removedAt).length})</summary>
						<ul class="mt-2 flex flex-col gap-1.5">
							{#each assignments.filter((a) => a.removedAt) as a (a._id)}
								<li class="rounded-lg border border-line px-3 py-2 text-xs text-mist">
									<strong class="text-ink">{a.templateName}</strong> · {fmtISO(a.startDate)} → {fmtISO(a.endDate)}
								</li>
							{/each}
						</ul>
					</details>
				{/if}
			</div>

			<!-- Modal d'assignation -->
			{#if assignOpen}
				<button type="button" class="fixed inset-0 z-[70] cursor-pointer bg-ink/50" aria-label="Fermer" onclick={() => (assignOpen = false)}></button>
				<div class="fixed inset-x-0 bottom-0 z-[70] mx-auto w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl sm:inset-y-0 sm:right-0 sm:left-auto sm:rounded-l-3xl">
					<div class="flex items-center justify-between">
						<h4 class="font-display text-base font-semibold text-ink">Assigner un plan</h4>
						<button type="button" onclick={() => (assignOpen = false)} class="rounded-lg px-2 py-1 text-lg text-mist hover:text-ink" aria-label="Fermer">✕</button>
					</div>
					<label class="mt-4 block">
						<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Plan</span>
						<select bind:value={assignTemplateId} class="w-full rounded-xl border-2 border-line px-3 py-2.5 text-sm outline-none focus:border-brand">
							<option value="" disabled>Sélectionner…</option>
							{#each plansList as p (p._id)}
								<option value={p._id}>{p.name} · {p.totalKcal.toLocaleString('fr-FR')} kcal</option>
							{/each}
						</select>
					</label>
					<div class="mt-3 grid grid-cols-2 gap-2">
						<label class="block">
							<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Date de début</span>
							<input type="date" bind:value={assignStart} class="w-full rounded-xl border-2 border-line px-3 py-2.5 text-sm outline-none focus:border-brand" />
						</label>
						<label class="block">
							<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Date de fin</span>
							<input type="date" bind:value={assignEnd} min={assignStart} class="w-full rounded-xl border-2 border-line px-3 py-2.5 text-sm outline-none focus:border-brand" />
						</label>
					</div>
					<fieldset class="mt-3">
						<legend class="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-mist">Jours concernés (tous par défaut)</legend>
						<div class="flex gap-1.5">
							{#each [1, 2, 3, 4, 5, 6, 7] as d (d)}
								<button
									type="button"
									onclick={() => toggleAssignDay(d)}
									class="grid h-9 w-9 place-items-center rounded-full border-2 text-xs font-bold transition {assignDays.includes(d) ? 'border-brand bg-brand text-white' : 'border-line text-mist hover:border-brand'}"
								>{DAY_LABELS[d - 1]}</button>
							{/each}
						</div>
					</fieldset>
					<p class="mt-3 text-[11px] leading-snug text-mist">Les aliments du plan apparaissent dans le journal aux dates concernées, en gris (planifié). Ta cliente les valide en touchant le cercle « Mangé » — rien n'est compté automatiquement.</p>
					<button
						type="button"
						onclick={confirmAssign}
						disabled={assignBusy || !assignTemplateId || !assignStart}
						class="mt-4 w-full rounded-full bg-brand px-3 py-3 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-60"
					>
						{assignBusy ? 'Assignation…' : 'Assigner ce plan'}
					</button>
				</div>
			{/if}

			<!-- ═══ Poids & mensurations ═══ -->
			{:else if section === 'corps'}
				<div class="rounded-2xl border border-line bg-card px-5 py-4 shadow-sm">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<h3 class="flex items-center gap-1.5 font-display text-base font-semibold text-ink"><Icon name="scale" size={17} class="shrink-0 text-brand" /> Poids & mensurations de {fullName(selected.user)}</h3>
						<span class="text-[11px] text-mist">Chaque métrique a son propre historique — tout est visible côté cliente.</span>
					</div>

					{#if bmMsg}
						<p class="mt-3 rounded-lg bg-brand-light px-3 py-2 text-xs font-semibold text-ink">{bmMsg}</p>
					{/if}

					{#if corpsDetail}
						<!-- Vue détaillée d'une métrique : courbe complète interactive + historique -->
						<button
							type="button"
							onclick={() => (corpsDetail = null)}
							class="mt-3 inline-flex items-center gap-1 rounded-lg border-2 border-line px-2.5 py-1.5 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand"
						><Icon name="arrowLeft" size={14} class="shrink-0" /> Retour aux métriques</button>

						{#if corpsMeta}
							{@const meta = corpsMeta}
							{@const rows = corpsRows}
							{@const editing = bmEdit?.key === meta.key}
							{@const draft = bmDraft[meta.key] ?? { date: todayISO(), value: '' }}
								<div id={`bm-form-${meta.key}`} class="mt-3 rounded-xl border border-line p-3">
									<div class="flex flex-wrap items-center justify-between gap-2">
										<h5 class="flex items-center gap-1.5 text-sm font-bold text-ink"><Icon name={meta.icon} size={15} class="shrink-0" /> {meta.label} <span class="font-normal text-mist">({meta.unit})</span></h5>
										<span class="text-[11px] text-mist">{rows.length} entrée(s)</span>
									</div>
									{#if rows.length > 0}
										{@const last = rows[rows.length - 1]}
										{@const delta = metricDelta(rows)}
										<div class="mt-2">
											<div class="font-display text-2xl font-semibold text-ink">{String(last.value).replace('.', ',')} {meta.unit}</div>
											{#if delta !== null}
												<div class="text-[11px] font-medium text-mist">{fmtSigned(delta)} {meta.unit} depuis le démarrage</div>
											{/if}
										</div>
										<div class="mt-2 rounded-lg bg-line/40 px-3 py-2">
											<MetricTrend points={rows} color={meta.color} unit={meta.unit} height={110} />
										</div>
									{/if}
									<div class="mt-2 flex flex-wrap items-center gap-2">
										<input type="date" bind:value={draft.date} class="rounded-lg border-2 border-line px-2 py-1.5 text-sm outline-none focus:border-brand" aria-label={`Date — ${meta.label}`} />
										<input type="number" inputmode="decimal" min={meta.min} max={meta.max} step="0.1" bind:value={draft.value} placeholder={`Ex. ${meta.min}`} class="w-24 rounded-lg border-2 border-line px-2 py-1.5 text-sm outline-none focus:border-brand" aria-label={`Valeur — ${meta.label}`} />
										{#if editing}
											<button onclick={() => editBodyMetric(meta.key)} disabled={bmBusy} class="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
												{bmBusy ? '…' : 'Enregistrer la modification'}
											</button>
											<button onclick={() => { bmEdit = null; bmDraft[meta.key] = { date: todayISO(), value: '' }; }} class="rounded-lg border-2 border-line px-3 py-1.5 text-xs font-semibold text-mist transition hover:border-ink hover:text-ink">Annuler</button>
										{:else}
											<button onclick={() => addBodyMetric(meta.key)} disabled={bmBusy} class="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
												{bmBusy ? '…' : 'Ajouter une mesure'}
											</button>
										{/if}
									</div>
									{#if rows.length === 0}
										<p class="mt-2 text-xs italic text-mist">Aucune entrée pour l'instant.</p>
									{:else}
										<ul class="mt-2 divide-y divide-line/60">
											{#each [...rows].reverse() as r (r.date)}
												<li class="flex items-center gap-2 py-1.5">
													<span class="min-w-0 flex-1 text-sm text-ink">
														<strong class="font-bold">{String(r.value).replace('.', ',')} {meta.unit}</strong>
														<span class="text-mist"> · {fmtDateShort(r.date)}</span>
													</span>
													<button onclick={() => startBmEdit(meta.key, r.date, r.value)} class="rounded-lg px-2 py-1 text-xs text-mist transition hover:bg-line/60 hover:text-ink" title="Modifier cette valeur" aria-label={`Modifier ${meta.label} du ${fmtDateShort(r.date)}`}>✎</button>
													<button onclick={() => deleteMetric(r.date, meta.key)} class="inline-flex items-center rounded-lg px-2 py-1 text-danger/70 transition hover:bg-danger-light hover:text-danger" title="Supprimer cette valeur" aria-label={`Supprimer ${meta.label} du ${fmtDateShort(r.date)}`}><Icon name="trash" size={13} /></button>
												</li>
											{/each}
										</ul>										{/if}
									</div>

						{:else if corpsDetail.kind === 'height'}
							<div id="bm-form-heightCm" class="mt-3 rounded-xl border border-line p-3">
								<div class="flex flex-wrap items-center justify-between gap-2">
									<h5 class="flex items-center gap-1.5 text-sm font-bold text-ink"><Icon name="ruler" size={14} class="shrink-0 text-brand" /> Taille <span class="font-normal text-mist">(cm)</span></h5>
									<span class="text-[11px] text-mist">{heightCm != null ? `valeur actuelle : ${String(heightCm).replace('.', ',')} cm` : 'non renseignée'}</span>
								</div>
								{#if heightSeries.length > 0}
									{@const hLast = heightSeries[heightSeries.length - 1]}
									{@const hDelta = metricDelta(heightSeries)}
									<div class="mt-2">
										<div class="font-display text-2xl font-semibold text-ink">{String(hLast.value).replace('.', ',')} cm</div>
										{#if hDelta !== null}
											<div class="text-[11px] font-medium text-mist">{fmtSigned(hDelta)} cm depuis le démarrage</div>
										{/if}
									</div>
									<div class="mt-2 rounded-lg bg-line/40 px-3 py-2">
										<MetricTrend points={heightSeries} color="#a855f7" unit="cm" height={110} />
									</div>
								{/if}
								<div class="mt-2 flex flex-wrap items-center gap-2">
									<input type="date" bind:value={hDraft.date} class="rounded-lg border-2 border-line px-2 py-1.5 text-sm outline-none focus:border-brand" aria-label="Date — Taille" />
									<input type="number" inputmode="decimal" min="80" max="250" step="0.1" bind:value={hDraft.value} placeholder="Ex. 165" class="w-24 rounded-lg border-2 border-line px-2 py-1.5 text-sm outline-none focus:border-brand" aria-label="Valeur — Taille" />
									<button onclick={saveHeightCrm} disabled={hBusy} class="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
										{hBusy ? '…' : heightCm != null ? 'Modifier la taille' : 'Ajouter la taille'}
									</button>
								</div>
								{#if heightSeries.length === 0}
									<p class="mt-2 text-xs italic text-mist">Aucun historique pour l'instant — la taille actuelle est affichée ci-dessus.</p>
								{:else}
									<ul class="mt-2 divide-y divide-line/60">
										{#each [...heightSeries].reverse() as r (r.date)}
											<li class="flex items-center gap-2 py-1.5">
												<span class="min-w-0 flex-1 text-sm text-ink"><strong class="font-bold">{String(r.value).replace('.', ',')} cm</strong><span class="text-mist"> · {fmtDateShort(r.date)}</span></span>
											</li>
										{/each}
									</ul>
								{/if}
							</div>

						{:else}
							<!-- Masse grasse estimée : dérivée côté Convex, lecture seule -->
							<div class="mt-3 rounded-xl border border-line p-3">
								<div class="flex flex-wrap items-center justify-between gap-2">
									<h5 class="flex items-center gap-1.5 text-sm font-bold text-ink"><Icon name="target" size={15} class="shrink-0 text-brand" /> Masse grasse estimée</h5>
									<span class="text-[11px] text-mist">US Navy — automatique, non modifiable</span>
								</div>
								{#if bfPoints.length > 0}
									<div class="mt-2">
										<div class="font-display text-2xl font-semibold text-ink">{String(bfLast).replace('.', ',')} %</div>
										{#if bfDelta !== null}
											<div class="text-[11px] font-medium text-mist">{bfDelta <= 0 ? '↓' : '↑'} {String(Math.abs(bfDelta)).replace('.', ',')} % depuis le démarrage</div>
										{/if}
									</div>
									<div class="mt-2 rounded-lg bg-line/40 px-3 py-2">
										<MetricTrend points={bfPoints} color="#a855f7" unit="%" height={110} />
									</div>
									<ul class="mt-2 divide-y divide-line/60">
										{#each [...bfPoints].reverse() as r (r.date)}
											<li class="flex items-center gap-2 py-1.5">
												<span class="min-w-0 flex-1 text-sm text-ink"><strong class="font-bold">{String(r.value).replace('.', ',')} %</strong><span class="text-mist"> · {fmtDateShort(r.date)}</span></span>
											</li>
										{/each}
									</ul>
									<p class="mt-1 text-[11px] text-mist">Calculée avec les dernières valeurs connues de tour de taille fine, fessiers, tour de cou et taille — même valeur que dans l'espace cliente.</p>
								{:else}
									<p class="mt-2 text-xs italic text-mist">Renseigne la taille et au moins un tour de taille fine, fessiers ou tour de cou pour obtenir une estimation (les autres mesures se complètent au fil des saisies).</p>
								{/if}
							</div>
						{/if}
					{:else}
						<!-- Cartes par métrique : valeur actuelle + mini-courbe interactive. Un clic ouvre le détail. -->
						<div class="mt-3 grid gap-3 sm:grid-cols-2">
							{#each BODY_METRICS as meta (meta.key)}
								{@const rows = bmSeries(meta.key)}
								<button
									type="button"
									onclick={() => (corpsDetail = { kind: 'metric', key: meta.key })}
									class="rounded-xl border border-line bg-card p-3 text-left transition hover:border-brand"
								>
									<div class="flex flex-wrap items-center justify-between gap-2">
										<h5 class="flex items-center gap-1.5 text-sm font-bold text-ink"><Icon name={meta.icon} size={15} class="shrink-0" /> {meta.label} <span class="font-normal text-mist">({meta.unit})</span></h5>
										<span class="text-[11px] text-mist">{rows.length} entrée(s)</span>
									</div>
									{#if rows.length > 0}
										{@const last = rows[rows.length - 1]}
										{@const delta = metricDelta(rows)}
										<div class="mt-2 flex items-end justify-between gap-3">
											<div class="min-w-0">
												<div class="font-display text-xl font-semibold text-ink">{String(last.value).replace('.', ',')} {meta.unit}</div>
												{#if delta !== null}
													<div class="text-[11px] font-medium text-mist">{fmtSigned(delta)} {meta.unit} depuis le démarrage</div>
												{/if}
											</div>
											<div class="w-28 shrink-0 sm:w-36">
												<MetricTrend points={rows} color={meta.color} unit={meta.unit} height={44} />
											</div>
										</div>
									{:else}
										<p class="mt-2 text-xs italic text-mist">Aucune entrée pour l'instant — clique pour ajouter.</p>
									{/if}
									<span class="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-brand">Voir le détail <Icon name="chevronRight" size={12} /></span>
								</button>
							{/each}

							<!-- Taille (hauteur) -->
							<button
								type="button"
								onclick={() => (corpsDetail = { kind: 'height' })}
								class="rounded-xl border border-line bg-card p-3 text-left transition hover:border-brand"
							>
								<div class="flex flex-wrap items-center justify-between gap-2">
									<h5 class="flex items-center gap-1.5 text-sm font-bold text-ink"><Icon name="ruler" size={15} class="shrink-0" /> Taille <span class="font-normal text-mist">(cm)</span></h5>
									<span class="text-[11px] text-mist">{heightCm != null ? `actuelle : ${String(heightCm).replace('.', ',')} cm` : 'non renseignée'}</span>
								</div>
								{#if heightSeries.length > 0}
									{@const hLast = heightSeries[heightSeries.length - 1]}
									{@const hDelta = metricDelta(heightSeries)}
									<div class="mt-2 flex items-end justify-between gap-3">
										<div class="min-w-0">
											<div class="font-display text-xl font-semibold text-ink">{String(hLast.value).replace('.', ',')} cm</div>
											{#if hDelta !== null}
												<div class="text-[11px] font-medium text-mist">{fmtSigned(hDelta)} cm depuis le démarrage</div>
											{/if}
										</div>
										<div class="w-28 shrink-0 sm:w-36">
											<MetricTrend points={heightSeries} color="#a855f7" unit="cm" height={44} />
										</div>
									</div>
								{:else}
									<p class="mt-2 text-xs italic text-mist">Aucun historique pour l'instant.</p>
								{/if}
								<span class="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-brand">Voir le détail <Icon name="chevronRight" size={12} /></span>
							</button>

							<!-- Masse grasse estimée -->
							<button
								type="button"
								onclick={() => (corpsDetail = { kind: 'bodyfat' })}
								class="rounded-xl border border-line bg-card p-3 text-left transition hover:border-brand"
							>
								<div class="flex flex-wrap items-center justify-between gap-2">
									<h5 class="flex items-center gap-1.5 text-sm font-bold text-ink"><Icon name="target" size={15} class="shrink-0" /> Masse grasse estimée</h5>
									<span class="text-[11px] text-mist">{bfPoints.length} entrée(s)</span>
								</div>
								{#if bfPoints.length > 0}
									<div class="mt-2 flex items-end justify-between gap-3">
										<div class="min-w-0">
											<div class="font-display text-xl font-semibold text-ink">{String(bfLast).replace('.', ',')} %</div>
											{#if bfDelta !== null}
												<div class="text-[11px] font-medium text-mist">{bfDelta <= 0 ? '↓' : '↑'} {String(Math.abs(bfDelta)).replace('.', ',')} % depuis le démarrage</div>
											{/if}
										</div>
										<div class="w-28 shrink-0 sm:w-36">
											<MetricTrend points={bfPoints} color="#a855f7" unit="%" height={44} />
										</div>
									</div>
								{:else}
									<p class="mt-2 text-xs italic text-mist">Aucune estimation pour l'instant — renseigne tour de taille fine + fessiers + cou.</p>
								{/if}
								<span class="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-brand">Voir le détail <Icon name="chevronRight" size={12} /></span>
							</button>
						</div>
					{/if}
				</div>

			<!-- ═══ Photos de suivi ═══ -->
			{:else if section === 'photos'}
				<div class="rounded-2xl border border-line bg-card px-5 py-4 shadow-sm">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<h3 class="flex items-center gap-1.5 font-display text-base font-semibold text-ink"><Icon name="camera" size={17} class="shrink-0 text-brand" /> Photos de suivi de {selected.user.prenom}</h3>
						<span class="text-[11px] text-mist">{photos.length} série(s) · {totalPhotos} photo(s) — conservées définitivement</span>
					</div>
					{#if photos.length === 0}
						<p class="mt-3 rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-mist">
							Aucune photo reçue pour l’instant. Quand {selected.user.prenom} envoie une série, elle apparaît ici.
						</p>
					{:else}
						{#each photos as group (group._id)}
							<div class="mt-4">
								<div class="flex flex-wrap items-center gap-2">
									<span class="rounded-full bg-brand-light px-3 py-1 text-xs font-bold text-brand-dark">{PHOTO_STEP_LABELS[group.step] ?? group.step}</span>
									<span class="text-xs text-mist">reçue le {fmtDateShort(group.date)}</span>
								</div>
								<div class="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
									{#each group.photos as photo, idx}
										<figure class="relative overflow-hidden rounded-xl border border-line bg-white">
											{#if photo.url}
												<a href={photo.url} target="_blank" rel="noreferrer" aria-label={`Voir ${photo.label}`}>
													<img src={photo.url} alt={photo.label} class="h-44 w-full object-contain" loading="lazy" />
												</a>
												<button
													type="button"
													title="Télécharger la photo"
													aria-label={`Télécharger ${photo.label ?? `la photo ${idx + 1}`}`}
													onclick={(e) => {
														e.preventDefault();
														e.stopPropagation();
														void downloadPhoto(photo, group, idx, selected.user.prenom);
													}}
													class="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-ink/55 text-white backdrop-blur-sm transition hover:bg-brand active:scale-95"
												><Icon name="download" size={13} /></button>
										{:else}
											<div class="flex h-44 items-center justify-center bg-line/40 text-sm text-mist">Image indisponible</div>
										{/if}
										<figcaption class="truncate px-2 py-1 text-[11px] text-mist">{photo.label}</figcaption>
										</figure>
									{/each}
								</div>
							</div>
						{/each}
					{/if}
				</div>

			<!-- ═══ Bilans : cockpit hebdo + historique des échanges ═══ -->
			{:else if section === 'bilans'}
				<div class="space-y-4">
					<!-- Retour vers la vue globale des bilans (CRM) -->
					<div class="flex flex-wrap items-center justify-between gap-2">
						<a
							href={`/admin/bilans${weekParam ? `?week=${encodeURIComponent(weekParam)}` : ''}`}
							class="inline-flex items-center gap-1 rounded-lg border-2 border-line bg-card px-2.5 py-1.5 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand"
						><Icon name="arrowLeft" size={14} class="shrink-0" /> Tous les bilans</a>
						<span class="text-[11px] text-mist">Bilans de {fullName(selected.user)} — semaine après semaine</span>
					</div>
					{#if checkins.length === 0}
						<div class="rounded-2xl border border-dashed border-line bg-card px-6 py-10 text-center">
							<p class="grid place-items-center"><Icon name="calendarDays" size={30} class="text-mist" /></p>
							<p class="mt-2 text-sm text-ink">Aucun bilan reçu pour {selected.user.prenom} pour l’instant.</p>
							<p class="mt-1 text-xs text-mist">Transmets ses identifiants (email + mot de passe) pour qu’elle commence son suivi.</p>
						</div>
					{:else if cockpit}
						<!-- Synthèse de la semaine concernée par le bilan le plus récent -->
						<div class="rounded-2xl border border-line bg-card shadow-sm">
							<div class="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
								<div>
									<div class="text-[11px] font-bold uppercase tracking-wider text-mist">
										Semaine du {fmtRangeShort(cockpit.weekStart)} au {fmtRangeShort(cockpit.weekEnd)}
									</div>
									<div class="mt-0.5 flex items-center gap-2">
										<h3 class="font-display text-base font-semibold text-ink">{cockpit.weekLabel}</h3>
										{#if cockpitPill}
											<span class="rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide {cockpitPill.cls}">{cockpitPill.label}</span>
										{/if}
									</div>
								</div>
								<span class="text-xs text-mist">
									Bilan reçu {fmtDateTime(cockpit.bilan.receivedAt)}
									{#if cockpit.bilan.status === 'retour_envoye' && cockpit.bilan.feedbackAt}
										· retour publié {fmtDateTime(cockpit.bilan.feedbackAt)}
										{#if cockpit.bilan.readAt}
											· lu le {fmtDateTime(cockpit.bilan.readAt)}
										{/if}
									{/if}
								</span>
							</div>

							<!-- Vision 360 compacte : 3+3 cartes pilotage + 2 cartes repères larges.
							     Cartes « chiffres » (Poids, Calories, Pas, Protéines) → nombre fort +
							     repères secondaires en petit ; cartes « repères » (Cycle, RDV,
							     Mensurations, Photos) → une info par ligne, hauteur minimale,
							     jamais de grande carte vide quand la donnée manque. -->
							<div class="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
								{#snippet cardHead(icon: string, label: string, right?: string)}
									<div class="flex items-center justify-between gap-2">
										<div class="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-mist"><Icon name={icon} size={12} /> {label}</div>
										{#if right}<span class="text-[10px] font-semibold tabular-nums text-mist">{right}</span>{/if}
									</div>
								{/snippet}

					<!-- POIDS — VISION 360 LIVE (7 jours complets) : moyenne principale + dernière pesée vs période précédente -->
					<div class="flex flex-col rounded-xl border border-line bg-cream/40 p-3">
						{@render cardHead('scale', 'Poids', cockpit.weight.count > 0 ? `${cockpit.weight.count} pesée${cockpit.weight.count > 1 ? 's' : ''}` : undefined)}
						{#if cockpit.weight.avg !== null}
							<div class="mt-1 flex flex-wrap items-baseline gap-x-2">
								<span class="font-display text-2xl font-semibold text-ink">{fmtVal(cockpit.weight.avg)} kg</span>
								{#if cockpit.weight.delta !== null}
									<span class="rounded-full bg-soft px-1.5 py-0.5 text-[10px] font-bold text-ink">{fmtSigned(cockpit.weight.delta)} kg</span>
								{/if}
							</div>
							<p class="mt-0.5 text-[11px] text-mist">Moyenne des 7 derniers jours terminés</p>
							{#if cockpit.weight.last}
								<p class="mt-1.5 border-t border-line/60 pt-1.5 text-[11px] leading-snug text-mist">
									Dernière pesée <strong class="text-ink">{fmtVal(cockpit.weight.last.weightKg)} kg</strong>
									{#if cockpit.weight.last.date}<span class="tabular-nums"> · {fmtDateShort(cockpit.weight.last.date)}</span>{/if}
									{#if cockpit.weight.prevLast}
										<br />vs {fmtVal(cockpit.weight.prevLast.weightKg)} kg
										{#if cockpit.weight.prevLast.date}<span class="tabular-nums"> · {fmtDateShort(cockpit.weight.prevLast.date)}</span>{/if}								{:else}
									<br /><span class="italic">comparaison indisponible (période précédente sans pesée)</span>
								{/if}
								</p>
							{/if}
						{:else}
							<div class="mt-1 font-display text-2xl font-semibold text-mist/50">—</div>
							<p class="mt-0.5 text-[11px] italic text-mist">Aucune pesée sur les 7 derniers jours terminés</p>
						{/if}
					</div>

					<!-- CALORIES — VISION 360 LIVE : moyenne sur jours EXPLOITABLES (garde-fou tracking) -->
					<div class="flex flex-col rounded-xl border border-line bg-cream/40 p-3">
						{@render cardHead('flame', 'Calories', `${cockpit.calories.trackedDays}/7 j exploitables`)}
						{#if cockpit.calories.avg !== null}
							<div class="mt-1 font-display text-2xl font-semibold text-ink">{cockpit.calories.avg.toLocaleString('fr-FR')} kcal</div>
							<p class="mt-0.5 text-[11px] text-mist">
								en moyenne / jour exploitable · objectif {cockpit.calories.goal.toLocaleString('fr-FR')} kcal
								{#if cockpit.calories.goalChanged && (cockpit.calories.distinctGoals ?? []).length > 1}
									<span class="italic">· fenêtre traversant un changement ( {(cockpit.calories.distinctGoals ?? []).map((g) => g.toLocaleString('fr-FR')).join(' → ')} kcal, évalué jour par jour)</span>
								{/if}
							</p>
							{#if cockpit.calories.partialExcluded > 0}
								<p class="mt-1 text-[10px] italic text-mist">{cockpit.calories.partialExcluded} journée{cockpit.calories.partialExcluded > 1 ? 's' : ''} partiellement renseignée{cockpit.calories.partialExcluded > 1 ? 's' : ''} exclue{cockpit.calories.partialExcluded > 1 ? 's' : ''} de la moyenne (tracking incomplet)</p>
							{/if}
						{:else}
							<div class="mt-1 font-display text-2xl font-semibold text-mist/50">—</div>
							<p class="mt-0.5 text-[11px] italic text-mist">Aucun jour exploitable · objectif {cockpit.calories.goal.toLocaleString('fr-FR')} kcal</p>
						{/if}
					</div>

								<!-- PAS — moyenne, objectif, jours renseignés + mini tendance 7 jours -->
								{#if cockpit.steps.avg !== null || cockpit.steps.declared || stepsLast7.some((d) => d.count !== null)}
									<div class="flex flex-col rounded-xl border border-line bg-cream/40 p-3">
										{@render cardHead('footprints', 'Pas')}
										{#if cockpit.steps.avg !== null}
											<div class="mt-1 flex flex-wrap items-baseline gap-x-2">
												<span class="font-display text-2xl font-semibold text-ink">{cockpit.steps.avg.toLocaleString('fr-FR')}</span>
												<span class="text-xs font-semibold text-mist">/ jour</span>
											{#if cockpit.steps.goal !== null}
												<span class="rounded-full bg-soft px-1.5 py-0.5 text-[10px] font-bold text-ink">objectif {cockpit.steps.goal.toLocaleString('fr-FR')}</span>
											{/if}
											</div>
											<p class="mt-0.5 text-[11px] text-mist">{cockpit.steps.trackedDays} / 7 jours renseignés</p>
											{#if cockpit.steps.declared}
												<p class="text-[11px] italic text-mist">Déclaré au bilan : {labelFor('pas', cockpit.steps.declared)} pas/jour</p>
											{/if}
										{:else if cockpit.steps.declared}
											<div class="mt-1 text-sm font-semibold text-ink">{labelFor('pas', cockpit.steps.declared ?? '')} pas / jour</div>
											<p class="mt-0.5 text-[11px] italic text-mist">Déclaré au bilan — pas de saisie quotidienne cette semaine</p>
										{/if}
										{#if stepsLast7.some((d) => d.count !== null)}
											<!-- Mini-tendance 7 jours : présentation uniquement — données
											     et logique métier inchangées (mêmes `stepsLast7` que la cliente).
											     7 mini-barres L→D à hauteur proportionnelle, ligne d'objectif
											     discrète en fond (sous les barres), jours sans donnée en
											     tiret court — pas de cadre ni de badge, hauteur minimale. -->
											{@const chartH = 26}
											{@const goal7 = cockpit.steps.goal}
											{@const yMax7 = Math.max(1, ...stepsLast7.map((d) => d.count ?? 0), goal7 ?? 0) * 1.08}
											<div class="mt-1.5">
												<div class="relative" style="height: {chartH}px">
													{#if goal7 !== null}
														<div class="absolute inset-x-0 z-0 border-t border-dashed border-ink/20" style="bottom: {(goal7 / yMax7) * chartH}px"></div>
													{/if}
													<div class="absolute inset-0 z-[1] flex items-end gap-1.5">
														{#each stepsLast7 as day, i (day.date)}
															<div class="flex h-full flex-1 items-end justify-center">
																{#if day.count !== null}
																	<div class="w-[6px] rounded-full bg-ink/85" style="height: {Math.max(3, ((day.count as number) / yMax7) * chartH)}px"></div>
																{:else}
																	<div class="w-[6px] border-t border-dotted border-mist/70"></div>
																{/if}
															</div>
														{/each}
													</div>
												</div>
												<div class="mt-1 flex gap-1.5">
													{#each stepsLast7 as day, i (day.date)}
														<span class="flex-1 text-center text-[8px] font-bold uppercase leading-none {day.count !== null ? 'text-mist' : 'text-mist/50'}">{stepsLetters[i]}</span>
													{/each}
												</div>
											</div>
										{/if}
									</div>
								{/if}

					<!-- DÉPENSE SPORTIVE — VISION 360 LIVE : 7 JOURNÉES COMPLÈTES (J-7 → J-1).
					     L'activité d'aujourd'hui n'entre JAMAIS (partielle). Les dépenses
					     restent idempotentes (une ligne par séance G-FLUX). -->
					<div class="flex flex-col rounded-xl border border-line bg-cream/40 p-3">
						{@render cardHead('zap', 'Dépense sportive', sportCard ? (sportCard.trainingCount > 0 ? `${sportCard.trainingCount} séance${sportCard.trainingCount > 1 ? 's' : ''} G-FLUX` : sportCard.manualCount > 0 ? `${sportCard.manualCount} manuelle${sportCard.manualCount > 1 ? 's' : ''}` : undefined) : undefined)}
						{#if sportCard && sportCard.activities > 0}
							<div class="mt-1 flex flex-wrap items-baseline gap-x-2">
								<span class="font-display text-2xl font-semibold text-ink">≈ {sportCard.kcal.toLocaleString('fr-FR')} kcal</span>
							</div>
							<p class="mt-0.5 text-[11px] text-mist">
								{sportCard.activities} activité{sportCard.activities > 1 ? 's' : ''}
								· {Math.floor(sportCard.durationMin / 60)} h {String(sportCard.durationMin % 60).padStart(2, '0')} sur les 7 derniers jours terminés
							</p>
							{#if sport360?.previous.some((p) => p.durationMin > 0)}
								<!-- Lecture rapide : semaines closes précédentes (jamais la semaine partielle) -->
								<div class="mt-1.5 space-y-0.5 border-t border-line/60 pt-1.5">
									{#each sport360!.previous.filter((p) => p.durationMin > 0) as pw (pw.weekStart)}
										<p class="text-[10px] text-mist tabular-nums">
											S-{sport360!.previous.indexOf(pw) + 1} · {Math.floor(pw.durationMin / 60)} h {String(pw.durationMin % 60).padStart(2, '0')} · ≈ {pw.kcal.toLocaleString('fr-FR')} kcal
										</p>
									{/each}
								</div>
							{/if}
						{:else}
							<div class="mt-1 font-display text-2xl font-semibold text-mist/50">—</div>
							<p class="mt-0.5 text-[11px] italic text-mist">Aucune activité sur les 7 derniers jours terminés</p>
						{/if}
					</div>

								<!-- PROTÉINES — moyenne, objectif, jours suivis, indication vs objectif -->
								<div class="flex flex-col rounded-xl border border-line bg-cream/40 p-3">
						{@render cardHead('beef', 'Protéines', `${proteinCard.trackedDays}/7 j exploitables`)}
						{#if proteinCard.avg !== null}
							<div class="mt-1 flex flex-wrap items-baseline gap-x-2">
								<span class="font-display text-2xl font-semibold text-ink">{fmtVal(proteinCard.avg)} g</span>
								<span class="rounded-full px-1.5 py-0.5 text-[10px] font-bold {proteinCard.avg >= proteinCard.goal ? 'bg-brand-light text-brand-dark' : 'bg-warn-light text-warn'}">
									{proteinCard.avg >= proteinCard.goal ? 'objectif atteint' : `objectif ${fmtVal(proteinCard.goal)} g`}
								</span>
							</div>
							<p class="mt-0.5 text-[11px] text-mist">en moyenne / jour exploitable (mêmes jours que les calories)</p>
							{#if proteinCard.partialExcluded > 0}
								<p class="mt-1 text-[10px] italic text-mist">{proteinCard.partialExcluded} journée{proteinCard.partialExcluded > 1 ? 's' : ''} partielle{proteinCard.partialExcluded > 1 ? 's' : ''} exclue{proteinCard.partialExcluded > 1 ? 's' : ''} (cohérence calories/protéines)</p>
							{/if}
						{:else}
							<div class="mt-1 font-display text-2xl font-semibold text-mist/50">—</div>
							<p class="mt-0.5 text-[11px] italic text-mist">Aucun jour exploitable · objectif {fmtVal(proteinCard.goal)} g</p>
						{/if}
								</div>

								<!-- CYCLE — lecture seule, mêmes données que l'Accueil cliente -->
								<div class="flex flex-col rounded-xl border border-line bg-cream/40 p-3">
									{@render cardHead('flower2', 'Cycle')}
									{#if selCycleState.kind === 'tracked'}
										<div class="mt-1 font-display text-lg font-semibold text-ink">Jour {selCycleState.cycleDay} / {selCycleState.cycleLength}</div>
										<p class="mt-0.5 text-xs text-ink">Phase : {selCycleState.label}</p>
										<p class="mt-0.5 text-[11px] text-mist">Prochaines règles estimées : {fmtDateShort(addDaysISO(selCycleState.cycleLength - selCycleState.cycleDay + 1))}</p>
									{:else if selCycleState.kind === 'hormonal'}
										<p class="mt-1 text-sm font-semibold text-ink">Non concernée</p>
										<p class="mt-0.5 text-[11px] text-mist">Suivi adapté à sa contraception</p>
									{:else if selCycleState.kind === 'nodate'}
										<p class="mt-1 text-sm font-semibold text-ink">Règles irrégulières</p>
										<p class="mt-0.5 text-[11px] text-mist">Aucune estimation affichée</p>
									{:else}
										<p class="mt-1 text-sm italic text-mist">Aucune donnée cycle</p>
									{/if}
								</div>

								<!-- RENDEZ-VOUS — prochain RDV futur (module RDV existant) -->
								<div class="flex flex-col rounded-xl border border-line bg-cream/40 p-3">
									{@render cardHead('calendarClock', 'Rendez-vous', rdvNext ? (rdvNext.googleEventId ? 'Google ✓' : undefined) : undefined)}
									{#if rdvNext}
										<div class="mt-1 text-sm font-semibold text-ink">{fmtRdvDate(rdvNext.date)} · {rdvNext.time}</div>
										<p class="mt-0.5 text-xs text-ink">{rdvNext.kind}{rdvNext.rescheduleCount > 0 ? ` · replanifié ×${rdvNext.rescheduleCount}` : ''}</p>
									{:else}
										<p class="mt-1 text-sm italic text-mist">Aucun rendez-vous prévu</p>
									{/if}
								</div>

					<!-- MENSURATIONS — dernier relevé VS relevé précédent (au moment de la consultation, SANS fenêtre 7 jours) + deltas par mesure -->
					<div class="flex flex-col rounded-xl border border-line bg-cream/40 p-3">
						{@render cardHead('ruler', 'Mensurations', cockpit.measurements.fresh ? 'nouveau' : undefined)}
						{#if cockpit.measurements.date}
							<p class="mt-1 text-sm font-semibold text-ink">
								{cockpit.measurements.fresh ? `Nouvelles mesures ${fmtDaysAgo(cockpit.measurements.daysAgo ?? 0)}` : 'Mensurations (dernier relevé)'}
							</p>
							<p class="mt-0.5 text-[11px] text-mist">Dernier relevé : le {fmtDateShort(cockpit.measurements.date)}{#if cockpit.measurements.prevDate} · précédent : {fmtDateShort(cockpit.measurements.prevDate)}{/if}</p>
							{#if cockpit.measurements.waistCm !== null || cockpit.measurements.hipCm !== null || cockpit.measurements.neckCm !== null}
								<div class="mt-1.5 space-y-0.5 border-t border-line/60 pt-1.5">
									{#if cockpit.measurements.waistCm !== null}
										<p class="text-[11px] text-ink">Taille fine <strong>{fmtVal(cockpit.measurements.waistCm)} cm</strong>{#if cockpit.measurements.deltas.waistCm !== null}<span class="ml-1 font-semibold {cockpit.measurements.deltas.waistCm < 0 ? 'text-brand-dark' : cockpit.measurements.deltas.waistCm > 0 ? 'text-warn' : 'text-mist'}">{fmtSigned(cockpit.measurements.deltas.waistCm)} cm</span>{/if}</p>
									{/if}
									{#if cockpit.measurements.hipCm !== null}
										<p class="text-[11px] text-ink">Fessiers <strong>{fmtVal(cockpit.measurements.hipCm)} cm</strong>{#if cockpit.measurements.deltas.hipCm !== null}<span class="ml-1 font-semibold {cockpit.measurements.deltas.hipCm < 0 ? 'text-brand-dark' : cockpit.measurements.deltas.hipCm > 0 ? 'text-warn' : 'text-mist'}">{fmtSigned(cockpit.measurements.deltas.hipCm)} cm</span>{/if}</p>
									{/if}
									{#if cockpit.measurements.neckCm !== null}
										<p class="text-[11px] text-ink">Tour de cou <strong>{fmtVal(cockpit.measurements.neckCm)} cm</strong>{#if cockpit.measurements.deltas.neckCm !== null}<span class="ml-1 font-semibold {cockpit.measurements.deltas.neckCm < 0 ? 'text-brand-dark' : cockpit.measurements.deltas.neckCm > 0 ? 'text-warn' : 'text-mist'}">{fmtSigned(cockpit.measurements.deltas.neckCm)} cm</span>{/if}</p>
									{/if}
								</div>
							{/if}
									{:else}
										<p class="mt-1 text-sm italic text-mist">Aucune mensuration enregistrée</p>
									{/if}
								</div>

								<!-- PHOTOS — carte compacte : fraîcheur + dernière date -->
								<div class="flex flex-col rounded-xl border border-line bg-cream/40 p-3">
									{@render cardHead('camera', 'Photos', weekPhotos ? 'nouveau' : undefined)}
									{#if weekPhotos}
										<p class="mt-1 text-sm font-semibold text-ink">{weekPhotos.count} nouvelle{weekPhotos.count > 1 ? 's' : ''} photo{weekPhotos.count > 1 ? 's' : ''} cette semaine</p>
										{#if lastPhotoDate}<p class="mt-0.5 text-[11px] text-mist">Dernier envoi : le {fmtDateShort(lastPhotoDate)}</p>{/if}
									{:else if lastPhotoDate}
										<p class="mt-1 text-sm text-ink">Aucune nouvelle photo cette semaine</p>
										<p class="mt-0.5 text-[11px] text-mist">Dernier envoi : le {fmtDateShort(lastPhotoDate)}</p>
									{:else}
										<p class="mt-1 text-sm italic text-mist">Aucune photo pour l’instant</p>
									{/if}
								</div>
							</div>
						</div>

						<!-- Historique semaine par semaine (bilan + réponses + retour coach) -->
						{#each checkins as checkin (checkin._id)}
							<BilanCard checkin={checkin} clientName={fullName(selected.user)} clientId={selected.user._id} media={mediaFor(checkin._id)} />
						{/each}
					{:else}
						{#each checkins as checkin (checkin._id)}
							<BilanCard checkin={checkin} clientName={fullName(selected.user)} clientId={selected.user._id} media={mediaFor(checkin._id)} />
						{/each}
					{/if}
				</div>				{:else if section === 'rdv'}
				<!-- Rendez-vous (Vision 360) : UNIQUEMENT les RDV de cette cliente.
				     Affichage simple : un RDV futur ? → carte + actions. Sinon →
				     réservation. (La vue globale reste /admin/rendez-vous.) -->
				{#if rdvLoading}
					<p class="py-8 text-center text-sm text-mist">Chargement du planning…</p>
				{:else}
					{#if rdvErr}<p class="rounded-xl border-2 border-danger bg-danger-light px-4 py-3 text-sm text-danger">{rdvErr}</p>{/if}
					{#if rdvNotice}<p class="rounded-xl border border-brand/40 bg-brand-light px-4 py-3 text-sm font-semibold text-ink">{rdvNotice}</p>{/if}

					<div class="rounded-2xl border border-line bg-card p-4">
						<h3 class="flex items-center gap-2 font-display text-base font-semibold text-ink"><Icon name="calendarClock" size={16} class="text-brand" /> Prochain rendez-vous</h3>
						{#if rdvNext}
							<div class="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand/30 bg-brand-light/50 px-3 py-2.5 text-sm">
								<span>
									<strong class="tabular-nums">{new Date(Number(rdvNext.date.slice(0, 4)), Number(rdvNext.date.slice(5, 7)) - 1, Number(rdvNext.date.slice(8, 10))).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} · {rdvNext.time}</strong>
									<span class="text-mist"> · {rdvNext.kind}{rdvNext.rescheduleCount > 0 ? ` · replanifié ×${rdvNext.rescheduleCount}` : ''}{rdvNext.googleEventId ? ' · 📅 Google ✓' : ''}</span>
								</span>
								<span class="flex gap-2">
									<button type="button" class="rounded-lg border-2 border-line px-2.5 py-1 text-xs font-semibold text-ink transition hover:border-brand hover:text-brand" onclick={() => { rdvMoving = rdvNext; rdvKind = rdvNext.kind; rdvDate = ''; rdvSlots = []; }}>Replanifier</button>
									<button type="button" class="rounded-lg border-2 border-line px-2.5 py-1 text-xs font-semibold text-ink transition hover:border-danger hover:text-danger" onclick={() => rdvCancel(rdvNext)}>Annuler</button>
								</span>
							</div>
						{:else}
							<p class="mt-2 text-sm italic text-mist">Aucun rendez-vous prévu pour cette cliente.</p>
						{/if}
					</div>

					<div class="rounded-2xl border border-line bg-card p-4">
						<h3 class="mb-3 flex items-center gap-2 font-display text-base font-semibold text-ink">
							<Icon name="calendarDays" size={16} class="text-brand" />
							{rdvMoving ? 'Replanifier sur un nouveau créneau' : 'Planifier un rendez-vous'}
							{#if rdvMoving}<button type="button" class="ml-1 text-xs font-semibold text-mist underline" onclick={() => { rdvMoving = null; rdvDate = ''; rdvSlots = []; }}>annuler le déplacement</button>{/if}
						</h3>
						<p class="mb-3 text-xs text-mist">Cliente : <strong class="text-ink">{selected ? fullName(selected.user) : ''}</strong> — connue via sa fiche, rien à ressaisir.</p>
						<div class="mb-3 flex flex-wrap items-end gap-2 text-sm">
							<span>
								<label class="mb-0.5 block text-[10px] font-bold uppercase tracking-wider text-mist" for="rdv-type">Type</label>
								<select id="rdv-type" class="rounded-lg border border-line bg-white px-2 py-1.5" bind:value={rdvKind} onchange={() => { if (rdvDate) void loadRdvSlots(); }}>
									{#each RDV_KINDS as k}<option value={k}>{k}</option>{/each}
								</select>
							</span>
							<span>
								<label class="mb-0.5 block text-[10px] font-bold uppercase tracking-wider text-mist" for="rdv-date">Date</label>
								<input id="rdv-date" type="date" class="rounded-lg border border-line bg-white px-2 py-1.5" bind:value={rdvDate} onchange={() => void loadRdvSlots()} />
							</span>
						</div>
						{#if !rdvDate}
							<p class="text-sm italic text-mist">Choisis une date pour voir les créneaux réellement libres (disponibilités − Google − RDV − buffers).</p>
						{:else if rdvSlotsLoading}
							<p class="text-sm italic text-mist">Recherche des créneaux disponibles…</p>
						{:else if rdvSlots.length === 0}
							<p class="text-sm italic text-mist">Aucun créneau libre ce jour-là (réglable dans Rendez-vous → Disponibilités).</p>
						{:else}
							<div class="flex flex-wrap gap-1.5">
								{#each rdvSlots as s (s.start)}
									<button
										type="button"
										onclick={() => (rdvMoving ? rdvMove(rdvDate, s.start) : rdvBook(rdvDate, s.start))}
										class="rounded-lg px-2.5 py-1.5 text-xs font-bold tabular-nums transition bg-brand-light text-brand-dark hover:bg-brand hover:text-white"
									>{s.start} → {s.end}</button>
								{/each}
							</div>
						{/if}
					</div>

					{#if rdvHistory.length > 0}
						<div class="rounded-2xl border border-line bg-card p-4">
							<h3 class="mb-2 flex items-center gap-2 font-display text-base font-semibold text-ink"><Icon name="listTodo" size={16} class="text-brand" /> Historique</h3>
							{#each rdvHistory as r (r._id)}
								<div class="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 py-2 text-sm last:border-0">
									<span class="tabular-nums"><strong>{r.date}</strong> · {r.time} · {r.kind}</span>
									<span class="flex items-center gap-2 text-xs">
										<span class="rounded-full px-2 py-0.5 font-bold {r.status === 'on_book' ? 'bg-brand text-white' : 'bg-line text-mist'}">{r.status === 'on_book' ? 'passé' : 'annulé'}</span>
										<span class="text-mist">{r.bookingSource === 'coach' ? 'planifié par le coach' : 'réservé par la cliente'}</span>
										{#if r.status === 'on_book'}
											<button type="button" class="text-mist transition hover:text-danger" onclick={() => rdvCancel(r)} aria-label="Annuler ce rendez-vous"><Icon name="trash" size={14} /></button>
										{/if}
									</span>
								</div>
							{/each}
						</div>
					{/if}
				{/if}
			{:else if section === 'dossier'}
				<!-- Dossier : notes privées coach + ressources partagées (« Ressources » côté cliente) -->
				<DossierPanel clientId={selected.user._id} clientName={fullName(selected.user)} />
			{/if}
		</div>
		{/key}
		</div>
	</aside>
{:else if clients.length === 0}
	<div class="mt-6 rounded-2xl border border-dashed border-line bg-card px-6 py-14 text-center">
		<p class="grid place-items-center"><Icon name="users" size={36} class="text-mist" /></p>
		<p class="mt-3 text-sm text-ink">Crée un compte client pour démarrer le suivi.</p>
	</div>
{/if}

<style>
	.chart-bar {
		transform-origin: bottom;
		animation: barGrow 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) both;
	}
	@keyframes barGrow {
		from {
			transform: scaleY(0);
			opacity: 0;
		}
		to {
			transform: scaleY(1);
			opacity: 1;
		}
	}
	.chart-line {
		stroke-dasharray: 1400;
		stroke-dashoffset: 1400;
		animation: lineDraw 1.2s ease forwards;
	}
	@keyframes lineDraw {
		to {
			stroke-dashoffset: 0;
		}
	}
	.chart-fade {
		opacity: 0;
		animation: fadeIn 0.9s 0.5s ease forwards;
	}
	.chart-dot {
		opacity: 0;
		animation: dotPop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 0.9s forwards;
	}
	@keyframes dotPop {
		from {
			opacity: 0;
			transform: scale(0);
			transform-box: fill-box;
			transform-origin: center;
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}
	@keyframes fadeIn {
		to {
			opacity: 1;
		}
	}
</style>