import express from 'express';
import fs from 'fs';
import path from 'path';
import { z } from 'zod/v4';
import { initStore, storeDriver, saveSnapshot, getLatestSnapshot, getRecentDecisions, performanceSummary, saveDecision, recordOutcome } from './store.js';
import { mcpNodeHandler } from './mcp.js';
import { validateTradeIntent } from './risk.js';
import { reviewPendingDecision } from './review-agent.js';
import { evaluateShadowSnapshot } from './shadow-simulator.js';
import { aiWorkerEnabled, runAiDecision } from './ai-worker.js';
import { initDemoExecution, pollDemo, demoLedger } from './demo-execution.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const publicTargetPort = Number(process.env.PUBLIC_TARGET_PORT || 3000);
const apiKey = process.env.TRADEVICE_API_KEY || '';
const feedStaleAfterSeconds = Number(process.env.FEED_STALE_AFTER_SECONDS || 180);
const shadowLot = Number(process.env.SHADOW_LOT || 0.01);

function requireKey(req, res, next) {
  if (!apiKey) return next();
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${apiKey}`) return res.status(401).json({ error: 'unauthorized' });
  next();
}

app.get('/', async (_req, res, next) => {
  try {
    const source = await fs.promises.readFile(path.resolve('public/index.html'), 'utf8');
    res.type('html').send(source.replace('</body>', '<script src="/order-ledger.js"></script><script src="/demo-ledger.js"></script></body>'));
  } catch (err) { next(err); }
});
app.use(express.static('public'));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'tradevice-2.0', mode: 'shadow', store: storeDriver() }));
app.get('/api/v1/info', (_req, res) => res.json({
  name: 'Tradevice 2.0',
  phase: 'P0/P1 Observer + Shadow AI',
  execution_enabled: false,
  endpoints: { health: '/health', mcp: '/mcp', status: '/api/v1/status', dashboard: '/api/v1/dashboard', order_ledger: '/api/v1/orders/ledger' }
}));
app.get('/downloads/TradeviceObserver.mq5', (_req, res) => {
  res.download(path.resolve('mt5/TradeviceObserver.mq5'), 'TradeviceObserver.mq5');
});

app.all('/mcp', requireKey, mcpNodeHandler);
app.use(express.json({ limit: '1mb' }));

const DemoPoll = z.object({
  client_id: z.string().regex(/^[A-Za-z0-9_-]{3,48}$/), nonce: z.string().regex(/^[0-9]{1,24}$/),
  account_mode: z.literal('DEMO'), account_login: z.string().regex(/^[0-9]+$/), account_server: z.string().min(1).max(128),
  armed: z.boolean(), orders_total: z.number().int().nonnegative(), positions_total: z.number().int().nonnegative(),
  report: z.object({ token: z.string().regex(/^[a-f0-9]{24}$/), ticket: z.string().regex(/^[0-9]+$/),
    status: z.enum(['PENDING','FILLED','CLOSED','CANCELLED','EXPIRED','REJECTED','UNKNOWN']),
    reason: z.string().max(200), pnl_usd: z.number().nullable()
  }).nullable()
});
app.get('/api/v1/demo/ledger', async (_req, res, next) => {
  try { res.json(await demoLedger()); } catch (error) { next(error); }
});
app.get('/downloads/TradeviceDemoExecutor.mq5', (_req, res) => res.download(path.resolve('mt5/TradeviceDemoExecutor.mq5')));
app.post('/api/v1/demo/poll', (req, res, next) => {
  // Unlike the observer bootstrap route, demo commands always require a configured secret.
  if (!apiKey || req.headers.authorization !== `Bearer ${apiKey}`) return res.status(401).json({ error: 'unauthorized' });
  next();
}, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.type('text/plain').send(await pollDemo(DemoPoll.parse(req.body)));
  } catch (error) {
    if (error.status === 403) return res.status(403).json({ error: 'demo_account_binding_mismatch' });
    next(error);
  }
});

const Candle = z.object({
  timestamp: z.string(), open: z.number(), high: z.number(), low: z.number(), close: z.number(), tick_volume: z.number().optional()
});

const Snapshot = z.object({
  symbol: z.string().default('XAUUSD'), timeframe: z.enum(['M1', 'M5', 'M15']).default('M1'), timestamp: z.string(),
  bid: z.number().optional(), ask: z.number().optional(), spread_points: z.number().nonnegative().optional(),
  candles: z.array(Candle).min(1).max(120), account: z.record(z.string(), z.unknown()).optional(), features: z.record(z.string(), z.unknown()).optional()
});

const Decision = z.object({
  trade_id: z.string().min(3), decision: z.enum(['WAIT', 'PLACE_PENDING', 'CANCEL']), side: z.enum(['BUY', 'SELL']).optional(),
  order_type: z.enum(['BUY_LIMIT', 'SELL_LIMIT', 'BUY_STOP', 'SELL_STOP']).optional(), setup: z.enum(['TREND_PULLBACK', 'BREAKOUT_RETEST', 'LIQUIDITY_SWEEP']).optional(),
  regime: z.enum(['TREND_UP', 'TREND_DOWN', 'RANGE', 'BREAKOUT', 'HIGH_VOLATILITY', 'CHAOTIC', 'NO_TRADE']), entry: z.number().optional(),
  stop_loss: z.number().optional(), take_profit: z.number().optional(), expiration_candles: z.number().int().min(1).max(10).optional(), confidence: z.number().min(0).max(1).optional(),
  reason_codes: z.array(z.string()).max(12).default([]), context: z.record(z.string(), z.unknown()).default({})
});

const Outcome = z.object({
  status: z.enum(['TP', 'SL', 'EXPIRED', 'CANCELLED', 'CLOSED']), exit_price: z.number().optional(), pnl_usd: z.number().optional(), pnl_r: z.number().optional(),
  mfe_points: z.number().nonnegative().optional(), mae_points: z.number().nonnegative().optional(), duration_seconds: z.number().int().nonnegative().optional(),
  closed_at: z.string().optional(), meta: z.record(z.string(), z.unknown()).optional()
});

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function ledgerRecord(order, snapshot) {
  const side = order.side;
  const entry = num(order.entry);
  const sl = num(order.stop_loss);
  const tp = num(order.take_profit);
  const current = side === 'BUY' ? num(snapshot?.bid) : num(snapshot?.ask);
  const point = num(snapshot?.features?.point_size) || 0.001;
  const digits = Number(snapshot?.features?.digits ?? 3);
  const pipSize = (digits === 3 || digits === 5) ? point * 10 : point;
  const tickSize = num(snapshot?.features?.tick_size);
  const tickValueProfit = num(snapshot?.features?.tick_value_profit) ?? num(snapshot?.features?.tick_value);
  const tickValueLoss = num(snapshot?.features?.tick_value_loss) ?? num(snapshot?.features?.tick_value);
  const lot = Number.isFinite(shadowLot) && shadowLot > 0 ? shadowLot : 0.01;
  const tpDistance = entry !== null && tp !== null ? Math.abs(tp - entry) : null;
  const slDistance = entry !== null && sl !== null ? Math.abs(entry - sl) : null;
  const tpPoints = tpDistance !== null && point > 0 ? tpDistance / point : null;
  const slPoints = slDistance !== null && point > 0 ? slDistance / point : null;
  const tpPips = tpDistance !== null && pipSize > 0 ? tpDistance / pipSize : null;
  const slPips = slDistance !== null && pipSize > 0 ? slDistance / pipSize : null;
  const tpUsd = tpDistance !== null && tickSize && tickValueProfit ? tpDistance / tickSize * tickValueProfit * lot : null;
  const slUsd = slDistance !== null && tickSize && tickValueLoss ? slDistance / tickSize * tickValueLoss * lot : null;
  const rr = slDistance && slDistance > 0 && tpDistance !== null ? tpDistance / slDistance : null;
  const shadowState = order.context?.shadow_state ?? {};
  const outcome = order.outcome && typeof order.outcome === 'object' ? order.outcome : null;

  let lifecycle = 'PENDING';
  if (order.review_status === 'REJECTED') lifecycle = 'REJECTED';
  else if (outcome?.status === 'TP') lifecycle = 'PROFIT';
  else if (outcome?.status === 'SL') lifecycle = 'LOSS';
  else if (outcome?.status === 'EXPIRED') lifecycle = 'EXPIRED';
  else if (outcome?.status === 'CANCELLED') lifecycle = 'CANCELLED';
  else if (outcome) lifecycle = 'CLOSED';
  else if (shadowState.status === 'FILLED') lifecycle = 'FLOATING';
  else if (order.review_status === 'PENDING_REVIEW') lifecycle = 'AWAITING_REVIEW';

  let floatingPoints = null;
  let floatingR = null;
  if (!outcome && shadowState.status === 'FILLED' && entry !== null && current !== null) {
    const move = side === 'BUY' ? current - entry : entry - current;
    floatingPoints = move / point;
    const risk = sl !== null ? Math.abs(entry - sl) : 0;
    floatingR = risk > 0 ? move / risk : null;
  }

  return {
    trade_id: order.trade_id, created_at: order.created_at, reviewed_at: order.reviewed_at, closed_at: order.closed_at, mode: order.mode,
    side: order.side, order_type: order.order_type, setup: order.setup, regime: order.regime, entry, stop_loss: sl, take_profit: tp, confidence: num(order.confidence),
    plan: { lot, point_size: point, pip_size: pipSize, tp_points: tpPoints, tp_pips: tpPips, tp_usd: tpUsd, sl_points: slPoints, sl_pips: slPips, sl_usd: slUsd, rr,
      pricing_ready: Boolean(tickSize && tickValueProfit && tickValueLoss), tick_size: tickSize, tick_value_profit: tickValueProfit, tick_value_loss: tickValueLoss },
    review: { status: order.review_status, source: order.review_source, reasons: Array.isArray(order.review_reasons) ? order.review_reasons : [] },
    lifecycle, shadow_status: shadowState.status ?? null,
    result: outcome ? { status: outcome.status ?? null, pnl_usd: num(outcome.pnl_usd), pnl_r: num(outcome.pnl_r), exit_price: num(outcome.exit_price), mfe_points: num(outcome.mfe_points), mae_points: num(outcome.mae_points) } : null,
    floating: floatingPoints === null ? null : { points: floatingPoints, pnl_r: floatingR, mark_price: current }
  };
}

app.get('/api/v1/status', async (_req, res) => {
  res.json({
    service: 'tradevice-2.0', phase: 'P0/P1', trading_mode: 'shadow', execution_enabled: false, ai_decision_enabled: aiWorkerEnabled(),
    ai_model: process.env.AI_MODEL || 'gpt-6-astra', shadow_lot: shadowLot, store: storeDriver(), symbol: process.env.TRADEVICE_SYMBOL || 'XAUUSD', execution_timeframe: 'M1',
    context_timeframes: ['M5', 'M15'], setup_families: ['TREND_PULLBACK', 'BREAKOUT_RETEST', 'LIQUIDITY_SWEEP'],
    review_agent: { enabled: true, source: 'POLICY_AGENT', min_confidence: Number(process.env.REVIEW_MIN_CONFIDENCE || 0.55) }
  });
});

app.get('/api/v1/dashboard', async (_req, res, next) => {
  try {
    const snapshot = await getLatestSnapshot(process.env.TRADEVICE_SYMBOL || 'XAUUSD');
    const performance = await performanceSummary(100);
    const lastCandle = snapshot?.candles?.[snapshot.candles.length - 1] ?? null;
    const snapshotMs = snapshot?.timestamp ? Date.parse(snapshot.timestamp) : NaN;
    const ageSeconds = Number.isFinite(snapshotMs) ? Math.max(0, Math.floor((Date.now() - snapshotMs) / 1000)) : null;
    const feedState = !snapshot ? 'WAITING' : ageSeconds !== null && ageSeconds <= feedStaleAfterSeconds ? 'CONNECTED' : 'STALE';
    res.json({
      generated_at: new Date().toISOString(), feed: { state: feedState, stale_after_seconds: feedStaleAfterSeconds, age_seconds: ageSeconds },
      market: snapshot ? { symbol: snapshot.symbol, timeframe: snapshot.timeframe, timestamp: snapshot.timestamp, bid: snapshot.bid ?? null, ask: snapshot.ask ?? null,
        spread_points: snapshot.spread_points ?? null, last_close: lastCandle?.close ?? null, bridge_version: snapshot.features?.bridge_version ?? null, terminal_build: snapshot.features?.terminal_build ?? null } : null,
      performance: { sample_size: performance.sample_size ?? 0, closed_trades: performance.closed_trades ?? 0, wins: performance.wins ?? 0, losses: performance.losses ?? 0,
        win_rate: performance.win_rate ?? null, expectancy_r: performance.expectancy_r ?? null, profit_factor: performance.profit_factor ?? null }
    });
  } catch (err) { next(err); }
});

app.get('/api/v1/orders/ledger', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 500);
    const [decisions, snapshot] = await Promise.all([getRecentDecisions(limit), getLatestSnapshot(process.env.TRADEVICE_SYMBOL || 'XAUUSD')]);
    const orders = decisions.filter(row => row.decision === 'PLACE_PENDING').map(row => ledgerRecord(row, snapshot));
    const analyses = decisions.map(row => ({
      trade_id: row.trade_id, created_at: row.created_at, decision: row.decision, side: row.side ?? null, order_type: row.order_type ?? null,
      setup: row.setup ?? null, regime: row.regime ?? null, confidence: num(row.confidence), reason_codes: Array.isArray(row.reason_codes) ? row.reason_codes : [],
      source: row.context?.ai_generated === true ? 'AI' : row.review_source === 'PREFILTER' ? 'PREFILTER' : 'SYSTEM', model: row.context?.ai_model ?? null,
      market_timestamp: row.context?.market_timestamp ?? null, trigger_codes: Array.isArray(row.context?.prefilter?.trigger_codes) ? row.context.prefilter.trigger_codes : [],
      prefilter_reasons: Array.isArray(row.context?.prefilter?.reasons) ? row.context.prefilter.reasons : [], thesis: row.context?.thesis ?? null, invalidation: row.context?.invalidation ?? null,
      risk: row.context?.risk_review ? { approved: row.context.risk_review.approved ?? null, reasons: Array.isArray(row.context.risk_review.reasons) ? row.context.risk_review.reasons : [] } : null,
      review: { status: row.review_status, source: row.review_source, reasons: Array.isArray(row.review_reasons) ? row.review_reasons : [] },
      market: row.context?.market_features ? { session: row.context.market_features.session?.label ?? null, trend_alignment: row.context.market_features.trend_alignment ?? null,
        volatility: row.context.market_features.volatility ?? null, spread_points: row.context.market_features.spread_points ?? null, range_atr_ratio: row.context.market_features.range_atr_ratio ?? null } : null,
      pipeline_versions: row.context?.pipeline_versions ?? null
    }));
    res.json({ generated_at: new Date().toISOString(), execution_enabled: false, mode: 'shadow', shadow_lot: shadowLot, analyses, orders });
  } catch (err) { next(err); }
});

app.post('/api/v1/market/snapshots', requireKey, async (req, res, next) => {
  try {
    const snapshot = Snapshot.parse(req.body);
    await saveSnapshot(snapshot);
    const shadow = await evaluateShadowSnapshot(snapshot);
    const aiScheduled = aiWorkerEnabled() && snapshot.timeframe === 'M1';
    res.status(202).json({ accepted: true, symbol: snapshot.symbol, timestamp: snapshot.timestamp, shadow_simulation: shadow, ai_decision_scheduled: aiScheduled });
    if (aiScheduled) setImmediate(() => { runAiDecision(snapshot).then(result => console.log('Tradevice AI decision:', JSON.stringify(result))).catch(error => console.error('Tradevice AI decision failed:', error)); });
  } catch (err) { next(err); }
});

app.get('/api/v1/market/latest', requireKey, async (req, res, next) => {
  try { res.json(await getLatestSnapshot(String(req.query.symbol || 'XAUUSD'))); } catch (err) { next(err); }
});

app.post('/api/v1/decisions/shadow', requireKey, async (req, res, next) => {
  try {
    const decision = Decision.parse(req.body);
    const snapshot = await getLatestSnapshot('XAUUSD');
    const risk = validateTradeIntent(decision, snapshot);
    const review = reviewPendingDecision(decision, risk);
    const saved = { ...decision, mode: 'shadow', review, context: { ...decision.context, risk_review: risk, review_agent: review } };
    await saveDecision(saved);
    res.status(202).json({ accepted: true, execution_enabled: false, risk_approved: risk.approved, risk_reasons: risk.reasons, review_status: review.status, review_reasons: review.reasons, trade_id: decision.trade_id });
  } catch (err) { next(err); }
});

app.post('/api/v1/decisions/:tradeId/outcome', requireKey, async (req, res, next) => {
  try {
    const outcome = Outcome.parse(req.body);
    const updated = await recordOutcome(req.params.tradeId, outcome);
    if (!updated) return res.status(404).json({ error: 'trade_id_not_found' });
    res.status(202).json({ accepted: true, trade_id: req.params.tradeId, outcome });
  } catch (err) { next(err); }
});

app.get('/api/v1/decisions/recent', requireKey, async (req, res, next) => {
  try { res.json(await getRecentDecisions(Number(req.query.limit || 100))); } catch (err) { next(err); }
});

app.get('/api/v1/performance/summary', requireKey, async (req, res, next) => {
  try { res.json(await performanceSummary(Number(req.query.limit || 100))); } catch (err) { next(err); }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err?.name === 'ZodError') return res.status(400).json({ error: 'validation_error', issues: err.issues });
  res.status(500).json({ error: 'internal_error' });
});

const store = await initStore();
await initDemoExecution();
const listen = p => app.listen(p, '0.0.0.0', () => console.log(`Tradevice 2.0 listening on :${p}; store=${store.driver}; mode=shadow`));
listen(port);
if (publicTargetPort !== port) listen(publicTargetPort);
