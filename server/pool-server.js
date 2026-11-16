import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { attachPoolRooms } from './pool-rooms.js';

const prefix = '/games/pool/';
const socketPath = `${prefix}ws`;
const fileTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
};
const segmentPath = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9_.-]*)*$/;
const title = { 401: 'Sign in to play. سجّل الدخول عشان تلعب.', 404: 'Not found', 405: 'Method not allowed' };
const maxClients = 64;

function useUrl(value, kind) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search)
    throw new Error(`Invalid ${kind}`);
  return url;
}

function securityHeaders(res, webSocketSource) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:", `connect-src 'self' ${webSocketSource}`, "font-src 'self'",
    "frame-ancestors 'self'", "base-uri 'none'", "object-src 'none'", "form-action 'self'",
  ].join('; '));
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

function respond(res, status, body = title[status] ?? '') {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(body);
}

function denyUpgrade(socket, status, phrase) {
  if (!socket.destroyed) socket.end(`HTTP/1.1 ${status} ${phrase}\r\nConnection: close\r\nContent-Length: 0\r\nCache-Control: no-store\r\n\r\n`);
}

export function createPoolServer({
  accessUrl = process.env.POOL_ACCESS_URL,
  publicOrigin = process.env.POOL_PUBLIC_ORIGIN,
  distDirectory = fileURLToPath(new URL('../dist/', import.meta.url)),
  recheckMs = 12_000,
} = {}) {
  const verifier = useUrl(accessUrl, 'POOL_ACCESS_URL');
  const origin = useUrl(publicOrigin, 'POOL_PUBLIC_ORIGIN');
  if (origin.pathname !== '/') throw new Error('POOL_PUBLIC_ORIGIN must contain only an origin');
  const dist = resolve(distDirectory);
  const webSocketSource = origin.origin.replace(/^http/, 'ws') + socketPath;

  let pendingChecks = 0;
  async function allowed(cookie) {
    if (typeof cookie !== 'string' || cookie.length === 0 || cookie.length > 8192 || pendingChecks >= 64) return false;
    pendingChecks++;
    try {
      const result = await fetch(verifier, { method: 'GET', headers: { Cookie: cookie }, redirect: 'error', signal: AbortSignal.timeout(2500) });
      if (result.status !== 204) await result.body?.cancel().catch(() => {});
      return result.status === 204;
    } catch {
      return false;
    } finally {
      pendingChecks--;
    }
  }

  const server = createServer({ requestTimeout: 10_000, headersTimeout: 5_000, maxHeaderSize: 16 * 1024 }, async (req, res) => {
    securityHeaders(res, webSocketSource);
    const path = req.url.split('?')[0];
    if (!path.startsWith(prefix) && path !== '/games/pool') { respond(res, 404); return; }
    if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); respond(res, 405); return; }
    if (path === `${prefix}health`) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end('{"status":"ok"}');
      return;
    }
    if (!await allowed(req.headers.cookie)) { respond(res, 401); return; }
    if (path === '/games/pool') { res.writeHead(308, { Location: prefix }).end(); return; }
    const relative = path.slice(prefix.length) || 'index.html';
    const type = fileTypes[extname(relative)];
    if (!type || !segmentPath.test(relative)) { respond(res, 404); return; }
    try {
      const target = await realpath(resolve(dist, relative));
      const base = await realpath(dist);
      if (!target.startsWith(base + sep)) { respond(res, 404); return; }
      const metadata = await stat(target);
      if (!metadata.isFile()) { respond(res, 404); return; }
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': metadata.size });
      if (req.method === 'HEAD') { res.end(); return; }
      await pipeline(createReadStream(target), res);
    } catch {
      if (!res.headersSent) respond(res, 404);
      else res.destroy();
    }
  });
  const relay = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  attachPoolRooms(relay);

  let upgrades = 0;
  server.on('upgrade', async (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    if (req.url !== socketPath) { denyUpgrade(socket, 404, 'Not Found'); return; }
    if (req.headers.origin !== origin.origin) { denyUpgrade(socket, 403, 'Forbidden'); return; }
    if (relay.clients.size + upgrades >= maxClients) { denyUpgrade(socket, 503, 'Service Unavailable'); return; }
    upgrades++;
    socket.pause();
    try {
      const cookie = req.headers.cookie;
      if (!await allowed(cookie)) { denyUpgrade(socket, 401, 'Unauthorized'); return; }
      if (socket.destroyed) return;
      relay.handleUpgrade(req, socket, head, (ws) => {
        function verifyAgain() {
          timer = setTimeout(async () => {
            if (ws.readyState !== WebSocket.OPEN) return;
            if (!await allowed(cookie)) { ws.close(1008, 'City session expired'); return; }
            if (ws.readyState === WebSocket.OPEN) verifyAgain();
          }, recheckMs);
          timer.unref();
        }
        let timer;
        verifyAgain();
        ws.once('close', () => clearTimeout(timer));
        relay.emit('connection', ws, req);
        socket.resume();
      });
    } catch {
      socket.destroy();
    } finally {
      upgrades--;
    }
  });
  server.once('close', () => {
    for (const client of relay.clients) client.terminate();
    relay.close();
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createPoolServer();
  const port = Number(process.env.PORT || 3001);
  server.listen(port, '0.0.0.0', () => console.log(`City pool listening internally on port ${port}`));
}
