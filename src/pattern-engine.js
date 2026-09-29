import crypto from 'crypto';
const finite = v => Number.isFinite(Number(v)) ? Number(v) : null;
const clamp = (v,min,max) => Math.max(min, Math.min(max,v));
const round = (v,d=3) => Number(Number(v).toFixed(d));
const ENGINE_VERSION = 'deterministic-pattern-accuracy-v17';

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

function bodyStats(c){
  const h=finite(c?.high),l=finite(c?.low),o=finite(c?.open),cl=finite(c?.close);
  if([h,l,o,cl].some(v=>v===null)) return null;
  const range=Math.max(1e-9,h-l), body=Math.abs(cl-o);
  return {high:h,low:l,open:o,close:cl,range,body,bodyRatio:body/range,closeLocation:(cl-l)/range};
}

function fingerprint(type,timeframe,candle,entry,digits){
  const raw=JSON.stringify({type,timeframe,timestamp:candle?.timestamp||null,entry:round(entry,digits)});
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0,18);
}

function watchFingerprint(type, geometry={}){
  return crypto.createHash('sha256').update(JSON.stringify({type,geometry})).digest('hex').slice(0,12);
}

function targetWindow(reward,bars,timeframeMinutes){
  const ranges=(bars||[]).slice(-16).map(b=>finite(b?.high)-finite(b?.low)).filter(v=>Number.isFinite(v)&&v>0);
  const avg=ranges.length?ranges.reduce((a,b)=>a+b,0)/ranges.length:null;
  if(!avg||!(reward>0)) return null;
  const candles=clamp(reward/Math.max(avg*.68,1e-9),1,32);
  return {min_minutes:Math.max(timeframeMinutes,Math.round(candles*.7*timeframeMinutes)),max_minutes:Math.round(candles*1.7*timeframeMinutes)};
}

function expiresAt(timestamp,candles,timeframeMinutes){
  const ms=Date.parse(timestamp||'');
  return Number.isFinite(ms)?new Date(ms+candles*timeframeMinutes*60_000).toISOString():null;
}

function compactBars(bars){
  return (bars||[]).slice(-24).map(b=>({timestamp:b.timestamp,open:finite(b.open),high:finite(b.high),low:finite(b.low),close:finite(b.close),tick_volume:finite(b.tick_volume)}));
}

function pivots(bars,field,kind,left=1,right=1){
  const out=[];
  for(let i=left;i<bars.length-right;i++){
    const value=finite(bars[i]?.[field]); if(value===null) continue;
    let ok=true,strict=false;
    for(let j=i-left;j<=i+right;j++){
      if(j===i) continue;
      const other=finite(bars[j]?.[field]); if(other===null){ok=false;break;}
      if(kind==='HIGH' && value<other) ok=false;
      if(kind==='LOW' && value>other) ok=false;
      if(kind==='HIGH' && value>other) strict=true;
      if(kind==='LOW' && value<other) strict=true;
      if(!ok) break;
    }
    if(ok&&strict) out.push({x:i,y:value,timestamp:bars[i]?.timestamp});
  }
  return out;
}

function lineFit(points){
  if(!Array.isArray(points)||points.length<2) return null;
  const n=points.length, sx=points.reduce((s,p)=>s+p.x,0), sy=points.reduce((s,p)=>s+p.y,0);
  const sxx=points.reduce((s,p)=>s+p.x*p.x,0), sxy=points.reduce((s,p)=>s+p.x*p.y,0);
  const den=n*sxx-sx*sx; if(Math.abs(den)<1e-9) return null;
  const slope=(n*sxy-sx*sy)/den, intercept=(sy-slope*sx)/n;
  const errors=points.map(p=>p.y-(intercept+slope*p.x));
  const rmse=Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/n);
  return {slope,intercept,rmse,at:x=>intercept+slope*x};
}

function separatedTouches(points,line,tolerance,minGap=2){
  const matches=points.filter(p=>Math.abs(p.y-line.at(p.x))<=tolerance).sort((a,b)=>a.x-b.x);
  const selected=[];
  for(const p of matches){ if(!selected.length||p.x-selected.at(-1).x>=minGap) selected.push(p); }
  return selected;
}

