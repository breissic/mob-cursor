// Shared canvas art for every view (projector display + phone controller).
// All functions draw in WORLD units (16 x 9); the caller sets the transform.
import {
  WORLD_H,
  WORLD_W,
  balloonsNow,
  bucketPos,
  clamp,
  inRect,
  targetPos,
  type BalloonParams,
  type BalloonProgress,
  type ChairsParams,
  type ChairsProgress,
  type KeyboardParams,
  type KeyboardProgress,
  type MazeParams,
  type MazeProgress,
  type MinesParams,
  type MinesProgress,
  type MoleParams,
  type MoleProgress,
  type PotatoParams,
  type PotatoProgress,
  type Rect,
  type RedlightParams,
  type RedlightProgress,
  type TargetsParams,
  type TargetsProgress,
  type VoteParams,
  type VoteProgress,
  voteHover,
} from '../../spacetimedb/src/sim';
import { blit } from './sprites';

export const FONT_DISPLAY = "'Bungee', 'Impact', sans-serif";
export const FONT_PIXEL = "'VT323', ui-monospace, monospace";

export const GAME_META: Record<string, { exe: string; title: string; color: string; goal: string }> = {
  targets: { exe: 'CLICKFEST.EXE', title: 'Clickfest', color: '#ff5a36', goal: 'Hit the numbered targets in order.' },
  maze: { exe: 'MAZE.EXE', title: 'The Maze', color: '#2ec4b6', goal: 'Reach the trophy. Touch a wall = back to start.' },
  minesweeper: { exe: 'MINES.EXE', title: 'Mob Sweeper', color: '#3a86ff', goal: 'Clear the board. Click together. The cursor also clicks by itself 💣' },
  redlight: { exe: 'REDLIGHT.EXE', title: 'Red Light, Green Light', color: '#43b047', goal: 'Run on green. FREEZE on red or you go back to the start. Reach the finish line!' },
  balloon: { exe: 'BALLOON.EXE', title: 'Keep It Up', color: '#4dabf7', goal: 'Get under the balloon to bop it up. Three drops and you are out. Survive the clock!' },
  mole: { exe: 'WHACK.EXE', title: 'Whack-a-Mole', color: '#8b5a2b', goal: 'Be ON the mole when it ducks back down. Too many misses = game over.' },
  potato: { exe: 'POTATO.EXE', title: 'Hot Potato', color: '#f08c00', goal: 'The cursor is a hot potato. Be inside the bucket when the fuse hits zero!' },
  chairs: { exe: 'CHAIRS.EXE', title: 'Musical Chairs', color: '#da77f2', goal: 'When the music stops, be on a chair. A chair goes each round. Sit on the last one!' },
  keyboard: { exe: 'KEYBOARD.EXE', title: 'Giant Keyboard', color: '#5c7cfa', goal: 'Spell the word: hold the cursor on each letter in order. Wrong key = BZZT.' },
  vote: { exe: 'PICK.EXE', title: 'Pick the next game', color: '#ff4fa3', goal: 'Park the cursor INSIDE a card. It is EXTRA strong right now. Time out = that game!' },
  lobby: { exe: 'LOBBY.EXE', title: 'Lobby', color: '#ffd23f', goal: 'Scan the QR code to join.' },
};

/**
 * Draw text at a WORLD-unit size. Browsers mis-measure/clamp sub-pixel font
 * sizes, so we scale the context up and draw at a sane pixel size instead.
 */
const TK = 100;
export function worldText(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  opts: { font?: string; fill: string; stroke?: string; strokeW?: number; align?: CanvasTextAlign; baseline?: CanvasTextBaseline }
) {
  g.save();
  g.translate(x, y);
  g.scale(1 / TK, 1 / TK);
  g.font = `${size * TK}px ${opts.font ?? FONT_DISPLAY}`;
  g.textAlign = opts.align ?? 'start';
  g.textBaseline = opts.baseline ?? 'alphabetic';
  if (opts.stroke) {
    g.lineJoin = 'round';
    g.lineWidth = (opts.strokeW ?? 0.08) * TK;
    g.strokeStyle = opts.stroke;
    g.strokeText(text, 0, 0);
  }
  g.fillStyle = opts.fill;
  g.fillText(text, 0, 0);
  g.restore();
}

export function measureWorld(g: CanvasRenderingContext2D, text: string, size: number, font = FONT_DISPLAY) {
  g.save();
  g.font = `${size * TK}px ${font}`;
  const w = g.measureText(text).width / TK;
  g.restore();
  return w;
}

const FIELD_COLOR: Record<string, string> = {
  vote: '#5b2a86',
  targets: '#fff6e0',
  maze: '#1b2550',
  minesweeper: '#9e9e9e',
  redlight: '#3b7a3b',
  balloon: '#8fd3ff',
  mole: '#6aa84f',
  potato: '#f6e7c1',
  chairs: '#2b1a4a',
  keyboard: '#d9d4c7',
};

/** Color behind the playfield (also fills the letterbox bars). */
export function fieldColor(kind: string) {
  return FIELD_COLOR[kind] ?? '#0e6f6b';
}

export type LevelView = { kind: string; params: unknown; progress: unknown; playAt: number };

/** Dotted desk texture (lobby and picker). */
function dots(g: CanvasRenderingContext2D, color = 'rgba(255,255,255,0.08)') {
  g.fillStyle = color;
  for (let y = 0.25; y < WORLD_H; y += 0.5) for (let x = 0.25; x < WORLD_W; x += 0.5) g.fillRect(x, y, 0.06, 0.06);
}

/** Checkerboard over the whole field. */
function checker(g: CanvasRenderingContext2D, a: string, b: string, size: number) {
  for (let r = 0; r * size < WORLD_H; r++)
    for (let c = 0; c * size < WORLD_W; c++) {
      g.fillStyle = (r + c) % 2 ? a : b;
      g.fillRect(c * size, r * size, size + 0.01, size + 0.01);
    }
}

