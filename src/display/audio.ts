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

export function sfx(kind: string, who?: string) {
  switch (kind) {
    case 'vote': {
      const n = performance.now();
      if (n - lastVote < 40) return; // don't machine-gun the speakers
      lastVote = n;
      tone(600 + Math.random() * 300, 0.05, 'triangle', 0.03);
      return;
    }
    case 'echo_flash': {
      // One note per pad so the sequence is hummable.
      const pad = Number(who ?? 0) || 0;
      return tone([392, 494, 587, 698, 784, 880, 988, 1175][pad % 8], 0.3, 'triangle', 0.09);
    }
    case 'echo_pad': {
      const pad = Number(who ?? 0) || 0;
      return tone([392, 494, 587, 698, 784, 880, 988, 1175][pad % 8], 0.18, 'triangle', 0.08);
    }
    case 'echo_go':
      return tone(660, 0.12, 'square', 0.08, 990);
    case 'echo_round':
    case 'valve_all_in':
      [659, 784, 988].forEach((f, i) => setTimeout(() => tone(f, 0.15, 'square', 0.08), i * 80));
      return;
    case 'echo_fault':
    case 'wires_strike':
    case 'seesaw_fall':
      return tone(160, 0.35, 'sawtooth', 0.12, 70);
    case 'crane_drop':
      return tone(220, 0.12, 'square', 0.1, 120);
    case 'crane_miss':
      return tone(330, 0.2, 'triangle', 0.08, 200);
    case 'crane_topple':
    case 'belts_hazard':
      tone(80, 0.6, 'sawtooth', 0.15, 30);
      return tone(1400, 0.2, 'triangle', 0.05, 200);
    case 'spot_out':
      return tone(400, 0.15, 'sawtooth', 0.09, 200);
    case 'spot_in':
    case 'plank_cancel':
      return tone(500, 0.08, 'triangle', 0.06, 700);
    case 'sheep_in':
      tone(440, 0.12, 'triangle', 0.08, 520);
      return setTimeout(() => tone(520, 0.2, 'triangle', 0.08, 440), 120);
    case 'sheep_escape':
    case 'ice_slide':
    case 'plank_wipe':
    case 'needle_wall':
      return tone(300, 0.2, 'triangle', 0.07, 180);
    case 'ice_gate':
    case 'plank_tile':
    case 'needle_pass':
    case 'belts_checkpoint':
    case 'wires_wire':
    case 'seesaw_pocket':
    case 'hunt_found':
    case 'station':
      tone(880, 0.1, 'square', 0.08);
      return setTimeout(() => tone(1320, 0.18, 'square', 0.08), 90);
    case 'hunt_reset':
    case 'station_cancel':
    case 'valve_slip':
      return tone(300, 0.2, 'triangle', 0.07, 180);
    case 'valve_grab':
      return tone(500, 0.08, 'triangle', 0.06, 700);
    case 'valve_blow':
      tone(90, 0.5, 'sawtooth', 0.14, 30);
      return tone(1800, 0.3, 'triangle', 0.05, 200);
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
    case 'light':
      // Red = falling two-tone, green = rising.
      tone(880, 0.1, 'square', 0.08);
      return setTimeout(() => tone(660, 0.18, 'square', 0.08), 110);
    case 'zap':
      tone(1500, 0.05, 'square', 0.1, 300);
      return tone(120, 0.25, 'sawtooth', 0.12, 60);
    case 'trap':
      tone(700, 0.08, 'square', 0.1, 200);
      return setTimeout(() => tone(110, 0.4, 'sawtooth', 0.13, 45), 70);
    case 'fault':
    case 'no_chair':
      return tone(140, 0.3, 'sawtooth', 0.12, 60);
    case 'save':
      return tone(700, 0.07, 'triangle', 0.07, 1100);
    case 'drop':
      return tone(400, 0.25, 'sawtooth', 0.1, 90);
    case 'mole_hit':
      tone(520, 0.06, 'square', 0.09);
      return setTimeout(() => tone(1040, 0.12, 'square', 0.08), 60);
    case 'mole_miss':
      return tone(260, 0.18, 'triangle', 0.07, 180);
    case 'splash':
      return tone(900, 0.3, 'triangle', 0.08, 300);
    case 'boom':
      tone(70, 0.7, 'sawtooth', 0.16, 25);
      return tone(140, 0.35, 'square', 0.08, 35);
    case 'sit':
      [523, 784].forEach((f, i) => setTimeout(() => tone(f, 0.15, 'square', 0.08), i * 90));
      return;
    case 'key':
      return tone(1200, 0.08, 'square', 0.07, 1500);
    case 'buzz':
      return tone(110, 0.3, 'sawtooth', 0.12);
    case 'vote_restart':
      return tone(330, 0.2, 'square', 0.08, 220);
    case 'win':
      [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'square', 0.08), i * 120));
      return;
    case 'lose':
      [392, 370, 349, 330].forEach((f, i) => setTimeout(() => tone(f, 0.35, 'sawtooth', 0.07), i * 220));
      return;
  }
}
