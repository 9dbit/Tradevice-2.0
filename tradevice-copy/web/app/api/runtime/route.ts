import { publicConfig } from '../../../lib/runtime.mjs';
export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json(publicConfig(process.env), { headers: { 'Cache-Control': 'no-store' } });
}
