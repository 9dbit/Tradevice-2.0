import { apiOrigin } from '../../../lib/runtime.mjs';
export const dynamic = 'force-dynamic';
export async function GET() {
  const origin = apiOrigin(process.env);
  if (!origin) return Response.json({ status: 'api_not_configured' }, { status: 503 });
  try {
    const response = await fetch(`${origin}/health`, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000) });
    const data = await response.json();
    if (!response.ok || data.live_execution !== false || data.copy_execution !== false || data.execution_mode !== 'paper') {
      return Response.json({ status: 'safety_check_failed' }, { status: 503 });
    }
    return Response.json({ status: 'api_online', version: data.version, live_execution: false, copy_execution: false,
      execution_mode: 'paper', auth_configured: data.auth_configured === true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ status: 'api_unavailable' }, { status: 503 });
  }
}
