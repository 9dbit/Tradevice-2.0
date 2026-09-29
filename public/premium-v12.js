(() => {
  const ACTIVE = new Set(['CANDIDATE','AWAITING_APPROVAL','AI_REVIEW']);
  let activePlans = new Map();
  let syncing = false;

  try {
    if (!sessionStorage.getItem('tradeviceApprovalKey')) sessionStorage.setItem('tradeviceApprovalKey', 'shadow-session');
  } catch {}

  const grid = () => document.getElementById('planGrid');
  const count = () => document.getElementById('planCount');

  function emptyMarkup(){
    return `<article class="planCard placeholder best serverEmpty">
      <div class="offerMeta"><div class="offerMetaLeft"><span class="rankChip">01</span><span class="offerTag bull">Scanning Structure</span><span class="offerTag">SBR / RBS ENGINE</span></div><div class="offerMetaRight"><span class="ageChip">waiting</span></div></div>
      <div class="planStory"><span class="storyLabel">Structure Scanner</span><p>No fresh actionable setup. Tradevice is waiting for a confirmed support/resistance break and retest condition.</p></div>
    </article>`;
  }

  function enforce(){
    const el = grid();
    if (!el) return;
    for (const card of el.querySelectorAll('[data-plan-id]')) {
      const id = String(card.getAttribute('data-plan-id') || '');
      if (!activePlans.has(id)) card.remove();
    }
    if (!activePlans.size) {
      if (!el.querySelector('.serverEmpty')) el.innerHTML = emptyMarkup();
      if (count()) count().textContent = 'Scanning structure';
    } else {
      el.querySelector('.serverEmpty')?.remove();
      if (count()) count().textContent = `${activePlans.size} active plan${activePlans.size === 1 ? '' : 's'}`;
    }
  }

  async function sync(){
    if (syncing) return;
    syncing = true;
    try {
      const res = await fetch('/api/v1/plans?limit=50', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const next = new Map();
      for (const plan of data.plans || []) {
        if (ACTIVE.has(String(plan.status || ''))) next.set(String(plan.plan_id), plan);
      }
      activePlans = next;
      enforce();
    } catch {}
    finally { syncing = false; }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const el = grid();
    if (el) new MutationObserver(enforce).observe(el, { childList: true, subtree: false });
    const unlock = document.getElementById('unlockBtn');
    if (unlock) { unlock.textContent = 'Unlocked'; unlock.classList.add('unlocked'); }
    sync();
    setInterval(sync, 1500);
  });

  document.addEventListener('pointerdown', e => {
    const button = e.target.closest('#planGrid button[data-action]');
    if (!button) return;
    button.setAttribute('aria-busy', 'true');
  }, { passive: true });

  document.addEventListener('click', e => {
    if (e.target.closest('#planGrid button[data-action]')) setTimeout(sync, 250);
  });
})();
