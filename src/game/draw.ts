// Shared canvas art for every view (projector display + phone controller).
// All functions draw in WORLD units (16 x 9); the caller sets the transform.
import {
  HUNT_BARS,
  REDLIGHT_TOP,
  WORLD_H,
  WORLD_W,
  balloonsNow,
  bucketPos,
  clamp,
  dollPos,
  dollS,
  inRect,
  targetPos,
  valveInZone,
  valveLevelsNow,
  type BalloonParams,
  type BalloonProgress,
  type ChairsParams,
  type ChairsProgress,
  type HuntParams,
  type HuntProgress,
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
  type StationsParams,
  type StationsProgress,
  type TargetsParams,
  type TargetsProgress,
  type ValvesParams,
  type ValvesProgress,
  type VoteParams,
  type VoteProgress,
  voteHover,
  echoLit,
  craneMarkerX,
  craneHeight,
  spotPos,
  spotS,
  spotHp,
  decoyPos,
  sheepAt,
  plankFill,
  seesawPoint,
  SEESAW_BALL_R,
  beltDir,
  beltsReversed,
  needleGapY,
  NEEDLE_TOP,
  WIRE_COLORS,
  WIRE_NAMES,
  stationsRevealed,
  type EchoParams,
  type EchoProgress,
  type CraneParams,
  type CraneProgress,
  type SpotlightParams,
  type SpotlightProgress,
  type SheepParams,
  type SheepProgress,
  type IceParams,
  type IceProgress,
  type PlankParams,
  type PlankProgress,
  type SeesawParams,
  type SeesawProgress,
  type BeltsParams,
  type BeltsProgress,
  type NeedleParams,
  type NeedleProgress,
  type WiresParams,
  type WiresProgress,
} from '../../spacetimedb/src/sim';
import { blit } from './sprites';

export const FONT_DISPLAY = "'Bungee', 'Impact', sans-serif";
export const FONT_PIXEL = "'VT323', ui-monospace, monospace";

export const GAME_META: Record<string, { exe: string; title: string; color: string; goal: string }> = {
  targets: { exe: 'CLICKFEST.EXE', title: 'Clickfest', color: '#ff5a36', goal: 'Hit every numbered target in order. Touch the WRONG number = a strike; three and you are out.' },
  maze: { exe: 'MAZE.EXE', title: 'The Maze', color: '#2ec4b6', goal: 'Reach the trophy. Touch a wall = back to start, and you only get a few bonks.' },
  minesweeper: { exe: 'MINES.EXE', title: 'Mob Sweeper', color: '#3a86ff', goal: 'Nobody clicks. The cursor clicks BY ITSELF on a random fuse: park it on a safe cell before it fires 💣' },
  redlight: { exe: 'REDLIGHT.EXE', title: 'Red Light, Green Light', color: '#43b047', goal: 'Walk the doll to the end: she only moves on GREEN with the cursor close to her. Move on RED and she gets dragged back.' },
  balloon: { exe: 'BALLOON.EXE', title: 'Keep It Up', color: '#4dabf7', goal: 'Get under the balloon to bop it up. Rack up the saves; too many drops and you are out.' },
  mole: { exe: 'WHACK.EXE', title: 'Whack-a-Mole', color: '#8b5a2b', goal: 'Be ON the mole when it ducks back down. Too many misses = game over.' },
  potato: { exe: 'POTATO.EXE', title: 'Hot Potato', color: '#f08c00', goal: 'The cursor is a hot potato. Deliver it bucket after bucket before each fuse hits zero!' },
  chairs: { exe: 'CHAIRS.EXE', title: 'Musical Chairs', color: '#da77f2', goal: 'When the music stops, be on a chair. A chair goes each round. Sit on the last one!' },
  keyboard: { exe: 'KEYBOARD.EXE', title: 'Giant Keyboard', color: '#5c7cfa', goal: 'Type the phrase: hold the cursor on each letter in order. Wrong key = a typo; too many and you are out.' },
  hunt: { exe: 'HUNT.EXE', title: 'Warmer, Colder', color: '#e8590c', goal: 'Something is hidden. The meter only says warmer or colder. Find it and HOLD STILL on it. Decoys feel WARM but never BOIL: sit on one and the trap springs.' },
  valves: { exe: 'VALVES.EXE', title: 'Pressure Room', color: '#0ca678', goal: 'Every gauge must sit in the green at once. Holding a valve fills it; the others leak. Keep them all green for the hold.' },
  stations: { exe: 'STATIONS.EXE', title: 'Grand Tour', color: '#7048e8', goal: 'Memorize the numbered stops — the numbers vanish after a few seconds. Visit them in order and wait at each. Leave early = a strike.' },
  echo: { exe: 'ECHO.EXE', title: 'Echo', color: '#4dabf7', goal: 'Watch the pads light up, then park on them in the same order. Wrong pad or leaving early = a fault and the round restarts.' },
  crane: { exe: 'CRANE.EXE', title: 'Tower Crane', color: '#ff922b', goal: 'The block swings. Hold the lever to drop it when it is over the stack. Off-centre drops shrink the block; miss the stack and it topples.' },
  spotlight: { exe: 'SPOTLIGHT.EXE', title: 'Spotlight', color: '#ffe680', goal: 'Stay inside the walking light. Every second outside drains health. Reach the end of the path alive.' },
  sheep: { exe: 'SHEEP.EXE', title: 'Sheep Dog', color: '#f3f0ff', goal: 'Get near a sheep to nudge it toward the pen. Pen them all and keep them in for the hold. Escapes count against you.' },
  ice: { exe: 'ICE.EXE', title: 'Ice Rink', color: '#a5d8ff', goal: 'The cursor slides. Come to a dead stop inside each gate in order. Sliding through = a fault.' },
  plank: { exe: 'PLANK.EXE', title: 'Plank Walk', color: '#d9a35c', goal: 'Hold perfectly still on each bridge tile to set it. Moving wipes the tile. Build the whole bridge.' },
  seesaw: { exe: 'SEESAW.EXE', title: 'Seesaw', color: '#8b5a2b', goal: 'Cursor left/right tilts the board. Roll the ball into the pocket slowly. Off the end = a fault.' },
  belts: { exe: 'BELTS.EXE', title: 'Conveyor Belts', color: '#4a4e69', goal: 'Belts drag the cursor. Reach the EXIT. Hazards zap you back to the last checkpoint and count a fault.' },
  needle: { exe: 'NEEDLE.EXE', title: 'Thread the Needle', color: '#ff5a36', goal: 'Each wall has one moving gap. Slip through every gap. Touching a wall sends you back and counts a fault.' },
  wires: { exe: 'WIRES.EXE', title: 'Secret Wires', color: '#ffd43b', goal: 'Only the NEXT color is shown. Hold on that node to connect it. Any other node = a strike.' },
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
  hunt: '#1d2a1f',
  valves: '#2f3640',
  stations: '#e9ecef',
  echo: '#1a1b26',
  crane: '#87c5ff',
  spotlight: '#101418',
  sheep: '#5c9e3c',
  ice: '#bfe6ff',
  plank: '#2f5d8a',
  seesaw: '#f0d9b5',
  belts: '#2b2d42',
  needle: '#1e2a38',
  wires: '#23272e',
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
    // Grass verge under the light, asphalt yard where the doll walks (her path is drawn by the level).
    g.fillStyle = '#3b7a3b';
    g.fillRect(0, 0, WORLD_W, WORLD_H);
    g.fillStyle = '#4a4a52';
    g.fillRect(0, REDLIGHT_TOP, WORLD_W, WORLD_H - REDLIGHT_TOP);
    g.fillStyle = 'rgba(0,0,0,0.08)';
    for (let i = 0; i < 70; i++) g.fillRect((i * 5.13) % WORLD_W, REDLIGHT_TOP + ((i * 2.71) % (WORLD_H - REDLIGHT_TOP)), 0.25, 0.08);
  } else if (kind === 'hunt') {
    // Dark lawn with a faint grid: the only clue is the meter.
    g.fillStyle = '#1d2a1f';
    g.fillRect(0, 0, WORLD_W, WORLD_H);
    g.strokeStyle = 'rgba(255,255,255,0.07)';
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
  } else if (kind === 'valves') {
    // Riveted steel plates.
    checker(g, '#2f3640', '#353b48', 2);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    for (let y = 0.3; y < WORLD_H; y += 2) for (let x = 0.3; x < WORLD_W; x += 2) g.fillRect(x, y, 0.12, 0.12);
  } else if (kind === 'stations') {
    // Map paper with a soft grid.
    g.fillStyle = '#e9ecef';
    g.fillRect(0, 0, WORLD_W, WORLD_H);
    g.strokeStyle = 'rgba(0,0,0,0.07)';
    g.lineWidth = 2 * px;
    g.beginPath();
    for (let x = 0.5; x < WORLD_W; x += 1) {
      g.moveTo(x, 0);
      g.lineTo(x, WORLD_H);
    }
    for (let y = 0.5; y < WORLD_H; y += 1) {
      g.moveTo(0, y);
      g.lineTo(WORLD_W, y);
    }
    g.stroke();
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
  } else if (FIELD_COLOR[kind]) {
    g.fillStyle = FIELD_COLOR[kind];
    g.fillRect(0, 0, WORLD_W, WORLD_H);
    if (kind === 'ice') checker(g, 'rgba(255,255,255,0.25)', 'rgba(255,255,255,0.05)', 1);
    else if (kind === 'belts') checker(g, 'rgba(255,255,255,0.05)', 'rgba(0,0,0,0.05)', 1);
    else dots(g, kind === 'crane' || kind === 'seesaw' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)');
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
  else if (lv.kind === 'minesweeper') drawMines(g, lv.params as MinesParams, lv.progress as MinesProgress, px, serverMs, lv.playAt, cursor, detail);
  else if (lv.kind === 'redlight') drawRedlight(g, lv.params as RedlightParams, lv.progress as RedlightProgress, px, serverMs, cursor, detail);
  else if (lv.kind === 'balloon') drawBalloon(g, lv.params as BalloonParams, lv.progress as BalloonProgress, px, serverMs, cursor, detail);
  else if (lv.kind === 'mole') drawMole(g, lv.params as MoleParams, lv.progress as MoleProgress, px, serverMs, cursor, detail);
  else if (lv.kind === 'potato') drawPotato(g, lv.params as PotatoParams, lv.progress as PotatoProgress, px, serverMs, Math.max(0, t), cursor, detail);
  else if (lv.kind === 'chairs') drawChairs(g, lv.params as ChairsParams, lv.progress as ChairsProgress, px, serverMs, cursor, detail);
  else if (lv.kind === 'keyboard') drawKeyboard(g, lv.params as KeyboardParams, lv.progress as KeyboardProgress, px, serverMs, detail);
  else if (lv.kind === 'hunt') drawHunt(g, lv.params as HuntParams, lv.progress as HuntProgress, px, serverMs, cursor, detail);
  else if (lv.kind === 'valves') drawValves(g, lv.params as ValvesParams, lv.progress as ValvesProgress, px, serverMs, cursor, detail);
  else if (lv.kind === 'stations') drawStations(g, lv.params as StationsParams, lv.progress as StationsProgress, px, serverMs, Math.max(0, t), cursor, detail);
  else if (lv.kind === 'echo') drawEcho(g, lv.params as EchoParams, lv.progress as EchoProgress, px, serverMs, cursor, detail);
  else if (lv.kind === 'crane') drawCrane(g, lv.params as CraneParams, lv.progress as CraneProgress, px, serverMs, Math.max(0, t), cursor, detail);
  else if (lv.kind === 'spotlight') drawSpotlight(g, lv.params as SpotlightParams, lv.progress as SpotlightProgress, px, serverMs, Math.max(0, t), cursor, detail);
  else if (lv.kind === 'sheep') drawSheep(g, lv.params as SheepParams, lv.progress as SheepProgress, px, serverMs, cursor, detail);
  else if (lv.kind === 'ice') drawIce(g, lv.params as IceParams, lv.progress as IceProgress, px, serverMs, cursor, detail);
  else if (lv.kind === 'plank') drawPlank(g, lv.params as PlankParams, lv.progress as PlankProgress, px, serverMs, cursor, detail);
  else if (lv.kind === 'seesaw') drawSeesaw(g, lv.params as SeesawParams, lv.progress as SeesawProgress, px, serverMs, cursor, detail);
  else if (lv.kind === 'belts') drawBelts(g, lv.params as BeltsParams, lv.progress as BeltsProgress, px, serverMs, Math.max(0, t), cursor, detail);
  else if (lv.kind === 'needle') drawNeedle(g, lv.params as NeedleParams, lv.progress as NeedleProgress, px, serverMs, Math.max(0, t), cursor, detail);
  else if (lv.kind === 'wires') drawWires(g, lv.params as WiresParams, lv.progress as WiresProgress, px, serverMs, cursor, detail);
}

