import { t } from './i18n.js';
import { BALL_COLORS } from './config.js';

export const el = (id) => document.getElementById(id);

export function showScreen(id, focus = true) {
  document.querySelectorAll('.screen').forEach((screen) => {
    screen.hidden = screen.id !== id;
    screen.classList.toggle('active', screen.id === id);
  });
  if (focus) el(id).querySelector('input, button')?.focus();
}

export function toast(key) {
  const node = el('toast');
  node.textContent = t(key);
  node.classList.add('show');
  clearTimeout(node.toastTimer);
  node.toastTimer = setTimeout(() => {
    node.classList.remove('show');
    node.textContent = '';
  }, 4200);
}

export function enterGame() {
  el('menu').hidden = true;
  el('hud').hidden = false;
  el('app').inert = false;
  el('app').querySelector('canvas').focus({ preventScroll: true });
}

export function backToMenu() {
  el('confirm-modal').close();
  el('menu').hidden = false;
  el('hud').hidden = true;
  el('hint').hidden = true;
  el('balls-left').hidden = true;
  el('app').inert = true;
  showScreen('screen-main');
}

export function updateTurn(key, tone, detailKey) {
  const status = el('turn-status');
  const detail = el('turn-detail');
  setText(el('hud-turn'), key ? t(key) : '');
  setText(detail, detailKey ? t(detailKey) : '');
  if (detail.hidden === Boolean(detailKey)) detail.hidden = !detailKey;
  if (status.dataset.tone !== tone) status.dataset.tone = tone;
  if (status.hidden === Boolean(key)) status.hidden = !key;
}

export function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

export function setStatus(id, key, error = false) {
  const node = el(id);
  node.dataset.status = key;
  setText(node, key ? t(key) : '');
  node.classList.toggle('error', error);
}

export function translateStatuses() {
  for (const id of ['host-status', 'join-status']) {
    const node = el(id);
    setStatus(id, node.dataset.status ?? '', node.classList.contains('error'));
  }
}

export function setMuteLabel(muted) {
  const node = el('btn-mute');
  setText(node, t(muted ? 'unmute' : 'mute'));
  node.setAttribute('aria-pressed', String(muted));
}

export function updateBallsLeft(mode, balls, groups, seat, lang) {
  const box = el('balls-left');
  box.hidden = mode !== 'online' || !groups[seat];
  if (box.hidden) return;
  const signature = `${lang}/${groups[seat]}/${balls.filter((ball) => ball.potted).map((ball) => ball.number).join(',')}`;
  if (box.dataset.balls === signature) return;
  box.dataset.balls = signature;
  box.replaceChildren();

  for (const player of [seat, seat === 1 ? 2 : 1]) {
    const group = groups[player];
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('span');
    label.className = 'lbl';
    const groupBalls = balls.filter((ball) => group === 'solids' ? ball.number >= 1 && ball.number <= 7 : ball.number >= 9);
    label.textContent = `${t(player === seat ? 'you' : 'rival')} · ${groupBalls.filter((ball) => !ball.potted).length}`;
    row.appendChild(label);

    for (const ball of groupBalls) {
      const dot = document.createElement('span');
      dot.className = ball.potted ? 'dot gone' : 'dot';
      dot.style.background = `#${BALL_COLORS[ball.number].toString(16).padStart(6, '0')}`;
      dot.setAttribute('aria-hidden', 'true');
      row.appendChild(dot);
    }
    box.appendChild(row);
  }
}

export function confirm(key) {
  const dialog = el('confirm-modal');
  el('confirm-text').textContent = t(key);
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'accept'), { once: true });
  });
}
