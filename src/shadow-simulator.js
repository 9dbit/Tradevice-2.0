import { getActiveShadowDecisions, recordOutcome, updateDecisionContext } from './store.js';

function timeValue(value) {
  if (value == null) return NaN;
  const text = String(value);
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  return Date.parse(text);
}

function newestFrom(list) {
  if (!Array.isArray(list) || !list.length) return null;
  return [...list].sort((a,b)=>timeValue(b.timestamp)-timeValue(a.timestamp))[0];
}

function newestCandle(snapshot) { return newestFrom(snapshot?.candles); }
function newestM5(snapshot) { return newestFrom(snapshot?.features?.m5_candles); }
function newestM15(snapshot) { return newestFrom(snapshot?.features?.m15_candles); }
function candleForTimeframe(snapshot, timeframe) {
  const tf=String(timeframe||'M5').toUpperCase();
  if(tf==='M15') return newestM15(snapshot);
  if(tf==='M5') return newestM5(snapshot);
  return newestCandle(snapshot);
}
function timeframeMinutes(timeframe) {
  const tf=String(timeframe||'M1').toUpperCase();
  if(tf==='M15') return 15;
  if(tf==='M5') return 5;
  if(tf==='H1') return 60;
  return 1;
}

function touched(candle, price) { return Number(candle.low) <= price && price <= Number(candle.high); }

function excursion(side, entry, candle, point) {
  const high=Number(candle.high), low=Number(candle.low);
  return side==='BUY'
    ? {mfe:Math.max(0,(high-entry)/point),mae:Math.max(0,(entry-low)/point)}
    : {mfe:Math.max(0,(entry-low)/point),mae:Math.max(0,(high-entry)/point)};
}

async function closeUnfilled(trade, state, snapshot, status, reason) {
  state.status=status;
  await updateDecisionContext(trade.trade_id,{shadow_state:state});
  await recordOutcome(trade.trade_id,{status,pnl_r:0,mfe_points:0,mae_points:0,duration_seconds:0,closed_at:snapshot.timestamp,meta:{simulated:true,filled:false,reason}});
}

function deterministicInvalidation(trade, snapshot, candle, entry, tp) {
  if (trade?.context?.deterministic_engine !== true) return null;
  if (!touched(candle, entry)) {
    if (trade.side==='SELL' && Number(candle.low)<=tp) return 'TARGET_REACHED_BEFORE_RETEST';
    if (trade.side==='BUY' && Number(candle.high)>=tp) return 'TARGET_REACHED_BEFORE_RETEST';
  }

  const generic=trade?.context?.pre_fill_invalidation;
  if(generic && Number.isFinite(Number(generic.level))) {
    const bar=candleForTimeframe(snapshot,generic.timeframe||trade?.context?.expiration_timeframe||'M5');
    const close=Number(bar?.close), level=Number(generic.level);
    if(Number.isFinite(close)) {
      if(generic.operator==='BELOW' && close<level) return 'STRUCTURE_CLOSED_BELOW_INVALIDATION';
      if(generic.operator==='ABOVE' && close>level) return 'STRUCTURE_CLOSED_ABOVE_INVALIDATION';
    }
  }

  const zone=trade?.context?.zone, m5=newestM5(snapshot);
  const eventMs=timeValue(trade?.context?.market_timestamp ?? trade.created_at), m5Ms=timeValue(m5?.timestamp);
  const isLaterM5=Number.isFinite(eventMs)&&Number.isFinite(m5Ms)&&m5Ms>eventMs-5*60*1000;
  if(!zone||!m5||!isLaterM5) return null;
  const m5Close=Number(m5.close);
  if(trade.setup==='SBR_RETEST'&&Number.isFinite(Number(zone.high))&&m5Close>Number(zone.high)) return 'SBR_M5_CLOSED_BACK_ABOVE_ZONE';
  if(trade.setup==='RBS_RETEST'&&Number.isFinite(Number(zone.low))&&m5Close<Number(zone.low)) return 'RBS_M5_CLOSED_BACK_BELOW_ZONE';
  return null;
}

