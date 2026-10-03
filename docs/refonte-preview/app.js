/* G-FLUX — Preview de refonte : interactions (données 100 % fictives) */

/* Icônes Lucide inline (SVG 24×24, stroke 2) */
const ICONS = {
	home: '<path d="M3 9.5 12 3l9 6.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
	bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
	bellRing: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="M4 2C2.8 2.99 2 4.23 2 5.5"/>',
	camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3.5"/>',
	images: '<path d="M18 22H4a2 2 0 0 1-2-2V6"/><path d="m22 13-1.5-7A2 2 0 0 0 18.5 4H14l-3 3-3.5 1L4 14v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4z"/><circle cx="9" cy="9" r="1.2"/>',
	users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
	user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
	clipboardList: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6"/><path d="M9 16h6"/>',
	clipboardCheck: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
	calendarCheck: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/>',
	calendarDays: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/>',
	calendarClock: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/><circle cx="12" cy="16" r="3"/>',
	calendarRange: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/><path d="M8 2v4"/>',
	messageCircle: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
	megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
	send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
	search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
	menu: '<line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/>',
	zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
	settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.13-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.13.08a2 2 0 0 1 1 1.73V12a2 2 0 0 1-1 1.73l-.13.08a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.13-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.13.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.13-.08a2 2 0 0 1-1-1.73V12a2 2 0 0 1 1-1.73l.13-.08a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.13.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
	chevronRight: '<path d="m9 18 6-6-6-6"/>',
	chevronLeft: '<path d="m15 18-6-6 6-6"/>',
	arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
	arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
	arrowUpRight: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
	arrowDown: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
	check: '<path d="M20 6 9 17l-5-5"/>',
	eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
	clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
	scale: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
	ruler: '<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m13.5 15.5 2-2"/><path d="m10.5 12.5 2-2"/>',
	footprints: '<path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0z"/><path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0z"/>',
	dumbbell: '<path d="M14.4 14.4 9.6 19.2"/><path d="M18.657 21.485a2 2 0 1 1-2.829-2.828l-1.767 1.768a2 2 0 1 1-2.829-2.829l6.364-6.364a2 2 0 1 1 2.829 2.829l1.768-1.767a2 2 0 1 1 2.828 2.829z"/><path d="m21.5 21.5-1.4-1.4"/><path d="M3.9 3.9 2.5 2.5"/><path d="M6.404 12.768a2 2 0 1 1-2.829-2.829l1.768-1.767a2 2 0 1 1-2.828-2.829l2.828-2.828a2 2 0 1 1 2.829 2.828l1.767-1.768a2 2 0 1 1 2.829 2.829z"/>',
	bookOpen: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
	heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z"/>',
	utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>',
	listChecks: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
	rows3: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>',
	layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
	sparkles: '<path d="M9.94 15.5 8.5 21l-1.44-5.5L1.5 14l5.56-1.5L8.5 7l1.44 5.5L15.5 14z"/><path d="M19 3v4"/><path d="M17 5h4"/><path d="M19 17v4"/><path d="M17 19h4"/>',
	copy: '<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
	trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
	plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
	minus: '<path d="M5 12h14"/>',
	rotateCcw: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
	refreshCw: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
	shuffle: '<path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.8-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/><path d="m18 14 4 4-4 4"/>',
	edit: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L21.4 5.6l-4-4z"/>',
	pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.352-1.321a2 2 0 0 0 .83-.5z"/>',
	target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
	chartBar: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
	flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
	heartPulse: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z"/><path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"/>',
	video: '<path d="m22 8-6 4 6 4V8z"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
	mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
	lock: '<rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 5-5 5 5 0 0 1 5 5v4"/>',
	rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
	mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
	smartphone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
	lightbulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2V18h6v-1.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 2z"/>',
	info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
	triangleAlert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
	cake: '<path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16c.5.5 1.2 1 2 1s1.5-.5 2-1c.5.5 1.2 1 2 1s1.5-.5 2-1c.5.5 1.2 1 2 1s1.5-.5 2-1c.5.5 1.2 1 2 1s1.5-.5 2-1"/><path d="M2 21h20"/><path d="M7 11v-3"/><path d="M12 11v-3"/><path d="M17 11v-3"/><path d="M7 8a2 2 0 1 1 0-4c.6 0 .9.2 1.2.5C8.5 4 8.8 2 12 2s3.5 2 3.8 2.5c.3-.3.6-.5 1.2-.5a2 2 0 1 1 0 4"/>',
};

