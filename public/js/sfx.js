// Tiny synthesized sound effects (no audio files).

let ac = null;
let on = true;
try { on = localStorage.getItem('st_sfx') !== '0'; } catch { /* storage unavailable */ }

function tone(freq, dur, { type = 'square', vol = 0.04, at = 0, to = 0 } = {}) {
  if (!on || !ac || ac.state !== 'running') return;
  const t0 = ac.currentTime + at;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const sfx = {
  get on() { return on; },
  toggle() {
    on = !on;
    try { localStorage.setItem('st_sfx', on ? '1' : '0'); } catch { /* ignore */ }
    return on;
  },
  /** Browsers only allow audio after a user gesture. */
  unlock() {
    try {
      if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
    } catch { /* no audio */ }
  },
  send() { tone(440, 0.07, { vol: 0.03, to: 620 }); },
  capture() { tone(523, 0.1); tone(784, 0.16, { at: 0.09 }); },
  lost() { tone(320, 0.14, { type: 'sawtooth' }); tone(190, 0.24, { type: 'sawtooth', at: 0.12 }); },
  upgrade() { tone(523, 0.08); tone(659, 0.08, { at: 0.07 }); tone(880, 0.16, { at: 0.14 }); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { at: i * 0.13, vol: 0.05 })); },
  lose() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, { at: i * 0.17, type: 'sawtooth', vol: 0.04 })); },
};
