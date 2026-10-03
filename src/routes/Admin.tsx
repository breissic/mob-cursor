import { useEffect, useState } from 'react';
import { tables } from '../module_bindings';
import { useConnState, useRows } from '../lib/stdb';

// UI only. Every admin reducer re-checks the caller's identity server-side;
// this route being reachable grants nothing.

const RULES = ['mean', 'median', 'activity', 'tug', 'dictator'];
const LEVELS = ['targets', 'maze', 'minesweeper'];
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
    const sub = conn
      .subscriptionBuilder()
      .subscribe([tables.amIAdmin, tables.config, tables.player, tables.level, tables.cursor]);
    return () => sub.unsubscribe();
  }, [conn, status]);

  const isAdmin = useRows(c => c.db.amIAdmin, 100).length > 0;
  const config = useRows(c => c.db.config, 100)[0];
  const players = useRows(c => c.db.player, 300);
  const levels = useRows(c => c.db.level, 300);
  const current = levels.reduce<(typeof levels)[number] | null>((a, b) => (!a || b.id > a.id ? b : a), null);

  const run = async (label: string, p: Promise<void> | undefined) => {
    try {
      await p;
      setMsg(`✓ ${label}`);
    } catch (e) {
      setMsg(`✗ ${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (!conn || status !== 'connected') return <div className="admin">Connecting…</div>;

  if (!isAdmin) {
    return (
      <div className="admin">
        <h1>Admin</h1>
        <p>
          Your identity is not an admin. Enter the passphrase the database owner set with{' '}
          <code>admin_set_passphrase</code>.
        </p>
        <form
          onSubmit={e => {
            e.preventDefault();
            void run('claim', conn.reducers.adminClaim({ passphrase: pass }));
          }}
        >
          <input type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder="passphrase" />
          <button>Claim admin</button>
        </form>
        <p className="msg">{msg}</p>
        <small>identity {identity?.toHexString().slice(0, 16)}…</small>
      </div>
    );
  }

  return (
    <div className="admin">
      <h1>Admin</h1>
      <p className="msg">{msg}</p>

      <section>
        <h2>Control rule</h2>
        <div className="row">
          {RULES.map(r => (
            <button
              key={r}
              className={config?.rule === r ? 'on' : ''}
              onClick={() => void run(`rule ${r}`, conn.reducers.adminSetRule({ rule: r }))}
            >
              {r}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>Level</h2>
        <p>
          Current: {current ? `${current.kind} (${current.state}) score ${current.score}` : 'lobby'}
        </p>
        <div className="row">
          {LEVELS.map(k => (
            <button key={k} onClick={() => void run(`start ${k}`, conn.reducers.adminStartLevel({ kind: k }))}>
              ▶ {k}
            </button>
          ))}
          <button onClick={() => void run('skip', conn.reducers.adminStartLevel({ kind: 'next' }))}>⏭ next</button>
          <button onClick={() => void run('stop', conn.reducers.adminStopLevel({}))}>⏹ stop</button>
          <button
            className="danger"
            onClick={() => {
              if (confirm('Reset scores, levels and awards?')) void run('reset', conn.reducers.adminResetRound({}));
            }}
          >
            Reset round
          </button>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={!!config?.autoAdvance}
            onChange={e => void run('autoAdvance', conn.reducers.adminSetConfig({ key: 'autoAdvance', value: e.target.checked ? 1 : 0 }))}
          />
          auto-advance after a level ends
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={!!config?.paused}
            onChange={e => void run('paused', conn.reducers.adminSetConfig({ key: 'paused', value: e.target.checked ? 1 : 0 }))}
          />
          pause tick
        </label>
      </section>

      <section>
        <h2>Tuning</h2>
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
      </section>

      <section>
        <h2>Players ({players.filter(p => p.connected).length} online)</h2>
        <table>
          <tbody>
            {[...players]
              .sort((a, b) => Number(b.connected) - Number(a.connected) || b.score - a.score)
              .map(p => (
                <tr key={p.identity.toHexString()} style={{ opacity: p.connected ? 1 : 0.5 }}>
                  <td>
                    <span className="dot" style={{ background: p.color }} /> {p.name}
                  </td>
                  <td>{p.team === 0 ? 'red' : 'blue'}</td>
                  <td>{p.score}</td>
                  <td>
                    <button onClick={() => void run(`kick ${p.name}`, conn.reducers.adminKick({ who: p.identity }))}>kick</button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Knob(props: { label: string; min: number; max: number; step: number; value: number; onCommit: (v: number) => void }) {
  const [v, setV] = useState(props.value);
  useEffect(() => setV(props.value), [props.value]);
  return (
    <label className="knob">
      <span>
        {props.label}: <b>{v}</b>
      </span>
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
