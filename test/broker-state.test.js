import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeBrokerState, brokerStateView, brokerPerformance } from '../src/broker-state.js';

test('broker sync preserves history when fast sync omits it', () => {
  const previous = { timestamp: '2026-09-29T00:00:00Z', history_deals: [{ ticket: '1', type: 'BUY' }], positions: [{ ticket: 'old' }] };
  const incoming = { timestamp: '2026-09-29T00:00:03Z', account: { balance: 1000 }, positions: [{ ticket: 'new' }], orders: [] };
  const merged = mergeBrokerState(previous, incoming);
  assert.equal(merged.positions[0].ticket, 'new');
  assert.equal(merged.history_deals[0].ticket, '1');
  assert.equal(merged.account.balance, 1000);
});

test('broker performance includes profit commission swap and fee', () => {
  const now = Date.now();
  const state = { history_deals: [
    { ticket: '1', type: 'BUY', entry: 'OUT', time_msc: now, profit: 10, commission: -1, swap: -0.5, fee: -0.25 },
    { ticket: '2', type: 'SELL', entry: 'OUT', time_msc: now, profit: -4, commission: -1, swap: 0, fee: 0 }
  ] };
  const p = brokerPerformance(state, 'D', 420);
  assert.equal(p.realized_net, 3.25);
  assert.equal(p.gross_profit, 6);
  assert.equal(p.commission, -2);
  assert.equal(p.swap, -0.5);
  assert.equal(p.fee, -0.25);
  assert.equal(p.closed_deals, 2);
  assert.equal(p.wins, 1);
  assert.equal(p.losses, 1);
});

test('public broker view omits private login and computes open net profit', () => {
  const view = brokerStateView({
    timestamp: new Date().toISOString(), received_at: new Date().toISOString(),
    account: { balance: 1000, equity: 1005, login: 123456, currency: 'USD' },
    positions: [{ ticket: '7', symbol: 'XAUUSD', side: 'BUY', profit: 6, swap: -1 }], orders: [], history_deals: []
  });
  assert.equal(view.account.balance, 1000);
  assert.equal(view.account.login, undefined);
  assert.equal(view.history_deals, undefined);
  assert.equal(view.history_deals_count, 0);
  assert.equal(view.positions[0].net_profit, 5);
});
