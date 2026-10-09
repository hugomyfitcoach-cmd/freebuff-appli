/**
 * Scanner code-barres haute résolution.
 *
 * Pourquoi ce module (au lieu de html5-qrcode) :
 * html5-qrcode décodait uniquement un recadrage de la taille du conteneur CSS
 * (~375 px de large à l'écran). Un code-barres tenu à distance normale occupait
 * donc trop peu de pixels pour être lu — d'où l'obligation de coller le
 * téléphone. Ici on décode l'image CAMÉRA NATIVE (jusqu'à 1280 px de large) :
 *
 *  - BarcodeDetector natif (Chrome / Android / Samsung Internet) : détection en
 *    résolution native, très rapide et longue portée, quasi gratuit en JS.
 *  - Sinon ZXing — le moteur déjà embarqué par html5-qrcode (vendored dans
 *    `html5-qrcode/third_party`) — appliqué au canvas en résolution native.
 *
 * Le décodage couvre TOUTE l'image (pas de recadrage) : le cadre affiché n'est
 * qu'un repère visuel, ce qui rend le scan beaucoup plus tolérant à la
 * distance et à l'alignement.
 *
 * Fiabilité (mission scan guard) : chaque lecture brute passe par la PORTE
 * createScanGate — normalisation GTIN + checksum GS1 + 2 lectures identiques
 * consécutives — AVANT tout callback. Un code invalide est ignoré en
 * silence : jamais de recherche Convex/OFF, jamais de « produit introuvable »
 * avec un code manifestement invalide.
 */

import type { MediaTrackConstraintSet } from './barcodeTypes';

/* ── Mission V3.2 — expérimentation mesurée (Preview uniquement) ────────── */

/**
 * Garde d'expérimentation : flag de BUILD injecté par vite.config.ts
 * (`__SCANNER_EXPERIMENT__`), calculé depuis le CONTEXTE NETLIFY et non
 * depuis import.meta.env.PROD — une Deploy Preview est un build de
 * production Vite (PROD=true) : seule la variable CONTEXT=deploy-preview
 * (ou branch-deploy) distingue réellement les environnements. En local
 * (dev), le flag est actif pour faciliter le diagnostic.
 */
declare const __SCANNER_EXPERIMENT__: boolean;

/** MODE B « reconnaissance immédiate » (expérimental, opt-in uniquement).
 * Activable par :
 *  - variable d'environnement de build : PUBLIC_SCANNER_MODE=B (Preview) ;
 *  - ou URL : ?scannerMode=B (diagnostic ponctuel sur la Preview).
 * DÉFAUT : MODE A (fenêtre glissante 2/4, 1200 ms) — le mode B n'est JAMAIS
 * actif en production (garde de build __SCANNER_EXPERIMENT__, voir ci-dessus).
 * Hypothèse testée : la confirmation à 2 lectures ajoute un délai notable
 * quand les lectures sont intermittentes (distance, flou, mains).
 */
export type ScanMode = 'A' | 'B';

function resolveScanMode(): ScanMode {
	if (!__SCANNER_EXPERIMENT__) return 'A';
	if (typeof window !== 'undefined') {
		const q = new URLSearchParams(window.location.search).get('scannerMode');
		if (q === 'B') return 'B';
		if (q === 'A') return 'A';
	}
	const env = (import.meta.env.PUBLIC_SCANNER_MODE ?? '').toUpperCase();
	return env === 'B' ? 'B' : 'A';
}

/**
 * Télémétrie locale du scan (mission V3.2, mode debug UNIQUEMENT).
 * Aucun envoi réseau, aucune image conservée — affichage dans la pastille
 * debug du scanner, exposée via handle.debugInfo() quand le mode est actif.
 */
/**
 * Sonde de ressources (mission V3.2 — ralentissement après plusieurs scans).
 * Compteur global des sessions de scanner vivantes (boucle non stoppée) et
 * des flux caméra ouverts. Destiné au mode debug et au protocole « 10 scans
 * successifs » : une fuite se manifeste par un compteur qui progresse au fil
 * des ouvertures/fermetures. Aucune donnée perso, aucun envoi réseau.
 */
export type ScannerResourceProbe = {
	/** Sessions démarrées (depuis le chargement du module). */
	sessionsStarted: number;
	/** Sessions dont la boucle de décodage tourne encore. */
	sessionsAlive: number;
	/** Flux caméra getUserMedia actuellement ouverts. */
	cameraStreamsOpen: number;
	/** Boucles de décodage simultanées au pic (doit rester ≤ 1). */
	maxConcurrentLoops: number;
};

let sessionsStarted = 0;
let sessionsAlive = 0;
let cameraStreamsOpen = 0;
let maxConcurrentLoops = 0;

/** Instantané du compteur de ressources — accessible pour diagnostic. */
export function scannerResourceProbe(): ScannerResourceProbe {
	return { sessionsStarted, sessionsAlive, cameraStreamsOpen, maxConcurrentLoops };
}

export type ScanDebugInfo = {
	mode: ScanMode;
	/** BarcodeDetector natif ('native') ou ZXing vendored ('zxing'). */
	engine: 'native' | 'zxing';
	/** Résolution demandée (contrainte ideal) et réelle du track. */
	requestedResolution: { width: number; height: number };
	trackResolution: { width: number; height: number };
	videoResolution: { width: number; height: number };
	/** Cadence réelle de décodage (frames analysées / seconde). */
	detectFps: number;
	/** Temps (ms) entre le démarrage du scan et la 1re lecture valide.
	 *  ⚠️ BASE = startBarcodeScanner (et non l'apparition du code dans le
	 *  champ) : sur une session longue, la valeur accumule tout le temps de
	 *  recherche manuelle de l'utilisateur. V3.4-b : on expose AUSSI
		*  msSinceFirstFrame, mesurée depuis la 1re frame caméra réellement
	 *  décodable — c'est LA métrique à comparer entre deux captures. */
	msToFirstValid: number | null;
	/** Temps (ms) entre la 1re frame caméra décodable et la 1re lecture
	 *  valide — indépendant du temps de manipulation de l'utilisateur. */
	msSinceFirstFrame: number | null;
	/** Temps (ms) entre la 1re lecture valide et la confirmation/ouverture. */
	msValidToConfirm: number | null;
	zoom: number | null;
	lastError: string | null;
	/** Ressources vivantes au moment de l'appel (sonde anti-fuite V3.2). */
	resources: ScannerResourceProbe;
	/* — Mission V3.4 : instrumentation de la passe profonde ZXing — */
	/** Nombre de frames FXing réellement passées (passe légère). */
	zxingLightFrames: number;
	/** Nombre de frames ZXing passées avec TRY_HARDER (passe profonde). */
	zxingHardFrames: number;
	/** Durée CUMULÉE (ms) des passes profondes TRY_HARDER. */
	zxingHardMs: number;
	/** Stratégie actuellement active pour la passe profonde. */
	thStrategy: 'fixed-1of4' | 'adaptive-boost' | 'adaptive-cooldown' | 'native';
	/* — Mission V3.5 : expérimentation recadrage serré (Preview opt-in) — */
	/** Expérimentation recadrage serré active (?scannerCrop=tight, Preview). */
	cropExperiment: boolean;
	/** Nombre de frames passées avec la passe « bande serrée » V3.5. */
	tightFrames: number;
	/** Durée CUMULÉE (ms) de la passe « bande serrée » V3.5. */
	tightMs: number;
};

