import { useEffect, useState } from 'react';
import { tables } from '../module_bindings';
import { useConnState, useRows } from '../lib/stdb';
import { useSubscribe } from '../lib/room';
import { displayUrl, playUrl, roomCodeFromUrl } from '../config';
import { GAME_META } from '../game/draw';
import { spriteUrl } from '../game/sprites';
import { Win } from '../ui/Win';
import { RULE_LABEL } from '../ui/Game';
import {
  dampingMax,
  DEFAULT_ROOM_CODE,
  DEFAULT_ROOM_ID,
  gainMax,
  LEVEL_ROTATION,
  MAX_PLAYERS_CEILING,
  MAX_ROOMS_CEILING,
  MODE_SETTINGS,
  settingsFor,
  STAGES,
  stageSpec,
  type ModeSettings,
  type PlayKind,
} from '../../spacetimedb/src/sim';

// UI only. Every admin reducer re-checks the caller's identity server-side;
// this route being reachable grants nothing. Global admins see every room and
// the global knobs; a room's host sees only the room controls for their rooms.

const RULES = ['mean', 'median', 'activity', 'tug', 'dictator'];
/** Server-side ceiling on gain (admin_set_config NUMERIC_KEYS). */
const GAIN_CEILING = 40;

type KnobDef = { key: string; label: string; hint?: string; min: number; max: number; step: number };

/** Global config sliders. The spring's range depends on the tick rate: outside it the integrator stops reading as "heavier". */
const knobsFor = (tickHz: number): KnobDef[] => [
  { key: 'pointerHz', label: 'Max pointer Hz / client', min: 1, max: 30, step: 1 },
  { key: 'pointerBudget', label: 'Pointer calls/s budget — per room', hint: 'each room gets min(pointer Hz, budget / its players)', min: 10, max: 2000, step: 10 },
  { key: 'tickHz', label: 'Tick Hz', hint: 'also moves the damping and gain ceilings below', min: 5, max: 30, step: 1 },
  { key: 'gain', label: 'Gain (spring pull)', hint: `raise = snaps to the crowd faster · max ${Math.min(GAIN_CEILING, gainMax(tickHz))} at ${tickHz} Hz`, min: 0.5, max: Math.min(GAIN_CEILING, gainMax(tickHz)), step: 0.5 },
  {
    key: 'damping',
    label: 'Damping (weight)',
    hint: `raise = heavier, less bouncy · lower = looser, more overshoot · 0–${dampingMax(tickHz)} is the stable range at ${tickHz} Hz`,
    min: 0,
    max: dampingMax(tickHz),
    step: 0.5,
  },
  { key: 'maxSpeed', label: 'Max speed', min: 0.5, max: 30, step: 0.5 },
  { key: 'influenceCap', label: 'Influence cap', hint: 'max share of the pull one player can have', min: 0.01, max: 1, step: 0.01 },
  { key: 'dictatorSecs', label: 'Dictator seconds', min: 1, max: 60, step: 1 },
  { key: 'maxPlayers', label: 'Max players per room', min: 1, max: MAX_PLAYERS_CEILING, step: 1 },
  { key: 'maxRooms', label: 'Max rooms at once', min: 1, max: MAX_ROOMS_CEILING, step: 1 },
];

