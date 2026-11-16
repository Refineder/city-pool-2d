import { BALL_R, CUSHION, TABLE_H, TABLE_W } from '../src/config.js';
import { allStopped, legalBallPosition, placeCue, rack, shoot, step } from '../src/physics.js';

const maxShotFrames = 1200;
const groupOf = (number) => number >= 1 && number <= 7 ? 'solids' : number >= 9 ? 'stripes' : null;
const otherPlayer = (player) => player === 1 ? 2 : 1;
const otherGroup = (group) => group === 'solids' ? 'stripes' : 'solids';
const newSounds = () => ({ b: 0, r: 0, p: 0 });

export class PoolActionError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new PoolActionError(code);
}

export function createPoolGame(breaker = 1) {
  return {
    breaker,
    turn: breaker,
    balls: rack().map((ball) => ({ ...ball, rotation: 0 })),
    groups: { 1: null, 2: null },
    shot: null,
    shots: 0,
    ballInHand: false,
    gameOver: false,
    winner: null,
    lastFoul: null,
    sfx: newSounds(),
  };
}

function parseAction(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('invalid_message');
  const { type, dx, dy, power, x, y } = value;
  const fields = Object.keys(value).length;
  if (type === 'restart' && fields === 1) return { type };
  if (type === 'place' && fields === 3 && Number.isFinite(x) && Number.isFinite(y))
    return { type, x, y };
  if (
    type === 'shoot' && fields === 4 &&
    Number.isFinite(dx) && Math.abs(dx) <= 16384 &&
    Number.isFinite(dy) && Math.abs(dy) <= 16384 &&
    Math.hypot(dx, dy) >= 0.001 && Number.isFinite(power) && power > 0 && power <= 1
  ) return { type, dx, dy, power };
  fail('invalid_message');
}

export function applyPoolAction(game, player, value) {
  const move = parseAction(value);
  if (player !== 1 && player !== 2) fail('room_required');
  if (move.type === 'restart') {
    if (!game.gameOver) fail('game_in_progress');
    return Object.assign(game, createPoolGame(otherPlayer(game.breaker)));
  }
  if (game.gameOver) fail('game_over');
  if (game.turn !== player) fail('not_your_turn');
  if (game.shot || !allStopped(game.balls)) fail('balls_moving');
  const cue = game.balls[0];
  if (move.type === 'place') {
    if (!game.ballInHand) fail('placement_unavailable');
    if (!legalBallPosition(cue, game.balls, move.x, move.y)) fail('bad_placement');
    placeCue(cue, game.balls, move.x, move.y);
    game.ballInHand = false;
    return game;
  }
  if (game.ballInHand || cue.potted) fail('ball_in_hand');
  const remaining = { solids: 0, stripes: 0 };
  for (const ball of game.balls) {
    const group = groupOf(ball.number);
    if (group && !ball.potted) remaining[group]++;
  }
  const group = game.groups[player];
  game.shot = {
    player,
    opening: game.shots === 0,
    group,
    onEight: group ? remaining[group] === 0 : remaining.solids === 0 || remaining.stripes === 0,
    contact: null,
    rail: false,
    objectRails: new Set(),
    potted: [],
    frames: 0,
  };
  game.shots++;
  game.lastFoul = null;
  shoot(cue, move.dx, move.dy, move.power);
  return game;
}

function observeShot(shot, hit) {
  if (hit.type === 'ball') {
    if (shot.contact !== null) return;
    if (hit.first === 0) shot.contact = hit.second;
    else if (hit.second === 0) shot.contact = hit.first;
  } else if (shot.contact !== null) {
    shot.rail = true;
    if (hit.number !== 0) shot.objectRails.add(hit.number);
  }
}

function foulFor(shot, pocketed) {
  if (shot.potted.includes(0)) return 'scratch';
  if (shot.contact === null) return 'no_contact';
  if (shot.opening)
    return pocketed.length || shot.objectRails.size >= 4 ? null : 'illegal_break';
  if (shot.contact === 8 ? !shot.onEight :
      shot.group && (shot.onEight || groupOf(shot.contact) !== shot.group))
    return 'wrong_first_ball';
  return pocketed.length || shot.rail ? null : 'no_rail';
}

function spotEight(game) {
  const ball = game.balls.find((ball) => ball.number === 8);
  const foot = CUSHION + TABLE_W * 0.72;
  const y = CUSHION + TABLE_H / 2;
  // A row of candidate spots cannot all be occupied by the fifteen other balls.
  for (let offset = 0; offset <= TABLE_W; offset += BALL_R * 2) {
    for (const x of [foot + offset, foot - offset]) {
      if (!legalBallPosition(ball, game.balls, x, y)) continue;
      Object.assign(ball, { x, y, vx: 0, vy: 0, potted: false, rotation: 0 });
      return;
    }
  }
}

function settle(game) {
  const shot = game.shot;
  const { player } = shot;
  const next = otherPlayer(player);
  const pocketed = shot.potted.filter((number) => number !== 0);
  const foul = foulFor(shot, pocketed);
  game.shot = null;
  game.lastFoul = foul;
  if (pocketed.includes(8)) {
    if (!shot.opening) {
      game.gameOver = true;
      game.winner = !foul && shot.onEight && shot.contact === 8 ? player : next;
      return;
    }
    spotEight(game);
  }

  let group = shot.group;
  if (!foul && !group && !shot.opening) {
    group = pocketed.map(groupOf).find(Boolean) ?? null;
    if (group) game.groups = { [player]: group, [next]: otherGroup(group) };
  }
  const keepsTurn = !foul && (shot.opening ? pocketed.length > 0 :
    group !== null && pocketed.some((number) => groupOf(number) === group));
  if (!keepsTurn) game.turn = next;
  game.ballInHand = foul !== null;
}

export function tickPoolGame(game) {
  const shot = game.shot;
  if (!shot) return false;
  const { potted, hits } = step(game.balls, (contact) => observeShot(shot, contact));
  for (const hit of hits) {
    if (hit.type === 'ball') game.sfx.b = Math.max(game.sfx.b, hit.speed);
    else game.sfx.r = Math.max(game.sfx.r, hit.speed);
  }
  game.sfx.p += potted.length;
  shot.potted.push(...potted.map((ball) => ball.number));
  for (const ball of game.balls) {
    if (ball.potted) continue;
    const speed = Math.hypot(ball.vx, ball.vy);
    ball.rotation = (ball.rotation + (ball.vx >= 0 ? 1 : -1) * speed * 0.04) % (2 * Math.PI);
  }
  if (++shot.frames === maxShotFrames) {
    for (const ball of game.balls) ball.vx = ball.vy = 0;
  }
  if (allStopped(game.balls)) settle(game);
  return true;
}

export function poolSnapshot(game) {
  return {
    type: 'state',
    turn: game.turn,
    settled: game.shot === null,
    cuePotted: game.balls[0].potted,
    ballInHand: game.ballInHand,
    shots: game.shots,
    groups: { ...game.groups },
    gameOver: game.gameOver,
    winner: game.winner,
    lastFoul: game.lastFoul,
    sfx: { ...game.sfx },
    balls: game.balls.map(({ number, x, y, rotation, potted }) => ({
      n: number,
      x: Math.round(x * 1000) / 1000,
      y: Math.round(y * 1000) / 1000,
      r: Math.round(rotation * 1000) / 1000,
      p: potted,
    })),
  };
}

export function consumePoolSounds(game) {
  game.sfx = newSounds();
}
