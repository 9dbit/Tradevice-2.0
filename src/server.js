import express from 'express';
import fs from 'fs';
import path from 'path';
import { z } from 'zod/v4';
import { initStore, storeDriver, saveSnapshot, getLatestSnapshot, getRecentDecisions, performanceSummary, saveDecision, recordOutcome, listPlanCandidates, getRuntimeSetting, setRuntimeSetting } from './store.js';
import { mcpNodeHandler } from './mcp.js';
import { validateTradeIntent } from './risk.js';
import { reviewPendingDecision } from './review-agent.js';
import { evaluateShadowSnapshot } from './shadow-simulator.js';
import { aiWorkerEnabled, runAiDecision } from './ai-worker.js';
import { activatePlanCandidate, rejectPlanCandidate } from './plan-service.js';
import { mergeBrokerState, brokerStateView, brokerPerformance } from './broker-state.js';
import { buildOrderPreview } from './order-preview.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const publicTargetPort = Number(process.env.PUBLIC_TARGET_PORT || 3000);
const apiKey = process.env.TRADEVICE_API_KEY || '';
const feedStaleAfterSeconds = Number(process.env.FEED_STALE_AFTER_SECONDS || 180);
const shadowLot = Number(process.env.SHADOW_LOT || 0.01);
const approvalKey = String(process.env.TRADEVICE_APPROVAL_KEY || '').trim();

