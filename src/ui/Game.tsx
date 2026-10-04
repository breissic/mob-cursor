import { useMemo } from 'react';
import { GAME_META } from '../game/draw';
import { spriteUrl } from '../game/sprites';
import { Win } from './Win';
import { dollS, isPlayKind, STAGES, valveInZone, valveLevelsNow, VOTE_SECS, voteHover } from '../../spacetimedb/src/sim';

// Game chrome shared by the projector and every phone: status chips (with a
// visible indicator for every time-based thing), the intro loading screen, the
// results moment and stage pips. Everything here is derived from the level row
// plus the server clock; nothing is simulated client-side.

export const RULE_LABEL: Record<string, [string, string]> = {
  mean: ['DEMOCRACY', 'average of everyone'],
  median: ['TROLL-PROOF', 'geometric median'],
  activity: ['LOUDEST WINS', 'wiggle harder = more pull'],
  tug: ['TUG OF WAR', 'red team vs blue team'],
  dictator: ['DICTATORSHIP', 'one random ruler every few secs'],
};

export type LevelRow = {
  id: bigint;
  kind: string;
  state: string;
  params: string;
  progress: string;
  score: number;
  endedAt?: { microsSinceUnixEpoch: bigint } | null;
  deadline: { microsSinceUnixEpoch: bigint };
};

export const metaOf = (l: LevelRow) => JSON.parse(l.params) as { stage?: number; stages?: number; playAt?: number };

/** Mirrors the server's nextUp: a won stage leads to the next stage; a lost run or a finished game opens the picker. */
export function nextUp(l: LevelRow) {
  const stage = metaOf(l).stage ?? 1;
  if (l.state !== 'lost' && stage < STAGES && isPlayKind(l.kind)) return { kind: l.kind, stage: stage + 1 };
  return { kind: 'vote', stage: 0 };
}

export const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** How long the results dialog stays up after a level ends (server auto-advances at 10 s). */
export const RESULTS_HOLD_MS = 25000;

/** Phase machine: all derived from server state + the server clock. Same on projector and phone. */
export function phaseOf(current: LevelRow | null | undefined, now: number) {
  const meta = current ? metaOf(current) : {};
  const running = current?.state === 'running';
  const endedMs = current?.endedAt ? Number(current.endedAt.microsSinceUnixEpoch / 1000n) : 0;
  const inIntro = running && now < (meta.playAt ?? 0);
  const ended = !!current && !running && current.state !== 'skipped' && now - endedMs < RESULTS_HOLD_MS;
  // Hold the results dialog for 1.5 s so everyone sees the win/explosion on the board first.
  const inResults = ended && now - endedMs > 1500;
  const inLobby = !current || (!running && !ended);
  const countdown = inIntro ? Math.ceil(((meta.playAt ?? 0) - now) / 1000) : 0;
  const timeLeft = running && !inIntro && current ? Math.max(0, Number(current.deadline.microsSinceUnixEpoch / 1000n) - now) / 1000 : null;
  return { meta, running, endedMs, inIntro, ended, inResults, inLobby, countdown, timeLeft };
}

const Hearts = ({ total, left }: { total: number; left: number }) => (
  <>
    {Array.from({ length: Math.max(0, total) }, (_, i) => (
      <img key={i} src={spriteUrl(i < left ? 'heart' : 'skull')} alt="" style={{ height: 16 }} />
    ))}
  </>
);

const secs = (ms: number) => Math.max(0, Math.ceil(ms / 1000));

/**
 * Per-game status chips. Every time-based thing the server tracks has a visible
 * number here: light flips, potato fuse, minesweeper fuse, chair stop warning,
 * dwell progress and hold timers.
 */
