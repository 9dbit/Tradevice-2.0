export interface DemoAccount {
  id: string;
  username: string;
  displayName: string;
  broker: string;
  environment: string;
  currency: string;
  initialEquity: number;
}
export interface DemoTrade {
  id: string;
  date: string;
  symbol: string;
  side: string;
  pnl: number;
  r: number;
  status: string;
}
export interface DemoStrategy {
  code: string;
  symbol: string;
  style: string;
  risk: string;
  status: string;
}
export interface DemoOverview {
  equity: number;
  netPnl: number;
  startingEquity: number;
  returnPct: number;
  winRatePct: number;
  maxDrawdownPct: number;
  wins: number;
  losses: number;
  total: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  curve: Array<{ label: string; equity: number }>;
}
export const demoAccount: Readonly<DemoAccount>;
export const demoTrades: ReadonlyArray<DemoTrade>;
export const demoStrategies: ReadonlyArray<DemoStrategy>;
export function calculateDemo(trades?: ReadonlyArray<DemoTrade>, startingEquity?: number): DemoOverview;
export function formatDemoMoney(value: number): string;
