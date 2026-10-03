import { useEffect, useRef, useState } from 'react';
import { tables, type DbConnection } from '../module_bindings';
import { useConnState, usePoll, useRows } from '../lib/stdb';
import { observeClock, serverNowMs } from '../lib/clock';
import { createCursorSmoother, cursorHoldUntilMs } from '../lib/cursorSmoother';
import { COLORS, ghostKey, unpackGhosts, WORLD_H, WORLD_W } from '../../spacetimedb/src/sim';
import { drawField, drawLevel, GAME_META, parseLevel, type LevelView } from '../game/draw';
import { blit, spriteUrl } from '../game/sprites';
import { Win } from '../ui/Win';

const NAME_KEY = 'mob-cursor/name';
const DEADBAND = 0.004; // 0.4% of the pad
const HEARTBEAT_MS = 1000;
/** ghost_frame is written every 3rd tick; ghosts glide to each frame over this long. */
const GHOST_TICKS = 3;
const SILLY = ['Clicky McClick', 'Sir Hovers', 'Mouse Potato', 'Captain Drag', 'Lord Scroll', 'Doubleclick Dan', 'Cursed Cursor', 'Pixel Pete', 'Hover Hannah', 'Right-Click Rita', 'Tab Goblin', 'Ctrl Freak'];

type LevelRow = { id: bigint; kind: string; state: string; params: string; progress: string; score: number; endedAt?: { microsSinceUnixEpoch: bigint } | null };

