import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { tables } from '../module_bindings';
import { useConnState, usePoll, useRows } from '../lib/stdb';
import { playUrl } from '../config';
import { startRenderer, type RenderStats } from '../display/render';
import { enableSound, disableSound } from '../display/audio';

const RULE_LABEL: Record<string, string> = {
  mean: 'DEMOCRACY (mean)',
  median: 'TROLL-PROOF (geometric median)',
  activity: 'LOUDEST WINS (activity-weighted)',
  tug: 'TUG OF WAR (red vs blue)',
  dictator: 'ROTATING DICTATOR',
};

export default function Display() {
  const { conn, status } = useConnState();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const statsRef = useRef<RenderStats | null>(null);
  const [qr, setQr] = useState('');
  const [hud, setHud] = useState(true);
  const [lines, setLines] = useState(true);
  const [heat, setHeat] = useState(false);
  const [sound, setSound] = useState(false);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const heatRef = useRef<[number, number][] | null>(null);

  // Display subscribes to everything it draws (but not the private tables).
  useEffect(() => {
    if (!conn || status !== 'connected') return;
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
    const r = startRenderer(canvasRef.current, conn, {
      showLines: () => linesRef.current,
      heatmap: () => heatRef.current,
    });
    statsRef.current = r.stats;
    return () => r.stop();
  }, [conn]);

  useEffect(() => {
    void QRCode.toDataURL(playUrl(), { margin: 1, width: 480, color: { dark: '#000', light: '#fff' } }).then(setQr);
  }, []);

  // Heatmap: pull 1 Hz cursor samples for the current level on demand only.
  const levels = useRows(c => c.db.level, 250);
  const current = levels.reduce<(typeof levels)[number] | null>((a, b) => (!a || b.id > a.id ? b : a), null);
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
    const sub = conn
      .subscriptionBuilder()
      .onApplied(collect)
      .subscribe([tables.eventLog.where(r => r.kind.eq('sample').and(r.levelId.eq(levelId)))]);
    const id = window.setInterval(collect, 2000);
    return () => {
      clearInterval(id);
      sub.unsubscribe();
    };
  }, [conn, heat, current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const players = useRows(c => c.db.player, 500);
  const config = useRows(c => c.db.config, 250)[0];
  const awards = useRows(c => c.db.award, 250);
  const commentary = useRows(c => c.db.commentary, 250);
  const stats = usePoll(() => ({ ...(statsRef.current ?? { pointerPerSec: 0, votesPerSec: 0, ticksPerSec: 0, fps: 0 }) }), 1000);

  const online = players.filter(p => p.connected);
  const board = [...players].sort((a, b) => Number(b.connected) - Number(a.connected) || b.score - a.score).slice(0, 10);
  const lastAwards = current ? awards.filter(a => a.levelId === current.id) : [];
  const latestLine = commentary.reduce<(typeof commentary)[number] | null>((a, b) => (!a || b.id > a.id ? b : a), null);
  const totalCalls = stats.pointerPerSec + stats.votesPerSec + stats.ticksPerSec;

  return (
    <div className="display">
      <canvas ref={canvasRef} className="display-canvas" />
      <aside className="display-side">
        <div className="brand">MOB CURSOR</div>
        {qr && <img className="qr" src={qr} alt="Join QR code" />}
        <div className="join-url">{playUrl().replace(/^https?:\/\//, '')}</div>
        <div className="rule">{config ? RULE_LABEL[config.rule] ?? config.rule : '…'}</div>
        <div className="online">{online.length} in the mob</div>
        <h3>Leaderboard</h3>
        <ol className="board">
          {board.map(p => (
            <li key={p.identity.toHexString()} style={{ opacity: p.connected ? 1 : 0.4 }}>
              <span className="dot" style={{ background: p.color }} />
              {p.name}
              <b>{p.score}</b>
            </li>
          ))}
        </ol>
        {current && current.state !== 'running' && lastAwards.length > 0 && (
          <>
            <h3>Awards</h3>
            <ul className="awards">
              {lastAwards.map(a => (
                <li key={a.id.toString()}>
                  <b>{a.title}</b>: {a.name}
                  <small>{a.detail}</small>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="toggles">
          <button onClick={() => setHud(h => !h)}>HUD</button>
          <button onClick={() => setLines(l => !l)}>Lines</button>
          <button onClick={() => setHeat(h => !h)}>{heat ? 'Heat ✓' : 'Heat'}</button>
          <button
            onClick={() => {
              if (sound) disableSound();
              else enableSound();
              setSound(!sound);
            }}
          >
            {sound ? '🔊' : '🔇'}
          </button>
        </div>
      </aside>
      {latestLine && <div className="commentary">🎙 {latestLine.text}</div>}
      {hud && (
        <div className="hud">
          <div>status {status}</div>
          <div>pointer calls/s {stats.pointerPerSec.toFixed(0)}</div>
          <div>click calls/s {stats.votesPerSec.toFixed(1)}</div>
          <div>ticks/s {stats.ticksPerSec.toFixed(1)}</div>
          <div>≈ total reducer calls/s {totalCalls.toFixed(0)}</div>
          <div>client hz {config?.pointerHzEffective ?? '?'}</div>
          <div>fps {stats.fps.toFixed(0)}</div>
        </div>
      )}
    </div>
  );
}