export default function Admin() {
  const { conn, status, identity } = useConnState();
  const [pass, setPass] = useState('');
  const [msg, setMsg] = useState('');
  const [pickedId, setPickedId] = useState<number | null>(null);

  // Global rows: am I an admin, config, saved mode settings, and EVERY room (the picker).
  useSubscribe(() => [tables.amIAdmin, tables.config, tables.modeSettings, tables.room], []);
  const isAdmin = useRows(c => c.db.amIAdmin, 100).length > 0;
  const config = useRows(c => c.db.config, 100)[0];
  const modeSaved = useRows(c => c.db.modeSettings, 200);
  const rooms = [...useRows(c => c.db.room, 300)].sort((a, b) => a.id - b.id);
  const idHex = identity?.toHexString();
  const hostRooms = rooms.filter(r => idHex && r.host.toHexString() === idHex);
  const allowed = isAdmin || hostRooms.length > 0;
  const pickable = isAdmin ? rooms : hostRooms;

  // Selected room: ?room= from the URL when it exists, else the first room we may run.
  const urlCode = roomCodeFromUrl();
  const room =
    pickable.find(r => r.id === pickedId) ??
    pickable.find(r => r.code === urlCode) ??
    pickable.find(r => r.id === DEFAULT_ROOM_ID) ??
    pickable[0];
  const roomId = room?.id ?? null;

  // Per-room rows for the selected room only.
  useSubscribe(
    () => (roomId === null ? null : [tables.player.where(r => r.roomId.eq(roomId)), tables.level.where(r => r.roomId.eq(roomId)), tables.cursor.where(r => r.id.eq(roomId))]),
    [roomId]
  );
  const players = useRows(c => c.db.player, 300).filter(p => p.roomId === roomId);
  const levels = useRows(c => c.db.level, 300);
  const current = room && room.levelId ? (levels.find(l => l.id === room.levelId) ?? null) : null;
  const curStage = current ? ((JSON.parse(current.params) as { stage?: number }).stage ?? 1) : 0;

  const run = async (label: string, p: Promise<void> | undefined) => {
    try {
      await p;
      setMsg(`✓ ${label}`);
    } catch (e) {
      setMsg(`✗ ${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (!conn || status !== 'connected')
    return (
      <div className="admin">
        <Win title="CONTROL.EXE">Connecting…</Win>
      </div>
    );

  if (!allowed) {
    return (
      <div className="phone-center">
        <Win title="CONTROL.EXE — Access denied" color="#ff5a36" icon={spriteUrl('skull')} className="join-win dialog">
          <p>This identity isn't an admin and hosts no room. Enter the passphrase the database owner set with admin_set_passphrase, or create a room from REMOTE.EXE to host it.</p>
          <form
            className="name-row"
            onSubmit={e => {
              e.preventDefault();
              void run('claim', conn.reducers.adminClaim({ passphrase: pass }));
            }}
          >
            <input type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder="passphrase" />
            <button className="go">UNLOCK</button>
          </form>
          <p className="msg">{msg}</p>
          <small>identity {identity?.toHexString().slice(0, 16)}…</small>
        </Win>
      </div>
    );
  }

  const online = players.filter(p => p.connected).length;
  const tickHz = config?.tickHz ?? 15;
  return (
    <div className="admin">
      <div className="logo" style={{ fontSize: 48 }}>
        <img src={spriteUrl('cursor', '#ffffff')} alt="" />
        <span>
          CONTROL <span className="c2">PANEL</span>
        </span>
      </div>
      <p className="msg" style={{ color: '#fff', textShadow: '2px 2px 0 #111' }}>
        {msg || `Room ${room?.code ?? '?'} · now: ${current ? `${GAME_META[current.kind]?.exe} stage ${curStage} (${current.state})` : 'lobby'} · ${online} online`}
      </p>

      <Win title={`ROOMS.EXE — ${isAdmin ? `${rooms.length} open` : 'rooms you host'}`} color="#ff4fa3">
        <div className="row">
          {pickable.map(r => (
            <button key={r.id} className={r.id === roomId ? 'on' : ''} onClick={() => setPickedId(r.id)} title={r.name}>
              {r.code === DEFAULT_ROOM_CODE ? '🏠 ' : ''}
              {r.code} · {r.players}
            </button>
          ))}
          {pickable.length === 0 && <span>no rooms yet</span>}
        </div>
        {room && (
          <p style={{ margin: '8px 0 0' }}>
            <b>{room.name}</b> · {room.players} playing · client pointer Hz <b>{room.pointerHzEffective}</b> ·{' '}
            <a href={displayUrl(room.code)} target="_blank" rel="noreferrer">
              projector
            </a>{' '}
            ·{' '}
            <a href={playUrl(room.code)} target="_blank" rel="noreferrer">
              phone link
            </a>
          </p>
        )}
      </Win>

      {room && (
        <Win title={`GAMES.EXE — start a stage in ${room.code}`} color="#2ec4b6">
          {LEVEL_ROTATION.map(k => (
            <div className="game-row" key={k}>
              <span className="exe" style={{ color: GAME_META[k].color, WebkitTextStroke: '1px #111' }}>
                {GAME_META[k].exe}
              </span>
              {Array.from({ length: STAGES }, (_, i) => (
                <button
                  key={i}
                  className={current?.kind === k && curStage === i + 1 && current.state === 'running' ? 'on' : ''}
                  onClick={() => void run(`${k} stage ${i + 1}`, conn.reducers.adminStartStage({ roomId: room.id, kind: k, stage: i + 1 }))}
                >
                  ▶ S{i + 1}
                </button>
              ))}
            </div>
          ))}
          <div className="row" style={{ marginTop: 10 }}>
            <button className="go" onClick={() => void run('next', conn.reducers.adminStartLevel({ roomId: room.id, kind: 'next' }))}>
              ⏭ NEXT STAGE
            </button>
            <button className="on" onClick={() => void run('picker', conn.reducers.adminStartLevel({ roomId: room.id, kind: 'vote' }))}>
              🃏 OPEN PICKER
            </button>
            <button onClick={() => void run('stop', conn.reducers.adminStopLevel({ roomId: room.id }))}>⏹ STOP → LOBBY</button>
            <button
              className="hot"
              onClick={() => {
                if (confirm(`Reset scores, levels and awards in room ${room.code}?`)) void run('reset', conn.reducers.adminResetRound({ roomId: room.id }));
              }}
            >
              RESET ROUND
            </button>
          </div>
          {isAdmin && (
            <>
              <label className="check">
                <input
                  type="checkbox"
                  checked={!!config?.autoAdvance}
                  onChange={e => void run('autoAdvance', conn.reducers.adminSetConfig({ key: 'autoAdvance', value: e.target.checked ? 1 : 0 }))}
                />
                auto-advance 10 s after each stage (all rooms)
              </label>
              <label className="check">
                <input type="checkbox" checked={!!config?.paused} onChange={e => void run('paused', conn.reducers.adminSetConfig({ key: 'paused', value: e.target.checked ? 1 : 0 }))} />
                pause the tick (freezes every cursor)
              </label>
            </>
          )}
        </Win>
      )}

      {isAdmin && (
        <Win title="RULES.EXE — who controls the cursor?" color="#ff5a36">
          <div className="row">
            {RULES.map(r => (
              <button key={r} className={config?.rule === r ? 'on' : ''} onClick={() => void run(`rule ${r}`, conn.reducers.adminSetRule({ rule: r }))}>
                {RULE_LABEL[r]?.[0] ?? r}
              </button>
            ))}
          </div>
          <p style={{ margin: '8px 0 0' }}>{RULE_LABEL[config?.rule ?? 'mean']?.[1]}</p>
        </Win>
      )}

      <div className="grid2">
        {isAdmin && (
          <Win title="TUNING.INI" color="#ffd23f">
            {config &&
              knobsFor(tickHz).map(k => (
                <Knob
                  key={k.key}
                  label={k.label}
                  hint={k.hint}
                  min={k.min}
                  max={k.max}
                  step={k.step}
                  value={(config as unknown as Record<string, number>)[k.key]}
                  onCommit={v => void run(k.key, conn.reducers.adminSetConfig({ key: k.key, value: v }))}
                />
              ))}
            <p>
              Effective client pointer Hz in room {room?.code ?? '?'}: <b>{room?.pointerHzEffective ?? '—'}</b>
            </p>
          </Win>
        )}
        <Win title={`USERS.EXE — ${room?.code ?? '?'} · ${online} online`} color="#3a86ff">
          <table>
            <tbody>
              {[...players]
                .sort((a, b) => Number(b.connected) - Number(a.connected) || b.score - a.score)
                .map(p => (
                  <tr key={p.identity.toHexString()} style={{ opacity: p.connected ? 1 : 0.45 }}>
                    <td>
                      <span className="swatch" style={{ background: p.color }} /> {p.name}
                      {room && p.identity.toHexString() === room.host.toHexString() ? ' 👑' : ''}
                    </td>
                    <td>{p.team === 0 ? 'red' : 'blue'}</td>
                    <td>{p.score}</td>
                    <td>
                      <button onClick={() => void run(`kick ${p.name}`, conn.reducers.adminKick({ who: p.identity }))}>KICK</button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Win>
      </div>

      {isAdmin && <ModesPanel saved={modeSaved} save={(kind, json) => run(`${kind} settings`, conn.reducers.adminSetModeSettings({ kind, json }))} />}
    </div>
  );
}

/** Stage-1 defaults per mode. Stages 2/3 are hardened server-side (stageSpec); shown here read-only. */
function ModesPanel({ saved, save }: { saved: { kind: string; json: string }[]; save: (kind: PlayKind, json: string) => Promise<void> }) {
  const [kind, setKind] = useState<PlayKind>('targets');
  const savedJson = saved.find(s => s.kind === kind)?.json ?? '';
  const base = settingsFor(kind, savedJson);
  const [draft, setDraft] = useState<ModeSettings>(base);
  useEffect(() => setDraft(settingsFor(kind, savedJson)), [kind, savedJson]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const defs = MODE_SETTINGS[kind];
  const preview = (stage: number) => {
    const sp = stageSpec(kind, stage, draft);
    return defs.map(d => `${d.key} ${sp[d.key]}`).join(' · ');
  };
  return (
    <Win title="MODES.INI — stage-1 settings per game" color="#7048e8">
      <div className="row">
        {LEVEL_ROTATION.map(k => (
          <button key={k} className={k === kind ? 'on' : ''} onClick={() => setKind(k)} style={{ borderColor: GAME_META[k].color }}>
            {GAME_META[k].exe}
            {saved.some(s => s.kind === k && s.json !== '{}') ? ' *' : ''}
          </button>
        ))}
      </div>
      <p style={{ margin: '8px 0 0' }}>{GAME_META[kind].goal}</p>
      <div className="grid2 modes">
        {defs.map(d => (
          <Knob key={`${kind}:${d.key}`} label={d.label} hint={`raise → ${d.up}`} min={d.min} max={d.max} step={d.step} value={draft[d.key] ?? d.def} onCommit={v => setDraft(s => ({ ...s, [d.key]: v }))} />
        ))}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="go" disabled={!dirty} onClick={() => void save(kind, JSON.stringify(draft))}>
          💾 SAVE {GAME_META[kind].exe}
        </button>
        <button disabled={!dirty} onClick={() => setDraft(base)}>
          UNDO
        </button>
        <button className="hot" onClick={() => void save(kind, '{}')}>
          RESET TO SHIPPED DEFAULTS
        </button>
      </div>
      <small className="stage-preview">
        <b>Stage 2</b> {preview(2)}
        <br />
        <b>Stage 3</b> {preview(3)}
      </small>
    </Win>
  );
}

function Knob(props: { label: string; hint?: string; min: number; max: number; step: number; value: number; onCommit: (v: number) => void }) {
  const [v, setV] = useState(props.value);
  useEffect(() => setV(props.value), [props.value]);
  const digits = props.step < 1 ? Math.min(3, Math.ceil(-Math.log10(props.step))) : 0;
  return (
    <label className="knob">
      <span>{props.label}</span>
      <b>{Number(v).toFixed(digits)}</b>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={Math.min(props.max, Math.max(props.min, v))}
        onChange={e => setV(Number(e.target.value))}
        onPointerUp={() => props.onCommit(v)}
        onKeyUp={() => props.onCommit(v)}
      />
      {props.hint && <small>{props.hint}</small>}
    </label>
  );
}
