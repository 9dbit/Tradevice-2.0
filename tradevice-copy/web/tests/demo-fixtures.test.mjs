import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateDemo, demoAccount, demoTrades, demoStrategies, formatDemoMoney } from '../lib/demo-fixtures.mjs';

test('one isolated demo account only', () => {
  assert.equal(demoAccount.username, 'admin');
  assert.equal(demoAccount.environment, 'SIMULATED');
  assert.equal(demoAccount.initialEquity, 1000);
  assert.equal(demoAccount.broker, 'Tradevice Paper Simulator');
});
test('sample trades compute consistent summary', () => {
  const result = calculateDemo();
  assert.equal(result.startingEquity, 1000);
  assert.equal(result.equity, 1112.4);
  assert.equal(result.netPnl, 112.4);
  assert.equal(result.total, 12);
  assert.equal(result.wins, 8);
  assert.equal(result.losses, 4);
  assert.equal(result.curve.length, result.total + 1);
  assert.ok(Math.abs(result.winRatePct - (8 / 12) * 100) < 0.0001);
  assert.ok(result.maxDrawdownPct > 1 && result.maxDrawdownPct < 1.1);
  assert.equal(result.curve.at(-1).equity, result.equity);
});
test('sample strategy data is research only', () => {
  assert.equal(demoStrategies.length, 3);
  assert.ok(demoStrategies.every(row => row.status === 'Research only'));
});
test('input validation and stable zero-trade metrics', () => {
  const noTrades = calculateDemo([], 1000);
  assert.equal(noTrades.netPnl, 0);
  assert.equal(noTrades.total, 0);
  assert.equal(noTrades.winRatePct, 0);
  assert.equal(noTrades.maxDrawdownPct, 0);
  assert.equal(noTrades.curve.length, 1);
  assert.throws(() => calculateDemo([], 0));
  assert.throws(() => calculateDemo([{pnl:Number.NaN}], 1000));
  assert.throws(() => formatDemoMoney(Number.NaN));
});
test('currency labels preserve gain/loss signs', () => {
  assert.equal(formatDemoMoney(112.4), '+$112.40');
  assert.equal(formatDemoMoney(-9.2), '-$9.20');
  assert.equal(formatDemoMoney(0), '$0.00');
});
test('demo page does not request Supabase or production APIs', () => {
  const source = readFileSync(new URL('../app/demo/page.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes("from '../../lib/demo-fixtures.mjs'"));
  assert.ok(source.includes("username.trim().toLowerCase() === 'admin'"));
  assert.ok(source.includes("password === 'admin'"));
  assert.doesNotMatch(source, /createClient|service_role|auth\.signIn|\/api\/member|\/api\/v1|\/rest\/v1/);
  assert.match(source, /DATA SINTETIS/);
  assert.match(source, /No live trading/);
  assert.match(source, /sessionStorage/);
});
test('dummy funding and copy controls stay disabled', () => {
  const source = readFileSync(new URL('../app/demo/page.tsx', import.meta.url), 'utf8');
  assert.match(source, /Deposit dinonaktifkan/);
  assert.match(source, /Withdrawal dinonaktifkan/);
  assert.match(source, /Copy trading live dinonaktifkan/);
});
test('mobile CSS has safe area and real bottom navigation', () => {
  const source = readFileSync(new URL('../app/demo/demo.css', import.meta.url), 'utf8');
  assert.match(source, /safe-area-inset-bottom/);
  assert.match(source, /@media\(max-width:860px\)/);
  assert.match(source, /position:fixed/);
  assert.match(source, /grid-template-columns:repeat\(5/);
});