export function GameStatus({ level, now, cursor }: { level: LevelRow; now: number; cursor?: { x: number; y: number } }) {
  const p = JSON.parse(level.params);
  const prog = JSON.parse(level.progress);
  const playAt = (p.playAt as number | undefined) ?? 0;
  if (now < playAt) return null;
  switch (level.kind) {
    case 'targets':
      return (
        <>
          <span className="chip">
            <img src={spriteUrl('star')} alt="" style={{ height: 16 }} /> {prog.next}/{p.targets.length}
          </span>
          <span className="chip" style={{ background: prog.strikes >= p.strikeCap - 1 ? '#ff3b3b' : '#fff', color: prog.strikes >= p.strikeCap - 1 ? '#fff' : '#111' }}>
            STRIKES {prog.strikes}/{p.strikeCap}
          </span>
        </>
      );
    case 'maze':
      return (
        <span className="chip" style={{ background: prog.hits >= p.bonkCap - 1 ? '#ff3b3b' : '#fff', color: prog.hits >= p.bonkCap - 1 ? '#fff' : '#111' }}>
          BONKS {prog.hits}/{p.bonkCap}
        </span>
      );
    case 'vote': {
      // The client only names the card the cursor is inside; the server decides.
      const pick = cursor ? voteHover(p.cards, cursor.x, cursor.y) : null;
      return pick ? (
        <span className="chip" style={{ background: GAME_META[pick.kind]?.color }}>PICK: {GAME_META[pick.kind]?.exe}</span>
      ) : (
        <span className="chip" style={{ background: '#ff5a36' }}>NO PICK</span>
      );
    }
    case 'redlight': {
      const red = prog.light === 'red';
      const walked = p.length > 0 ? Math.round((dollS(p, prog, now) / p.length) * 100) : 0;
      return (
        <>
          <span className="chip" style={{ background: red ? '#ff3b3b' : '#43e05a', color: red ? '#fff' : '#111' }}>
            {red ? `RED · GREEN IN ${secs(prog.flipAt - now)}` : 'GREEN · GO!'}
          </span>
          <span className="chip">DOLL {walked}%</span>
          <span className="chip" style={{ background: prog.faults >= p.faultCap - 1 ? '#ff3b3b' : '#fff' }}>
            FAULTS {prog.faults}/{p.faultCap}
          </span>
        </>
      );
    }
    case 'balloon':
      return (
        <span className="chip">
          <Hearts total={p.dropCap} left={p.dropCap - prog.drops} /> · SAVES {prog.saves}/{p.saveTarget}
        </span>
      );
    case 'mole':
      return (
        <>
          <span className="chip">
            <img src={spriteUrl('star')} alt="" style={{ height: 16 }} /> {prog.score}/{p.target}
          </span>
          <span className="chip">MISSES {prog.misses}/{p.missCap}</span>
        </>
      );
    case 'potato': {
      const fuse = Math.max(0, (prog.fuseAt - now) / 1000);
      return (
        <>
          <span className="chip">DELIVERY {Math.min(prog.round + 1, p.rounds)}/{p.rounds}</span>
          <span className="chip" style={{ background: fuse < 3 ? '#ff3b3b' : '#fff' }}>
            <img src={spriteUrl('bomb')} alt="" style={{ height: 16 }} /> FUSE {Math.ceil(fuse)}s
          </span>
        </>
      );
    }
    case 'chairs': {
      const safe = now < prog.safeUntil;
      const toStop = (prog.stopAt - now) / 1000;
      const warn = !safe && toStop <= p.warnS;
      return (
        <>
          <span className="chip">
            {prog.left.length} CHAIR{prog.left.length === 1 ? '' : 'S'} · ROUND {prog.round}
          </span>
          <span className="chip" style={{ background: warn ? '#ff3b3b' : safe ? '#43e05a' : '#fff', color: warn ? '#fff' : '#111' }}>
            {safe ? `SAFE · NEXT IN ${secs(prog.safeUntil - now)}` : warn ? `STOP IN ${Math.max(0, toStop).toFixed(1)}` : '♪ MUSIC PLAYING'}
          </span>
        </>
      );
    }
    case 'keyboard':
      return (
        <>
          <span className="chip" style={{ fontFamily: 'var(--pixel)', letterSpacing: 2 }}>
            {String(p.word).slice(0, prog.next)}
            <span style={{ opacity: 0.4 }}>{String(p.word).slice(prog.next)}</span>
          </span>
          <span className="chip" style={{ background: prog.buzzes >= p.typoCap - 1 ? '#ff3b3b' : '#fff', color: prog.buzzes >= p.typoCap - 1 ? '#fff' : '#111' }}>
            TYPOS {prog.buzzes}/{p.typoCap}
          </span>
        </>
      );
    case 'minesweeper': {
      const fuse = prog.nextAutoAt ? Math.max(0, (prog.nextAutoAt - now) / 1000) : null;
      return (
        <>
          <span className="chip">
            <Hearts total={p.lives} left={prog.lives} />
          </span>
          <span className="chip" style={{ background: fuse !== null && fuse < 3 ? '#ff3b3b' : '#fff' }}>
            <img src={spriteUrl('bomb')} alt="" style={{ height: 16 }} /> {p.mines} · {prog.firstDone ? 'AUTO-CLICK' : 'SAFE CLICK'} {fuse !== null ? `${Math.ceil(fuse)}s` : '—'}
          </span>
        </>
      );
    }
    case 'hunt': {
      const word = prog.bars >= 9 ? 'BOILING' : prog.bars >= 7 ? 'HOT' : prog.bars >= 5 ? 'WARM' : prog.bars >= 3 ? 'COOL' : 'COLD';
      return (
        <>
          <span className="chip">FOUND {prog.found.length}/{p.finds}</span>
          <span className="chip" style={{ background: prog.bars >= 7 ? '#ff3b3b' : prog.bars >= 5 ? '#ffd23f' : '#4dabf7', color: prog.bars >= 7 ? '#fff' : '#111' }}>
            {word}
          </span>
          {prog.dwellSince > 0 && <span className="chip" style={{ background: '#ffd23f' }}>HOLD {secs(prog.dwellSince + p.dwellS * 1000 - now)}</span>}
          <span className="chip" style={{ background: prog.traps >= p.trapCap - 1 ? '#ff3b3b' : '#fff', color: prog.traps >= p.trapCap - 1 ? '#fff' : '#111' }}>
            TRAPS {prog.traps ?? 0}/{p.trapCap}
          </span>
        </>
      );
    }
    case 'valves': {
      const levels = valveLevelsNow(p, prog, now);
      const inZone = levels.filter(l => valveInZone(p, l)).length;
      return (
        <>
          <span className="chip">
            <Hearts total={p.blowCap} left={p.blowCap - prog.blowouts} />
          </span>
          <span className="chip">
            {inZone}/{levels.length} IN ZONE
          </span>
          {prog.allInSince > 0 && <span className="chip" style={{ background: '#43e05a' }}>HOLD {secs(prog.allInSince + p.holdS * 1000 - now)}</span>}
        </>
      );
    }
    case 'stations':
      return (
        <>
          <span className="chip">
            STOP {Math.min(prog.next + 1, p.stations.length)}/{p.stations.length}
          </span>
          {prog.since > 0 && <span className="chip" style={{ background: '#ffd23f' }}>STAY {secs(prog.since + p.dwellS * 1000 - now)}</span>}
          <span className="chip" style={{ background: prog.cancels >= p.skipCap - 1 ? '#ff3b3b' : '#fff', color: prog.cancels >= p.skipCap - 1 ? '#fff' : '#111' }}>
            LEFT EARLY {prog.cancels}/{p.skipCap}
          </span>
        </>
      );
  }
  return null;
}

