import type { DbConnection } from '../module_bindings';
import { cursorPhysics, WORLD_H, WORLD_W, type MinesProgress } from '../../spacetimedb/src/sim';
import { drawCursorSprite, drawField, drawFuse, drawLevel, fieldColor, nameTag, parseLevel, worldText, type LevelView } from '../game/draw';
import { blit } from '../game/sprites';
import { serverNowMs } from '../lib/clock';
import { createCursorSmoother, cursorHoldUntilMs } from '../lib/cursorSmoother';
import { sfx } from './audio';

// Canvas renderer for the projector view. Runs in requestAnimationFrame and
// reads the SpacetimeDB client cache directly; React never re-renders per frame.

export type RenderStats = {
  /** Observed pointer row writes per second (≈ set_pointer calls that landed). */
  pointerPerSec: number;
  votesPerSec: number;
  ticksPerSec: number;
  fps: number;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  life: number;
  max: number;
  color: string;
  size: number;
  kind: 'confetti' | 'ring' | 'text' | 'star';
  text?: string;
};

type Ghost = { x: number; y: number; seen: number };

const CONFETTI = ['#ff5a36', '#ffd23f', '#2ec4b6', '#3a86ff', '#ff4fa3', '#ffffff'];

export function startRenderer(
  canvas: HTMLCanvasElement,
  conn: DbConnection,
  opts: { showLines: () => boolean; heatmap: () => [number, number][] | null }
) {
  const g = canvas.getContext('2d')!;
  const stats: RenderStats = { pointerPerSec: 0, votesPerSec: 0, ticksPerSec: 0, fps: 0 };
  const counters = { pointer: 0, votes: 0, ticks: 0, frames: 0 };
  const ghosts = new Map<string, Ghost>();
  const particles: Particle[] = [];
  let shake = 0;
  let flash = 0;
  let flashColor = '255,59,59';
  // Predicted render position of the shared cursor.
  const smoother = createCursorSmoother();
  let rc = { x: WORLD_W / 2, y: WORLD_H / 2 };

  const playerOf = (hex: string) => {
    for (const p of conn.db.player.iter()) if (p.identity.toHexString() === hex) return p;
    return undefined;
  };

  const onPointer = (_c: unknown, row: { identity: { toHexString(): string } }) => {
    counters.pointer++;
    const gh = ghosts.get(row.identity.toHexString());
    if (gh) gh.seen = performance.now();
  };
  const onPointerUpdate = (c: unknown, _o: unknown, n: { identity: { toHexString(): string } }) => onPointer(c, n);
  const onCursor = (_c: unknown, _o: unknown, row: Parameters<typeof smoother.push>[0]) => {
    counters.ticks++;
    smoother.push(row);
  };
  const onFx = (_c: unknown, row: { kind: string; x: number; y: number; who: string }) => {
    sfx(row.kind);
    const add = (p: Partial<Particle> & Pick<Particle, 'kind' | 'life'>) =>
      particles.push({ x: row.x, y: row.y, vx: 0, vy: 0, rot: 0, vr: 0, max: p.life, color: '#fff', size: 0.5, ...p });
    switch (row.kind) {
      case 'vote':
        counters.votes++;
        add({ kind: 'ring', life: 0.5, color: playerOf(row.who)?.color ?? '#fff', size: 0.7 });
        break;
      case 'click':
        add({ kind: 'ring', life: 0.7, color: '#111', size: 1.8 });
        add({ kind: 'text', life: 0.9, text: 'CLICK!', color: '#ffd23f', size: 0.55, vy: -1.2 });
        break;
      case 'autoclick':
        shake = 0.5;
        add({ kind: 'ring', life: 0.9, color: '#ff3b3b', size: 2.4 });
        add({ kind: 'text', life: 1.3, text: 'AUTO-CLICK!', color: '#ff3b3b', size: 0.7, vy: -1 });
        break;
      case 'target':
        burst(row.x, row.y, 36);
        for (let i = 0; i < 5; i++)
          add({ kind: 'star', life: 1, vx: Math.cos(i * 1.26) * 3, vy: Math.sin(i * 1.26) * 3 - 2, size: 0.04 });
        add({ kind: 'text', life: 1, text: 'NICE!', color: '#2ec4b6', size: 0.6, vy: -1.4 });
        break;
      case 'reveal':
        burst(row.x, row.y, 10);
        break;
      case 'wall':
        shake = 0.7;
        flash = 0.6;
        flashColor = '255,138,61';
        add({ kind: 'text', life: 1.2, text: 'BONK!', color: '#ff8a3d', size: 0.8, vy: -1 });
        break;
      case 'mine':
        shake = 1.2;
        flash = 0.9;
        flashColor = '255,59,59';
        for (let i = 0; i < 3; i++) burst(row.x, row.y, 30);
        add({ kind: 'text', life: 1.4, text: 'KABOOM!', color: '#ff3b3b', size: 0.9, vy: -0.8 });
        break;
      case 'win':
        for (let i = 0; i < 10; i++) burst(Math.random() * WORLD_W, -0.5, 30, 1);
        break;
      case 'lose':
        shake = 1;
        flash = 1;
        flashColor = '40,40,40';
        break;
      case 'voted':
        sfx('win');
        for (let i = 0; i < 8; i++) burst(Math.random() * WORLD_W, -0.5, 30, 1);
        add({ kind: 'text', life: 2.2, text: `${(row.who || 'GAME').toUpperCase()} WINS!`, color: '#ffd23f', size: 0.9, vy: -0.3, x: WORLD_W / 2, y: WORLD_H / 2 });
        break;
      case 'vote_restart':
        shake = 0.4;
        add({ kind: 'text', life: 1.6, text: 'NOBODY PICKED! AGAIN!', color: '#ff5a36', size: 0.7, vy: -0.3, x: WORLD_W / 2, y: WORLD_H / 2 });
        break;
      case 'dictator':
        add({ kind: 'text', life: 2, text: 'DICTATOR!', color: '#ffd23f', size: 0.5, vy: -0.4, y: row.y - 0.6 });
        break;
      // Red light, green light.
      case 'light':
        if (row.who === 'red') {
          flash = 0.5;
          flashColor = '255,59,59';
          add({ kind: 'text', life: 1.1, text: 'RED LIGHT!', color: '#ff3b3b', size: 0.9, vy: -0.3, x: WORLD_W / 2, y: WORLD_H / 2 });
        } else add({ kind: 'text', life: 1, text: 'GREEN LIGHT!', color: '#43e05a', size: 0.9, vy: -0.3, x: WORLD_W / 2, y: WORLD_H / 2 });
        break;
      case 'fault':
        shake = 0.8;
        flash = 0.6;
        flashColor = '255,59,59';
        add({ kind: 'text', life: 1.3, text: 'YOU MOVED!', color: '#ff3b3b', size: 0.8, vy: -0.8 });
        break;
      // Balloon.
      case 'save':
        burst(row.x, row.y, 8);
        add({ kind: 'text', life: 0.7, text: 'BOP!', color: '#ffffff', size: 0.5, vy: -1.5 });
        break;
      case 'drop':
        shake = 0.8;
        flash = 0.6;
        flashColor = '255,59,59';
        for (let i = 0; i < 2; i++) burst(row.x, row.y, 20);
        add({ kind: 'text', life: 1.3, text: 'POP!', color: '#ff3b3b', size: 0.9, vy: -0.8 });
        break;
      // Mole.
      case 'mole_hit':
        burst(row.x, row.y, 24);
        for (let i = 0; i < 4; i++) add({ kind: 'star', life: 0.9, vx: Math.cos(i * 1.57) * 3, vy: Math.sin(i * 1.57) * 3 - 2, size: 0.04 });
        add({ kind: 'text', life: 1, text: 'WHACK!', color: '#ffd23f', size: 0.7, vy: -1.2 });
        break;
      case 'mole_miss':
        shake = 0.3;
        add({ kind: 'text', life: 1, text: 'MISSED!', color: '#ff5a36', size: 0.6, vy: -0.8 });
        break;
      // Potato.
      case 'splash':
        for (let i = 0; i < 3; i++) burst(row.x, row.y, 24);
        add({ kind: 'text', life: 1.4, text: 'SPLASH!', color: '#3a86ff', size: 0.9, vy: -0.8 });
        break;
      case 'boom':
        shake = 1.4;
        flash = 1;
        flashColor = '255,138,61';
        for (let i = 0; i < 4; i++) burst(row.x, row.y, 30);
        add({ kind: 'text', life: 1.5, text: 'KABOOM!', color: '#ff3b3b', size: 1, vy: -0.6 });
        break;
      // Chairs.
      case 'sit':
        burst(row.x, row.y, 20);
        add({ kind: 'text', life: 1.2, text: 'SAFE!', color: '#43e05a', size: 0.8, vy: -0.8 });
        break;
      case 'no_chair':
        shake = 1;
        flash = 0.8;
        flashColor = '255,59,59';
        add({ kind: 'text', life: 1.5, text: 'NO CHAIR!', color: '#ff3b3b', size: 0.9, vy: -0.6 });
        break;
      // Keyboard.
      case 'key':
        burst(row.x, row.y, 14);
        add({ kind: 'text', life: 1, text: row.who || 'OK', color: '#2ec4b6', size: 0.9, vy: -1.4 });
        break;
      case 'buzz':
        shake = 0.5;
        flash = 0.4;
        flashColor = '255,59,59';
        add({ kind: 'text', life: 0.9, text: 'BZZT!', color: '#ff3b3b', size: 0.7, vy: -0.8 });
        break;
    }
  };

  function burst(x: number, y: number, n: number, down = 0) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1.5 + Math.random() * 5;
      particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: down ? Math.random() * 2 : Math.sin(a) * s - 3,
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 12,
        life: 1.6 + Math.random(),
        max: 2.6,
        color: CONFETTI[i % CONFETTI.length],
        size: 0.1 + Math.random() * 0.12,
        kind: 'confetti',
      });
    }
  }

  conn.db.pointer.onInsert(onPointer);
  conn.db.pointer.onUpdate(onPointerUpdate);
  conn.db.cursor.onUpdate(onCursor);
  conn.db.fx.onInsert(onFx);

  let lvlCache: { id: bigint; params: string; progress: string; view: LevelView } | null = null;
  const currentLevel = () => {
    let best = null as ReturnType<typeof conn.db.level.id.find>;
    for (const l of conn.db.level.iter()) if (!best || l.id > best.id) best = l;
    if (!best) return null;
    if (!lvlCache || lvlCache.id !== best.id || lvlCache.params !== best.params || lvlCache.progress !== best.progress) {
      lvlCache = { id: best.id, params: best.params, progress: best.progress, view: parseLevel(best)! };
    }
    return { row: best, view: lvlCache.view };
  };

  let raf = 0;
  let last = performance.now();
  let statT = last;

  function frame(t: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    counters.frames++;
    if (t - statT >= 1000) {
      const s = (t - statT) / 1000;
      stats.pointerPerSec = counters.pointer / s;
      stats.votesPerSec = counters.votes / s;
      stats.ticksPerSec = counters.ticks / s;
      stats.fps = counters.frames / s;
      counters.pointer = counters.votes = counters.ticks = counters.frames = 0;
      statT = t;
    }
    const serverMs = serverNowMs();

    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    }
    const lvl = currentLevel();
    const running = lvl && lvl.row.state === 'running' ? lvl : null;
    // Keep the finished board on screen under the results dialog (see the explosion!).
    const endedMs = lvl?.row.endedAt ? Number(lvl.row.endedAt.microsSinceUnixEpoch / 1000n) : 0;
    const shown = running ?? (lvl && lvl.row.state !== 'skipped' && serverNowMs() - endedMs < 25000 ? lvl : null);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = fieldColor(shown ? shown.row.kind : 'lobby');
    g.fillRect(0, 0, canvas.width, canvas.height);

    // Fit the 16:9 world exactly into the window body, plus screen shake.
    const scale = Math.min(canvas.width / WORLD_W, canvas.height / WORLD_H);
    const sh = shake * 0.25 * scale;
    const ox = (canvas.width - WORLD_W * scale) / 2 + (Math.random() - 0.5) * sh;
    const oy = (canvas.height - WORLD_H * scale) / 2 + (Math.random() - 0.5) * sh;
    shake = Math.max(0, shake - dt * 2.2);
    g.setTransform(scale, 0, 0, scale, ox, oy);
    const px = 1 / scale * dpr;

    drawField(g, shown ? shown.row.kind : 'lobby', px);

    const heat = opts.heatmap();
    if (heat) {
      g.fillStyle = 'rgba(255, 79, 163, 0.12)';
      for (const [x, y] of heat) {
        g.beginPath();
        g.arc(x, y, 0.45, 0, Math.PI * 2);
        g.fill();
      }
    }

    // Cursor prediction: run the server's spring forward from the last tick.
    const cur = conn.db.cursor.id.find(0);
    const cfg = conn.db.config.id.find(0);
    if (cur && cfg) {
      const phys = { ...cursorPhysics(running?.row.kind, cfg), tickHz: cfg.tickHz };
      rc = smoother.step(dt, phys, running ? cursorHoldUntilMs(running.view) : 0);
    }

    // Debug hook (read by scripts/e2e checks): what we draw vs what the server says.
    (window as unknown as { __mob?: unknown }).__mob = { rc: { ...rc }, cur: cur ? { x: cur.x, y: cur.y, tick: Number(cur.tick) } : null, serverMs };

    if (shown) drawLevel(g, shown.view, px, serverMs, rc);

    // Ghost cursors: everyone's pull, with a faint tug line to the shared cursor.
    const nowMs = performance.now();
    const fresh = new Set<string>();
    const dictator = cur?.dictator ?? '';
    const lines = opts.showLines();
    for (const p of conn.db.pointer.iter()) {
      const id = p.identity.toHexString();
      const wx = p.x * WORLD_W;
      const wy = p.y * WORLD_H;
      let gh = ghosts.get(id);
      if (!gh) {
        gh = { x: wx, y: wy, seen: nowMs };
        ghosts.set(id, gh);
      }
      // Pointers now arrive at up to 15 Hz, so ghosts can follow faster.
      const k = 1 - Math.exp(-dt * 20);
      gh.x += (wx - gh.x) * k;
      gh.y += (wy - gh.y) * k;
      fresh.add(id);
      // Hide ghosts that stopped updating (sleeping phone, closed tab without a clean disconnect).
      const stale = serverMs - Number(p.updatedAt.microsSinceUnixEpoch / 1000n) > 2500;
      if (stale) continue;
      const pl = conn.db.player.identity.find(p.identity);
      const color = pl?.color ?? '#999';
      if (lines && !stale) {
        g.strokeStyle = color;
        g.globalAlpha = 0.35;
        g.lineWidth = 2 * px;
        g.setLineDash([0.12, 0.1]);
        g.beginPath();
        g.moveTo(rc.x, rc.y);
        g.lineTo(gh.x, gh.y);
        g.stroke();
        g.setLineDash([]);
        g.globalAlpha = 1;
      }
      g.globalAlpha = stale ? 0.25 : 0.95;
      drawCursorSprite(g, gh.x, gh.y, 0.55, color, !stale);
      if (dictator === id) blit(g, 'crown', gh.x - 0.05, gh.y - 0.45, 0.04, { shadow: 0.03 });
      if (pl) nameTag(g, gh.x + 0.32, gh.y + 0.42, pl.name, color, 0.3);
      g.globalAlpha = 1;
    }
    for (const id of ghosts.keys()) if (!fresh.has(id)) ghosts.delete(id);

    // Crowd aggregate target marker.
    if (cur && cur.active > 0) {
      g.strokeStyle = '#111';
      g.lineWidth = 3 * px;
      g.beginPath();
      g.arc(cur.tx, cur.ty, 0.16, 0, Math.PI * 2);
      g.moveTo(cur.tx - 0.32, cur.ty);
      g.lineTo(cur.tx + 0.32, cur.ty);
      g.moveTo(cur.tx, cur.ty - 0.32);
      g.lineTo(cur.tx, cur.ty + 0.32);
      g.stroke();
    }

    // The one true cursor: big, white, jittery when the mob is fighting.
    const jitter = (cur?.chaos ?? 0) > 0.6 ? (cur!.chaos - 0.6) * 0.15 : 0;
    drawCursorSprite(g, rc.x + (Math.random() - 0.5) * jitter, rc.y + (Math.random() - 0.5) * jitter, 1.1, '#ffffff');

    // Minesweeper auto-click fuse (last 5 s).
    if (running && running.row.kind === 'minesweeper') {
      const next = (running.view.progress as MinesProgress).nextAutoAt;
      if (next !== undefined) {
        const left = (next - serverMs) / 1000;
        if (left > 0 && left <= 5 && serverMs >= running.view.playAt) drawFuse(g, rc.x, rc.y, left, px);
      }
    }

    // Particles.
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      const a = Math.min(1, p.life / (p.max * 0.4));
      g.globalAlpha = a;
      if (p.kind === 'confetti' || p.kind === 'star') {
        p.vy += 7 * dt;
        p.vx *= 1 - dt * 0.8;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        if (p.kind === 'star') blit(g, 'star', p.x, p.y, p.size, { center: true });
        else {
          g.save();
          g.translate(p.x, p.y);
          g.rotate(p.rot);
          g.fillStyle = p.color;
          g.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          g.restore();
        }
      } else if (p.kind === 'ring') {
        g.strokeStyle = p.color;
        g.lineWidth = 4 * px;
        g.beginPath();
        g.arc(p.x, p.y, p.size * (1 - p.life / p.max) + 0.1, 0, Math.PI * 2);
        g.stroke();
      } else {
        p.y += p.vy * dt;
        const pop = 1 + Math.max(0, (p.life - p.max + 0.15) / 0.15) * 0.5;
        worldText(g, p.text ?? '', p.x, p.y, p.size * pop, { fill: p.color, stroke: '#111', strokeW: p.size * 0.22, align: 'center' });
      }
      g.globalAlpha = 1;
    }

    // Screen-space flash.
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (flash > 0) {
      g.fillStyle = `rgba(${flashColor}, ${flash * 0.3})`;
      g.fillRect(0, 0, canvas.width, canvas.height);
      flash = Math.max(0, flash - dt * 2);
    }
  }

  raf = requestAnimationFrame(frame);
  return {
    stats,
    stop() {
      cancelAnimationFrame(raf);
      conn.db.pointer.removeOnInsert(onPointer);
      conn.db.pointer.removeOnUpdate(onPointerUpdate);
      conn.db.cursor.removeOnUpdate(onCursor);
      conn.db.fx.removeOnInsert(onFx);
    },
  };
}
