import type { DbConnection } from '../module_bindings';
import {
  WORLD_H,
  WORLD_W,
  type MazeParams,
  type MazeProgress,
  type MinesParams,
  type MinesProgress,
  type TargetsParams,
  type TargetsProgress,
} from '../../spacetimedb/src/sim';
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
  life: number;
  max: number;
  color: string;
  size: number;
  kind: 'dot' | 'ring' | 'text';
  text?: string;
};

type Ghost = { x: number; y: number; seen: number };

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
  // Smoothed render position of the shared cursor.
  const rc = { x: WORLD_W / 2, y: WORLD_H / 2, init: false };
  // Latest snapshot + local receive time, for extrapolation.
  let snap = { x: WORLD_W / 2, y: WORLD_H / 2, vx: 0, vy: 0, at: performance.now() };
  // serverMicros - localMs*1000, minimum seen (best estimate of clock offset).
  let clockOffsetUs: number | null = null;

  const colorOf = (hex: string) => {
    for (const p of conn.db.player.iter()) if (p.identity.toHexString() === hex) return p.color;
    return '#fff';
  };

  const onPointer = (_c: unknown, row: { identity: { toHexString(): string } }) => {
    counters.pointer++;
    const id = row.identity.toHexString();
    const gh = ghosts.get(id);
    if (gh) gh.seen = performance.now();
  };
  const onCursor = (_c: unknown, _o: unknown, row: { x: number; y: number; vx: number; vy: number; lastTickAt: { microsSinceUnixEpoch: bigint } }) => {
    counters.ticks++;
    const nowMs = performance.now();
    snap = { x: row.x, y: row.y, vx: row.vx, vy: row.vy, at: nowMs };
    const off = Number(row.lastTickAt.microsSinceUnixEpoch) - (performance.timeOrigin + nowMs) * 1000;
    clockOffsetUs = clockOffsetUs === null ? off : Math.max(off, clockOffsetUs - 2000);
  };
  const onFx = (_c: unknown, row: { kind: string; x: number; y: number; who: string }) => {
    sfx(row.kind);
    if (row.kind === 'vote') {
      counters.votes++;
      particles.push({ x: row.x, y: row.y, vx: 0, vy: 0, life: 0.6, max: 0.6, color: colorOf(row.who), size: 0.6, kind: 'ring' });
    } else if (row.kind === 'click') {
      particles.push({ x: row.x, y: row.y, vx: 0, vy: 0, life: 0.8, max: 0.8, color: '#fff', size: 1.6, kind: 'ring' });
    } else if (row.kind === 'target' || row.kind === 'reveal') {
      burst(row.x, row.y, row.kind === 'target' ? 30 : 10, ['#ffd43b', '#69db7c', '#4dabf7']);
    } else if (row.kind === 'wall' || row.kind === 'mine') {
      shake = row.kind === 'mine' ? 1 : 0.6;
      flash = 0.5;
      burst(row.x, row.y, 25, ['#ff4d6d', '#ff922b']);
      particles.push({ x: row.x, y: row.y - 0.5, vx: 0, vy: -0.8, life: 1.2, max: 1.2, color: '#ff4d6d', size: 0.6, kind: 'text', text: row.kind === 'mine' ? 'BOOM' : 'BONK' });
    } else if (row.kind === 'win') {
      for (let i = 0; i < 6; i++) burst(Math.random() * WORLD_W, Math.random() * WORLD_H * 0.5, 40, ['#ff4d6d', '#ffd43b', '#69db7c', '#4dabf7', '#da77f2']);
    } else if (row.kind === 'lose') {
      shake = 1;
      flash = 1;
    } else if (row.kind === 'dictator') {
      particles.push({ x: row.x, y: row.y - 0.6, vx: 0, vy: -0.5, life: 2, max: 2, color: '#ffd43b', size: 0.5, kind: 'text', text: '👑' });
    }
  };

  function burst(x: number, y: number, n: number, colors: string[]) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 5;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2, life: 1.2, max: 1.2, color: colors[i % colors.length], size: 0.08 + Math.random() * 0.1, kind: 'dot' });
    }
  }

  conn.db.pointer.onInsert(onPointer);
  const onPointerUpdate = (c: unknown, _o: unknown, n: { identity: { toHexString(): string } }) => onPointer(c, n);
  conn.db.pointer.onUpdate(onPointerUpdate);
  conn.db.cursor.onUpdate(onCursor);
  conn.db.fx.onInsert(onFx);

  // Parsed-level cache so we don't JSON.parse every frame.
  let lvlCache: { id: bigint; params: string; progress: string; p: unknown; prog: unknown } | null = null;
  const currentLevel = () => {
    let best = null as ReturnType<typeof conn.db.level.id.find>;
    for (const l of conn.db.level.iter()) if (!best || l.id > best.id) best = l;
    if (!best) return null;
    if (!lvlCache || lvlCache.id !== best.id || lvlCache.params !== best.params || lvlCache.progress !== best.progress) {
      lvlCache = { id: best.id, params: best.params, progress: best.progress, p: JSON.parse(best.params), prog: JSON.parse(best.progress) };
    }
    return { row: best, p: lvlCache.p, prog: lvlCache.prog };
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

    // Resize to device pixels.
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#0b0d17';
    g.fillRect(0, 0, canvas.width, canvas.height);

    // World -> screen: fit 16:9 with margin, plus screen shake.
    const scale = Math.min((canvas.width * 0.96) / WORLD_W, (canvas.height * 0.9) / WORLD_H);
    const ox = (canvas.width - WORLD_W * scale) / 2 + (Math.random() - 0.5) * shake * 30 * dpr;
    const oy = (canvas.height - WORLD_H * scale) / 2 + 20 * dpr + (Math.random() - 0.5) * shake * 30 * dpr;
    shake = Math.max(0, shake - dt * 2);
    g.setTransform(scale, 0, 0, scale, ox, oy);
    const px = 1 / scale; // one device pixel in world units

    // Playfield.
    g.fillStyle = '#141829';
    g.fillRect(0, 0, WORLD_W, WORLD_H);
    g.strokeStyle = '#2a3150';
    g.lineWidth = 2 * px;
    g.strokeRect(0, 0, WORLD_W, WORLD_H);

    const heat = opts.heatmap();
    if (heat) {
      for (const [x, y] of heat) {
        g.fillStyle = 'rgba(255, 80, 120, 0.08)';
        g.beginPath();
        g.arc(x, y, 0.5, 0, Math.PI * 2);
        g.fill();
      }
    }

    const lvl = currentLevel();
    const running = lvl && lvl.row.state === 'running';
    if (lvl && running) drawLevel(lvl.row.kind, lvl.p, lvl.prog, px, t);

    // Cursor interpolation: extrapolate the latest snapshot, then ease toward it.
    const cur = conn.db.cursor.id.find(0);
    if (cur) {
      const age = Math.min(0.15, (t - snap.at) / 1000);
      const ex = snap.x + snap.vx * age;
      const ey = snap.y + snap.vy * age;
      if (!rc.init) {
        rc.x = ex;
        rc.y = ey;
        rc.init = true;
      }
      const k = 1 - Math.exp(-dt * 18);
      // Teleports (maze respawn) snap instantly.
      if (Math.hypot(ex - rc.x, ey - rc.y) > 3) {
        rc.x = ex;
        rc.y = ey;
      }
      rc.x += (ex - rc.x) * k;
      rc.y += (ey - rc.y) * k;
    }

    // Ghost cursors: everyone's pull, with a tug line to the shared cursor.
    const nowMs = performance.now();
    const fresh = new Set<string>();
    const dictator = cur?.dictator ?? '';
    for (const p of conn.db.pointer.iter()) {
      const id = p.identity.toHexString();
      const wx = p.x * WORLD_W;
      const wy = p.y * WORLD_H;
      let gh = ghosts.get(id);
      if (!gh) {
        gh = { x: wx, y: wy, seen: nowMs };
        ghosts.set(id, gh);
      }
      gh.x += (wx - gh.x) * (1 - Math.exp(-dt * 12));
      gh.y += (wy - gh.y) * (1 - Math.exp(-dt * 12));
      const stale = nowMs - gh.seen > 2500;
      fresh.add(id);
      const pl = conn.db.player.identity.find(p.identity);
      const color = pl?.color ?? '#888';
      g.globalAlpha = stale ? 0.15 : 0.9;
      if (opts.showLines() && !stale) {
        g.strokeStyle = color;
        g.globalAlpha = 0.18;
        g.lineWidth = 1.5 * px;
        g.beginPath();
        g.moveTo(rc.x, rc.y);
        g.lineTo(gh.x, gh.y);
        g.stroke();
        g.globalAlpha = 0.9;
      }
      drawArrow(gh.x, gh.y, 0.32, color, px, pl?.team === 1 ? 'square' : 'arrow');
      if (dictator === id) {
        g.font = `0.6px system-ui`;
        g.fillText('👑', gh.x - 0.2, gh.y - 0.25);
      }
      if (pl) {
        g.fillStyle = '#fff';
        g.globalAlpha = stale ? 0.15 : 0.7;
        g.font = `${0.26}px system-ui, sans-serif`;
        g.fillText(pl.name, gh.x + 0.25, gh.y + 0.45);
      }
      g.globalAlpha = 1;
    }
    for (const id of ghosts.keys()) if (!fresh.has(id)) ghosts.delete(id);

    // Crowd aggregate target.
    if (cur && cur.active > 0) {
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 2 * px;
      g.beginPath();
      g.arc(cur.tx, cur.ty, 0.18, 0, Math.PI * 2);
      g.moveTo(cur.tx - 0.3, cur.ty);
      g.lineTo(cur.tx + 0.3, cur.ty);
      g.moveTo(cur.tx, cur.ty - 0.3);
      g.lineTo(cur.tx, cur.ty + 0.3);
      g.stroke();
    }

    // The one true cursor.
    drawArrow(rc.x, rc.y, 0.8, '#ffffff', px, 'arrow', true);

    // Particles.
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      const a = p.life / p.max;
      g.globalAlpha = a;
      if (p.kind === 'dot') {
        p.vy += 6 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        g.fillStyle = p.color;
        g.fillRect(p.x, p.y, p.size, p.size);
      } else if (p.kind === 'ring') {
        g.strokeStyle = p.color;
        g.lineWidth = 3 * px;
        g.beginPath();
        g.arc(p.x, p.y, p.size * (1 - a) + 0.1, 0, Math.PI * 2);
        g.stroke();
      } else {
        p.y += p.vy * dt;
        g.fillStyle = p.color;
        g.font = `bold ${p.size}px system-ui, sans-serif`;
        g.fillText(p.text ?? '', p.x - p.size, p.y);
      }
      g.globalAlpha = 1;
    }

    // Screen-space overlays.
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (flash > 0) {
      g.fillStyle = `rgba(255, 40, 80, ${flash * 0.35})`;
      g.fillRect(0, 0, cw, ch);
      flash = Math.max(0, flash - dt * 2);
    }
    drawTopBar(cw, cur?.chaos ?? 0, lvl, t);
  }

  function drawArrow(x: number, y: number, s: number, color: string, px: number, shape: 'arrow' | 'square', main = false) {
    g.save();
    g.translate(x, y);
    g.beginPath();
    if (shape === 'square') {
      g.rect(-s * 0.2, -s * 0.2, s * 0.4, s * 0.4);
    } else {
      g.moveTo(0, 0);
      g.lineTo(0, s);
      g.lineTo(s * 0.28, s * 0.74);
      g.lineTo(s * 0.48, s * 1.12);
      g.lineTo(s * 0.62, s * 1.05);
      g.lineTo(s * 0.42, s * 0.68);
      g.lineTo(s * 0.75, s * 0.68);
      g.closePath();
    }
    if (main) {
      g.shadowColor = 'rgba(255,255,255,0.8)';
      g.shadowBlur = 20;
    }
    g.fillStyle = main ? '#fff' : color;
    g.fill();
    g.shadowBlur = 0;
    g.lineWidth = (main ? 3 : 1.5) * px;
    g.strokeStyle = main ? '#000' : 'rgba(0,0,0,0.6)';
    g.stroke();
    g.restore();
  }

  function drawLevel(kind: string, p: unknown, prog: unknown, px: number, t: number) {
    if (kind === 'targets') {
      const tp = p as TargetsParams;
      const pr = prog as TargetsProgress;
      tp.targets.forEach((tg, i) => {
        const done = i < pr.next;
        const isNext = i === pr.next;
        g.globalAlpha = done ? 0.2 : isNext ? 1 : 0.45;
        g.fillStyle = isNext ? '#ff4d6d' : '#4dabf7';
        g.beginPath();
        g.arc(tg.x, tg.y, tp.r * (isNext ? 1 + 0.08 * Math.sin(t / 150) : 0.8), 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#fff';
        g.font = `bold 0.5px system-ui`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(i + 1), tg.x, tg.y);
        g.textAlign = 'start';
        g.textBaseline = 'alphabetic';
        g.globalAlpha = 1;
      });
    } else if (kind === 'maze') {
      const m = p as MazeParams;
      const pr = prog as MazeProgress;
      const tw = WORLD_W / m.cols;
      const th = WORLD_H / m.rows;
      for (let r = 0; r < m.rows; r++)
        for (let c = 0; c < m.cols; c++) {
          if (m.tiles[r * m.cols + c] === '#') {
            g.fillStyle = '#3b4a8a';
            g.fillRect(c * tw, r * th, tw + px, th + px);
          }
        }
      g.fillStyle = '#69db7c';
      g.fillRect(m.goal.c * tw + tw * 0.15, m.goal.r * th + th * 0.15, tw * 0.7, th * 0.7);
      g.fillStyle = '#ffd43b';
      g.globalAlpha = 0.4;
      g.fillRect(m.start.c * tw + tw * 0.2, m.start.r * th + th * 0.2, tw * 0.6, th * 0.6);
      g.globalAlpha = 1;
      g.fillStyle = '#fff';
      g.font = `bold 0.4px system-ui`;
      g.fillText(`BONKS ${pr.hits}  (each bonk = back to start)`, 0.2, -0.15);
    } else if (kind === 'minesweeper') {
      const m = p as MinesParams;
      const pr = prog as MinesProgress;
      const cw = WORLD_W / m.cols;
      const chh = WORLD_H / m.rows;
      const colors = ['#888', '#4dabf7', '#69db7c', '#ff4d6d', '#9775fa', '#ff922b', '#3bc9db', '#fff', '#aaa'];
      for (let r = 0; r < m.rows; r++)
        for (let c = 0; c < m.cols; c++) {
          const ch = pr.cells[r * m.cols + c];
          const x = c * cw;
          const y = r * chh;
          g.fillStyle = ch === '#' ? '#2f3a66' : ch === '*' ? '#c92a2a' : '#1c2238';
          g.fillRect(x + 0.03, y + 0.03, cw - 0.06, chh - 0.06);
          if (ch !== '#' && ch !== '0') {
            g.fillStyle = ch === '*' ? '#fff' : colors[Number(ch)] ?? '#fff';
            g.font = `bold ${chh * 0.55}px system-ui`;
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.fillText(ch === '*' ? '💣' : ch, x + cw / 2, y + chh / 2);
            g.textAlign = 'start';
            g.textBaseline = 'alphabetic';
          }
        }
      // Hovered cell under the cursor.
      const hc = Math.floor((rc.x / WORLD_W) * m.cols);
      const hr = Math.floor((rc.y / WORLD_H) * m.rows);
      g.strokeStyle = '#ffd43b';
      g.lineWidth = 3 * px;
      g.strokeRect(hc * cw, hr * chh, cw, chh);
      g.fillStyle = '#fff';
      g.font = `bold 0.4px system-ui`;
      g.fillText(`LIVES ${pr.lives}/${m.lives}`, 0.2, -0.15);
    }
  }

  function drawTopBar(cw: number, chaos: number, lvl: ReturnType<typeof currentLevel>, t: number) {
    // Chaos meter.
    const w = Math.min(360, cw * 0.3);
    g.fillStyle = '#fff';
    g.font = 'bold 16px system-ui, sans-serif';
    g.fillText('CHAOS', 16, 26);
    g.fillStyle = '#222842';
    g.fillRect(80, 12, w, 18);
    const hue = 120 - chaos * 120;
    g.fillStyle = `hsl(${hue}, 90%, 55%)`;
    const wob = chaos > 0.7 ? Math.sin(t / 40) * 4 : 0;
    g.fillRect(80, 12 + wob, w * chaos, 18);
    g.fillStyle = '#fff';
    g.fillText(chaos > 0.8 ? 'TOTAL ANARCHY' : chaos > 0.55 ? 'ARGUING' : chaos > 0.3 ? 'BICKERING' : 'HIVE MIND', 90 + w, 26);

    // Level + timer.
    if (lvl) {
      const r = lvl.row;
      let label = `${r.kind.toUpperCase()}`;
      if (r.state === 'running') {
        const nowUs = (performance.timeOrigin + performance.now()) * 1000 + (clockOffsetUs ?? 0);
        const left = Math.max(0, (Number(r.deadline.microsSinceUnixEpoch) - nowUs) / 1e6);
        label += `  ⏱ ${left.toFixed(0)}s`;
      } else {
        label += r.state === 'won' ? '  ✅ WON' : r.state === 'lost' ? '  ❌ LOST' : '  ⏭ SKIPPED';
        label += `  score ${r.score}`;
      }
      g.font = 'bold 22px system-ui, sans-serif';
      const m = g.measureText(label);
      g.fillText(label, cw - m.width - 16, 28);
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