/** One-line objective for the phone ("whose turn"/what to do right now). */
export function objectiveOf(level: LevelRow | null | undefined, now: number): string {
  if (!level || level.state !== 'running') return '';
  const p = JSON.parse(level.params);
  const prog = JSON.parse(level.progress);
  switch (level.kind) {
    case 'targets':
      return `Hit target ${prog.next + 1} of ${p.targets.length} — touch no other`;
    case 'maze':
      return `Reach the flag — ${p.bonkCap - prog.hits} bonk${p.bonkCap - prog.hits === 1 ? '' : 's'} left`;
    case 'vote':
      return 'Park the cursor on a card';
    case 'redlight':
      return prog.light === 'red' ? 'FREEZE — do not move' : 'Stay inside the doll’s ring';
    case 'balloon':
      return `Keep balloons up · ${p.saveTarget - prog.saves} saves to go`;
    case 'mole':
      return `Sit in the mole’s hole · ${p.target - prog.score} to go`;
    case 'potato':
      return 'Get into the bucket before the fuse';
    case 'chairs':
      return now < prog.safeUntil ? 'Safe! A chair is gone' : 'Sit when the music stops';
    case 'keyboard':
      return `Hold on "${String(p.word)[prog.next] ?? '…'}" — wrong keys are typos`;
    case 'minesweeper':
      return 'Park over a safe cell before the auto-click';
    case 'hunt':
      return prog.dwellSince > 0 ? 'Hold still!' : prog.trapSince > 0 ? 'WARM, not BOILING — it’s a trap, move!' : 'Follow the heat meter — only BOILING is real';
    case 'valves':
      return prog.allInSince > 0 ? 'Hold every gauge green' : 'Hold a valve to raise it';
    case 'stations':
      return prog.since > 0 ? 'Stay on the station — leaving early is a strike' : `Go to station ${Math.min(prog.next + 1, p.stations.length)}`;
  }
  return '';
}

