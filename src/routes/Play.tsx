import { useEffect, useRef, useState } from 'react';
import { tables, type DbConnection } from '../module_bindings';
import { useConnState, usePoll, useRows } from '../lib/stdb';
import { observeClock, serverNowMs } from '../lib/clock';
import { COLORS, WORLD_H, WORLD_W } from '../../spacetimedb/src/sim';
import { drawField, drawLevel, GAME_META, parseLevel, type LevelView } from '../game/draw';
import { blit, spriteUrl } from '../game/sprites';
import { Win } from '../ui/Win';

const NAME_KEY = 'mob-cursor/name';
const DEADBAND = 0.01; // 1% of the pad
const HEARTBEAT_MS = 1000;
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

  return <Remote conn={conn!} color={me.color} name={me.name} score={me.score} team={me.team} />;
}

function Remote({ conn, color, name, score, team }: { conn: DbConnection; color: string; name: string; score: number; team: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const finger = useRef<{ x: number; y: number } | null>(null);
  const tapRings = useRef<{ x: number; y: number; t: number }[]>([]);
  const [sent, setSent] = useState(0);

  // Throttled sender: obeys config.pointerHzEffective live, dead-band + heartbeat.
  useEffect(() => {
    let lastSent: { x: number; y: number } | null = null;
    let lastAt = 0;
    let timer = 0;
    let count = 0;
    const loop = () => {
      const hz = conn.db.config.id.find(0)?.pointerHzEffective ?? 8;
      const f = finger.current;
      const now = performance.now();
      if (f && document.visibilityState === 'visible') {
        const moved = !lastSent || Math.hypot(f.x - lastSent.x, f.y - lastSent.y) > DEADBAND;
        if (moved || now - lastAt > HEARTBEAT_MS) {
          conn.reducers.setPointer({ x: f.x, y: f.y }).catch(() => {});
          lastSent = { ...f };
          lastAt = now;
          count++;
        }
      }
      timer = window.setTimeout(loop, 1000 / Math.max(1, hz));
    };
    loop();
    const stat = window.setInterval(() => {
      setSent(count);
      count = 0;
    }, 1000);
    return () => {
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
    const rc = { x: WORLD_W / 2, y: WORLD_H / 2 };
    const draw = () => {
      raf = requestAnimationFrame(draw);
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
      if (cur) {
        rc.x += (cur.x - rc.x) * 0.35;
        rc.y += (cur.y - rc.y) * 0.35;
      }

      // World is stretched to fill the pad (pad position == world position).
      g.setTransform(sx, 0, 0, sy, 0, 0);
      const px = 1 / Math.min(sx, sy);
      drawField(g, running ? running.kind : 'lobby', px);
      if (running && cache) drawLevel(g, cache.view, px, ms, rc, false);

      // Sprites in screen space so they are not stretched.
      g.setTransform(1, 0, 0, 1, 0, 0);
      const frame = conn.db.ghostFrame.id.find(0)?.data;
      if (frame) {
        for (let i = 0; i + 3 < frame.length; i += 4) {
          const gx = (frame[i + 2] / 255) * W;
          const gy = (frame[i + 3] / 255) * H;
          blit(g, 'cursor', gx, gy, 1.2 * dpr, { tint: COLORS[frame[i]] ?? '#999', alpha: 0.85 });
          if (frame[i + 1] & 2) blit(g, 'crown', gx - 2 * dpr, gy - 10 * dpr, 0.9 * dpr);
        }
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
    draw();
    return () => cancelAnimationFrame(raf);
  }, [conn, color]);

  // Banners (polled at 4 Hz so React stays out of the frame loop).
  const banner = usePoll(() => {
    let lvl = null as LevelRow | null;
    for (const l of conn.db.level.iter()) if (!lvl || l.id > lvl.id) lvl = l;
    const now = serverNowMs();
    if (!lvl) return { text: 'WAITING FOR HOST…', cls: '', game: 'LOBBY', mines: false };
    const meta = JSON.parse(lvl.params) as { playAt?: number; stage?: number; stages?: number };
    const gm = GAME_META[lvl.kind] ?? GAME_META.lobby;
    const game = `${gm.exe} · ${meta.stage ?? 1}/${meta.stages ?? 3}`;
    if (lvl.state === 'running') {
      const c = Math.ceil(((meta.playAt ?? 0) - now) / 1000);
      const mines = lvl.kind === 'minesweeper' && c <= 0;
      return c > 0 ? { text: String(c), cls: 'count', game, mines } : { text: '', cls: '', game, mines };
    }
    const ended = lvl.endedAt ? Number(lvl.endedAt.microsSinceUnixEpoch / 1000n) : 0;
    if (lvl.state !== 'skipped' && now - ended < 10000) return { text: lvl.state === 'won' ? `CLEAR! +${lvl.score}` : 'FAILED!', cls: '', game, mines: false };
    return { text: 'GET READY…', cls: '', game, mines: false };
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
    // Clicks only matter in minesweeper; don't spend reducer calls elsewhere.
    if (!banner.mines) return;
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
              down.current = { t: performance.now(), ...p };
            }}
            onPointerMove={e => {
              if (e.pointerType === 'mouse' || e.buttons) finger.current = toNorm(e);
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
      <div className="phone-foot">
        drag = pull the cursor{banner.mines ? ' · tap = click vote' : ''} · {sent}/s
      </div>
    </div>
  );
}
