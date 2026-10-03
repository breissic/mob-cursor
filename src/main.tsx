import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { connect } from './lib/stdb';
import Display from './routes/Display';
import Play from './routes/Play';
import Admin from './routes/Admin';
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
    <div className="play-center home">
      <h1>MOB CURSOR</h1>
      <p>One shared cursor. Everyone pulls. Chaos ensues.</p>
      <a href="#/display">📽 Display (projector)</a>
      <a href="#/play">📱 Play</a>
      <a href="#/admin">🛠 Admin</a>
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
