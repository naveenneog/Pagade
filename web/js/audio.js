// audio.js — a tiny procedural sound engine (Web Audio API), no assets required.
// A soft tanpura-style drone bed plus short SFX for the cowrie rattle, moves, captures, castles,
// a piece coming home and the win fanfare. Everything is synthesised so it ships weightless.

let ctx = null;
let master = null;
let bedGain = null;
let bedNodes = [];
let enabled = true;
let musicEl = null;
let musicUrl = null;
let bedWanted = false;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  return ctx;
}

export function resume() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume();
}

export function setEnabled(on) {
  enabled = on;
  if (master) master.gain.value = on ? 0.9 : 0;
  if (!on) { stopBed(); }
  else if (bedWanted) { startBed(); }
}

export function isEnabled() { return enabled; }

// Point the music bed at a per-world looping track (assets/<world>/music.mp3). Plays through a
// plain <audio> element (independent of the SFX graph) so it works even without full Web Audio;
// the Sound toggle mutes it. Falls back to the procedural drone when no url is given.
export function setMusic(url) {
  if (url === musicUrl) return;
  musicUrl = url || null;
  if (musicEl) { try { musicEl.pause(); } catch { /* ignore */ } musicEl = null; }
  if (musicUrl) {
    musicEl = new Audio(musicUrl);
    musicEl.loop = true;
    musicEl.preload = 'auto';
    musicEl.volume = 0;
  }
  if (bedWanted) startBed();
}

function fadeMusic(to, ms = 1400) {
  if (!musicEl) return;
  const from = musicEl.volume;
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    musicEl.volume = Math.max(0, Math.min(1, from + (to - from) * k));
    if (k < 1) requestAnimationFrame(step);
    else if (to === 0) { try { musicEl.pause(); } catch { /* ignore */ } }
  };
  requestAnimationFrame(step);
}

// A short tone with an envelope.
function tone(freq, t0, dur, { type = 'sine', gain = 0.2, glideTo = null } = {}) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

// A filtered noise burst — used for the cowrie-shell rattle and the capture impact.
function noise(t0, dur, { freq = 1800, q = 0.7, gain = 0.25, type = 'bandpass' } = {}) {
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.value = gain;
  src.connect(f).connect(g).connect(master);
  src.start(t0);
}

const NOTES = { sa: 261.63, re: 294.33, ga: 327.03, ma: 348.83, pa: 392.44, dha: 436.05, ni: 490.55, saU: 523.25 };

// Play a named SFX. Safe to call before any user gesture (it just no-ops until the context resumes).
export function sfx(name) {
  if (!enabled) return;
  const c = ensure();
  if (!c) return;
  const t = c.currentTime;
  switch (name) {
    case 'throw': // cowrie shells tumbling
      for (let i = 0; i < 5; i++) noise(t + i * 0.045 + Math.random() * 0.02, 0.06, { freq: 2200 + Math.random() * 800, q: 1.2, gain: 0.16 });
      break;
    case 'move': // a soft wooden tick
      tone(360, t, 0.09, { type: 'triangle', gain: 0.16 });
      break;
    case 'step': // per-square footstep during a multi-square glide
      tone(300, t, 0.05, { type: 'triangle', gain: 0.08 });
      break;
    case 'castle': // a gentle safe-haven bell
      tone(NOTES.pa, t, 0.5, { type: 'sine', gain: 0.18 });
      tone(NOTES.saU, t + 0.04, 0.6, { type: 'sine', gain: 0.12 });
      break;
    case 'capture': // impact + a falling slide (a soul cast back)
      noise(t, 0.14, { freq: 300, q: 0.6, gain: 0.4, type: 'lowpass' });
      tone(440, t + 0.02, 0.4, { type: 'sawtooth', gain: 0.18, glideTo: 150 });
      break;
    case 'captured': // your own piece sent home — a hollow descending pair
      tone(330, t, 0.3, { type: 'triangle', gain: 0.16, glideTo: 180 });
      break;
    case 'home': // an ascending arrival
      [NOTES.sa, NOTES.ga, NOTES.pa, NOTES.saU].forEach((f, i) => tone(f, t + i * 0.1, 0.5, { type: 'sine', gain: 0.16 }));
      break;
    case 'win': { // a fuller fanfare
      const seq = [NOTES.sa, NOTES.ga, NOTES.pa, NOTES.saU, NOTES.ni, NOTES.saU];
      seq.forEach((f, i) => { tone(f, t + i * 0.14, 0.6, { type: 'triangle', gain: 0.2 }); tone(f / 2, t + i * 0.14, 0.6, { type: 'sine', gain: 0.1 }); });
      break;
    }
    default:
      break;
  }
}

// Start the ambient bed: a per-world music loop when set, otherwise a procedural tanpura drone.
export function startBed() {
  bedWanted = true;
  if (!enabled) return;
  if (musicUrl && musicEl) {
    try {
      const p = musicEl.play();
      if (p && typeof p.catch === 'function') p.catch(() => { /* autoplay blocked; retry on gesture */ });
      fadeMusic(0.62);
    } catch { /* headless / no media support */ }
    return;
  }
  const c = ensure();
  if (!c || bedNodes.length) return;
  bedGain = c.createGain();
  bedGain.gain.value = 0.0;
  bedGain.connect(master);
  const roots = [NOTES.sa / 2, NOTES.pa / 2, NOTES.sa];
  roots.forEach((f, i) => {
    const o = c.createOscillator();
    o.type = i === 2 ? 'triangle' : 'sine';
    o.frequency.value = f;
    const g = c.createGain();
    g.gain.value = i === 2 ? 0.05 : 0.09;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.08 + i * 0.03;
    const lg = c.createGain();
    lg.gain.value = 0.03;
    lfo.connect(lg).connect(g.gain);
    o.connect(g).connect(bedGain);
    o.start(); lfo.start();
    bedNodes.push(o, lfo);
  });
  bedGain.gain.linearRampToValueAtTime(0.5, c.currentTime + 2.5);
}

export function stopBed() {
  bedWanted = false;
  if (musicEl) fadeMusic(0, 500);
  if (!ctx || !bedNodes.length) return;
  const now = ctx.currentTime;
  if (bedGain) bedGain.gain.linearRampToValueAtTime(0, now + 0.6);
  const nodes = bedNodes; bedNodes = [];
  setTimeout(() => nodes.forEach((n) => { try { n.stop(); } catch { /* already stopped */ } }), 800);
}
