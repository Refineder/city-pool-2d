import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import WebSocket from 'ws';
import { createPoolServer } from '../server/pool-server.js';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

const publicOrigin = 'https://pool.qa.invalid';
const cookie = 'naffag_session=disposable-city-session';

async function fixture(t) {
  const distDirectory = await mkdtemp(join(tmpdir(), 'refineder-pool-test-'));
  await mkdir(join(distDirectory, 'assets'));
  await writeFile(join(distDirectory, 'index.html'), '<title>City pool</title>');
  await writeFile(join(distDirectory, 'assets', 'main.js'), 'export const pool = true;');
  await writeFile(join(distDirectory, 'assets', 'ball.ogg'), 'test audio');
  await writeFile(join(distDirectory, '.hidden'), 'not served');
  let enabled = true;
  const attempts = [];
  const verifier = createServer((req, res) => {
    attempts.push({ cookie: req.headers.cookie, method: req.method });
    res.writeHead(enabled && req.headers.cookie === cookie && req.url === '/access' ? 204 : 401).end();
  });
  const verifierOrigin = await listen(verifier);
  const pool = createPoolServer({ accessUrl: `${verifierOrigin}/access`, publicOrigin, distDirectory, recheckMs: 160 });
  const origin = await listen(pool);
  t.after(async () => {
    await Promise.all([new Promise((resolve) => pool.close(resolve)), new Promise((resolve) => verifier.close(resolve))]);
    await rm(distDirectory, { recursive: true, force: true });
  });
  return { origin, attempts, revoke() { enabled = false; } };
}

function connect(origin, pathname, headers) {
  return new WebSocket(origin.replace('http:', 'ws:') + pathname, { headers });
}

function rejectStatus(ws) {
  return new Promise((resolve, reject) => {
    ws.on('unexpected-response', (_req, response) => { response.resume(); resolve(response.statusCode); ws.terminate(); });
    ws.on('error', () => {});
    ws.on('open', () => { ws.terminate(); reject(new Error('Unexpected WebSocket admission')); });
  });
}

async function nextMessage(ws, type, command) {
  const listener = new Promise((resolve) => {
    const handle = (raw) => {
      const value = JSON.parse(raw);
      if (value.type !== type) return;
      ws.off('message', handle);
      resolve(value);
    };
    ws.on('message', handle);
  });
  if (command) ws.send(JSON.stringify(command));
  return listener;
}

test('admits only authenticated reads under the fixed pool prefix, serving no-store resources', async (t) => {
  const { origin, attempts } = await fixture(t);
  const url = (path) => origin + path;
  assert.equal((await fetch(url('/games/pool/health'))).status, 200);
  assert.equal(attempts.length, 0);
  assert.equal((await fetch(url('/games/pool/'))).status, 401);
  assert.equal((await fetch(url('/games/pool/assets/main.js'))).status, 401);
  assert.equal(attempts.length, 0);
  const headers = { cookie };
  const page = await fetch(url('/games/pool/?lang=ar'), { headers });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /City pool/);
  assert.equal(page.headers.get('cache-control'), 'private, no-store');
  assert.match(page.headers.get('content-security-policy'), /connect-src 'self' wss:\/\/pool\.qa\.invalid\/games\/pool\/ws/);
  assert.equal((await fetch(url('/games/pool/assets/ball.ogg'), { headers })).headers.get('content-type'), 'audio/ogg');
  assert.equal((await fetch(url('/games/pool/assets/main.js'), { headers, method: 'HEAD' })).headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal((await fetch(url('/games/pool/.hidden'), { headers })).status, 404);
  assert.equal((await fetch(url('/games/pool/assets/missing.js'), { headers })).status, 404);
  assert.equal((await fetch(url('/'), { headers })).status, 404);
  assert.equal((await fetch(url('/games/pool/'), { headers, method: 'POST', body: 'ignored' })).status, 405);
  assert(attempts.every((check) => check.cookie === cookie && check.method === 'GET'));
});

test('requires the exact WebSocket path, city origin and current session', async (t) => {
  const { origin, revoke } = await fixture(t);
  const path = '/games/pool/ws';
  assert.equal(await rejectStatus(connect(origin, '/ws', { cookie, origin: publicOrigin })), 404);
  assert.equal(await rejectStatus(connect(origin, `${path}?debug=1`, { cookie, origin: publicOrigin })), 404);
  assert.equal(await rejectStatus(connect(origin, path, { cookie, origin: 'https://other.qa.invalid' })), 403);
  assert.equal(await rejectStatus(connect(origin, path, { origin: publicOrigin })), 401);
  const ws = connect(origin, path, { cookie, origin: publicOrigin });
  await once(ws, 'open');
  revoke();
  const [code] = await once(ws, 'close');
  assert.equal(code, 1008);
});

test('starts an authoritative room through the authenticated WebSocket', async (t) => {
  const { origin } = await fixture(t);
  const path = '/games/pool/ws';
  const headers = { cookie, origin: publicOrigin };
  const host = connect(origin, path, headers);
  const guest = connect(origin, path, headers);
  try {
    await Promise.all([once(host, 'open'), once(guest, 'open')]);
    const { code } = await nextMessage(host, 'created', { type: 'create' });
    assert.match(code, /^[A-Z0-9]{4}$/);
    const hostStarted = nextMessage(host, 'start');
    const guestStarted = await nextMessage(guest, 'start', { type: 'join', code });
    assert.deepEqual(guestStarted, await hostStarted);
    assert.equal(guestStarted.turn, 1);
  } finally {
    host.terminate();
    guest.terminate();
  }
});
