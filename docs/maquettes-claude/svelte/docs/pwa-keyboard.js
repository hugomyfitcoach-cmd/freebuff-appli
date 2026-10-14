// Clavier : sur iOS il recouvre la page, sur Android il redimensionne la zone visible
const vv = window.visualViewport;
vv.addEventListener('resize', () => {
  const kb = Math.max(0, window.innerHeight - vv.height);
  document.documentElement.style.setProperty('--kb', kb + 'px');   // fenêtre de saisie : bottom: var(--kb)
});
