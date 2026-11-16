import { Container, Graphics, Text, Sprite, Rectangle, FillGradient } from 'pixi.js';
import { CANVAS_W, CANVAS_H, CUSHION, TABLE_W, TABLE_H, BALL_R, POCKET_R, BALL_COLORS } from './config.js';
import { pocketPositions } from './physics.js';

export function drawTable() {
  const g = new Graphics();

  const wood = new FillGradient({
    type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 },
    colorStops: [{ offset: 0, color: 0x9b6740 }, { offset: 0.48, color: 0x5e381f }, { offset: 1, color: 0x3b2418 }],
    textureSpace: 'local',
  });
  g.roundRect(0, 0, CANVAS_W, CANVAS_H, 16).fill(wood);
  g.roundRect(3, 3, CANVAS_W - 6, CANVAS_H - 6, 13).stroke({ width: 2, color: 0xffe2b0, alpha: 0.18 });

  g.roundRect(8, 8, CANVAS_W - 16, CANVAS_H - 16, 10).stroke({ width: 1, color: 0x291a12, alpha: 0.8 });
  g.roundRect(CUSHION - 9, CUSHION - 9, TABLE_W + 18, TABLE_H + 18, 5).fill(0x113f2a);
  g.roundRect(CUSHION - 9, CUSHION - 9, TABLE_W + 18, TABLE_H + 18, 5)
    .stroke({ width: 2, color: 0xa77746, alpha: 0.65 });

  const cloth = new FillGradient({
    type: 'radial',
    innerCenter: { x: 0.5, y: 0.42 }, innerRadius: 0.04,
    outerCenter: { x: 0.5, y: 0.5 }, outerRadius: 0.66,
    colorStops: [{ offset: 0, color: 0x208446 }, { offset: 0.7, color: 0x176f3b }, { offset: 1, color: 0x125735 }],
    textureSpace: 'local',
  });
  g.rect(CUSHION, CUSHION, TABLE_W, TABLE_H).fill(cloth);
  g.rect(CUSHION, CUSHION, TABLE_W, TABLE_H).stroke({ width: 8, color: 0x000000, alpha: 0.18 });
  g.rect(CUSHION + 2, CUSHION + 2, TABLE_W - 4, TABLE_H - 4).stroke({ width: 2, color: 0x000000, alpha: 0.12 });

  for (let row = 1; row < 75; row++) {
    const y = CUSHION + row * TABLE_H / 75;
    g.moveTo(CUSHION + 3, y).lineTo(CUSHION + TABLE_W - 3, y)
      .stroke({ width: 1, color: row % 2 ? 0xffffff : 0x000000, alpha: 0.012 });
  }
  for (const x of [CUSHION + TABLE_W * 0.25, CUSHION + TABLE_W * 0.72]) {
    g.circle(x, CUSHION + TABLE_H / 2, 3).fill({ color: 0xffffff, alpha: 0.19 });
  }

  const dots = [];
  for (const f of [0.125, 0.25, 0.375, 0.625, 0.75, 0.875]) {
    dots.push([CUSHION + TABLE_W * f, CUSHION / 2], [CUSHION + TABLE_W * f, CANVAS_H - CUSHION / 2]);
  }
  for (const f of [0.25, 0.5, 0.75]) {
    dots.push([CUSHION / 2, CUSHION + TABLE_H * f], [CANVAS_W - CUSHION / 2, CUSHION + TABLE_H * f]);
  }
  for (const [x, y] of dots) {
    g.poly([x, y - 4.5, x + 4.5, y, x, y + 4.5, x - 4.5, y])
      .fill(0xe7cf9f).stroke({ width: 1, color: 0x352215, alpha: 0.55 });
  }

  for (const p of pocketPositions()) {
    g.circle(p.x, p.y, POCKET_R + 6).fill({ color: 0x000000, alpha: 0.4 });
    g.circle(p.x, p.y, POCKET_R + 3).fill(0x4a3a1f);
    g.circle(p.x, p.y, POCKET_R + 3).stroke({ width: 2, color: 0xd9b15a, alpha: 0.7 });
    const hole = new FillGradient({
      type: 'radial', innerCenter: { x: 0.5, y: 0.4 }, innerRadius: 0, outerCenter: { x: 0.5, y: 0.5 }, outerRadius: 0.5,
      colorStops: [{ offset: 0, color: 0x101010 }, { offset: 1, color: 0x000000 }], textureSpace: 'local',
    });
    g.circle(p.x, p.y, POCKET_R).fill(hole);
  }

  return g;
}

function faceGraphics(number, color) {
  const g = new Container();
  const isCue = number === 0;
  const isStripe = number >= 9;

  g.addChild(new Graphics().circle(0, 0, BALL_R).fill(isCue || isStripe ? 0xffffff : color));

  if (isStripe) {
    const band = new Graphics().rect(-BALL_R, -BALL_R * 0.5, BALL_R * 2, BALL_R).fill(color);
    const mask = new Graphics().circle(0, 0, BALL_R).fill(0xffffff);
    g.addChild(band, mask);
    band.mask = mask;
  }

  if (!isCue) {
    g.addChild(new Graphics().circle(0, 0, BALL_R * 0.48).fill(0xfbf7ec));
    const label = new Text({ text: String(number), style: { fontFamily: 'Arial, sans-serif', fontSize: 9, fontWeight: 'bold', fill: 0x111111 } });
    label.anchor.set(0.5);
    g.addChild(label);
  }

  return g;
}