function volumeFactor(lastBar,prior){
  const current=finite(lastBar?.tick_volume);
  const values=(prior||[]).slice(-12).map(b=>finite(b?.tick_volume)).filter(v=>v&&v>0);
  if(!current||values.length<4) return null;
  const avg=values.reduce((a,b)=>a+b,0)/values.length;
  return avg>0?current/avg:null;
}

function channelFit(prior,atrValue){
  const bars=prior.slice(-24); if(bars.length<12) return null;
  const highs=pivots(bars,'high','HIGH'), lows=pivots(bars,'low','LOW');
  if(highs.length<2||lows.length<2) return null;
  const hi=lineFit(highs.slice(-6)), lo=lineFit(lows.slice(-6)); if(!hi||!lo) return null;
  const n=bars.length, widthStart=hi.at(0)-lo.at(0), widthEnd=hi.at(n-1)-lo.at(n-1), avgWidth=(widthStart+widthEnd)/2;
  if(!(widthStart>atrValue*.55&&widthEnd>atrValue*.55&&avgWidth<atrValue*6)) return null;
  const parallelNorm=Math.abs(hi.slope-lo.slope)/atrValue;
  const widthDrift=Math.abs(widthEnd-widthStart)/Math.max(avgWidth,1e-9);
  if(parallelNorm>.10||widthDrift>.42) return null;
  const tolerance=atrValue*.24;
  const upperTouchPts=separatedTouches(highs,hi,tolerance,2), lowerTouchPts=separatedTouches(lows,lo,tolerance,2);
  if(upperTouchPts.length<2||lowerTouchPts.length<2) return null;
  const containment=bars.filter((b,i)=>{
    const c=finite(b.close); return c!==null&&c<=hi.at(i)+atrValue*.20&&c>=lo.at(i)-atrValue*.20;
  }).length/bars.length;
  if(containment<.67) return null;
  const clarity=clamp(1-((hi.rmse+lo.rmse)/2)/(atrValue*.38),0,1);
  const parallel=clamp(1-parallelNorm/.10,0,1);
  const widthConsistency=clamp(1-widthDrift/.42,0,1);
  const uniformity=parallel*.58+widthConsistency*.42;
  const touchQuality=clamp((upperTouchPts.length+lowerTouchPts.length-3)/5,0,1);
  const slope=(hi.slope+lo.slope)/2;
  const trendStrength=clamp(Math.abs(slope)/(atrValue*.12),0,1);
  const direction=slope>atrValue*.015?'UP':slope<-atrValue*.015?'DOWN':'FLAT';
  const quality=100*(clarity*.28+uniformity*.25+touchQuality*.20+containment*.17+trendStrength*.10);
  return {bars,hi,lo,width:avgWidth,slope,direction,upperTouches:upperTouchPts.length,lowerTouches:lowerTouchPts.length,quality,components:{clarity,uniformity,touch_quality:touchQuality,containment,initial_trend:trendStrength},pivots:{highs:upperTouchPts,lows:lowerTouchPts}};
}

function makeChannelWatch(fit,m15,atrValue,digits,statusOverride=null,extra={}){
  const x=fit.bars.length, upper=fit.hi.at(x), lower=fit.lo.at(x), current=finite(m15.at(-1)?.close);
  const distance=current===null?null:Math.min(Math.abs(current-upper),Math.abs(current-lower))/atrValue;
  const status=statusOverride||((distance!==null&&distance<=.45)?'ARMED':'FORMING');
  const geometry={upper:{start:round(fit.hi.at(0),digits),end:round(upper,digits)},lower:{start:round(fit.lo.at(0),digits),end:round(lower,digits)}};
  return {type:`CHANNEL_${fit.direction}`,status,timeframe:'M15',quality:Math.round(fit.quality),distance_atr:distance===null?null:round(distance,2),touches:fit.upperTouches+fit.lowerTouches,quality_components:fit.components,geometry,visual:{timeframe:'M15',candles:compactBars(m15),...geometry},fingerprint:watchFingerprint(`CHANNEL_${fit.direction}`,geometry),...extra};
}

