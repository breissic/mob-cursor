import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { tables } from '../module_bindings';
import { useConnState, usePoll, useRows } from '../lib/stdb';
import { observeClock, serverNowMs } from '../lib/clock';
import { playUrl } from '../config';
import { startRenderer, type RenderStats } from '../display/render';
import { countdownBeep, disableSound, enableSound } from '../display/audio';
import { GAME_META } from '../game/draw';
import { spriteUrl } from '../game/sprites';
import { Win } from '../ui/Win';
import { LEVEL_ROTATION, STAGES } from '../../spacetimedb/src/sim';

export const RULE_LABEL: Record<string, [string, string]> = {
  mean: ['DEMOCRACY', 'average of everyone'],
  median: ['TROLL-PROOF', 'geometric median'],
  activity: ['LOUDEST WINS', 'wiggle harder = more pull'],
  tug: ['TUG OF WAR', 'red team vs blue team'],
  dictator: ['DICTATORSHIP', 'one random ruler every few secs'],
};

type LevelRow = { id: bigint; kind: string; state: string; params: string; progress: string; score: number; endedAt?: { microsSinceUnixEpoch: bigint } | null; deadline: { microsSinceUnixEpoch: bigint } };

const metaOf = (l: LevelRow) => JSON.parse(l.params) as { stage?: number; stages?: number; playAt?: number };

