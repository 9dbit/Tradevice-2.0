import crypto from 'crypto';

const finite = v => Number.isFinite(Number(v)) ? Number(v) : null;
const clamp = (v,min,max) => Math.max(min, Math.min(max,v));
const round = (v,d=3) => Number(Number(v).toFixed(d));

function atr(bars, period=14){
  if(!Array.isArray(bars)||bars.length<2) return null;
  const out=[]; const start=Math.max(1,bars.length-period);
  for(let i=start;i<bars.length;i++){
    const h=finite(bars[i]?.high), l=finite(bars[i]?.low), pc=finite(bars[i-1]?.close);
    if(h===null||l===null||pc===null) continue;
    out.push(Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc)));
  }
  return out.length?out.reduce((a,b)=>a+b,0)/out.length:null;
}

function regression(values){
  const pts=values.map((y,x)=>({x,y:finite(y)})).filter(p=>p.y!==null);
  if(pts.length<3) return null;
  const n=pts.length, sx=pts.reduce((s,p)=>s+p.x,0), sy=pts.reduce((s,p)=>s+p.y,0);
  const sxx=pts.reduce((s,p)=>s+p.x*p.x,0), sxy=pts.reduce((s,p)=>s+p.x*p.y,0);
  const den=n*sxx-sx*sx; if(Math.abs(den)<1e-9) return null;
  const slope=(n*sxy-sx*sy)/den, intercept=(sy-slope*sx)/n;
  const rmse=Math.sqrt(pts.reduce((s,p)=>s+(p.y-(intercept+slope*p.x))**2,0)/n);
  return {slope,intercept,rmse,at:x=>intercept+slope*x};
}

function bodyStats(c){
  const h=finite(c?.high),l=finite(c?.low),o=finite(c?.open),cl=finite(c?.close);
  if([h,l,o,cl].some(v=>v===null)) return null;
  const range=Math.max(1e-9,h-l);
  return {high:h,low:l,open:o,close:cl,range,body:Math.abs(cl-o),bodyRatio:Math.abs(cl-o)/range};
}

function fingerprint(type,timeframe,candle,entry,digits){
  const raw=JSON.stringify({type,timeframe,timestamp:candle?.timestamp||null,entry:round(entry,digits)});
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0,18);
}

function targetWindow(reward, bars, timeframeMinutes){
  const ranges=(bars||[]).slice(-12).map(b=>finite(b?.high)-finite(b?.low)).filter(v=>Number.isFinite(v)&&v>0);
  const avg=ranges.length?ranges.reduce((a,b)=>a+b,0)/ranges.length:null;
  if(!avg) return null;
  const candles=clamp(reward/Math.max(avg*0.65,1e-9),1,32);
  return {min_minutes:Math.max(timeframeMinutes,Math.round(candles*0.7*timeframeMinutes)),max_minutes:Math.round(candles*1.6*timeframeMinutes)};
}

function expiresAt(timestamp,candles,timeframeMinutes){
  const ms=Date.parse(timestamp||'');
  return Number.isFinite(ms)?new Date(ms+candles*timeframeMinutes*60_000).toISOString():null;
}

function compactBars(bars){
  return (bars||[]).slice(-18).map(b=>({timestamp:b.timestamp,open:finite(b.open),high:finite(b.high),low:finite(b.low),close:finite(b.close)}));
}

function channelFit(prior, atrValue){
  const bars=prior.slice(-14); if(bars.length<10) return null;
  const hi=regression(bars.map(b=>b.high)), lo=regression(bars.map(b=>b.low));
  if(!hi||!lo) return null;
  const x=bars.length-1, upper=hi.at(x), lower=lo.at(x), width=upper-lower;
  if(!(width>atrValue*0.55&&width<atrValue*5.5)) return null;
  const parallelGap=Math.abs(hi.slope-lo.slope);
  if(parallelGap>atrValue*0.12) return null;
  const tolerance=atrValue*0.28;
  const upperTouches=bars.filter((b,i)=>Math.abs(finite(b.high)-hi.at(i))<=tolerance).length;
  const lowerTouches=bars.filter((b,i)=>Math.abs(finite(b.low)-lo.at(i))<=tolerance).length;
  if(upperTouches<2||lowerTouches<2) return null;
  const slope=(hi.slope+lo.slope)/2;
  const direction=slope>atrValue*0.018?'UP':slope<-atrValue*0.018?'DOWN':'FLAT';
  const rmse=(hi.rmse+lo.rmse)/2;
  const quality=clamp(100-(parallelGap/atrValue)*180-(rmse/atrValue)*22+(upperTouches+lowerTouches)*3,0,100);
  return {bars,hi,lo,width,slope,direction,upperTouches,lowerTouches,quality};
}

