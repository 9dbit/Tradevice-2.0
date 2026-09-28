import { getDatabasePool, getLatestSnapshot, getRecentDecisions } from './store.js';
import { evaluateDemoCandidate, cancellationReason, encodeDemoCommand } from './demo-policy.js';

const terminal = ['CLOSED', 'CANCELLED', 'EXPIRED', 'REJECTED'];
export function demoConfigured() {
  return Boolean(process.env.TRADEVICE_API_KEY && process.env.DEMO_ACCOUNT_LOGIN && process.env.DEMO_ACCOUNT_SERVER && getDatabasePool());
}
export function demoEnabled() { return process.env.DEMO_EXECUTION_ENABLED === 'true' && demoConfigured(); }

export async function initDemoExecution() {
  const pool = getDatabasePool();
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS demo_executions (
    token TEXT PRIMARY KEY, trade_id TEXT UNIQUE NOT NULL, client_id TEXT NOT NULL,
    status TEXT NOT NULL, plan JSONB NOT NULL, ticket TEXT, cancel_reason TEXT,
    broker_report JSONB, events JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

export async function activeDemoPlans() {
  const pool = getDatabasePool();
  if (!pool) return [];
  const { rows } = await pool.query("SELECT plan,status,cancel_reason FROM demo_executions WHERE status IN ('DISPATCHED','PENDING','UNKNOWN') ORDER BY created_at DESC LIMIT 1");
  return rows.map(r => ({ ...r.plan, status: r.status, cancel_reason: r.cancel_reason }));
}

export async function demoLedger() {
  const pool = getDatabasePool();
  const rows = pool ? (await pool.query('SELECT token,trade_id,status,plan,ticket,cancel_reason,broker_report,created_at,updated_at FROM demo_executions ORDER BY created_at DESC LIMIT 100')).rows : [];
  return { mode: 'demo', live_execution_enabled: false, enabled: demoEnabled(), configured: demoConfigured(),
    orders: rows.map(({ broker_report, ...row }) => ({ ...row, result: broker_report ? {
      status: broker_report.status, pnl_usd: broker_report.pnl_usd ?? null, reason: broker_report.reason ?? null
    } : null })) };
}

// One durable reservation per trade ID. Never retry PLACE after an ambiguous delivery.
// A lost response blocks the slot until reconciled; it cannot cause a duplicate order.
export async function pollDemo(request) {
  if (request.account_mode !== 'DEMO' || String(request.account_login) !== process.env.DEMO_ACCOUNT_LOGIN || request.account_server !== process.env.DEMO_ACCOUNT_SERVER) {
    const error = new Error('Demo account binding mismatch'); error.status = 403; throw error;
  }
  const pool = getDatabasePool();
  if (!pool) return encodeDemoCommand('HOLD', request.nonce, { reason: 'PERSISTENCE_REQUIRED' });
  const [snapshot, decisions] = await Promise.all([getLatestSnapshot('XAUUSD'), getRecentDecisions(100)]);
  const db = await pool.connect();
  const now = Date.now();
  let wire;
  try {
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(872613, 1)');
    let active = (await db.query("SELECT * FROM demo_executions WHERE status NOT IN ('CLOSED','CANCELLED','EXPIRED','REJECTED') ORDER BY created_at LIMIT 1 FOR UPDATE")).rows[0];
    const report = request.report;
    if (active && active.client_id !== request.client_id) {
      wire = encodeDemoCommand('HOLD', request.nonce, { reason: 'OTHER_EXECUTOR_OWNS_SLOT' });
    } else {
      if (active && report?.token === active.token) {
        // Filled positions are never downgraded to pending/cancelled by a stale report.
        const permitted = active.status !== 'FILLED' || ['FILLED', 'CLOSED', 'UNKNOWN'].includes(report.status);
        if (permitted && (active.status !== report.status || active.ticket !== report.ticket)) {
          const event = { at: new Date(now).toISOString(), status: report.status, ticket: report.ticket, reason: report.reason };
          await db.query('UPDATE demo_executions SET status=$2,ticket=$3,broker_report=$4,events=events || $5::jsonb,updated_at=NOW() WHERE token=$1',
            [active.token, report.status, report.ticket, report, JSON.stringify([event])]);
          active = { ...active, status: report.status, ticket: report.ticket };
        }
        if (terminal.includes(active.status)) active = null;
      }
      if (active) {
        if (active.status === 'FILLED') wire = encodeDemoCommand('HOLD', request.nonce, { plan: active.plan, reason: 'POSITION_OPEN_NO_DELETE' });
        else {
          const cancel = active.cancel_reason || (!demoEnabled() || !request.armed ? 'EXECUTOR_DISABLED' : cancellationReason(active.plan, snapshot, decisions, now));
          if (cancel) {
            if (!active.cancel_reason) await db.query('UPDATE demo_executions SET cancel_reason=$2,events=events || $3::jsonb,updated_at=NOW() WHERE token=$1',
              [active.token, cancel, JSON.stringify([{ at: new Date(now).toISOString(), status: 'CANCEL_REQUESTED', reason: cancel }])]);
            wire = encodeDemoCommand('CANCEL', request.nonce, { plan: active.plan, reason: cancel }, now);
          } else wire = encodeDemoCommand('HOLD', request.nonce, { plan: active.plan, reason: active.status === 'PENDING' ? 'MONITORING_SCENARIO' : 'RECONCILE_REQUIRED' }, now);
        }
      } else if (!demoEnabled() || !request.armed) wire = encodeDemoCommand('HOLD', request.nonce, { reason: 'DEMO_DISABLED' }, now);
      else if (request.orders_total !== 0 || request.positions_total !== 0) wire = encodeDemoCommand('HOLD', request.nonce, { reason: 'ACCOUNT_HAS_EXPOSURE' }, now);
      else {
        const cooldown = (await db.query("SELECT 1 FROM demo_executions WHERE updated_at > NOW() - INTERVAL '60 seconds' LIMIT 1")).rows.length;
        let reason = cooldown ? 'COOLDOWN' : 'NO_ELIGIBLE_PENDING';
        if (!cooldown) {
          // Only the newest PLACE_PENDING can be dispatched; old ideas are never resurrected.
          const candidate = decisions.find(d => d.decision === 'PLACE_PENDING');
          const result = evaluateDemoCandidate(candidate, snapshot, now);
          reason = result.reason ?? reason;
          if (result.approved && !cancellationReason(result.plan, snapshot, decisions, now)) {
            const reserved = await db.query(`INSERT INTO demo_executions(token,trade_id,client_id,status,plan,events)
              VALUES($1,$2,$3,'DISPATCHED',$4,$5) ON CONFLICT DO NOTHING RETURNING token`,
              [result.plan.token, result.plan.trade_id, request.client_id, result.plan,
                JSON.stringify([{ at: new Date(now).toISOString(), status: 'DISPATCHED', reason: 'CONFIDENCE_ABOVE_80_AND_GATES_PASSED' }])]);
            if (reserved.rows.length) wire = encodeDemoCommand('PLACE', request.nonce, { plan: result.plan }, now);
            else reason = 'ALREADY_DISPATCHED';
          }
        }
        wire ??= encodeDemoCommand('HOLD', request.nonce, { reason }, now);
      }
    }
    await db.query('COMMIT');
    return wire;
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}
