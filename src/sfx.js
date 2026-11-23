// UI sounds synthesized with Web Audio: nothing to load, nothing added to the package.
const Sfx = (() => {
  let live;
  // One enveloped oscillator through a soft low-pass: short attack, exponential decay = "felt", not "beep".
  function tone(c, t, { f, f2 = f, type = 'sine', dur = 0.12, gain = 0.06, attack = 0.004, cutoff = 3800 }) {
    const o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2 !== f) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    lp.type = 'lowpass'; lp.frequency.value = cutoff;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp).connect(g).connect(c.destination);
    o.start(t); o.stop(t + dur + 0.03);
  }
  const SOUNDS = {
    tap: (c, t) => tone(c, t, { f: 1250, f2: 620, type: 'triangle', dur: 0.05, gain: 0.045, cutoff: 2600 }),
    toggle: (c, t) => tone(c, t, { f: 820, f2: 1150, type: 'sine', dur: 0.06, gain: 0.04 }),
    pop: (c, t) => tone(c, t, { f: 380, f2: 940, dur: 0.1, gain: 0.07, attack: 0.006 }),
    success: (c, t) => {
      tone(c, t, { f: 880, dur: 0.38, gain: 0.05, attack: 0.008 });
      tone(c, t + 0.09, { f: 1318.5, dur: 0.6, gain: 0.05, attack: 0.008 });
      tone(c, t + 0.09, { f: 2637, dur: 0.3, gain: 0.008, attack: 0.008 }); // airy overtone
    },
    error: (c, t) => {
      tone(c, t, { f: 392, dur: 0.2, type: 'triangle', gain: 0.055, cutoff: 1800 });
      tone(c, t + 0.13, { f: 294, dur: 0.32, type: 'triangle', gain: 0.055, cutoff: 1800 });
    },
  };
  function play(name, c, t) {
    if (!c) {
      c = (live ||= new AudioContext());
      if (c.state === 'suspended') c.resume();
    }
    SOUNDS[name](c, t ?? c.currentTime + 0.005);
  }
  // Renders every sound offline and returns its peak level (used by tools/snap.js as a self-check).
  async function peaks() {
    const out = {};
    for (const name of Object.keys(SOUNDS)) {
      const off = new OfflineAudioContext(1, 44100, 44100);
      play(name, off, 0);
      const data = (await off.startRendering()).getChannelData(0);
      out[name] = +data.reduce((m, v) => Math.max(m, Math.abs(v)), 0).toFixed(4);
    }
    return out;
  }
  return { play, peaks };
})();