export async function evaluateShadowSnapshot(snapshot) {
  if(snapshot?.timeframe!=='M1') return {evaluated:0,closed:0,expired:0,skipped:'NOT_M1'};
  const candle=newestCandle(snapshot); if(!candle) return {evaluated:0,closed:0,expired:0,skipped:'NO_CANDLE'};
  const active=await getActiveShadowDecisions(), point=Number(snapshot?.features?.point_size)||0.001;
  let evaluated=0,closed=0,expired=0,cancelled=0;

  for(const trade of active) {
    if(trade?.context?.risk_review?.approved!==true) continue;
    const entry=Number(trade.entry),sl=Number(trade.stop_loss),tp=Number(trade.take_profit);
    if(![entry,sl,tp].every(Number.isFinite)) continue;
    const previous=trade?.context?.shadow_state??{};
    if(String(previous.last_bar_timestamp??'')===String(candle.timestamp)) continue;
    const state={status:previous.status??'PENDING',bars_seen:Number(previous.bars_seen??0),fill_time:previous.fill_time??null,fill_price:previous.fill_price??null,mfe_points:Number(previous.mfe_points??0),mae_points:Number(previous.mae_points??0),last_bar_timestamp:String(candle.timestamp)};
    evaluated+=1; let filledThisBar=false;

    if(state.status==='PENDING') {
      const invalidation=deterministicInvalidation(trade,snapshot,candle,entry,tp);
      if(invalidation){await closeUnfilled(trade,state,snapshot,'CANCELLED',invalidation);cancelled+=1;continue;}
      if(touched(candle,entry)) {state.status='FILLED';state.fill_time=String(candle.timestamp);state.fill_price=entry;filledThisBar=true;}
      else {
        state.bars_seen+=1;
        const expiry=Math.max(1,Number(trade.expiration_candles??3)), deterministic=trade?.context?.deterministic_engine===true;
        let isExpired=false, expiryReason='M1_EXPIRATION_REACHED';
        if(deterministic) {
          const tf=trade?.context?.expiration_timeframe||'M5', minutes=timeframeMinutes(tf);
          const eventMs=timeValue(trade?.context?.market_timestamp??trade.created_at), currentMs=timeValue(candle.timestamp);
          isExpired=Number.isFinite(eventMs)&&Number.isFinite(currentMs)&&currentMs-eventMs>=expiry*minutes*60*1000;
          expiryReason=`${String(tf).toUpperCase()}_EXPIRATION_REACHED`;
        } else isExpired=state.bars_seen>=expiry;
        if(isExpired){await closeUnfilled(trade,state,snapshot,'EXPIRED',expiryReason);expired+=1;continue;}
      }
    }

    if(state.status==='FILLED') {
      const ex=excursion(trade.side,entry,candle,point);
      state.mfe_points=Math.max(state.mfe_points,ex.mfe); state.mae_points=Math.max(state.mae_points,ex.mae);
      const hitSl=touched(candle,sl),hitTp=touched(candle,tp); let exit=null,ambiguity=null;
      if(hitSl&&hitTp){exit='SL';ambiguity='BOTH_TP_AND_SL_TOUCHED_SAME_BAR_CONSERVATIVE_SL_FIRST';}
      else if(hitSl) exit='SL';
      else if(hitTp&&!filledThisBar) exit='TP';
      else if(hitTp&&filledThisBar) ambiguity='TP_TOUCHED_ON_FILL_BAR_NOT_CREDITED_WITHOUT_TICK_SEQUENCE';
      if(exit) {
        const risk=Math.abs(entry-sl), reward=Math.abs(tp-entry), pnlR=exit==='SL'?-1:(risk>0?reward/risk:0);
        const fillMs=timeValue(state.fill_time),closeMs=timeValue(candle.timestamp),duration=Number.isFinite(fillMs)&&Number.isFinite(closeMs)?Math.max(0,Math.round((closeMs-fillMs)/1000)):undefined;
        await updateDecisionContext(trade.trade_id,{shadow_state:state});
        await recordOutcome(trade.trade_id,{status:exit,exit_price:exit==='SL'?sl:tp,pnl_r:pnlR,mfe_points:state.mfe_points,mae_points:state.mae_points,duration_seconds:duration,closed_at:snapshot.timestamp,meta:{simulated:true,ambiguity}});
        closed+=1;continue;
      }
      if(ambiguity) state.ambiguity=ambiguity;
    }
    await updateDecisionContext(trade.trade_id,{shadow_state:state});
  }
  return {evaluated,closed,expired,cancelled,candle_timestamp:String(candle.timestamp)};
}
