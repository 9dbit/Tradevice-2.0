import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const demo = readFileSync(new URL('../app/demo/page.tsx', import.meta.url), 'utf8');
const master = readFileSync(new URL('../app/master/master-console.tsx', import.meta.url), 'utf8');
const preview = readFileSync(new URL('../app/master/preview/page.tsx', import.meta.url), 'utf8');
const demoCss = readFileSync(new URL('../app/demo/demo.css', import.meta.url), 'utf8');

test('synthetic demo fixtures are removed from the production bundle', () => {
  assert.equal(existsSync(new URL('../lib/demo-fixtures.mjs', import.meta.url)), false);
  assert.equal(existsSync(new URL('../lib/demo-fixtures.d.mts', import.meta.url)), false);
  assert.doesNotMatch(demo, /calculateDemo|demoTrades|demoStrategies|demoAccount|DEMO-PAPER-0001|SIM-00[0-9]/);
});

test('paper dashboard starts empty, without an invented account or profit', () => {
  assert.match(demo, /BELUM ADA DATA TRADING DEMO/);
  assert.match(demo, /Belum ada kurva equity/);
  assert.match(demo, /Belum ada transaksi paper yang terverifikasi/);
  assert.match(demo, /Belum ada strategi yang dijalankan/);
  assert.doesNotMatch(demo, /netPnl|startingEquity|initialEquity|returnPct|winRatePct|SIMULATOR ACTIVE/);
});

test('no public admin/admin bypass or live order controls remain', () => {
  assert.doesNotMatch(demo, /sessionStorage|password === 'admin'|username\.trim\(\)|createClient|\/api\/member|fetch\(/);
  assert.match(demo, /Copy trading live dinonaktifkan/);
  assert.match(demo, /Deposit dinonaktifkan/);
  assert.match(demo, /Withdrawal dinonaktifkan/);
});

test('master preview redirects to authenticated real telemetry, with no fake fallback', () => {
  assert.match(preview, /redirect\('\/master'\)/);
  assert.doesNotMatch(master, /demoData|demoEvents|demoOrders|chartValues|setScenario|SYNTHETIC_PREVIEW|SIM-2008|EV-008/);
  assert.match(master, /\/api\/master\/overview/);
  assert.match(master, /STAGING_WORKER_TELEMETRY/);
});

test('mobile demo navigation and safe areas remain available', () => {
  assert.match(demo, /aria-label="Demo mobile navigation"/);
  assert.match(demoCss, /safe-area-inset-bottom/);
  assert.match(demoCss, /grid-template-columns:repeat\(5/);
  assert.match(demoCss, /position:fixed/);
});