function renderIcons() {
	document.querySelectorAll('[data-icon]').forEach((el) => {
		const name = el.dataset.icon;
		const svg = ICONS[name];
		if (!svg) return;
		// Aucune taille inline par défaut : le CSS contextual dimensionne
		// (.btn svg, .kpi-ico svg…). Seules les tailles EXPLICITES posées sur
		// le <i> (style="width:13px;height:13px") sont transférées sur le SVG.
		const inlineStyle = el.getAttribute('style') ?? '';
		const w = inlineStyle.match(/width:\s*([\d.]+)px/);
		const h = inlineStyle.match(/height:\s*([\d.]+)px/);
		let extra = '';
		if (w && h) extra = `width:${w[1]}px;height:${h[1]}px;`;
		el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex-shrink:0;${extra}">${svg}</svg>`;
	});
}

/* ── Toast ── */
let toastTimer;
function toast(msg) {
	const t = document.getElementById('toast');
	document.getElementById('toast-msg').textContent = msg;
	t.classList.remove('hide');
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => t.classList.add('hide'), 2400);
}

/* ── Navigation ── */
function goto(pageId) {
	document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
	const target = document.getElementById('page-' + pageId);
	if (!target) return;
	target.classList.add('active');
	document.querySelectorAll('.side-item[data-goto]').forEach((b) => {
		b.classList.toggle('active', b.dataset.goto === pageId);
	});
	document.getElementById('sidebar').classList.remove('open');
	window.scrollTo({ top: 0, behavior: 'instant' });
}

