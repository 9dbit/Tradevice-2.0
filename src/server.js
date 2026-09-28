import express from 'express';
import { z } from 'zod/v4';
import { initStore, storeDriver, saveSnapshot, getLatestSnapshot, getRecentDecisions, performanceSummary, saveDecision, recordOutcome } from './store.js';
import { mcpNodeHandler } from './mcp.js';
import { validateTradeIntent } from './risk.js';
import { evaluateShadowSnapshot } from './shadow-simulator.js';
import { aiWorkerEnabled, runAiDecision } from './ai-worker.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const publicTargetPort = Number(process.env.PUBLIC_TARGET_PORT || 3000);
const apiKey = process.env.TRADEVICE_API_KEY || '';

function requireKey(req, res, next) {
  if (!apiKey) return next();
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${apiKey}`) return res.status(401).json({ error: 'unauthorized' });
  next();
}

app.use(express.static('public'));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'tradevice-2.0', mode: 'shadow', store: storeDriver() }));
app.get('/api/v1/info', (_req, res) => res.json({
  name: 'Tradevice 2.0',
  phase: 'P0/P1 Observer + Shadow AI',
  execution_enabled: false,
  endpoints: { health: '/health', mcp: '/mcp', status: '/api/v1/status' }
}));

// MCP is mounted before express.json() so the MCP HTTP handler owns its request stream.
app.all('/mcp', requireKey, mcpNodeHandler);

app.use(express.json({ limit: '1mb' }));

const Candle = z.object({
  timestamp: z.string(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  tick_volume: z.number().optional()
});

const Snapshot = z.object({
  symbol: z.string().default('XAUUSD'),
  timeframe: z.enum(['M1', 'M5', 'M15']).default('M1'),
  timestamp: z.string(),
  bid: z.number().optional(),
  ask: z.number().optional(),
  spread_points: z.number().nonnegative().optional(),
  candles: z.array(Candle).min(1).max(120),
  account: z.record(z.string(), z.unknown()).optional(),
  features: z.record(z.string(), z.unknown()).optional()
});

const Decision = z.object({
  trade_id: z.string().min(3),
  decision: z.enum(['WAIT', 'PLACE_PENDING', 'CANCEL']),
  side: z.enum(['BUY', 'SELL']).optional(),
  order_type: z.enum(['BUY_LIMIT', 'SELL_LIMIT', 'BUY_STOP', 'SELL_STOP']).optional(),
  setup: z.enum(['TREND_PULLBACK', 'BREAKOUT_RETEST', 'LIQUIDITY_SWEEP']).optional(),
  regime: z.enum(['TREND_UP', 'TREND_DOWN', 'RANGE', 'BREAKOUT', 'HIGH_VOLATILITY', 'CHAOTIC', 'NO_TRADE']),
  entry: z.number().optional(),
  stop_loss: z.number().optional(),
  take_profit: z.number().optional(),
  expiration_candles: z.number().int().min(1).max(10).optional(),
  confidence: z.number().min(0).max(1).optional(),
  reason_codes: z.array(z.string()).max(12).default([]),
  context: z.record(z.string(), z.unknown()).default({})
});

const Outcome = z.object({
  status: z.enum(['TP', 'SL', 'EXPIRED', 'CANCELLED', 'CLOSED']),
  exit_price: z.number().optional(),
  pnl_usd: z.number().optional(),
  pnl_r: z.number().optional(),
  mfe_points: z.number().nonnegative().optional(),
  mae_points: z.number().nonnegative().optional(),
  duration_seconds: z.number().int().nonnegative().optional(),
  closed_at: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional()
});

app.get('/api/v1/status', async (_req, res) => {
  res.json({
    service: 'tradevice-2.0',
    phase: 'P0/P1',
    trading_mode: 'shadow',
    execution_enabled: false,
    ai_decision_enabled: aiWorkerEnabled(),
    ai_model: process.env.AI_MODEL || 'gpt-6-astra',
    store: storeDriver(),
    symbol: 'XAUUSD',
    execution_timeframe: 'M1',
    context_timeframes: ['M5', 'M15'],
    setup_families: ['TREND_PULLBACK', 'BREAKOUT_RETEST', 'LIQUIDITY_SWEEP']
  });
});

app.get('/api/v1/dashboard', async (_req, res, next) => {
  try {
    const snapshot = await getLatestSnapshot('XAUUSD');
    const performance = await performanceSummary(100);
    const lastCandle = snapshot?.candles?.[snapshot.candles.length - 1] ?? null;
    res.json({
      market: snapshot ? {
        symbol: snapshot.symbol,
        timeframe: snapshot.timeframe,
        timestamp: snapshot.timestamp,
        bid: snapshot.bid ?? null,
        ask: snapshot.ask ?? null,
        spread_points: snapshot.spread_points ?? null,
        last_close: lastCandle?.close ?? null
      } : null,
      performance
    });
  } catch (err) { next(err); }
});

app.post('/api/v1/market/snapshots', requireKey, async (req, res, next) => {
  try {
    const snapshot = Snapshot.parse(req.body);
    await saveSnapshot(snapshot);
    const shadow = await evaluateShadowSnapshot(snapshot);
    const aiScheduled = aiWorkerEnabled() && snapshot.timeframe === 'M1';

    res.status(202).json({
      accepted: true,
      symbol: snapshot.symbol,
      timestamp: snapshot.timestamp,
      shadow_simulation: shadow,
      ai_decision_scheduled: aiScheduled
    });

    if (aiScheduled) {
      setImmediate(() => {
        runAiDecision(snapshot)
          .then(result => console.log('Tradevice AI decision:', JSON.stringify(result)))
          .catch(error => console.error('Tradevice AI decision failed:', error));
      });
    }
  } catch (err) { next(err); }
});

app.get('/api/v1/market/latest', requireKey, async (req, res, next) => {
  try { res.json(await getLatestSnapshot(String(req.query.symbol || 'XAUUSD'))); }
  catch (err) { next(err); }
});

app.post('/api/v1/decisions/shadow', requireKey, async (req, res, next) => {
  try {
    const decision = Decision.parse(req.body);
    const snapshot = await getLatestSnapshot('XAUUSD');
    const risk = validateTradeIntent(decision, snapshot);
    const saved = {
      ...decision,
      mode: 'shadow',
      context: { ...decision.context, risk_review: risk }
    };
    await saveDecision(saved);
    res.status(202).json({
      accepted: true,
      execution_enabled: false,
      risk_approved: risk.approved,
      risk_reasons: risk.reasons,
      trade_id: decision.trade_id
    });
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
  try { res.json(await getRecentDecisions(Number(req.query.limit || 100))); }
  catch (err) { next(err); }
});

app.get('/api/v1/performance/summary', requireKey, async (req, res, next) => {
  try { res.json(await performanceSummary(Number(req.query.limit || 100))); }
  catch (err) { next(err); }
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
