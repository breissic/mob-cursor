// Shared canvas art for every view (projector display + phone controller).
// All functions draw in WORLD units (16 x 9); the caller sets the transform.
import {
  WORLD_H,
  WORLD_W,
  targetPos,
  type MazeParams,
  type MazeProgress,
  type MinesParams,
  type MinesProgress,
  type TargetsParams,
  type TargetsProgress,
} from '../../spacetimedb/src/sim';
import { blit } from './sprites';

export const FONT_DISPLAY = "'Bungee', 'Impact', sans-serif";
export const FONT_PIXEL = "'VT323', ui-monospace, monospace";

export const GAME_META: Record<string, { exe: string; title: string; color: string; goal: string }> = {
  targets: { exe: 'CLICKFEST.EXE', title: 'Clickfest', color: '#ff5a36', goal: 'Hit the numbered targets in order.' },
  maze: { exe: 'MAZE.EXE', title: 'The Maze', color: '#2ec4b6', goal: 'Reach the trophy. Touch a wall = back to start.' },
  minesweeper: { exe: 'MINES.EXE', title: 'Mob Sweeper', color: '#3a86ff', goal: 'Clear the board. Click together. The cursor also clicks by itself 💣' },
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

/** Color behind the playfield (also fills the letterbox bars). */
export function fieldColor(kind: string) {
  return kind === 'targets' ? '#fff6e0' : kind === 'maze' ? '#1b2550' : kind === 'minesweeper' ? '#9e9e9e' : '#0e6f6b';
}

export type LevelView = { kind: string; params: unknown; progress: unknown; playAt: number };

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
  } else if (kind === 'minesweeper') {
    g.fillStyle = '#9e9e9e';
    g.fillRect(0, 0, WORLD_W, WORLD_H);
  } else {
    // Lobby: dotted desk.
    g.fillStyle = '#0e6f6b';
    g.fillRect(0, 0, WORLD_W, WORLD_H);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    for (let y = 0.25; y < WORLD_H; y += 0.5) for (let x = 0.25; x < WORLD_W; x += 0.5) g.fillRect(x, y, 0.06, 0.06);
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
  else if (lv.kind === 'minesweeper') drawMines(g, lv.params as MinesParams, lv.progress as MinesProgress, px, cursor, detail);
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
        g.fillStyle = v === '*' ? '#ff3b3b' : '#e4e4e4';
        g.fillRect(x, y, cw, ch);
        g.strokeStyle = '#a3a3a3';
        g.lineWidth = 1.5 * px;
        g.strokeRect(x, y, cw, ch);
        if (v === '*') blit(g, 'bomb', x + cw / 2, y + ch / 2, Math.min(cw, ch) / 20, { center: true });
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

/** Auto-click fuse ring drawn around the cursor tip (minesweeper). */
export function drawFuse(g: CanvasRenderingContext2D, x: number, y: number, secsLeft: number, px: number) {
  const frac = Math.min(1, secsLeft / 5);
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