function nextUp(l: LevelRow) {
  const stage = metaOf(l).stage ?? 1;
  if (stage < STAGES) return { kind: l.kind, stage: stage + 1 };
  const i = LEVEL_ROTATION.indexOf(l.kind as (typeof LEVEL_ROTATION)[number]);
  return { kind: LEVEL_ROTATION[(i + 1) % LEVEL_ROTATION.length], stage: 1 };
}

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

  // Display subscribes to everything it draws (but not the private tables).
  useEffect(() => {
    if (!conn || status !== 'connected') return;
    observeClock(conn);
    const sub = conn
      .subscriptionBuilder()
      .subscribe([
        tables.cursor,
        tables.pointer,
        tables.player,
        tables.level,
        tables.config,
        tables.award,
        tables.commentary,
        tables.fx,
        tables.eventLog.where(r => r.kind.ne('sample')),
      ]);
    return () => sub.unsubscribe();
  }, [conn, status]);

  useEffect(() => {
    if (!conn || !canvasRef.current) return;
    const r = startRenderer(canvasRef.current, conn, { showLines: () => linesRef.current, heatmap: () => heatRef.current });
    statsRef.current = r.stats;
    return () => r.stop();
  }, [conn]);

  useEffect(() => {
    void QRCode.toDataURL(playUrl(), { margin: 1, width: 600, color: { dark: '#111111', light: '#ffffff' } }).then(setQr);
  }, []);

  const levels = useRows(c => c.db.level, 200) as LevelRow[];
  const current = levels.reduce<LevelRow | null>((a, b) => (!a || b.id > a.id ? b : a), null);

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

  const players = useRows(c => c.db.player, 400);
  const config = useRows(c => c.db.config, 250)[0];
  const awards = useRows(c => c.db.award, 250);
  const commentary = useRows(c => c.db.commentary, 250);
  const events = useRows(c => c.db.eventLog, 500);
  const now = usePoll(serverNowMs, 200);
  const chaos = usePoll(() => conn?.db.cursor.id.find(0)?.chaos ?? 0, 150);
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
  const isQuiet = (p: { connected: boolean; identity: { toHexString(): string } }) => p.connected && !activeIds.has(p.identity.toHexString());
  const playing = online.filter(p => !isQuiet(p)).length;
  const rankOf = (p: (typeof players)[number]) => (!p.connected ? 2 : isQuiet(p) ? 1 : 0);
  const board = [...players].sort((a, b) => rankOf(a) - rankOf(b) || b.score - a.score).slice(0, 10);

  // Phase machine (all derived from server state + server clock).
  const meta = current ? metaOf(current) : {};
  const running = current?.state === 'running';
  const endedMs = current?.endedAt ? Number(current.endedAt.microsSinceUnixEpoch / 1000n) : 0;
  const inIntro = running && now < (meta.playAt ?? 0);
  const inResults = !!current && !running && current.state !== 'skipped' && now - endedMs < 25000;
  const inLobby = !current || (!running && !inResults);
  const countdown = inIntro ? Math.ceil(((meta.playAt ?? 0) - now) / 1000) : 0;
  const timeLeft = running && !inIntro ? Math.max(0, Number(current!.deadline.microsSinceUnixEpoch / 1000n) - now) / 1000 : null;

  const lastCount = useRef(0);
  useEffect(() => {
    if (countdown !== lastCount.current) {
      if (countdown > 0) countdownBeep(false);
      else if (lastCount.current > 0) countdownBeep(true);
      lastCount.current = countdown;
    }
  }, [countdown]);

  const gm = GAME_META[running || inResults ? current!.kind : 'lobby'] ?? GAME_META.lobby;
  const latestLine = commentary.reduce<(typeof commentary)[number] | null>((a, b) => (!a || b.id > a.id ? b : a), null);
  const showLine = latestLine && now - Number(latestLine.at.microsSinceUnixEpoch / 1000n) < 14000;
  const [ruleTitle, ruleSub] = RULE_LABEL[config?.rule ?? 'mean'] ?? [config?.rule ?? '', ''];
  const clock = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="desk">
      <Win
        className="game-win"
        color={gm.color}
        icon={spriteUrl('cursor', '#ffffff')}
        title={inLobby ? 'MOBOS 95 — LOBBY.EXE' : `${gm.exe} — ${gm.title}`}
        right={
          !inLobby && (
            <>
              {running && current && <GameStatus level={current} now={now} />}
              <StagePips stage={meta.stage ?? 1} stages={meta.stages ?? STAGES} running={running} />
              {timeLeft !== null && <span className={`timer ${timeLeft < 10 ? 'low' : ''}`}>{fmt(timeLeft)}</span>}
            </>
          )
        }
      >
        <canvas ref={canvasRef} className="game-canvas" />
        {inLobby && <Lobby qr={qr} players={online} quiet={isQuiet} />}
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
            <div>set_pointer/s {stats.pointerPerSec.toFixed(0)}</div>
            <div>click/s {stats.votesPerSec.toFixed(1)}</div>
            <div>tick/s {stats.ticksPerSec.toFixed(1)}</div>
            <div>≈ calls/s {(stats.pointerPerSec + stats.votesPerSec + stats.ticksPerSec).toFixed(0)}</div>
            <div>client Hz {config?.pointerHzEffective ?? '?'}</div>
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
              <div className="url">{playUrl().replace(/^https?:\/\//, '')}</div>
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
        <Win title="SCORES.TXT" color="#ffd23f" className="scores">
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
            {board.length === 0 && <li>nobody yet…</li>}
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

/** Per-game status chips in the title bar: targets hit, bonks, lives + auto-click fuse. */
function GameStatus({ level, now }: { level: LevelRow; now: number }) {
  const p = JSON.parse(level.params);
  const prog = JSON.parse(level.progress);
  if (level.kind === 'targets')
    return (
      <span className="chip">
        <img src={spriteUrl('star')} alt="" style={{ height: 16 }} /> {prog.next}/{p.targets.length}
      </span>
    );
  if (level.kind === 'maze') return <span className="chip">BONKS {prog.hits}</span>;
  if (level.kind === 'minesweeper') {
    const fuse = prog.nextAutoAt ? Math.max(0, (prog.nextAutoAt - now) / 1000) : null;
    return (
      <>
        <span className="chip">
          {Array.from({ length: p.lives }, (_, i) => (
            <img key={i} src={spriteUrl(i < prog.lives ? 'heart' : 'skull')} alt="" style={{ height: 16 }} />
          ))}
        </span>
        <span className="chip" style={{ background: fuse !== null && fuse < 5 ? '#ff3b3b' : '#fff' }}>
          <img src={spriteUrl('bomb')} alt="" style={{ height: 16 }} /> {p.mines} · AUTO-CLICK {fuse !== null && fuse < 5 ? `${Math.ceil(fuse)}s!` : '???'}
        </span>
      </>
    );
  }
  return null;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function StagePips({ stage, stages, running }: { stage: number; stages: number; running: boolean }) {
  return (
    <span className="stage-pips" title={`Stage ${stage} of ${stages}`}>
      {Array.from({ length: stages }, (_, i) => (
        <b key={i} className={i + 1 < stage || (!running && i + 1 === stage) ? 'done' : i + 1 === stage ? 'now' : ''} />
      ))}
    </span>
  );
}

type P = { identity: { toHexString(): string }; name: string; color: string; connected: boolean };
function Lobby({ qr, players, quiet }: { qr: string; players: P[]; quiet: (p: P) => boolean }) {
  return (
    <div className="lobby">
      <Win title="JOIN.EXE" color="#ff4fa3" className="lobby-qr dialog">
        {qr && <img className="qr" src={qr} alt="Join QR code" />}
        <div className="url">{playUrl().replace(/^https?:\/\//, '')}</div>
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

function Intro({ kind, stage, count, rule }: { kind: string; stage: number; count: number; rule: string }) {
  const gm = GAME_META[kind] ?? GAME_META.lobby;
  return (
    <div className="overlay">
      <Win title={`${gm.exe} — loading…`} color={gm.color} className="dialog intro">
        <div className="exe">{gm.title}</div>
        <div className="stage">
          STAGE {stage} / {STAGES}
        </div>
        <div className="goal">{gm.goal}</div>
        <span className="chip rule">CONTROL: {rule}</span>
        <div className="count" key={count}>
          {count > 0 ? count : 'GO!'}
        </div>
      </Win>
    </div>
  );
}

function Results(props: {
  level: LevelRow;
  awards: { id: bigint; title: string; name: string; detail: string }[];
  levelEnd?: string;
  board: { identity: { toHexString(): string }; name: string; color: string; score: number }[];
  nextIn: number | null;
}) {
  const { level } = props;
  const gm = GAME_META[level.kind] ?? GAME_META.lobby;
  const meta = metaOf(level);
  const info = useMemo(() => (props.levelEnd ? (JSON.parse(props.levelEnd) as { seconds?: number; coop?: number }) : {}), [props.levelEnd]);
  const won = level.state === 'won';
  const nxt = nextUp(level);
  const awardIcon = (t: string) => spriteUrl(t.includes('Troll') ? 'skull' : t.includes('MVP') ? 'crown' : t.includes('Goblin') ? 'star' : t.includes('Disagree') ? 'bomb' : 'trophy');
  return (
    <div className="overlay">
      <Win title={`RESULTS.TXT — ${gm.exe} stage ${meta.stage ?? 1}`} color={won ? '#ffd23f' : '#ff5a36'} className="dialog results">
        <div className={`verdict ${won ? 'won' : 'lost'}`}>{won ? 'STAGE CLEAR!' : 'FAILED!'}</div>
        <div className="sub">{won ? 'The mob actually agreed on something.' : 'Democracy has failed you.'}</div>
        <div className="cols">
          <div>
            <h4>THE NUMBERS</h4>
            <div className="stat-row">
              <span>Stage score</span>
              <b>{level.score}</b>
            </div>
            <div className="stat-row">
              <span>Time</span>
              <b>{info.seconds !== undefined ? `${info.seconds}s` : '—'}</b>
            </div>
            <div className="stat-row">
              <span>Cooperation</span>
              <b>{info.coop !== undefined ? `${info.coop}%` : '—'}</b>
            </div>
            <h4 style={{ marginTop: 12 }}>LEADERBOARD</h4>
            {props.board.map((p, i) => (
              <div className="stat-row" key={p.identity.toHexString()}>
                <span>
                  {i + 1}. <span className="swatch" style={{ background: p.color }} /> {p.name}
                </span>
                <b>{p.score}</b>
              </div>
            ))}
          </div>
          <div>
            <h4>AWARDS</h4>
            {props.awards.length === 0 && <div>No awards. Nobody tried hard enough.</div>}
            {props.awards.map((a, i) => (
              <div className="award" key={a.id.toString()} style={{ animationDelay: `${300 + i * 250}ms` }}>
                <img src={awardIcon(a.title)} alt="" />
                <div>
                  <div className="t">{a.title}</div>
                  <div className="n">{a.name}</div>
                  <small>{a.detail}</small>
                </div>
              </div>
            ))}
          </div>
        </div>
        {props.nextIn !== null && (
          <div className="next-up">
            NEXT: {GAME_META[nxt.kind]?.exe} STAGE {nxt.stage} {props.nextIn > 0 ? `IN ${props.nextIn}…` : 'LOADING…'}
          </div>
        )}
      </Win>
    </div>
  );
}