/** Horizontal countdown bar: `frac` 1 = full. */
function timeBar(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frac: number, color: string, px: number) {
  g.fillStyle = '#111';
  g.fillRect(x, y, w, h);
  g.fillStyle = color;
  g.fillRect(x + 2 * px, y + 2 * px, Math.max(0, (w - 4 * px) * clamp(frac, 0, 1)), h - 4 * px);
}

/** Dwell progress ring around a point (hunt, stations, valves hold). */
function dwellRing(g: CanvasRenderingContext2D, x: number, y: number, r: number, frac: number, color: string, px: number) {
  g.lineWidth = 7 * px;
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = color;
  g.beginPath();
  g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(frac, 0, 1));
  g.stroke();
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
    if (i === prog.on) {
      // Sitting on the wrong number: red alarm ring.
      g.strokeStyle = Math.floor(ms / 120) % 2 ? '#ff3b3b' : '#fff';
      g.lineWidth = 4 * px;
      g.beginPath();
      g.arc(pos.x, pos.y, p.r * 1.15, 0, Math.PI * 2);
      g.stroke();
    }
    if (detail || isNext) sticker(g, pos.x + p.r * 0.75, pos.y - p.r * 0.75, String(i + 1), isNext ? 0.42 : 0.3, isNext ? '#ffd23f' : i === prog.on ? '#ff3b3b' : '#fff', i === prog.on ? '#fff' : '#111', px);
  });
  if (detail && p.strikeCap) {
    const hot = prog.strikes >= p.strikeCap - 1;
    sticker(g, 1.6, 0.6, `STRIKES ${prog.strikes}/${p.strikeCap}`, 0.3, hot ? '#ff3b3b' : '#ffffff', hot ? '#fff' : '#111', px);
  }
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
    case 'hunt':
      return heatMeter(g, cx, cy, s * 1.6, s * 0.5, Math.floor(ms / 250) % (HUNT_BARS + 1), px);
    case 'valves':
      return gauge(g, cx, cy, s * 0.5, s * 1.4, 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(ms / 400)), [0.35, 0.65], px);
    case 'stations':
      return stationShape(g, cx, cy, s * 0.7, '?', '#7048e8', px, true);
    case 'echo': {
      const lit = Math.floor(ms / 350) % 4;
      [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]].forEach(([dx, dy], i) => {
        g.fillStyle = i === lit ? ECHO_COLORS[i] : '#2c2f3a';
        g.beginPath();
        g.arc(cx + dx * s * 0.8, cy + dy * s * 0.8, s * 0.32, 0, Math.PI * 2);
        g.fill();
        g.lineWidth = 3 * px;
        g.strokeStyle = ECHO_COLORS[i];
        g.stroke();
      });
      return;
    }
    case 'crane': {
      const sw = Math.sin(ms / 500) * s * 0.5;
      g.strokeStyle = '#ddd';
      g.lineWidth = 3 * px;
      g.beginPath();
      g.moveTo(cx, cy - s);
      g.lineTo(cx + sw, cy - s * 0.3);
      g.stroke();
      g.fillStyle = '#ff922b';
      g.fillRect(cx + sw - s * 0.35, cy - s * 0.3, s * 0.7, s * 0.4);
      g.fillStyle = '#4dabf7';
      g.fillRect(cx - s * 0.4, cy + s * 0.3, s * 0.8, s * 0.4);
      g.fillStyle = '#69db7c';
      g.fillRect(cx - s * 0.45, cy + s * 0.7, s * 0.9, s * 0.4);
      g.strokeStyle = '#111';
      g.strokeRect(cx + sw - s * 0.35, cy - s * 0.3, s * 0.7, s * 0.4);
      g.strokeRect(cx - s * 0.4, cy + s * 0.3, s * 0.8, s * 0.4);
      g.strokeRect(cx - s * 0.45, cy + s * 0.7, s * 0.9, s * 0.4);
      return;
    }
    case 'spotlight': {
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, s);
      grad.addColorStop(0, 'rgba(255,245,200,0.95)');
      grad.addColorStop(1, 'rgba(255,230,150,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cx, cy, s, 0, Math.PI * 2);
      g.fill();
      return drawCursorSprite(g, cx - s * 0.2, cy - s * 0.3, s * 0.8, '#fff');
    }
    case 'sheep':
      return sheepShape(g, cx, cy, 1, px, false, ms);
    case 'ice':
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.beginPath();
      g.arc(cx, cy, s * 0.8, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 4 * px;
      g.strokeStyle = '#ffd23f';
      g.stroke();
      return worldText(g, '1', cx, cy + 0.05, s * 0.8, { font: FONT_PIXEL, fill: '#fff', stroke: '#111', strokeW: 0.08, align: 'center', baseline: 'middle' });
    case 'plank':
      for (let i = 0; i < 3; i++) {
        g.fillStyle = i < 2 ? '#b07a3a' : 'rgba(255,255,255,0.15)';
        g.fillRect(cx - s * 1.1 + i * s * 0.75, cy - s * 0.3, s * 0.65, s * 0.6);
        g.lineWidth = 3 * px;
        g.strokeStyle = i < 2 ? '#5a3a16' : '#ffd23f';
        g.strokeRect(cx - s * 1.1 + i * s * 0.75, cy - s * 0.3, s * 0.65, s * 0.6);
      }
      return;
    case 'seesaw': {
      const a = Math.sin(ms / 600) * 0.3;
      g.fillStyle = '#555';
      g.beginPath();
      g.moveTo(cx - s * 0.3, cy + s * 0.7);
      g.lineTo(cx + s * 0.3, cy + s * 0.7);
      g.lineTo(cx, cy + s * 0.1);
      g.closePath();
      g.fill();
      g.strokeStyle = '#8b5a2b';
      g.lineWidth = 8 * px;
      g.beginPath();
      g.moveTo(cx - Math.cos(a) * s, cy + s * 0.1 - Math.sin(a) * s);
      g.lineTo(cx + Math.cos(a) * s, cy + s * 0.1 + Math.sin(a) * s);
      g.stroke();
      g.fillStyle = '#ff4d6d';
      g.beginPath();
      g.arc(cx - Math.cos(a) * s * 0.4, cy + s * 0.1 - Math.sin(a) * s * 0.4 - s * 0.25, s * 0.22, 0, Math.PI * 2);
      g.fill();
      return;
    }
    case 'belts':
      g.fillStyle = '#4a4e69';
      g.fillRect(cx - s, cy - s * 0.4, s * 2, s * 0.8);
      g.strokeStyle = '#fff';
      g.lineWidth = 3 * px;
      for (let k = 0; k < 3; k++) {
        const f = ((ms / 500 + k / 3) % 1) * 2 - 1;
        g.beginPath();
        g.moveTo(cx + f * s * 0.8 - s * 0.15, cy - s * 0.25);
        g.lineTo(cx + f * s * 0.8 + s * 0.1, cy);
        g.lineTo(cx + f * s * 0.8 - s * 0.15, cy + s * 0.25);
        g.stroke();
      }
      return;
    case 'needle': {
      const gy = cy + Math.sin(ms / 500) * s * 0.4;
      g.fillStyle = '#ff5a36';
      g.fillRect(cx - s * 0.15, cy - s, s * 0.3, gy - s * 0.3 - (cy - s));
      g.fillRect(cx - s * 0.15, gy + s * 0.3, s * 0.3, cy + s - gy - s * 0.3);
      g.strokeStyle = '#111';
      g.lineWidth = 2 * px;
      g.strokeRect(cx - s * 0.15, cy - s, s * 0.3, gy - s * 0.3 - (cy - s));
      g.strokeRect(cx - s * 0.15, gy + s * 0.3, s * 0.3, cy + s - gy - s * 0.3);
      return;
    }
    case 'wires':
      [0, 1, 2].forEach(i => {
        g.fillStyle = WIRE_COLORS[i];
        g.beginPath();
        g.arc(cx - s * 0.8 + i * s * 0.8, cy + (i === 1 ? -s * 0.4 : s * 0.3), s * 0.32, 0, Math.PI * 2);
        g.fill();
        g.lineWidth = 3 * px;
        g.strokeStyle = '#111';
        g.stroke();
      });
      return;
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

/** The doll: a little figure; `walking` swings her arms, `frozen` (red) gives her watching eyes. */
function dollShape(g: CanvasRenderingContext2D, x: number, y: number, walking: boolean, frozen: boolean, px: number, ms: number) {
  const s = 0.42;
  const swing = walking ? Math.sin(ms / 110) * 0.35 : 0;
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.beginPath();
  g.ellipse(x, y + s * 1.05, s * 0.7, s * 0.22, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = frozen ? '#9fd3ff' : '#ff8fab';
  g.beginPath();
  g.moveTo(x, y - s * 0.3);
  g.lineTo(x + s * 0.65, y + s * 0.95);
  g.lineTo(x - s * 0.65, y + s * 0.95);
  g.closePath();
  g.fill();
  g.lineWidth = 3 * px;
  g.strokeStyle = '#111';
  g.stroke();
  g.beginPath();
  g.moveTo(x - s * 0.1, y);
  g.lineTo(x - s * 0.75, y + s * (0.35 + swing));
  g.moveTo(x + s * 0.1, y);
  g.lineTo(x + s * 0.75, y + s * (0.35 - swing));
  g.stroke();
  g.fillStyle = '#ffe0bd';
  g.beginPath();
  g.arc(x, y - s * 0.7, s * 0.42, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = '#4a2a10';
  g.beginPath();
  g.arc(x - s * 0.5, y - s * 0.8, s * 0.16, 0, Math.PI * 2);
  g.arc(x + s * 0.5, y - s * 0.8, s * 0.16, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#111';
  if (frozen) {
    g.beginPath();
    g.arc(x - s * 0.15, y - s * 0.72, s * 0.08, 0, Math.PI * 2);
    g.arc(x + s * 0.15, y - s * 0.72, s * 0.08, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#ff3b3b';
    g.lineWidth = 2 * px;
    g.beginPath();
    g.arc(x - s * 0.15, y - s * 0.72, s * 0.14, 0, Math.PI * 2);
    g.arc(x + s * 0.15, y - s * 0.72, s * 0.14, 0, Math.PI * 2);
    g.stroke();
  } else {
    g.fillRect(x - s * 0.2, y - s * 0.74, s * 0.1, s * 0.06);
    g.fillRect(x + s * 0.1, y - s * 0.74, s * 0.1, s * 0.06);
  }
}

function drawRedlight(g: CanvasRenderingContext2D, p: RedlightParams, prog: RedlightProgress, px: number, ms: number, cursor: { x: number; y: number }, detail: boolean) {
  const red = prog.light === 'red';
  if (red) {
    g.fillStyle = `rgba(255,59,59,${0.12 + 0.06 * Math.sin(ms / 120)})`;
    g.fillRect(0, REDLIGHT_TOP, WORLD_W, WORLD_H - REDLIGHT_TOP);
  }
  // The path: a pale lane with a dashed centre line; the part the doll has walked is lit green.
  const s = dollS(p, prog, ms);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(255,255,255,0.14)';
  g.lineWidth = 0.9;
  g.beginPath();
  p.path.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)));
  g.stroke();
  g.strokeStyle = 'rgba(67,224,90,0.35)';
  g.beginPath();
  let acc = 0;
  for (let i = 0; i < p.path.length; i++) {
    const q = p.path[i];
    if (i === 0) {
      g.moveTo(q.x, q.y);
      continue;
    }
    const a = p.path[i - 1];
    const seg = Math.hypot(q.x - a.x, q.y - a.y);
    if (acc + seg <= s) g.lineTo(q.x, q.y);
    else {
      const f = seg > 0 ? Math.max(0, (s - acc) / seg) : 0;
      g.lineTo(a.x + (q.x - a.x) * f, a.y + (q.y - a.y) * f);
      break;
    }
    acc += seg;
  }
  g.stroke();
  g.save();
  g.strokeStyle = 'rgba(255,255,255,0.4)';
  g.lineWidth = 3 * px;
  g.setLineDash([0.3, 0.3]);
  g.beginPath();
  p.path.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)));
  g.stroke();
  g.restore();
  g.lineCap = 'butt';
  // Start pad and the finish.
  const start = p.path[0];
  const end = p.path[p.path.length - 1];
  g.save();
  g.strokeStyle = '#ffd23f';
  g.lineWidth = 4 * px;
  g.setLineDash([0.12, 0.08]);
  g.strokeRect(start.x - 0.6, start.y - 0.6, 1.2, 1.2);
  g.restore();
  const sq = 0.25;
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      g.fillStyle = (r + c) % 2 ? '#111' : '#fff';
      g.fillRect(end.x - 0.5 + c * sq, end.y - 0.5 + r * sq, sq, sq);
    }
  blit(g, 'flag', end.x + 0.55, end.y - 0.9 + Math.abs(Math.sin(ms / 300)) * 0.1, 0.05, { shadow: 0.05 });
  // Doll + leash: she walks while the cursor is inside this ring (and the light is green).
  const d = dollPos(p, prog, ms);
  const near = Math.hypot(cursor.x - d.x, cursor.y - d.y) <= p.leash;
  g.save();
  g.setLineDash([0.16, 0.12]);
  g.lineDashOffset = -ms / 400;
  g.lineWidth = (near ? 6 : 4) * px;
  g.strokeStyle = red ? 'rgba(255,59,59,0.7)' : near ? '#43e05a' : 'rgba(255,255,255,0.6)';
  g.beginPath();
  g.arc(d.x, d.y, p.leash, 0, Math.PI * 2);
  g.stroke();
  g.restore();
  // Where a fault would send her.
  if (red && detail) {
    const back = dollPos(p, { ...prog, s: Math.max(0, s - p.rewind), walking: false }, ms);
    g.save();
    g.setLineDash([0.08, 0.1]);
    g.strokeStyle = 'rgba(255,59,59,0.8)';
    g.lineWidth = 3 * px;
    g.beginPath();
    g.arc(back.x, back.y, 0.3, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }
  dollShape(g, d.x, d.y, prog.walking && !red, red, px, ms);
  if (!red && !near && detail) sticker(g, d.x, d.y - 1.1, 'COME CLOSER!', 0.3, '#ffd23f', '#111', px);
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
  // The light, the shout and the light timer. On red the bar is exact (time to
  // green); on green it drains against the longest possible green so a fake-out
  // never shows up on it.
  trafficLight(g, WORLD_W / 2, 0.75, 0.38, prog.light, px, ms);
  headline(g, red ? 'FREEZE!' : 'GO GO GO!', 3.2, 0.75, 0.7, red ? '#ff3b3b' : '#43e05a', px);
  const barW = 3.6;
  const frac = red ? clamp((prog.flipAt - ms) / Math.max(1, prog.flipAt - prog.litAt), 0, 1) : clamp(1 - (ms - prog.litAt) / (p.greenMaxS * 1000), 0, 1);
  timeBar(g, WORLD_W / 2 - barW / 2, 1.3, barW, 0.22, frac, red ? '#ff3b3b' : '#43e05a', px);
  // How far the doll has walked.
  const prog01 = p.length > 0 ? s / p.length : 0;
  timeBar(g, 0.4, REDLIGHT_TOP - 0.3, 2.6, 0.2, prog01, '#ffd23f', px);
  if (detail) {
    worldText(g, `${Math.round(prog01 * 100)}% WALKED`, 3.15, REDLIGHT_TOP - 0.13, 0.26, { fill: '#fff', stroke: '#111', strokeW: 0.07, baseline: 'middle' });
    sticker(g, WORLD_W - 2.2, 0.75, `FAULTS ${prog.faults}/${p.faultCap}`, 0.38, prog.faults >= p.faultCap - 1 ? '#ff3b3b' : '#ffffff', '#111', px);
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
  const round = Math.min(prog.round, p.rounds - 1);
  // Delivered buckets stay as faint stamps.
  for (let i = 0; i < round; i++) {
    const q = p.buckets[i];
    g.globalAlpha = 0.3;
    blit(g, 'star', q.x, q.y, 0.05, { center: true });
    g.globalAlpha = 1;
  }
  const b = bucketPos(p, round, t);
  const inside = Math.hypot(cursor.x - b.x, cursor.y - b.y) <= p.r;
  bucketShape(g, b.x, b.y, p.r, inside, px);
  if (inside) sticker(g, b.x, b.y - p.r - 0.4, 'STAY HERE!', 0.3, '#ffd23f', '#111', px);
  // The potato rides with the cursor; the fuse ring counts this delivery down.
  const left = Math.max(0, (prog.fuseAt - ms) / 1000);
  potatoShape(g, cursor.x + 0.55, cursor.y + 0.65, 0.42, px, ms);
  drawFuse(g, cursor.x, cursor.y, left, px, p.fuseS);
  const secs = Math.ceil(left);
  headline(g, String(secs), WORLD_W / 2, 1.0, 1.4, secs <= 3 ? '#ff3b3b' : '#ffd23f', px);
  sticker(g, WORLD_W - 2.0, 0.7, `DELIVERY ${round + 1}/${p.rounds}`, 0.34, '#ffffff', '#111', px);
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
  // Music bar: drains against the longest possible round, so the exact stop stays a surprise until the warning.
  if (!safe) {
    const total = p.musicMaxS * 1000;
    const started = prog.stopAt - total;
    timeBar(g, WORLD_W / 2 - 1.8, 1.32, 3.6, 0.22, clamp(1 - (ms - started) / total, 0, 1), warn ? '#ff3b3b' : '#da77f2', px);
  }
  if (detail) sticker(g, WORLD_W - 1.9, 1.6, `${prog.left.length} CHAIR${prog.left.length === 1 ? '' : 'S'} · ROUND ${prog.round}`, 0.3, '#ffffff', '#111', px);
}

// ---------------------------------------------------------------------------
// Giant Keyboard
// ---------------------------------------------------------------------------

function drawKeyboard(g: CanvasRenderingContext2D, p: KeyboardParams, prog: KeyboardProgress, px: number, ms: number, detail: boolean) {
  // Phrase strip: typed letters green, the next one gold and pulsing, the rest blank; spaces are gaps.
  const n = p.word.length;
  const gap = 0.06;
  const bw = Math.min(1.2, (WORLD_W - 1 - (n - 1) * gap) / n);
  const bh = Math.min(1.3, bw * 1.25);
  const x0 = (WORLD_W - (n * bw + (n - 1) * gap)) / 2;
  const y0 = 0.3 + (1.3 - bh) / 2;
  for (let i = 0; i < n; i++) {
    const ch = p.word[i];
    if (ch === ' ') continue;
    const done = i < prog.next;
    const next = i === prog.next;
    const pulse = next ? 1 + 0.04 * Math.sin(ms / 140) : 1;
    const r = { x: x0 + i * (bw + gap) - (bw * (pulse - 1)) / 2, y: y0 - (bh * (pulse - 1)) / 2, w: bw * pulse, h: bh * pulse };
    keycap(g, r, done || next ? ch : '?', done ? '#69db7c' : next ? '#ffd23f' : '#f3ead7', px, done || next ? '#111' : 'rgba(17,17,17,0.35)');
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
    worldText(g, hint, WORLD_W - 0.3, 2.05, 0.36, { fill: '#5c7cfa', stroke: '#111', strokeW: 0.1, align: 'right', baseline: 'middle' });
    if (p.typoCap) {
      const hot = prog.buzzes >= p.typoCap - 1;
      sticker(g, 1.3, 2.05, `TYPOS ${prog.buzzes}/${p.typoCap}`, 0.28, hot ? '#ff3b3b' : '#ffffff', hot ? '#fff' : '#111', px);
    }
  }
}

const NUM_COLORS = ['', '#1d4ed8', '#15803d', '#dc2626', '#1e3a8a', '#7f1d1d', '#0e7490', '#111', '#6b7280'];

function drawMines(g: CanvasRenderingContext2D, m: MinesParams, prog: MinesProgress, px: number, ms: number, playAt: number, cursor: { x: number; y: number }, detail: boolean) {
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
  // The only way a cell gets revealed: the server's timer clicks whatever is under
  // the cursor at nextAutoAt. Everyone sees that fuse the whole time.
  if (prog.nextAutoAt && ms >= playAt) {
    const left = Math.max(0, (prog.nextAutoAt - ms) / 1000);
    drawFuse(g, cursor.x, cursor.y, left, px, m.autoMaxS);
    if (detail) {
      const label = prog.firstDone ? `AUTO-CLICK IN ${Math.ceil(left)}` : `FIRST CLICK (SAFE) IN ${Math.ceil(left)}`;
      sticker(g, WORLD_W / 2, 0.45, label, 0.32, left < 3 ? '#ff3b3b' : '#ffd23f', '#111', px);
    }
  }
}

/** Warmer/colder meter: `bars` of HUNT_BARS lit, cold blue through hot red. */
function heatMeter(g: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, bars: number, px: number) {
  const n = HUNT_BARS;
  const gap = w * 0.02;
  const bw = (w - gap * (n - 1)) / n;
  const x0 = cx - w / 2;
  g.fillStyle = '#111';
  g.fillRect(x0 - 4 * px, cy - h / 2 - 4 * px, w + 8 * px, h + 8 * px);
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const lit = i < bars;
    const col = f < 0.5 ? `hsl(${210 - f * 2 * 160}, 90%, ${lit ? 55 : 22}%)` : `hsl(${50 - (f - 0.5) * 2 * 50}, 95%, ${lit ? 55 : 22}%)`;
    g.fillStyle = col;
    const bh = h * (0.45 + 0.55 * f);
    g.fillRect(x0 + i * (bw + gap), cy + h / 2 - bh, bw, bh);
  }
}

