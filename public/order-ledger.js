(() => {
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = (v,d=3) => typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '—';
  const conf = v => typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v*100)}%` : '—';
  const dt = v => { const d=new Date(v); return v && !Number.isNaN(d.getTime()) ? d.toLocaleString([], {month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—'; };
  const sign = (v,d=2) => typeof v === 'number' && Number.isFinite(v) ? `${v>=0?'+':''}${v.toFixed(d)}` : '—';
  const ACTIVE_PLAN_STATUSES = new Set(['CANDIDATE','AWAITING_APPROVAL','AI_REVIEW']);
  let approvalMode = 'manual';
  let approvalUnlocked = Boolean(sessionStorage.getItem('tradeviceApprovalKey'));

  function haptic(pattern=10){ try{ if(typeof navigator.vibrate==='function') navigator.vibrate(pattern); }catch{} }
  function pressFx(button){ if(!button)return; button.classList.add('pressed'); setTimeout(()=>button.classList.remove('pressed'),110); }
  function setText(id,v){ const el=$(id); if(el) el.textContent=v; }
  function currentKey(){ return String(sessionStorage.getItem('tradeviceApprovalKey') || '').trim(); }
  function stateLabel(plan){ return plan.execution?.lifecycle || plan.status || 'CANDIDATE'; }

  async function ensureApprovalKey(){
    let key=currentKey();
    if(!key) key=window.prompt('Tradevice Approval Key');
    key=String(key||'').trim();
    if(!key) return false;
    const res=await fetch('/api/v1/approval/verify',{method:'POST',headers:{'x-approval-key':key}});
    if(!res.ok){ sessionStorage.removeItem('tradeviceApprovalKey'); approvalUnlocked=false; renderUnlock(); window.alert('Approval key is invalid.'); return false; }
    sessionStorage.setItem('tradeviceApprovalKey',key); approvalUnlocked=true; renderUnlock(); return true;
  }

  function renderUnlock(){ const b=$('unlockBtn'); if(!b)return; b.textContent=approvalUnlocked?'Unlocked':'Unlock'; b.classList.toggle('unlocked',approvalUnlocked); }
  function renderMode(mode){
    approvalMode=mode==='ai'?'ai':'manual';
    $('manualMode')?.classList.toggle('active',approvalMode==='manual');
    $('aiMode')?.classList.toggle('active',approvalMode==='ai');
    setText('approvalNote', approvalMode==='manual' ? 'Manual mode: choose which offered plan enters the shadow pending-order engine.' : 'Auto mode: only eligible structure plans can activate after policy and risk review.');
  }

  function money(v){ return typeof v==='number' && Number.isFinite(v) ? `$${v.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}` : '$—'; }
  function renderMarket(dashboard,status){
    const m=dashboard?.market||{}, f=dashboard?.feed||{}, a=dashboard?.account||{};
    setText('walletEquity',money(a.equity)); setText('walletBalance',money(a.balance)); setText('walletFreeMargin',money(a.free_margin));
    setText('walletPositions',String(a.positions_total??0)); setText('walletOrders',String(a.orders_total??0));
    const fp=typeof a.floating_pnl==='number'?a.floating_pnl:null;
    setText('walletFloating',fp===null?'Floating $—':`Floating ${fp>=0?'+':''}${money(fp)}`);
    const wf=$('walletFloating'); if(wf){wf.classList.toggle('green',fp>0);wf.classList.toggle('red',fp<0);}
    setText('bid',num(m.bid)); setText('ask',num(m.ask)); setText('spread',typeof m.spread_points==='number'?`${m.spread_points.toFixed(0)} pt`:'—');
    setText('feedState',f.state||'—'); setText('aiWorker',status?.ai_decision_enabled?'ON':'OFF');
    setText('chartPrice',m.bid?`XAUUSD ${num(m.bid)}`:'XAUUSD —'); setText('chartMeta',`${f.state||'WAIT'} · spread ${typeof m.spread_points==='number'?m.spread_points.toFixed(0):'—'} pt · ${typeof f.age_seconds==='number'?f.age_seconds+'s ago':'—'}`);
    const p=$('servicePill'); if(p) p.textContent=f.state==='CONNECTED'?'● ONLINE':`● ${f.state||'CHECK'}`;
  }

  function renderPerformance(d){
    const p=d?.performance||{}; setText('closedTrades',String(p.closed_trades??0)); setText('winRate',typeof p.win_rate==='number'?`${(p.win_rate*100).toFixed(1)}%`:'—');
    setText('expectancy',typeof p.expectancy_r==='number'?`${sign(p.expectancy_r)}R`:'—'); setText('profitFactor',typeof p.profit_factor==='number'?p.profit_factor.toFixed(2):'—');
  }

  function planCard(p,threshold,rank=0){
    const pv=p.plan||{}, state=stateLabel(p), manualAction=approvalMode==='manual' && ACTIVE_PLAN_STATUSES.has(String(p.status));
    const deterministic=String(p.source_model||'').startsWith('deterministic-');
    const low=!deterministic && typeof p.entry_confidence==='number' && p.entry_confidence<threshold;
    const execution=p.execution?.lifecycle ? ` · ${p.execution.lifecycle}` : '';
    const tpText=typeof pv.tp_pips==='number'?`${pv.tp_pips.toFixed(1)} pips · ${typeof pv.tp_usd==='number'?`+$${Math.abs(pv.tp_usd).toFixed(2)}`:'$—'}`:'—';
    const slText=typeof pv.sl_pips==='number'?`${pv.sl_pips.toFixed(1)} pips · ${typeof pv.sl_usd==='number'?`-$${Math.abs(pv.sl_usd).toFixed(2)}`:'$—'}`:'—';
    const bullish=p.side==='BUY';
    const best=rank===0;
    const sideClass=bullish?'buy':'sell';
    const setupLabel=bullish?'Bullish Setup':'Bearish Setup';
    const score=deterministic?Number(p.review?.setup_score??p.entry_confidence*100):null;
    const heroValue=deterministic && Number.isFinite(score)?`${Math.round(score)}%`:conf(p.entry_confidence);
    const heroLabel=deterministic?'Setup Score':'Entry Confidence';
    const heroDetail=deterministic?`${String(p.setup||'').replaceAll('_',' ')} · Rule Engine`:`Decision ${conf(p.decision_confidence)}`;
    return `<article class="planCard${best?' best':''}${deterministic?' deterministicPlan':''}" data-plan-id="${esc(p.plan_id)}">
      <div class="offerMeta"><div class="offerMetaLeft"><span class="rankChip">${String(rank+1).padStart(2,'0')}</span><span class="offerTag ${bullish?'bull':'bear'}">${setupLabel}</span><span class="offerTag">${esc(String(p.setup||'').replaceAll('_',' '))}</span></div><div class="offerMetaRight">${deterministic?'<span class="freshnessBadge ruleEngineBadge">RULE ENGINE</span>':''}${best?'<span class="bestBadge">BEST SETUP</span>':''}<span class="ageChip">${dt(p.market_timestamp||p.created_at)}</span></div></div>
      <div class="offerHero"><div class="instrumentLine"><span class="goldMark">◆</span><span class="instrument">XAUUSD</span><span class="sidePill ${sideClass}">${esc(p.side)}</span><span class="orderPill">${esc(String(p.order_type||'').replaceAll('_',' '))}</span></div><div class="confidenceBox"><span class="signalBars"><i></i><i></i><i></i><i></i></span><div><div class="n">${heroValue}</div><div class="t">${heroLabel}</div></div><div class="dc">${esc(heroDetail)}</div></div></div>
      <div class="priceGrid"><div class="price"><div class="k">Entry Price</div><div class="v">${num(p.entry)}</div></div><div class="price"><div class="k">TP Price</div><div class="v green">${num(p.take_profit)}</div></div><div class="price"><div class="k">SL Price</div><div class="v red">${num(p.stop_loss)}</div></div></div>
      <div class="metrics"><div class="metric"><div class="k">Lot Size</div><div class="v">${typeof pv.lot==='number'?pv.lot.toFixed(2):'0.01'}</div></div><div class="metric"><div class="k">R:R</div><div class="v">${typeof pv.rr==='number'?`1:${pv.rr.toFixed(2)}`:'—'}</div></div><div class="metric"><div class="k">TP (Pips | $)</div><div class="v green">${tpText}</div></div><div class="metric"><div class="k">SL (Pips | $)</div><div class="v red">${slText}</div></div></div>
      <div class="planStory"><span class="storyLabel">Thesis</span><p>${esc(p.thesis||'No thesis supplied.')}</p><small>${esc(p.invalidation?`Invalidation: ${p.invalidation}`:'')}${low?' · Below auto threshold':''}</small></div>
      <div class="planActions">${manualAction?`<button class="reject" data-action="reject" data-plan="${esc(p.plan_id)}">✕ &nbsp; Reject</button><button class="approve" data-action="approve" data-plan="${esc(p.plan_id)}">✓ &nbsp; Approve</button>`:`<div class="planMessage">${approvalMode==='ai'?'Auto review controls activation':esc((state+execution).replaceAll('_',' '))}</div>`}</div>
    </article>`;
  }

  function placeholderCard(){
    return `<article class="planCard placeholder best serverEmpty">
      <div class="offerMeta"><div class="offerMetaLeft"><span class="rankChip">01</span><span class="offerTag bull">Scanning Structure</span><span class="offerTag">SBR / RBS ENGINE</span></div><div class="offerMetaRight"><span class="ageChip">waiting</span></div></div>
      <div class="planStory"><span class="storyLabel">Structure Scanner</span><p>No fresh actionable setup. Waiting for a confirmed support/resistance break and retest condition.</p></div>
    </article>`;
  }

  function renderPlans(payload){
    renderMode(payload?.approval_mode||'manual');
    const threshold=Number(payload?.auto_threshold??0.8), grid=$('planGrid');
    if(!grid)return;
    const plans=(payload?.plans||[]).filter(p=>ACTIVE_PLAN_STATUSES.has(String(p.status||''))).sort((a,b)=>Number(b.review?.rank_score??b.review?.setup_score??b.entry_confidence??0)-Number(a.review?.rank_score??a.review?.setup_score??a.entry_confidence??0)).slice(0,5);
    if(!plans.length){ grid.innerHTML=placeholderCard(); setText('planCount','Scanning structure'); return; }
    setText('planCount',`${plans.length} active plan${plans.length===1?'':'s'}`);
    grid.innerHTML=plans.map((p,i)=>planCard(p,threshold,i)).join('');
  }

  function renderOrders(orders){
    const w=$('ordersWrap'); if(!w)return; if(!orders?.length){w.innerHTML='<div class="empty">No order records yet.</div>';return;}
    w.innerHTML=`<table class="tradeTable"><thead><tr><th>Time</th><th>Status</th><th>Side / Type</th><th>Lot</th><th>Entry</th><th>TP</th><th>SL</th><th>R:R</th><th>Entry conf</th><th>Review</th><th>P/L</th></tr></thead><tbody>${orders.map(o=>{const p=o.plan||{}, pnl=o.floating?.pnl_r??o.result?.pnl_r;return `<tr><td data-label="Time">${dt(o.created_at)}</td><td data-label="Status">${esc(o.lifecycle||'—')}</td><td data-label="Side / Type" class="${o.side==='BUY'?'green':'red'}">${esc(o.side||'—')} · ${esc(o.order_type||'—')}</td><td data-label="Lot">${typeof p.lot==='number'?p.lot.toFixed(2):'—'}</td><td data-label="Entry">${num(o.entry)}</td><td data-label="TP" class="green">${num(o.take_profit)}</td><td data-label="SL" class="red">${num(o.stop_loss)}</td><td data-label="R:R">${typeof p.rr==='number'?`1:${p.rr.toFixed(2)}`:'—'}</td><td data-label="Entry conf">${conf(o.entry_confidence)}</td><td data-label="Review">${esc(o.review?.status||'—')}</td><td data-label="P/L" class="${typeof pnl==='number'?(pnl>0?'green':pnl<0?'red':''):''}">${typeof pnl==='number'?`${sign(pnl)}R`:'—'}</td></tr>`}).join('')}</tbody></table>`;
  }

  function renderAnalysis(items){
    const w=$('analysisWrap'); if(!w)return; if(!items?.length){w.innerHTML='<div class="empty">Waiting for analysis.</div>';return;}
    w.innerHTML=`<table class="aiTable"><thead><tr><th>Time</th><th>Decision</th><th>Decision conf</th><th>Entry conf</th><th>Regime</th><th>Triggers</th><th>Why</th></tr></thead><tbody>${items.slice(0,30).map(a=>`<tr><td data-label="Time">${dt(a.market_timestamp||a.created_at)}</td><td data-label="Decision" class="${a.decision==='OFFER'?'green':a.decision==='WAIT'?'amber':''}">${esc(a.decision)}</td><td data-label="Decision conf">${conf(a.decision_confidence??a.confidence)}</td><td data-label="Entry conf">${conf(a.entry_confidence)}</td><td data-label="Regime">${esc(a.regime||'—')}</td><td data-label="Triggers">${esc((a.trigger_codes||a.reason_codes||[]).slice(0,3).join(' · ')||'—')}</td><td data-label="Why" data-wide="1" class="thesis">${esc(a.thesis||a.prefilter_reasons?.join(' · ')||'No AI call')}</td></tr>`).join('')}</tbody></table>`;
  }

  async function setApprovalMode(mode){
    if(!(await ensureApprovalKey()))return;
    const res=await fetch('/api/v1/settings/approval-mode',{method:'POST',headers:{'content-type':'application/json','x-approval-key':currentKey()},body:JSON.stringify({mode})});
    const data=await res.json().catch(()=>({})); if(!res.ok){window.alert(data.error||'Unable to change approval mode');return;} renderMode(data.mode); await refresh();
  }

  async function planAction(planId,action){
    if(!(await ensureApprovalKey()))return;
    const card=document.querySelector(`[data-plan-id="${CSS.escape(String(planId))}"]`);
    card?.querySelectorAll('button[data-action]').forEach(button=>{button.disabled=true;button.setAttribute('aria-busy','true');});
    const res=await fetch(`/api/v1/plans/${encodeURIComponent(planId)}/${action}`,{method:'POST',headers:{'x-approval-key':currentKey()}});
    const data=await res.json().catch(()=>({}));
    if(res.ok){ card?.remove(); }
    else if(['PLAN_EXPIRED','PLAN_INVALIDATED','PLAN_NOT_ACTIVATABLE','PLAN_NOT_REJECTABLE'].includes(String(data.code||''))){ card?.remove(); }
    else { card?.querySelectorAll('button[data-action]').forEach(button=>{button.disabled=false;button.removeAttribute('aria-busy');}); }
    if(!res.ok && !['PLAN_EXPIRED','PLAN_INVALIDATED'].includes(String(data.code||''))) window.alert(data.code||data.error||'Plan action rejected');
    await refresh();
  }

  function bind(){
    $('unlockBtn')?.addEventListener('click',e=>{haptic(8);pressFx(e.currentTarget);ensureApprovalKey();}); $('manualMode')?.addEventListener('click',e=>{haptic(8);pressFx(e.currentTarget);setApprovalMode('manual');}); $('aiMode')?.addEventListener('click',e=>{haptic(8);pressFx(e.currentTarget);setApprovalMode('ai');});
    $('planGrid')?.addEventListener('click',e=>{ const b=e.target.closest('button[data-action]'); if(b&&!b.disabled){ haptic(b.dataset.action==='approve'?12:[8,24,8]); pressFx(b); planAction(b.dataset.plan,b.dataset.action); } });
    document.querySelectorAll('.charttools button[data-tf]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.charttools button').forEach(x=>x.classList.toggle('active',x===b));const f=$('marketChart');if(!f)return;const u=new URL(f.src);u.searchParams.set('interval',b.dataset.tf);f.src=u.toString();}));
    renderUnlock();
  }

  async function refresh(){
    try{
      const [dRes,sRes,lRes,pRes]=await Promise.all([fetch('/api/v1/dashboard',{cache:'no-store'}),fetch('/api/v1/status',{cache:'no-store'}),fetch('/api/v1/orders/ledger?limit=100',{cache:'no-store'}),fetch('/api/v1/plans?limit=30',{cache:'no-store'})]);
      if(!dRes.ok||!sRes.ok||!lRes.ok||!pRes.ok)throw new Error('API unavailable');
      const [d,s,l,p]=await Promise.all([dRes.json(),sRes.json(),lRes.json(),pRes.json()]); renderMarket(d,s);renderPerformance(d);renderPlans(p);renderOrders(l.orders);renderAnalysis(l.analyses);
    }catch(err){const p=$('servicePill');if(p)p.textContent='● OFFLINE';console.error(err);}
  }

  bind();refresh();setInterval(refresh,5000);
})();