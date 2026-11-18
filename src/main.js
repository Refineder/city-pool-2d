import 'pixi.js/unsafe-eval';
import { Application, Container, Graphics } from 'pixi.js';
import { BALL_R, CANVAS_W, CANVAS_H, CUSHION, MAX_DRAG, MIN_DRAG, POWER_CURVE } from './config.js';
import { rack, step, allStopped, shoot, placeCue, legalBallPosition } from './physics.js';
import { drawTable, buildBallVisual, drawAim, initBallTextures } from './scene.js';
import { connectRoom, validCode } from './net.js';
import * as ui from './ui.js';
import * as audio from './audio.js';
import { t, setLang, getLang, applyStatic } from './i18n.js';
import './pool.css';

const groupOf = (number) => number >= 1 && number <= 7 ? 'solids' : number >= 9 ? 'stripes' : null;
const capacityErrors = new Set(['capacity', 'rate_limited']);
const practiceFrameMs = 1000 / 60;
const groupValid = (group) => group === null || group === 'solids' || group === 'stripes';

const game = {
  mode: null, seat: 1, turn: 1, balls: [], cue: null, sprites: new Map(),
  shots: 0, settled: true, groups: { 1: null, 2: null }, gameOver: false,
  winner: null, ballInHand: false, ready: false, net: null, pending: null,
};

let app, ballLayer, aimLine;
let lastPhysics = 0;
let input;
const hintKey = () => {
  if (game.gameOver || !game.settled || (game.mode === 'online' && game.seat !== game.turn)) return '';
  if (game.ballInHand) return input?.keyboard ? 'keyboardPlace' : 'placeCueHint';
  return input?.keyboard ? 'keyboardHint' : 'aimHint';
};

async function main() {
  applyStatic();
  ui.el('city-link').hidden = window.parent !== window;
  ui.el('btn-help').addEventListener('click', () => ui.el('pool-help').showModal());
  app = new Application();
  await app.init({ width: CANVAS_W, height: CANVAS_H, backgroundAlpha: 0, antialias: true, preference: 'webgl' });
  app.ticker.maxFPS = 60;
  app.canvas.tabIndex = 0;
  app.canvas.setAttribute('aria-describedby', 'hint keyboard-help');
  ui.el('app').appendChild(app.canvas);
  ballLayer = new Container();
  aimLine = new Graphics();
  app.stage.addChild(drawTable(), ballLayer, aimLine);
  initBallTextures(app.renderer);
  setupRack();
  input = setupInput();
  wireMenu();
  refreshHud();
  app.ticker.add(renderFrame);

  lastPhysics = performance.now();
  window.setInterval(practiceLoop, practiceFrameMs);
}

function setupRack() {
  for (const sprite of ballLayer.removeChildren()) sprite.destroy({ children: true });
  game.balls = rack();
  game.cue = game.balls[0];
  game.sprites.clear();
  for (const ball of game.balls) {
    const sprite = buildBallVisual(ball);
    game.sprites.set(ball.number, sprite);
    ballLayer.addChild(sprite);
    ball.tx = ball.x;
    ball.ty = ball.y;
  }
  Object.assign(game, {
    shots: 0, settled: true, groups: { 1: null, 2: null }, gameOver: false, winner: null, ballInHand: false,
  });
  input?.reset();
  if (game.mode) refreshHud();
}

function renderFrame() {
  for (const ball of game.balls) {
    const sprite = game.sprites.get(ball.number);
    sprite.visible = !ball.potted;
    if (ball.potted) continue;
    if (game.mode === 'online') {
      ball.x += (ball.tx - ball.x) * 0.45;
      ball.y += (ball.ty - ball.y) * 0.45;
    }
    sprite.position.set(ball.x, ball.y);
  }
}

