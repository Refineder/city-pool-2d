import { randomInt } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  applyPoolAction, consumePoolSounds, createPoolGame, PoolActionError, poolSnapshot, tickPoolGame,
} from './pool-game.js';

const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const roomLimit = 48;
const connectionLimit = 2 * roomLimit + 16;
const maxMessageBytes = 256;
const maxBufferedBytes = 64 * 1024;
const open = 1;
const frameMs = 1000 / 60;
const snapshotMs = 1000 / 30 - 1;
const idleSocketMs = 60_000;
const idleRoomMs = 10 * 60_000;
const idleGameMs = 30 * 60_000;
const sweepMs = 25_000;

function send(socket, message) {
  if (socket?.readyState !== open) return;
  if (socket.bufferedAmount > maxBufferedBytes) {
    socket.terminate();
    return;
  }
  socket.send(typeof message === 'string' ? message : JSON.stringify(message));
}

function sendError(socket, code) {
  send(socket, { type: 'error', code });
}

function parseMessage(raw, binary) {
  if (binary || !Buffer.isBuffer(raw) || raw.byteLength > maxMessageBytes)
    throw new PoolActionError('invalid_message');
  try {
    const value = JSON.parse(raw.toString('utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.type === 'string')
      return value;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  throw new PoolActionError('invalid_message');
}

export function attachPoolRooms(wss) {
  const rooms = new Map();
  const clients = new Map();
  let previous = performance.now();

  function closeRoom(room, departure) {
    if (!rooms.delete(room.code)) return;
    const now = Date.now();
    for (const member of room.members) {
      member.room = null;
      member.player = null;
      member.idleAt = now;
      if (member !== departure) send(member.socket, { type: 'left' });
    }
  }

  function sendState(room) {
    const state = JSON.stringify(poolSnapshot(room.game));
    for (const { socket } of room.members) send(socket, state);
    consumePoolSounds(room.game);
    room.broadcastAt = performance.now();
  }

  function start(room) {
    const { turn, groups } = room.game;
    const message = { type: 'start', turn, groups };
    for (const { socket } of room.members) send(socket, message);
    sendState(room);
  }

  function addRoom(client) {
    if (rooms.size >= roomLimit) throw new PoolActionError('capacity');
    let code;
    do {
      code = Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join('');
    } while (rooms.has(code));
    const room = { code, members: [client], game: null, updatedAt: Date.now(), broadcastAt: 0 };
    client.room = room;
    client.player = 1;
    rooms.set(code, room);
    send(client.socket, { type: 'created', code });
  }

  function joinRoom(client, code) {
    const room = rooms.get(code);
    if (!room || room.members[0].socket.readyState !== open)
      throw new PoolActionError('room_not_found');
    if (room.members.length === 2) throw new PoolActionError('room_full');
    client.room = room;
    client.player = 2;
    room.members.push(client);
    room.game = createPoolGame();
    room.updatedAt = Date.now();
    start(room);
  }

  function handle(client, value) {
    if (value.type === 'create' || value.type === 'join') {
      if (client.room) throw new PoolActionError('already_in_room');
      if (value.type === 'create' && Object.keys(value).length === 1) {
        addRoom(client);
        return;
      }
      if (value.type === 'join' && Object.keys(value).length === 2 &&
          typeof value.code === 'string' && /^[A-Z2-9]{4}$/i.test(value.code)) {
        joinRoom(client, value.code.toUpperCase());
        return;
      }
      throw new PoolActionError('invalid_message');
    }
    if (!['shoot', 'place', 'restart'].includes(value.type))
      throw new PoolActionError('invalid_message');
    const { room, player } = client;
    if (!room?.game) throw new PoolActionError('room_required');
    applyPoolAction(room.game, player, value);
    room.updatedAt = Date.now();
    if (value.type === 'restart') start(room);
    else sendState(room);
  }

  function onConnection(socket) {
    if (clients.size >= connectionLimit) {
      sendError(socket, 'capacity');
      socket.close(1013, 'Capacity');
      return;
    }
    const now = Date.now();
    const client = { socket, room: null, player: null, idleAt: now, windowAt: now, messages: 0, alive: true };
    clients.set(socket, client);
    socket.on('pong', () => { client.alive = true; });
    socket.on('error', () => socket.terminate());
    socket.on('close', () => {
      clients.delete(socket);
      if (client.room) closeRoom(client.room, client);
    });
    socket.on('message', (raw, binary) => {
      const timestamp = Date.now();
      if (timestamp - client.windowAt >= 1000) {
        client.windowAt = timestamp;
        client.messages = 0;
      }
      if (++client.messages > 16) {
        if (client.messages === 17) sendError(socket, 'rate_limited');
        if (client.messages > 64) socket.close(1008, 'Rate limit');
        return;
      }
      try {
        handle(client, parseMessage(raw, binary));
      } catch (error) {
        if (error instanceof PoolActionError) sendError(socket, error.code);
        else socket.close(1011, 'Game unavailable');
      }
    });
  }

  const clock = setInterval(() => {
    const now = performance.now();
    const elapsed = Math.floor((now - previous) / frameMs);
    if (!elapsed) return;
    previous += elapsed * frameMs;
    for (const room of rooms.values()) {
      const game = room.game;
      if (!game?.shot) continue;
      for (let frame = 0; frame < Math.min(5, elapsed) && game.shot; frame++)
        tickPoolGame(game);
      if (!game.shot || now - room.broadcastAt >= snapshotMs) sendState(room);
    }
  }, frameMs);
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values())
      if (now - room.updatedAt > (room.game ? idleGameMs : idleRoomMs)) closeRoom(room);
    for (const client of clients.values()) {
      if (!client.alive || (!client.room && now - client.idleAt > idleSocketMs))
        client.socket.terminate();
      else if (client.socket.readyState === open) {
        client.alive = false;
        client.socket.ping();
      }
    }
  }, sweepMs);
  clock.unref();
  sweep.unref();
  wss.on('connection', onConnection);
  wss.once('close', () => {
    clearInterval(clock);
    clearInterval(sweep);
    wss.off('connection', onConnection);
    clients.clear();
    rooms.clear();
  });
}
