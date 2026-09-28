import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import pg from 'pg';

test('demo protocol: PostgreSQL reservation, restart, cancellation and fill/delete race', { skip: !process.env.DEMO_TEST_DATABASE_URL, timeout: 30000 }, async () => {
  const url = new URL(process.env.DEMO_TEST_DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_test'), 'Requires a local disposable *_test database');
  const pool = new pg.Pool({ connectionString: url.toString() });
  const listener = net.createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  let child, logs = '';
  async function start() {
    child = spawn(process.execPath, ['src/server.js'], { env: { ...process.env, DATABASE_URL: url.toString(), PGSSL: 'disable',
      PORT: String(port), PUBLIC_TARGET_PORT: String(port), TRADEVICE_API_KEY: 'local-integration-key',
      AI_DECISION_ENABLED: 'false', DEMO_EXECUTION_ENABLED: 'true', DEMO_ACCOUNT_LOGIN: '12345', DEMO_ACCOUNT_SERVER: 'Test-Demo' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', b => { logs += b; }); child.stderr.on('data', b => { logs += b; });
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${base}/health`)).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Server failed to start: ${logs}`);
  }
  async function stop() { if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); } }
  async function post(path, body, key = 'local-integration-key') {
    return fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
  }
  const request = () => ({ client_id: 'test-executor', nonce: '123', account_mode: 'DEMO', account_login: '12345', account_server: 'Test-Demo',
    armed: true, orders_total: 0, positions_total: 0, report: null });
  const poll = async body => (await (await post('/api/v1/demo/poll', body)).text()).split('|');
  const snapshot = (bid = 4155) => ({ symbol: 'XAUUSD', timeframe: 'M1', timestamp: new Date().toISOString(), bid, ask: bid + 0.24, spread_points: 240,
    candles: [{ timestamp: new Date().toISOString(), open: 4158, high: 4159, low: 4154, close: 4155 }], features: { broker_symbol: 'XAUUSDm', terminal_connected: true } });
  try {
    await start();
    await pool.query('TRUNCATE demo_executions,trade_decisions,market_snapshots');
    assert.equal((await post('/api/v1/demo/poll', request(), 'wrong')).status, 401);
    assert.equal((await post('/api/v1/demo/poll', { ...request(), account_login: 'different' })).status, 400);
    assert.equal((await post('/api/v1/demo/poll', { ...request(), account_login: '999' })).status, 403);
    await post('/api/v1/market/snapshots', snapshot());
    await post('/api/v1/decisions/shadow', { trade_id: 'test-wait', decision: 'WAIT', regime: 'TREND_DOWN', confidence: 1 });
    assert.equal((await poll(request()))[1], 'HOLD', '100% WAIT must not place');
    const intent = { trade_id: 'test-pending', decision: 'PLACE_PENDING', side: 'SELL', order_type: 'SELL_LIMIT', setup: 'TREND_PULLBACK',
      regime: 'TREND_DOWN', confidence: 0.81, entry: 4164, stop_loss: 4173, take_profit: 4150, expiration_candles: 5,
      context: { market_timestamp: new Date().toISOString(), pending_trigger: 'PRICE_TOUCH', scenario_guard: { operator: 'ABOVE', price: 4172 } } };
    assert.equal((await post('/api/v1/decisions/shadow', intent)).status, 202);
    assert.equal((await poll({ ...request(), armed: false }))[1], 'HOLD');
    const replies = await Promise.all([poll(request()), poll(request()), poll(request())]);
    assert.equal(replies.filter(r => r[1] === 'PLACE').length, 1, 'Concurrent polls issue PLACE exactly once');
    const token = replies.find(r => r[1] === 'PLACE')[2];
    assert.equal((await pool.query('SELECT count(*) FROM demo_executions')).rows[0].count, '1');
    assert.equal((await poll(request()))[12], 'RECONCILE_REQUIRED', 'An unacknowledged dispatch never retries');
    await stop(); await start();
    assert.equal((await poll(request()))[1], 'HOLD', 'Restart cannot replay PLACE');
    assert.equal((await poll({ ...request(), client_id: 'other-executor' }))[12], 'OTHER_EXECUTOR_OWNS_SLOT');
    const pending = { ...request(), orders_total: 1, report: { token, ticket: '9001', status: 'PENDING', reason: 'BROKER_CONFIRMED', pnl_usd: null } };
    assert.equal((await poll(pending))[12], 'MONITORING_SCENARIO');
    await post('/api/v1/market/snapshots', snapshot(4172));
    assert.equal((await poll(pending))[1], 'CANCEL');
    await post('/api/v1/market/snapshots', snapshot());
    assert.equal((await poll(pending))[1], 'CANCEL', 'Invalidation is sticky until broker confirmation');
    const filled = { ...pending, orders_total: 0, positions_total: 1, report: { ...pending.report, status: 'FILLED' } };
    assert.equal((await poll(filled))[12], 'POSITION_OPEN_NO_DELETE', 'A racing fill is not a position-close instruction');
    assert.equal((await poll(pending))[1], 'HOLD', 'Stale pending report cannot downgrade a filled position');
    await poll({ ...filled, positions_total: 0, report: { ...filled.report, status: 'CLOSED', pnl_usd: -9 } });
    const ledger = await (await fetch(`${base}/api/v1/demo/ledger`)).json();
    assert.equal(ledger.orders[0].status, 'CLOSED'); assert.equal(ledger.orders[0].result.pnl_usd, -9);
    assert.equal(ledger.orders[0].cancel_reason, 'SCENARIO_INVALIDATED'); assert.equal(ledger.live_execution_enabled, false);
  } finally { await stop(); await pool.end(); }
});
