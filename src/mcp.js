import * as z from 'zod/v4';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import {
  getLatestSnapshot,
  getRecentDecisions,
  performanceSummary,
  saveDecision
} from './store.js';

const ShadowDecisionSchema = z.object({
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

function buildServer() {
  const server = new McpServer({ name: 'tradevice-2.0', version: '0.1.0' }, { capabilities: { tools: {} } });

  server.registerTool(
    'get_market_snapshot',
    {
      description: 'Get the latest XAUUSD market snapshot received from the MT5 bridge.',
      inputSchema: z.object({ symbol: z.string().default('XAUUSD') })
    },
    async ({ symbol }) => {
      const data = await getLatestSnapshot(symbol);
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
  );

  server.registerTool(
    'get_recent_decisions',
    {
      description: 'Read recent shadow trade decisions and their outcomes for research.',
      inputSchema: z.object({ limit: z.number().int().min(1).max(500).default(100) })
    },
    async ({ limit }) => {
      const data = await getRecentDecisions(limit);
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
  );

  server.registerTool(
    'get_performance_summary',
    {
      description: 'Summarize recent shadow-trading performance. This is research output, not a profitability guarantee.',
      inputSchema: z.object({ limit: z.number().int().min(1).max(500).default(100) })
    },
    async ({ limit }) => {
      const data = await performanceSummary(limit);
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
  );

  server.registerTool(
    'submit_shadow_decision',
    {
      description: 'Journal an AI trade decision in SHADOW mode only. This tool cannot place an MT5 order.',
      inputSchema: ShadowDecisionSchema
    },
    async input => {
      const decision = ShadowDecisionSchema.parse(input);
      const saved = await saveDecision({ ...decision, mode: 'shadow' });
      return {
        content: [{ type: 'text', text: JSON.stringify({ accepted: true, execution_enabled: false, decision: saved }) }]
      };
    }
  );

  return server;
}

const webHandler = createMcpHandler(buildServer);
export const mcpNodeHandler = toNodeHandler(webHandler);
