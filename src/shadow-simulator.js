import { getActiveShadowDecisions, recordOutcome, updateDecisionContext } from './store.js';

function timeValue(value) {
  if (value == null) return NaN;
  const text = String(value);
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  return Date.parse(text);
}

function newestCandle(snapshot) {
  const candles = Array.isArray(snapshot?.candles) ? snapshot.candles : [];
  if (!candles.length) return null;
  return [...candles].sort((a, b) => timeValue(b.timestamp) - timeValue(a.timestamp))[0];
}

function newestM5(snapshot) {
  const candles = Array.isArray(snapshot?.features?.m5_candles) ? snapshot.features.m5_candles : [];
  if (!candles.length) return null;
  return [...candles].sort((a, b) => timeValue(b.timestamp) - timeValue(a.timestamp))[0];
}

function touched(candle, price) {
  return Number(candle.low) <= price && price <= Number(candle.high);
}

function excursion(side, entry, candle, point) {
  const high = Number(candle.high);
  const low = Number(candle.low);
  if (side === 'BUY') {
    return {
      mfe: Math.max(0, (high - entry) / point),
      mae: Math.max(0, (entry - low) / point)
    };
  }
  return {
    mfe: Math.max(0, (entry - low) / point),
    mae: Math.max(0, (high - entry) / point)
  };
}

async function closeUnfilled(trade, state, snapshot, status, reason) {
  state.status = status;
  await updateDecisionContext(trade.trade_id, { shadow_state: state });
  await recordOutcome(trade.trade_id, {
    status,
    pnl_r: 0,
    mfe_points: 0,
    mae_points: 0,
    duration_seconds: 0,
    closed_at: snapshot.timestamp,
    meta: { simulated: true, filled: false, reason }
  });
}

function deterministicInvalidation(trade, snapshot, candle, entry, tp) {
  if (trade?.context?.deterministic_engine !== true) return null;

  if (!touched(candle, entry)) {
    if (trade.side === 'SELL' && Number(candle.low) <= tp) return 'TARGET_REACHED_BEFORE_RETEST';
    if (trade.side === 'BUY' && Number(candle.high) >= tp) return 'TARGET_REACHED_BEFORE_RETEST';
  }

  const zone = trade?.context?.zone;
  const m5 = newestM5(snapshot);
  const eventMs = timeValue(trade?.context?.market_timestamp ?? trade.created_at);
  const m5Ms = timeValue(m5?.timestamp);
  const isLaterM5 = Number.isFinite(eventMs) && Number.isFinite(m5Ms) && m5Ms > eventMs - 5 * 60 * 1000;
  if (!zone || !m5 || !isLaterM5) return null;

  const m5Close = Number(m5.close);
  if (trade.setup === 'SBR_RETEST' && Number.isFinite(Number(zone.high)) && m5Close > Number(zone.high)) {
    return 'SBR_M5_CLOSED_BACK_ABOVE_ZONE';
  }
  if (trade.setup === 'RBS_RETEST' && Number.isFinite(Number(zone.low)) && m5Close < Number(zone.low)) {
    return 'RBS_M5_CLOSED_BACK_BELOW_ZONE';
  }
  return null;
}