function channelCandidate(snapshot,m15,atrValue,digits){
  const last=bodyStats(m15.at(-1)), prev=bodyStats(m15.at(-2));
  const fit=channelFit(m15.slice(0,-1),atrValue);
  if(!last||!prev||!fit) return {watch:fit?{type:`CHANNEL_${fit.direction}`,status:'FORMING',timeframe:'M15',quality:Math.round(fit.quality)}:null,candidate:null};
  const xNow=fit.bars.length, xPrev=xNow-1;
  const upperNow=fit.hi.at(xNow), lowerNow=fit.lo.at(xNow), upperPrev=fit.hi.at(xPrev), lowerPrev=fit.lo.at(xPrev);
  const upBreak=last.close>upperNow+atrValue*0.10 && prev.close<=upperPrev+atrValue*0.08;
  const downBreak=last.close<lowerNow-atrValue*0.10 && prev.close>=lowerPrev-atrValue*0.08;
  if((!upBreak&&!downBreak)||last.bodyRatio<0.48) return {watch:{type:`CHANNEL_${fit.direction}`,status:'ARMED',timeframe:'M15',quality:Math.round(fit.quality)},candidate:null};
  const side=upBreak?'BUY':'SELL', entry=upBreak?upperNow:lowerNow;
  const ask=finite(snapshot?.ask), bid=finite(snapshot?.bid);
  if(side==='BUY'&&ask!==null&&entry>=ask) return {watch:null,candidate:null};
  if(side==='SELL'&&bid!==null&&entry<=bid) return {watch:null,candidate:null};
  const point=finite(snapshot?.features?.point_size)||0.001, spread=(finite(snapshot?.spread_points)||0)*point;
  const risk=Math.max(atrValue*0.55,fit.width*0.25)+spread;
  const sl=side==='BUY'?entry-risk:entry+risk;
  const reward=Math.max(fit.width*0.95,risk*1.75);
  const tp=side==='BUY'?entry+reward:entry-reward;
  const rr=reward/risk;
  const geometryScore=clamp(10+fit.quality*0.18,0,25);
  const breakoutScore=clamp(8+last.bodyRatio*18+Math.abs(last.close-entry)/atrValue*7,0,25);
  const touchScore=clamp((fit.upperTouches+fit.lowerTouches)*3,0,20);
  const trendScore=(fit.direction==='UP'&&side==='BUY')||(fit.direction==='DOWN'&&side==='SELL')?15:10;
  const rrScore=rr>=2.5?15:rr>=2?13:10;
  const score=Math.round(clamp(geometryScore+breakoutScore+touchScore+trendScore+rrScore,0,100));
  if(score<Number(process.env.PATTERN_MIN_SCORE||70)) return {watch:null,candidate:null};
  const expirationCandles=8, tw=targetWindow(reward,m15,15), exp=expiresAt(m15.at(-1)?.timestamp,expirationCandles,15);
  const channelName=`CHANNEL_${fit.direction}`;
  const directionWord=side==='BUY'?'above the upper channel line':'below the lower channel line';
  const invalidLevel=side==='BUY'?entry-atrValue*0.35:entry+atrValue*0.35;
  const candidate={
    engine_version:'deterministic-channel-trendline-v1', fingerprint:fingerprint(`${channelName}_${side}`,'M15',m15.at(-1),entry,digits),
    state:'CHANNEL_BREAKOUT_CONFIRMED', pattern_status:'CONFIRMED', pattern_name:`${channelName}_BREAKOUT`, timeframe:'M15',
    setup:'CHANNEL_BREAKOUT_RETEST', side, order_type:side==='BUY'?'BUY_LIMIT':'SELL_LIMIT', regime:side==='BUY'?'BREAKOUT':'BREAKOUT',
    entry:round(entry,digits), stop_loss:round(sl,digits), take_profit:round(tp,digits), expiration_candles:expirationCandles,
    expiration_timeframe:'M15', expires_at:exp, estimated_target_window:tw,
    decision_confidence:score/100, entry_confidence:score/100, setup_score:score, rr,
    score_components:{channel_geometry:Math.round(geometryScore),breakout_quality:Math.round(breakoutScore),touch_quality:Math.round(touchScore),trend_context:trendScore,risk_target_room:rrScore},
    reason_codes:[channelName,'CHANNEL_BREAKOUT_CONFIRMED',`BODY_RATIO_${Math.round(last.bodyRatio*100)}`,`TOUCHES_${fit.upperTouches+fit.lowerTouches}`,`RR_${rr.toFixed(2)}`],
    thesis:`${channelName.replaceAll('_',' ')} on M15 broke ${directionWord}. The channel has ${fit.upperTouches} upper-line and ${fit.lowerTouches} lower-line touches. The breakout candle body is ${Math.round(last.bodyRatio*100)}% of its range. Pending ${side}_LIMIT waits for a retest of the broken channel boundary.`,
    invalidation:`Cancel before fill if M15 closes ${side==='BUY'?'below':'above'} ${round(invalidLevel,digits)}, if target is reached first, or at ${exp||'time expiry'}.`,
    pre_fill_invalidation:{timeframe:'M15',operator:side==='BUY'?'BELOW':'ABOVE',level:round(invalidLevel,digits)},
    atr_reference:atrValue,
    pattern:{name:channelName,status:'CONFIRMED',timeframe:'M15',detected_at:m15.at(-1)?.timestamp||snapshot.timestamp,target_window:tw,expires_at:exp},
    visual:{timeframe:'M15',candles:compactBars(m15),upper:{start:round(fit.hi.at(0),digits),end:round(upperNow,digits)},lower:{start:round(fit.lo.at(0),digits),end:round(lowerNow,digits)},entry:round(entry,digits),stop_loss:round(sl,digits),take_profit:round(tp,digits),break_timestamp:m15.at(-1)?.timestamp||null}
  };
  return {watch:null,candidate};
}

