import { useEffect, useRef, useState } from 'react';
import { tables, type DbConnection } from '../module_bindings';
import { useConnState, useRows } from '../lib/stdb';
import {
  WORLD_H,
  WORLD_W,
  type MazeParams,
  type MinesParams,
  type MinesProgress,
  type TargetsParams,
  type TargetsProgress,
} from '../../spacetimedb/src/sim';

const NAME_KEY = 'mob-cursor/name';
const DEADBAND = 0.01; // 1% of the pad
const HEARTBEAT_MS = 1000;

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

  // Phones subscribe ONLY to the cursor, the running level, config and their own
  // player row. Never the pointer table (N phones x N pointers x Hz would melt).
  useEffect(() => {
    if (!conn || !identity || status !== 'connected') return;
    const sub = conn
      .subscriptionBuilder()
      .subscribe([
        tables.cursor,
        tables.config,
        tables.level.where(r => r.state.eq('running')),
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
    return <div className="play-center">{status === 'error' ? 'Could not connect 😵' : 'Connecting…'}</div>;
  }

  if (!joined) {
    return (
      <form className="play-center join" onSubmit={join}>
        <h1>MOB CURSOR</h1>
        <p>One cursor. Everyone controls it. Nobody agrees.</p>
        <input
          autoFocus
          maxLength={16}
          placeholder="Your name"
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <button type="submit">Join the mob</button>
        {error && <p className="err">{error}</p>}
      </form>
    );
  }

  return <Pad conn={conn!} color={me.color} name={me.name} score={me.score} team={me.team} />;
}

function Pad({ conn, color, name, score, team }: { conn: DbConnection; color: string; name: string; score: number; team: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const finger = useRef<{ x: number; y: number } | null>(null);
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

  // Mini map so phone players see where the cursor is without the pointer table.
  useEffect(() => {
    const cv = canvasRef.current!;
    const g = cv.getContext('2d')!;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== cv.clientWidth * dpr || cv.height !== cv.clientHeight * dpr) {
        cv.width = cv.clientWidth * dpr;
        cv.height = cv.clientHeight * dpr;
      }
      const W = cv.width;
      const H = cv.height;
      const sx = W / WORLD_W;
      const sy = H / WORLD_H;
      g.fillStyle = '#141829';
      g.fillRect(0, 0, W, H);
      let lvl = null as ReturnType<typeof conn.db.level.id.find>;
      for (const l of conn.db.level.iter()) if (!lvl || l.id > lvl.id) lvl = l;
      if (lvl) {
        const p = JSON.parse(lvl.params);
        const pr = JSON.parse(lvl.progress);
        if (lvl.kind === 'maze') {
          const m = p as MazeParams;
          g.fillStyle = '#3b4a8a';
          for (let r = 0; r < m.rows; r++)
            for (let c = 0; c < m.cols; c++)
              if (m.tiles[r * m.cols + c] === '#') g.fillRect((c * W) / m.cols, (r * H) / m.rows, W / m.cols + 1, H / m.rows + 1);
          g.fillStyle = '#69db7c';
          g.fillRect((m.goal.c * W) / m.cols, (m.goal.r * H) / m.rows, W / m.cols, H / m.rows);
        } else if (lvl.kind === 'targets') {
          const tp = p as TargetsParams;
          const tg = tp.targets[(pr as TargetsProgress).next];
          if (tg) {
            g.fillStyle = '#ff4d6d';
            g.beginPath();
            g.arc(tg.x * sx, tg.y * sy, tp.r * sx, 0, Math.PI * 2);
            g.fill();
          }
        } else if (lvl.kind === 'minesweeper') {
          const m = p as MinesParams;
          const cells = (pr as MinesProgress).cells;
          for (let r = 0; r < m.rows; r++)
            for (let c = 0; c < m.cols; c++) {
              const ch = cells[r * m.cols + c];
              g.fillStyle = ch === '#' ? '#2f3a66' : ch === '*' ? '#c92a2a' : '#1c2238';
              g.fillRect((c * W) / m.cols + 1, (r * H) / m.rows + 1, W / m.cols - 2, H / m.rows - 2);
            }
        }
      }
      const cur = conn.db.cursor.id.find(0);
      if (cur) {
        g.strokeStyle = 'rgba(255,255,255,0.5)';
        g.beginPath();
        g.arc(cur.tx * sx, cur.ty * sy, 6 * dpr, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = '#fff';
        g.beginPath();
        g.arc(cur.x * sx, cur.y * sy, 10 * dpr, 0, Math.PI * 2);
        g.fill();
      }
      const f = finger.current;
      if (f) {
        g.fillStyle = color;
        g.beginPath();
        g.arc(f.x * W, f.y * H, 14 * dpr, 0, Math.PI * 2);
        g.fill();
        if (cur) {
          g.strokeStyle = color;
          g.lineWidth = 2 * dpr;
          g.beginPath();
          g.moveTo(cur.x * sx, cur.y * sy);
          g.lineTo(f.x * W, f.y * H);
          g.stroke();
        }
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [conn, color]);

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
    conn.reducers.click({}).catch(() => {});
  };

  return (
    <div className="pad-wrap">
      <div className="pad-top">
        <span className="dot" style={{ background: color }} /> {name}
        <span className="team">{team === 0 ? 'RED' : 'BLUE'}</span>
        <b>{score}</b>
      </div>
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
      <button className="click-btn" onClick={click}>
        CLICK
      </button>
      <div className="pad-foot">tap = click vote · {sent}/s sent</div>
    </div>
  );
}
