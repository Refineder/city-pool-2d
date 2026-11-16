import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocketServer, WebSocket } from 'ws';
import { attachPoolRooms } from './pool-rooms.js';

async function client(server) {
  const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
  const messages = [];
  const listeners = new Set();
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    messages.push(message);
    for (const listener of listeners) listener(message);
  });
  const waitFor = (type, check = () => true) => new Promise((resolve, reject) => {
    const predicate = (message) => message.type === type && check(message);
    const saved = messages.find(predicate);
    if (saved) return resolve(saved);
    const timeout = setTimeout(() => {
      listeners.delete(accept);
      reject(new Error(`Timed out waiting for ${type}`));
    }, 7000);
    function accept(message) {
      if (!predicate(message)) return;
      listeners.delete(accept);
      clearTimeout(timeout);
      resolve(message);
    }
    listeners.add(accept);
  });
  await once(socket, 'open');
  return { socket, messages, waitFor, send: (message) => socket.send(JSON.stringify(message)) };
}

test('two WebSocket matches isolate players and authorize only bounded shots, placement and restart', { timeout: 16000 }, async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  attachPoolRooms(server);
  await once(server, 'listening');
  const connections = await Promise.all(Array.from({ length: 5 }, () => client(server)));
  const [host, guest, hostB, guestB, outsider] = connections;
  try {
    host.send({ type: 'create' });
    hostB.send({ type: 'create' });
    const { code } = await host.waitFor('created');
    const { code: secondCode } = await hostB.waitFor('created');
    assert.match(code, /^[A-Z2-9]{4}$/);
    assert.notEqual(secondCode, code);

    guest.send({ type: 'join', code });
    guestB.send({ type: 'join', code: secondCode });
    const greeting = await Promise.all(connections.slice(0, 4).map((peer) => peer.waitFor('start')));
    assert.ok(greeting.every(({ turn }) => turn === 1));
    assert.deepEqual(greeting[0].groups, { 1: null, 2: null });
    await Promise.all(connections.slice(0, 4).map((peer) => peer.waitFor('state', (value) =>
      value.settled && value.shots === 0 && value.balls?.length === 16,
    )));
    outsider.send({ type: 'join', code });
    await outsider.waitFor('error', ({ code }) => code === 'room_full');
    outsider.send({ type: 'shoot', dx: 1, dy: 0, power: 1 });
    await outsider.waitFor('error', ({ code }) => code === 'room_required');
    outsider.send({ type: 'create', bogus: 'client state' });
    await outsider.waitFor('error', ({ code }) => code === 'invalid_message');
    guest.send({ type: 'shoot', dx: 1, dy: 0, power: 1 });
    await guest.waitFor('error', ({ code }) => code === 'not_your_turn');
    host.send({ type: 'restart' });
    await host.waitFor('error', ({ code }) => code === 'game_in_progress');
    host.send({ type: 'shoot', dx: 0, dy: 0, power: 1 });
    await host.waitFor('error', ({ code }) => code === 'invalid_message');

    host.send({ type: 'shoot', dx: -1, dy: 0, power: 0.07 });
    await guest.waitFor('state', ({ shots, settled }) => shots === 1 && !settled);
    host.send({ type: 'shoot', dx: 1, dy: 0, power: 1 });
    await host.waitFor('error', ({ code }) => code === 'balls_moving');
    const stopped = await guest.waitFor('state', ({ shots, settled }) => shots === 1 && settled);
    assert.equal(stopped.turn, 2);
    assert.equal(stopped.ballInHand, true);
    assert.ok(!guestB.messages.some(({ shots }) => shots === 1));
    guest.send({ type: 'shoot', dx: 1, dy: 0, power: 1 });
    await guest.waitFor('error', ({ code }) => code === 'ball_in_hand');
    guest.send({ type: 'place', x: 0, y: 0 });
    await guest.waitFor('error', ({ code }) => code === 'bad_placement');
    guest.send({ type: 'place', x: 284, y: 300 });
    const moved = await host.waitFor('state', ({ shots, settled, ballInHand }) => shots === 1 && settled && !ballInHand);
    assert.equal(moved.balls.find(({ n }) => n === 0).x, 284);
    assert.equal(moved.balls.find(({ n }) => n === 0).y, 300);

    guest.socket.close();
    await host.waitFor('left');
    assert.ok(!guestB.messages.some(({ type }) => type === 'left'));
    outsider.send({ type: 'join', code });
    await outsider.waitFor('error', ({ code }) => code === 'room_not_found');
  } finally {
    for (const peer of connections) peer.socket.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
