(() => {
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = (v,d=3) => typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '—';
  const conf = v => typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v*100)}%` : '—';
  const dt = v => { const d=new Date(v); return v && !Number.isNaN(d.getTime()) ? d.toLocaleString([], {month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—'; };
  const sign = (v,d=2) => typeof v === 'number' && Number.isFinite(v) ? `${v>=0?'+':''}${v.toFixed(d)}` : '—';
  let approvalMode = 'manual';
  let approvalUnlocked = Boolean(sessionStorage.getItem('tradeviceApprovalKey'));

  function setText(id,v){ const el=$(id); if(el) el.textContent=v; }
  function currentKey(){ return sessionStorage.getItem('tradeviceApprovalKey') || ''; }
  function stateLabel(plan){ return plan.execution?.lifecycle || plan.status || 'CANDIDATE'; }

  async function ensureApprovalKey(){
    let key=currentKey();
    if(!key) key=window.prompt('Tradevice Approval Key');
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
    setText('approvalNote', approvalMode==='manual' ? 'Manual mode: choose which offered plan enters the shadow pending-order engine.' : 'AI Auto: only the highest eligible plan at or above 80% entry confidence can auto-activate after risk review.');
  }

  function renderMarket(dashboard,status){
    const m=dashboard?.market||{}, f=dashboard?.feed||{};
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
    const pv=p.plan||{}, state=stateLabel(p), manualAction=approvalMode==='manual' && ['AWAITING_APPROVAL','CANDIDATE'].includes(p.status);
    const low=typeof p.entry_confidence==='number' && p.entry_confidence<threshold;
    const execution=p.execution?.lifecycle ? ` · ${p.execution.lifecycle}` : '';
    const tpText=typeof pv.tp_pips==='number'?`${pv.tp_pips.toFixed(1)} pips · ${typeof pv.tp_usd==='number'?`+$${Math.abs(pv.tp_usd).toFixed(2)}`:'$—'}`:'—';
    const slText=typeof pv.sl_pips==='number'?`${pv.sl_pips.toFixed(1)} pips · ${typeof pv.sl_usd==='number'?`-$${Math.abs(pv.sl_usd).toFixed(2)}`:'$—'}`:'—';
    const bullish=p.side==='BUY';
    const best=rank===0;
    const sideClass=bullish?'buy':'sell';
    const setupLabel=bullish?'Bullish Setup':'Bearish Setup';
    return `<article class="planCard${best?' best':''}" data-plan-id="${esc(p.plan_id)}">
      <div class="offerMeta"><div class="offerMetaLeft"><span class="rankChip">${String(rank+1).padStart(2,'0')}</span><span class="offerTag ${bullish?'bull':'bear'}">${setupLabel}</span><span class="offerTag">${esc(String(p.setup||'').replaceAll('_',' '))}</span></div><div class="offerMetaRight">${best?'<span class="bestBadge">BEST SETUP</span>':''}<span class="ageChip">${dt(p.market_timestamp||p.created_at)}</span></div></div>
      <div class="offerHero"><div class="instrumentLine"><span class="goldMark">◆</span><span class="instrument">XAUUSD</span><span class="sidePill ${sideClass}">${esc(p.side)}</span><span class="orderPill">${esc(String(p.order_type||'').replaceAll('_',' '))}</span></div><div class="confidenceBox"><span class="signalBars"><i></i><i></i><i></i><i></i></span><div><div class="n">${conf(p.entry_confidence)}</div><div class="t">Entry Confidence</div></div><div class="dc">Decision ${conf(p.decision_confidence)}</div></div></div>
      <div class="priceGrid"><div class="price"><div class="k">Entry Price</div><div class="v">${num(p.entry)}</div></div><div class="price"><div class="k">TP Price</div><div class="v green">${num(p.take_profit)}</div></div><div class="price"><div class="k">SL Price</div><div class="v red">${num(p.stop_loss)}</div></div></div>
      <div class="metrics"><div class="metric"><div class="k">Lot Size</div><div class="v">${typeof pv.lot==='number'?pv.lot.toFixed(2):'0.01'}</div></div><div class="metric"><div class="k">R:R</div><div class="v">${typeof pv.rr==='number'?`1:${pv.rr.toFixed(2)}`:'—'}</div></div><div class="metric"><div class="k">TP (Pips | $)</div><div class="v green">${tpText}</div></div><div class="metric"><div class="k">SL (Pips | $)</div><div class="v red">${slText}</div></div></div>
      <div class="planStory"><span class="storyLabel">Thesis</span><p>${esc(p.thesis||'No thesis supplied.')}</p><small>${esc(p.invalidation?`Invalidation: ${p.invalidation}`:'')}${low?' · Below AI auto threshold':''}</small></div>
      <div class="planActions">${manualAction?`<button class="approve" data-action="approve" data-plan="${esc(p.plan_id)}">✓ &nbsp; Approve</button><button class="reject" data-action="reject" data-plan="${esc(p.plan_id)}">✕ &nbsp; Reject</button>`:`<div class="planMessage">${approvalMode==='ai'?'AI Auto review controls activation':esc((state+execution).replaceAll('_',' '))}</div>`}</div>
    </article>`;
  }

  function placeholderCard(rank){
    const best=rank===0;
    return `<article class="planCard placeholder${best?' best':''}">
      <div class="offerMeta"><div class="offerMetaLeft"><span class="rankChip">${String(rank+1).padStart(2,'0')}</span><span class="offerTag bull">Awaiting Setup</span><span class="offerTag">ASTRA CANDIDATE</span></div><div class="offerMetaRight">${best?'<span class="bestBadge">BEST SETUP</span>':''}<span class="ageChip">waiting</span></div></div>
      <div class="offerHero"><div class="instrumentLine"><span class="goldMark">◆</span><span class="instrument">XAUUSD</span><span class="sidePill buy">—</span><span class="orderPill">PENDING TYPE</span></div><div class="confidenceBox"><span class="signalBars"><i></i><i></i><i></i><i></i></span><div><div class="n">—</div><div class="t">Entry Confidence</div></div><div class="dc">Decision —</div></div></div>
      <div class="priceGrid"><div class="price"><div class="k">Entry Price</div><div class="v">—</div></div><div class="price"><div class="k">TP Price</div><div class="v">—</div></div><div class="price"><div class="k">SL Price</div><div class="v">—</div></div></div>
      <div class="metrics"><div class="metric"><div class="k">Lot Size</div><div class="v">0.01</div></div><div class="metric"><div class="k">R:R</div><div class="v">—</div></div><div class="metric"><div class="k">TP (Pips | $)</div><div class="v">—</div></div><div class="metric"><div class="k">SL (Pips | $)</div><div class="v">—</div></div></div>
      <div class="planStory"><span class="storyLabel">Thesis</span><p>${rank===0?'Waiting for the next qualified XAUUSD setup.':'Candidate slot reserved for the next Astra scenario.'}</p></div>
      <div class="planActions"><button class="approve" disabled>✓ &nbsp; Approve</button><button class="reject" disabled>✕ &nbsp; Reject</button></div>
    </article>`;
  }

  function renderPlans(payload){
    renderMode(payload?.approval_mode||'manual');
    const plans=payload?.plans||[], grid=$('planGrid'), threshold=Number(payload?.auto_threshold??0.8);
    if(!grid)return;
    if(!plans.length){ grid.innerHTML=[0,1,2].map(placeholderCard).join(''); setText('planCount','Waiting for Astra'); return; }
    const group=plans[0].group_id; const latest=plans.filter(p=>p.group_id===group);
    setText('planCount',`${latest.length} plan${latest.length===1?'':'s'} · ${dt(latest[0]?.market_timestamp)}`);
    grid.innerHTML=latest.sort((a,b)=>Number(b.entry_confidence||0)-Number(a.entry_confidence||0)).map((p,i)=>planCard(p,threshold,i)).join('');
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
    const res=await fetch(`/api/v1/plans/${encodeURIComponent(planId)}/${action}`,{method:'POST',headers:{'x-approval-key':currentKey()}});
    const data=await res.json().catch(()=>({}));
    if(!res.ok){ window.alert(data.code||data.error||'Plan action rejected'); }
    await refresh();
  }

  function bind(){
    $('unlockBtn')?.addEventListener('click',ensureApprovalKey); $('manualMode')?.addEventListener('click',()=>setApprovalMode('manual')); $('aiMode')?.addEventListener('click',()=>setApprovalMode('ai'));
    $('planGrid')?.addEventListener('click',e=>{ const b=e.target.closest('button[data-action]'); if(b) planAction(b.dataset.plan,b.dataset.action); });
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
