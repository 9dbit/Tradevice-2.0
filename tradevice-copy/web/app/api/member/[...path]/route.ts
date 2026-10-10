import { apiOrigin, memberPath, memberQuery } from '../../../../lib/runtime.mjs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const path = memberPath((await context.params).path);
  const query = memberQuery(new URL(request.url).search);
  if (!path || query === null) return Response.json({ detail: { code: 'ROUTE_NOT_ALLOWED' } }, { status: 404 });
  const authorization = request.headers.get('authorization') || '';
  if (!/^Bearer [A-Za-z0-9._~-]+$/.test(authorization) || authorization.length > 16400) {
    return Response.json({ detail: { code: 'AUTH_REQUIRED' } }, { status: 401 });
  }
  const origin = apiOrigin(process.env);
  if (!origin) return Response.json({ detail: { code: 'API_NOT_CONFIGURED' } }, { status: 503 });
  try {
    const upstream = await fetch(`${origin}/api/v1/${path}${query}`, {
      headers: { Authorization: authorization }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000),
    });
    return Response.json(await upstream.json(), { status: upstream.status, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ detail: { code: 'API_UNAVAILABLE' } }, { status: 503 });
  }
}
