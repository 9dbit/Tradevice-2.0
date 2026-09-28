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
const sessionToken = approvalKey && observerKey
  ? crypto.createHash('sha256').update(`${approvalKey}:${observerKey}`).digest('hex')
  : '';

process.env.PORT = String(internalPort);
process.env.PUBLIC_TARGET_PORT = String(internalPort);
await import('./server.js');

const cookieName = 'tradevice_observer_download';
const syncPaths = new Set(['/api/v1/market/snapshots', '/api/v1/broker/sync']);

function pathOnly(req) {
  return new URL(req.url || '/', 'http://tradevice.local').pathname;
}

function hasDownloadSession(req) {
  const cookies = String(req.headers.cookie || '').split(';').map(v => v.trim());
  return Boolean(sessionToken) && cookies.includes(`${cookieName}=${sessionToken}`);
}

function isApprovalHeader(req) {
  return Boolean(approvalKey) && String(req.headers['x-approval-key'] || '').trim() === approvalKey;
}

function proxy(req, res, authOverride = null) {
  const headers = { ...req.headers, host: `127.0.0.1:${internalPort}` };
  if (authOverride) headers.authorization = authOverride;
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

async function preparedObserver(req, res) {
  if (!observerKey || !approvalKey) {
    res.writeHead(503, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'observer_download_not_configured' }));
  }
  if (!isApprovalHeader(req) && !hasDownloadSession(req)) {
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

const gateway = http.createServer(async (req, res) => {
  try {
    const pathname = pathOnly(req);
    if (pathname === '/downloads/TradeviceObserver.mq5') return await preparedObserver(req, res);
    if (syncPaths.has(pathname)) {
      const auth = String(req.headers.authorization || '');
      const observerAllowed = observerKey && auth === `Bearer ${observerKey}`;
      const legacyAllowed = apiKey && auth === `Bearer ${apiKey}`;
      if (!observerAllowed && !legacyAllowed) {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'observer_unauthorized' }));
      }
      return proxy(req, res, apiKey ? `Bearer ${apiKey}` : null);
    }
    return proxy(req, res);
  } catch (error) {
    console.error('Observer gateway error:', error);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'gateway_internal_error' }));
  }
});

function listen(port) {
  gateway.listen(port, '0.0.0.0', () => console.log(`Tradevice Observer Gateway listening on :${port}; upstream=:${internalPort}`));
}

listen(externalPort);
if (externalTargetPort !== externalPort) listen(externalTargetPort);