function practiceLoop() {
  const now = performance.now();
  const elapsedFrames = Math.floor((now - lastPhysics) / practiceFrameMs);
  if (elapsedFrames < 1) return;
  const frames = Math.min(8, elapsedFrames);
  lastPhysics = elapsedFrames > frames ? now : lastPhysics + frames * practiceFrameMs;
  if (game.mode !== 'solo' || game.settled) return;

  for (let frame = 0; frame < frames; frame++) {
    const { potted, hits } = step(game.balls);
    if (!document.hidden) {
      for (const hit of hits) {
        if (hit.type === 'ball') audio.ballHit(hit.speed);
        else audio.railHit(hit.speed);
      }
      for (let index = 0; index < potted.length; index++) audio.pocket();
    }
    for (const ball of game.balls) {
      if (!ball.potted) game.sprites.get(ball.number).spin.rotation +=
        (ball.vx >= 0 ? 1 : -1) * Math.hypot(ball.vx, ball.vy) * 0.04;
    }
    if (allStopped(game.balls)) {
      game.settled = true;
      game.ballInHand = game.cue.potted;
      game.gameOver = game.balls.every((ball) => ball.number === 0 || ball.potted);
      if (game.gameOver) audio.win();
      refreshHud();
      return;
    }
    if (potted.length) refreshHud();
  }
}

function refreshHud() {
  const mine = game.turn === game.seat;
  const group = game.groups[game.seat];
  if (!game.mode) ui.updateTurn('', '', '');
  else if (game.gameOver) {
    const key = game.mode === 'solo' ? 'soloDone' : game.winner === game.seat ? 'won' : 'lost';
    ui.updateTurn(key, key === 'lost' ? 'rival' : 'complete', '');
  } else if (!game.ready) ui.updateTurn('connecting', 'neutral', '');
  else if (!game.settled) ui.updateTurn('shooting', 'neutral', '');
  else ui.updateTurn(
    game.mode === 'solo' ? 'practiceTable' : mine ? 'yourTurn' : 'rivalTurn',
    mine ? 'mine' : 'rival',
    game.ballInHand && mine ? 'ballInHand' : '',
  );
  const groupNode = ui.el('hud-group');
  groupNode.hidden = game.mode !== 'online';
  ui.setText(groupNode, t(group ?? 'openTable'));
  ui.setText(ui.el('hud-shots'), String(game.shots));
  const objectBalls = game.balls.filter((ball) => game.mode === 'online' ? group && groupOf(ball.number) === group : ball.number !== 0);
  ui.setText(ui.el('hud-potted'), `${objectBalls.filter((ball) => ball.potted).length}/${game.mode === 'online' ? 7 : 15}`);
  ui.el('hud-potted').parentElement.hidden = game.mode === 'online' && !group;
  ui.updateBallsLeft(game.mode, game.balls, game.groups, game.seat, getLang());

  const restart = ui.el('btn-restart');
  restart.hidden = game.mode === 'online' && !game.gameOver;
  restart.disabled = Boolean(game.pending);
  ui.setText(restart, t(game.mode === 'online' ? 'rematch' : 'restart'));
  ui.setMuteLabel(audio.isMuted());
  app.canvas.setAttribute('aria-label', t('tableLabel'));
  const hint = hintKey();
  ui.setText(ui.el('hint'), hint ? t(hint) : '');
  ui.el('hint').hidden = !game.mode || !hint;
  const keyboardHelp = !input?.keyboard && hint ? t(game.ballInHand ? 'keyboardPlace' : 'keyboardHint') : '';
  ui.setText(ui.el('keyboard-help'), keyboardHelp);

  const data = ui.el('app').dataset;
  if (!game.mode) {
    delete data.mode;
    return;
  }
  data.mode = game.mode;
  data.seat = game.seat;
  data.turn = game.turn;
  data.settled = game.settled && game.ready;
  data.shots = game.shots;
  data.ballInHand = game.ballInHand;
  data.cueX = game.mode === 'online' ? game.cue.tx : game.cue.x;
  data.cueY = game.mode === 'online' ? game.cue.ty : game.cue.y;
  data.cuePotted = game.cue.potted;
}

function permitsMove() {
  return Boolean(game.mode && game.ready && !game.gameOver && !game.pending && game.settled &&
    (game.mode === 'solo' || game.turn === game.seat));
}

