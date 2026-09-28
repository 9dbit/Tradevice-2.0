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

export async function evaluateShadowSnapshot(snapshot) {
  if (snapshot?.timeframe !== 'M1') return { evaluated: 0, closed: 0, expired: 0, skipped: 'NOT_M1' };
  const candle = newestCandle(snapshot);
  if (!candle) return { evaluated: 0, closed: 0, expired: 0, skipped: 'NO_CANDLE' };

  const active = await getActiveShadowDecisions();
  const point = Number(snapshot?.features?.point_size) || 0.001;
  let evaluated = 0;
  let closed = 0;
  let expired = 0;

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
      if (touched(candle, entry)) {
        state.status = 'FILLED';
        state.fill_time = String(candle.timestamp);
        state.fill_price = entry;
        filledThisBar = true;
      } else {
        state.bars_seen += 1;
        const expiry = Math.max(1, Number(trade.expiration_candles ?? 3));
        if (state.bars_seen >= expiry) {
          await updateDecisionContext(trade.trade_id, { shadow_state: state });
          await recordOutcome(trade.trade_id, {
            status: 'EXPIRED',
            pnl_r: 0,
            mfe_points: 0,
            mae_points: 0,
            duration_seconds: 0,
            closed_at: snapshot.timestamp,
            meta: { simulated: true, filled: false }
          });
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

  return { evaluated, closed, expired, candle_timestamp: String(candle.timestamp) };
}
