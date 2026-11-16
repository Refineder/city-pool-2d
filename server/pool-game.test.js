import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPoolGame, poolSnapshot, tickPoolGame, applyPoolAction,
} from './pool-game.js';

function play(game, player, power = 0.35, dx = 1, dy = 0) {
  applyPoolAction(game, player, { type: 'shoot', dx, dy, power });
  for (let frame = 0; game.shot && frame < 2400; frame++) tickPoolGame(game);
  assert.equal(game.shot, null);
  return poolSnapshot(game);
}

function nearPocket(number, options = {}) {
  const game = createPoolGame();
  game.shots = options.breakShot ? 0 : 1;
  game.groups = options.groups ?? { 1: null, 2: null };
  for (const ball of game.balls) {
    ball.potted = ![0, number, ...(options.other ?? [])].includes(ball.number);
    if (ball.number === 0) Object.assign(ball, { x: 365, y: 43 });
    if (ball.number === number) Object.assign(ball, { x: 398, y: 43 });
  }
  return game;
}

test('the rack centers the eight, uses opposite rear groups, and begins on an open table', () => {
  const game = createPoolGame();
  assert.equal(game.balls.length, 16);
  assert.equal(game.balls.find((ball) => ball.number === 8).y, game.balls[0].y);
  const back = game.balls.toSorted((a, b) => b.x - a.x).slice(0, 5).sort((a, b) => a.y - b.y);
  assert.ok(back[0].number <= 7 && back.at(-1).number >= 9);
  assert.deepEqual(poolSnapshot(game).groups, { 1: null, 2: null });
});

test('strictly validates turn, motion, foul handling and legal placement', () => {
  const game = createPoolGame();
  assert.throws(() => applyPoolAction(game, 2, { type: 'shoot', dx: 1, dy: 0, power: 1 }), /not_your_turn/);
  assert.throws(() => applyPoolAction(game, 1, { type: 'shoot', dx: Infinity, dy: 0, power: 1 }), /invalid_message/);
  assert.throws(() => applyPoolAction(game, 1, { type: 'restart' }), /game_in_progress/);
  assert.throws(() => applyPoolAction(game, 1, { type: 'place', x: 200, y: 200 }), /placement_unavailable/);
  applyPoolAction(game, 1, { type: 'shoot', dx: -1, dy: 0, power: 0.07 });
  assert.equal(poolSnapshot(game).settled, false);
  assert.throws(() => applyPoolAction(game, 1, { type: 'shoot', dx: 1, dy: 0, power: 0.2 }), /balls_moving/);
  for (let frame = 0; game.shot && frame < 500; frame++) tickPoolGame(game);
  const foul = poolSnapshot(game);
  assert.equal(foul.turn, 2);
  assert.equal(foul.settled, true);
  assert.equal(foul.ballInHand, true);
  assert.equal(foul.lastFoul, 'no_contact');
  assert.throws(() => applyPoolAction(game, 2, { type: 'place', x: 30, y: 30 }), /bad_placement/);
  const object = game.balls.find((ball) => ball.number === 1);
  assert.throws(() => applyPoolAction(game, 2, { type: 'place', x: object.x, y: object.y }), /bad_placement/);
  applyPoolAction(game, 2, { type: 'place', x: 284, y: 300 });
  assert.equal(poolSnapshot(game).ballInHand, false);
  assert.equal(poolSnapshot(game).balls[0].x, 284);
});

test('the first legal pot after the break assigns groups and retains the turn', () => {
  const game = nearPocket(1, { other: [8, 11] });
  const snapshot = play(game, 1);
  assert.ok(snapshot.balls.find((ball) => ball.n === 1).p);
  assert.deepEqual(snapshot.groups, { 1: 'solids', 2: 'stripes' });
  assert.equal(snapshot.turn, 1);
});

test('a real scratch and a soft contact without a later rail each award ball in hand', () => {
  const scratch = createPoolGame();
  scratch.shots = 1;
  Object.assign(scratch.balls[0], { x: 480, y: 43 });
  const pocketed = play(scratch, 1, 0.15);
  assert.equal(pocketed.cuePotted, true);
  assert.equal(pocketed.lastFoul, 'scratch');
  assert.equal(pocketed.ballInHand, true);
  assert.equal(pocketed.turn, 2);

  const soft = createPoolGame();
  soft.shots = 1;
  Object.assign(soft.balls[0], { x: 450, y: 300 });
  Object.assign(soft.balls.find((ball) => ball.number === 1), { x: 480, y: 300 });
  const result = play(soft, 1, 0.04);
  assert.equal(result.lastFoul, 'no_rail');
  assert.equal(result.ballInHand, true);
});

test('8-ball early/wrong contact loses, legal 8-ball wins, and 8 on the break respots', () => {
  const groups = { 1: 'solids', 2: 'stripes' };
  const premature = nearPocket(8, { groups, other: [1, 10] });
  assert.equal(play(premature, 1).winner, 2);
  const legal = nearPocket(8, { groups, other: [10] });
  assert.equal(play(legal, 1).winner, 1);
  const fresh = applyPoolAction(legal, 2, { type: 'restart' });
  assert.equal(fresh.turn, 2);
  assert.equal(fresh.shots, 0);
  assert.equal(fresh.gameOver, false);
  const breakShot = nearPocket(8, { breakShot: true, other: [1, 10] });
  const state = play(breakShot, 1);
  assert.equal(state.balls.find((ball) => ball.n === 8).p, false);
  assert.equal(state.winner, null);
  assert.deepEqual(state.groups, { 1: null, 2: null });
});