function trendlineCandidate(snapshot,m15,atrValue,digits){
  const prior=m15.slice(-14,-1), last=bodyStats(m15.at(-1)), prev=bodyStats(m15.at(-2));
  if(prior.length<10||!last||!prev) return null;
  const highs=regression(prior.map(b=>b.high)), lows=regression(prior.map(b=>b.low)); if(!highs||!lows) return null;
  const x=prior.length, xp=x-1, tol=atrValue*0.26;
  const highTouches=prior.filter((b,i)=>Math.abs(finite(b.high)-highs.at(i))<=tol).length;
  const lowTouches=prior.filter((b,i)=>Math.abs(finite(b.low)-lows.at(i))<=tol).length;
  let side=null,line=null,touches=0,type=null;
  if(highs.slope<-atrValue*0.018 && highTouches>=3 && last.close>highs.at(x)+atrValue*0.10 && prev.close<=highs.at(xp)+atrValue*0.06){side='BUY';line=highs;touches=highTouches;type='DESCENDING_RESISTANCE_BREAK';}
  if(lows.slope>atrValue*0.018 && lowTouches>=3 && last.close<lows.at(x)-atrValue*0.10 && prev.close>=lows.at(xp)-atrValue*0.06){side='SELL';line=lows;touches=lowTouches;type='ASCENDING_SUPPORT_BREAK';}
  if(!side||last.bodyRatio<0.45) return null;
  const entry=line.at(x), ask=finite(snapshot?.ask), bid=finite(snapshot?.bid);
  if(side==='BUY'&&ask!==null&&entry>=ask) return null;
  if(side==='SELL'&&bid!==null&&entry<=bid) return null;
  const point=finite(snapshot?.features?.point_size)||0.001, spread=(finite(snapshot?.spread_points)||0)*point;
  const risk=atrValue*0.62+spread, reward=Math.max(risk*1.8,atrValue*1.35), rr=reward/risk;
  const sl=side==='BUY'?entry-risk:entry+risk, tp=side==='BUY'?entry+reward:entry-reward;
  const lineQuality=clamp(10+touches*4-(line.rmse/atrValue)*12,0,30), breakoutQuality=clamp(10+last.bodyRatio*20,0,25), rrScore=rr>=2?15:12;
  const score=Math.round(clamp(lineQuality+breakoutQuality+20+15+rrScore,0,100)); if(score<Number(process.env.PATTERN_MIN_SCORE||70)) return null;
  const expirationCandles=8, tw=targetWindow(reward,m15,15), exp=expiresAt(m15.at(-1)?.timestamp,expirationCandles,15), invalid=side==='BUY'?entry-atrValue*0.35:entry+atrValue*0.35;
  return {
    engine_version:'deterministic-channel-trendline-v1', fingerprint:fingerprint(type,'M15',m15.at(-1),entry,digits), state:'TRENDLINE_BREAKOUT_CONFIRMED', pattern_status:'CONFIRMED', pattern_name:type, timeframe:'M15',
    setup:'TRENDLINE_BREAKOUT_RETEST', side, order_type:side==='BUY'?'BUY_LIMIT':'SELL_LIMIT', regime:'BREAKOUT', entry:round(entry,digits), stop_loss:round(sl,digits), take_profit:round(tp,digits), expiration_candles:expirationCandles, expiration_timeframe:'M15', expires_at:exp, estimated_target_window:tw,
    decision_confidence:score/100, entry_confidence:score/100, setup_score:score, rr, atr_reference:atrValue,
    score_components:{trendline_quality:Math.round(lineQuality),breakout_quality:Math.round(breakoutQuality),touch_quality:20,trend_context:15,risk_target_room:rrScore},
    reason_codes:[type,'TRENDLINE_BREAKOUT_CONFIRMED',`LINE_TOUCHES_${touches}`,`BODY_RATIO_${Math.round(last.bodyRatio*100)}`,`RR_${rr.toFixed(2)}`],
    thesis:`${type.replaceAll('_',' ')} on M15 with ${touches} validated touches. Breakout candle body is ${Math.round(last.bodyRatio*100)}% of range. Pending ${side}_LIMIT waits for a retest of the broken trendline rather than chasing the breakout.`,
    invalidation:`Cancel before fill if M15 closes ${side==='BUY'?'below':'above'} ${round(invalid,digits)}, if target is reached first, or at ${exp||'time expiry'}.`,
    pre_fill_invalidation:{timeframe:'M15',operator:side==='BUY'?'BELOW':'ABOVE',level:round(invalid,digits)},
    pattern:{name:type,status:'CONFIRMED',timeframe:'M15',detected_at:m15.at(-1)?.timestamp||snapshot.timestamp,target_window:tw,expires_at:exp},
    visual:{timeframe:'M15',candles:compactBars(m15),trendline:{start:round(line.at(0),digits),end:round(line.at(x),digits)},entry:round(entry,digits),stop_loss:round(sl,digits),take_profit:round(tp,digits),break_timestamp:m15.at(-1)?.timestamp||null}
  };
}

export function detectChannelTrendlinePatterns(snapshot){
  const m15=Array.isArray(snapshot?.features?.m15_candles)?snapshot.features.m15_candles:[];
  if(m15.length<12) return {state:'INSUFFICIENT_M15',candidates:[],watches:[]};
  const atrValue=atr(m15,14); if(!atrValue) return {state:'ATR_UNAVAILABLE',candidates:[],watches:[]};
  const digits=Number(snapshot?.features?.digits??3), candidates=[], watches=[];
  const channel=channelCandidate(snapshot,m15,atrValue,digits); if(channel.watch) watches.push(channel.watch); if(channel.candidate) candidates.push(channel.candidate);
  const trend=trendlineCandidate(snapshot,m15,atrValue,digits); if(trend) candidates.push(trend);
  candidates.sort((a,b)=>b.setup_score-a.setup_score||b.rr-a.rr);
  return {state:candidates.length?'CONFIRMED':watches.length?'FORMING':'NO_EVENT',candidates,watches,atr_m15:atrValue,scanned_at:snapshot?.timestamp||new Date().toISOString()};
}