/** Vertical pressure gauge with the green zone marked. `level` 0..1 (can run above 1 before a blowout). */
function gauge(g: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, level: number, zone: [number, number], px: number, held = false, blown = false) {
  const x = cx - w / 2;
  const y = cy - h / 2;
  g.fillStyle = '#111';
  g.fillRect(x - 4 * px, y - 4 * px, w + 8 * px, h + 8 * px);
  g.fillStyle = '#2b2f36';
  g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(67,224,90,0.35)';
  g.fillRect(x, y + h * (1 - zone[1]), w, h * (zone[1] - zone[0]));
  const lv = clamp(level, 0, 1);
  const inZ = level >= zone[0] && level <= zone[1];
  g.fillStyle = blown ? '#ff3b3b' : inZ ? '#43e05a' : level > zone[1] ? '#ff922b' : '#4dabf7';
  g.fillRect(x + w * 0.15, y + h * (1 - lv), w * 0.7, h * lv);
  g.strokeStyle = '#43e05a';
  g.lineWidth = 2 * px;
  g.strokeRect(x, y + h * (1 - zone[1]), w, h * (zone[1] - zone[0]));
  if (held) {
    g.strokeStyle = '#ffd23f';
    g.lineWidth = 5 * px;
    g.strokeRect(x - 6 * px, y - 6 * px, w + 12 * px, h + 12 * px);
  }
}