document.addEventListener('click', (e) => {
	// Navigation générique via data-goto (boutons sidebar, cartes, lignes)
	const nav = e.target.closest('[data-goto]');
	if (nav) {
		goto(nav.dataset.goto);
		return;
	}
	// Sidebar mobile
	if (e.target.closest('#burger')) {
		document.getElementById('sidebar').classList.add('open');
		return;
	}
	if (e.target.closest('#scrim')) {
		document.getElementById('sidebar').classList.remove('open');
		return;
	}
	// Notifications : coche « marquer comme vu »
	const chk = e.target.closest('.check-btn');
	if (chk) {
		const row = chk.closest('.notif-row');
		row.classList.remove('unread');
		row.querySelector('.notif-ico').style.background = 'var(--line-2)';
		row.querySelector('.notif-ico').style.color = 'var(--mist)';
		const kind = row.querySelector('.kind');
		if (kind) { kind.classList.add('muted'); }
		chk.classList.add('done');
		const seen = document.getElementById('seen');
		seen.prepend(row);
		updateNotifCounts();
		return;
	}
	// « Tout marquer comme vu »
	if (e.target.closest('#mark-all')) {
		document.querySelectorAll('#to-consult .check-btn').forEach((b) => b.click());
		toast('Toutes les notifications sont marquées comme vues ✓');
		return;
	}
	// Bilans : changement de semaine
	const week = e.target.closest('#bilan-weeks .chip');
	if (week) {
		document.querySelectorAll('#bilan-weeks .chip').forEach((c) => c.classList.remove('active'));
		week.classList.add('active');
		toast(`Semaine ${week.dataset.week} affichée`);
		return;
	}
	// Photos : filtres période
	const period = e.target.closest('#photo-filters .chip');
	if (period) {
		document.querySelectorAll('#photo-filters .chip').forEach((c) => c.classList.remove('active'));
		period.classList.add('active');
		const p = period.dataset.period;
		let visible = 0;
		document.querySelectorAll('#deposits .deposit').forEach((d) => {
			const show = p === 'all' || d.dataset.period === p;
			d.style.display = show ? '' : 'none';
			if (show) visible++;
		});
		document.getElementById('deposits-count').textContent = visible;
		return;
	}
	// Templates : changement de catégorie
	const tpl = e.target.closest('#tpl-tabs .chip');
	if (tpl) {
		document.querySelectorAll('#tpl-tabs .chip').forEach((c) => c.classList.remove('active'));
		tpl.classList.add('active');
		return;
	}
	// Templates : choix de situation
	const sit = e.target.closest('.situation');
	if (sit) {
		document.querySelectorAll('.situation').forEach((s) => s.classList.remove('active'));
		sit.classList.add('active');
		return;
	}
	// Templates : générer
	if (e.target.closest('#tpl-generate')) {
		const prenom = document.getElementById('tpl-prenom').value.trim() || 'Pauline';
		const jour = document.getElementById('tpl-jour').value.trim() || 'lundi 5 octobre';
		const heure = document.getElementById('tpl-heure').value.trim() || '14h30';
		const sign = document.getElementById('tpl-sign').value.trim() || 'Hugo';
		document.getElementById('tpl-preview').textContent =
			`Bonjour ${prenom} ! 👋\n\n` +
			`Je suis ravi(e) de t'accueillir dans l'accompagnement G-FLUX ! Tu fais maintenant partie d'une belle aventure, et je suis là pour t'aider à atteindre tes objectifs. 💪\n\n` +
			`Notre premier rendez-vous est fixé au ${jour} à ${heure}. Lors de cet échange, nous ferons le point sur tes objectifs, ton mode de vie et je t'expliquerai en détail le déroulé de l'accompagnement.\n\n` +
			`En attendant, je t'invite à remplir ton bilan initial si ce n'est pas déjà fait, afin que je puisse préparer au mieux notre échange. Tu recevras également un petit questionnaire par email.\n\n` +
			`Si tu as la moindre question d'ici là, n'hésite pas à m'écrire ici !\n\n` +
			`À très bientôt,\n${sign}`;
		document.getElementById('tpl-status').textContent = 'Message généré';
		toast('Message généré ✓ — tu peux le personnaliser avant de copier.');
		return;
	}
	// Templates : copier
	if (e.target.closest('#tpl-copy')) {
		const txt = document.getElementById('tpl-preview').textContent;
		navigator.clipboard?.writeText(txt).catch(() => {});
		toast('Message copié dans le presse-papiers ✓');
		return;
	}
	// Templates : réinitialiser
	if (e.target.closest('#tpl-reset')) {
		document.getElementById('tpl-prenom').value = '';
		document.getElementById('tpl-jour').value = '';
		document.getElementById('tpl-heure').value = '';
		document.getElementById('tpl-status').textContent = 'Message généré';
		toast('Champs réinitialisés.');
		return;
	}
	// Vision 360 : onglets
	const tab = e.target.closest('#c360-tabs .c360-tab');
	if (tab) {
		document.querySelectorAll('#c360-tabs .c360-tab').forEach((t) => t.classList.remove('active'));
		tab.classList.add('active');
		document.querySelectorAll('.c360-sec').forEach((s) => {
			s.style.display = s.dataset.sec === tab.dataset.sec ? '' : 'none';
		});
		return;
	}
	// Accès rapide → onglet 360
	const secGo = e.target.closest('[data-sec-goto]');
	if (secGo) {
		const btn = document.querySelector(`#c360-tabs .c360-tab[data-sec="${secGo.dataset.secGoto}"]`);
		if (btn) btn.click();
		return;
	}
	// Objectifs : mode
	const obj = e.target.closest('#obj-tabs .obj-tab');
	if (obj) {
		document.querySelectorAll('#obj-tabs .obj-tab').forEach((t) => t.classList.remove('active'));
		obj.classList.add('active');
		return;
	}
	// Prescription : onglets
	const pt = e.target.closest('.presc-tab');
	if (pt) {
		pt.closest('.presc-tabs').querySelectorAll('.presc-tab').forEach((t) => t.classList.remove('active'));
		pt.classList.add('active');
		return;
	}
	// Entraînement : onglets
	const tr = e.target.closest('#tr-tabs .chip');
	if (tr) {
		document.querySelectorAll('#tr-tabs .chip').forEach((c) => c.classList.remove('active'));
		tr.classList.add('active');
		document.querySelectorAll('.tr-sec').forEach((s) => {
			s.style.display = s.dataset.tr === tr.dataset.tr ? '' : 'none';
		});
		return;
	}
	// Entraînement : ouvrir l'éditeur
	if (e.target.closest('[data-open-editor]')) {
		document.querySelector('#tr-tabs .chip[data-tr="editeur"]')?.click();
		return;
	}
	// Entraînement : séances
	const sess = e.target.closest('.sess-item');
	if (sess) {
		sess.parentElement.querySelectorAll('.sess-item').forEach((s) => s.classList.remove('active'));
		sess.classList.add('active');
		return;
	}
	// Entraînement : exercices sélectionnables
	const ex = e.target.closest('#page-entrainement .ex-row');
	if (ex && !e.target.closest('button')) {
		const list = ex.parentElement.querySelectorAll('.ex-row');
		if (list[0].closest('.editor-grid')) {
			list.forEach((r) => r.classList.remove('selected'));
			ex.classList.add('selected');
		}
		return;
	}
	// Planning : mode réservation
	const mode = e.target.closest('#mode-suivi, #mode-demarrage');
	if (mode) {
		document.querySelectorAll('#mode-suivi, #mode-demarrage').forEach((m) => m.classList.remove('active'));
		mode.classList.add('active');
		document.querySelectorAll('#planner .slot.free').forEach((s) => {
			s.style.background = 'var(--brand-light)';
			s.style.borderColor = 'var(--brand)';
			s.style.color = 'var(--brand-deep)';
			s.style.boxShadow = 'inset 0 0 0 1px rgba(29,185,84,0.35)';
		});
		document.getElementById('planner-hint').textContent = 'Mode réservation — les créneaux en vert sont réellement disponibles (moteur serveur : disponibilités − Google − RDV − buffers).';
		return;
	}
	// Message global : envoi simulé
	if (e.target.closest('#global-msg-send')) {
		document.getElementById('global-msg-send').type = 'button';
		e.preventDefault();
		toast('Message global envoyé à 24 clientes actives ✓ (simulation preview)');
		return;
	}
	// Nouveau programme
	if (e.target.closest('#btn-new-prog')) {
		toast('Modale « Nouveau programme » — gérée par l’app réelle (aperçu du design).');
		return;
	}
});

