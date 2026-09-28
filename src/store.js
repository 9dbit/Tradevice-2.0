import pg from 'pg';

const { Pool } = pg;
const memory = { snapshots: [], decisions: [] };
let pool = null;

export async function initStore() {
  if (!process.env.DATABASE_URL) return { driver: 'memory' };
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'disable' ? false : undefined });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market_snapshots (
      id BIGSERIAL PRIMARY KEY,
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      ts TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS market_snapshots_symbol_ts_idx ON market_snapshots(symbol, ts DESC);

    CREATE TABLE IF NOT EXISTS trade_decisions (
      id BIGSERIAL PRIMARY KEY,
      trade_id TEXT UNIQUE NOT NULL,
      mode TEXT NOT NULL DEFAULT 'shadow',
      decision TEXT NOT NULL,
      side TEXT,
      order_type TEXT,
      setup TEXT,
      regime TEXT,
      entry NUMERIC,
      stop_loss NUMERIC,
      take_profit NUMERIC,
      expiration_candles INTEGER,
      confidence NUMERIC,
      reason_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
      context JSONB NOT NULL DEFAULT '{}'::jsonb,
      review_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
      review_source TEXT,
      review_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
      reviewed_at TIMESTAMPTZ,
      outcome JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ
    );
    ALTER TABLE trade_decisions ADD COLUMN IF NOT EXISTS order_type TEXT;
    ALTER TABLE trade_decisions ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW';
    ALTER TABLE trade_decisions ADD COLUMN IF NOT EXISTS review_source TEXT;
    ALTER TABLE trade_decisions ADD COLUMN IF NOT EXISTS review_reasons JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE trade_decisions ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS trade_decisions_created_idx ON trade_decisions(created_at DESC);
    CREATE INDEX IF NOT EXISTS trade_decisions_review_idx ON trade_decisions(review_status, created_at DESC);
  `);
  return { driver: 'postgres' };
}

export function storeDriver() {
  return pool ? 'postgres' : 'memory';
}

// Internal database access for the separate demo audit journal. Never exposed over HTTP.
export function getDatabasePool() { return pool; }

export async function saveSnapshot(snapshot) {
  if (!pool) {
    memory.snapshots.unshift(snapshot);
    memory.snapshots = memory.snapshots.slice(0, 1000);
    return snapshot;
  }
  await pool.query(
    'INSERT INTO market_snapshots(symbol,timeframe,ts,payload) VALUES($1,$2,$3,$4)',
    [snapshot.symbol, snapshot.timeframe, snapshot.timestamp, snapshot]
  );
  return snapshot;
}

export async function getLatestSnapshot(symbol = 'XAUUSD') {
  if (!pool) return memory.snapshots.find(x => x.symbol === symbol) ?? null;
  const { rows } = await pool.query(
    'SELECT payload FROM market_snapshots WHERE symbol=$1 ORDER BY ts DESC LIMIT 1',
    [symbol]
  );
  return rows[0]?.payload ?? null;
}

export async function saveDecision(decision) {
  const review = decision.review ?? {};
  const reviewStatus = review.status ?? (decision.decision === 'PLACE_PENDING' ? 'PENDING_REVIEW' : 'NOT_REQUIRED');
  const reviewSource = review.source ?? null;
  const reviewReasons = review.reasons ?? [];
  const reviewedAt = review.reviewed_at ?? null;

  if (!pool) {
    const normalized = {
      created_at: new Date().toISOString(),
      ...decision,
      review_status: reviewStatus,
      review_source: reviewSource,
      review_reasons: reviewReasons,
      reviewed_at: reviewedAt
    };
    delete normalized.review;
    const existing = memory.decisions.findIndex(d => d.trade_id === normalized.trade_id);
    if (existing >= 0) memory.decisions[existing] = { ...memory.decisions[existing], ...normalized };
    else memory.decisions.unshift(normalized);
    memory.decisions = memory.decisions.slice(0, 2000);
    return normalized;
  }

  await pool.query(
    `INSERT INTO trade_decisions(
      trade_id,mode,decision,side,order_type,setup,regime,entry,stop_loss,take_profit,
      expiration_candles,confidence,reason_codes,context,review_status,review_source,
      review_reasons,reviewed_at,outcome
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
    ON CONFLICT(trade_id) DO UPDATE SET
      order_type=COALESCE(EXCLUDED.order_type,trade_decisions.order_type),
      outcome=COALESCE(EXCLUDED.outcome,trade_decisions.outcome),
      context=trade_decisions.context || EXCLUDED.context,
      review_status=COALESCE(EXCLUDED.review_status,trade_decisions.review_status),
      review_source=COALESCE(EXCLUDED.review_source,trade_decisions.review_source),
      review_reasons=CASE WHEN jsonb_array_length(EXCLUDED.review_reasons) > 0 THEN EXCLUDED.review_reasons ELSE trade_decisions.review_reasons END,
      reviewed_at=COALESCE(EXCLUDED.reviewed_at,trade_decisions.reviewed_at)`,
    [
      decision.trade_id, decision.mode ?? 'shadow', decision.decision, decision.side ?? null,
      decision.order_type ?? null, decision.setup ?? null, decision.regime ?? null,
      decision.entry ?? null, decision.stop_loss ?? null, decision.take_profit ?? null,
      decision.expiration_candles ?? null, decision.confidence ?? null,
      JSON.stringify(decision.reason_codes ?? []), JSON.stringify(decision.context ?? {}),
      reviewStatus, reviewSource, JSON.stringify(reviewReasons), reviewedAt,
      decision.outcome ? JSON.stringify(decision.outcome) : null
    ]
  );
  return {
    ...decision,
    review_status: reviewStatus,
    review_source: reviewSource,
    review_reasons: reviewReasons,
    reviewed_at: reviewedAt
  };
}

export async function updateDecisionContext(tradeId, patch) {
  if (!pool) {
    const idx = memory.decisions.findIndex(d => d.trade_id === tradeId);
    if (idx < 0) return null;
    memory.decisions[idx] = {
      ...memory.decisions[idx],
      context: { ...(memory.decisions[idx].context ?? {}), ...patch }
    };
    return memory.decisions[idx];
  }
  const { rows } = await pool.query(
    `UPDATE trade_decisions
       SET context = context || $2::jsonb
     WHERE trade_id=$1
     RETURNING trade_id,mode,decision,side,order_type,setup,regime,entry,stop_loss,take_profit,
               expiration_candles,confidence,reason_codes,context,review_status,review_source,
               review_reasons,reviewed_at,outcome,created_at,closed_at`,
    [tradeId, JSON.stringify(patch)]
  );
  return rows[0] ?? null;
}

export async function getActiveShadowDecisions(limit = 200) {
  if (!pool) {
    return memory.decisions
      .filter(d => d.mode === 'shadow' && d.decision === 'PLACE_PENDING' && d.review_status === 'APPROVED' && !d.outcome)
      .slice(0, limit);
  }
  const { rows } = await pool.query(
    `SELECT trade_id,mode,decision,side,order_type,setup,regime,entry,stop_loss,take_profit,
            expiration_candles,confidence,reason_codes,context,review_status,review_source,
            review_reasons,reviewed_at,outcome,created_at,closed_at
       FROM trade_decisions
      WHERE mode='shadow' AND decision='PLACE_PENDING' AND review_status='APPROVED' AND outcome IS NULL
      ORDER BY created_at ASC LIMIT $1`,
    [Math.min(limit, 500)]
  );
  return rows;
}

export async function recordOutcome(tradeId, outcome) {
  const closedAt = outcome.closed_at ?? new Date().toISOString();
  if (!pool) {
    const idx = memory.decisions.findIndex(d => d.trade_id === tradeId);
    if (idx < 0) return null;
    memory.decisions[idx] = { ...memory.decisions[idx], outcome, closed_at: closedAt };
    return memory.decisions[idx];
  }

  const { rows } = await pool.query(
    `UPDATE trade_decisions
       SET outcome=$2, closed_at=$3
     WHERE trade_id=$1
     RETURNING trade_id,mode,decision,side,order_type,setup,regime,entry,stop_loss,take_profit,
               expiration_candles,confidence,reason_codes,context,review_status,review_source,
               review_reasons,reviewed_at,outcome,created_at,closed_at`,
    [tradeId, JSON.stringify(outcome), closedAt]
  );
  return rows[0] ?? null;
}

export async function getRecentDecisions(limit = 100) {
  if (!pool) return memory.decisions.slice(0, limit);
  const { rows } = await pool.query(
    `SELECT trade_id,mode,decision,side,order_type,setup,regime,entry,stop_loss,take_profit,
            expiration_candles,confidence,reason_codes,context,review_status,review_source,
            review_reasons,reviewed_at,outcome,created_at,closed_at
     FROM trade_decisions ORDER BY created_at DESC LIMIT $1`,
    [Math.min(limit, 500)]
  );
  return rows;
}

export async function performanceSummary(limit = 100) {
  const decisions = await getRecentDecisions(limit);
  const closed = decisions.filter(d => d.outcome && typeof d.outcome === 'object');
  const pnlR = closed.map(d => Number(d.outcome.pnl_r ?? 0));
  const mfe = closed.map(d => Number(d.outcome.mfe_points ?? 0)).filter(Number.isFinite);
  const mae = closed.map(d => Number(d.outcome.mae_points ?? 0)).filter(Number.isFinite);
  const wins = pnlR.filter(x => x > 0).length;
  const losses = pnlR.filter(x => x < 0).length;
  const grossProfit = pnlR.filter(x => x > 0).reduce((a,b) => a+b, 0);
  const grossLoss = Math.abs(pnlR.filter(x => x < 0).reduce((a,b) => a+b, 0));
  return {
    sample_size: decisions.length,
    closed_trades: closed.length,
    wins,
    losses,
    win_rate: closed.length ? wins / closed.length : null,
    expectancy_r: closed.length ? pnlR.reduce((a,b) => a+b, 0) / closed.length : null,
    profit_factor: grossLoss > 0 ? grossProfit / grossLoss : null,
    avg_mfe_points: mfe.length ? mfe.reduce((a,b) => a+b, 0) / mfe.length : null,
    avg_mae_points: mae.length ? mae.reduce((a,b) => a+b, 0) / mae.length : null,
    note: 'Shadow/research metrics only; not a promise of future profitability.'
  };
}