export default function Play() {
  const { conn, identity, status } = useConnState();
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(NAME_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [error, setError] = useState('');

  // Phones never subscribe to the pointer table (N phones x N pointers x Hz).
  // Everyone's ghosts arrive packed in ONE ghost_frame row at ~5 Hz instead.
  useEffect(() => {
    if (!conn || !identity || status !== 'connected') return;
    observeClock(conn);
    const sub = conn
      .subscriptionBuilder()
      .subscribe([
        tables.cursor,
        tables.config,
        tables.level,
        tables.ghostFrame,
        tables.fx.where(r => r.kind.ne('vote')),
        tables.player.where(r => r.identity.eq(identity)),
      ]);
    return () => sub.unsubscribe();
  }, [conn, identity, status]);

  const me = useRows(c => c.db.player, 200).find(p => identity && p.identity.isEqual(identity));
  const joined = !!me && me.connected;

  async function join(e: React.FormEvent) {
    e.preventDefault();
    if (!conn) return;
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      /* ignore */
    }
    try {
      setError('');
      await conn.reducers.join({ name });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (status !== 'connected') {
    return (
      <div className="phone-center">
        <Win title="REMOTE.EXE" color="#ffd23f" className="join-win">
          <p>{status === 'error' ? 'Could not connect 😵 — refresh to retry.' : 'Dialing up the mob…'}</p>
        </Win>
      </div>
    );
  }

  if (!joined) {
    return (
      <form className="phone-center" onSubmit={join}>
        <Win title="SETUP.EXE — Join the mob" color="#ff4fa3" icon={spriteUrl('cursor', '#fff')} className="join-win dialog">
          <div className="logo">
            <img src={spriteUrl('cursor', '#ffffff')} alt="" />
            <span>
              MOB <span className="c2">CURSOR</span>
            </span>
          </div>
          <p>One cursor. Everyone drives it. Pick a name:</p>
          <div className="name-row">
            <input type="text" autoFocus maxLength={16} placeholder="Your name" value={name} onChange={e => setName(e.target.value)} />
            <button type="button" title="Random name" onClick={() => setName(SILLY[Math.floor(Math.random() * SILLY.length)])}>
              🎲
            </button>
          </div>
          <button type="submit" className="go">
            JOIN ▶
          </button>
          {error && <p className="err">{error}</p>}
        </Win>
      </form>
    );
  }

  return <Remote conn={conn!} selfKey={ghostKey(identity!.toHexString())} color={me.color} name={me.name} score={me.score} team={me.team} />;
}

function Remote({ conn, selfKey, color, name, score, team }: { conn: DbConnection; selfKey: number; color: string; name: string; score: number; team: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const finger = useRef<{ x: number; y: number } | null>(null);
  const tapRings = useRef<{ x: number; y: number; t: number }[]>([]);
  const [sent, setSent] = useState(0);

  // Called on every finger move; the sender effect swaps in the real pump.
  const pump = useRef<() => void>(() => {});

  // Throttled sender: obeys config.pointerHzEffective live, dead-band + heartbeat.
  // Leading edge: a move sends at once if a full interval has passed, otherwise a
  // trailing send is armed for the end of the interval so the last position lands.
  useEffect(() => {
    let lastSent: { x: number; y: number } | null = null;
    let lastAt = -Infinity;
    let timer = 0;
    let count = 0;
    const arm = (ms: number) => {
      clearTimeout(timer);
      timer = window.setTimeout(run, ms);
    };
    const run = () => {
      const f = finger.current;
      if (!f || document.visibilityState !== 'visible') return;
      const hz = conn.db.config.id.find(0)?.pointerHzEffective ?? 15;
      const now = performance.now();
      const moved = !lastSent || Math.hypot(f.x - lastSent.x, f.y - lastSent.y) > DEADBAND;
      if (!moved && now - lastAt < HEARTBEAT_MS) return arm(lastAt + HEARTBEAT_MS - now);
      const wait = lastAt + 1000 / Math.max(1, hz) - now;
      if (wait > 0) return arm(wait);
      conn.reducers.setPointer({ x: f.x, y: f.y }).catch(() => {});
      lastSent = { ...f };
      lastAt = now;
      count++;
      arm(HEARTBEAT_MS);
    };
    pump.current = run;
    document.addEventListener('visibilitychange', run);
    const stat = window.setInterval(() => {
      setSent(count);
      count = 0;
    }, 1000);
    return () => {
      pump.current = () => {};
      document.removeEventListener('visibilitychange', run);
      clearTimeout(timer);
      clearInterval(stat);
    };
  }, [conn]);

  // Haptics + flash on big moments.
  useEffect(() => {
    const onFx = (_c: unknown, row: { kind: string }) => {
      const v: Record<string, number | number[]> = { mine: [90, 40, 90], wall: [60, 30, 60], lose: [200], win: [30, 40, 30, 40, 30], target: 30, autoclick: [20, 30, 60], click: 15 };
      if (v[row.kind] !== undefined) navigator.vibrate?.(v[row.kind]);
      if (row.kind === 'mine' || row.kind === 'wall') {
        wrapRef.current?.classList.remove('flash-mine');
        void wrapRef.current?.offsetWidth;
        wrapRef.current?.classList.add('flash-mine');
      }
    };
    conn.db.fx.onInsert(onFx);
    return () => conn.db.fx.removeOnInsert(onFx);
  }, [conn]);

  // Mini map: level art + everyone's ghosts + the shared cursor + your finger.
  useEffect(() => {
    const cv = canvasRef.current!;
    const g = cv.getContext('2d')!;
    let raf = 0;
    let cache: { id: bigint; params: string; progress: string; view: LevelView } | null = null;
    const smoother = createCursorSmoother();
    const onCursor = (_c: unknown, _o: unknown, row: Parameters<typeof smoother.push>[0]) => smoother.push(row);
    conn.db.cursor.onUpdate(onCursor);
    let rc = { x: WORLD_W / 2, y: WORLD_H / 2 };
    let last = performance.now();
    // Other players, keyed by ghost key + color, gliding between ghost frames.
    type Glide = ReturnType<typeof unpackGhosts>[number] & { fromX: number; fromY: number; t0: number; dur: number };
    const ghosts = new Map<string, Glide>();
    let pending: Uint8Array | null = null;
    const onFrame = (_c: unknown, row: { data: Uint8Array }) => (pending = row.data);
    const onFrameUpdate = (c: unknown, _o: unknown, row: { data: Uint8Array }) => onFrame(c, row);
    conn.db.ghostFrame.onInsert(onFrame);
    conn.db.ghostFrame.onUpdate(onFrameUpdate);
    pending = conn.db.ghostFrame.id.find(0)?.data ?? null;
    const ghostPos = (gh: Glide, t: number) => {
      const f = gh.dur > 0 ? Math.min(1, (t - gh.t0) / gh.dur) : 1;
      return { x: gh.fromX + (gh.x - gh.fromX) * f, y: gh.fromY + (gh.y - gh.fromY) * f };
    };
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(cv.clientWidth * dpr) || cv.height !== Math.round(cv.clientHeight * dpr)) {
        cv.width = Math.round(cv.clientWidth * dpr);
        cv.height = Math.round(cv.clientHeight * dpr);
      }
      const W = cv.width;
      const H = cv.height;
      const sx = W / WORLD_W;
      const sy = H / WORLD_H;
      const ms = serverNowMs();

      let lvl = null as LevelRow | null;
      for (const l of conn.db.level.iter()) if (!lvl || l.id > lvl.id) lvl = l;
      const running = lvl && lvl.state === 'running' ? lvl : null;
      if (running && (!cache || cache.id !== running.id || cache.params !== running.params || cache.progress !== running.progress))
        cache = { id: running.id, params: running.params, progress: running.progress, view: parseLevel(running)! };

      const cur = conn.db.cursor.id.find(0);
      const cfg = conn.db.config.id.find(0);
      if (cur && cfg) rc = smoother.step(dt, cfg, running && cache ? cursorHoldUntilMs(cache.view) : 0);

      // World is stretched to fill the pad (pad position == world position).
      g.setTransform(sx, 0, 0, sy, 0, 0);
      const px = 1 / Math.min(sx, sy);
      drawField(g, running ? running.kind : 'lobby', px);
      if (running && cache) drawLevel(g, cache.view, px, ms, rc, false);

      // Sprites in screen space so they are not stretched.
      g.setTransform(1, 0, 0, 1, 0, 0);
      const frame = pending;
      if (frame) {
        // New frame: each ghost glides from where it is drawn now to its new spot,
        // so 5 Hz data moves at a steady 60 fps. Gliding a bit longer than one
        // interval means a slightly late frame re-targets mid-glide instead of the
        // ghost stopping and starting.
        pending = null;
        const glideMs = (1.25 * GHOST_TICKS * 1000) / Math.max(1, cfg?.tickHz ?? 15);
        const seen = new Set<string>();
        for (const r of unpackGhosts(frame)) {
          // You are the big dot under your finger; a lagging copy of you looks broken.
          if (r.key === selfKey && COLORS[r.color] === color) continue;
          const id = `${r.key}:${r.color}`;
          if (seen.has(id)) continue; // key collision: draw one rather than swap
          seen.add(id);
          const gh = ghosts.get(id);
          const at = gh ? ghostPos(gh, t) : { x: r.x, y: r.y };
          ghosts.set(id, { ...r, fromX: at.x, fromY: at.y, t0: t, dur: gh ? glideMs : 0 });
        }
        for (const id of ghosts.keys()) if (!seen.has(id)) ghosts.delete(id);
      }
      for (const gh of ghosts.values()) {
        const p = ghostPos(gh, t);
        const gx = p.x * W;
        const gy = p.y * H;
        blit(g, 'cursor', gx, gy, 1.2 * dpr, { tint: COLORS[gh.color] ?? '#999', alpha: 0.85 });
        if (gh.dictator) blit(g, 'crown', gx - 2 * dpr, gy - 10 * dpr, 0.9 * dpr);
      }
      const f = finger.current;
      if (f && cur) {
        g.strokeStyle = color;
        g.lineWidth = 3 * dpr;
        g.setLineDash([6 * dpr, 6 * dpr]);
        g.beginPath();
        g.moveTo(rc.x * sx, rc.y * sy);
        g.lineTo(f.x * W, f.y * H);
        g.stroke();
        g.setLineDash([]);
      }
      blit(g, 'cursor', rc.x * sx, rc.y * sy, 2.4 * dpr, { tint: '#ffffff', shadow: 3 * dpr });
      if (f) {
        g.fillStyle = color;
        g.strokeStyle = '#111';
        g.lineWidth = 3 * dpr;
        g.beginPath();
        g.arc(f.x * W, f.y * H, 16 * dpr, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
      const now = performance.now();
      tapRings.current = tapRings.current.filter(r => now - r.t < 500);
      for (const r of tapRings.current) {
        const k = (now - r.t) / 500;
        g.strokeStyle = `rgba(17,17,17,${1 - k})`;
        g.lineWidth = 4 * dpr;
        g.beginPath();
        g.arc(r.x * W, r.y * H, (16 + k * 40) * dpr, 0, Math.PI * 2);
        g.stroke();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      conn.db.cursor.removeOnUpdate(onCursor);
      conn.db.ghostFrame.removeOnInsert(onFrame);
      conn.db.ghostFrame.removeOnUpdate(onFrameUpdate);
    };
  }, [conn, color, selfKey]);

  // Banners (polled at 4 Hz so React stays out of the frame loop).
  const banner = usePoll(() => {
    let lvl = null as LevelRow | null;
    for (const l of conn.db.level.iter()) if (!lvl || l.id > lvl.id) lvl = l;
    const now = serverNowMs();
    if (!lvl) return { text: 'WAITING FOR HOST…', cls: '', game: 'LOBBY' };
    const meta = JSON.parse(lvl.params) as { playAt?: number; stage?: number; stages?: number };
    const gm = GAME_META[lvl.kind] ?? GAME_META.lobby;
    const game = `${gm.exe} · ${meta.stage ?? 1}/${meta.stages ?? 3}`;
    if (lvl.state === 'running') {
      const c = Math.ceil(((meta.playAt ?? 0) - now) / 1000);
      return c > 0 ? { text: String(c), cls: 'count', game } : { text: '', cls: '', game };
    }
    const ended = lvl.endedAt ? Number(lvl.endedAt.microsSinceUnixEpoch / 1000n) : 0;
    if (lvl.state !== 'skipped' && now - ended < 10000) return { text: lvl.state === 'won' ? `CLEAR! +${lvl.score}` : 'FAILED!', cls: '', game };
    return { text: 'GET READY…', cls: '', game };
  }, 250);

  const down = useRef<{ t: number; x: number; y: number } | null>(null);
  const toNorm = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };
  const click = () => {
    navigator.vibrate?.(15);
    const f = finger.current;
    if (f) tapRings.current.push({ ...f, t: performance.now() });
    conn.reducers.click({}).catch(() => {});
  };

  return (
    <div className="phone">
      <Win
        title={name}
        color={color}
        icon={spriteUrl('cursor', '#ffffff')}
        className="remote"
        right={<span className="chip">{team === 0 ? 'RED' : 'BLUE'}</span>}
      >
        <div className="remote-info">
          <span className="swatch" style={{ background: color }} />
          <span className="game">{banner.game}</span>
          <span className="score">{score} pts</span>
        </div>
        <div className="pad-wrap" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            className="pad"
            onPointerDown={e => {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              const p = toNorm(e);
              finger.current = p;
              pump.current();
              down.current = { t: performance.now(), ...p };
            }}
            onPointerMove={e => {
              if (e.pointerType === 'mouse' || e.buttons) {
                finger.current = toNorm(e);
                pump.current();
              }
            }}
            onPointerUp={e => {
              const p = toNorm(e);
              const d = down.current;
              if (d && performance.now() - d.t < 250 && Math.hypot(p.x - d.x, p.y - d.y) < 0.03) click();
              down.current = null;
            }}
          />
          {banner.text && (
            <div className={`pad-banner ${banner.cls}`} key={banner.text}>
              {banner.text}
            </div>
          )}
        </div>
      </Win>
      <button className="click-btn" onClick={click}>
        CLICK!
      </button>
      <div className="phone-foot">drag = pull the cursor · tap = click vote · {sent}/s</div>
    </div>
  );
}