/** Numbered tour station. */
function stationShape(g: CanvasRenderingContext2D, x: number, y: number, r: number, label: string, color: string, px: number, next: boolean, done = false) {
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.beginPath();
  g.arc(x + r * 0.08, y + r * 0.1, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = done ? '#69db7c' : next ? color : '#f3ead7';
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = (next ? 5 : 3) * px;
  g.strokeStyle = '#111';
  g.stroke();
  worldText(g, done ? '✓' : label, x, y + r * 0.08, r * 1.05, { font: FONT_PIXEL, fill: next ? '#fff' : '#111', stroke: next ? '#111' : undefined, strokeW: 0.08, align: 'center', baseline: 'middle' });
}

function drawHunt(g: CanvasRenderingContext2D, p: HuntParams, prog: HuntProgress, px: number, ms: number, cursor: { x: number; y: number }, detail: boolean) {
  // Already-found treasure stays on the map.
  for (const f of prog.found) {
    g.globalAlpha = 0.85;
    blit(g, 'star', f.x, f.y, 0.06, { center: true });
    g.globalAlpha = 1;
    g.strokeStyle = 'rgba(255,210,63,0.5)';
    g.lineWidth = 3 * px;
    g.beginPath();
    g.arc(f.x, f.y, p.radius, 0, Math.PI * 2);
    g.stroke();
  }
  // Sprung decoys stay on the map as a warning.
  for (const t of prog.sprung ?? []) {
    g.strokeStyle = 'rgba(255,59,59,0.85)';
    g.lineWidth = 4 * px;
    g.beginPath();
    g.arc(t.x, t.y, p.radius, 0, Math.PI * 2);
    g.stroke();
    const k = p.radius * 0.5;
    g.beginPath();
    g.moveTo(t.x - k, t.y - k);
    g.lineTo(t.x + k, t.y + k);
    g.moveTo(t.x + k, t.y - k);
    g.lineTo(t.x - k, t.y + k);
    g.stroke();
  }
  // The meter is the whole game: hot means close, and it is noisy on purpose.
  const hot = prog.bars >= HUNT_BARS - 1;
  heatMeter(g, WORLD_W / 2, 0.85, 5.2, 0.9, prog.bars, px);
  const word = prog.bars >= 9 ? 'BOILING!' : prog.bars >= 7 ? 'HOT' : prog.bars >= 5 ? 'WARM' : prog.bars >= 3 ? 'COOL' : 'COLD';
  headline(g, word, WORLD_W / 2 + 4.4, 0.85, 0.6, prog.bars >= 7 ? '#ff3b3b' : prog.bars >= 5 ? '#ffd23f' : '#4dabf7', px);
  // Dwell ring around the cursor while it is sitting on the treasure.
  if (prog.dwellSince > 0) {
    const frac = clamp((ms - prog.dwellSince) / (p.dwellS * 1000), 0, 1);
    dwellRing(g, cursor.x, cursor.y, p.radius, frac, '#ffd23f', px);
    sticker(g, cursor.x, cursor.y - p.radius - 0.4, `HOLD STILL ${Math.ceil(p.dwellS - frac * p.dwellS)}`, 0.3, '#ffd23f', '#111', px);
  } else if (prog.trapSince > 0) {
    // Sitting on a decoy: the ring fills red — get off before it springs.
    const frac = clamp((ms - prog.trapSince) / (p.dwellS * 1000), 0, 1);
    dwellRing(g, cursor.x, cursor.y, p.radius, frac, '#ff3b3b', px);
    sticker(g, cursor.x, cursor.y - p.radius - 0.4, 'NOT BOILING — MOVE!', 0.3, '#ff3b3b', '#fff', px);
  } else if (hot) {
    g.save();
    g.setLineDash([0.1, 0.1]);
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.lineWidth = 3 * px;
    g.beginPath();
    g.arc(cursor.x, cursor.y, p.radius, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }
  if (detail) {
    sticker(g, WORLD_W - 2.0, 0.85, `FOUND ${prog.found.length}/${p.finds}`, 0.36, '#ffffff', '#111', px);
    if (p.trapCap) {
      const hotT = (prog.traps ?? 0) >= p.trapCap - 1;
      sticker(g, WORLD_W - 2.0, 1.55, `TRAPS ${prog.traps ?? 0}/${p.trapCap}`, 0.3, hotT ? '#ff3b3b' : '#ffffff', hotT ? '#fff' : '#111', px);
    }
    if (p.decoys > 0) worldText(g, `${p.decoys} DECOY${p.decoys === 1 ? '' : 'S'} · WARM BUT NEVER BOILING · SIT ON ONE = TRAP`, 0.4, 1.55, 0.26, { fill: 'rgba(255,255,255,0.7)', stroke: '#111', strokeW: 0.07, baseline: 'middle' });
  }
}

function drawValves(g: CanvasRenderingContext2D, p: ValvesParams, prog: ValvesProgress, px: number, ms: number, cursor: { x: number; y: number }, detail: boolean) {
  const levels = valveLevelsNow(p, prog, ms);
  const n = p.valves.length;
  const gw = Math.min(0.9, (WORLD_W - 1) / n - 0.3);
  const gaugeY = 1.05;
  let allIn = true;
  for (let i = 0; i < n; i++) {
    const v = p.valves[i];
    const held = prog.held === i;
    const inZ = valveInZone(p, levels[i]);
    if (!inZ) allIn = false;
    // Gauge strip up top, one per valve, lined up with its wheel.
    const gx = 0.5 + ((i + 0.5) / n) * (WORLD_W - 1);
    gauge(g, gx, gaugeY, gw, 1.5, levels[i], p.zone, px, held, levels[i] >= 1);
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 2 * px;
    g.beginPath();
    g.moveTo(gx, gaugeY + 0.8);
    g.lineTo(v.x, v.y - p.r);
    g.stroke();
    // The wheel.
    const under = Math.hypot(cursor.x - v.x, cursor.y - v.y) <= p.r;
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath();
    g.arc(v.x + 0.08, v.y + 0.1, p.r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = held ? '#ffd23f' : inZ ? '#20c997' : levels[i] > p.zone[1] ? '#ff922b' : '#4dabf7';
    g.beginPath();
    g.arc(v.x, v.y, p.r, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = (under || held ? 5 : 3) * px;
    g.strokeStyle = '#111';
    g.stroke();
    const spin = held ? ms / 250 : 0;
    g.lineWidth = 4 * px;
    for (let k = 0; k < 4; k++) {
      const a = spin + (k * Math.PI) / 4;
      g.beginPath();
      g.moveTo(v.x + Math.cos(a) * p.r * 0.85, v.y + Math.sin(a) * p.r * 0.85);
      g.lineTo(v.x - Math.cos(a) * p.r * 0.85, v.y - Math.sin(a) * p.r * 0.85);
      g.stroke();
    }
    g.fillStyle = '#111';
    g.beginPath();
    g.arc(v.x, v.y, p.r * 0.22, 0, Math.PI * 2);
    g.fill();
    worldText(g, String(i + 1), v.x, v.y + p.r + 0.35, 0.3, { font: FONT_PIXEL, fill: '#fff', stroke: '#111', strokeW: 0.08, align: 'center', baseline: 'middle' });
    if (!inZ && detail) sticker(g, v.x, v.y - p.r - 0.35, levels[i] > p.zone[1] ? 'TOO HIGH' : 'LOW', 0.24, levels[i] > p.zone[1] ? '#ff922b' : '#4dabf7', '#111', px);
  }
  // The long hold: every gauge in the green for holdS seconds wins.
  if (allIn && prog.allInSince > 0) {
    const frac = clamp((ms - prog.allInSince) / (p.holdS * 1000), 0, 1);
    timeBar(g, WORLD_W / 2 - 2.4, 2.1, 4.8, 0.26, frac, '#43e05a', px);
    headline(g, `HOLD IT! ${Math.ceil(p.holdS - frac * p.holdS)}`, WORLD_W / 2, 2.6, 0.5, '#43e05a', px);
  } else if (detail) {
    headline(g, 'GET EVERY GAUGE INTO THE GREEN', WORLD_W / 2, 2.3, 0.42, '#ffffff', px);
  }
  if (detail) {
    const hearts = Math.max(0, p.blowCap - prog.blowouts);
    sticker(g, WORLD_W - 1.4, WORLD_H - 0.5, `${'♥'.repeat(hearts)}${'♡'.repeat(prog.blowouts)}`, 0.36, '#ffffff', '#ff3b3b', px);
  }
}

function drawStations(g: CanvasRenderingContext2D, p: StationsParams, prog: StationsProgress, px: number, ms: number, t: number, cursor: { x: number; y: number }, detail: boolean) {
  const n = p.stations.length;
  // Memory game: the numbers (and the "next" highlight) only show for the reveal window.
  const revealed = stationsRevealed(p, t);
  // Dotted route through the visited stations and on to the next one.
  g.save();
  g.setLineDash([0.18, 0.14]);
  g.lineDashOffset = -ms / 300;
  g.lineWidth = 4 * px;
  for (let i = 1; i <= Math.min(revealed ? prog.next : prog.next - 1, n - 1); i++) {
    const a = p.stations[i - 1];
    const b = p.stations[i];
    g.strokeStyle = i < prog.next ? 'rgba(105,219,124,0.8)' : 'rgba(112,72,232,0.6)';
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
  }
  g.restore();
  for (let i = 0; i < n; i++) {
    const s = p.stations[i];
    const next = revealed && i === prog.next;
    const done = i < prog.next;
    stationShape(g, s.x, s.y, p.r, revealed ? String(i + 1) : '?', '#7048e8', px, next, done);
    if (i === prog.next && prog.since > 0) {
      const frac = clamp((ms - prog.since) / (p.dwellS * 1000), 0, 1);
      dwellRing(g, s.x, s.y, p.r + 0.25, frac, '#ffd23f', px);
      sticker(g, s.x, s.y - p.r - 0.45, `STAY ${Math.ceil(p.dwellS - frac * p.dwellS)}`, 0.3, '#ffd23f', '#111', px);
    } else if (next) {
      g.save();
      g.setLineDash([0.12, 0.1]);
      g.lineDashOffset = -ms / 250;
      g.strokeStyle = '#7048e8';
      g.lineWidth = 4 * px;
      g.beginPath();
      g.arc(s.x, s.y, p.r + 0.25 + Math.sin(ms / 200) * 0.06, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
  }
  if (revealed) {
    const left = Math.ceil((p.revealMs - t * 1000) / 1000);
    headline(g, `MEMORIZE! NUMBERS HIDE IN ${left}`, WORLD_W / 2, 1.2, 0.6, '#ff5a36', px);
  } else if (detail) headline(g, `FIND STOP ${Math.min(prog.next + 1, n)} FROM MEMORY`, WORLD_W / 2, 1.2, 0.55, '#7048e8', px);
  // Arrow from the cursor to the next station when it is far away (only while the numbers show).
  const tgt = p.stations[prog.next];
  if (tgt && detail) {
    const d = Math.hypot(tgt.x - cursor.x, tgt.y - cursor.y);
    if (revealed && d > p.r + 1.2) {
      const a = Math.atan2(tgt.y - cursor.y, tgt.x - cursor.x);
      const ax = cursor.x + Math.cos(a) * 1.0;
      const ay = cursor.y + Math.sin(a) * 1.0;
      g.fillStyle = '#7048e8';
      g.strokeStyle = '#111';
      g.lineWidth = 3 * px;
      g.beginPath();
      g.moveTo(ax + Math.cos(a) * 0.3, ay + Math.sin(a) * 0.3);
      g.lineTo(ax + Math.cos(a + 2.5) * 0.25, ay + Math.sin(a + 2.5) * 0.25);
      g.lineTo(ax + Math.cos(a - 2.5) * 0.25, ay + Math.sin(a - 2.5) * 0.25);
      g.closePath();
      g.fill();
      g.stroke();
    }
    sticker(g, WORLD_W - 1.9, 0.6, `STOP ${Math.min(prog.next + 1, n)}/${n}`, 0.36, '#ffffff', '#111', px);
    if (p.skipCap) {
      const hot = prog.cancels >= p.skipCap - 1;
      sticker(g, 1.6, 0.6, `LEFT EARLY ${prog.cancels}/${p.skipCap}`, 0.28, hot ? '#ff3b3b' : '#ffffff', hot ? '#fff' : '#111', px);
    }
  }
}


// ---------------------------------------------------------------------------
// Echo
// ---------------------------------------------------------------------------

const ECHO_COLORS = ['#ff4d6d', '#4dabf7', '#ffd43b', '#69db7c', '#da77f2', '#ff922b', '#3bc9db', '#f783ac'];

function drawEcho(g: CanvasRenderingContext2D, p: EchoParams, prog: EchoProgress, px: number, ms: number, cursor: { x: number; y: number }, detail: boolean) {
  const lit = echoLit(p, prog, ms);
  p.pads.forEach((pad, i) => {
    const on = i === lit || (prog.phase === 'retrace' && i === prog.onPad && prog.since > 0);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath();
    g.arc(pad.x + 0.1, pad.y + 0.12, p.r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = on ? ECHO_COLORS[i % ECHO_COLORS.length] : '#2c2f3a';
    g.beginPath();
    g.arc(pad.x, pad.y, p.r, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 5 * px;
    g.strokeStyle = on ? '#fff' : ECHO_COLORS[i % ECHO_COLORS.length];
    g.stroke();
    if (on) {
      g.strokeStyle = 'rgba(255,255,255,0.5)';
      g.lineWidth = 3 * px;
      g.beginPath();
      g.arc(pad.x, pad.y, p.r + 0.25 + 0.08 * Math.sin(ms / 90), 0, Math.PI * 2);
      g.stroke();
    }
    if (prog.phase === 'retrace' && i === prog.onPad && prog.since > 0) {
      dwellRing(g, pad.x, pad.y, p.r + 0.3, clamp((ms - prog.since) / p.dwellMs, 0, 1), '#ffd23f', px);
    }
  });
  const show = prog.phase === 'show';
  headline(g, show ? (prog.showIdx === 0 ? 'WATCH…' : 'WATCH!') : 'YOUR TURN — REPEAT IT', WORLD_W / 2, 0.85, 0.7, show ? '#4dabf7' : '#ffd23f', px);
  if (detail) {
    sticker(g, WORLD_W - 2.0, 0.85, `ROUND ${prog.round}/${p.rounds} · ${prog.len} PADS`, 0.32, '#ffffff', '#111', px);
    const hot = prog.faults >= p.faultCap - 1;
    sticker(g, 1.7, 0.85, `FAULTS ${prog.faults}/${p.faultCap}`, 0.3, hot ? '#ff3b3b' : '#ffffff', hot ? '#fff' : '#111', px);
    if (!show) {
      // Progress pips for this round (never which pad).
      for (let i = 0; i < prog.len; i++) {
        g.fillStyle = i < prog.pos ? '#69db7c' : 'rgba(255,255,255,0.35)';
        g.fillRect(WORLD_W / 2 - prog.len * 0.22 + i * 0.44, 1.35, 0.32, 0.22);
      }
    }
  }
  void cursor;
}

// ---------------------------------------------------------------------------
// Crane
// ---------------------------------------------------------------------------

function drawCrane(g: CanvasRenderingContext2D, p: CraneParams, prog: CraneProgress, px: number, ms: number, t: number, cursor: { x: number; y: number }, detail: boolean) {
  const top = prog.blocks[prog.blocks.length - 1];
  const mx = craneMarkerX(p, t);
  // Ground + stack.
  g.fillStyle = '#3d3d3d';
  g.fillRect(0, p.baseY, WORLD_W, WORLD_H - p.baseY);
  prog.blocks.forEach((b, i) => {
    const y = p.baseY - (i + 1) * p.blockH;
    g.fillStyle = i === 0 ? '#6b6b6b' : ['#ff922b', '#ffd43b', '#4dabf7', '#69db7c', '#da77f2'][i % 5];
    g.fillRect(b.x - b.w / 2, y, b.w, p.blockH);
    g.lineWidth = 3 * px;
    g.strokeStyle = '#111';
    g.strokeRect(b.x - b.w / 2, y, b.w, p.blockH);
  });
  // Alignment zone above the stack.
  const zoneY = p.baseY - prog.blocks.length * p.blockH;
  g.fillStyle = Math.abs(mx - top.x) <= p.tol ? 'rgba(105,219,124,0.35)' : 'rgba(255,255,255,0.12)';
  g.fillRect(top.x - p.tol, p.swingY + p.blockH, 2 * p.tol, zoneY - p.swingY - p.blockH);
  // Cable + swinging block.
  g.strokeStyle = '#ddd';
  g.lineWidth = 3 * px;
  g.beginPath();
  g.moveTo(WORLD_W / 2, 0);
  g.lineTo(mx, p.swingY);
  g.stroke();
  g.fillStyle = prog.toppled ? '#ff3b3b' : '#ff922b';
  g.fillRect(mx - top.w / 2, p.swingY, top.w, p.blockH);
  g.strokeStyle = '#111';
  g.strokeRect(mx - top.w / 2, p.swingY, top.w, p.blockH);
  // Lever (the catch): dwell to release.
  const L = p.lever;
  const inL = inRect(L, cursor.x, cursor.y);
  g.fillStyle = inL ? '#ffd23f' : '#f3ead7';
  g.fillRect(L.x, L.y, L.w, L.h);
  g.lineWidth = 4 * px;
  g.strokeStyle = '#111';
  g.strokeRect(L.x, L.y, L.w, L.h);
  worldText(g, prog.since > 0 ? 'RELEASING…' : 'HOLD TO DROP', L.x + L.w / 2, L.y + L.h / 2 + 0.04, fitText(g, 'HOLD TO DROP', L.w - 0.3, 0.34), { fill: '#111', align: 'center', baseline: 'middle' });
  if (prog.since > 0) timeBar(g, L.x + 0.15, L.y + L.h - 0.3, L.w - 0.3, 0.18, clamp((ms - prog.since) / p.dwellMs, 0, 1), '#ff5a36', px);
  if (detail) {
    sticker(g, WORLD_W - 1.9, 0.6, `HEIGHT ${craneHeight(prog)}/${p.target}`, 0.34, '#ffffff', '#111', px);
    sticker(g, 1.5, 0.6, `MISSES ${prog.faults}`, 0.28, '#ffffff', '#111', px);
  }
}

// ---------------------------------------------------------------------------
// Spotlight
// ---------------------------------------------------------------------------

function drawSpotlight(g: CanvasRenderingContext2D, p: SpotlightParams, prog: SpotlightProgress, px: number, ms: number, t: number, cursor: { x: number; y: number }, detail: boolean) {
  const pos = spotPos(p, t);
  const hp = spotHp(prog, ms);
  const inside = Math.hypot(cursor.x - pos.x, cursor.y - pos.y) <= p.radius;
  // Path.
  g.save();
  g.setLineDash([0.2, 0.2]);
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.lineWidth = 3 * px;
  g.beginPath();
  p.path.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)));
  g.stroke();
  g.restore();
  // Decoy: a slightly off-white light that does not count.
  if (p.decoy) {
    const d = decoyPos(p, t);
    g.fillStyle = 'rgba(180,200,255,0.18)';
    g.beginPath();
    g.arc(d.x, d.y, p.radius, 0, Math.PI * 2);
    g.fill();
    if (detail) worldText(g, '?', d.x, d.y + 0.1, 0.5, { fill: 'rgba(255,255,255,0.5)', align: 'center', baseline: 'middle' });
  }
  // The light.
  const grad = g.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, p.radius * 1.3);
  grad.addColorStop(0, 'rgba(255,245,200,0.95)');
  grad.addColorStop(0.7, 'rgba(255,230,150,0.45)');
  grad.addColorStop(1, 'rgba(255,230,150,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(pos.x, pos.y, p.radius * 1.3, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = inside ? '#ffd23f' : '#ff3b3b';
  g.lineWidth = 4 * px;
  g.beginPath();
  g.arc(pos.x, pos.y, p.radius, 0, Math.PI * 2);
  g.stroke();
  // Health bar + headline.
  const frac = hp / p.hp;
  timeBar(g, WORLD_W / 2 - 3, 0.5, 6, 0.5, frac, frac < 0.3 ? '#ff3b3b' : '#69db7c', px);
  headline(g, inside ? 'STAY IN THE LIGHT' : 'GET BACK IN!', WORLD_W / 2, 1.3, 0.55, inside ? '#ffd23f' : '#ff3b3b', px);
  if (detail) {
    sticker(g, WORLD_W - 1.9, 0.75, `${Math.round((spotS(p, t) / p.length) * 100)}% WALKED`, 0.32, '#ffffff', '#111', px);
    sticker(g, 1.5, 0.75, `HEALTH ${hp.toFixed(1)}s`, 0.3, frac < 0.3 ? '#ff3b3b' : '#ffffff', frac < 0.3 ? '#fff' : '#111', px);
  }
}

// ---------------------------------------------------------------------------
// Sheep
// ---------------------------------------------------------------------------

function sheepShape(g: CanvasRenderingContext2D, x: number, y: number, vx: number, px: number, penned: boolean, ms: number) {
  const wob = Math.sin(ms / 140 + x) * 0.04;
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.beginPath();
  g.ellipse(x, y + 0.32, 0.42, 0.14, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = penned ? '#f3f0ff' : '#fff';
  g.beginPath();
  g.ellipse(x, y + wob, 0.42, 0.3, 0, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 3 * px;
  g.strokeStyle = '#111';
  g.stroke();
  const hx = x + (vx >= 0 ? 0.36 : -0.36);
  g.fillStyle = '#222';
  g.beginPath();
  g.arc(hx, y - 0.05 + wob, 0.17, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(hx + (vx >= 0 ? 0.05 : -0.05), y - 0.09 + wob, 0.045, 0, Math.PI * 2);
  g.fill();
}

function drawSheep(g: CanvasRenderingContext2D, p: SheepParams, prog: SheepProgress, px: number, ms: number, cursor: { x: number; y: number }, detail: boolean) {
  // Pen: fence on three sides, open on the left.
  const P = p.pen;
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(P.x, P.y, P.w, P.h);
  g.strokeStyle = '#8b5a2b';
  g.lineWidth = 8 * px;
  g.beginPath();
  g.moveTo(P.x, P.y);
  g.lineTo(P.x + P.w, P.y);
  g.lineTo(P.x + P.w, P.y + P.h);
  g.lineTo(P.x, P.y + P.h);
  g.stroke();
  g.strokeStyle = '#111';
  g.lineWidth = 2 * px;
  g.stroke();
  g.save();
  g.setLineDash([0.15, 0.15]);
  g.strokeStyle = 'rgba(255,255,255,0.5)';
  g.lineWidth = 3 * px;
  g.beginPath();
  g.moveTo(P.x, P.y);
  g.lineTo(P.x, P.y + P.h);
  g.stroke();
  g.restore();
  if (detail) worldText(g, 'PEN', P.x + P.w / 2, P.y - 0.3, 0.36, { fill: '#fff', stroke: '#111', strokeW: 0.1, align: 'center', baseline: 'middle' });
  // Push radius around the cursor.
  g.save();
  g.setLineDash([0.12, 0.12]);
  g.strokeStyle = 'rgba(255,255,255,0.4)';
  g.lineWidth = 3 * px;
  g.beginPath();
  g.arc(cursor.x, cursor.y, p.pushR, 0, Math.PI * 2);
  g.stroke();
  g.restore();
  const pos = sheepAt(prog, ms);
  prog.sheep.forEach((s, i) => sheepShape(g, pos[i].x, pos[i].y, s.vx, px, s.in, ms));
  const penned = prog.sheep.filter(s => s.in).length;
  if (prog.inSince > 0) {
    const frac = clamp((ms - prog.inSince) / (p.holdS * 1000), 0, 1);
    timeBar(g, WORLD_W / 2 - 3, 0.5, 6, 0.5, frac, '#69db7c', px);
    headline(g, `ALL IN — HOLD ${Math.ceil(p.holdS - frac * p.holdS)}`, WORLD_W / 2, 1.3, 0.6, '#69db7c', px);
  } else headline(g, `${penned}/${p.n} PENNED`, WORLD_W / 2, 0.9, 0.7, '#ffd23f', px);
  if (detail) {
    const hot = prog.escapes >= p.escapeCap - 1;
    sticker(g, 1.6, 0.75, `ESCAPES ${prog.escapes}/${p.escapeCap}`, 0.3, hot ? '#ff3b3b' : '#ffffff', hot ? '#fff' : '#111', px);
  }
}

// ---------------------------------------------------------------------------
// Ice
// ---------------------------------------------------------------------------

function drawIce(g: CanvasRenderingContext2D, p: IceParams, prog: IceProgress, px: number, ms: number, cursor: { x: number; y: number }, detail: boolean) {
  p.gates.forEach((gt, i) => {
    const next = i === prog.next;
    const done = i < prog.next;
    g.fillStyle = done ? 'rgba(105,219,124,0.5)' : next ? 'rgba(255,210,63,0.35)' : 'rgba(255,255,255,0.15)';
    g.beginPath();
    g.arc(gt.x, gt.y, p.r, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = (next ? 5 : 3) * px;
    g.strokeStyle = done ? '#69db7c' : next ? '#ffd23f' : 'rgba(255,255,255,0.6)';
    g.stroke();
    worldText(g, done ? '✓' : String(i + 1), gt.x, gt.y + 0.05, p.r * 0.9, { font: FONT_PIXEL, fill: '#fff', stroke: '#111', strokeW: 0.08, align: 'center', baseline: 'middle' });
    if (next && prog.since > 0) {
      const frac = clamp((ms - prog.since) / p.restMs, 0, 1);
      dwellRing(g, gt.x, gt.y, p.r + 0.3, frac, '#ffd23f', px);
      sticker(g, gt.x, gt.y - p.r - 0.45, 'STOPPING…', 0.3, '#ffd23f', '#111', px);
    } else if (next && prog.inGate) sticker(g, gt.x, gt.y - p.r - 0.45, 'TOO FAST!', 0.3, '#ff3b3b', '#fff', px);
  });
  if (detail) {
    sticker(g, WORLD_W - 1.9, 0.6, `GATE ${Math.min(prog.next + 1, p.gates.length)}/${p.gates.length}`, 0.34, '#ffffff', '#111', px);
    const hot = prog.faults >= p.faultCap - 1;
    sticker(g, 1.6, 0.6, `SLIPS ${prog.faults}/${p.faultCap}`, 0.3, hot ? '#ff3b3b' : '#ffffff', hot ? '#fff' : '#111', px);
    worldText(g, 'STOP DEAD INSIDE EACH GATE — IT IS SLIPPERY', WORLD_W / 2, 1.3, 0.3, { fill: 'rgba(255,255,255,0.7)', stroke: '#111', strokeW: 0.08, align: 'center', baseline: 'middle' });
  }
  void cursor;
}

// ---------------------------------------------------------------------------
// Plank
// ---------------------------------------------------------------------------

function drawPlank(g: CanvasRenderingContext2D, p: PlankParams, prog: PlankProgress, px: number, ms: number, cursor: { x: number; y: number }, detail: boolean) {
  const fill = plankFill(p, prog, ms);
  p.tiles.forEach((t, i) => {
    const done = i < prog.next;
    const next = i === prog.next;
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(t.x + 0.08, t.y + 0.1, t.w, t.h);
    g.fillStyle = done ? '#b07a3a' : 'rgba(255,255,255,0.12)';
    g.fillRect(t.x, t.y, t.w, t.h);
    if (next && fill > 0) {
      g.fillStyle = '#d9a35c';
      g.fillRect(t.x, t.y, t.w * fill, t.h);
    }
    g.lineWidth = (next ? 4 : 2) * px;
    g.strokeStyle = next ? '#ffd23f' : done ? '#5a3a16' : 'rgba(255,255,255,0.4)';
    g.strokeRect(t.x, t.y, t.w, t.h);
    if (done) {
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      g.lineWidth = 2 * px;
      g.beginPath();
      g.moveTo(t.x + t.w * 0.5, t.y);
      g.lineTo(t.x + t.w * 0.5, t.y + t.h);
      g.stroke();
    }
  });
  const t = p.tiles[prog.next];
  if (t) {
    const still = prog.since > 0;
    sticker(g, t.x + t.w / 2, t.y - 0.4, still ? `HOLD STILL ${Math.ceil((p.fillMs * (1 - fill)) / 1000)}` : 'HOLD STILL HERE', 0.3, still ? '#ffd23f' : '#ffffff', '#111', px);
  }
  if (detail) {
    sticker(g, WORLD_W - 1.9, 0.6, `PLANK ${Math.min(prog.next + 1, p.tiles.length)}/${p.tiles.length}`, 0.34, '#ffffff', '#111', px);
    if (prog.wipes) sticker(g, 1.4, 0.6, `WIPED ×${prog.wipes}`, 0.28, '#ffffff', '#111', px);
    if (p.shove) worldText(g, '⬇ THE WIND PUSHES DOWN — LEAN AGAINST IT', WORLD_W / 2, 1.3, 0.3, { fill: 'rgba(255,255,255,0.75)', stroke: '#111', strokeW: 0.08, align: 'center', baseline: 'middle' });
  }
  void cursor;
}

// ---------------------------------------------------------------------------
// Seesaw
// ---------------------------------------------------------------------------

function drawSeesaw(g: CanvasRenderingContext2D, p: SeesawParams, prog: SeesawProgress, px: number, ms: number, cursor: { x: number; y: number }, detail: boolean) {
  const a = prog.angle;
  // Pivot.
  g.fillStyle = '#555';
  g.beginPath();
  g.moveTo(p.pivot.x - 0.6, WORLD_H);
  g.lineTo(p.pivot.x + 0.6, WORLD_H);
  g.lineTo(p.pivot.x, p.pivot.y);
  g.closePath();
  g.fill();
  g.lineWidth = 3 * px;
  g.strokeStyle = '#111';
  g.stroke();
  // Board.
  const L = seesawPoint(p, a, -p.halfLen);
  const R = seesawPoint(p, a, p.halfLen);
  g.strokeStyle = '#8b5a2b';
  g.lineWidth = 10 * px;
  g.beginPath();
  g.moveTo(L.x, L.y);
  g.lineTo(R.x, R.y);
  g.stroke();
  g.strokeStyle = '#111';
  g.lineWidth = 2 * px;
  g.stroke();
  // Pockets + balls.
  prog.balls.forEach((b, i) => {
    const pk = seesawPoint(p, a, b.pocket, 0.05);
    g.fillStyle = 'rgba(255,210,63,0.5)';
    g.beginPath();
    g.ellipse(pk.x, pk.y, p.pocketW / 2, 0.14, a, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#ffd23f';
    g.lineWidth = 3 * px;
    g.stroke();
    const ball = seesawPoint(p, a, b.s, SEESAW_BALL_R + 0.05);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath();
    g.ellipse(ball.x, ball.y + SEESAW_BALL_R + 0.1, SEESAW_BALL_R, 0.1, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = ['#ff4d6d', '#4dabf7', '#69db7c'][i % 3];
    g.beginPath();
    g.arc(ball.x, ball.y, SEESAW_BALL_R, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 3 * px;
    g.strokeStyle = '#111';
    g.stroke();
  });
  headline(g, cursor.x < p.pivot.x - 0.5 ? '◀ TILT LEFT' : cursor.x > p.pivot.x + 0.5 ? 'TILT RIGHT ▶' : 'LEVEL', WORLD_W / 2, 0.9, 0.6, '#ffd23f', px);
  if (detail) {
    sticker(g, WORLD_W - 1.9, 0.6, `POCKETS ${prog.pockets}/${p.target}`, 0.34, '#ffffff', '#111', px);
    const hot = prog.faults >= p.faultCap - 1;
    sticker(g, 1.6, 0.6, `OFF THE END ${prog.faults}/${p.faultCap}`, 0.28, hot ? '#ff3b3b' : '#ffffff', hot ? '#fff' : '#111', px);
    worldText(g, 'CURSOR LEFT/RIGHT TILTS THE BOARD · ROLL THE BALL INTO THE POCKET SLOWLY', WORLD_W / 2, 1.45, 0.28, { fill: 'rgba(255,255,255,0.7)', stroke: '#111', strokeW: 0.08, align: 'center', baseline: 'middle' });
  }
  void ms;
}

// ---------------------------------------------------------------------------
// Belts
// ---------------------------------------------------------------------------

function drawBelts(g: CanvasRenderingContext2D, p: BeltsParams, prog: BeltsProgress, px: number, ms: number, t: number, cursor: { x: number; y: number }, detail: boolean) {
  const rev = beltsReversed(p, t);
  for (let r = 0; r < p.rows; r++)
    for (let c = 0; c < p.cols; c++) {
      const ch = p.tiles[r * p.cols + c];
      if (ch === '.') continue;
      const x = c;
      const y = r;
      if ('^v<>'.includes(ch)) {
        g.fillStyle = '#4a4e69';
        g.fillRect(x, y, 1, 1);
        // Moving chevrons.
        const dir = beltDir(p, x + 0.5, y + 0.5, t)!;
        const ph = ((ms / 400) % 1) * 1;
        g.strokeStyle = 'rgba(255,255,255,0.7)';
        g.lineWidth = 3 * px;
        for (let k = 0; k < 2; k++) {
          const f = (ph + k * 0.5) % 1;
          const cx = x + 0.5 + dir.x * (f - 0.5) * 0.8;
          const cy = y + 0.5 + dir.y * (f - 0.5) * 0.8;
          g.beginPath();
          g.moveTo(cx - dir.x * 0.15 - dir.y * 0.25, cy - dir.y * 0.15 - dir.x * 0.25);
          g.lineTo(cx + dir.x * 0.1, cy + dir.y * 0.1);
          g.lineTo(cx - dir.x * 0.15 + dir.y * 0.25, cy - dir.y * 0.15 + dir.x * 0.25);
          g.stroke();
        }
      } else if (ch === 'X') {
        g.fillStyle = Math.floor(ms / 300) % 2 ? '#ff3b3b' : '#c92a2a';
        g.fillRect(x, y, 1, 1);
        g.strokeStyle = '#111';
        g.lineWidth = 3 * px;
        g.beginPath();
        g.moveTo(x + 0.25, y + 0.25);
        g.lineTo(x + 0.75, y + 0.75);
        g.moveTo(x + 0.75, y + 0.25);
        g.lineTo(x + 0.25, y + 0.75);
        g.stroke();
      } else if (ch === 'C') {
        const active = prog.checkpoint.x === x + 0.5 && prog.checkpoint.y === y + 0.5;
        g.fillStyle = active ? '#69db7c' : 'rgba(105,219,124,0.35)';
        g.fillRect(x, y, 1, 1);
        worldText(g, '⚑', x + 0.5, y + 0.55, 0.6, { fill: '#111', align: 'center', baseline: 'middle' });
      } else if (ch === 'E') {
        g.fillStyle = Math.floor(ms / 250) % 2 ? '#ffd23f' : '#ffe680';
        g.fillRect(x, y, 1, 1);
        if (r === Math.floor(p.rows / 2)) worldText(g, 'EXIT', x + 0.5, y + 0.55, 0.36, { fill: '#111', align: 'center', baseline: 'middle' });
      } else if (ch === 'S') {
        g.fillStyle = 'rgba(255,255,255,0.3)';
        g.fillRect(x, y, 1, 1);
      }
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.lineWidth = 1.5 * px;
      g.strokeRect(x, y, 1, 1);
    }
  if (detail) {
    const hot = prog.faults >= p.faultCap - 1;
    sticker(g, 1.6, 0.6, `ZAPPED ${prog.faults}/${p.faultCap}`, 0.3, hot ? '#ff3b3b' : '#ffffff', hot ? '#fff' : '#111', px);
    if (p.reverseS > 0) {
      const left = p.reverseS - (Math.max(0, t) % p.reverseS);
      sticker(g, WORLD_W - 2.2, 0.6, `${rev ? 'REVERSED' : 'FORWARD'} · FLIP IN ${Math.ceil(left)}`, 0.28, rev ? '#ff922b' : '#ffffff', '#111', px);
    }
  }
  void cursor;
}

// ---------------------------------------------------------------------------
// Needle
// ---------------------------------------------------------------------------

function drawNeedle(g: CanvasRenderingContext2D, p: NeedleParams, prog: NeedleProgress, px: number, ms: number, t: number, cursor: { x: number; y: number }, detail: boolean) {
  p.walls.forEach((w, i) => {
    const gy = needleGapY(p, i, t);
    const passed = i < prog.next;
    const next = i === prog.next;
    g.fillStyle = passed ? 'rgba(255,255,255,0.15)' : next ? '#ff5a36' : '#8d99ae';
    g.fillRect(w.x - p.thick / 2, NEEDLE_TOP, p.thick, gy - p.gapH / 2 - NEEDLE_TOP);
    g.fillRect(w.x - p.thick / 2, gy + p.gapH / 2, p.thick, WORLD_H - gy - p.gapH / 2);
    if (!passed) {
      g.lineWidth = 2 * px;
      g.strokeStyle = '#111';
      g.strokeRect(w.x - p.thick / 2, NEEDLE_TOP, p.thick, gy - p.gapH / 2 - NEEDLE_TOP);
      g.strokeRect(w.x - p.thick / 2, gy + p.gapH / 2, p.thick, WORLD_H - gy - p.gapH / 2);
    }
    if (next) {
      // Gap markers.
      g.fillStyle = '#ffd23f';
      g.beginPath();
      g.moveTo(w.x - 0.35, gy - p.gapH / 2 - 0.3);
      g.lineTo(w.x + 0.35, gy - p.gapH / 2 - 0.3);
      g.lineTo(w.x, gy - p.gapH / 2 + 0.05);
      g.closePath();
      g.fill();
      g.beginPath();
      g.moveTo(w.x - 0.35, gy + p.gapH / 2 + 0.3);
      g.lineTo(w.x + 0.35, gy + p.gapH / 2 + 0.3);
      g.lineTo(w.x, gy + p.gapH / 2 - 0.05);
      g.closePath();
      g.fill();
    }
  });
  if (ms < prog.frozenUntil) headline(g, 'OUCH! BACK UP', WORLD_W / 2, 0.9, 0.7, '#ff3b3b', px);
  else headline(g, 'THREAD THE GAP ▶', WORLD_W / 2, 0.9, 0.6, '#ffd23f', px);
  if (detail) {
    sticker(g, WORLD_W - 1.9, 0.6, `WALL ${Math.min(prog.next + 1, p.walls.length)}/${p.walls.length}`, 0.34, '#ffffff', '#111', px);
    const hot = prog.faults >= p.faultCap - 1;
    sticker(g, 1.6, 0.6, `HITS ${prog.faults}/${p.faultCap}`, 0.3, hot ? '#ff3b3b' : '#ffffff', hot ? '#fff' : '#111', px);
  }
  void cursor;
}

// ---------------------------------------------------------------------------
// Wires
// ---------------------------------------------------------------------------

function drawWires(g: CanvasRenderingContext2D, p: WiresParams, prog: WiresProgress, px: number, ms: number, cursor: { x: number; y: number }, detail: boolean) {
  // Connected wire so far.
  if (prog.done.length > 1) {
    g.lineWidth = 8 * px;
    g.strokeStyle = '#111';
    g.beginPath();
    prog.done.forEach((ni, i) => (i ? g.lineTo(p.nodes[ni].x, p.nodes[ni].y) : g.moveTo(p.nodes[ni].x, p.nodes[ni].y)));
    g.stroke();
    g.lineWidth = 4 * px;
    g.strokeStyle = '#ffd23f';
    g.stroke();
  }
  p.nodes.forEach((n, i) => {
    const done = prog.done.includes(i);
    const col = WIRE_COLORS[n.color] ?? '#fff';
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath();
    g.arc(n.x + 0.08, n.y + 0.1, p.r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = done ? '#444' : col;
    g.beginPath();
    g.arc(n.x, n.y, p.r, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 4 * px;
    g.strokeStyle = '#111';
    g.stroke();
    if (done) worldText(g, '✓', n.x, n.y + 0.05, p.r, { font: FONT_PIXEL, fill: col, align: 'center', baseline: 'middle' });
    if (i === prog.onNode && prog.since > 0) dwellRing(g, n.x, n.y, p.r + 0.3, clamp((ms - prog.since) / p.dwellMs, 0, 1), '#ffd23f', px);
  });
  // Only the next color is ever shown.
  const nc = prog.nextColor;
  if (nc >= 0) {
    const col = WIRE_COLORS[nc];
    g.fillStyle = col;
    g.fillRect(WORLD_W / 2 - 0.55, 0.35, 1.1, 1.1);
    g.lineWidth = 4 * px;
    g.strokeStyle = '#111';
    g.strokeRect(WORLD_W / 2 - 0.55, 0.35, 1.1, 1.1);
    headline(g, `CONNECT ${WIRE_NAMES[nc]}`, WORLD_W / 2 + 3.6, 0.9, 0.6, col, px);
  } else headline(g, 'ALL WIRED!', WORLD_W / 2, 0.9, 0.7, '#69db7c', px);
  if (detail) {
    sticker(g, WORLD_W - 1.9, 0.6, `WIRE ${Math.min(prog.pos + 1, p.total)}/${p.total}`, 0.34, '#ffffff', '#111', px);
    const hot = prog.strikes >= p.strikeCap - 1;
    sticker(g, 1.6, 0.6, `STRIKES ${prog.strikes}/${p.strikeCap}`, 0.3, hot ? '#ff3b3b' : '#ffffff', hot ? '#fff' : '#111', px);
  }
  void cursor;
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