function breakoutStats(last,boundary,side,atrValue){
  const displacement=(side==='BUY'?last.close-boundary:boundary-last.close)/atrValue;
  const closeExtreme=side==='BUY'?last.closeLocation:1-last.closeLocation;
  return {displacement,closeExtreme,valid:displacement>=.12&&displacement<=1.05&&last.bodyRatio>=.55&&closeExtreme>=.70};
}

function channelCandidate(snapshot,m15,atrValue,digits){
  const last=bodyStats(m15.at(-1)), prev=bodyStats(m15.at(-2));
  const fit=channelFit(m15.slice(0,-1),atrValue);
  if(!last||!prev||!fit) return {watch:fit?makeChannelWatch(fit,m15,atrValue,digits):null,candidate:null};
  const xNow=fit.bars.length, xPrev=xNow-1;
  const upperNow=fit.hi.at(xNow), lowerNow=fit.lo.at(xNow), upperPrev=fit.hi.at(xPrev), lowerPrev=fit.lo.at(xPrev);
  const upBreak=last.close>upperNow+atrValue*.12&&prev.close<=upperPrev+atrValue*.08;
  const downBreak=last.close<lowerNow-atrValue*.12&&prev.close>=lowerPrev-atrValue*.08;
  if(!upBreak&&!downBreak) return {watch:makeChannelWatch(fit,m15,atrValue,digits),candidate:null};
  const side=upBreak?'BUY':'SELL', entry=upBreak?upperNow:lowerNow, breakout=breakoutStats(last,entry,side,atrValue);
  if(!breakout.valid) return {watch:makeChannelWatch(fit,m15,atrValue,digits,'ARMED',{trigger_failed:'BREAKOUT_QUALITY',breakout_metrics:breakout}),candidate:null};
  const ask=finite(snapshot?.ask),bid=finite(snapshot?.bid);
  if(side==='BUY'&&ask!==null&&entry>=ask) return {watch:makeChannelWatch(fit,m15,atrValue,digits,'CONFIRMED',{trigger_failed:'ENTRY_ALREADY_CROSSED'}),candidate:null};
  if(side==='SELL'&&bid!==null&&entry<=bid) return {watch:makeChannelWatch(fit,m15,atrValue,digits,'CONFIRMED',{trigger_failed:'ENTRY_ALREADY_CROSSED'}),candidate:null};
  const point=finite(snapshot?.features?.point_size)||.001,spread=(finite(snapshot?.spread_points)||0)*point;
  const stopBuffer=Math.max(atrValue*.34,fit.width*.12)+spread;
  const sl=side==='BUY'?entry-stopBuffer:entry+stopBuffer;
  const measuredMove=fit.width*.90, reward=measuredMove, tp=side==='BUY'?entry+reward:entry-reward, rr=reward/stopBuffer;
  const vol=volumeFactor(m15.at(-1),m15.slice(0,-1));
  const breakoutQuality=clamp(breakout.displacement/.55*.35+last.bodyRatio*.35+breakout.closeExtreme*.30,0,1);
  const volumeQuality=vol===null?.5:clamp((vol-.8)/.8,0,1);
  const targetRoom=clamp((rr-1.2)/1.8,0,1);
  const structure=clamp(fit.quality/100,0,1);
  const score=Math.round(100*(structure*.28+fit.components.clarity*.14+fit.components.uniformity*.14+breakoutQuality*.22+fit.components.initial_trend*.07+volumeQuality*.05+targetRoom*.10));
  if(rr<1.5||score<Number(process.env.PATTERN_MIN_SCORE||72)){
    return {watch:makeChannelWatch(fit,m15,atrValue,digits,'CONFIRMED',{trigger_failed:rr<1.5?'INSUFFICIENT_TARGET_ROOM':'SCORE_BELOW_THRESHOLD',breakout_metrics:breakout,rr:round(rr,2)}),candidate:null};
  }
  const expirationCandles=8,tw=targetWindow(reward,m15,15),exp=expiresAt(m15.at(-1)?.timestamp,expirationCandles,15);
  const channelName=`CHANNEL_${fit.direction}`,invalid=side==='BUY'?entry-atrValue*.32:entry+atrValue*.32;
  return {watch:null,candidate:{
    engine_version:ENGINE_VERSION,fingerprint:fingerprint(`${channelName}_${side}`,'M15',m15.at(-1),entry,digits),state:'CHANNEL_BREAKOUT_CONFIRMED',pattern_status:'CONFIRMED',pattern_name:`${channelName}_BREAKOUT`,timeframe:'M15',
    setup:'CHANNEL_BREAKOUT_RETEST',side,order_type:side==='BUY'?'BUY_LIMIT':'SELL_LIMIT',regime:'BREAKOUT',entry:round(entry,digits),stop_loss:round(sl,digits),take_profit:round(tp,digits),expiration_candles:expirationCandles,expiration_timeframe:'M15',expires_at:exp,estimated_target_window:tw,
    decision_confidence:score/100,entry_confidence:score/100,setup_score:score,rr,atr_reference:atrValue,
    score_components:{structure_quality:Math.round(structure*20),clarity:Math.round(fit.components.clarity*15),uniformity:Math.round(fit.components.uniformity*15),breakout_quality:Math.round(breakoutQuality*20),trend_context:Math.round(fit.components.initial_trend*10),volume_context:Math.round(volumeQuality*5),risk_target_room:Math.round(targetRoom*15)},
    reason_codes:[channelName,'PIVOT_VALIDATED','CHANNEL_BREAKOUT_CONFIRMED',`TOUCHES_${fit.upperTouches+fit.lowerTouches}`,`BODY_${Math.round(last.bodyRatio*100)}`,`DISP_${breakout.displacement.toFixed(2)}ATR`,`RR_${rr.toFixed(2)}`],
    thesis:`${channelName.replaceAll('_',' ')} is pivot-validated with ${fit.upperTouches} upper and ${fit.lowerTouches} lower touches. M15 closed ${side==='BUY'?'above':'below'} the boundary by ${breakout.displacement.toFixed(2)} ATR, with ${Math.round(last.bodyRatio*100)}% body and ${Math.round(breakout.closeExtreme*100)}% directional close quality. Target uses the measured channel width, not an arbitrary RR target.`,
    invalidation:`Cancel before fill if M15 closes ${side==='BUY'?'below':'above'} ${round(invalid,digits)}, if measured target is reached before retest, or at ${exp||'time expiry'}.`,
    pre_fill_invalidation:{timeframe:'M15',operator:side==='BUY'?'BELOW':'ABOVE',level:round(invalid,digits)},
    pattern:{name:channelName,status:'CONFIRMED',timeframe:'M15',detected_at:m15.at(-1)?.timestamp||snapshot.timestamp,target_window:tw,expires_at:exp},
    visual:{timeframe:'M15',candles:compactBars(m15),upper:{start:round(fit.hi.at(0),digits),end:round(upperNow,digits)},lower:{start:round(fit.lo.at(0),digits),end:round(lowerNow,digits)},entry:round(entry,digits),stop_loss:round(sl,digits),take_profit:round(tp,digits),break_timestamp:m15.at(-1)?.timestamp||null}
  }};
}

