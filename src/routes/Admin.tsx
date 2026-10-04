import { useEffect, useState } from 'react';
import { tables } from '../module_bindings';
import { useConnState, useRows } from '../lib/stdb';
import { GAME_META } from '../game/draw';
import { spriteUrl } from '../game/sprites';
import { Win } from '../ui/Win';
import { LEVEL_ROTATION, STAGES } from '../../spacetimedb/src/sim';
import { RULE_LABEL } from './Display';

// UI only. Every admin reducer re-checks the caller's identity server-side;
// this route being reachable grants nothing.

const RULES = ['mean', 'median', 'activity', 'tug', 'dictator'];
const KNOBS: { key: string; label: string; min: number; max: number; step: number }[] = [
  { key: 'pointerHz', label: 'Max pointer Hz / client', min: 1, max: 30, step: 1 },
  { key: 'pointerBudget', label: 'Total pointer calls/s budget', min: 10, max: 2000, step: 10 },
  { key: 'tickHz', label: 'Tick Hz', min: 5, max: 30, step: 1 },
  { key: 'gain', label: 'Gain (spring)', min: 0.5, max: 40, step: 0.5 },
  { key: 'damping', label: 'Damping', min: 0, max: 30, step: 0.5 },
  { key: 'maxSpeed', label: 'Max speed', min: 0.5, max: 30, step: 0.5 },
  { key: 'influenceCap', label: 'Influence cap', min: 0.01, max: 1, step: 0.01 },
  { key: 'quorumFrac', label: 'Click quorum fraction', min: 0, max: 1, step: 0.05 },
  { key: 'quorumMin', label: 'Click quorum min', min: 1, max: 50, step: 1 },
  { key: 'quorumRadius', label: 'Quorum radius', min: 0.1, max: 10, step: 0.1 },
  { key: 'quorumWindowMs', label: 'Quorum window ms', min: 100, max: 10000, step: 100 },
  { key: 'dictatorSecs', label: 'Dictator seconds', min: 1, max: 60, step: 1 },
  { key: 'maxPlayers', label: 'Max players', min: 1, max: 1000, step: 1 },
];

export default function Admin() {
  const { conn, status, identity } = useConnState();
  const [pass, setPass] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!conn || status !== 'connected') return;
    const sub = conn.subscriptionBuilder().subscribe([tables.amIAdmin, tables.config, tables.player, tables.level, tables.cursor]);
    return () => sub.unsubscribe();
  }, [conn, status]);

  const isAdmin = useRows(c => c.db.amIAdmin, 100).length > 0;
  const config = useRows(c => c.db.config, 100)[0];
  const players = useRows(c => c.db.player, 300);
  const levels = useRows(c => c.db.level, 300);
  const current = levels.reduce<(typeof levels)[number] | null>((a, b) => (!a || b.id > a.id ? b : a), null);
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

  if (!isAdmin) {
    return (
      <div className="phone-center">
        <Win title="CONTROL.EXE — Access denied" color="#ff5a36" icon={spriteUrl('skull')} className="join-win dialog">
          <p>This identity isn't an admin. Enter the passphrase the database owner set with admin_set_passphrase.</p>
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
  return (
    <div className="admin">
      <div className="logo" style={{ fontSize: 48 }}>
        <img src={spriteUrl('cursor', '#ffffff')} alt="" />
        <span>
          CONTROL <span className="c2">PANEL</span>
        </span>
      </div>
      <p className="msg" style={{ color: '#fff', textShadow: '2px 2px 0 #111' }}>
        {msg || `Now: ${current ? `${GAME_META[current.kind]?.exe} stage ${curStage} (${current.state})` : 'lobby'} · ${online} online`}
      </p>

      <Win title="GAMES.EXE — start a stage" color="#2ec4b6">
        {LEVEL_ROTATION.map(k => (
          <div className="game-row" key={k}>
            <span className="exe" style={{ color: GAME_META[k].color, WebkitTextStroke: '1px #111' }}>
              {GAME_META[k].exe}
            </span>
            {Array.from({ length: STAGES }, (_, i) => (
              <button
                key={i}
                className={current?.kind === k && curStage === i + 1 && current.state === 'running' ? 'on' : ''}
                onClick={() => void run(`${k} stage ${i + 1}`, conn.reducers.adminStartStage({ kind: k, stage: i + 1 }))}
              >
                ▶ S{i + 1}
              </button>
            ))}
          </div>
        ))}
        <div className="row" style={{ marginTop: 10 }}>
          <button className="go" onClick={() => void run('next', conn.reducers.adminStartLevel({ kind: 'next' }))}>
            ⏭ NEXT STAGE
          </button>
          <button className="on" onClick={() => void run('picker', conn.reducers.adminStartLevel({ kind: 'vote' }))}>
            🃏 OPEN PICKER
          </button>
          <button onClick={() => void run('stop', conn.reducers.adminStopLevel({}))}>⏹ STOP → LOBBY</button>
          <button
            className="hot"
            onClick={() => {
              if (confirm('Reset scores, levels and awards?')) void run('reset', conn.reducers.adminResetRound({}));
            }}
          >
            RESET ROUND
          </button>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={!!config?.autoAdvance}
            onChange={e => void run('autoAdvance', conn.reducers.adminSetConfig({ key: 'autoAdvance', value: e.target.checked ? 1 : 0 }))}
          />
          auto-advance 10 s after each stage
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={!!config?.paused}
            onChange={e => void run('paused', conn.reducers.adminSetConfig({ key: 'paused', value: e.target.checked ? 1 : 0 }))}
          />
          pause the tick (freezes the cursor)
        </label>
      </Win>

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

      <div className="grid2">
        <Win title="TUNING.INI" color="#ffd23f">
          {config &&
            KNOBS.map(k => (
              <Knob
                key={k.key}
                label={k.label}
                min={k.min}
                max={k.max}
                step={k.step}
                value={(config as unknown as Record<string, number>)[k.key]}
                onCommit={v => void run(k.key, conn.reducers.adminSetConfig({ key: k.key, value: v }))}
              />
            ))}
          <p>
            Effective client pointer Hz: <b>{config?.pointerHzEffective}</b>
          </p>
        </Win>
        <Win title={`USERS.EXE — ${online} online`} color="#3a86ff">
          <table>
            <tbody>
              {[...players]
                .sort((a, b) => Number(b.connected) - Number(a.connected) || b.score - a.score)
                .map(p => (
                  <tr key={p.identity.toHexString()} style={{ opacity: p.connected ? 1 : 0.45 }}>
                    <td>
                      <span className="swatch" style={{ background: p.color }} /> {p.name}
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
    </div>
  );
}

function Knob(props: { label: string; min: number; max: number; step: number; value: number; onCommit: (v: number) => void }) {
  const [v, setV] = useState(props.value);
  useEffect(() => setV(props.value), [props.value]);
  return (
    <label className="knob">
      <span>{props.label}</span>
      <b>{v}</b>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={v}
        onChange={e => setV(Number(e.target.value))}
        onPointerUp={() => props.onCommit(v)}
        onKeyUp={() => props.onCommit(v)}
      />
    </label>
  );
}
