// Tiny WebAudio synth: no asset files, unlocked by the first user gesture.

let ctx: AudioContext | null = null;
export let soundOn = false;

export function enableSound() {
  ctx ??= new AudioContext();
  void ctx.resume();
  soundOn = true;
}

export function disableSound() {
  soundOn = false;
}

function tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.08, slideTo?: number) {
  if (!ctx || !soundOn) return;
  const t0 = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + dur);
}

let lastVote = 0;

/** Short beeps for the 3-2-1 countdown. */
export function countdownBeep(final: boolean) {
  tone(final ? 1046 : 523, final ? 0.35 : 0.12, 'square', 0.09);
}

export function sfx(kind: string) {
  switch (kind) {
    case 'vote': {
      const n = performance.now();
      if (n - lastVote < 40) return; // don't machine-gun the speakers
      lastVote = n;
      tone(600 + Math.random() * 300, 0.05, 'triangle', 0.03);
      return;
    }
    case 'click':
      return tone(880, 0.12, 'square', 0.08, 1320);
    case 'target':
      tone(660, 0.1, 'square', 0.08);
      return setTimeout(() => tone(990, 0.15, 'square', 0.08), 90);
    case 'autoclick':
      tone(1400, 0.06, 'square', 0.08);
      setTimeout(() => tone(1400, 0.06, 'square', 0.08), 90);
      return setTimeout(() => tone(700, 0.25, 'sawtooth', 0.08, 200), 180);
    case 'reveal':
      return tone(520, 0.08, 'triangle', 0.06);
    case 'wall':
      return tone(110, 0.25, 'sawtooth', 0.12, 55);
    case 'mine':
      tone(80, 0.6, 'sawtooth', 0.15, 30);
      return tone(160, 0.3, 'square', 0.08, 40);
    case 'dictator':
      return tone(220, 0.4, 'sawtooth', 0.07, 440);
    case 'win':
      [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'square', 0.08), i * 120));
      return;
    case 'lose':
      [392, 370, 349, 330].forEach((f, i) => setTimeout(() => tone(f, 0.35, 'sawtooth', 0.07), i * 220));
      return;
  }
}