function canShoot() { return permitsMove() && !game.ballInHand && !game.cue.potted; }
function canPlace() { return permitsMove() && game.ballInHand; }

function sendAction(move) {
  if (game.pending || !game.net?.send(move)) return;
  game.pending = move.type;
  refreshHud();
}

function strike(dx, dy, power) {
  if (!canShoot() || !power || Math.hypot(dx, dy) < 0.001) return;
  if (game.mode === 'online') {
    sendAction({ type: 'shoot', dx, dy, power });
    return;
  }
  shoot(game.cue, dx, dy, power);
  audio.cueStrike();
  game.shots++;
  game.settled = false;
  refreshHud();
}

function placeAt(x, y) {
  if (!canPlace()) return;
  if (!legalBallPosition(game.cue, game.balls, x, y)) {
    ui.toast('badPlacement');
    return;
  }
  if (game.mode === 'online') {
    sendAction({ type: 'place', x, y });
    return;
  }
  placeCue(game.cue, game.balls, x, y);
  game.ballInHand = false;
  refreshHud();
}

function validSnapshot(state) {
  return [1, 2].includes(state.turn) && typeof state.settled === 'boolean' &&
    typeof state.ballInHand === 'boolean' && typeof state.gameOver === 'boolean' &&
    [null, 1, 2].includes(state.winner) && Number.isSafeInteger(state.shots) && state.shots >= 0 &&
    state.groups && groupValid(state.groups[1]) && groupValid(state.groups[2]) &&
    Array.isArray(state.balls) && state.balls.length === 16 &&
    new Set(state.balls.map((ball) => ball?.n)).size === 16 &&
    state.balls.every((ball) => ball && Number.isInteger(ball.n) && ball.n >= 0 && ball.n <= 15 &&
      [ball.x, ball.y, ball.r].every(Number.isFinite) && typeof ball.p === 'boolean');
}

function applyState(state) {
  if (!validSnapshot(state)) return;
  const wasReady = game.ready;
  const previousTurn = game.turn;
  const previousShots = game.shots;
  const wasOver = game.gameOver;
  const hadBallInHand = game.ballInHand;
  if (!wasReady) input.reset();
  if ((game.pending === 'shoot' && state.shots > previousShots) ||
      (game.pending === 'place' && !state.ballInHand) ||
      (game.pending === 'restart' && !state.gameOver)) game.pending = null;

  Object.assign(game, {
    ready: true, turn: state.turn, settled: state.settled, shots: state.shots, groups: state.groups,
    gameOver: state.gameOver, winner: state.winner, ballInHand: state.ballInHand,
  });
  for (const snapshot of state.balls) {
    const ball = game.balls.find(({ number }) => number === snapshot.n);
    ball.tx = snapshot.x;
    ball.ty = snapshot.y;
    if (state.settled || !wasReady || ball.potted) {
      ball.x = snapshot.x;
      ball.y = snapshot.y;
    }
    ball.potted = snapshot.p;
    game.sprites.get(ball.number).spin.rotation = snapshot.r;
  }

  if (!document.hidden) {
    if (wasReady && state.shots > previousShots) audio.cueStrike();
    if (state.sfx?.b > 0) audio.ballHit(state.sfx.b);
    if (state.sfx?.r > 0) audio.railHit(state.sfx.r);
    for (let i = 0; i < Math.min(16, state.sfx?.p ?? 0); i++) audio.pocket();
  }
  if (game.ballInHand && !hadBallInHand) input.reset();
  if (game.gameOver && !wasOver) {
    if (game.winner === game.seat) audio.win();
    else audio.lose();
  } else if ((!wasReady || game.turn !== previousTurn) && game.turn === game.seat) {
    audio.turnChime();
  }
  refreshHud();
}

