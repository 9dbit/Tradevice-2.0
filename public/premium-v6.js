(() => {
  const nav = document.querySelector('.mobileNav');
  const nativeVibrate = typeof navigator.vibrate === 'function' ? navigator.vibrate.bind(navigator) : null;
  let lastHapticAt = -1000;

  function fireHaptic(pattern = 5) {
    if (!nativeVibrate) return;
    lastHapticAt = performance.now();
    try { nativeVibrate(pattern); } catch {}
  }

  if (nativeVibrate) {
    const deduped = pattern => {
      const now = performance.now();
      if (now - lastHapticAt < 180) return false;
      lastHapticAt = now;
      try { return nativeVibrate(pattern); } catch { return false; }
    };
    try { Object.defineProperty(navigator, 'vibrate', { configurable: true, value: deduped }); }
    catch { try { navigator.vibrate = deduped; } catch {} }
  }

  function setNav(index) {
    if (!nav) return;
    const i = Math.max(0, Math.min(4, Number(index) || 0));
    nav.style.setProperty('--nav-index', String(i));
    nav.querySelectorAll('a[data-nav]').forEach(a => a.classList.toggle('active', Number(a.dataset.nav) === i));
  }

  nav?.addEventListener('pointerdown', event => {
    const item = event.target.closest('a[data-nav]');
    if (!item) return;
    fireHaptic(5);
    item.classList.add('navPressed');
    setNav(item.dataset.nav);
  }, { passive: true });

  nav?.addEventListener('pointerup', event => event.target.closest('a[data-nav]')?.classList.remove('navPressed'));
  nav?.addEventListener('pointercancel', event => event.target.closest('a[data-nav]')?.classList.remove('navPressed'));
  nav?.addEventListener('click', event => {
    const item = event.target.closest('a[data-nav]');
    if (item) setNav(item.dataset.nav);
  });

  document.addEventListener('pointerdown', event => {
    const action = event.target.closest('.planActions button[data-action]');
    if (action && !action.disabled) {
      fireHaptic(action.dataset.action === 'approve' ? 9 : 7);
      action.classList.add('pointerPressed');
      return;
    }
    const tactile = event.target.closest('.seg button,.unlock,.charttools button');
    if (tactile && !tactile.disabled) fireHaptic(5);
  }, { passive: true, capture: true });

  const clearPress = () => document.querySelectorAll('.pointerPressed,.navPressed').forEach(el => el.classList.remove('pointerPressed','navPressed'));
  document.addEventListener('pointerup', clearPress, { passive: true });
  document.addEventListener('pointercancel', clearPress, { passive: true });

  const sections = [
    [document.getElementById('dashboard'), 0],
    [document.getElementById('offers'), 1],
    [document.getElementById('orders'), 2],
    [document.getElementById('analysis'), 3]
  ].filter(([el]) => el);

  let ticking = false;
  function syncFromScroll() {
    ticking = false;
    const marker = window.scrollY + Math.min(window.innerHeight * .34, 260);
    let current = 0;
    for (const [el, index] of sections) if (el.offsetTop <= marker) current = index;
    setNav(current);
  }
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(syncFromScroll);
  }, { passive: true });

  setNav(0);
  syncFromScroll();
})();