export type BarcodeScannerHandle = {
	/** Arrête la caméra + le décodage et retire les éléments injectés. */
	stop: () => Promise<void>;
	/** Suspend/reprend le DÉCODAGE sans couper la caméra (mode saisie manuelle). */
	setPaused: (paused: boolean) => void;
	/** Résolution réelle du track utilisé (0 si inconnue) — mesure avant/après
	 *  sur le terrain sans supposer que `ideal` a été honoré (mission V3). */
	resolution: () => TrackResolution;
	/** Télémétrie locale (mission V3.2) : mode, moteur, résolutions, FPS,
	 *  délais — uniquement des mesures techniques, aucune image, aucun envoi
	 *  réseau. Affichée par la pastille debug (?scannerDebug=1, hors prod). */
	debugInfo: () => ScanDebugInfo;
	/** Mission V3.5 — capture de frame brute DIAGNOSTIC : présente UNIQUEMENT
	 *  si ?scannerDebug=1&scannerFrameDump=1 ET le garde Preview. Retourne un
	 *  PNG dataURL de la dernière frame décodée. DÉSACTIVÉ PAR DÉFAUT : jamais
	 *  d'appel automatique, jamais d'envoi réseau, jamais de stockage — le
	 *  seul usage est un téléchargement manuel déclenché par l'utilisatrice
	 *  (tap sur la pastille) pour l'analyse locale d'une frame réelle. */
	captureLastFrame?: () => string | null;
};

/** Capacités utiles du track caméra (lampe/zoom), si supportées. */
export type TorchHandle = {
	toggleTorch: () => Promise<boolean>;
	hasTorch: () => boolean;
	zoom: (factor: number) => Promise<boolean>;
	hasZoom: () => boolean;
	zoomRange: { min: number; max: number; step: number } | null;
	/** Zoom réellement appliqué au démarrage (peut différer du min — mission V3). */
	currentZoom: () => number;
};

/**
 * La caméra est refusée / bloquée / absente (permission refusée dans le
 * navigateur, réglage iOS ou Android, aucune caméra dispo). L'appelant
 * affiche alors un message clair + « Réessayer » au lieu du générique
 * « caméra indisponible ». Les autres erreurs restent des Error classiques.
 */
export class CameraPermissionError extends Error {}

/** Résolution réelle du track caméra (mesure terrain, mission scanner V3). */
export type TrackResolution = { width: number; height: number };

/** Vibration légère à la détection (best effort, jamais bloquant). */
function vibrateOk(): void {
	try {
		navigator.vibrate?.(35);
	} catch {
		// pas de vibration (desktop / iOS Safari) : silencieux
	}
}

/**
 * Valide un code lu : EAN-13 / GTIN-14 (14 chiffres) / UPC-A (12, réécrit en
 * 13 avec 0 préfixe) / EAN-8 — checksum GS1 obligatoire. UPC-E (8 avec 0/1
 * en tête) accepté. Retourne le code normalisé, ou null si le format ne
 * correspond pas (QR, CODE_128/ITF logistique, lecture partielle…) : c'est
 * LE filtre anti « faux codes » — toute lecture non GTIN est rejetée AVANT
 * toute recherche Convex/OFF.
 */
export function normalizeProductCode(raw: string): string | null {
	const digits = (raw ?? '').replace(/\D/g, '');
	if (digits.length === 13) {
		return eanChecksumValid(digits) ? digits : null;
	}
	if (digits.length === 14) {
		// GTIN-14 (ITF-14 sur cartons) : checksum GS1, jamais réécrit.
		return eanChecksumValid(digits) ? digits : null;
	}
	if (digits.length === 12) {
		// UPC-A ⊂ EAN-13 (préfixe 0).
		const as13 = `0${digits}`;
		return eanChecksumValid(as13) ? as13 : null;
	}
	if (digits.length === 8) {
		// EAN-8 ou UPC-E (préfixe 0/1) — checksum pareil (modulo 10).
		return eanChecksumValid(digits) ? digits : null;
	}
	return null;
}

/**
 * Checksum modulo 10 GS1/GTIN (dernier chiffre = clé), valable pour toutes
 * les longueurs GTIN (8/12/13/14) : en partant de la DROITE de la chaîne de
 * DONNÉES, les chiffres sont pondérés alternativement ×3 puis ×1.
 * (L'ancienne formule indexait depuis la gauche : résultat faux pour les
 * 14 chiffres — poids inversés.)
 */
function eanChecksumValid(d: string): boolean {
	let sum = 0;
	for (let i = d.length - 2; i >= 0; i--) {
		sum += Number(d[i]) * ((d.length - 2 - i) % 2 === 0 ? 3 : 1);
	}
	return (10 - (sum % 10)) % 10 === Number(d[d.length - 1]);
}

/** Verdict d'une lecture brute passée dans la porte de confirmation. */
export type ScanGateResult = {
	/** rejected = code invalide (ignorer en silence) ; pending = lecture valide en attente ; confirmed = 2 lectures identiques. */
	verdict: 'rejected' | 'pending' | 'confirmed';
	/** Code GTIN normalisé ('' si rejeté). */
	code: string;
};

export type ScanGate = {
	submit: (raw: string) => ScanGateResult;
	/** Remet le compteur de confirmation à zéro (après ouverture de feuille). */
	reset: () => void;
};

/**
 * PORTE de fiabilité au-dessus du moteur de décodage (BarcodeDetector COMME
 * ZXing) — mission scanner V3 : FENÊTRE GLISSANTE.
 *
 * Une lecture brute n'est transmise à l'appelant que si :
 *   1. normalizeProductCode l'accepte (longueur GTIN 8/12/13/14 + checksum),
 *   2. la MÊME valeur normalisée est relue dans la fenêtre — `required`
 *      lectures identiques parmi les 4 dernières, toutes de moins de
 *      `maxGapMs` (fenêtre glissante : tolère les frames où le décodeur
 *      n'accroche pas, fréquentes sur Android à haute résolution).
 *
 * Garde-fous conservés (validation mission) :
 *  - checksum EAN/UPC strict (normalizeProductCode) — inchangé ;
 *  - deux décodages RÉELS et indépendants (une frame seule ne suffit pas) ;
 *  - toute lecture invalide est rejetée SILENCIEUSEMENT et VIDE la fenêtre ;
 *  - une lecture VALIDE DIFFÉRENTE vide la fenêtre (protection alternance
 *    EAN ↔ code logistique voisin, conservée) ;
 *  - la fenêtre est réinitialisée après chaque confirmation (deux codes
 *    successifs distincts exigent chacun leurs propres 2 lectures) — le
 *    verrou anti-doublon de la boucle (DUPLICATE_MS) reste en amont.
 */
export function createScanGate(required = 2, maxGapMs = 1200): ScanGate {
	/** Dernières lectures valides (4 max), les plus anciennes d'abord. */
	let recent: { code: string; at: number }[] = [];
	return {
		submit(raw: string): ScanGateResult {
			const code = normalizeProductCode(raw);
			const now = Date.now();
			if (!code) {
				recent = [];
				return { verdict: 'rejected', code: '' };
			}
			// Éviction des lectures sorties de la fenêtre temporelle.
			recent = recent.filter((r) => now - r.at <= maxGapMs);
			// Alternance : un code valide différent du dernier vide la fenêtre.
			if (recent.length > 0 && recent[recent.length - 1].code !== code) recent = [];
			recent.push({ code, at: now });
			while (recent.length > 4) recent.shift();
			const same = recent.filter((r) => r.code === code).length;
			if (same >= required) {
				recent = []; // confirmation consommée : fenêtre repart de zéro
				return { verdict: 'confirmed', code };
			}
			return { verdict: 'pending', code };
		},
		reset() {
			recent = [];
		},
	};
}