function setupInput() {
  const canvas = app.canvas;
  let pointer = null;
  let angle = 0;
  let power = 0.6;
  let placement = null;
  let keyboard = false;

  function point(event) {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * CANVAS_W / bounds.width,
      y: (event.clientY - bounds.top) * CANVAS_H / bounds.height,
    };
  }

  function showPower(value) {
    ui.el('power-level').value = value;
    ui.el('power').hidden = false;
  }

  function clearAim() {
    aimLine.clear();
    ui.el('power').hidden = true;
  }

  function reset() {
    pointer = null;
    placement = null;
    angle = 0;
    power = 0.6;
    clearAim();
  }

  function pointerAim(position) {
    const dx = game.cue.x - position.x;
    const dy = game.cue.y - position.y;
    const pull = Math.min(Math.hypot(dx, dy), MAX_DRAG);
    const strength = (pull / MAX_DRAG) ** POWER_CURVE;
    drawAim(aimLine, game.cue, position.x, position.y, strength);
    showPower(strength);
    return { dx, dy, strength };
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    canvas.focus({ preventScroll: true });
    audio.resume();
    keyboard = false;
    refreshHud();
    const position = point(event);
    if (canPlace()) { placeAt(position.x, position.y); return; }
    if (!canShoot()) return;
    pointer = { id: event.pointerId, ...position };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (pointer?.id === event.pointerId && canShoot()) pointerAim(point(event));
  });
  canvas.addEventListener('pointerup', (event) => {
    if (pointer?.id !== event.pointerId) return;
    const position = point(event);
    if (canShoot() && Math.hypot(position.x - pointer.x, position.y - pointer.y) > MIN_DRAG) {
      const { dx, dy, strength } = pointerAim(position);
      strike(dx, dy, strength);
    }
    pointer = null;
    clearAim();
  });
  for (const event of ['pointercancel', 'lostpointercapture', 'blur']) {
    canvas.addEventListener(event, () => { pointer = null; clearAim(); });
  }

  canvas.addEventListener('keydown', (event) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Enter'];
    if (!keys.includes(event.key) || (!canShoot() && !canPlace())) return;
    event.preventDefault();
    audio.resume();
    keyboard = true;
    refreshHud();
    const submit = event.key === ' ' || event.key === 'Enter';
    if (canPlace()) {
      placement ??= { x: CUSHION + 250, y: CANVAS_H / 2 };
      if (submit) {
        placeAt(placement.x, placement.y);
        clearAim();
        return;
      }
      if (event.key === 'ArrowLeft') placement.x -= 16;
      if (event.key === 'ArrowRight') placement.x += 16;
      if (event.key === 'ArrowUp') placement.y -= 16;
      if (event.key === 'ArrowDown') placement.y += 16;
      placement.x = Math.min(CANVAS_W - CUSHION - BALL_R, Math.max(CUSHION + BALL_R, placement.x));
      placement.y = Math.min(CANVAS_H - CUSHION - BALL_R, Math.max(CUSHION + BALL_R, placement.y));
      const legal = legalBallPosition(game.cue, game.balls, placement.x, placement.y);
      aimLine.clear().circle(placement.x, placement.y, BALL_R)
        .fill({ color: legal ? 0xffffff : 0xf78080, alpha: 0.65 });
      return;
    }
    const rotation = event.shiftKey ? 0.015 : 0.065;
    if (event.key === 'ArrowLeft') angle -= rotation;
    if (event.key === 'ArrowRight') angle += rotation;
    if (event.key === 'ArrowUp') power = Math.min(1, power + 0.05);
    if (event.key === 'ArrowDown') power = Math.max(0.09, power - 0.05);
    const dx = Math.cos(angle), dy = Math.sin(angle);
    if (submit && !event.repeat) {
      strike(dx, dy, power);
      clearAim();
    } else if (!submit) {
      const pull = MAX_DRAG * power ** (1 / POWER_CURVE);
      drawAim(aimLine, game.cue, game.cue.x - dx * pull, game.cue.y - dy * pull, power);
      showPower(power);
    }
  });
  return { get keyboard() { return keyboard; }, reset };
}

function closeRoom() {
  game.net?.close();
  game.net = null;
  game.pending = null;
  game.ready = false;
}

function leaveGame() {
  closeRoom();
  game.mode = null;
  game.seat = 1;
  game.turn = 1;
  setupRack();
  refreshHud();
  ui.backToMenu();
}

