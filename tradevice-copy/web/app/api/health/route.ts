export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json({ status: 'ok', service: 'copy-web', execution_mode: 'paper', live_execution: false },
    { headers: { 'Cache-Control': 'no-store' } });
}
