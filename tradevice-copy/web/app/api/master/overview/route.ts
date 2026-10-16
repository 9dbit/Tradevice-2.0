import { apiOrigin, publicConfig } from '../../../../lib/runtime.mjs';
import { masterAuthAllowed, paperHealthState, parseMasterBearer, STAGING_PROJECT_REF } from '../../../../lib/master-security.mjs';
import { validateWorkerTelemetry } from '../../../../lib/master-telemetry.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
let lastBatchDelivery = '';


const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' };
function result(status: number, code: string) {
  return Response.json({ detail: { code } }, { status, headers });
}

/** Staging-only, authenticated, read-only. Worker data comes from restricted PostgreSQL via the internal API. */
export async function GET(request: Request) {
  const token = parseMasterBearer(request.headers.get('authorization'));
  if (!token) return result(401, 'MASTER_AUTH_REQUIRED');
  if (process.env.SUPABASE_PROJECT_REF !== STAGING_PROJECT_REF ||
      process.env.PLATFORM_ENVIRONMENT !== 'staging') return result(503, 'MASTER_STAGING_ONLY');
  const config = publicConfig(process.env);
  if (!config.configured || !config.supabaseUrl || !config.publishableKey) {
    return result(503, 'MASTER_AUTH_NOT_CONFIGURED');
  }
  let user: unknown;
  try {
    const res = await fetch(config.supabaseUrl + '/auth/v1/user', {
      headers: { apikey: config.publishableKey, Authorization: 'Bearer ' + token },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(7000),
    });
    if (res.status === 401 || res.status === 403) return result(401, 'MASTER_INVALID_SESSION');
    if (!res.ok) return result(503, 'MASTER_AUTH_UNAVAILABLE');
    user = await res.json();
  } catch {
    return result(503, 'MASTER_AUTH_UNAVAILABLE');
  }
  if (!masterAuthAllowed(user)) return result(403, 'MASTER_ADMIN_REQUIRED');
  const origin = apiOrigin(process.env);
  let memberApi: 'ONLINE'|'UNAVAILABLE'|'NOT_CONFIGURED'|'SAFETY_MISMATCH' = 'NOT_CONFIGURED';
  const healthRead=(async()=>{if (origin) {
    try {
      const response = await fetch(origin + '/health', {
        cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(6000),
      });
      memberApi = response.ok ? paperHealthState(await response.json()) : 'UNAVAILABLE';
    } catch {
      memberApi = 'UNAVAILABLE';
    }
  }
  })();
  // The internal service-to-service secret is never exposed in the response or to browser code.
  const sharedSecret = process.env.MASTER_TELEMETRY_SHARED_SECRET || '';
  // Admin-only, low-cardinality codes. Never forward secrets or provider exception messages.
  const allowedDiagnosticCodes = new Set([
    'MASTER_READ_DB_NOT_CONFIGURED','MASTER_READ_DB_ACCESS_FAILED',
    'MASTER_READ_DB_IDENTITY_FAILED','MASTER_TELEMETRY_PROCESSING_FAILED',
    'MASTER_INTERNAL_AUTH_REQUIRED','MASTER_STAGING_ONLY',
    'MASTER_TELEMETRY_NOT_CONFIGURED',
  ]);
  let telemetryDiagnostic = origin ? 'MASTER_TELEMETRY_UNAVAILABLE' : 'MASTER_API_NOT_CONFIGURED';
  if (origin && /^[0-9a-f]{64}$/.test(sharedSecret)) {
    try {
      const telemetryResponse = await fetch(origin + '/internal/master/telemetry', {
        headers: { 'x-tradevice-master-secret': sharedSecret },
        cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000),
      });
      if (telemetryResponse.ok) {
        const snapshot = validateWorkerTelemetry(await telemetryResponse.json());
        if (snapshot) {
          const batch=snapshot.demoBatch;
          const delivery=batch?`${batch.batch_id}:${batch.observed_ms}`:'';
          if(batch&&delivery!==lastBatchDelivery){
            // Operational proof of the authenticated projection; no account or credentials.
            console.info(JSON.stringify({event:'DEMO_HISTORY_PROJECTED',batch_id:batch.batch_id,
              observed_ms:batch.observed_ms,completed:batch.completed,status:batch.status}));
            lastBatchDelivery=delivery;
          }
          await healthRead;
          return Response.json({
            ...snapshot,
            infrastructure: { ...snapshot.infrastructure, memberApi },
          }, { headers });
        }
        telemetryDiagnostic='MASTER_TELEMETRY_INVALID_RESPONSE';
      } else if (telemetryResponse.status === 401) {
        telemetryDiagnostic='MASTER_INTERNAL_AUTH_MISMATCH';
      } else {
        const err=await telemetryResponse.json().catch(()=>null);
        const code=err?.detail?.code;
        telemetryDiagnostic=typeof code==='string' && allowedDiagnosticCodes.has(code)
          ? code : 'MASTER_TELEMETRY_UNAVAILABLE';
      }
    } catch {
      telemetryDiagnostic='MASTER_TELEMETRY_UNREACHABLE';
      // No synthetic fallback. Unverified data must remain OFFLINE/STALE.
    }
  }
  return Response.json({
    source: 'STAGING_INFRASTRUCTURE',
    environment: 'staging',
    observedAt: new Date().toISOString(),
    executionMode: 'PAPER_ONLY',
    master: {
      id: null, state: 'OFFLINE/STALE', heartbeatAt: null, cycles: null,
      healthyCycles: null, anomalies: null, activeSource: null, recoveryTicks: null,
    },
    risk: { killSwitch: 'UNAVAILABLE', positions: null, equityUsd: null,
      pnlUsd: null, drawdownPct: null, winRatePct: null },
    infrastructure: { memberApi, masterWorker: 'OFFLINE/STALE',
      journal: 'UNAVAILABLE', adminAuth: 'VERIFIED' },
    activity: [], paperOrders: [], equityCurve: [],
    diagnostic: { code: telemetryDiagnostic, component: 'MASTER_TELEMETRY' },
  }, { headers });
}