/** Background for the playfield of a given game. */
export function drawField(g: CanvasRenderingContext2D, kind: string, px: number) {
  if (kind === 'targets') {
    g.fillStyle = '#fff6e0';
    g.fillRect(0, 0, WORLD_W, WORLD_H);
    g.strokeStyle = '#efdfbd';
    g.lineWidth = 2 * px;
    g.beginPath();
    for (let x = 1; x < WORLD_W; x++) {
      g.moveTo(x, 0);
      g.lineTo(x, WORLD_H);
    }
    for (let y = 1; y < WORLD_H; y++) {
      g.moveTo(0, y);
      g.lineTo(WORLD_W, y);
    }
    g.stroke();
  } else if (kind === 'maze') {
    g.fillStyle = '#1b2550';
    g.fillRect(0, 0, WORLD_W, WORLD_H);
  } else if (kind === 'vote') {
    g.fillStyle = '#5b2a86';
    g.fillRect(0, 0, WORLD_W, WORLD_H);
    dots(g);
  } else if (kind === 'minesweeper') {
    g.fillStyle = '#9e9e9e';
    g.fillRect(0, 0, WORLD_W, WORLD_H);
  } else if (kind === 'redlight') {
    // Grass verges, asphalt track with lane lines.
    g.fillStyle = '#3b7a3b';
    g.fillRect(0, 0, WORLD_W, WORLD_H);
    g.fillStyle = '#4a4a52';
    g.fillRect(0, 1.7, WORLD_W, WORLD_H - 1.7);
    g.save();
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 4 * px;
    g.setLineDash([0.6, 0.4]);
    g.beginPath();
    for (const y of [3.3, 4.5, 5.7, 6.9]) {
      g.moveTo(0, y);
      g.lineTo(WORLD_W, y);
    }
    g.stroke();
    g.restore();
  } else if (kind === 'balloon') {
    g.fillStyle = '#8fd3ff';
    g.fillRect(0, 0, WORLD_W, WORLD_H);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (const [x, y, s] of [
      [2.2, 1.4, 0.55],
      [6.1, 2.6, 0.4],
      [11.3, 1.1, 0.6],
      [14.2, 3.2, 0.45],
    ]) {
      g.beginPath();
      g.ellipse(x, y, s * 1.6, s, 0, 0, Math.PI * 2);
      g.ellipse(x + s, y - s * 0.3, s * 1.1, s * 0.8, 0, 0, Math.PI * 2);
      g.ellipse(x - s * 0.9, y - s * 0.2, s, s * 0.7, 0, 0, Math.PI * 2);
      g.fill();
    }
    // The floor is lava (well, the ground).
    g.fillStyle = '#3b7a3b';
    g.fillRect(0, WORLD_H - 0.35, WORLD_W, 0.35);
  } else if (kind === 'mole') {
    g.fillStyle = '#6aa84f';
    g.fillRect(0, 0, WORLD_W, WORLD_H);
    g.fillStyle = 'rgba(0,0,0,0.08)';
    for (let i = 0; i < 90; i++) g.fillRect(((i * 7.31) % WORLD_W), ((i * 3.77) % WORLD_H), 0.18, 0.06);
  } else if (kind === 'potato') {
    checker(g, '#f6e7c1', '#efd9a6', 1.5);
  } else if (kind === 'chairs') {
    checker(g, '#2b1a4a', '#3a2566', 1.5);
    dots(g, 'rgba(255,255,255,0.06)');
  } else if (kind === 'keyboard') {
    g.fillStyle = '#d9d4c7';
    g.fillRect(0, 0, WORLD_W, WORLD_H);
    g.fillStyle = '#c9c3b4';
    g.fillRect(0, 0, WORLD_W, 2.0);
  } else {
    // Lobby: dotted desk.
    g.fillStyle = '#0e6f6b';
    g.fillRect(0, 0, WORLD_W, WORLD_H);
    dots(g);
  }
}

export function drawLevel(
  g: CanvasRenderingContext2D,
  lv: LevelView,
  px: number,
  serverMs: number,
  cursor: { x: number; y: number },
  detail = true
) {
  const t = (serverMs - lv.playAt) / 1000;
  if (lv.kind === 'targets') drawTargets(g, lv.params as TargetsParams, lv.progress as TargetsProgress, px, Math.max(0, t), serverMs, detail);
  else if (lv.kind === 'maze') drawMaze(g, lv.params as MazeParams, lv.progress as MazeProgress, px, serverMs);
  else if (lv.kind === 'vote') drawVote(g, lv.params as VoteParams, lv.progress as VoteProgress, px, serverMs, cursor, detail);
  else if (lv.kind === 'minesweeper') drawMines(g, lv.params as MinesParams, lv.progress as MinesProgress, px, cursor, detail);
  else if (lv.kind === 'redlight') drawRedlight(g, lv.params as RedlightParams, lv.progress as RedlightProgress, px, serverMs, detail);
  else if (lv.kind === 'balloon') drawBalloon(g, lv.params as BalloonParams, lv.progress as BalloonProgress, px, serverMs, cursor, detail);
  else if (lv.kind === 'mole') drawMole(g, lv.params as MoleParams, lv.progress as MoleProgress, px, serverMs, cursor, detail);
  else if (lv.kind === 'potato') drawPotato(g, lv.params as PotatoParams, lv.progress as PotatoProgress, px, serverMs, Math.max(0, t), cursor, detail);
  else if (lv.kind === 'chairs') drawChairs(g, lv.params as ChairsParams, lv.progress as ChairsProgress, px, serverMs, cursor, detail);
  else if (lv.kind === 'keyboard') drawKeyboard(g, lv.params as KeyboardParams, lv.progress as KeyboardProgress, px, serverMs, detail);
}

function bullseye(g: CanvasRenderingContext2D, x: number, y: number, r: number, px: number, a = 1) {
  g.globalAlpha = a;
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath();
  g.arc(x + 0.08, y + 0.1, r, 0, Math.PI * 2);
  g.fill();
  const rings: [number, string][] = [
    [1, '#ff3b3b'],
    [0.72, '#ffffff'],
    [0.46, '#ff3b3b'],
    [0.2, '#ffffff'],
  ];
  for (const [k, c] of rings) {
    g.fillStyle = c;
    g.beginPath();
    g.arc(x, y, r * k, 0, Math.PI * 2);
    g.fill();
  }
  g.lineWidth = 3 * px;
  g.strokeStyle = '#111';
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.stroke();
  g.globalAlpha = 1;
}

function sticker(g: CanvasRenderingContext2D, x: number, y: number, text: string, size: number, bg: string, fg = '#111', px = 0.01) {
  const w = measureWorld(g, text, size) + size * 0.5;
  const h = size * 1.15;
  g.fillStyle = '#111';
  g.fillRect(x - w / 2 + 0.05, y - h / 2 + 0.05, w, h);
  g.fillStyle = bg;
  g.fillRect(x - w / 2, y - h / 2, w, h);
  g.lineWidth = 2 * px;
  g.strokeStyle = '#111';
  g.strokeRect(x - w / 2, y - h / 2, w, h);
  worldText(g, text, x, y + size * 0.08, size, { fill: fg, align: 'center', baseline: 'middle' });
}

