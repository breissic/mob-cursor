import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { connect } from './lib/stdb';
import Display from './routes/Display';
import Play from './routes/Play';
import Admin from './routes/Admin';
import { Win } from './ui/Win';
import { spriteUrl } from './game/sprites';
import './style.css';

// Hash routes so the static host needs no SPA rewrite rules.
function useHashRoute() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash.replace(/^#\/?/, '').split('?')[0];
}

function Home() {
  return (
    <div className="home">
      <Win title="MOBOS 95 — Start" color="#ffd23f" icon={spriteUrl('cursor', '#fff')} className="dialog">
        <div className="logo">
          <img src={spriteUrl('cursor', '#ffffff')} alt="" />
          <span>
            MOB <span className="c2">CURSOR</span>
          </span>
        </div>
        <a className="btn" href="#/display">
          📽 DISPLAY.EXE — put this on the projector
        </a>
        <a className="btn" href="#/play">
          📱 REMOTE.EXE — join on your phone
        </a>
        <a className="btn" href="#/admin">
          🛠 CONTROL.EXE — host controls
        </a>
      </Win>
    </div>
  );
}

function App() {
  const route = useHashRoute();
  useEffect(() => {
    document.body.dataset.route = route || 'home';
  }, [route]);
  if (route === 'display') return <Display />;
  if (route === 'play') return <Play />;
  if (route === 'admin') return <Admin />;
  return <Home />;
}

void connect();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
