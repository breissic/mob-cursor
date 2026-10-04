import { useEffect, useRef, useState } from 'react';
import { tables, type DbConnection } from '../module_bindings';
import { useConnState, usePoll, useRows } from '../lib/stdb';
import { useRoomByCode, useSubscribe } from '../lib/room';
import { observeClock, serverNowMs } from '../lib/clock';
import { createCursorSmoother, cursorHoldUntilMs } from '../lib/cursorSmoother';
import { roomCodeFromUrl, setRoomInUrl } from '../config';
import { COLORS, cursorPhysics, DEFAULT_ROOM_CODE, ghostKey, normalizeRoomCode, STAGES, unpackGhosts, WORLD_H, WORLD_W } from '../../spacetimedb/src/sim';
import { drawField, drawLevel, GAME_META, parseLevel, type LevelView } from '../game/draw';
import { blit, spriteUrl } from '../game/sprites';
import { Win } from '../ui/Win';
import { fmt, GameStatus, Intro, objectiveOf, phaseOf, Results, RULE_LABEL, StagePips, type LevelRow } from '../ui/Game';

const NAME_KEY = 'mob-cursor/name';
const JOINED_KEY = 'mob-cursor/joined';
const DEADBAND = 0.004; // 0.4% of the pad
const HEARTBEAT_MS = 1000;
/** ghost_frame is written every 3rd tick; ghosts glide to each frame over this long. */
const GHOST_TICKS = 3;
const SILLY = ['Clicky McClick', 'Sir Hovers', 'Mouse Potato', 'Captain Drag', 'Lord Scroll', 'Doubleclick Dan', 'Cursed Cursor', 'Pixel Pete', 'Hover Hannah', 'Right-Click Rita', 'Tab Goblin', 'Ctrl Freak'];

type RoomRow = { id: number; code: string; name: string; players: number; pointerHzEffective: number; levelId: bigint };
type PlayerRow = { identity: { toHexString(): string; isEqual(o: unknown): boolean }; roomId: number; name: string; color: string; team: number; score: number; connected: boolean };