function drawTargets(g: CanvasRenderingContext2D, p: TargetsParams, prog: TargetsProgress, px: number, t: number, ms: number, detail: boolean) {
  p.targets.forEach((tg, i) => {
    if (i < prog.next) {
      blit(g, 'star', tg.x, tg.y, 0.05, { center: true, alpha: 0.35 });
      return;
    }
    const pos = targetPos(p, i, t);
    const isNext = i === prog.next;
    const pulse = isNext ? 1 + 0.07 * Math.sin(ms / 140) : 0.85;
    bullseye(g, pos.x, pos.y, p.r * pulse, px, isNext ? 1 : 0.45);
    if (isNext) {
      // Spinning dashed halo + bouncing arrow.
      g.save();
      g.setLineDash([0.18, 0.14]);
      g.lineDashOffset = -ms / 300;
      g.strokeStyle = '#111';
      g.lineWidth = 3 * px;
      g.beginPath();
      g.arc(pos.x, pos.y, p.r * 1.35, 0, Math.PI * 2);
      g.stroke();
      g.restore();
      if (detail) {
        const by = pos.y - p.r * 1.35 - 0.35 - Math.abs(Math.sin(ms / 220)) * 0.25;
        g.fillStyle = '#111';
        g.beginPath();
        g.moveTo(pos.x - 0.22, by - 0.25);
        g.lineTo(pos.x + 0.22, by - 0.25);
        g.lineTo(pos.x, by + 0.05);
        g.closePath();
        g.fill();
      }
    }
    if (detail || isNext) sticker(g, pos.x + p.r * 0.75, pos.y - p.r * 0.75, String(i + 1), isNext ? 0.42 : 0.3, isNext ? '#ffd23f' : '#fff', '#111', px);
  });
}

function drawMaze(g: CanvasRenderingContext2D, m: MazeParams, prog: MazeProgress, px: number, ms: number) {
  const tw = WORLD_W / m.cols;
  const th = WORLD_H / m.rows;
  const wall = (c: number, r: number) => c < 0 || r < 0 || c >= m.cols || r >= m.rows || m.tiles[r * m.cols + c] === '#';
  for (let r = 0; r < m.rows; r++)
    for (let c = 0; c < m.cols; c++) {
      const x = c * tw;
      const y = r * th;
      if (!wall(c, r)) {
        g.fillStyle = (r + c) % 2 ? '#1f2b5c' : '#22306a';
        g.fillRect(x, y, tw + px, th + px);
        continue;
      }
      // Chunky beveled block.
      const b = Math.min(tw, th) * 0.14;
      g.fillStyle = '#ff8a3d';
      g.fillRect(x, y, tw + px, th + px);
      g.fillStyle = '#ffc08a';
      if (!wall(c, r - 1)) g.fillRect(x, y, tw, b);
      if (!wall(c - 1, r)) g.fillRect(x, y, b, th);
      g.fillStyle = '#b8501a';
      if (!wall(c, r + 1)) g.fillRect(x, y + th - b, tw, b);
      if (!wall(c + 1, r)) g.fillRect(x + tw - b, y, b, th);
      // Brick mortar.
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(x, y + th / 2 - px, tw, 2 * px);
      g.fillRect(x + ((r % 2) + 0.5) * (tw / 2), y, 2 * px, th / 2);
    }
  // Outline walls against floor for that sticker look.
  g.strokeStyle = '#111';
  g.lineWidth = 3 * px;
  g.beginPath();
  for (let r = 0; r < m.rows; r++)
    for (let c = 0; c < m.cols; c++) {
      if (!wall(c, r)) continue;
      const x = c * tw;
      const y = r * th;
      if (!wall(c, r - 1)) {
        g.moveTo(x, y);
        g.lineTo(x + tw, y);
      }
      if (!wall(c, r + 1)) {
        g.moveTo(x, y + th);
        g.lineTo(x + tw, y + th);
      }
      if (!wall(c - 1, r)) {
        g.moveTo(x, y);
        g.lineTo(x, y + th);
      }
      if (!wall(c + 1, r)) {
        g.moveTo(x + tw, y);
        g.lineTo(x + tw, y + th);
      }
    }
  g.stroke();
  // Start pad + goal.
  const sx = m.start.c * tw;
  const sy = m.start.r * th;
  g.save();
  g.strokeStyle = '#ffd23f';
  g.lineWidth = 4 * px;
  g.setLineDash([0.1, 0.08]);
  g.strokeRect(sx + tw * 0.14, sy + th * 0.14, tw * 0.72, th * 0.72);
  g.restore();
  const gx = m.goal.c * tw;
  const gy = m.goal.r * th;
  g.fillStyle = '#2ec4b6';
  g.fillRect(gx + tw * 0.08, gy + th * 0.08, tw * 0.84, th * 0.84);
  blit(g, 'trophy', gx + tw / 2, gy + th / 2 - Math.abs(Math.sin(ms / 300)) * th * 0.08, Math.min(tw, th) / 20, { center: true, shadow: 0.06 });
  void prog;
}

/** Text sized to fit a width (never larger than `max`). */
function fitText(g: CanvasRenderingContext2D, text: string, maxW: number, max: number, font = FONT_DISPLAY) {
  const w1 = measureWorld(g, text, 1, font);
  return w1 > 0 ? Math.min(max, maxW / w1) : max;
}

// ---------------------------------------------------------------------------
// Small shared shapes (used by the games and by the picker cards).
// ---------------------------------------------------------------------------

