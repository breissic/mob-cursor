import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { tables } from '../module_bindings';
import { useConnState, usePoll, useRows } from '../lib/stdb';
import { useRoomByCode, useSubscribe } from '../lib/room';
import { observeClock, serverNowMs } from '../lib/clock';
import { playUrl, roomCodeFromUrl } from '../config';
import { startRenderer, type RenderStats } from '../display/render';
import { countdownBeep, disableSound, enableSound } from '../display/audio';
import { GAME_META } from '../game/draw';
import { spriteUrl } from '../game/sprites';
import { Win } from '../ui/Win';
import { fmt, GameStatus, Intro, phaseOf, Results, RULE_LABEL, StagePips, type LevelRow } from '../ui/Game';
import { STAGES } from '../../spacetimedb/src/sim';

export default function Display() {
  const { conn, status } = useConnState();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const statsRef = useRef<RenderStats | null>(null);
  const [qr, setQr] = useState('');
  const [hud, setHud] = useState(false);
  const [lines, setLines] = useState(true);
  const [heat, setHeat] = useState(false);
  const [sound, setSound] = useState(false);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const heatRef = useRef<[number, number][] | null>(null);

  // The projector shows exactly one room: the code in the URL (the shared lobby when absent).
  const [code] = useState(roomCodeFromUrl);
  const room = useRoomByCode(code);
  const roomId = room?.id ?? null;
  // Once we know the room id, subscribe to everything the display draws for THAT room only.
  useSubscribe(
    () =>
      roomId === null
        ? null
        : [
            tables.cursor.where(r => r.id.eq(roomId)),
            tables.pointer.where(r => r.roomId.eq(roomId)),
            tables.player.where(r => r.roomId.eq(roomId)),
            tables.level.where(r => r.roomId.eq(roomId)),
            tables.award.where(r => r.roomId.eq(roomId)),
            tables.commentary.where(r => r.roomId.eq(roomId)),
            tables.fx.where(r => r.roomId.eq(roomId)),
            tables.eventLog.where(r => r.roomId.eq(roomId).and(r.kind.ne('sample'))),
          ],
    [roomId]
  );

  useEffect(() => {
    if (conn && status === 'connected') observeClock(conn);
  }, [conn, status]);

  useEffect(() => {
    if (!conn || !canvasRef.current || roomId === null) return;
    const id = roomId;
    const r = startRenderer(canvasRef.current, conn, { showLines: () => linesRef.current, heatmap: () => heatRef.current, roomId: () => id });
    statsRef.current = r.stats;
    return () => r.stop();
  }, [conn, roomId]);

  const joinUrl = playUrl(code);
  useEffect(() => {
    void QRCode.toDataURL(joinUrl, { margin: 1, width: 600, color: { dark: '#111111', light: '#ffffff' } }).then(setQr);
  }, [joinUrl]);

  const levels = useRows(c => c.db.level, 200) as LevelRow[];
  // Current level is the room's pointer, never "newest level in the whole db".
  const current = room && room.levelId ? (levels.find(l => l.id === room.levelId) ?? null) : null;

  // Heatmap: pull 1 Hz cursor samples for the current level on demand only.
  useEffect(() => {
    if (!conn || !heat || !current) {
      heatRef.current = null;
      return;
    }
    const levelId = current.id;
    const collect = () => {
      const pts: [number, number][] = [];
      for (const e of conn.db.eventLog.iter())
        if (e.kind === 'sample' && e.levelId === levelId) {
          const p = JSON.parse(e.payload) as { x: number; y: number };
          pts.push([p.x, p.y]);
        }
      heatRef.current = pts;
    };
    const sub = conn.subscriptionBuilder().onApplied(collect).subscribe([tables.eventLog.where(r => r.kind.eq('sample').and(r.levelId.eq(levelId)))]);
    const id = window.setInterval(collect, 2000);
    return () => {
      clearInterval(id);
      sub.unsubscribe();
    };
  }, [conn, heat, current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const players = useRows(c => c.db.player, 400).filter(p => p.roomId === roomId);
  const config = useRows(c => c.db.config, 250)[0];
  const awards = useRows(c => c.db.award, 250);
  const commentary = useRows(c => c.db.commentary, 250).filter(c => c.roomId === roomId);
  const events = useRows(c => c.db.eventLog, 500);
  const now = usePoll(serverNowMs, 200);
  const chaos = usePoll(() => (roomId === null ? 0 : (conn?.db.cursor.id.find(roomId)?.chaos ?? 0)), 150);
  const cursorPos = usePoll(() => {
    const c = roomId === null ? undefined : conn?.db.cursor.id.find(roomId);
    return c ? { x: c.x, y: c.y } : undefined;
  }, 200);
  const stats = usePoll(() => ({ ...(statsRef.current ?? { pointerPerSec: 0, votesPerSec: 0, ticksPerSec: 0, fps: 0 }) }), 1000);

  const online = players.filter(p => p.connected);
  // "Active" = connected AND their pointer moved recently. Sleeping/backgrounded
  // phones stay connected but go quiet; the server GCs their pointer after 10 s.
  const activeIds = usePoll(() => {
    const ids = new Set<string>();
    const cutoff = serverNowMs() - 10000;
    for (const p of conn?.db.pointer.iter() ?? []) if (Number(p.updatedAt.microsSinceUnixEpoch / 1000n) > cutoff) ids.add(p.identity.toHexString());
    return ids;
  }, 1000);
  // Give the pointer subscription a few seconds before calling anyone quiet
  // (and the room subscription a few seconds before calling the code unknown).
  const [warm, setWarm] = useState(false);
  const waited = warm;
  useEffect(() => {
    const id = window.setTimeout(() => setWarm(true), 3000);
    return () => clearTimeout(id);
  }, []);
  const isQuiet = (p: { connected: boolean; identity: { toHexString(): string } }) => warm && p.connected && !activeIds.has(p.identity.toHexString());
  const playing = online.filter(p => !isQuiet(p)).length;
  const rankOf = (p: (typeof players)[number]) => (!p.connected ? 2 : isQuiet(p) ? 1 : 0);
  // Room leaderboard (score this round) of everyone online right now.
  const board = [...online].sort((a, b) => rankOf(a) - rankOf(b) || b.score - a.score);

  // Phase machine (all derived from server state + server clock), shared with the phones.
  const { meta, running, endedMs, inIntro, inResults, inLobby, countdown, timeLeft } = phaseOf(current, now);

  const lastCount = useRef(0);
  useEffect(() => {
    if (countdown !== lastCount.current) {
      if (countdown > 0) countdownBeep(false);
      else if (lastCount.current > 0) countdownBeep(true);
      lastCount.current = countdown;
    }
  }, [countdown]);

  const gm = GAME_META[current && !inLobby ? current.kind : 'lobby'] ?? GAME_META.lobby;
  const latestLine = commentary.reduce<(typeof commentary)[number] | null>((a, b) => (!a || b.id > a.id ? b : a), null);
  const showLine = latestLine && now - Number(latestLine.at.microsSinceUnixEpoch / 1000n) < 14000;
  const [ruleTitle, ruleSub] = RULE_LABEL[config?.rule ?? 'mean'] ?? [config?.rule ?? '', ''];
  const clock = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const shortUrl = joinUrl.replace(/^https?:\/\//, '');

  if (!room) {
    // Unknown code (or still loading): say so instead of drawing an empty desk.
    return (
      <div className="phone-center">
        <Win title="DISPLAY.EXE" color="#ff5a36" className="join-win dialog">
          <p>{status !== 'connected' ? 'Dialing up the mob…' : waited ? `No room with code ${code}.` : `Looking for room ${code}…`}</p>
          <a className="btn" href={`${location.pathname}#/display`}>
            Open the shared lobby instead
          </a>
        </Win>
      </div>
    );
  }

  return (
    <div className="desk">
      <Win
        className="game-win"
        color={gm.color}
        icon={spriteUrl('cursor', '#ffffff')}
        title={inLobby ? `MOBOS 95 — LOBBY.EXE · ROOM ${code}` : `${gm.exe} — ${gm.title}`}
        right={
          !inLobby && (
            <>
              {running && current && <GameStatus level={current} now={now} cursor={cursorPos} />}
              {current?.kind !== 'vote' && <StagePips stage={meta.stage ?? 1} stages={meta.stages ?? STAGES} running={running} />}
              {timeLeft !== null && <span className={`timer ${timeLeft < 10 ? 'low' : ''}`}>{fmt(timeLeft)}</span>}
            </>
          )
        }
      >
        <canvas ref={canvasRef} className="game-canvas" />
        {inLobby && <Lobby qr={qr} url={shortUrl} code={code} players={online} quiet={isQuiet} />}
        {inIntro && current && <Intro kind={current.kind} stage={meta.stage ?? 1} count={countdown} rule={ruleTitle} />}
        {inResults && current && (
          <Results
            level={current}
            awards={awards.filter(a => a.levelId === current.id)}
            levelEnd={events.find(e => e.kind === 'level_end' && e.levelId === current.id)?.payload}
            board={board.filter(p => p.connected).slice(0, 5)}
            nextIn={config?.autoAdvance ? Math.max(0, Math.ceil((endedMs + 10000 - now) / 1000)) : null}
          />
        )}
        {showLine && latestLine && (
          <div className="mobby" key={latestLine.id.toString()}>
            <div className="bubble">{latestLine.text}</div>
            <img src={spriteUrl('cursor', '#ffd23f')} alt="" />
          </div>
        )}
        {hud && (
          <div className="hud">
            <div>CONN {status}</div>
            <div>ROOM {code} #{roomId}</div>
            <div>set_pointer/s {stats.pointerPerSec.toFixed(0)}</div>
            <div>tick/s {stats.ticksPerSec.toFixed(1)}</div>
            <div>≈ calls/s {(stats.pointerPerSec + stats.ticksPerSec).toFixed(0)}</div>
            <div>client Hz {room?.pointerHzEffective ?? '?'}</div>
            <div>fps {stats.fps.toFixed(0)}</div>
          </div>
        )}
      </Win>

      <aside className="side">
        <Win title="JOIN.EXE" color="#ff4fa3">
          <div className="join-body">
            {qr && <img className="qr" src={qr} alt="Join QR code" />}
            <div>
              <div className="big">SCAN TO JOIN THE MOB</div>
              <div className="room-code">
                ROOM <b>{code}</b>
              </div>
              <div className="url">{shortUrl}</div>
              <div className="chip" style={{ marginTop: 6 }}>
                {playing} playing{online.length > playing ? ` · ${online.length - playing} quiet` : ''}
              </div>
            </div>
          </div>
        </Win>
        <Win title="CHAOS.EXE" color="#ff5a36">
          <div className="rule-name">
            RULE: {ruleTitle} <span style={{ fontFamily: 'var(--pixel)', fontSize: 18 }}>· {ruleSub}</span>
          </div>
          <div className="meter">
            <i style={{ width: `${Math.round(chaos * 100)}%`, ['--fill' as string]: `hsl(${120 - chaos * 120} 85% 50%)` }} />
          </div>
          <div className="meter-label">
            <span>{Math.round(chaos * 100)}% disagreement</span>
            <b>{chaos > 0.8 ? 'ANARCHY' : chaos > 0.55 ? 'ARGUING' : chaos > 0.3 ? 'BICKERING' : 'HIVE MIND'}</b>
          </div>
        </Win>
        <Win title={`LEADERBOARD · ${online.length}`} color="#ffd23f" className="scores">
          <ol className="board">
            {board.map((p, i) => (
              <li key={p.identity.toHexString()} className={`${i === 0 && p.score > 0 ? 'top1' : ''} ${p.connected ? (isQuiet(p) ? 'quiet' : '') : 'off'}`} title={isQuiet(p) ? 'quiet: no input lately' : undefined}>
                <span className="rank">{i + 1}</span>
                <span className="swatch" style={{ background: p.color }} />
                <span className="name">
                  {p.name}
                  {isQuiet(p) && <em className="zzz"> zzz</em>}
                </span>
                <b>{p.score}</b>
              </li>
            ))}
            {board.length === 0 && <li>nobody online yet…</li>}
          </ol>
        </Win>
      </aside>

      <footer className="taskbar">
        <span className="btn start-btn">
          <img src={spriteUrl('cursor', '#ffffff')} alt="" /> MOB
        </span>
        <span className="chip" style={{ background: gm.color }}>
          {inLobby ? 'LOBBY' : gm.exe}
        </span>
        <span className="chip">{ruleTitle}</span>
        <span className="chip">ROOM {code}</span>
        <div className="tray">
          <button onClick={() => setLines(l => !l)} className={lines ? 'on' : ''}>
            LINES
          </button>
          <button onClick={() => setHeat(h => !h)} className={heat ? 'on' : ''}>
            HEAT
          </button>
          <button onClick={() => setHud(h => !h)} className={hud ? 'on' : ''}>
            HUD
          </button>
          <button
            className={sound ? 'on' : ''}
            onClick={() => {
              if (sound) disableSound();
              else enableSound();
              setSound(!sound);
            }}
          >
            {sound ? 'SOUND ON' : 'SOUND OFF'}
          </button>
          <span className="clock">{clock}</span>
        </div>
      </footer>
    </div>
  );
}

type P = { identity: { toHexString(): string }; name: string; color: string; connected: boolean };
function Lobby({ qr, url, code, players, quiet }: { qr: string; url: string; code: string; players: P[]; quiet: (p: P) => boolean }) {
  return (
    <div className="lobby">
      <Win title="JOIN.EXE" color="#ff4fa3" className="lobby-qr dialog">
        {qr && <img className="qr" src={qr} alt="Join QR code" />}
        <div className="room-code big">
          ROOM <b>{code}</b>
        </div>
        <div className="url">{url}</div>
      </Win>
      <div>
        <div className="logo">
          <img src={spriteUrl('cursor', '#ffffff')} alt="" />
          <span>
            MOB
            <br />
            <span className="c2">CURSOR</span>
          </span>
        </div>
        <div className="tagline">One cursor. Everybody drives. Nobody agrees.</div>
        <div className="icons">
          {players.map((p, i) => (
            <div className={`icon ${quiet(p) ? 'quiet' : ''}`} key={p.identity.toHexString()} style={{ animationDelay: `${(i % 12) * 40}ms` }} title={quiet(p) ? 'quiet: no input lately' : undefined}>
              <img src={spriteUrl('cursor', p.color)} alt="" />
              <span>{p.name}</span>
            </div>
          ))}
        </div>
        <div className="waiting">{players.length ? `${players.length} PLAYER${players.length > 1 ? 'S' : ''} READY — WAITING FOR HOST…` : 'WAITING FOR PLAYERS…'}</div>
      </div>
    </div>
  );
}
