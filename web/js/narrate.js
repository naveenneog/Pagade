// narrate.js — plays a teaching's pre-generated Azure DragonHD Indian narration with a word-by-word
// highlight, then falls back to the browser voice, then a silent timed highlight. Shared by the 2D
// and 3D renderers so narration behaves identically in both.

let voiceMap = {}; // exact teaching text -> mp3 filename
let base = '';     // e.g. "assets/dharma"
let lang = 'en-IN';
let currentAudio = null;
let fallbackTimer = null;
let hlTimer = null;
let watchdog = null;

// Point narration at a world's voice manifest (assets/<id>/voice/voice.json).
export function setVoice(map, assetsBase, voiceLang) {
  voiceMap = map || {};
  base = assetsBase || '';
  lang = voiceLang || 'en-IN';
}

function pickVoice(l) {
  const voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  if (!voices.length || !l) return null;
  return voices.find((v) => v.lang && v.lang.toLowerCase() === l.toLowerCase())
    || voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(l.slice(0, 2).toLowerCase())) || null;
}
function clearWords(words) { words.forEach((w) => w.classList.remove('on')); }
function timedHighlight(words, per, done) {
  let i = 0;
  if (hlTimer) clearTimeout(hlTimer);
  const step = () => { clearWords(words); if (i < words.length) { words[i].classList.add('on'); i += 1; hlTimer = setTimeout(step, per); } else if (done) done(); };
  step();
}

export function stopSpeak(words) {
  if (window.speechSynthesis) speechSynthesis.cancel();
  for (const t of [fallbackTimer, hlTimer, watchdog]) if (t) clearTimeout(t);
  fallbackTimer = hlTimer = watchdog = null;
  if (currentAudio) { try { currentAudio.pause(); } catch { /* */ } currentAudio.onended = null; currentAudio.onerror = null; currentAudio = null; }
  if (words) clearWords(words);
}

function speakSynth(text, words, done) {
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') { timedHighlight(words, 300, done); return; }
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice(lang); if (v) u.voice = v;
  u.lang = lang; u.rate = 0.96;
  u.onboundary = (e) => {
    if (e.name && e.name !== 'word') return;
    clearWords(words);
    let acc = 0;
    for (let k = 0; k < words.length; k++) { const wl = words[k].textContent.length + 1; if (e.charIndex < acc + wl) { words[k].classList.add('on'); break; } acc += wl; }
  };
  u.onend = done; u.onerror = done;
  fallbackTimer = setTimeout(done, Math.max(4000, text.length * 90));
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

// Narrate `text` over the word spans in `words`. Prefers the DragonHD clip; onend() fires once.
export function narrate(text, words, speakOn, onend) {
  let ended = false;
  const done = () => { if (!ended) { ended = true; clearWords(words); onend(); } };
  if (!speakOn) { timedHighlight(words, 280, done); return; }

  const file = voiceMap[text];
  if (file && base && typeof Audio !== 'undefined') {
    try {
      const audio = new Audio(`${base}/voice/${file}`);
      currentAudio = audio;
      let per = 300, started = false, fell = false;
      const fallback = () => { if (ended || fell) return; fell = true; if (watchdog) { clearTimeout(watchdog); watchdog = null; } currentAudio = null; speakSynth(text, words, done); };
      const begin = () => { if (watchdog) { clearTimeout(watchdog); watchdog = null; } if (!started) { started = true; timedHighlight(words, per, null); } };
      audio.onloadedmetadata = () => { if (audio.duration && isFinite(audio.duration)) per = (audio.duration * 1000) / Math.max(1, words.length); };
      audio.onplaying = begin;
      audio.ontimeupdate = begin;
      audio.onended = () => { if (watchdog) { clearTimeout(watchdog); watchdog = null; } done(); };
      audio.onerror = fallback;
      watchdog = setTimeout(fallback, 1600); // never actually plays -> browser voice
      const p = audio.play(); if (p && typeof p.catch === 'function') p.catch(fallback);
      return;
    } catch { /* no media support -> fall through to browser speech */ }
  }
  speakSynth(text, words, done);
}