export function StagePips({ stage, stages, running }: { stage: number; stages: number; running: boolean }) {
  return (
    <span className="stage-pips" title={`Stage ${stage} of ${stages}`}>
      {Array.from({ length: stages }, (_, i) => (
        <b key={i} className={i + 1 < stage || (!running && i + 1 === stage) ? 'done' : i + 1 === stage ? 'now' : ''} />
      ))}
    </span>
  );
}

export function Intro({ kind, stage, count, rule, compact = false }: { kind: string; stage: number; count: number; rule: string; compact?: boolean }) {
  const gm = GAME_META[kind] ?? GAME_META.lobby;
  return (
    <div className="overlay">
      <Win title={`${gm.exe} — loading…`} color={gm.color} className={`dialog intro ${compact ? 'compact' : ''}`}>
        <div className="exe">{gm.title}</div>
        <div className="stage">{kind === 'vote' ? `${VOTE_SECS} SECONDS TO DECIDE` : `STAGE ${stage} / ${STAGES}`}</div>
        <div className="goal">{gm.goal}</div>
        <span className="chip rule">CONTROL: {rule}</span>
        <div className="count" key={count}>
          {count > 0 ? count : 'GO!'}
        </div>
      </Win>
    </div>
  );
}

export function Results(props: {
  level: LevelRow;
  awards: { id: bigint; title: string; name: string; detail: string }[];
  levelEnd?: string;
  board: { identity: { toHexString(): string }; name: string; color: string; score: number }[];
  nextIn: number | null;
  compact?: boolean;
}) {
  const { level } = props;
  const gm = GAME_META[level.kind] ?? GAME_META.lobby;
  const meta = metaOf(level);
  const info = useMemo(() => (props.levelEnd ? (JSON.parse(props.levelEnd) as { seconds?: number; coop?: number }) : {}), [props.levelEnd]);
  const won = level.state === 'won';
  const nxt = nextUp(level);
  const awardIcon = (t: string) => spriteUrl(t.includes('Troll') ? 'skull' : t.includes('MVP') ? 'crown' : t.includes('Disagree') ? 'bomb' : 'trophy');
  return (
    <div className="overlay">
      <Win title={`RESULTS.TXT — ${gm.exe} stage ${meta.stage ?? 1}`} color={won ? '#ffd23f' : '#ff5a36'} className={`dialog results ${props.compact ? 'compact' : ''}`}>
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
            NEXT: {nxt.kind === 'vote' ? 'PICK THE NEXT GAME' : `${GAME_META[nxt.kind]?.exe} STAGE ${nxt.stage}`} {props.nextIn > 0 ? `IN ${props.nextIn}…` : 'LOADING…'}
          </div>
        )}
      </Win>
    </div>
  );
}