type NativeDetector = {
	detect(source: CanvasImageSource | HTMLVideoElement): Promise<{ rawValue: string }[]>;
};

/* Types minimaux du ZXing vendored dans html5-qrcode (mêmes classes que celles
   que html5-qrcode utilise en interne). */
type ZXing = {
	MultiFormatReader: new (
		verbose: boolean,
		hints: Map<number, unknown>
	) => { decode(binaryBitmap: unknown): { text: string } };
	HTMLCanvasElementLuminanceSource: new (canvas: HTMLCanvasElement) => unknown;
	HybridBinarizer: new (source: unknown) => unknown;
	BinaryBitmap: new (binarizer: unknown) => unknown;
	DecodeHintType: { POSSIBLE_FORMATS: number; TRY_HARDER: number };
	BarcodeFormat: {
		EAN_13: number;
		EAN_8: number;
		UPC_A: number;
		UPC_E: number;
		CODE_128: number;
		ITF: number;
		CODE_39: number;
	};
};

/** Formats utiles pour de l'alimentaire (EAN/UPC + CODE_128). */
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'itf', 'code_39'] as const;

/** Résolution de décodage maximale (largeur). 1920 px ≈ 5× html5-qrcode :
 *  c'est LE levier principal de portée — plus de pixels sur le même code
 *  barres lu à distance normale (1200/1280 en repli si refus du track). */
const RESOLUTION_LADDER = [
	{ width: 1920, height: 1080 },
	{ width: 1280, height: 720 },
] as const;
/** Cadence de décodage (ms entre deux frames). */
const FRAME_INTERVAL_MS = 70;
/** Garde anti double lecture : même code ignoré pendant 1,2 s. */
const DUPLICATE_MS = 1200;
/**
 * Confirmation multi-frames (fenêtre glissante, mission scanner V3) : deux
 * lectures du MÊME code normalisé dans une fenêtre de 1200 ms — l'ancien gap
 * strict de 700 ms entre deux lectures CONSÉCUTIVES échouait dès que le
 * décodeur n'accrochait pas pendant quelques frames (typique Android à haute
 * résolution), laissant la pastille « Code détecté… » clignoter sans jamais
 * confirmer. Un code relu bien plus tard recompte depuis zéro.
 */
const SCAN_CONFIRM_GAP_MS = 1200;
/** Grâce d'affichage de la pastille « Code détecté… » (anti-clignotement). */
const SCAN_HINT_GRACE_MS = 450;
/**
 * Mission V3.4 — fréquence TRY_HARDER ADAPTATIVE (ZXing uniquement).
 *
 * Stratégie « fixed-1of4 » (référence historique) : TH toutes les 4 frames.
 * Stratégie « adaptive-boost » : après N frames SANS lecture valide, la passe
 *   profonde TH est essayée à CHAQUE frame — un code tenu incliné/flou est
 *   souvent débloqué par les rotations/contrastes de TH. Bordé : quand la
 *   passe légère vient de réussir, on repasse en fixed-1of4.
 * Stratégie « adaptive-cooldown » : en boost prolongé (>8 frames sans gain),
 *   on alterne 1 frame TH / 3 frames légères — on ne dégrade pas la cadence.
 *
 * Rampes calibrées sur le terrain (voir protocole V3.4), jamais au-delà :
 *   - boost à partir de 8 frames sans lecture (≈ 560 ms de silence décodeur)
 *   - cooldown dès 12 frames en boost sans gain (≈ 2 passes TH par 4 frames)
 */
const TH_BOOST_AFTER_FRAMES = 8;
const TH_COOLDOWN_AFTER_FRAMES = 12;
/** Multiplier la demi-période légère pour que TH reste 1 frame sur 2 max. */
const FRAME_INTERVAL_RADIO_MS = 70;
/** Durée du flash vert du cadre après une lecture (ms). */
const GREEN_FLASH_MS = 900;
/** Bordure des coins du cadre (blanc au repos, vert au flash). */
const WHITE_BORDER = '4px solid rgba(255,255,255,.92)';
const GREEN_BORDER = '4px solid rgba(74,222,128,1)';
/**
 * Cadre guide affiché — volontairement LARGE et centré légèrement au-dessus
 * du milieu (esprit « capture Food ») : le décodage porte sur TOUTE l'image,
 * le cadre n'est qu'un repère. Un cadre trop petit poussait les clientes à
 * « viser » le code au centre et à coller le téléphone — l'inverse de
 * l'objectif (reconnaissance rapide, à distance normale, cadrage approximatif).
 */
const FRAME_LEFT_RIGHT_PCT = 3;
const FRAME_TOP_PCT = 26;
const FRAME_HEIGHT_PCT = 44;

function getNativeDetector(): NativeDetector | null {
	const w = window as unknown as { BarcodeDetector?: new (opts?: { formats?: string[] }) => NativeDetector };
	if (typeof w.BarcodeDetector !== 'function') return null;
	try {
		return new w.BarcodeDetector({ formats: [...FORMATS] });
	} catch {
		// Certains navigateurs n'acceptent pas la liste des formats → défauts.
		return new w.BarcodeDetector();
	}
}

/**
 * Démarre le scan dans `container` (élément déjà présent dans le DOM).
 * `onDecoded` est appelé à chaque code lu (l'appelant filtre/déduplique).
 * Les éléments <video>/repères sont injectés dans `container`.
 */