function trafficLight(g: CanvasRenderingContext2D, x: number, y: number, s: number, lit: 'red' | 'green' | null, px: number, ms: number) {
  // Housing (s = lamp radius), two lamps side by side: red left, green right.
  const w = s * 5;
  const h = s * 2.8;
  g.fillStyle = '#111';
  g.fillRect(x - w / 2 + 0.08, y - h / 2 + 0.08, w, h);
  g.fillStyle = '#2b2b33';
  g.fillRect(x - w / 2, y - h / 2, w, h);
  g.lineWidth = 3 * px;
  g.strokeStyle = '#111';
  g.strokeRect(x - w / 2, y - h / 2, w, h);
  const lamps: ['red' | 'green', string, string][] = [
    ['red', '#ff3b3b', '#4a1414'],
    ['green', '#43e05a', '#143d1c'],
  ];
  lamps.forEach(([k, on, off], i) => {
    const lx = x + (i === 0 ? -s * 1.2 : s * 1.2);
    const isOn = lit === k;
    if (isOn) {
      g.fillStyle = k === 'red' ? 'rgba(255,59,59,0.35)' : 'rgba(67,224,90,0.35)';
      g.beginPath();
      g.arc(lx, y, s * (1.35 + 0.08 * Math.sin(ms / 120)), 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = isOn ? on : off;
    g.beginPath();
    g.arc(lx, y, s, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    if (isOn) {
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.beginPath();
      g.arc(lx - s * 0.3, y - s * 0.3, s * 0.25, 0, Math.PI * 2);
      g.fill();
    }
  });
}

function balloonShape(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, px: number) {
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.beginPath();
  g.ellipse(x + 0.08, y + 0.1, r, r * 1.18, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.ellipse(x, y, r, r * 1.18, 0, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 3 * px;
  g.strokeStyle = '#111';
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.beginPath();
  g.ellipse(x - r * 0.38, y - r * 0.45, r * 0.22, r * 0.35, -0.5, 0, Math.PI * 2);
  g.fill();
  // Knot + string.
  g.fillStyle = '#111';
  g.beginPath();
  g.moveTo(x - r * 0.18, y + r * 1.18);
  g.lineTo(x + r * 0.18, y + r * 1.18);
  g.lineTo(x, y + r * 1.42);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(x, y + r * 1.42);
  g.quadraticCurveTo(x + r * 0.5, y + r * 2.1, x - r * 0.2, y + r * 2.9);
  g.lineWidth = 2.5 * px;
  g.stroke();
}

function holeShape(g: CanvasRenderingContext2D, x: number, y: number, r: number, px: number) {
  g.fillStyle = '#5a3f26';
  g.beginPath();
  g.ellipse(x, y + r * 0.35, r, r * 0.6, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#2d1d10';
  g.beginPath();
  g.ellipse(x, y + r * 0.3, r * 0.82, r * 0.42, 0, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 3 * px;
  g.strokeStyle = '#111';
  g.beginPath();
  g.ellipse(x, y + r * 0.35, r, r * 0.6, 0, 0, Math.PI * 2);
  g.stroke();
}

/** Mole head rising out of a hole; `up` 0..1 = how far it has popped. */
function moleShape(g: CanvasRenderingContext2D, x: number, y: number, r: number, up: number, px: number) {
  const hr = r * 0.62;
  const cy = y + r * 0.3 - up * r * 0.95;
  g.save();
  // Clip to above the hole's mouth so the mole comes "out of" the ground.
  g.beginPath();
  g.rect(x - r * 1.5, cy - hr * 2, r * 3, hr * 2 + (y + r * 0.3 - cy));
  g.clip();
  g.fillStyle = '#8b5a2b';
  g.beginPath();
  g.ellipse(x, cy, hr, hr * 1.1, 0, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 3 * px;
  g.strokeStyle = '#111';
  g.stroke();
  // Snout, nose, eyes.
  g.fillStyle = '#d9a066';
  g.beginPath();
  g.ellipse(x, cy + hr * 0.3, hr * 0.5, hr * 0.38, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ff7eb6';
  g.beginPath();
  g.arc(x, cy + hr * 0.18, hr * 0.17, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#111';
  g.beginPath();
  g.arc(x - hr * 0.35, cy - hr * 0.2, hr * 0.1, 0, Math.PI * 2);
  g.arc(x + hr * 0.35, cy - hr * 0.2, hr * 0.1, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function potatoShape(g: CanvasRenderingContext2D, x: number, y: number, s: number, px: number, ms: number) {
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.beginPath();
  g.ellipse(x + 0.06, y + 0.08, s, s * 0.7, 0.3, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#c68642';
  g.beginPath();
  g.ellipse(x, y, s, s * 0.7, 0.3, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 3 * px;
  g.strokeStyle = '#111';
  g.stroke();
  g.fillStyle = '#8b5a2b';
  for (const [dx, dy] of [
    [-0.4, -0.1],
    [0.2, 0.2],
    [0.45, -0.25],
  ]) {
    g.beginPath();
    g.arc(x + dx * s, y + dy * s, s * 0.09, 0, Math.PI * 2);
    g.fill();
  }
  // Fuse + spark.
  g.strokeStyle = '#111';
  g.lineWidth = 3 * px;
  g.beginPath();
  g.moveTo(x + s * 0.6, y - s * 0.5);
  g.quadraticCurveTo(x + s * 0.9, y - s * 1.1, x + s * 0.7, y - s * 1.4);
  g.stroke();
  blit(g, 'star', x + s * 0.7, y - s * 1.45, s * 0.045 * (1 + 0.25 * Math.sin(ms / 60)), { center: true });
}

function bucketShape(g: CanvasRenderingContext2D, x: number, y: number, r: number, hot: boolean, px: number) {
  // Catch zone.
  g.save();
  g.setLineDash([0.18, 0.12]);
  g.lineWidth = (hot ? 6 : 4) * px;
  g.strokeStyle = hot ? '#ffd23f' : 'rgba(17,17,17,0.6)';
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.stroke();
  g.restore();
  // Bucket body: trapezoid + rim.
  const tw = r * 0.9;
  const bw = r * 0.68;
  const top = y - r * 0.55;
  const bot = y + r * 0.6;
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.beginPath();
  g.moveTo(x - tw + 0.08, top + 0.1);
  g.lineTo(x + tw + 0.08, top + 0.1);
  g.lineTo(x + bw + 0.08, bot + 0.1);
  g.lineTo(x - bw + 0.08, bot + 0.1);
  g.closePath();
  g.fill();
  g.fillStyle = hot ? '#ffd23f' : '#3a86ff';
  g.beginPath();
  g.moveTo(x - tw, top);
  g.lineTo(x + tw, top);
  g.lineTo(x + bw, bot);
  g.lineTo(x - bw, bot);
  g.closePath();
  g.fill();
  g.lineWidth = 3 * px;
  g.strokeStyle = '#111';
  g.stroke();
  g.fillStyle = hot ? '#fff1b8' : '#74c0fc';
  g.beginPath();
  g.ellipse(x, top, tw, r * 0.22, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.beginPath();
  g.arc(x, top - r * 0.05, tw * 0.85, Math.PI, 0);
  g.stroke();
}

function chairShape(g: CanvasRenderingContext2D, r: Rect, color: string, px: number) {
  const back = r.h * 0.3;
  g.fillStyle = '#111';
  g.fillRect(r.x + 0.1, r.y + 0.1, r.w, r.h);
  g.fillStyle = color;
  g.fillRect(r.x, r.y, r.w, r.h);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(r.x, r.y, r.w, back);
  // Back slats.
  g.fillStyle = 'rgba(255,255,255,0.18)';
  for (let i = 1; i < 4; i++) g.fillRect(r.x + (r.w * i) / 4 - 0.04, r.y + back * 0.15, 0.08, back * 0.7);
  g.lineWidth = 3 * px;
  g.strokeStyle = '#111';
  g.strokeRect(r.x, r.y, r.w, r.h);
  g.beginPath();
  g.moveTo(r.x, r.y + back);
  g.lineTo(r.x + r.w, r.y + back);
  g.stroke();
}

function keycap(g: CanvasRenderingContext2D, r: Rect, ch: string, bg: string, px: number, fg = '#111') {
  const bev = Math.min(r.w, r.h) * 0.1;
  g.fillStyle = '#111';
  g.fillRect(r.x + 0.08, r.y + 0.1, r.w, r.h);
  g.fillStyle = bg;
  g.fillRect(r.x, r.y, r.w, r.h);
  g.fillStyle = 'rgba(255,255,255,0.45)';
  g.fillRect(r.x, r.y, r.w, bev);
  g.fillRect(r.x, r.y, bev, r.h);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(r.x, r.y + r.h - bev, r.w, bev);
  g.fillRect(r.x + r.w - bev, r.y, bev, r.h);
  g.lineWidth = 3 * px;
  g.strokeStyle = '#111';
  g.strokeRect(r.x, r.y, r.w, r.h);
  worldText(g, ch, r.x + r.w / 2, r.y + r.h / 2 + r.h * 0.04, Math.min(r.h * 0.55, r.w * 0.7), { fill: fg, align: 'center', baseline: 'middle' });
}

/** Big centered headline in the top strip of a game (stroke never thinner than 3 device px). */
function headline(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fill: string, px: number) {
  worldText(g, text, x, y, size, { fill, stroke: '#111', strokeW: Math.max(3 * px, size * 0.28), align: 'center', baseline: 'middle' });
}

// ---------------------------------------------------------------------------
// Picker
// ---------------------------------------------------------------------------

/** Icon for a game's picker card. */
function cardIcon(g: CanvasRenderingContext2D, kind: string, cx: number, cy: number, s: number, px: number, ms: number) {
  switch (kind) {
    case 'targets':
      return bullseye(g, cx, cy, s, px);
    case 'maze':
      return blit(g, 'trophy', cx, cy, s / 7, { center: true, shadow: 0.1 });
    case 'minesweeper':
      return blit(g, 'bomb', cx, cy, s / 7, { center: true, shadow: 0.1 });
    case 'redlight':
      return trafficLight(g, cx, cy, s * 0.4, Math.floor(ms / 700) % 2 ? 'red' : 'green', px, ms);
    case 'balloon':
      return balloonShape(g, cx, cy - s * 0.4, s * 0.55, '#ff4d6d', px);
    case 'mole':
      holeShape(g, cx, cy + s * 0.2, s * 0.9, px);
      return moleShape(g, cx, cy + s * 0.2, s * 0.9, 0.8, px);
    case 'potato':
      return potatoShape(g, cx, cy + s * 0.15, s * 0.8, px, ms);
    case 'chairs':
      return chairShape(g, { x: cx - s * 0.7, y: cy - s * 0.6, w: s * 1.4, h: s * 1.2 }, '#c8553d', px);
    case 'keyboard': {
      const kw = s * 0.62;
      const kh = s * 0.62;
      ['M', 'O', 'B'].forEach((ch, i) => keycap(g, { x: cx - kw * 1.5 - 0.1 + i * (kw + 0.1), y: cy - kh / 2, w: kw, h: kh }, ch, '#f3ead7', px));
      return;
    }
  }
}

/**
 * Picker: one card per game. The card the cursor is INSIDE is dimmed with a
 * dark overlay and labelled as the current pick; every other card stays at
 * full brightness. A big server-clock timer sits top-right.
 */
function drawVote(g: CanvasRenderingContext2D, p: VoteParams, prog: VoteProgress, px: number, ms: number, cursor: { x: number; y: number }, detail: boolean) {
  const hover = voteHover(p.cards, cursor.x, cursor.y);
  const secsLeft = Math.max(0, Math.ceil(((prog.endsAt ?? 0) - ms) / 1000));
  const blink = Math.floor(ms / 400) % 2 === 0;
  // Title (left) tells the room what to do; it nags when the cursor is in a gap.
  const title = hover ? 'PICK THE NEXT GAME' : blink ? 'GET INSIDE A CARD!' : 'NO PICK YET…';
  worldText(g, title, 0.4, 1.05, 0.55, { fill: hover ? '#ffd23f' : '#ff5a36', stroke: '#111', strokeW: 0.14, baseline: 'middle' });
  if (detail && (prog.restarts ?? 0) > 0) sticker(g, 2.3, 1.62, `RESTARTED ×${prog.restarts}`, 0.22, '#ffffff', '#111', px);
  // Timer: readable from the back of the room.
  const tw = 2.6;
  const th = 1.5;
  const tx = WORLD_W - 0.4 - tw;
  const ty = 0.2;
  g.fillStyle = '#111';
  g.fillRect(tx + 0.1, ty + 0.1, tw, th);
  g.fillStyle = secsLeft <= 2 ? '#ff3b3b' : '#ffd23f';
  g.fillRect(tx, ty, tw, th);
  g.lineWidth = 4 * px;
  g.strokeStyle = '#111';
  g.strokeRect(tx, ty, tw, th);
  worldText(g, String(secsLeft), tx + tw / 2, ty + th / 2 + 0.08, 1.3, { fill: '#111', align: 'center', baseline: 'middle' });

  for (const c of p.cards) {
    const meta = GAME_META[c.kind] ?? GAME_META.lobby;
    const band = Math.min(0.6, c.h * 0.18);
    g.fillStyle = '#111';
    g.fillRect(c.x + 0.12, c.y + 0.12, c.w, c.h);
    g.fillStyle = '#f3ead7';
    g.fillRect(c.x, c.y, c.w, c.h);
    g.fillStyle = meta.color;
    g.fillRect(c.x, c.y, c.w, band);
    g.lineWidth = 4 * px;
    g.strokeStyle = '#111';
    g.strokeRect(c.x, c.y, c.w, c.h);
    g.beginPath();
    g.moveTo(c.x, c.y + band);
    g.lineTo(c.x + c.w, c.y + band);
    g.stroke();
    worldText(g, meta.exe, c.x + 0.15, c.y + band * 0.55, fitText(g, meta.exe, c.w - 0.3, band * 0.5), { fill: '#111', baseline: 'middle' });
    const cx = c.x + c.w / 2;
    const iconS = Math.min(c.w, c.h) * 0.3;
    cardIcon(g, c.kind, cx, c.y + band + (c.h - band) * 0.42, iconS, px, ms);
    worldText(g, meta.title, cx, c.y + c.h - 0.35, fitText(g, meta.title, c.w - 0.3, 0.32), { fill: '#111', align: 'center', baseline: 'middle' });
    if (detail && p.lastKind === c.kind) sticker(g, c.x + c.w - 0.75, c.y + band + 0.35, 'AGAIN?', 0.22, '#ffffff', '#111', px);
    if (hover === c) {
      // Dim the whole card, then label it.
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(c.x, c.y, c.w, c.h);
      sticker(g, cx, c.y + c.h / 2, 'CURRENT PICK', fitText(g, 'CURRENT PICK', c.w - 0.5, 0.34), '#ffd23f', '#111', px);
    }
  }
}

// ---------------------------------------------------------------------------
// Red Light, Green Light
// ---------------------------------------------------------------------------

function drawRedlight(g: CanvasRenderingContext2D, p: RedlightParams, prog: RedlightProgress, px: number, ms: number, detail: boolean) {
  const red = prog.light === 'red';
  if (red) {
    g.fillStyle = `rgba(255,59,59,${0.12 + 0.06 * Math.sin(ms / 120)})`;
    g.fillRect(0, 1.7, WORLD_W, WORLD_H - 1.7);
  }
  // Start pad and checkered finish.
  g.save();
  g.strokeStyle = '#ffd23f';
  g.lineWidth = 4 * px;
  g.setLineDash([0.12, 0.08]);
  g.strokeRect(p.start.x - 0.6, p.start.y - 0.9, 1.2, 1.8);
  g.restore();
  const fx0 = p.finishX;
  const sq = 0.3;
  for (let r = 0; (1.7 + r * sq) < WORLD_H; r++)
    for (let c = 0; c < 2; c++) {
      g.fillStyle = (r + c) % 2 ? '#111' : '#fff';
      g.fillRect(fx0 + c * sq, 1.7 + r * sq, sq, Math.min(sq, WORLD_H - 1.7 - r * sq));
    }
  blit(g, 'flag', fx0 + 0.75, 1.9 + Math.abs(Math.sin(ms / 300)) * 0.1, 0.06, { shadow: 0.05 });
  // Dead-band ring around the anchor while red.
  if (red && prog.anchor) {
    g.save();
    g.setLineDash([0.1, 0.1]);
    g.strokeStyle = '#ff3b3b';
    g.lineWidth = 4 * px;
    g.beginPath();
    g.arc(prog.anchor.x, prog.anchor.y, p.deadband, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }
  // The light itself and the shout.
  trafficLight(g, WORLD_W / 2, 0.88, 0.42, prog.light, px, ms);
  headline(g, red ? 'FREEZE!' : 'GO GO GO!', 3.4, 0.9, 0.7, red ? '#ff3b3b' : '#43e05a', px);
  if (detail) {
    const txt = `FAULTS ${prog.faults}/${p.faultCap}`;
    sticker(g, WORLD_W - 2.4, 0.9, txt, 0.4, prog.faults >= p.faultCap - 1 ? '#ff3b3b' : '#ffffff', '#111', px);
  }
}

// ---------------------------------------------------------------------------
// Keep the Balloon Up
// ---------------------------------------------------------------------------

const BALLOON_COLORS = ['#ff4d6d', '#ffd43b', '#69db7c'];

function drawBalloon(g: CanvasRenderingContext2D, p: BalloonParams, prog: BalloonProgress, px: number, ms: number, cursor: { x: number; y: number }, detail: boolean) {
  // Hand range around the cursor: get the balloon into this ring, from below.
  g.save();
  g.setLineDash([0.14, 0.1]);
  g.strokeStyle = 'rgba(17,17,17,0.55)';
  g.lineWidth = 3 * px;
  g.beginPath();
  g.arc(cursor.x, cursor.y, p.handR, 0, Math.PI * 2);
  g.stroke();
  g.restore();
  // Danger stripes on the floor.
  for (let x = 0; x < WORLD_W; x += 0.7) {
    g.fillStyle = Math.floor(x / 0.7) % 2 ? '#ff3b3b' : '#ffd23f';
    g.fillRect(x, WORLD_H - 0.35, 0.7, 0.35);
  }
  balloonsNow(p, prog, ms).forEach((b, i) => {
    const x = clamp(b.x, p.r, WORLD_W - p.r);
    const y = clamp(b.y, p.r, WORLD_H - p.r);
    balloonShape(g, x, y, p.r, BALLOON_COLORS[i % BALLOON_COLORS.length], px);
    if (detail && b.ax) {
      // Wind arrow above the balloon.
      const dir = Math.sign(b.ax);
      const ax = x + dir * 0.2;
      const ay = y - p.r * 1.7;
      g.strokeStyle = '#111';
      g.lineWidth = 3 * px;
      g.beginPath();
      g.moveTo(ax - dir * 0.5, ay);
      g.lineTo(ax + dir * 0.3, ay);
      g.moveTo(ax + dir * 0.05, ay - 0.18);
      g.lineTo(ax + dir * 0.3, ay);
      g.lineTo(ax + dir * 0.05, ay + 0.18);
      g.stroke();
    }
  });
  // Lives (drops left) and saves.
  for (let i = 0; i < p.dropCap; i++) blit(g, i < p.dropCap - prog.drops ? 'heart' : 'skull', 0.4 + i * 0.75, 0.3, 0.06, { shadow: 0.05 });
  if (detail) sticker(g, WORLD_W - 1.6, 0.6, `SAVES ${prog.saves}`, 0.36, '#ffffff', '#111', px);
  headline(g, 'KEEP IT UP!', WORLD_W / 2, 0.75, 0.6, '#ffffff', px);
}

// ---------------------------------------------------------------------------
// Whack-a-Mole
// ---------------------------------------------------------------------------

function drawMole(g: CanvasRenderingContext2D, p: MoleParams, prog: MoleProgress, px: number, ms: number, cursor: { x: number; y: number }, detail: boolean) {
  p.holes.forEach((h, i) => {
    holeShape(g, h.x, h.y, p.r, px);
    if (i !== prog.up) return;
    const upAt = prog.until - p.upMs;
    const up = clamp((ms - upAt) / 250, 0, 1);
    moleShape(g, h.x, h.y, p.r, up, px);
    // Hit zone and the shrinking window bar.
    const inside = Math.hypot(cursor.x - h.x, cursor.y - h.y) <= p.r;
    g.save();
    g.setLineDash([0.14, 0.1]);
    g.lineWidth = (inside ? 6 : 4) * px;
    g.strokeStyle = inside ? '#ffd23f' : 'rgba(17,17,17,0.6)';
    g.beginPath();
    g.arc(h.x, h.y, p.r, 0, Math.PI * 2);
    g.stroke();
    g.restore();
    const left = clamp((prog.until - ms) / p.upMs, 0, 1);
    const bw = p.r * 1.8;
    g.fillStyle = '#111';
    g.fillRect(h.x - bw / 2, h.y - p.r * 1.5, bw, 0.26);
    g.fillStyle = left < 0.3 ? '#ff3b3b' : '#ffd23f';
    g.fillRect(h.x - bw / 2 + 0.04, h.y - p.r * 1.5 + 0.04, (bw - 0.08) * left, 0.18);
    if (inside) sticker(g, h.x, h.y - p.r * 1.95, 'HOLD IT!', 0.3, '#ffd23f', '#111', px);
  });
  headline(g, prog.up >= 0 ? 'WHACK!' : 'WAIT FOR IT…', WORLD_W / 2, 0.75, 0.6, prog.up >= 0 ? '#ffd23f' : '#ffffff', px);
  if (detail) {
    sticker(g, 1.4, 0.7, `${prog.score}/${p.target}`, 0.42, '#ffffff', '#111', px);
    for (let i = 0; i < p.missCap; i++) blit(g, i < prog.misses ? 'skull' : 'heart', WORLD_W - 0.4 - (p.missCap - i) * 0.75, 0.3, 0.06, { shadow: 0.05 });
  }
}

// ---------------------------------------------------------------------------
// Hot Potato
// ---------------------------------------------------------------------------

function drawPotato(g: CanvasRenderingContext2D, p: PotatoParams, prog: PotatoProgress, px: number, ms: number, t: number, cursor: { x: number; y: number }, detail: boolean) {
  const b = bucketPos(p, t);
  const inside = Math.hypot(cursor.x - b.x, cursor.y - b.y) <= p.r;
  bucketShape(g, b.x, b.y, p.r, inside, px);
  if (inside) sticker(g, b.x, b.y - p.r - 0.4, 'STAY HERE!', 0.3, '#ffd23f', '#111', px);
  // The potato rides with the cursor; the fuse ring counts the whole stage down.
  const left = Math.max(0, (prog.fuseAt - ms) / 1000);
  potatoShape(g, cursor.x + 0.55, cursor.y + 0.65, 0.42, px, ms);
  drawFuse(g, cursor.x, cursor.y, left, px, p.fuseS);
  const secs = Math.ceil(left);
  headline(g, String(secs), WORLD_W / 2, 1.0, 1.4, secs <= 3 ? '#ff3b3b' : '#ffd23f', px);
  if (detail) headline(g, inside ? 'IN THE BUCKET!' : 'GET IN THE BUCKET!', WORLD_W / 2, WORLD_H - 0.6, 0.5, inside ? '#43e05a' : '#ffffff', px);
}

// ---------------------------------------------------------------------------
// Musical Chairs
// ---------------------------------------------------------------------------

function drawChairs(g: CanvasRenderingContext2D, p: ChairsParams, prog: ChairsProgress, px: number, ms: number, cursor: { x: number; y: number }, detail: boolean) {
  const safe = ms < prog.safeUntil;
  const warn = !safe && prog.stopAt - ms <= p.warnS * 1000;
  p.chairs.forEach((c, i) => {
    if (!prog.left.includes(i)) {
      // Gone: faint outline with an X.
      g.save();
      g.setLineDash([0.12, 0.1]);
      g.strokeStyle = 'rgba(255,255,255,0.2)';
      g.lineWidth = 3 * px;
      g.strokeRect(c.x, c.y, c.w, c.h);
      g.beginPath();
      g.moveTo(c.x, c.y);
      g.lineTo(c.x + c.w, c.y + c.h);
      g.moveTo(c.x + c.w, c.y);
      g.lineTo(c.x, c.y + c.h);
      g.stroke();
      g.restore();
      return;
    }
    const on = inRect(c, cursor.x, cursor.y);
    chairShape(g, c, on ? '#ffd23f' : '#c8553d', px);
    if (on) sticker(g, c.x + c.w / 2, c.y + c.h * 0.65, 'SIT!', Math.min(0.34, c.h * 0.22), '#ffffff', '#111', px);
  });
  if (safe) headline(g, 'SAFE! A CHAIR IS GONE', WORLD_W / 2, 0.8, 0.6, '#43e05a', px);
  else if (warn) headline(g, Math.floor(ms / 250) % 2 ? 'MUSIC STOPPING!' : 'SIT DOWN!', WORLD_W / 2, 0.8, 0.75, '#ff3b3b', px);
  else {
    headline(g, 'MUSIC PLAYING', WORLD_W / 2, 0.8, 0.55, '#ffffff', px);
    // Bouncing notes.
    for (let i = 0; i < 3; i++) {
      const nx = WORLD_W / 2 + (i - 1) * 4.2;
      const ny = 0.8 - Math.abs(Math.sin(ms / 220 + i)) * 0.25;
      worldText(g, i % 2 ? '♫' : '♪', nx, ny, 0.6, { font: FONT_PIXEL, fill: '#ffd23f', stroke: '#111', strokeW: 0.1, align: 'center', baseline: 'middle' });
    }
  }
  if (detail) sticker(g, WORLD_W - 1.9, 1.6, `${prog.left.length} CHAIR${prog.left.length === 1 ? '' : 'S'} · ROUND ${prog.round}`, 0.3, '#ffffff', '#111', px);
}

// ---------------------------------------------------------------------------
// Giant Keyboard
// ---------------------------------------------------------------------------

function drawKeyboard(g: CanvasRenderingContext2D, p: KeyboardParams, prog: KeyboardProgress, px: number, ms: number, detail: boolean) {
  // Word strip: typed letters green, the next one gold and pulsing, the rest blank.
  const n = p.word.length;
  const bw = Math.min(1.2, (WORLD_W - 2) / n);
  const bh = 1.3;
  const x0 = (WORLD_W - (n * bw + (n - 1) * 0.1)) / 2;
  for (let i = 0; i < n; i++) {
    const done = i < prog.next;
    const next = i === prog.next;
    const pulse = next ? 1 + 0.04 * Math.sin(ms / 140) : 1;
    const r = { x: x0 + i * (bw + 0.1) - (bw * (pulse - 1)) / 2, y: 0.35 - (bh * (pulse - 1)) / 2, w: bw * pulse, h: bh * pulse };
    keycap(g, r, done || next ? p.word[i] : '?', done ? '#69db7c' : next ? '#ffd23f' : '#f3ead7', px, done || next ? '#111' : 'rgba(17,17,17,0.35)');
  }
  const want = p.word[prog.next] ?? '';
  for (const k of p.keys) {
    const isWant = k.ch === want;
    const under = k.ch === prog.onKey;
    keycap(g, k, k.ch, isWant ? '#ffd23f' : '#f3ead7', px);
    if (!under) continue;
    // Dwell fill rising from the bottom of the key under the cursor.
    const frac = prog.pressed ? 1 : clamp((ms - prog.since) / p.dwellMs, 0, 1);
    g.fillStyle = isWant ? 'rgba(46,196,182,0.6)' : 'rgba(255,59,59,0.45)';
    g.fillRect(k.x, k.y + k.h * (1 - frac), k.w, k.h * frac);
    g.lineWidth = 6 * px;
    g.strokeStyle = isWant ? '#2ec4b6' : '#ff3b3b';
    g.strokeRect(k.x, k.y, k.w, k.h);
    if (prog.pressed && !isWant) worldText(g, 'BZZT', k.x + k.w / 2, k.y + k.h * 0.3, Math.min(0.4, k.w * 0.3), { fill: '#ff3b3b', stroke: '#111', strokeW: 0.1, align: 'center', baseline: 'middle' });
  }
  if (detail) {
    const hint = prog.next >= n ? 'DONE!' : `HOLD ON "${want}"`;
    worldText(g, hint, WORLD_W - 0.3, 1.0, 0.42, { fill: '#5c7cfa', stroke: '#111', strokeW: 0.1, align: 'right', baseline: 'middle' });
    if (prog.buzzes) sticker(g, 1.2, 1.0, `BZZT ×${prog.buzzes}`, 0.28, '#ffffff', '#111', px);
  }
}

const NUM_COLORS = ['', '#1d4ed8', '#15803d', '#dc2626', '#1e3a8a', '#7f1d1d', '#0e7490', '#111', '#6b7280'];

function drawMines(g: CanvasRenderingContext2D, m: MinesParams, prog: MinesProgress, px: number, cursor: { x: number; y: number }, detail: boolean) {
  const cw = WORLD_W / m.cols;
  const ch = WORLD_H / m.rows;
  const bev = Math.min(cw, ch) * 0.12;
  for (let r = 0; r < m.rows; r++)
    for (let c = 0; c < m.cols; c++) {
      const v = prog.cells[r * m.cols + c];
      const x = c * cw;
      const y = r * ch;
      if (v === '#') {
        g.fillStyle = '#c6c6c6';
        g.fillRect(x, y, cw, ch);
        g.fillStyle = '#ffffff';
        g.fillRect(x, y, cw, bev);
        g.fillRect(x, y, bev, ch);
        g.fillStyle = '#7b7b7b';
        g.fillRect(x, y + ch - bev, cw, bev);
        g.fillRect(x + cw - bev, y, bev, ch);
      } else {
        g.fillStyle = v === '*' ? '#ff3b3b' : v === 'm' ? '#c6c6c6' : '#e4e4e4';
        g.fillRect(x, y, cw, ch);
        g.strokeStyle = '#a3a3a3';
        g.lineWidth = 1.5 * px;
        g.strokeRect(x, y, cw, ch);
        if (v === '*' || v === 'm') blit(g, 'bomb', x + cw / 2, y + ch / 2, Math.min(cw, ch) / 20, { center: true, alpha: v === 'm' ? 0.75 : 1 });
        else if (v !== '0') {
          worldText(g, v, x + cw / 2, y + ch / 2 + ch * 0.05, ch * 0.62, { fill: NUM_COLORS[Number(v)] ?? '#111', align: 'center', baseline: 'middle' });
        }
      }
    }
  if (detail) {
    const hc = Math.min(m.cols - 1, Math.max(0, Math.floor((cursor.x / WORLD_W) * m.cols)));
    const hr = Math.min(m.rows - 1, Math.max(0, Math.floor((cursor.y / WORLD_H) * m.rows)));
    g.save();
    g.strokeStyle = '#ffd23f';
    g.lineWidth = 5 * px;
    g.setLineDash([0.12, 0.08]);
    g.strokeRect(hc * cw + bev / 2, hr * ch + bev / 2, cw - bev, ch - bev);
    g.restore();
  }
}

/** Classic pixel arrow. `size` = height in world units; tip at (x, y). */
export function drawCursorSprite(g: CanvasRenderingContext2D, x: number, y: number, size: number, tint: string, shadow = true) {
  blit(g, 'cursor', x, y, size / 19, { tint, shadow: shadow ? size * 0.07 : 0 });
}

export function nameTag(g: CanvasRenderingContext2D, x: number, y: number, name: string, color: string, size: number) {
  const w = measureWorld(g, name, size, FONT_PIXEL) + size * 0.6;
  const h = size * 1.05;
  g.fillStyle = '#111';
  g.fillRect(x, y, w, h);
  worldText(g, name, x + size * 0.3, y + h * 0.8, size, { font: FONT_PIXEL, fill: color });
}

/** Fuse ring drawn around the cursor tip (minesweeper auto-click, hot potato). `total` = seconds for a full ring. */
export function drawFuse(g: CanvasRenderingContext2D, x: number, y: number, secsLeft: number, px: number, total = 5) {
  const frac = Math.min(1, secsLeft / total);
  g.lineWidth = 6 * px;
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.beginPath();
  g.arc(x, y, 0.7, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = secsLeft < 1.5 ? '#ff3b3b' : '#ffd23f';
  g.beginPath();
  g.arc(x, y, 0.7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
  g.stroke();
  sticker(g, x + 0.95, y - 0.7, `${Math.ceil(secsLeft)}`, 0.45, secsLeft < 1.5 ? '#ff3b3b' : '#ffd23f', '#111', px);
}

export function parseLevel(row: { kind: string; params: string; progress: string } | null | undefined): LevelView | null {
  if (!row) return null;
  const params = JSON.parse(row.params) as { playAt?: number };
  return { kind: row.kind, params, progress: JSON.parse(row.progress), playAt: params.playAt ?? 0 };
}
