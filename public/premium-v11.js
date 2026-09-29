(() => {
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pretty = v => String(v || '').replaceAll('_',' ').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
  const num = (v,d=3) => Number.isFinite(Number(v)) ? Number(v).toFixed(d) : '—';

  function expiryInfo(plan){
    const base = Date.parse(plan.market_timestamp || plan.created_at || '');
    const ttl = Math.max(1, Number(plan.expiration_candles || 3)) * 60 + 30;
    const age = Number.isFinite(base) ? Math.max(0, (Date.now() - base) / 1000) : Infinity;
    return { stale: age > ttl, age, ttl };
  }

  function markPlanFreshness(plan){
    const card = document.querySelector(`[data-plan-id="${CSS.escape(String(plan.plan_id))}"]`);
    if (!card) return;
    const info = expiryInfo(plan);
    card.classList.toggle('planStale', info.stale);
    let badge = card.querySelector('.freshnessBadge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'freshnessBadge';
      card.querySelector('.offerMetaRight')?.prepend(badge);
    }
    if (badge) {
      badge.classList.toggle('stale', info.stale);
      badge.textContent = info.stale ? 'STALE' : `${Math.max(0, Math.ceil(info.ttl-info.age))}s`;
    }
    const approve = card.querySelector('[data-action="approve"]');
    if (approve && info.stale) {
      approve.disabled = true;
      approve.dataset.originalText ||= approve.textContent;
      approve.textContent = 'Expired · Re-analyze';
      approve.setAttribute('aria-disabled','true');
    }
  }

  async function refreshFreshness(){
    try {
      const res = await fetch('/api/v1/plans?limit=30',{cache:'no-store'});
      if (!res.ok) return;
      const data = await res.json();
      (data.plans || []).forEach(markPlanFreshness);
    } catch {}
  }

  function renderPreview(data){
    const box = $('executionPreview');
    if (!box) return;
    const status = String(data.status || 'EMPTY');
    box.classList.remove('ready','blocked','waiting');
    if (status === 'READY_FOR_MANUAL_EXECUTION') {
      box.classList.add('ready');
      $('executionPreviewState').textContent = 'READY';
      $('executionPreviewDetail').innerHTML = `${esc(data.side)} ${esc(pretty(data.order_type))} · Entry ${num(data.entry)} · SL ${num(data.stop_loss)} · TP ${num(data.take_profit)} · ${esc(data.broker_symbol || 'MT5')}`;
      return;
    }
    if (status === 'BLOCKED') {
      box.classList.add('blocked');
      $('executionPreviewState').textContent = 'BLOCKED';
      $('executionPreviewDetail').textContent = (data.reasons || []).map(pretty).join(' · ') || 'Execution guard rejected this preview.';
      return;
    }
    box.classList.add('waiting');
    $('executionPreviewState').textContent = 'WAITING';
    $('executionPreviewDetail').textContent = 'No fresh approved pending plan. Approve a current setup to run the MT5 price re-check.';
  }

  async function refreshPreview(){
    try {
      const res = await fetch('/api/v1/order-preview',{cache:'no-store'});
      if (!res.ok) return;
      renderPreview(await res.json());
    } catch {}
  }

  function refresh(){ refreshFreshness(); refreshPreview(); }
  document.addEventListener('DOMContentLoaded',()=>{ refresh(); setInterval(refresh,3000); });
  document.addEventListener('click',e=>{ if(e.target.closest('[data-action="approve"],[data-action="reject"]')) setTimeout(refresh,500); });
})();
