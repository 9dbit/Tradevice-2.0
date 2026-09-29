import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const externalPort = Number(process.env.PORT || 3000);
const externalTargetPort = Number(process.env.PUBLIC_TARGET_PORT || 3000);
const internalPort = Number(process.env.TRADEVICE_INTERNAL_PORT || 3101);
const apiKey = String(process.env.TRADEVICE_API_KEY || '').trim();
const observerKey = String(process.env.TRADEVICE_OBSERVER_KEY || '').trim();
const approvalKey = String(process.env.TRADEVICE_APPROVAL_KEY || '').trim();
const tradingMode = String(process.env.TRADING_MODE || 'shadow').toLowerCase();
const shadowKeylessApproval = tradingMode !== 'live' && tradingMode !== 'real';
const chatDownloadTokenHash = 'a533233463e013575fe4d5e2ea081f86de503e0a21fec66c2996c5bebbc0e68d';
const chatDownloadExpiresAt = Date.parse('2026-09-29T20:00:00Z');
const sessionToken = approvalKey && observerKey
  ? crypto.createHash('sha256').update(`${approvalKey}:${observerKey}`).digest('hex')
  : '';

process.env.PORT = String(internalPort);
process.env.PUBLIC_TARGET_PORT = String(internalPort);
await import('./server.js');

const cookieName = 'tradevice_observer_download';
const syncPaths = new Set(['/api/v1/market/snapshots', '/api/v1/broker/sync']);

function requestUrl(req) {
  return new URL(req.url || '/', 'http://tradevice.local');
}

function pathOnly(req) {
  return requestUrl(req).pathname;
}

function hasDownloadSession(req) {
  const cookies = String(req.headers.cookie || '').split(';').map(v => v.trim());
  return Boolean(sessionToken) && cookies.includes(`${cookieName}=${sessionToken}`);
}

function isApprovalHeader(req) {
  return Boolean(approvalKey) && String(req.headers['x-approval-key'] || '').trim() === approvalKey;
}

function isShadowApprovalPath(pathname) {
  if (pathname === '/api/v1/approval/verify') return true;
  if (pathname === '/api/v1/settings/approval-mode') return true;
  return /^\/api\/v1\/plans\/[^/]+\/(approve|reject)$/.test(pathname);
}

function hasValidChatDownloadToken(req) {
  if (Date.now() > chatDownloadExpiresAt) return false;
  const token = requestUrl(req).searchParams.get('download_token') || '';
  if (!token) return false;
  const digest = crypto.createHash('sha256').update(token).digest('hex');
  const actual = Buffer.from(digest, 'hex');
  const expected = Buffer.from(chatDownloadTokenHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function proxy(req, res, overrides = {}) {
  const headers = { ...req.headers, host: `127.0.0.1:${internalPort}` };
  if (overrides.authorization) headers.authorization = overrides.authorization;
  if (overrides.approvalKey) headers['x-approval-key'] = overrides.approvalKey;
  const upstream = http.request({ hostname: '127.0.0.1', port: internalPort, path: req.url, method: req.method, headers }, incoming => {
    const responseHeaders = { ...incoming.headers };
    if (pathOnly(req) === '/api/v1/approval/verify' && incoming.statusCode === 204 && sessionToken) {
      responseHeaders['set-cookie'] = `${cookieName}=${sessionToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600`;
    }
    res.writeHead(incoming.statusCode || 502, responseHeaders);
    incoming.pipe(res);
  });
  upstream.on('error', error => {
    console.error('Observer gateway proxy error:', error);
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'gateway_upstream_error' }));
  });
  req.pipe(upstream);
}

