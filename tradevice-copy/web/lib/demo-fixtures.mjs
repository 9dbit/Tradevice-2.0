/**
 * Illustrative, synthetic dataset for the public read-only Tradevice demo.
 * This module has no database, API client, Supabase session, or broker hooks.
 * NEVER reuse these figures as a real member performance record.
 */
export const demoAccount = Object.freeze({
  id: 'DEMO-PAPER-0001',
  username: 'admin',
  displayName: 'Admin Demo',
  broker: 'Tradevice Paper Simulator',
  environment: 'SIMULATED',
  currency: 'USD',
  initialEquity: 1000,
});

export const demoTrades = Object.freeze([
  { id: 'SIM-001', date: '28 Sep', symbol: 'XAUUSD', side: 'BUY', pnl: 18.40, r: 1.84, status: 'CLOSED_SIMULATED' },
  { id: 'SIM-002', date: '29 Sep', symbol: 'XAUUSD', side: 'SELL', pnl: -9.20, r: -0.92, status: 'CLOSED_SIMULATED' },
  { id: 'SIM-003', date: '30 Sep', symbol: 'XAUUSD', side: 'BUY', pnl: 24.60, r: 2.46, status: 'CLOSED_SIMULATED' },
  { id: 'SIM-004', date: '01 Okt', symbol: 'XAUUSD', side: 'BUY', pnl: 12.30, r: 1.23, status: 'CLOSED_SIMULATED' },
  { id: 'SIM-005', date: '02 Okt', symbol: 'XAUUSD', side: 'SELL', pnl: -8.70, r: -0.87, status: 'CLOSED_SIMULATED' },
  { id: 'SIM-006', date: '03 Okt', symbol: 'XAUUSD', side: 'BUY', pnl: 17.50, r: 1.75, status: 'CLOSED_SIMULATED' },
  { id: 'SIM-007', date: '05 Okt', symbol: 'XAUUSD', side: 'BUY', pnl: 29.00, r: 2.90, status: 'CLOSED_SIMULATED' },
  { id: 'SIM-008', date: '06 Okt', symbol: 'XAUUSD', side: 'SELL', pnl: -11.80, r: -1.18, status: 'CLOSED_SIMULATED' },
  { id: 'SIM-009', date: '07 Okt', symbol: 'XAUUSD', side: 'BUY', pnl: 15.90, r: 1.59, status: 'CLOSED_SIMULATED' },
  { id: 'SIM-010', date: '08 Okt', symbol: 'XAUUSD', side: 'SELL', pnl: -7.40, r: -0.74, status: 'CLOSED_SIMULATED' },
  { id: 'SIM-011', date: '09 Okt', symbol: 'XAUUSD', side: 'BUY', pnl: 21.10, r: 2.11, status: 'CLOSED_SIMULATED' },
  { id: 'SIM-012', date: '10 Okt', symbol: 'XAUUSD', side: 'BUY', pnl: 10.70, r: 1.07, status: 'CLOSED_SIMULATED' },
]);

export const demoStrategies = Object.freeze([
  { code: 'TV MOMENTUM', symbol: 'XAUUSD', style: 'Swing / intraday', risk: '0.25%', status: 'Research only' },
  { code: 'TV SCALPING', symbol: 'XAUUSD', style: 'Session breakout', risk: '0.20%', status: 'Research only' },
  { code: 'TV AI CORE', symbol: 'XAUUSD', style: 'Signal laboratory', risk: '0.15%', status: 'Research only' },
]);

export function calculateDemo(trades = demoTrades, startingEquity = 1000) {
  if (!Number.isFinite(startingEquity) || startingEquity <= 0 || !Array.isArray(trades)) {
    throw new Error('Invalid demo inputs');
  }
  let equity = startingEquity;
  let peak = startingEquity;
  let maximumDrawdownPct = 0;
  let wins = 0;
  let losses = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  const curve = [{ label: 'Awal', equity: startingEquity }];
  for (const trade of trades) {
    if (!trade || !Number.isFinite(trade.pnl)) throw new Error('Invalid synthetic trade');
    equity = Math.round((equity + trade.pnl) * 100) / 100;
    if (trade.pnl > 0) { wins++; grossProfit += trade.pnl; }
    if (trade.pnl < 0) { losses++; grossLoss += Math.abs(trade.pnl); }
    peak = Math.max(peak, equity);
    maximumDrawdownPct = Math.max(maximumDrawdownPct, ((peak - equity) / peak) * 100);
    curve.push({ label: trade.date, equity });
  }
  const netPnl = Math.round((equity - startingEquity) * 100) / 100;
  const total = trades.length;
  return {
    equity, netPnl, startingEquity,
    returnPct: (netPnl / startingEquity) * 100,
    winRatePct: total ? (wins / total) * 100 : 0,
    maxDrawdownPct: maximumDrawdownPct,
    wins, losses, total,
    grossProfit: Math.round(grossProfit * 100) / 100,
    grossLoss: Math.round(grossLoss * 100) / 100,
    profitFactor: grossLoss ? grossProfit / grossLoss : null,
    curve,
  };
}

export function formatDemoMoney(value) {
  if (!Number.isFinite(value)) throw new Error('Invalid demo money');
  const sign = value < 0 ? '-' : value > 0 ? '+' : '';
  return sign + '$' + Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