function requireKey(req, res, next) {
  if (!apiKey) return next();
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${apiKey}`) return res.status(401).json({ error: 'unauthorized' });
  next();
}

function requireApprovalKey(req, res, next) {
  if (!approvalKey) return res.status(503).json({ error: 'approval_key_not_configured' });
  if (String(req.headers['x-approval-key'] || '').trim() !== approvalKey) return res.status(401).json({ error: 'approval_unauthorized' });
  next();
}

app.get('/', async (_req, res, next) => {
  try {
    const source = await fs.promises.readFile(path.resolve('public/index.html'), 'utf8');
    res.type('html').send(source.replace('</body>', '<script src="/order-ledger.js"></script></body>'));
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
  decision_confidence: z.number().min(0).max(1).optional(), entry_confidence: z.number().min(0).max(1).optional(),
  reason_codes: z.array(z.string()).max(12).default([]), context: z.record(z.string(), z.unknown()).default({})
});

const Outcome = z.object({
  status: z.enum(['TP', 'SL', 'EXPIRED', 'CANCELLED', 'CLOSED']), exit_price: z.number().optional(), pnl_usd: z.number().optional(), pnl_r: z.number().optional(),
  mfe_points: z.number().nonnegative().optional(), mae_points: z.number().nonnegative().optional(), duration_seconds: z.number().int().nonnegative().optional(),
  closed_at: z.string().optional(), meta: z.record(z.string(), z.unknown()).optional()
});

const BrokerObject = z.record(z.string(), z.unknown());
const BrokerSync = z.object({
  timestamp: z.string(), bridge_version: z.string().optional(), broker_symbol: z.string().optional(),
  account: BrokerObject, positions: z.array(BrokerObject).default([]), orders: z.array(BrokerObject).default([]),
  history_deals: z.array(BrokerObject).optional(), features: BrokerObject.optional()
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
    decision_confidence: num(order.context?.decision_confidence ?? order.confidence),
    entry_confidence: num(order.context?.entry_confidence),
    plan: { lot, point_size: point, pip_size: pipSize, tp_points: tpPoints, tp_pips: tpPips, tp_usd: tpUsd, sl_points: slPoints, sl_pips: slPips, sl_usd: slUsd, rr,
      pricing_ready: Boolean(tickSize && tickValueProfit && tickValueLoss), tick_size: tickSize, tick_value_profit: tickValueProfit, tick_value_loss: tickValueLoss },
    review: { status: order.review_status, source: order.review_source, reasons: Array.isArray(order.review_reasons) ? order.review_reasons : [] },
    lifecycle, shadow_status: shadowState.status ?? null,
    result: outcome ? { status: outcome.status ?? null, pnl_usd: num(outcome.pnl_usd), pnl_r: num(outcome.pnl_r), exit_price: num(outcome.exit_price), mfe_points: num(outcome.mfe_points), mae_points: num(outcome.mae_points) } : null,
    floating: floatingPoints === null ? null : { points: floatingPoints, pnl_r: floatingR, mark_price: current }
  };
}

function planRecord(plan, snapshot, linkedDecision = null) {
  const entry = num(plan.entry);
  const sl = num(plan.stop_loss);
  const tp = num(plan.take_profit);
  const point = num(snapshot?.features?.point_size) || 0.001;
  const digits = Number(snapshot?.features?.digits ?? 3);
  const pipSize = (digits === 3 || digits === 5) ? point * 10 : point;
  const tickSize = num(snapshot?.features?.tick_size);
  const tickValueProfit = num(snapshot?.features?.tick_value_profit) ?? num(snapshot?.features?.tick_value);
  const tickValueLoss = num(snapshot?.features?.tick_value_loss) ?? num(snapshot?.features?.tick_value);
  const tpDistance = entry !== null && tp !== null ? Math.abs(tp - entry) : null;
  const slDistance = entry !== null && sl !== null ? Math.abs(entry - sl) : null;
  const planView = {
    lot: shadowLot,
    tp_points: tpDistance !== null ? tpDistance / point : null,
    tp_pips: tpDistance !== null ? tpDistance / pipSize : null,
    tp_usd: tpDistance !== null && tickSize && tickValueProfit ? tpDistance / tickSize * tickValueProfit * shadowLot : null,
    sl_points: slDistance !== null ? slDistance / point : null,
    sl_pips: slDistance !== null ? slDistance / pipSize : null,
    sl_usd: slDistance !== null && tickSize && tickValueLoss ? slDistance / tickSize * tickValueLoss * shadowLot : null,
    rr: slDistance && tpDistance !== null ? tpDistance / slDistance : null
  };
  const linked = linkedDecision ? ledgerRecord(linkedDecision, snapshot) : null;
  return {
    plan_id: plan.plan_id, group_id: plan.group_id, symbol: plan.symbol, market_timestamp: plan.market_timestamp,
    side: plan.side, order_type: plan.order_type, setup: plan.setup, regime: plan.regime,
    entry, stop_loss: sl, take_profit: tp, expiration_candles: plan.expiration_candles,
    decision_confidence: num(plan.decision_confidence), entry_confidence: num(plan.entry_confidence),
    reason_codes: Array.isArray(plan.reason_codes) ? plan.reason_codes : [], thesis: plan.thesis, invalidation: plan.invalidation,
    status: plan.status, review: plan.review ?? {}, source_model: plan.source_model, linked_trade_id: plan.linked_trade_id,
    created_at: plan.created_at, updated_at: plan.updated_at, approved_at: plan.approved_at, rejected_at: plan.rejected_at,
    plan: planView, execution: linked ? { lifecycle: linked.lifecycle, floating: linked.floating, result: linked.result } : null
  };
}

app.get('/api/v1/status', async (_req, res) => {
  const approvalMode = await getRuntimeSetting('approval_mode', 'manual');
  res.json({
    service: 'tradevice-2.0', phase: 'P0/P1', trading_mode: 'shadow', execution_enabled: false, ai_decision_enabled: aiWorkerEnabled(),
    ai_model: process.env.AI_MODEL || 'gpt-6-astra', shadow_lot: shadowLot, store: storeDriver(), symbol: process.env.TRADEVICE_SYMBOL || 'XAUUSD', execution_timeframe: 'M1',
    context_timeframes: ['M5', 'M15'], setup_families: ['TREND_PULLBACK', 'BREAKOUT_RETEST', 'LIQUIDITY_SWEEP'],
    approval_mode: approvalMode, approval_key_configured: Boolean(approvalKey),
    review_agent: { enabled: true, source: 'POLICY_AGENT', min_entry_confidence: Number(process.env.REVIEW_MIN_ENTRY_CONFIDENCE || process.env.ENTRY_PENDING_THRESHOLD || 0.80) }
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
      account: snapshot?.account ? {
        balance: num(snapshot.account.balance), equity: num(snapshot.account.equity), free_margin: num(snapshot.account.margin_free),
        floating_pnl: num(snapshot.account.equity) !== null && num(snapshot.account.balance) !== null ? num(snapshot.account.equity) - num(snapshot.account.balance) : null,
        positions_total: Number(snapshot.account.positions_total ?? 0), orders_total: Number(snapshot.account.orders_total ?? 0)
      } : null,
      performance: { sample_size: performance.sample_size ?? 0, closed_trades: performance.closed_trades ?? 0, wins: performance.wins ?? 0, losses: performance.losses ?? 0,
        win_rate: performance.win_rate ?? null, expectancy_r: performance.expectancy_r ?? null, profit_factor: performance.profit_factor ?? null }
    });
  } catch (err) { next(err); }
});

app.post('/api/v1/broker/sync', requireKey, async (req, res, next) => {
  try {
    const incoming = BrokerSync.parse(req.body);
    const previous = await getRuntimeSetting('broker_state', null);
    const merged = mergeBrokerState(previous, incoming);
    await setRuntimeSetting('broker_state', merged);
    res.status(202).json({ accepted: true, source: 'MT5', timestamp: merged.timestamp, positions: merged.positions.length, orders: merged.orders.length, history_deals: merged.history_deals.length });
  } catch (err) { next(err); }
});

app.get('/api/v1/broker/state', async (_req, res, next) => {
  try {
    const state = await getRuntimeSetting('broker_state', null);
    if (!state) return res.status(404).json({ error: 'broker_state_not_available' });
    res.json(brokerStateView(state));
  } catch (err) { next(err); }
});

app.get('/api/v1/broker/performance', async (req, res, next) => {
  try {
    const state = await getRuntimeSetting('broker_state', null);
    if (!state) return res.status(404).json({ error: 'broker_state_not_available' });
    const period = String(req.query.period || 'D').toUpperCase();
    const offset = Number(process.env.TRADEVICE_TIMEZONE_OFFSET_MINUTES || 420);
    res.json(brokerPerformance(state, period, offset));
  } catch (err) { next(err); }
});

app.get('/api/v1/order-preview', async (_req, res, next) => {
  try {
    const [decisions, snapshot, brokerState] = await Promise.all([
      getRecentDecisions(100),
      getLatestSnapshot(process.env.TRADEVICE_SYMBOL || 'XAUUSD'),
      getRuntimeSetting('broker_state', null)
    ]);
    res.json({ generated_at: new Date().toISOString(), ...buildOrderPreview(decisions, snapshot, brokerState) });
  } catch (err) { next(err); }
});

app.get('/api/v1/orders/ledger', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 500);
    const [decisions, snapshot] = await Promise.all([getRecentDecisions(limit), getLatestSnapshot(process.env.TRADEVICE_SYMBOL || 'XAUUSD')]);
    const orders = decisions.filter(row => row.decision === 'PLACE_PENDING').map(row => ledgerRecord(row, snapshot));
    const analyses = decisions.map(row => ({
      trade_id: row.trade_id, created_at: row.created_at, decision: row.decision, side: row.side ?? null, order_type: row.order_type ?? null,
      setup: row.setup ?? null, regime: row.regime ?? null, confidence: num(row.confidence),
      decision_confidence: num(row.context?.decision_confidence ?? row.confidence),
      entry_confidence: num(row.context?.entry_confidence),
      entry_pending_threshold: num(row.context?.entry_pending_threshold) ?? Number(process.env.ENTRY_PENDING_THRESHOLD || 0.80),
      reason_codes: Array.isArray(row.reason_codes) ? row.reason_codes : [],
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

app.get('/api/v1/settings/approval-mode', async (_req, res, next) => {
  try {
    const mode = await getRuntimeSetting('approval_mode', 'manual');
    res.json({ mode, approval_key_configured: Boolean(approvalKey), auto_threshold: Number(process.env.ENTRY_PENDING_THRESHOLD || 0.80) });
  } catch (err) { next(err); }
});

app.post('/api/v1/approval/verify', requireApprovalKey, (_req, res) => res.status(204).end());

app.post('/api/v1/settings/approval-mode', requireApprovalKey, async (req, res, next) => {
  try {
    const mode = String(req.body?.mode || '').toLowerCase();
    if (!['manual','ai'].includes(mode)) return res.status(400).json({ error: 'invalid_approval_mode' });
    await setRuntimeSetting('approval_mode', mode);
    res.json({ ok: true, mode, applies_to: 'new_candidate_cycles' });
  } catch (err) { next(err); }
});

app.get('/api/v1/plans', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 100);
    const [plans, snapshot, decisions, approvalMode] = await Promise.all([
      listPlanCandidates(limit), getLatestSnapshot(process.env.TRADEVICE_SYMBOL || 'XAUUSD'), getRecentDecisions(500), getRuntimeSetting('approval_mode', 'manual')
    ]);
    const decisionMap = new Map(decisions.map(row => [row.trade_id, row]));
    res.json({
      generated_at: new Date().toISOString(), approval_mode: approvalMode,
      auto_threshold: Number(process.env.ENTRY_PENDING_THRESHOLD || 0.80), shadow_lot: shadowLot,
      plans: plans.map(plan => planRecord(plan, snapshot, plan.linked_trade_id ? decisionMap.get(plan.linked_trade_id) : null))
    });
  } catch (err) { next(err); }
});

app.post('/api/v1/plans/:planId/approve', requireApprovalKey, async (req, res, next) => {
  try {
    const mode = await getRuntimeSetting('approval_mode', 'manual');
    if (mode !== 'manual') return res.status(409).json({ error: 'manual_approval_disabled', mode });
    const result = await activatePlanCandidate(req.params.planId, 'MANUAL');
    res.status(result.ok ? 202 : 409).json(result);
  } catch (err) { next(err); }
});

app.post('/api/v1/plans/:planId/reject', requireApprovalKey, async (req, res, next) => {
  try {
    const mode = await getRuntimeSetting('approval_mode', 'manual');
    if (mode !== 'manual') return res.status(409).json({ error: 'manual_approval_disabled', mode });
    const result = await rejectPlanCandidate(req.params.planId, 'MANUAL');
    res.status(result.ok ? 202 : 409).json(result);
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
    const parsedDecision = Decision.parse(req.body);
    const decision = {
      ...parsedDecision,
      confidence: parsedDecision.confidence ?? parsedDecision.decision_confidence,
      entry_confidence: parsedDecision.entry_confidence ?? parsedDecision.confidence ?? parsedDecision.decision_confidence
    };
    const snapshot = await getLatestSnapshot('XAUUSD');
    const risk = validateTradeIntent(decision, snapshot);
    const review = reviewPendingDecision(decision, risk);
    const saved = {
      ...decision,
      mode: 'shadow',
      review,
      context: {
        ...decision.context,
        decision_confidence: parsedDecision.decision_confidence ?? decision.confidence ?? null,
        entry_confidence: decision.entry_confidence ?? null,
        entry_pending_threshold: Number(process.env.ENTRY_PENDING_THRESHOLD || 0.80),
        risk_review: risk,
        review_agent: review
      }
    };
    delete saved.decision_confidence;
    delete saved.entry_confidence;
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
const listen = p => app.listen(p, '0.0.0.0', () => console.log(`Tradevice 2.0 listening on :${p}; store=${store.driver}; mode=shadow`));
listen(port);
if (publicTargetPort !== port) listen(publicTargetPort);