function overlayGraphics() {
  const g = new Container();
  const shade = new FillGradient({
    type: 'radial',
    innerCenter: { x: 0.38, y: 0.34 }, innerRadius: 0.1,
    outerCenter: { x: 0.5, y: 0.5 }, outerRadius: 0.52,
    colorStops: [
      { offset: 0, color: 'rgba(0,0,0,0)' },
      { offset: 0.65, color: 'rgba(0,0,0,0)' },
      { offset: 1, color: 'rgba(0,0,0,0.5)' },
    ],
    textureSpace: 'local',
  });
  g.addChild(new Graphics().circle(0, 0, BALL_R).fill(shade));
  g.addChild(new Graphics().ellipse(-BALL_R * 0.34, -BALL_R * 0.38, BALL_R * 0.4, BALL_R * 0.28).fill({ color: 0xffffff, alpha: 0.45 }));
  g.addChild(new Graphics().circle(-BALL_R * 0.4, -BALL_R * 0.44, BALL_R * 0.12).fill({ color: 0xffffff, alpha: 0.7 }));
  g.addChild(new Graphics().circle(0, 0, BALL_R).stroke({ width: 1, color: 0x000000, alpha: 0.25 }));
  return g;
}

let TEX = null;

export function initBallTextures(renderer) {
  if (TEX) return;

  const bake = (node, half) => {
    const texture = renderer.generateTexture({ target: node, frame: new Rectangle(-half, -half, half * 2, half * 2), resolution: 2, antialias: true });
    node.destroy({ children: true });
    return texture;
  };

  const R = BALL_R + 2;
  const faces = new Map();
  for (let n = 0; n <= 15; n++) faces.set(n, bake(faceGraphics(n, BALL_COLORS[n]), R));
  const shadow = new Graphics().ellipse(0, 0, BALL_R * 1.05, BALL_R * 0.9).fill({ color: 0x000000, alpha: 0.3 });

  TEX = {
    faces,
    overlay: bake(overlayGraphics(), R),
    shadow: bake(shadow, BALL_R + 4),
  };
}

export function buildBallVisual(ball) {
  const c = new Container();
  const shadow = new Sprite(TEX.shadow);
  shadow.anchor.set(0.5);
  shadow.position.set(2.5, 3.5);
  const face = new Sprite(TEX.faces.get(ball.number));
  face.anchor.set(0.5);
  const overlay = new Sprite(TEX.overlay);
  overlay.anchor.set(0.5);
  c.addChild(shadow, face, overlay);
  c.spin = face;
  return c;
}

export function drawAim(g, cue, mx, my, power = 1) {
  g.clear();
  const len = Math.hypot(cue.x - mx, cue.y - my) || 1;
  let dx = (cue.x - mx) / len, dy = (cue.y - my) / len;
  const start = BALL_R + 11 + power * 70;
  const cuePoint = (distance) => [cue.x - dx * distance, cue.y - dy * distance];
  g.moveTo(...cuePoint(start + 80)).lineTo(...cuePoint(start + 183))
    .stroke({ width: 9, color: 0x1d1712, cap: 'round' });
  g.moveTo(...cuePoint(start + 55)).lineTo(...cuePoint(start + 136))
    .stroke({ width: 6, color: 0x8c5439, cap: 'round' });
  g.moveTo(...cuePoint(start)).lineTo(...cuePoint(start + 61))
    .stroke({ width: 4, color: 0xe7cd96, cap: 'round' });
  g.moveTo(...cuePoint(start)).lineTo(...cuePoint(start + 5))
    .stroke({ width: 4, color: 0xa6d5df, cap: 'round' });
  let x = cue.x, y = cue.y, remaining = 50 + power * 260;
  const minX = CUSHION + BALL_R, maxX = CUSHION + TABLE_W - BALL_R;
  const minY = CUSHION + BALL_R, maxY = CUSHION + TABLE_H - BALL_R;

  g.moveTo(x, y);
  for (let bounces = 0; bounces < 3 && remaining > 0; bounces++) {
    let t = Infinity;
    if (dx > 0) t = Math.min(t, (maxX - x) / dx);
    else if (dx < 0) t = Math.min(t, (minX - x) / dx);
    if (dy > 0) t = Math.min(t, (maxY - y) / dy);
    else if (dy < 0) t = Math.min(t, (minY - y) / dy);
    t = Math.min(t, remaining);
    if (!isFinite(t) || t <= 0) break;

    const nx = x + dx * t, ny = y + dy * t;
    g.lineTo(nx, ny);
    remaining -= t;
    if (Math.abs(nx - minX) < 0.6 || Math.abs(nx - maxX) < 0.6) dx = -dx;
    if (Math.abs(ny - minY) < 0.6 || Math.abs(ny - maxY) < 0.6) dy = -dy;
    x = nx; y = ny;
  }
  g.stroke({ width: 1, color: 0xf6f4d4, alpha: 0.66 });
}
