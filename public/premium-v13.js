(() => {
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=(v,d=3)=>Number.isFinite(Number(v))?Number(v).toFixed(d):'—';
  const pretty=v=>String(v||'').replaceAll('_',' ').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
  const dt=v=>{const d=new Date(v);return v&&!Number.isNaN(d.getTime())?d.toLocaleString([], {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'—';};
  const activeStatuses=new Set(['CANDIDATE','AWAITING_APPROVAL','AI_REVIEW']);

  function targetWindow(v){
    if(!v)return '—';
    const fmt=m=>m>=1440?`${(m/1440).toFixed(m%1440?1:0)}d`:m>=60?`${(m/60).toFixed(m%60?1:0)}h`:`${m}m`;
    return `${fmt(Number(v.min_minutes||0))} – ${fmt(Number(v.max_minutes||0))}`;
  }

  function lineY(value,min,max,h,pad){return pad+(max-Number(value))*(h-pad*2)/(max-min);}

  function patternChart(review,plan){
    const visual=review?.visual||{}, candles=Array.isArray(visual.candles)?visual.candles.filter(c=>[c.open,c.high,c.low,c.close].every(x=>Number.isFinite(Number(x)))):[];
    if(candles.length<4)return '<div class="patternChartEmpty">Chart snapshot is not available for this setup.</div>';
    const levels=[plan.entry,plan.stop_loss,plan.take_profit].map(Number).filter(Number.isFinite);
    const all=[...candles.flatMap(c=>[Number(c.high),Number(c.low)]),...levels];
    let min=Math.min(...all),max=Math.max(...all);const span=Math.max(max-min,0.001);min-=span*.09;max+=span*.09;
    const w=720,h=310,pad=24,step=(w-pad*2)/candles.length,bodyW=Math.max(3,step*.48);
    const candleSvg=candles.map((c,i)=>{
      const x=pad+step*i+step/2,yo=lineY(c.open,min,max,h,pad),yc=lineY(c.close,min,max,h,pad),yh=lineY(c.high,min,max,h,pad),yl=lineY(c.low,min,max,h,pad),up=Number(c.close)>=Number(c.open);
      return `<line class="pcWick ${up?'up':'down'}" x1="${x}" y1="${yh}" x2="${x}" y2="${yl}"/><rect class="pcBody ${up?'up':'down'}" x="${x-bodyW/2}" y="${Math.min(yo,yc)}" width="${bodyW}" height="${Math.max(2,Math.abs(yc-yo))}" rx="1"/>`;
    }).join('');
    const sl=x=>lineY(x,min,max,h,pad);
    const overlays=[];
    const n=candles.length, x1=pad+step/2,x2=pad+step*(n-.5);
    if(visual.upper)overlays.push(`<line class="pcStructure" x1="${x1}" y1="${sl(visual.upper.start)}" x2="${x2}" y2="${sl(visual.upper.end)}"/>`);
    if(visual.lower)overlays.push(`<line class="pcStructure secondary" x1="${x1}" y1="${sl(visual.lower.start)}" x2="${x2}" y2="${sl(visual.lower.end)}"/>`);
    if(visual.trendline)overlays.push(`<line class="pcStructure" x1="${x1}" y1="${sl(visual.trendline.start)}" x2="${x2}" y2="${sl(visual.trendline.end)}"/>`);
    const level=(value,label,cls)=>Number.isFinite(Number(value))?`<line class="pcLevel ${cls}" x1="${pad}" y1="${sl(value)}" x2="${w-pad}" y2="${sl(value)}"/><text class="pcLabel ${cls}" x="${w-pad-4}" y="${sl(value)-5}" text-anchor="end">${label} ${num(value)}</text>`:'';
    return `<div class="patternChart"><svg viewBox="0 0 ${w} ${h}" aria-label="${esc(review?.timeframe||'M15')} pattern chart"><rect class="pcBg" x="0" y="0" width="${w}" height="${h}" rx="18"/>${candleSvg}${overlays.join('')}${level(plan.entry,'ENTRY','entry')}${level(plan.take_profit,'TP','tp')}${level(plan.stop_loss,'SL','sl')}</svg><div class="patternChartFoot"><span>${esc(review?.timeframe||'M15')} · MT5 snapshot</span><span>${candles.length} closed candles</span></div></div>`;
  }

  function scoreRows(review){
    const s=review?.score_components||{};const entries=Object.entries(s);
    if(!entries.length)return '<div class="scoreEmpty">No component score available.</div>';
    return entries.map(([k,v])=>`<div class="scoreRow"><span>${esc(pretty(k))}</span><div><i style="width:${Math.min(100,Math.max(0,Number(v)/30*100))}%"></i></div><strong>${Math.round(Number(v)||0)}</strong></div>`).join('');
  }

  function enhanceCards(plans){
    for(const p of plans){
      if(!activeStatuses.has(String(p.status||'')))continue;
      const card=document.querySelector(`.planCard[data-plan-id="${CSS.escape(String(p.plan_id))}"]`);if(!card)continue;
      const score=card.querySelector('.confidenceBox .n');if(score&&Number.isFinite(Number(p.review?.setup_score)))score.textContent=`${Math.round(Number(p.review.setup_score))}/100`;
      if(card.querySelector('.patternMetaStrip'))continue;
      const r=p.review||{},pattern=r.pattern||{};
      const strip=document.createElement('div');strip.className='patternMetaStrip';
      strip.innerHTML=`<div><small>Pattern</small><strong>${esc(pretty(pattern.name||p.setup))}</strong></div><div><small>Status</small><strong>${esc(pattern.status||r.pattern_status||'CONFIRMED')}</strong></div><div><small>TF</small><strong>${esc(pattern.timeframe||r.timeframe||'M5')}</strong></div><div><small>Target window</small><strong>${esc(targetWindow(r.estimated_target_window||pattern.target_window))}</strong></div><div><small>Expires</small><strong>${esc(dt(r.expires_at||pattern.expires_at))}</strong></div>`;
      const price=card.querySelector('.priceGrid');card.insertBefore(strip,price||card.firstChild);
    }
  }

  async function getPlans(){const res=await fetch('/api/v1/plans?limit=50',{cache:'no-store'});if(!res.ok)return [];return (await res.json()).plans||[];}

  async function openAnalysis(planId){
    const plans=await getPlans(),p=plans.find(x=>String(x.plan_id)===String(planId));if(!p)return;
    let modal=document.getElementById('thesisModal');if(!modal){modal=document.createElement('div');modal.id='thesisModal';modal.className='thesisModal';modal.innerHTML='<section class="thesisSheet" role="dialog" aria-modal="true"><div id="thesisBody"></div></section>';document.body.appendChild(modal);}
    const r=p.review||{},pattern=r.pattern||{},confluence=Array.isArray(r.confluence)?r.confluence:[],reasons=(p.reason_codes||[]).map(x=>`<span>${esc(pretty(x))}</span>`).join('');
    const canManual=!!document.querySelector(`.planCard[data-plan-id="${CSS.escape(String(planId))}"] button[data-action="approve"]`);
    modal.querySelector('#thesisBody').innerHTML=`<div class="thesisTop"><div><small>Pattern intelligence</small><h3>XAUUSD · ${esc(pretty(pattern.name||p.setup))}</h3><p class="patternSub">${esc(pattern.timeframe||r.timeframe||'M5')} · ${esc(pattern.status||r.pattern_status||'CONFIRMED')} · detected ${esc(dt(pattern.detected_at||p.market_timestamp))}</p></div><button class="modalClose" data-modal-close aria-label="Close">×</button></div>${patternChart(r,p)}<div class="patternSummary"><div><span>Setup Score</span><strong>${Math.round(Number(r.setup_score||p.entry_confidence*100))}/100</strong></div><div><span>Entry</span><strong>${num(p.entry)}</strong></div><div><span>Target</span><strong class="green">${num(p.take_profit)}</strong></div><div><span>Stop</span><strong class="red">${num(p.stop_loss)}</strong></div><div><span>R:R</span><strong>${Number.isFinite(Number(p.plan?.rr))?`1:${Number(p.plan.rr).toFixed(2)}`:'—'}</strong></div><div><span>Target Window</span><strong>${esc(targetWindow(r.estimated_target_window||pattern.target_window))}</strong></div><div><span>Expires</span><strong>${esc(dt(r.expires_at||pattern.expires_at))}</strong></div><div><span>Engine</span><strong>Rule Engine</strong></div></div><div class="detailBlock"><label>Why this setup exists</label><p>${esc(p.thesis||'No thesis supplied.')}</p></div><div class="detailBlock"><label>Invalidation</label><p>${esc(p.invalidation||'No invalidation supplied.')}</p></div><div class="detailBlock scoreBlock"><label>Setup quality breakdown</label>${scoreRows(r)}</div><div class="detailBlock"><label>Confluence</label><div class="reasonList">${confluence.length?confluence.map(x=>`<span>${esc(pretty(x))}</span>`).join(''):'<span>No additional confluence detected</span>'}</div></div><div class="detailBlock"><label>Evidence</label><div class="reasonList">${reasons||'<span>No reason codes</span>'}</div></div>${canManual?'<div class="modalActions"><button class="modalReject" data-pattern-action="reject">Reject</button><button class="modalApprove" data-pattern-action="approve">Approve</button></div>':''}`;
    modal.querySelector('[data-modal-close]')?.addEventListener('click',()=>{modal.classList.remove('open');document.body.classList.remove('modalOpen');});
    modal.querySelectorAll('[data-pattern-action]').forEach(b=>b.addEventListener('click',()=>{document.querySelector(`.planCard[data-plan-id="${CSS.escape(String(planId))}"] button[data-action="${b.dataset.patternAction}"]`)?.click();modal.classList.remove('open');document.body.classList.remove('modalOpen');}));
    modal.classList.add('open');document.body.classList.add('modalOpen');
  }

  document.addEventListener('click',e=>{
    const b=e.target.closest('.analysisRead');if(!b)return;
    const card=b.closest('.planCard[data-plan-id]');if(!card)return;
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();openAnalysis(card.dataset.planId);
  },true);

  async function refresh(){try{enhanceCards(await getPlans());}catch{}}
  document.addEventListener('DOMContentLoaded',()=>{refresh();const grid=document.getElementById('planGrid');if(grid)new MutationObserver(()=>setTimeout(refresh,0)).observe(grid,{childList:true});setInterval(refresh,5000);});
})();