function beginOnline(seat, start) {
  game.mode = 'online';
  game.seat = seat;
  game.turn = start.turn;
  game.ready = false;
  game.pending = null;
  setupRack();
  game.groups = start.groups;
  refreshHud();
  ui.enterGame();
}

function openRoom(request) {
  closeRoom();
  const host = request.type === 'create';
  const seat = host ? 1 : 2;
  const status = host ? 'host-status' : 'join-status';
  const connectButton = ui.el('btn-connect');
  ui.setStatus(status, 'connecting');
  if (host) ui.el('host-code').textContent = '····';
  else connectButton.disabled = true;
  function roomEnded(message) {
    connectButton.disabled = false;
    if (game.mode === 'online') {
      leaveGame();
      ui.toast(message);
      return;
    }
    closeRoom();
    if (host) ui.el('host-code').textContent = '····';
    ui.setStatus(status, message, true);
  }

  game.net = connectRoom(request, {
    message(message) {
      if (host && message.type === 'created' && typeof message.code === 'string' && validCode(message.code)) {
        ui.el('host-code').textContent = message.code;
        ui.setStatus(status, 'waiting');
      } else if (message.type === 'start' && [1, 2].includes(message.turn) &&
          message.groups && groupValid(message.groups[1]) && groupValid(message.groups[2])) {
        connectButton.disabled = false;
        beginOnline(seat, message);
      } else if (message.type === 'state' && game.mode === 'online') {
        applyState(message);
      } else if (message.type === 'left') {
        roomEnded('rivalLeft');
      } else if (message.type === 'error') {
        if (game.mode !== 'online') {
          roomEnded(capacityErrors.has(message.code) ? 'serverBusy' : host ? 'closed' : 'notFound');
        } else {
          game.pending = null;
          ui.toast(message.code === 'bad_placement' ? 'badPlacement' : 'moveRejected');
          refreshHud();
        }
      }
    },
    closed(code) { roomEnded(code === 1008 ? 'sessionExpired' : 'closed'); },
  });
}

function wireMenu() {
  const click = (id, onClick) => ui.el(id).addEventListener('click', () => {
    audio.resume();
    audio.uiClick();
    onClick();
  });
  for (const button of document.querySelectorAll('[data-lang]')) {
    button.addEventListener('click', () => {
      setLang(button.dataset.lang);
      ui.translateStatuses();
      refreshHud();
    });
  }
  for (const button of document.querySelectorAll('[data-back]')) {
    button.addEventListener('click', () => {
      closeRoom();
      ui.el('btn-connect').disabled = false;
      ui.showScreen(button.dataset.back);
    });
  }

  click('btn-solo', () => {
    closeRoom();
    Object.assign(game, { mode: 'solo', seat: 1, turn: 1, ready: true });
    setupRack();
    ui.enterGame();
  });
  click('btn-multi', () => ui.showScreen('screen-mp'));
  click('btn-create', () => { ui.showScreen('screen-host'); openRoom({ type: 'create' }); });
  click('btn-join', () => { ui.setStatus('join-status', ''); ui.showScreen('screen-join'); });
  ui.el('join-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (ui.el('btn-connect').disabled) return;
    const code = ui.el('join-code').value.trim().toUpperCase();
    audio.resume();
    audio.uiClick();
    if (!validCode(code)) { ui.setStatus('join-status', 'code4', true); return; }
    openRoom({ type: 'join', code });
  });
  click('btn-mute', () => { audio.setMuted(!audio.isMuted()); ui.setMuteLabel(audio.isMuted()); });
  click('btn-restart', async () => {
    if (game.mode === 'online') {
      if (game.gameOver) sendAction({ type: 'restart' });
    } else if (await ui.confirm('confirmRestart')) {
      setupRack();
      app.canvas.focus();
    }
  });
  click('btn-menu', async () => { if (game.mode === 'solo' || await ui.confirm('confirmExit')) leaveGame(); });
}

main().catch((error) => {
  console.error('Unable to initialize the pool table', error);
  ui.el('render-error').hidden = false;
  for (const id of ['btn-solo', 'btn-multi']) ui.el(id).disabled = true;
});