function trendlineStructure(prior,atrValue){
  const bars=prior.slice(-24); if(bars.length<12) return [];
  const highs=pivots(bars,'high','HIGH'),lows=pivots(bars,'low','LOW'),tol=atrValue*.23,out=[];
  const highLine=highs.length>=3?lineFit(highs.slice(-6)):null;
  const lowLine=lows.length>=3?lineFit(lows.slice(-6)):null;
  if(highLine&&highLine.slope<-atrValue*.015){
    const touches=separatedTouches(highs,highLine,tol,2); if(touches.length>=3) out.push({type:'DESCENDING_RESISTANCE_TRENDLINE',side:'BUY',line:highLine,touches:touches.length,bars,rmse:highLine.rmse});
  }
  if(lowLine&&lowLine.slope>atrValue*.015){
    const touches=separatedTouches(lows,lowLine,tol,2); if(touches.length>=3) out.push({type:'ASCENDING_SUPPORT_TRENDLINE',side:'SELL',line:lowLine,touches:touches.length,bars,rmse:lowLine.rmse});
  }
  return out;
}

function trendlineWatch(s,m15,atrValue,digits,status='FORMING',extra={}){
  const x=s.bars.length, level=s.line.at(x), current=finite(m15.at(-1)?.close),distance=current===null?null:Math.abs(current-level)/atrValue;
  const clarity=clamp(1-s.rmse/(atrValue*.34),0,1),touchQuality=clamp((s.touches-2)/4,0,1),slopeQuality=clamp(Math.abs(s.line.slope)/(atrValue*.10),0,1);
  const q=100*(clarity*.45+touchQuality*.35+slopeQuality*.20);
  const actualStatus=status==='FORMING'&&distance!==null&&distance<=.45?'ARMED':status;
  const geometry={trendline:{start:round(s.line.at(0),digits),end:round(level,digits)}};
  return {type:s.type,status:actualStatus,timeframe:'M15',quality:Math.round(q),distance_atr:distance===null?null:round(distance,2),touches:s.touches,level:round(level,digits),quality_components:{clarity,touch_quality:touchQuality,initial_trend:slopeQuality,uniformity:clarity},geometry,visual:{timeframe:'M15',candles:compactBars(m15),...geometry},fingerprint:watchFingerprint(s.type,geometry),...extra};
}

