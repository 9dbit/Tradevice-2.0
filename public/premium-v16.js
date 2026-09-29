(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const num = (value, digits = 3) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—';
  const pct = value => Number.isFinite(Number(value)) ? `${Math.round(Number(value) * 100)}%` : '—';
  const pretty = value => String(value || '').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
  const dt = value => {
    const date = new Date(value || 0);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
  };
  const duration = value => {
    if (!value) return '—';
    const min = Number(value.min_minutes || 0), max = Number(value.max_minutes || 0);
    const fmt = minutes => minutes >= 1440 ? `${(minutes / 1440).toFixed(minutes % 1440 ? 1 : 0)}d` : minutes >= 60 ? `${(minutes / 60).toFixed(minutes % 60 ? 1 : 0)}h` : `${minutes}m`;
    return `${fmt(min)} – ${fmt(max)}`;
  };
  let lastSignature = '';
  let offerSignature = '';

  function stateClass(state) {
    const value = String(state || '').toUpperCase();
    if (value === 'ARMED' || value === 'CONFIRMED') return 'armed';
    if (value === 'FORMING') return 'forming';
    return 'scanning';
  }

  function lineY(value, min, max, height, pad) {
    return pad + (max - Number(value)) * (height - pad * 2) / Math.max(max - min, 1e-9);
  }

  function xForTime(value, from, to, width, pad) {
    const raw = typeof value === 'number' ? value : Math.floor(new Date(value || 0).getTime() / 1000);
    return pad + (raw - from) * (width - pad * 2) / Math.max(to - from, 1);
  }

  function drawingChart(watch) {
    const drawing = watch?.drawing || null;
    const projection = watch?.projection || {};
    const candles = Array.isArray(drawing?.candles) ? drawing.candles.filter(c => [c.open,c.high,c.low,c.close].every(x => Number.isFinite(Number(x)))) : [];
    if (!drawing || candles.length < 4) return '<div class="emergingChartEmpty">V16 drawing geometry will appear after the next structure scan.</div>';
    const width = 720, height = 330, pad = 28;
    const from = Number(drawing.timeFrame?.from), to = Number(drawing.timeFrame?.to);
    const values = candles.flatMap(c => [Number(c.high),Number(c.low)]);
    for (const line of [...(drawing.lines||[]), ...(drawing.arrow||[]), ...(drawing.forecast||[]), ...(drawing.predictionRectangle||[])]) values.push(Number(line.y1),Number(line.y2));
    for (const v of [projection.entry,projection.stop,projection.target]) if (Number.isFinite(Number(v))) values.push(Number(v));
    let min = Math.min(...values), max = Math.max(...values); const span = Math.max(max-min,.001); min -= span*.06; max += span*.06;
    const y = value => lineY(value,min,max,height,pad);
    const x = value => xForTime(value,from,to,width,pad);
    const interval = Number(drawing.interval||15)*60;
    const bodyWidth = Math.max(3, Math.min(13, interval/Math.max(to-from,1)*(width-pad*2)*.56));
    const candleSvg = candles.map(c => {
      const cx=x(c.timestamp), yo=y(c.open), yc=y(c.close), yh=y(c.high), yl=y(c.low), up=Number(c.close)>=Number(c.open);
      return `<line class="evWick ${up?'up':'down'}" x1="${cx}" y1="${yh}" x2="${cx}" y2="${yl}"/><rect class="evBody ${up?'up':'down'}" x="${cx-bodyWidth/2}" y="${Math.min(yo,yc)}" width="${bodyWidth}" height="${Math.max(2,Math.abs(yc-yo))}" rx="1"/>`;
    }).join('');
    const lineSvg=(item,cls='v16Structure')=>item?`<line class="${cls}" x1="${x(item.x1)}" y1="${y(item.y1)}" x2="${x(item.x2)}" y2="${y(item.y2)}"/>`:'';
    const structures=(drawing.lines||[]).map(item=>`${lineSvg(item,'v16Structure')}<text class="v16StructureLabel" x="${x(item.x2)-4}" y="${y(item.y2)-5}" text-anchor="end">${esc(item.name||'Structure')}</text>`).join('');
    const forecasts=(drawing.forecast||[]).map(item=>lineSvg(item,'v16Forecast')).join('');
    const arrow=(drawing.arrow||[]).map(item=>`<line class="v16Arrow" marker-end="url(#arrow-${esc(watch.fingerprint||'pattern')})" x1="${x(item.x1)}" y1="${y(item.y1)}" x2="${x(item.x2)}" y2="${y(item.y2)}"/>`).join('');
    let prediction=''; const pr=drawing.predictionRectangle||[];
    if(pr.length){const xs=pr.flatMap(l=>[x(l.x1),x(l.x2)]),ys=pr.flatMap(l=>[y(l.y1),y(l.y2)]);const rx=Math.min(...xs),ry=Math.min(...ys),rw=Math.max(...xs)-rx,rh=Math.max(...ys)-ry;prediction=`<rect class="v16Prediction" x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="4"/><text class="v16PredictionLabel" x="${rx+6}" y="${ry+14}">TARGET ZONE</text>`;}
    const event=drawing.eventLine?`${lineSvg(drawing.eventLine,'v16Event')}<text class="v16EventLabel" x="${x(drawing.eventLine.x1)+5}" y="${pad+13}">EVENT</text>`:'';
    const level=(value,label,cls)=>Number.isFinite(Number(value))?`<line class="evLevel ${cls}" x1="${x(drawing.eventLine?.x1||from)}" y1="${y(value)}" x2="${width-pad}" y2="${y(value)}"/><text class="evLabel ${cls}" x="${width-pad-4}" y="${y(value)-5}" text-anchor="end">${label} ${num(value)}</text>`:'';
    const last=candles.at(-1); const current=last?`<line class="v16Current" x1="${x(last.timestamp)}" y1="${y(last.close)}" x2="${width-pad}" y2="${y(last.close)}"/><text class="v16CurrentLabel" x="${width-pad-4}" y="${y(last.close)+13}" text-anchor="end">CURRENT ${num(last.close)}</text>`:'';
    return `<div class="emergingChart v16Chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Tradevice technical opportunity chart"><defs><marker id="arrow-${esc(watch.fingerprint||'pattern')}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" class="v16ArrowHead"/></marker></defs><rect class="evBg" x="0" y="0" width="${width}" height="${height}" rx="18"/>${prediction}${candleSvg}${structures}${event}${forecasts}${arrow}${current}${level(projection.entry,'ENTRY','entry')}${level(projection.target,'TARGET','target')}${level(projection.stop,'SL','stop')}</svg><div class="emergingChartFoot"><span>${esc(drawing.chartType)} · M${drawing.interval} · MT5</span><span>${candles.length} candles · forecast to ${dt(projection.expires_at)}</span></div></div>`;
  }

  function knowledgePanel(watch) {
    const k=watch?.knowledge||{}, q=k.quality||{}, p=k.pattern||{};
    const metric=(label,value)=>{if(value===null||value===undefined)return'';if(Number(value)<0)return`<div class="kMetric"><span>${label}</span><b>PENDING</b></div>`;const pctv=Math.round(Number(value)*100);return`<div class="kMetric"><span>${label}</span><div><i style="width:${Math.max(0,Math.min(100,pctv))}%"></i></div><b>${pctv}</b></div>`;};
    return `<div class="knowledgePanel"><div class="knowledgeTop"><span>${esc(k.family_label||'Pattern')}</span><strong>${esc(pretty(p.label||watch.type))}</strong><small>${esc(pretty(p.geometry||'structure'))} · ${esc(pretty(p.trend_change||'contextual'))}</small></div><div class="knowledgeMetrics">${metric('Quality',q.quality)}${metric('Clarity',q.clarity)}${metric('Initial trend',q.initial_trend)}${metric('Uniformity',q.uniformity)}${metric('Breakout',q.breakout)}${metric('Readiness',q.readiness)}</div></div>`;
  }

  function summaryCard(item, watchCount) {
    const reasons = item?.reason_codes || [];
    const bias = String(reasons.find(reason => String(reason).startsWith('BIAS_')) || 'BIAS_NEUTRAL').replace('BIAS_','').replaceAll('_',' ');
    const m5 = String(reasons.find(reason => String(reason).startsWith('M5_')) || 'M5_UNKNOWN').replace('M5_','');
    const m15 = String(reasons.find(reason => String(reason).startsWith('M15_')) || 'M15_UNKNOWN').replace('M15_','');
    return `<article class="strategySummaryCard"><div class="strategySummaryHead"><div><small>Current market read</small><h3>XAUUSD · ${esc(bias)}</h3></div><span class="strategyPulse">● ${watchCount ? 'MONITORING' : 'SCANNING'}</span></div><div class="strategySummaryGrid"><div><span>M5 trend</span><strong>${esc(m5)}</strong></div><div><span>M15 trend</span><strong>${esc(m15)}</strong></div><div><span>Structure watches</span><strong>${watchCount}</strong></div><div><span>Last scan</span><strong>${dt(item.market_timestamp || item.created_at)}</strong></div></div><p>${esc(item.thesis || 'Tradevice is scanning live market structure.')}</p><div class="strategyRule">Emerging analysis is informational. Approve becomes available only after a detector reaches CONFIRMED and risk validation passes.</div></article>`;
  }

  function metrics(projection) {
    if (!projection) return '<div class="emergingNoProjection">Projection is still being calculated.</div>';
    return `<div class="emergingMetrics"><div><span>Entry level</span><strong>${num(projection.entry)}</strong></div><div><span>Target level</span><strong class="green">${num(projection.target)}</strong></div><div><span>Stop / invalidation</span><strong class="red">${num(projection.stop)}</strong></div><div><span>Target period</span><strong>${esc(duration(projection.target_window))}</strong></div></div>`;
  }

  function analysisWatchCard(item) {
    const watch = item.watch || {};
    const state = String(watch.status || item.strategy_state || 'FORMING').toUpperCase();
    const projection = watch.projection || null;
    const label = projection?.label || pretty(watch.type || item.setup);
    const direction = projection?.side === 'BUY' ? '▲' : projection?.side === 'SELL' ? '▼' : '◆';
    return `<article class="emergingAnalysisCard ${stateClass(state)}"><div class="emergingHead"><div><span class="strategyState ${stateClass(state)}">${esc(state)}</span><strong>XAUUSD · ${esc(watch.timeframe || 'M15')}</strong><b class="emergingDirection ${projection?.side === 'BUY'?'buy':projection?.side === 'SELL'?'sell':''}">${direction}</b></div><div class="strategyQuality"><b>${pct(item.confidence)}</b><span>quality</span></div></div><h4>${esc(label)}</h4><div class="emergingAge">Detected ${dt(watch.detected_at || item.market_timestamp || item.created_at)}</div>${metrics(projection)}<div class="emergingStory">${esc(item.thesis || 'Structure is being monitored for confirmation.')}</div>${knowledgePanel(watch)}${drawingChart(watch)}<div class="nextTrigger"><small>What must happen next</small><strong>${esc(projection?.what_next || 'Wait for the detector confirmation rule.')}</strong></div><div class="emergingFoot"><span>Expires ${esc(dt(projection?.expires_at))}</span><span>No order yet · Approve locked</span></div></article>`;
  }

  function compactEmergingCard(item, rank) {
    const watch = item.watch || {}, projection = watch.projection || {};
    const state = String(watch.status || item.strategy_state || 'FORMING').toUpperCase();
    const label = projection.label || pretty(watch.type || item.setup);
    return `<article class="preOfferCard ${stateClass(state)}"><div class="preOfferTop"><div><span class="rankChip">${String(rank+1).padStart(2,'0')}</span><span class="strategyState ${stateClass(state)}">${esc(state)}</span></div><span class="preQuality">${pct(item.confidence)}</span></div><div class="preOfferTitle"><strong>${esc(label)}</strong><span>${esc(watch.timeframe || 'M15')} · ${dt(watch.detected_at || item.market_timestamp)}</span></div>${metrics(projection)}<p>${esc(item.thesis || '')}</p>${knowledgePanel(watch)}${drawingChart(watch)}<div class="nextTrigger compact"><small>Trigger required</small><strong>${esc(projection.what_next || 'Wait for confirmation.')}</strong></div><div class="preOfferBottom"><span>Expiry ${esc(dt(projection.expires_at))}</span><b>EMERGING · NOT ACTIONABLE</b></div></article>`;
  }

  function ensureEmergingHost() {
    const grid = document.getElementById('planGrid');
    if (!grid) return null;
    let host = document.getElementById('emergingOfferHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'emergingOfferHost';
      host.className = 'emergingOfferHost';
      grid.before(host);
    }
    return host;
  }

  function renderEmergingOffers(watches) {
    const host = ensureEmergingHost();
    if (!host) return;
    const signature = JSON.stringify(watches.map(item => [item.trade_id,item.market_timestamp,item.watch?.status,item.watch?.projection,item.watch?.drawing,item.watch?.knowledge]));
    if (signature === offerSignature) return;
    offerSignature = signature;
    if (!watches.length) { host.innerHTML = ''; return; }
    host.innerHTML = `<div class="emergingSectionHead"><div><strong>Emerging Analysis</strong><span>Pre-offering structures · approval remains locked</span></div><b>${watches.length}</b></div><div class="preOfferGrid">${watches.slice(0,5).map(compactEmergingCard).join('')}</div>`;
  }

  function currentAnalysisHost() {
    return document.getElementById('strategyAnalysisWrap') || document.getElementById('analysisWrap');
  }

  async function refresh() {
    try {
      const response = await fetch('/api/v1/analysis/live', { cache:'no-store' });
      if (!response.ok) return;
      const payload = await response.json();
      const analyses = payload.analyses || [];
      const summaries = analyses.filter(item => String(item.trade_id || '').startsWith('analysis-scan-'));
      const watchesAll = analyses.filter(item => String(item.trade_id || '').startsWith('analysis-watch-') && item.watch);
      const summary = summaries[0] || null;
      const summaryTime = summary ? new Date(summary.market_timestamp || summary.created_at || 0).getTime() : 0;
      const watches = watchesAll.filter(item => {
        const time = new Date(item.market_timestamp || item.created_at || 0).getTime();
        return !summaryTime || Math.abs(summaryTime - time) <= 10 * 60 * 1000;
      }).slice(0,5);

      renderEmergingOffers(watches);

      const host = currentAnalysisHost();
      if (!host) return;
      if (host.id === 'analysisWrap') {
        host.id = 'strategyAnalysisWrap';
        host.dataset.analysisOwner = 'v16';
      }
      const signature = JSON.stringify({summary:summary && [summary.trade_id,summary.market_timestamp,summary.thesis],watches:watches.map(item=>[item.trade_id,item.market_timestamp,item.confidence,item.watch])});
      if (signature !== lastSignature) {
        lastSignature = signature;
        host.innerHTML = `<div class="strategyAnalysisLive">${summary ? summaryCard(summary,watches.length) : '<article class="strategySummaryCard"><div class="strategySummaryHead"><div><small>Current market read</small><h3>Initializing scanner</h3></div><span class="strategyPulse">● WAITING</span></div></article>'}<div class="strategySubHead"><div><strong>Setup Watchlist</strong><span>Autochartist-style emerging pattern intelligence</span></div><b>${watches.length}</b></div>${watches.length ? `<div class="emergingAnalysisGrid">${watches.map(analysisWatchCard).join('')}</div>` : '<div class="strategyEmpty">No emerging structure is close enough right now. Scanner remains active.</div>'}</div>`;
      }
    } catch (error) {
      console.error('v16 analysis render failed', error);
    }
  }

  function boot() {
    const host = currentAnalysisHost();
    if (host && host.id === 'analysisWrap') {
      host.id = 'strategyAnalysisWrap';
      host.dataset.analysisOwner = 'v16';
    }
    refresh();
    setInterval(refresh, 5200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