export default function Play() {
  const { conn, identity, status } = useConnState();
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(NAME_KEY) ?? '';
    } catch {
      return '';
    }
  });
  // The room code in the form; follows the room we are actually in once joined.
  const [code, setCode] = useState(roomCodeFromUrl);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (conn && status === 'connected') observeClock(conn);
  }, [conn, status]);

  // Global rows: config + the room named in the form (so the join screen can show it), and only MY player row.
  const wantCode = normalizeRoomCode(code) || DEFAULT_ROOM_CODE;
  const roomByCode = useRoomByCode(wantCode);
  const idHex = identity?.toHexString();
  useSubscribe(() => (identity ? [tables.player.where(r => r.identity.eq(identity))] : null), [idHex]);
  const me = useRows(c => c.db.player, 200).find(p => identity && p.identity.isEqual(identity));
  const joined = !!me && me.connected;
  const roomId = joined ? me.roomId : null;

  // Joined: everything the pad draws, scoped to our room. Phones never subscribe
  // to the pointer table (N phones x N pointers x Hz); ghosts arrive packed in ONE
  // ghost_frame row at ~5 Hz instead. The room row is fetched by id because
  // create_room (or a garbage-collected room) moves us without a code in hand.
  useSubscribe(
    () =>
      roomId === null
        ? null
        : [
            tables.room.where(r => r.id.eq(roomId)),
            tables.cursor.where(r => r.id.eq(roomId)),
            tables.ghostFrame.where(r => r.id.eq(roomId)),
            tables.level.where(r => r.roomId.eq(roomId)),
            tables.player.where(r => r.roomId.eq(roomId)),
            tables.award.where(r => r.roomId.eq(roomId)),
            tables.eventLog.where(r => r.roomId.eq(roomId).and(r.kind.eq('level_end'))),
            tables.fx.where(r => r.roomId.eq(roomId).and(r.kind.ne('vote'))),
          ],
    [roomId]
  );
  const room = useRows(c => c.db.room, 200).find(r => roomId !== null && r.id === roomId);

  // Keep the form and the address bar on the room we are actually in.
  const roomCode = room?.code;
  useEffect(() => {
    if (!roomCode) return;
    setCode(roomCode);
    setRoomInUrl(roomCode);
  }, [roomCode]);

  useEffect(() => {
    if (!joined) return;
    try {
      localStorage.setItem(JOINED_KEY, '1');
    } catch {
      /* ignore */
    }
  }, [joined]);

  // Locked phones get marked "gone" after a minute idle. When this page comes
  // back (unlock / tab switch / reload), quietly rejoin with the same name.
  const meRef = useRef(me);
  meRef.current = me;
  const codeRef = useRef(wantCode);
  codeRef.current = wantCode;
  useEffect(() => {
    if (!conn || status !== 'connected') return;
    let tried = false;
    const rejoin = () => {
      const m = meRef.current;
      if (!m || m.connected || document.visibilityState !== 'visible') return;
      if (localStorage.getItem(JOINED_KEY) !== '1') return;
      conn.reducers.join({ name: m.name, code: codeRef.current }).catch(() => {});
    };
    const firstLoad = window.setInterval(() => {
      if (tried || !meRef.current) return;
      tried = true;
      rejoin();
    }, 300);
    document.addEventListener('visibilitychange', rejoin);
    return () => {
      clearInterval(firstLoad);
      document.removeEventListener('visibilitychange', rejoin);
    };
  }, [conn, status]);

  const saveName = () => {
    try {
      localStorage.setItem(NAME_KEY, name);
      localStorage.setItem(JOINED_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  async function join(e: React.FormEvent) {
    e.preventDefault();
    if (!conn || busy) return;
    saveName();
    setBusy(true);
    try {
      setError('');
      await conn.reducers.join({ name, code: wantCode });
      setRoomInUrl(wantCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  /** Open a fresh room and become its host. create_room needs a player row, so join (staying put) first. */
  async function createRoom() {
    if (!conn || busy) return;
    saveName();
    setBusy(true);
    try {
      setError('');
      await conn.reducers.join({ name, code: '' });
      await conn.reducers.createRoom({ name: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
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

  if (joined && !room) {
    return (
      <div className="phone-center">
        <Win title="REMOTE.EXE" color="#ffd23f" className="join-win">
          <p>Entering the room…</p>
        </Win>
      </div>
    );
  }

  if (!joined || !room) {
    const known = roomByCode && roomByCode.code === wantCode ? roomByCode : null;
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
          <label className="code-row">
            <span>ROOM</span>
            <input
              type="text"
              inputMode="text"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={8}
              placeholder={DEFAULT_ROOM_CODE}
              value={code}
              onChange={e => setCode(normalizeRoomCode(e.target.value))}
            />
          </label>
          <small className="code-hint">
            {known
              ? wantCode === DEFAULT_ROOM_CODE
                ? `The shared lobby · ${known.players} playing`
                : `${known.name} · ${known.players} playing`
              : wantCode === DEFAULT_ROOM_CODE
                ? 'The shared lobby everyone lands in'
                : `Looking for room ${wantCode}…`}
          </small>
          <button type="submit" className="go" disabled={busy || !name.trim()}>
            JOIN ▶
          </button>
          <button type="button" onClick={() => void createRoom()} disabled={busy || !name.trim()}>
            ＋ CREATE ROOM — you host, friends scan your projector
          </button>
          {error && <p className="err">{error}</p>}
        </Win>
      </form>
    );
  }

  return <Remote conn={conn!} me={me} room={room} selfKey={ghostKey(identity!.toHexString())} />;
}

function Remote({ conn, me, room, selfKey }: { conn: DbConnection; me: PlayerRow; room: RoomRow; selfKey: number }) {
  const roomId = room.id;
  const color = me.color;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const finger = useRef<{ x: number; y: number } | null>(null);
  const [sent, setSent] = useState(0);

  // Called on every finger move; the sender effect swaps in the real pump.
  const pump = useRef<() => void>(() => {});

  // Throttled sender: obeys room.pointerHzEffective live, dead-band + heartbeat.
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
      const hz = conn.db.room.id.find(roomId)?.pointerHzEffective ?? 15;
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
  }, [conn, roomId]);

  // Haptics + flash on big moments (our room only; a room switch can race the subscription).
  useEffect(() => {
    const onFx = (_c: unknown, row: { roomId: number; kind: string }) => {
      if (row.roomId !== roomId) return;
      const v: Record<string, number | number[]> = {
        mine: [90, 40, 90],
        wall: [60, 30, 60],
        lose: [200],
        win: [30, 40, 30, 40, 30],
        target: 30,
        autoclick: [20, 30, 60],
        light: 40,
        fault: [60, 30, 60],
        save: 15,
        drop: [80, 40, 80],
        mole_hit: 30,
        mole_miss: 50,
        boom: [120, 50, 120],
        splash: [30, 40, 30],
        sit: 30,
        no_chair: [80, 40, 80],
        key: 20,
        buzz: [70, 30, 70],
        vote_restart: [40, 40, 40],
        hunt_found: [30, 40, 30],
        hunt_reset: 40,
        valve_blow: [80, 40, 80],
        valve_all_in: 30,
        valve_slip: 40,
        station: 30,
        station_cancel: 40,
      };
      if (v[row.kind] !== undefined) navigator.vibrate?.(v[row.kind]);
      if (['mine', 'wall', 'fault', 'drop', 'boom', 'no_chair', 'buzz', 'valve_blow', 'autoclick'].includes(row.kind)) {
        wrapRef.current?.classList.remove('flash-mine');
        void wrapRef.current?.offsetWidth;
        wrapRef.current?.classList.add('flash-mine');
      }
    };
    conn.db.fx.onInsert(onFx);
    return () => conn.db.fx.removeOnInsert(onFx);
  }, [conn, roomId]);

  // Mini map: level art + everyone's ghosts + the shared cursor + your finger.
  useEffect(() => {
    const cv = canvasRef.current!;
    const g = cv.getContext('2d')!;
    let raf = 0;
    let cache: { id: bigint; params: string; progress: string; view: LevelView } | null = null;
    const smoother = createCursorSmoother();
    const onCursor = (_c: unknown, _o: unknown, row: Parameters<typeof smoother.push>[0] & { id: number }) => {
      if (row.id === roomId) smoother.push(row);
    };
    conn.db.cursor.onUpdate(onCursor);
    let rc = { x: WORLD_W / 2, y: WORLD_H / 2 };
    let last = performance.now();
    // Other players, keyed by ghost key + color, gliding between ghost frames.
    type Glide = ReturnType<typeof unpackGhosts>[number] & { fromX: number; fromY: number; t0: number; dur: number };
    const ghosts = new Map<string, Glide>();
    let pending: Uint8Array | null = null;
    const onFrame = (_c: unknown, row: { id: number; data: Uint8Array }) => {
      if (row.id === roomId) pending = row.data;
    };
    const onFrameUpdate = (c: unknown, _o: unknown, row: { id: number; data: Uint8Array }) => onFrame(c, row);
    conn.db.ghostFrame.onInsert(onFrame);
    conn.db.ghostFrame.onUpdate(onFrameUpdate);
    pending = conn.db.ghostFrame.id.find(roomId)?.data ?? null;
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

      // Current level = the room's levelId, never "newest level in the db".
      const levelId = conn.db.room.id.find(roomId)?.levelId ?? 0n;
      const lvl = levelId ? (conn.db.level.id.find(levelId) as LevelRow | undefined) : undefined;
      const running = lvl && lvl.state === 'running' ? lvl : null;
      if (running && (!cache || cache.id !== running.id || cache.params !== running.params || cache.progress !== running.progress))
        cache = { id: running.id, params: running.params, progress: running.progress, view: parseLevel(running)! };

      const cur = conn.db.cursor.id.find(roomId);
      const cfg = conn.db.config.id.find(0);
      if (cur && cfg) {
        const phys = { ...cursorPhysics(running?.kind, cfg), tickHz: cfg.tickHz };
        rc = smoother.step(dt, phys, running && cache ? cursorHoldUntilMs(cache.view) : 0);
      }

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
      // Your finger is a ring drawn UNDER the shared cursor: when the mob agrees
      // with you the cursor sits right on your finger and must stay visible.
      if (f) {
        g.lineWidth = 5 * dpr;
        g.strokeStyle = '#111';
        g.beginPath();
        g.arc(f.x * W, f.y * H, 18 * dpr, 0, Math.PI * 2);
        g.stroke();
        g.lineWidth = 3 * dpr;
        g.strokeStyle = color;
        g.stroke();
      }
      blit(g, 'cursor', rc.x * sx, rc.y * sy, 2.4 * dpr, { tint: '#ffffff', shadow: 3 * dpr });
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      conn.db.cursor.removeOnUpdate(onCursor);
      conn.db.ghostFrame.removeOnInsert(onFrame);
      conn.db.ghostFrame.removeOnUpdate(onFrameUpdate);
    };
  }, [conn, roomId, color, selfKey]);

  // Chrome (polled at 4 Hz so React stays out of the frame loop). Same phase
  // machine and status chips as the projector, laid out for a phone.
  const now = usePoll(serverNowMs, 250);
  const levels = useRows(c => c.db.level, 200) as LevelRow[];
  const current = room.levelId ? (levels.find(l => l.id === room.levelId) ?? null) : null;
  const players = (useRows(c => c.db.player, 400) as PlayerRow[]).filter(p => p.roomId === roomId && p.connected);
  const awards = useRows(c => c.db.award, 500);
  const events = useRows(c => c.db.eventLog, 500);
  const config = useRows(c => c.db.config, 500)[0];
  const cursorPos = usePoll(() => {
    const c = conn.db.cursor.id.find(roomId);
    return c ? { x: c.x, y: c.y } : undefined;
  }, 250);

  const { meta, running, endedMs, inIntro, inResults, inLobby, countdown, timeLeft } = phaseOf(current, now);
  const gm = GAME_META[current && !inLobby ? current.kind : 'lobby'] ?? GAME_META.lobby;
  const ruleTitle = RULE_LABEL[config?.rule ?? 'mean']?.[0] ?? config?.rule ?? '';
  const objective = objectiveOf(current, now);
  const board = [...players].sort((a, b) => b.score - a.score);
  const myRank = board.findIndex(p => p.identity.isEqual(me.identity));
  const shown = board.slice(0, 5);
  if (myRank >= 5) shown.push(board[myRank]);

  const toNorm = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };

  return (
    <div className="phone">
      <Win
        title={inLobby ? 'LOBBY.EXE' : gm.exe}
        color={gm.color}
        icon={spriteUrl('cursor', '#ffffff')}
        className="remote"
        right={
          <>
            {!inLobby && current?.kind !== 'vote' && <StagePips stage={meta.stage ?? 1} stages={meta.stages ?? STAGES} running={running} />}
            {timeLeft !== null && <span className={`timer ${timeLeft < 10 ? 'low' : ''}`}>{fmt(timeLeft)}</span>}
          </>
        }
      >
        <div className="phone-chrome">
          <div className="phone-status">
            <span className="chip me" style={{ background: color }}>
              {me.name} · {me.score}
            </span>
            <span className="chip">{me.team === 0 ? 'RED' : 'BLUE'}</span>
            {running && current && <GameStatus level={current} now={now} cursor={cursorPos} />}
          </div>
          <div className="phone-objective">{inLobby ? `ROOM ${room.code} · waiting for the host…` : objective || (inIntro ? 'Get ready…' : inResults ? 'Round over' : '')}</div>
        </div>
        <div className="pad-wrap" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            className="pad"
            onPointerDown={e => {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              finger.current = toNorm(e);
              pump.current();
            }}
            onPointerMove={e => {
              if (e.pointerType === 'mouse' || e.buttons) {
                finger.current = toNorm(e);
                pump.current();
              }
            }}
          />
          {inIntro && current && <Intro compact kind={current.kind} stage={meta.stage ?? 1} count={countdown} rule={ruleTitle} />}
          {inResults && current && (
            <Results
              compact
              level={current}
              awards={awards.filter(a => a.levelId === current.id)}
              levelEnd={events.find(e => e.kind === 'level_end' && e.levelId === current.id)?.payload}
              board={board.slice(0, 5)}
              nextIn={config?.autoAdvance ? Math.max(0, Math.ceil((endedMs + 10000 - now) / 1000)) : null}
            />
          )}
        </div>
        <ol className="board compact phone-board">
          {shown.map(p => {
            const i = board.indexOf(p);
            return (
              <li key={p.identity.toHexString()} className={`${i === 0 && p.score > 0 ? 'top1' : ''} ${p.identity.isEqual(me.identity) ? 'me' : ''}`}>
                <span className="rank">{i + 1}</span>
                <span className="swatch" style={{ background: p.color }} />
                <span className="name">{p.name}</span>
                <b>{p.score}</b>
              </li>
            );
          })}
          {shown.length === 0 && <li>nobody online yet…</li>}
        </ol>
      </Win>
      <div className="phone-foot">
        ROOM <b>{room.code}</b> · {room.players} playing · drag = pull the cursor · {sent}/s
      </div>
    </div>
  );
}