function trendlineCandidate(snapshot,m15,atrValue,digits){
  const last=bodyStats(m15.at(-1)),prev=bodyStats(m15.at(-2)); if(!last||!prev) return {watches:[],candidates:[]};
  const structures=trendlineStructure(m15.slice(0,-1),atrValue),watches=[],candidates=[];
  for(const s of structures){
    const x=s.bars.length,xp=x-1,level=s.line.at(x),prevLevel=s.line.at(xp),side=s.side;
    const broke=side==='BUY'?(last.close>level+atrValue*.12&&prev.close<=prevLevel+atrValue*.07):(last.close<level-atrValue*.12&&prev.close>=prevLevel-atrValue*.07);
    if(!broke){watches.push(trendlineWatch(s,m15,atrValue,digits));continue;}
    const breakout=breakoutStats(last,level,side,atrValue);
    if(!breakout.valid){watches.push(trendlineWatch(s,m15,atrValue,digits,'ARMED',{trigger_failed:'BREAKOUT_QUALITY',breakout_metrics:breakout}));continue;}
    const ask=finite(snapshot?.ask),bid=finite(snapshot?.bid);
    if((side==='BUY'&&ask!==null&&level>=ask)||(side==='SELL'&&bid!==null&&level<=bid)){watches.push(trendlineWatch(s,m15,atrValue,digits,'CONFIRMED',{trigger_failed:'ENTRY_ALREADY_CROSSED'}));continue;}
    const recent=s.bars.slice(-12), measured=side==='BUY'?level-Math.min(...recent.map(b=>finite(b.low))):Math.max(...recent.map(b=>finite(b.high)))-level;
    const point=finite(snapshot?.features?.point_size)||.001,spread=(finite(snapshot?.spread_points)||0)*point;
    const risk=Math.max(atrValue*.36,Math.abs(measured)*.16)+spread,reward=Math.max(measured*.82,atrValue*.9),rr=reward/risk;
    const sl=side==='BUY'?level-risk:level+risk,tp=side==='BUY'?level+reward:level-reward;
    const watch=trendlineWatch(s,m15,atrValue,digits,'CONFIRMED');
    const clarity=watch.quality_components.clarity,touchQuality=watch.quality_components.touch_quality,trend=watch.quality_components.initial_trend;
    const breakoutQuality=clamp(breakout.displacement/.55*.35+last.bodyRatio*.35+breakout.closeExtreme*.30,0,1),targetRoom=clamp((rr-1.2)/1.8,0,1);
    const score=Math.round(100*(clarity*.22+touchQuality*.18+trend*.10+breakoutQuality*.30+targetRoom*.20));
    if(rr<1.5||score<Number(process.env.PATTERN_MIN_SCORE||72)){watches.push({...watch,trigger_failed:rr<1.5?'INSUFFICIENT_TARGET_ROOM':'SCORE_BELOW_THRESHOLD',rr:round(rr,2)});continue;}
    const expCandles=8,tw=targetWindow(reward,m15,15),exp=expiresAt(m15.at(-1)?.timestamp,expCandles,15),invalid=side==='BUY'?level-atrValue*.32:level+atrValue*.32;
    const type=s.type.replace('_TRENDLINE','_BREAK');
    candidates.push({engine_version:ENGINE_VERSION,fingerprint:fingerprint(type,'M15',m15.at(-1),level,digits),state:'TRENDLINE_BREAKOUT_CONFIRMED',pattern_status:'CONFIRMED',pattern_name:type,timeframe:'M15',setup:'TRENDLINE_BREAKOUT_RETEST',side,order_type:side==='BUY'?'BUY_LIMIT':'SELL_LIMIT',regime:'BREAKOUT',entry:round(level,digits),stop_loss:round(sl,digits),take_profit:round(tp,digits),expiration_candles:expCandles,expiration_timeframe:'M15',expires_at:exp,estimated_target_window:tw,decision_confidence:score/100,entry_confidence:score/100,setup_score:score,rr,atr_reference:atrValue,
      score_components:{line_clarity:Math.round(clarity*20),touch_quality:Math.round(touchQuality*20),trend_context:Math.round(trend*10),breakout_quality:Math.round(breakoutQuality*30),risk_target_room:Math.round(targetRoom*20)},reason_codes:[type,'PIVOT_VALIDATED','TRENDLINE_BREAKOUT_CONFIRMED',`LINE_TOUCHES_${s.touches}`,`BODY_${Math.round(last.bodyRatio*100)}`,`DISP_${breakout.displacement.toFixed(2)}ATR`,`RR_${rr.toFixed(2)}`],thesis:`${s.type.replaceAll('_',' ')} is anchored to ${s.touches} confirmed pivots. M15 breakout closed ${breakout.displacement.toFixed(2)} ATR beyond the line with ${Math.round(last.bodyRatio*100)}% body. Target uses the measured structure height.`,invalidation:`Cancel before fill if M15 closes ${side==='BUY'?'below':'above'} ${round(invalid,digits)}, target is reached first, or at ${exp||'time expiry'}.`,pre_fill_invalidation:{timeframe:'M15',operator:side==='BUY'?'BELOW':'ABOVE',level:round(invalid,digits)},pattern:{name:s.type,status:'CONFIRMED',timeframe:'M15',detected_at:m15.at(-1)?.timestamp||snapshot.timestamp,target_window:tw,expires_at:exp},visual:{timeframe:'M15',candles:compactBars(m15),trendline:{start:round(s.line.at(0),digits),end:round(level,digits)},entry:round(level,digits),stop_loss:round(sl,digits),take_profit:round(tp,digits),break_timestamp:m15.at(-1)?.timestamp||null}});
  }
  return {watches,candidates};
}