export async function evaluateShadowSnapshot(snapshot) {
  if (snapshot?.timeframe !== 'M1') return { evaluated: 0, closed: 0, expired: 0, skipped: 'NOT_M1' };
  const candle = newestCandle(snapshot);
  if (!candle) return { evaluated: 0, closed: 0, expired: 0, skipped: 'NO_CANDLE' };

  const active = await getActiveShadowDecisions();
  const point = Number(snapshot?.features?.point_size) || 0.001;
  let evaluated = 0;
  let closed = 0;
  let expired = 0;
  let cancelled = 0;

  for (const trade of active) {
    if (trade?.context?.risk_review?.approved !== true) continue;

    const entry = Number(trade.entry);
    const sl = Number(trade.stop_loss);
    const tp = Number(trade.take_profit);
    if (![entry, sl, tp].every(Number.isFinite)) continue;

    const previous = trade?.context?.shadow_state ?? {};
    if (String(previous.last_bar_timestamp ?? '') === String(candle.timestamp)) continue;

    const state = {
      status: previous.status ?? 'PENDING',
      bars_seen: Number(previous.bars_seen ?? 0),
      fill_time: previous.fill_time ?? null,
      fill_price: previous.fill_price ?? null,
      mfe_points: Number(previous.mfe_points ?? 0),
      mae_points: Number(previous.mae_points ?? 0),
      last_bar_timestamp: String(candle.timestamp)
    };

    evaluated += 1;
    let filledThisBar = false;

    if (state.status === 'PENDING') {
      const invalidation = deterministicInvalidation(trade, snapshot, candle, entry, tp);
      if (invalidation) {
        await closeUnfilled(trade, state, snapshot, 'CANCELLED', invalidation);
        cancelled += 1;
        continue;
      }

      if (touched(candle, entry)) {
        state.status = 'FILLED';
        state.fill_time = String(candle.timestamp);
        state.fill_price = entry;
        filledThisBar = true;
      } else {
        state.bars_seen += 1;
        const expiry = Math.max(1, Number(trade.expiration_candles ?? 3));
        const deterministic = trade?.context?.deterministic_engine === true;
        let isExpired = false;
        if (deterministic) {
          const eventMs = timeValue(trade?.context?.market_timestamp ?? trade.created_at);
          const currentMs = timeValue(candle.timestamp);
          isExpired = Number.isFinite(eventMs) && Number.isFinite(currentMs) && currentMs - eventMs >= expiry * 5 * 60 * 1000;
        } else {
          isExpired = state.bars_seen >= expiry;
        }

        if (isExpired) {
          await closeUnfilled(trade, state, snapshot, 'EXPIRED', deterministic ? 'M5_EXPIRATION_REACHED' : 'M1_EXPIRATION_REACHED');
          expired += 1;
          continue;
        }
      }
    }

    if (state.status === 'FILLED') {
      const ex = excursion(trade.side, entry, candle, point);
      state.mfe_points = Math.max(state.mfe_points, ex.mfe);
      state.mae_points = Math.max(state.mae_points, ex.mae);

      const hitSl = touched(candle, sl);
      const hitTp = touched(candle, tp);
      let exit = null;
      let ambiguity = null;

      if (hitSl && hitTp) {
        exit = 'SL';
        ambiguity = 'BOTH_TP_AND_SL_TOUCHED_SAME_BAR_CONSERVATIVE_SL_FIRST';
      } else if (hitSl) {
        exit = 'SL';
      } else if (hitTp && !filledThisBar) {
        exit = 'TP';
      } else if (hitTp && filledThisBar) {
        ambiguity = 'TP_TOUCHED_ON_FILL_BAR_NOT_CREDITED_WITHOUT_TICK_SEQUENCE';
      }

      if (exit) {
        const risk = Math.abs(entry - sl);
        const reward = Math.abs(tp - entry);
        const pnlR = exit === 'SL' ? -1 : (risk > 0 ? reward / risk : 0);
        const fillMs = timeValue(state.fill_time);
        const closeMs = timeValue(candle.timestamp);
        const duration = Number.isFinite(fillMs) && Number.isFinite(closeMs)
          ? Math.max(0, Math.round((closeMs - fillMs) / 1000))
          : undefined;

        await updateDecisionContext(trade.trade_id, { shadow_state: state });
        await recordOutcome(trade.trade_id, {
          status: exit,
          exit_price: exit === 'SL' ? sl : tp,
          pnl_r: pnlR,
          mfe_points: state.mfe_points,
          mae_points: state.mae_points,
          duration_seconds: duration,
          closed_at: snapshot.timestamp,
          meta: { simulated: true, ambiguity }
        });
        closed += 1;
        continue;
      }

      if (ambiguity) state.ambiguity = ambiguity;
    }

    await updateDecisionContext(trade.trade_id, { shadow_state: state });
  }

  return { evaluated, closed, expired, cancelled, candle_timestamp: String(candle.timestamp) };
}