export async function startBarcodeScanner(
	container: HTMLElement,
	onDecoded: (text: string) => void
): Promise<BarcodeScannerHandle & TorchHandle> {
	container.replaceChildren();
	sessionsStarted++;
	sessionsAlive++;
	maxConcurrentLoops = Math.max(maxConcurrentLoops, sessionsAlive);

	let stopped = false;
	let stream: MediaStream | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let decoding = false;
	/** Décodage suspendu (mode « saisie manuelle ») : caméra allumée, boucle
	 *  vivante, mais plus aucune frame décodée ni callback émis. */
	let paused = false;
	let zxingMod: ZXing | null = null;
	let nativeDetector: NativeDetector | null = null;
	/** Résolution RÉELLE du track (mission V3) — exposée pour mesure terrain. */
	let trackResolution = { width: 0, height: 0 };
	/* — Mission V3.2 : mode A/B + instrumentation — */
	const scanMode = resolveScanMode();
	const scanStartAt = Date.now();
	let firstValidAt: number | null = null;
	/** 1re frame caméra décodable (readyState ≥ 2) — base V3.4-b pour
	 *  msSinceFirstFrame (indépendante du temps de manipulation). */
	let firstFrameAt: number | null = null;
	let confirmedAt: number | null = null;
	let decodeCount = 0;
	let lastDecodeError: string | null = null;

	// -- Caméra : recule (résolution native) pour maximiser la portée. ------
	// UN SEUL getUserMedia par scan : si la permission est déjà accordée, le
	// navigateur répond immédiatement SANS redemander (autorisation persistante
	// sur Chrome/Android ; sur iOS/Safari c'est l'OS qui re-consulte à chaque
	// session — l'app ne peut ni l'éviter ni la contourner). Pas de query
	// `permissions` préalable : inutile quand c'est déjà accordé, non fiable
	// sur Safari, et le prompt DOIT partir d'un geste utilisateur (le clic).
	// Ladder de résolution : certains tracks refusent 1920 → repli 1280.
	let lastError: unknown = null;
	for (const res of RESOLUTION_LADDER) {
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				audio: false,
				video: {
					facingMode: 'environment',
					width: { ideal: res.width },
					height: { ideal: res.height },
				},
			});
			cameraStreamsOpen++; // flux obtenu : suivi de ressources (sonde V3.2)
			break;
		} catch (e) {
			lastError = e;
		}
	}
	if (!stream) {
		sessionsAlive--; // échec d'ouverture : la session n'entre jamais en boucle
		const e = lastError;
		const name = e instanceof DOMException ? e.name : '';
		if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'NotFoundError') {
			throw new CameraPermissionError(
				name === 'NotFoundError'
					? "Aucune caméra accessible n'a été trouvée sur cet appareil."
					: "L'accès à la caméra est refusé ou bloqué pour ce site."
			);
		}
		throw e instanceof Error ? e : new Error('Caméra indisponible.');
	}
	if (stopped) {
		for (const t of stream.getTracks()) t.stop();
		sessionsAlive--;
		return {
			stop: async () => {},
			setPaused: () => {},
			resolution: () => ({ width: 0, height: 0 }),
			debugInfo: () => ({
				mode: 'A' as const,
				engine: 'native' as const,
				requestedResolution: { width: 0, height: 0 },
				trackResolution: { width: 0, height: 0 },
				videoResolution: { width: 0, height: 0 },
				detectFps: 0,
				msToFirstValid: null,
				msSinceFirstFrame: null,
				msValidToConfirm: null,
				zoom: null,
				lastError: null,
				resources: scannerResourceProbe(),
				zxingLightFrames: 0,
				zxingHardFrames: 0,
				zxingHardMs: 0,					thStrategy: 'fixed-1of4' as const,
					cropExperiment: false,
					tightFrames: 0,
					tightMs: 0,
				}),
			toggleTorch: async () => false,
			hasTorch: () => false,
			zoom: async () => false,
			hasZoom: () => false,
			zoomRange: null,
			currentZoom: () => 0,
		};
	}

	// -- Résolution réelle du track (mission scanner V3) ---------------------
	// `ideal` n'est pas garanti : certains tracks Android démarrent à 640 px
	// malgré ideal:1920 (négociation navigateur/capteur). Un code-barres tenu
	// à 25–30 cm y tombe sous la résolution utile — c'est LA cause principale
	// des scans Android difficiles alors que l'image « a l'air nette ». On
	// mesure la résolution réelle et on re-négocie UNE fois si elle est trop
	// basse ; le résultat reste exposé via handle.resolution() pour mesurer
	// avant/après sur le terrain (jamais de supposition à l'aveugle).
	const mainTrack = stream.getVideoTracks()[0];
	if (mainTrack) {
		const s = (mainTrack.getSettings?.() ?? {}) as { width?: number; height?: number };
		trackResolution = { width: s.width ?? 0, height: s.height ?? 0 };
		if (trackResolution.width && trackResolution.width < 1280) {
			try {
				await mainTrack.applyConstraints({
					width: { ideal: 1920 },
					height: { ideal: 1080 },
				} as MediaTrackConstraints);
				const s2 = (mainTrack.getSettings?.() ?? {}) as { width?: number; height?: number };
				if (s2.width) trackResolution = { width: s2.width, height: s2.height ?? 0 };
			} catch {
				// Re-négociation refusée : on garde le track tel quel (best effort).
			}
		}
	}

	// -- Focus continu (iPhone / Safari en priorité) --------------------------
	// Sans ça, l'iPhone fige la mise au point sur l'infini : un code-barres à
	// 15–25 cm reste FLOU et indécodable, même en haute résolution. Best effort
	// et silencieux : selon l'appareil, focusMode/pointsOfInterest peuvent être
	// absents des capabilities (on essaie les deux, on ignore tout échec).
	try {
		const track = stream.getVideoTracks()[0];
		const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackConstraintSet & {
			focusMode?: string[];
			pointsOfInterest?: unknown;
		};
		if (Array.isArray(caps.focusMode)) {
			const modes = caps.focusMode as string[];
			// continuous = autofocus permanent ; sinon single-shot pour déclencher
			// au moins une mise au point au démarrage du scan.
			const mode = modes.includes('continuous') ? 'continuous' : modes.includes('single-shot') ? 'single-shot' : null;
			if (mode) await track.applyConstraints({ advanced: [{ focusMode: mode } as unknown as MediaTrackConstraintSet] });
		}
		if (caps.pointsOfInterest !== undefined) {
			// Point d'intérêt au centre du cadre guide (x,y normalisés 0–1) :
			// oriente l'exposition/autofocus là où la cliente place le produit.
			await track.applyConstraints({
				advanced: [
					{ pointsOfInterest: { x: 0.5, y: (FRAME_TOP_PCT + FRAME_HEIGHT_PCT / 2) / 100 } } as unknown as MediaTrackConstraintSet,
				],
			});
		}
	} catch {
		// Focus non pilotable (ancien iOS, desktop…) : le décodage reste tel quel.
	}

	// -- Éléments visuels ----------------------------------------------------
	// La vidéo remplit TOUJOURS le conteneur (cadre portrait stable, même si
	// la source caméra est paysage) : object-fit cover + position absolute.
	const video = document.createElement('video');
	video.playsInline = true;
	video.muted = true;
	video.setAttribute('muted', '');
	video.setAttribute('autoplay', '');
	video.srcObject = stream;
	Object.assign(video.style, {
		position: 'absolute',
		inset: '0',
		width: '100%',
		height: '100%',
		objectFit: 'cover',
		display: 'block',
	} as CSSStyleDeclaration);

	// Repères : 4 coins + bande centrale (purement indicatif — le décodage
	// porte sur toute l'image).
	const guide = document.createElement('div');
	Object.assign(guide.style, {
		position: 'absolute',
		inset: '0',
		pointerEvents: 'none',
	} as CSSStyleDeclaration);
	const frame = document.createElement('div');
	Object.assign(frame.style, {
		position: 'absolute',
		left: `${FRAME_LEFT_RIGHT_PCT}%`,
		right: `${FRAME_LEFT_RIGHT_PCT}%`,
		top: `${FRAME_TOP_PCT}%`,
		height: `${FRAME_HEIGHT_PCT}%`,
	} as CSSStyleDeclaration);
	// Voile sombre autour du cadre (repère visuel clair, décode toute l'image).
	const dim = document.createElement('div');
	Object.assign(dim.style, {
		position: 'absolute',
		left: '0',
		top: '0',
		width: '100%',
		height: `${FRAME_TOP_PCT}%`,
		background: 'rgba(0,0,0,.38)',
	} as Partial<CSSStyleDeclaration>);
	frame.append(dim);
	const dim2 = document.createElement('div');
	Object.assign(dim2.style, {
		position: 'absolute',
		left: '0',
		bottom: '0',
		width: '100%',
		height: `${100 - FRAME_TOP_PCT - FRAME_HEIGHT_PCT}%`,
		background: 'rgba(0,0,0,.38)',
	} as Partial<CSSStyleDeclaration>);
	frame.append(dim2);
	for (const side of ['left', 'right'] as const) {
		const sideDim = document.createElement('div');
		Object.assign(sideDim.style, {
			position: 'absolute',
			[side]: '0',
			top: `${FRAME_TOP_PCT}%`,
			bottom: `${100 - FRAME_TOP_PCT - FRAME_HEIGHT_PCT}%`,
			width: `${FRAME_LEFT_RIGHT_PCT}%`,
			background: 'rgba(0,0,0,.38)',
		} as Partial<CSSStyleDeclaration>);
		frame.append(sideDim);
	}
	// Coins : mémorisés avec leurs côtés bordés pour le flash vert.
	const cornerDefs: { styles: Partial<CSSStyleDeclaration>; sides: ('Top' | 'Right' | 'Bottom' | 'Left')[] }[] = [
		{ styles: { left: '0', top: '0', borderLeft: WHITE_BORDER, borderTop: WHITE_BORDER }, sides: ['Left', 'Top'] },
		{ styles: { right: '0', top: '0', borderRight: WHITE_BORDER, borderTop: WHITE_BORDER }, sides: ['Right', 'Top'] },
		{ styles: { left: '0', bottom: '0', borderLeft: WHITE_BORDER, borderBottom: WHITE_BORDER }, sides: ['Left', 'Bottom'] },
		{ styles: { right: '0', bottom: '0', borderRight: WHITE_BORDER, borderBottom: WHITE_BORDER }, sides: ['Right', 'Bottom'] },
	];
	const corners: { el: HTMLDivElement; sides: ('Top' | 'Right' | 'Bottom' | 'Left')[] }[] = [];
	for (const def of cornerDefs) {
		const c = document.createElement('div');
		Object.assign(c.style, {
			position: 'absolute',
			width: '34px',
			height: '34px',
			borderRadius: '6px',
		} as Partial<CSSStyleDeclaration>);
		Object.assign(c.style, def.styles as Partial<CSSStyleDeclaration>);
		corners.push({ el: c, sides: def.sides });
		frame.append(c);
	}
	// Pastille discrète « Code détecté… » : confirmation multi-frames en cours
	// (première lecture valide reçue). Purement informative, n'interrompt pas
	// le scan, disparaît dès validation ou lecture invalide.
	const scanHint = document.createElement('div');
	scanHint.textContent = 'Code détecté…';
	Object.assign(scanHint.style, {
		position: 'absolute',
		left: '50%',
		bottom: '14%',
		transform: 'translateX(-50%)',
		padding: '6px 14px',
		borderRadius: '999px',
		background: 'rgba(15,23,42,.72)',
		color: '#fff',
		fontSize: '13px',
		fontWeight: '700',
		letterSpacing: '.02em',
		opacity: '0',
		transition: 'opacity .15s ease',
		pointerEvents: 'none',
		whiteSpace: 'nowrap',
	} as Partial<CSSStyleDeclaration>);
	guide.append(frame, scanHint);
	/* Pastille DEBUG (mission V3.2) : visible uniquement en mode debug opt-in
	   (URL ?scannerDebug=1, jamais en production). Texte mis à jour 1×/s.
	   Aucune image, aucune donnée perso — uniquement des mesures techniques. */
	let debugEl: HTMLDivElement | null = null;
	const debugEnabled =
		__SCANNER_EXPERIMENT__ && new URLSearchParams(window.location.search).get('scannerDebug') === '1';
	const frameDumpEnabled =
		__SCANNER_EXPERIMENT__ && debugEnabled && new URLSearchParams(window.location.search).get('scannerFrameDump') === '1';
	if (debugEnabled) {
		debugEl = document.createElement('div');
		Object.assign(debugEl.style, {
			position: 'absolute',
			top: '2%',
			left: '2%',
			maxWidth: '96%',
			padding: '5px 8px',
			borderRadius: '8px',
			background: 'rgba(0,0,0,.78)',
			color: '#9f9',
			font: '10px/1.5 monospace',
			whiteSpace: 'pre-line',
			pointerEvents: 'none',
			zIndex: '5',
		} as Partial<CSSStyleDeclaration>);
		guide.append(debugEl);
		if (frameDumpEnabled) {
			debugEl.title = 'Tap : télécharger la dernière frame (diagnostic local)';
			debugEl.addEventListener('click', () => {
				if (!lastFrameDataUrl) return;
				const a = document.createElement('a');
				a.href = lastFrameDataUrl;
				a.download = `gflux-frame-${Date.now()}.png`;
				a.click();
			});
		}
	}
	container.append(video, guide);

	/* Mission V3.5 — capture de frame brute, TEMPORAIRE et opt-in explicite :
	 * ?scannerDebug=1&scannerFrameDump=1 ET garde de build Preview. Quand
	 * actif, un TAP sur la pastille télécharge la dernière frame décodée
	 * (PNG local, via <a download>) : aucun envoi réseau, aucun stockage
	 * automatique, aucune image conservée au-delà de la frame courante.
	 * Désactivé par défaut en production et en usage normal. */
	let lastFrameDataUrl: string | null = null;

	// -- Feedback visuel « code lu » : le cadre passe franchement au vert ------
	// (lueur + coins verts) pendant GREEN_FLASH_MS. Déclenché au même moment
	// que la vibration : la cliente SAIT instantanément que c'est reconnu,
	// même si la feuille produit met un instant à s'ouvrir.
	let greenTimer: ReturnType<typeof setTimeout> | null = null;
	let lastGreenAt = 0;
	function flashGreen(): void {
		const now = Date.now();
		if (now - lastGreenAt < GREEN_FLASH_MS) return; // déjà vert : pas de clignotement
		lastGreenAt = now;
		frame.style.boxShadow = '0 0 0 4px rgba(34,197,94,.55), 0 0 36px 12px rgba(34,197,94,.35)';
		for (const c of corners) {
			for (const side of c.sides) c.el.style.setProperty(`border${side}`, GREEN_BORDER);
		}
		if (greenTimer) clearTimeout(greenTimer);
		greenTimer = setTimeout(() => {
			frame.style.boxShadow = '';
			for (const c of corners) {
				for (const side of c.sides) c.el.style.setProperty(`border${side}`, WHITE_BORDER);
			}
		}, GREEN_FLASH_MS);
	}

	/** Pastille « Code détecté… » visible pendant l'attente de confirmation. */
	function setScanHint(visible: boolean): void {
		scanHint.style.opacity = visible ? '1' : '0';
	}

	// -- Moteur de décodage ---------------------------------------------------
	nativeDetector = getNativeDetector();
	if (!nativeDetector) {
		// ZXing (déjà présent via html5-qrcode) : import différé, seulement
		// quand on en a besoin et uniquement côté navigateur.
		zxingMod = (await import('html5-qrcode/third_party/zxing-js.umd')) as unknown as ZXing;
	}

	const canvas = document.createElement('canvas');
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) throw new Error('Canvas 2D indisponible.');
	/** Canvas de recadrage (passe « zoomée » ZXing, mission V3) — séparé du
	 *  canvas pleine frame pour ne pas détruire le bitmap en cours. */
	const cropCanvas = document.createElement('canvas');
	const cropCtx = cropCanvas.getContext('2d', { willReadFrequently: true });

	// Canvas en résolution native (largeur plafonnée pour la perf).
	let vw = 0;
	let vh = 0;
	const resizeCanvas = () => {
		const nw = video.videoWidth || 0;
		const nh = video.videoHeight || 0;
		if (!nw || !nh) return;
		const scale = Math.min(1, 1920 / nw);
		vw = Math.round(nw * scale);
		vh = Math.round(nh * scale);
		canvas.width = vw;
		canvas.height = vh;
	};

	// — Mission V3.4 : état de la stratégie TRY_HARDER adaptative (ZXing) —
	/** Stratégie RUNTIME selected (résolue au démarrage). */
	/** V3.5 — bande serrée : état actif + compteurs de coût. */
	let tightFrames = 0;
	let tightMs = 0;
	const cropExperiment =
		__SCANNER_EXPERIMENT__ &&
		typeof window !== 'undefined' &&
		new URLSearchParams(window.location.search).get('scannerCrop') === 'tight';
	const thStrategy: 'fixed-1of4' | 'adaptive-boost' | 'adaptive-cooldown' | 'native' =
		resolveScanModeThStrategy();
	/* — Mission V3.5 : passe « bande serrée » (expérimentation, Preview opt-in) —
	 * Démonstration tools/probe-strategies-v2.mts sur IMG_2243 (13 h 21) : le
	 * crop serré du bandeau du code (×1, SANS upscale, ~8 px/module) + TH est
	 * la SEULE stratégie qui décode 3038352875035 à distance — les passes
	 * plein cadre et le crop app ×2 échouent. Ici : recadrage horizontal fixe
	 * (60 % de largeur × 18 % de hauteur centrés sur le cadre guide), ×1,
	 * TH forcé — exécuté sur les frames où la passe TH ne tourne pas.
	 * RÉVERSIBLE : activé UNIQUEMENT par ?scannerCrop=tight ET le garde de
	 * build __SCANNER_EXPERIMENT__ (Preview). Défaut inchangé sinon. */
	/** Nombre de frames consécutives SANS lecture (tous moteurs). */
	let consecutiveNoRead = 0;
	/** Nombre de frames ZXing passées EN MODE TH (compteur de budget). */
	let hardFrames = 0;
	/** Durée CUMULÉE (ms) des passes TH. */
	let hardMsTotal = 0;
	/** Période des frames SANS passe profonde (boost exclus) àState froid. */
	const TH_PERIOD = 4;
	/**
	 * Décide si la frame actuelle déclenche la passe TRY_HARDER.
	 * Implémentation : un simple index modulaire, ASSEZ léger en JS pur pour
	 * rester sous le ms/frame (≈70 ms natif, 30 ms ZXing mesuré sur iPhone).
	 */
	function shouldTryHarder(): boolean {
		if (thStrategy === 'fixed-1of4') return frameCount % TH_PERIOD === 0;
		if (thStrategy === 'adaptive-boost') {
			if (consecutiveNoRead >= TH_BOOST_AFTER_FRAMES) return true;
			return frameCount % TH_PERIOD === 0;
		}
		if (thStrategy === 'adaptive-cooldown') {
			if (consecutiveNoRead >= TH_COOLDOWN_AFTER_FRAMES) {
				// Alternance stricte : une TH sur 2, la passe légère continuant
				// tranquillement — on garde le CPU disponible pour la caméra.
				return frameCount % 2 === 0;
			}
			return frameCount % TH_PERIOD === 0;
		}
		return false; // native : pas de passe TH (détecteur natif déjà utilisé)
	}

	/** Décide de la stratégie active au DÉMARRAGE du scan (mission V3.4). */
	function resolveScanModeThStrategy(): 'fixed-1of4' | 'adaptive-boost' | 'adaptive-cooldown' | 'native' {
	/* eslint-disable-next-line */
		const native = typeof window !== 'undefined' && (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector != null;
		if (native) return 'native';
		// Parade expérimentale Preview : ?scannerTH=boost | ?scannerTH=cooldown
		if (__SCANNER_EXPERIMENT__ && typeof window !== 'undefined') {
			const q = new URLSearchParams(window.location.search).get('scannerTH');
			if (q === 'boost') return 'adaptive-boost';
			if (q === 'cooldown') return 'adaptive-cooldown';
		}
		return 'fixed-1of4';
	}

	// Décode une frame. Retourne le texte lu, ou null.
	const decodeOnce = async (): Promise<string | null> => {
		if (video.readyState < 2 || video.paused || video.videoWidth === 0) return null;
		/* V3.4-b : base de mesure « depuis la 1re frame caméra décodable » —
		   indépendante du temps de manipulation de l'utilisatrice (la valeur
		   historique msToFirstValid part de startBarcodeScanner et accumule
		   tout le temps de recherche : 162 968 ms mesuré = 2 min 43 s). */
		if (firstFrameAt === null) firstFrameAt = Date.now();
		if (nativeDetector) {
			try {
				const codes = await nativeDetector.detect(video);
				return codes.length > 0 ? codes[0].rawValue : null;
			} catch (e) {
				lastDecodeError = e instanceof Error ? e.message : 'detect() a échoué';
				return null;
			}
		}
		if (!zxingMod || !vw || !vh) return null;
	try {
		ctx.drawImage(video, 0, 0, vw, vh);
		/* V3.5 — frame dump DIAGNOSTIC (opt-in explicite, Preview) : on garde la
		 * dernière frame pour un téléchargement MANUEL (tap pastille). Aucun
		 * envoi réseau, aucun stockage ; écrasée à chaque frame. */
		if (frameDumpEnabled) {
			try {
				lastFrameDataUrl = canvas.toDataURL('image/png');
			} catch {
				lastFrameDataUrl = null;
			}
		}
		const source = new zxingMod.HTMLCanvasElementLuminanceSource(canvas);
		const hints = new Map<number, unknown>();
		hints.set(zxingMod.DecodeHintType.POSSIBLE_FORMATS, [
			zxingMod.BarcodeFormat.EAN_13,
			zxingMod.BarcodeFormat.EAN_8,
			zxingMod.BarcodeFormat.UPC_A,
			zxingMod.BarcodeFormat.UPC_E,
			zxingMod.BarcodeFormat.CODE_128,
			zxingMod.BarcodeFormat.ITF,
			zxingMod.BarcodeFormat.CODE_39,
		]);
		/* CORRECTIF V3.4-b (bug critique démontré par tools/repro-dead-passes.mts) :
		   le MultiFormatReader LÈVE NotFoundException quand il ne trouve RIEN —
		   il ne renvoie jamais null. L'ancien try/catch UNIQUE enveloppait les
		   TROIS passes : sur toute frame en échec (la majorité), le contrôle
		   sortait immédiatement par le catch et les passes crop + TRY_HARDER
		   n'exécutaient JAMAIS (preuve terrain : 428L/0H · 0 ms TH cum).
		   Désormais : chaque passe a son propre try/catch → les passes suivantes
		   tournent réellement, comme prévu par la conception V3. */
		// Passe 1 rapide (TRY_HARDER=false) — cadence élevée.
		try {
			const quick = new zxingMod.MultiFormatReader(false, hints);
			const bitmap = new zxingMod.BinaryBitmap(new zxingMod.HybridBinarizer(source));
			const result = quick.decode(bitmap);
			if (result?.text) return result.text;
		} catch {
			// NotFoundException : rien lu cette frame — on enchaîne le crop.
		}
		frameCount++;
		// Passe 1.5 (une frame sur 2) : recadrage central upscalé ×2 — un code
	// tenu à distance n'occupe que quelques dizaines de pixels dans l'image
	// native et la binarisation locale de ZXing le perd. Agrandir la zone du
	// cadre guide rend les barres relisables sans toucher à la cadence de la
	// passe rapide. Repli uniquement (BarcodeDetector n'en a pas besoin).
		if (cropCtx && frameCount % 2 === 0) {
			const cw = Math.round(vw * 0.8);
			const ch = Math.round(vh * 0.44);
			const cx = Math.round((vw - cw) / 2);
			const cy = Math.max(0, Math.round((vh * (FRAME_TOP_PCT + FRAME_HEIGHT_PCT / 2)) / 100 - ch / 2));
			cropCanvas.width = cw * 2;
			cropCanvas.height = ch * 2;
			cropCtx.imageSmoothingEnabled = false;
			cropCtx.drawImage(canvas, cx, cy, cw, ch, 0, 0, cw * 2, ch * 2);
			try {
				const cropReader = new zxingMod.MultiFormatReader(false, hints);
				const cropBitmap = new zxingMod.BinaryBitmap(new zxingMod.HybridBinarizer(new zxingMod.HTMLCanvasElementLuminanceSource(cropCanvas)));
				const cropResult = cropReader.decode(cropBitmap);
				if (cropResult?.text) return cropResult.text;
			} catch {
				// NotFoundException sur le crop — on enchaîne la passe TH.
			}
		}
		// Passe 2 : TRY_HARDER — plus coûteux (rotations/contrastes difficiles)
		// mais décroche les codes tenus à distance, inclinés ou légèrement flous
		// que la passe rapide rate. FRÉQUENCE ADAPTATIVE V3.4 :
		//   fixed-1of4        → TH toutes les 4 frames (référence historique)
		//   adaptive-boost    → TH à CHAQUE frame (le code résiste depuis un moment)
		//   adaptive-cooldown → TH une frame sur 2 (le boost ne décroche pas,
		//                       on limite la charge CPU sans abandonner)
		// Native (BarcodeDetector) : TH est sans objet — ce chemin n'est jamais
		// exécuté si un détecteur natif est présent (voir if ci-dessus).
		/* V3.5 — passe « bande serrée » : sur les frames SANS passe TH, on tente
		   le recadrage horizontal serré ×1 + TH (démonstration IMG_2243). */
		if (cropExperiment && !shouldTryHarder()) {
			const tTight0 = performance.now();
			try {
				const tw = Math.round(vw * 0.6);
				const th = Math.round(vh * 0.18);
				const tx = Math.round((vw - tw) / 2);
				const ty = Math.max(0, Math.round((vh * (FRAME_TOP_PCT + FRAME_HEIGHT_PCT / 2)) / 100 - th / 2));
				cropCanvas.width = tw;
				cropCanvas.height = th;
				cropCtx?.drawImage(canvas, tx, ty, tw, th, 0, 0, tw, th);
				hints.set(zxingMod.DecodeHintType.TRY_HARDER, true);
				const tightReader = new zxingMod.MultiFormatReader(false, hints);
				const tightBitmap = new zxingMod.BinaryBitmap(new zxingMod.HybridBinarizer(new zxingMod.HTMLCanvasElementLuminanceSource(cropCanvas)));
				const tightResult = tightReader.decode(tightBitmap);
				tightMs += performance.now() - tTight0;
				tightFrames++;
				if (tightResult?.text) return tightResult.text;
			} catch {
				tightMs += performance.now() - tTight0;
				tightFrames++;
				// NotFoundException sur la bande serrée — la passe TH classique reste.
			}
		}
		const doHardPass = shouldTryHarder();
		if (!doHardPass) return null;
		hints.set(zxingMod.DecodeHintType.TRY_HARDER, true);
		const tHard0 = performance.now();
		try {
			const harder = new zxingMod.MultiFormatReader(false, hints);
			const bitmap2 = new zxingMod.BinaryBitmap(new zxingMod.HybridBinarizer(source));
			const result2 = harder.decode(bitmap2);
			hardMsTotal += performance.now() - tHard0;
			hardFrames++;
			return result2 ? result2.text : null;
		} catch {
			hardMsTotal += performance.now() - tHard0;
			hardFrames++;
			return null;
		}
	} catch {
		// Erreur hors décodage (drawImage, canvas…) : frame suivante.
		return null;
	}
	};

	// Garde anti double lecture : un même code qui reste sous l'objectif
	// quelques frames ne déclenche pas plusieurs ouverture de feuille.
	let lastCode = '';
	let lastCodeAt = 0;
	/** Compteur de frames (ZXing : une passe TRY_HARDER toutes les 4 frames). */
	let frameCount = 0;

	// Porte de fiabilité : normalizeProductCode + checksum GS1 + 2 lectures
	// identiques RAPPROCHÉES (≤ SCAN_CONFIRM_GAP_MS entre deux lectures)
	// AVANT toute recherche — au-dessus des deux moteurs : BarcodeDetector
	// natif ET repli ZXing passent par le même appel gate.submit.
	const gate = scanMode === 'B' ? createScanGate(1, SCAN_CONFIRM_GAP_MS) : createScanGate(2, SCAN_CONFIRM_GAP_MS);
	/** La pastille « Code détecté… » reste visible pendant cette fenêtre. */
	let hintUntil = 0;

	// Mise en arrière-plan (mission scanner V3) : suspendre le décodage quand
	// la page est cachée (économie CPU/batterie, aucune lecture fantôme) et
	// réinitialiser la porte + l'anti-doublon au retour : deux frames encadrant
	// une mise en arrière-plan ne doivent JAMAIS se confirmer mutuellement.
	let hiddenPaused = false;
	const onVisibility = () => {
		if (document.hidden) {
			hiddenPaused = true;
		} else {
			hiddenPaused = false;
			gate.reset();
			lastCode = '';
			lastCodeAt = 0;
		}
	};
	document.addEventListener('visibilitychange', onVisibility);

	// Boucle de scan (avec garde anti-chevauchement).
	const tick = async () => {
		if (stopped) return;
		if (!decoding && !paused && !hiddenPaused) {
			decoding = true;
			try {
				if (!vw && video.videoWidth) resizeCanvas();
				const text = await decodeOnce();
				if (!stopped && text) {
					if (firstValidAt === null) firstValidAt = Date.now();
					const res = gate.submit(text);
					const nowMs = Date.now();
					if (res.verdict === 'rejected') {
						// Code invalide (longueur/checksum GTIN) : ignoré en silence,
						// le scan continue — jamais de recherche, jamais d'erreur.
						hintUntil = 0;
					} else if (res.verdict === 'pending') {
						// Première lecture valide : pastille, on attend la 2e.
						hintUntil = nowMs + SCAN_HINT_GRACE_MS;
					} else if (res.code === lastCode && nowMs - lastCodeAt < DUPLICATE_MS) {
						// Même code tout juste validé : on ignore (anti-doublon,
						// comportement historique conservé — code encore sous
						// l'objectif = pas de nouvelle recherche).
					} else {
						// Lectures valides confirmées (2 en mode A, 1 en mode B) : on
						// déclenche la recherche.
						if (confirmedAt === null) confirmedAt = Date.now();
						lastCode = res.code;
						lastCodeAt = nowMs;
						hintUntil = 0;
						vibrateOk();
						flashGreen();
						onDecoded(res.code);
					}
					setScanHint(nowMs < hintUntil);
				} else {
					// Rien de lisible cette frame : la pastille retombe après grâce.
					setScanHint(Date.now() < hintUntil);
				}
				decodeCount++;
				/* V3.4 : suivi de l'absence de lecture (pour l'adaptatif TH) —
				   remis à 0 dès qu'une lecture (non nulle) revient. */
				if (text) consecutiveNoRead = 0;
				else consecutiveNoRead++;
			} catch {
				// Frame illisible → on continue.
			} finally {
				decoding = false;
			}
		}
		timer = setTimeout(tick, FRAME_INTERVAL_MS);
	};

	await video.play().catch(() => {
		// Autoplay refusé : on attend un geste — l'ouverture du scan EST un geste.
	});
	video.addEventListener('loadedmetadata', resizeCanvas, { once: true });
	/* Rafraîchissement de la pastille debug 1×/s (aucune télémétrie réseau). */
	let debugTimer: ReturnType<typeof setInterval> | null = null;
	if (debugEnabled) {
		debugTimer = setInterval(() => {
			if (!debugEl || stopped) return;
			const d = buildDebugInfo();
			debugEl.textContent =
				`mode ${d.mode} · ${d.engine} · th=${d.thStrategy}\n` +
				`track ${d.trackResolution.width}×${d.trackResolution.height} · video ${d.videoResolution.width}×${d.videoResolution.height}\n` +
				`fps ≈ ${d.detectFps.toFixed(1)} · zoom ${d.zoom ?? 'n/a'} · ${d.zxingLightFrames}L/${d.zxingHardFrames}H (${d.zxingHardMs.toFixed(0)} ms TH cum)${d.cropExperiment ? ` · tight ${d.tightFrames}p (${d.tightMs.toFixed(0)} ms)` : ''}\n` +
				`1re lecture ${d.msSinceFirstFrame ?? '—'} ms (session ${d.msToFirstValid ?? '—'}) · confirm ${d.msValidToConfirm ?? '—'} ms\n` +
				`sessions ${d.resources.sessionsAlive}/${d.resources.sessionsStarted} · streams ${d.resources.cameraStreamsOpen} · maxLoops ${d.resources.maxConcurrentLoops}` +
				(d.lastError ? `\nerr: ${d.lastError}` : '');
		}, 1000);
	}
	tick();

	// -- Lampe + zoom (best effort, selon capacités du track) ----------------
	const track = stream.getVideoTracks()[0];
	/** Dernier zoom appliqué (debug + cohérence slider). */
	let lastZoomValue: number | null = null;
	const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackConstraintSet & { torch?: boolean; zoom?: { min: number; max: number; step?: number } };
	const hasTorch = caps.torch === true;
	const zoomCap = typeof caps.zoom === 'object' && caps.zoom ? caps.zoom : null;
	let torchOn = false;
	/** Zoom courant (suivi côté JS — le track n'expose pas de lecture directe). */
	let currentZoom = zoomCap ? zoomCap.min : 0;
	/**
	 * Zoom initial MODÉRÉ (mission scanner V3) : si l'objectif offre du zoom,
	 * on pré-positionne ×2 (sans jamais dépasser la plage) — un code tenu à
	 * 25–30 cm gagne mécaniquement en pixels sans que la cliente ne touche au
	 * slider. Volontairement modéré : ni zoom excessif, ni changements
	 * incessants ; l'utilisateur garde la main via le slider (getSettings().zoom
	 * n'étant pas lisible, la valeur de départ est répercutée côté page via
	 * currentZoom()). Best effort : refus silencieux si non supporté.
	 */
	if (zoomCap && zoomCap.max >= 2 && zoomCap.min <= 2) {
		try {
			await track.applyConstraints({ advanced: [{ zoom: 2 } as unknown as MediaTrackConstraintSet] });
			currentZoom = 2;
		} catch {
			// Zoom refusé au démarrage : on reste au min, sans erreur.
		}
	}
	const torch: TorchHandle = {
		hasTorch: () => hasTorch,
		async toggleTorch() {
			if (!hasTorch || !track) return false;
			try {
				torchOn = !torchOn;
				await track.applyConstraints({ advanced: [{ torch: torchOn } as unknown as MediaTrackConstraintSet] });
				return true;
			} catch {
				torchOn = false;
				return false;
			}
		},
		hasZoom: () => !!zoomCap,
		zoomRange: zoomCap ? { min: zoomCap.min, max: zoomCap.max, step: zoomCap.step ?? 0.1 } : null,
		currentZoom: () => currentZoom,
		async zoom(factor: number) {
			if (!zoomCap || !track) return false;
			try {
				const z = Math.min(zoomCap.max, Math.max(zoomCap.min, factor));
				await track.applyConstraints({ advanced: [{ zoom: z } as unknown as MediaTrackConstraintSet] });
				currentZoom = z;
				lastZoomValue = z;
				return true;
			} catch {
				return false;
			}
		},
	};

	/** Construit l'instantané de télémétrie locale (mission V3.2). */
	function buildDebugInfo(): ScanDebugInfo {
		const elapsed = Math.max(1, (Date.now() - scanStartAt) / 1000);
		return {
			mode: scanMode,
			engine: nativeDetector ? 'native' : 'zxing',
			requestedResolution: { width: RESOLUTION_LADDER[0].width, height: RESOLUTION_LADDER[0].height },
			trackResolution: { ...trackResolution },
			videoResolution: { width: video.videoWidth, height: video.videoHeight },
			detectFps: decodeCount / elapsed,
			msToFirstValid: firstValidAt === null ? null : firstValidAt - scanStartAt,
			msSinceFirstFrame:
				firstValidAt === null || firstFrameAt === null ? null : Math.max(0, firstValidAt - firstFrameAt),
			msValidToConfirm: firstValidAt !== null && confirmedAt !== null ? confirmedAt - firstValidAt : null,
			zoom: lastZoomValue,
			lastError: lastDecodeError,
			resources: scannerResourceProbe(),
			/* V3.4 — instrumentation passe profonde ZXing */
			zxingLightFrames: Math.max(0, decodeCount - hardFrames),
			zxingHardFrames: hardFrames,
			zxingHardMs: hardMsTotal,
			thStrategy,
			cropExperiment,
			tightFrames,
			tightMs,
		};
	}

	return {
		stop: async () => {
			if (stopped) return; // idempotent : pas de double décrément
			stopped = true;
			sessionsAlive = Math.max(0, sessionsAlive - 1);
			if (timer) clearTimeout(timer);
			if (greenTimer) clearTimeout(greenTimer);
			if (debugTimer) clearInterval(debugTimer);
			document.removeEventListener('visibilitychange', onVisibility);
			if (stream) {
				for (const t of stream.getTracks()) t.stop();
				cameraStreamsOpen = Math.max(0, cameraStreamsOpen - 1);
			}
			if (video.srcObject) video.srcObject = null; // libère la référence média
			container.replaceChildren();
		},
		resolution: () => ({ ...trackResolution }),
		debugInfo: buildDebugInfo,
		captureLastFrame: frameDumpEnabled ? () => lastFrameDataUrl : undefined,
		/** Caméra maintenue allumée, boucle maintenue vivante : seule la
		 *  détection est court-circuitée. À la pause, l'état de confirmation
		 *  (porte anti faux codes) est remis à zéro — aucune re-validation
		 *  fantôme quand l'utilisateur reprend le scan. */
		setPaused: (value: boolean) => {
			paused = value;
			if (value) {
				gate.reset();
				lastCode = '';
				lastCodeAt = 0;
				hintUntil = 0;
				setScanHint(false);
			}
		},
		...torch,
	};
}
