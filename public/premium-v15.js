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

  function watchChart(watch) {
    const visual = watch?.visual || {};
    const projection = watch?.projection || {};
    const candles = Array.isArray(visual.candles) ? visual.candles.filter(c => [c.open,c.high,c.low,c.close].every(x => Number.isFinite(Number(x)))) : [];
    if (candles.length < 4) return '<div class="emergingChartEmpty">Chart snapshot will appear after enough M15 candles are available.</div>';
    const extra = [projection.entry, projection.stop, projection.target]
      .concat((visual.horizontal || []).map(line => line.value))
      .filter(value => Number.isFinite(Number(value))).map(Number);
    const values = [...candles.flatMap(c => [Number(c.high), Number(c.low)]), ...extra];
    let min = Math.min(...values), max = Math.max(...values);
    const span = Math.max(max - min, 0.001); min -= span * 0.08; max += span * 0.08;
    const width = 680, height = 285, pad = 20;
    const step = (width - pad * 2) / candles.length;
    const bodyWidth = Math.max(3, step * 0.48);
    const candleSvg = candles.map((c, index) => {
      const x = pad + step * index + step / 2;
      const yo = lineY(c.open,min,max,height,pad), yc = lineY(c.close,min,max,height,pad), yh = lineY(c.high,min,max,height,pad), yl = lineY(c.low,min,max,height,pad);
      const up = Number(c.close) >= Number(c.open);
      return `<line class="evWick ${up?'up':'down'}" x1="${x}" y1="${yh}" x2="${x}" y2="${yl}"/><rect class="evBody ${up?'up':'down'}" x="${x-bodyWidth/2}" y="${Math.min(yo,yc)}" width="${bodyWidth}" height="${Math.max(2,Math.abs(yc-yo))}" rx="1"/>`;
    }).join('');
    const x1 = pad + step / 2, x2 = width - pad - step / 2;
    const structure = [];
    if (visual.upper) structure.push(`<line class="evStructure" x1="${x1}" y1="${lineY(visual.upper.start,min,max,height,pad)}" x2="${x2}" y2="${lineY(visual.upper.end,min,max,height,pad)}"/>`);
    if (visual.lower) structure.push(`<line class="evStructure secondary" x1="${x1}" y1="${lineY(visual.lower.start,min,max,height,pad)}" x2="${x2}" y2="${lineY(visual.lower.end,min,max,height,pad)}"/>`);
    if (visual.trendline) structure.push(`<line class="evStructure" x1="${x1}" y1="${lineY(visual.trendline.start,min,max,height,pad)}" x2="${x2}" y2="${lineY(visual.trendline.end,min,max,height,pad)}"/>`);
    for (const line of visual.horizontal || []) {
      const y = lineY(line.value,min,max,height,pad);
      structure.push(`<line class="evHorizontal" x1="${pad}" y1="${y}" x2="${width-pad}" y2="${y}"/><text class="evHorizontalLabel" x="${width-pad-3}" y="${y-5}" text-anchor="end">${esc(line.label)} ${num(line.value)}</text>`);
    }
    const level = (value,label,cls) => Number.isFinite(Number(value)) ? `<line class="evLevel ${cls}" x1="${pad}" y1="${lineY(value,min,max,height,pad)}" x2="${width-pad}" y2="${lineY(value,min,max,height,pad)}"/><text class="evLabel ${cls}" x="${pad+4}" y="${lineY(value,min,max,height,pad)-5}">${label} ${num(value)}</text>` : '';
    return `<div class="emergingChart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Emerging ${esc(watch.type)} chart"><rect class="evBg" x="0" y="0" width="${width}" height="${height}" rx="18"/>${candleSvg}${structure.join('')}${level(projection.entry,'ENTRY','entry')}${level(projection.target,'TARGET','target')}${level(projection.stop,'SL','stop')}</svg><div class="emergingChartFoot"><span>M15 · MT5 data</span><span>${candles.length} closed candles</span></div></div>`;
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
    return `<article class="emergingAnalysisCard ${stateClass(state)}"><div class="emergingHead"><div><span class="strategyState ${stateClass(state)}">${esc(state)}</span><strong>XAUUSD · ${esc(watch.timeframe || 'M15')}</strong><b class="emergingDirection ${projection?.side === 'BUY'?'buy':projection?.side === 'SELL'?'sell':''}">${direction}</b></div><div class="strategyQuality"><b>${pct(item.confidence)}</b><span>quality</span></div></div><h4>${esc(label)}</h4><div class="emergingAge">Detected ${dt(watch.detected_at || item.market_timestamp || item.created_at)}</div>${metrics(projection)}<div class="emergingStory">${esc(item.thesis || 'Structure is being monitored for confirmation.')}</div>${watchChart(watch)}<div class="nextTrigger"><small>What must happen next</small><strong>${esc(projection?.what_next || 'Wait for the detector confirmation rule.')}</strong></div><div class="emergingFoot"><span>Expires ${esc(dt(projection?.expires_at))}</span><span>No order yet · Approve locked</span></div></article>`;
  }

  function compactEmergingCard(item, rank) {
    const watch = item.watch || {}, projection = watch.projection || {};
    const state = String(watch.status || item.strategy_state || 'FORMING').toUpperCase();
    const label = projection.label || pretty(watch.type || item.setup);
    return `<article class="preOfferCard ${stateClass(state)}"><div class="preOfferTop"><div><span class="rankChip">${String(rank+1).padStart(2,'0')}</span><span class="strategyState ${stateClass(state)}">${esc(state)}</span></div><span class="preQuality">${pct(item.confidence)}</span></div><div class="preOfferTitle"><strong>${esc(label)}</strong><span>${esc(watch.timeframe || 'M15')} · ${dt(watch.detected_at || item.market_timestamp)}</span></div>${metrics(projection)}<p>${esc(item.thesis || '')}</p>${watchChart(watch)}<div class="nextTrigger compact"><small>Trigger required</small><strong>${esc(projection.what_next || 'Wait for confirmation.')}</strong></div><div class="preOfferBottom"><span>Expiry ${esc(dt(projection.expires_at))}</span><b>EMERGING · NOT ACTIONABLE</b></div></article>`;
  }

  function ensureEmergingHost() {
    const offers = document.getElementById('offers');
    const grid = document.getElementById('planGrid');
    if (!offers || !grid) return null;
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
    const signature = JSON.stringify(watches.map(item => [item.trade_id,item.market_timestamp,item.watch?.status,item.watch?.projection]));
    if (signature === offerSignature) return;
    offerSignature = signature;
    if (!watches.length) { host.innerHTML = ''; return; }
    host.innerHTML = `<div class="emergingSectionHead"><div><strong>Emerging Analysis</strong><span>Pre-offering structures · approval remains locked</span></div><b>${watches.length}</b></div><div class="preOfferGrid">${watches.slice(0,5).map(compactEmergingCard).join('')}</div>`;
  }

  async function refresh() {
    const host = document.getElementById('strategyAnalysisWrap');
    if (!host) return;
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
      const signature = JSON.stringify({summary:summary && [summary.trade_id,summary.market_timestamp,summary.thesis],watches:watches.map(item=>[item.trade_id,item.market_timestamp,item.confidence,item.watch])});
      if (signature !== lastSignature) {
        lastSignature = signature;
        host.innerHTML = `<div class="strategyAnalysisLive">${summary ? summaryCard(summary,watches.length) : '<article class="strategySummaryCard"><div class="strategySummaryHead"><div><small>Current market read</small><h3>Initializing scanner</h3></div><span class="strategyPulse">● WAITING</span></div></article>'}<div class="strategySubHead"><div><strong>Setup Watchlist</strong><span>Autochartist-style emerging pattern intelligence</span></div><b>${watches.length}</b></div>${watches.length ? `<div class="emergingAnalysisGrid">${watches.map(analysisWatchCard).join('')}</div>` : '<div class="strategyEmpty">No emerging structure is close enough right now. Scanner remains active.</div>'}</div>`;
      }
      renderEmergingOffers(watches);
    } catch (error) {
      console.error('v15 analysis render failed', error);
    }
  }

  function boot() {
    const legacy = document.getElementById('analysisWrap');
    if (!legacy) return;
    legacy.id = 'strategyAnalysisWrap';
    legacy.dataset.analysisOwner = 'v15';
    refresh();
    setInterval(refresh, 5200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