function updateNotifCounts() {
	const unread = document.querySelectorAll('#to-consult .notif-row.unread').length;
	const seen = document.querySelectorAll('#seen .notif-row').length;
	document.getElementById('unread-count').textContent = unread;
	document.getElementById('seen-count').textContent = seen;
	document.querySelector('.side-item[data-goto="notifications"] .dot').textContent = unread;
	document.querySelector('.side-item[data-goto="notifications"] .dot').style.display = unread > 0 ? '' : 'none';
	document.querySelector('.icon-btn .ping').textContent = unread;
	document.querySelector('.icon-btn .ping').style.display = unread > 0 ? '' : 'none';
}

/* Filtres notifications */
document.querySelectorAll('#notif-filters .chip').forEach((chip) => {
	chip.addEventListener('click', () => {
		document.querySelectorAll('#notif-filters .chip').forEach((c) => c.classList.remove('active'));
		chip.classList.add('active');
		const kind = chip.dataset.kind;
		let n1 = 0, n2 = 0;
		document.querySelectorAll('#to-consult .notif-row, #seen .notif-row').forEach((r) => {
			const show = kind === 'all' || r.dataset.kind === kind;
			r.style.display = show ? '' : 'none';
		});
		n1 = [...document.querySelectorAll('#to-consult .notif-row')].filter((r) => r.style.display !== 'none').length;
		document.getElementById('unread-count').textContent = n1;
	});
});

/* Dashboard : filtre clientes */
document.getElementById('dash-filter')?.addEventListener('input', (e) => {
	const q = e.target.value.toLowerCase();
	document.querySelectorAll('#dash-clients .client-tile').forEach((t) => {
		t.style.display = t.dataset.name.includes(q) ? '' : 'none';
	});
});

renderIcons();
updateNotifCounts();