function internalJson(pathname) {
  return new Promise((resolve, reject) => {
    const headers = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
    const request = http.request({ hostname: '127.0.0.1', port: internalPort, path: pathname, method: 'GET', headers }, incoming => {
      let body = '';
      incoming.setEncoding('utf8');
      incoming.on('data', chunk => { body += chunk; });
      incoming.on('end', () => {
        if ((incoming.statusCode || 500) >= 400) return reject(new Error(`internal_${incoming.statusCode}`));
        try { resolve(JSON.parse(body || 'null')); } catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
    request.end();
  });
}

async function liveAnalysis(res) {
  const rows = await internalJson('/api/v1/decisions/recent?limit=220');
  const list = Array.isArray(rows) ? rows : [];
  const analyses = list
    .filter(row => String(row?.trade_id || '').startsWith('analysis-'))
    .map(row => ({
      trade_id: row.trade_id,
      created_at: row.created_at ?? null,
      decision: row.decision ?? 'WAIT',
      setup: row.setup ?? null,
      regime: row.regime ?? null,
      confidence: Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : null,
      reason_codes: Array.isArray(row.reason_codes) ? row.reason_codes : [],
      market_timestamp: row.context?.market_timestamp ?? null,
      thesis: row.context?.thesis ?? null,
      invalidation: row.context?.invalidation ?? null,
      analysis_type: row.context?.analysis_type ?? null,
      strategy_state: row.context?.strategy_state ?? null,
      current_price: Number.isFinite(Number(row.context?.current_price)) ? Number(row.context.current_price) : null,
      trend_m5: row.context?.trend_m5 ?? null,
      trend_m15: row.context?.trend_m15 ?? null,
      levels: row.context?.levels ?? null,
      watch_count: Number(row.context?.watch_count ?? 0),
      watch: row.context?.watch ?? null
    }));
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ generated_at: new Date().toISOString(), analyses }));
}

async function preparedObserver(req, res) {
  if (!observerKey) {
    res.writeHead(503, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'observer_download_not_configured' }));
  }
  if (!isApprovalHeader(req) && !hasDownloadSession(req) && !hasValidChatDownloadToken(req)) {
    res.writeHead(401, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'observer_download_locked' }));
  }
  const template = await fs.promises.readFile(path.resolve('mt5/TradeviceObserver.mq5'), 'utf8');
  const needle = 'input string ApiKey = "";';
  if (!template.includes(needle)) {
    res.writeHead(500, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'observer_template_invalid' }));
  }
  const safeKey = observerKey.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  const source = template.replace(needle, `input string ApiKey = "${safeKey}"; // auto-configured by Tradevice`);
  res.writeHead(200, {
    'content-type': 'text/plain; charset=utf-8',
    'content-disposition': 'attachment; filename="TradeviceObserver.mq5"',
    'cache-control': 'no-store'
  });
  res.end(source);
}

const handleRequest = async (req, res) => {
  try {
    const pathname = pathOnly(req);
    if (pathname === '/downloads/TradeviceObserver.mq5') return await preparedObserver(req, res);
    if (pathname === '/api/v1/analysis/live' && req.method === 'GET') return await liveAnalysis(res);
    if (syncPaths.has(pathname)) {
      const auth = String(req.headers.authorization || '');
      const observerAllowed = observerKey && auth === `Bearer ${observerKey}`;
      const legacyAllowed = apiKey && auth === `Bearer ${apiKey}`;
      if (!observerAllowed && !legacyAllowed) {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'observer_unauthorized' }));
      }
      return proxy(req, res, { authorization: apiKey ? `Bearer ${apiKey}` : null });
    }
    if (shadowKeylessApproval && approvalKey && isShadowApprovalPath(pathname)) {
      return proxy(req, res, { approvalKey });
    }
    return proxy(req, res);
  } catch (error) {
    console.error('Observer gateway error:', error);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'gateway_internal_error' }));
  }
};

function listen(port) {
  const server = http.createServer(handleRequest);
  server.listen(port, '0.0.0.0', () => console.log(`Tradevice Observer Gateway listening on :${port}; upstream=:${internalPort}`));
  return server;
}

listen(externalPort);
if (externalTargetPort !== externalPort) listen(externalTargetPort);