export function detectChannelTrendlinePatterns(snapshot){
  const m15=Array.isArray(snapshot?.features?.m15_candles)?snapshot.features.m15_candles:[];
  if(m15.length<14) return {state:'INSUFFICIENT_M15',candidates:[],watches:[]};
  const atrValue=atr(m15,14); if(!atrValue) return {state:'ATR_UNAVAILABLE',candidates:[],watches:[]};
  const digits=Number(snapshot?.features?.digits??3),candidates=[],watches=[];
  const channel=channelCandidate(snapshot,m15,atrValue,digits); if(channel.watch) watches.push(channel.watch); if(channel.candidate) candidates.push(channel.candidate);
  const trend=trendlineCandidate(snapshot,m15,atrValue,digits); watches.push(...trend.watches);candidates.push(...trend.candidates);
  candidates.sort((a,b)=>b.setup_score-a.setup_score||b.rr-a.rr);
  const hasConfirmedWatch=watches.some(w=>w.status==='CONFIRMED');
  const hasArmed=watches.some(w=>w.status==='ARMED');
  return {state:candidates.length?'CONFIRMED':hasConfirmedWatch?'CONFIRMED_NOT_ACTIONABLE':hasArmed?'ARMED':watches.length?'FORMING':'NO_EVENT',candidates,watches,atr_m15:atrValue,engine_version:ENGINE_VERSION,scanned_at:snapshot?.timestamp||new Date().toISOString()};
}
