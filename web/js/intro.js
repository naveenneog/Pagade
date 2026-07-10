// intro.js — plays a per-world Sora-2 intro film as an auto-dismissing start overlay.
// Shown once per world per session; always skippable; never traps the player (backstops on
// end / error / stall / a hard time cap). Shared by the 2D and 3D renderers.

export function playIntro(worldId, { onDone, force = false } = {}) {
  const overlay = document.getElementById('intro');
  const video = document.getElementById('introVideo');
  const skip = document.getElementById('introSkip');
  const done1 = () => { if (onDone) onDone(); };

  const key = `pagade.intro.${worldId}`;
  let seen = false;
  try { seen = sessionStorage.getItem(key) === '1'; } catch { /* private mode */ }
  if (!overlay || !video || (seen && !force)) { done1(); return; }
  try { sessionStorage.setItem(key, '1'); } catch { /* ignore */ }

  let done = false;
  let stall = null;
  let cap = null;
  const cleanup = () => {
    video.onended = null; video.onerror = null; video.oncanplay = null; video.onplaying = null;
    if (skip) skip.onclick = null;
    document.removeEventListener('keydown', onKey);
    clearTimeout(stall); clearTimeout(cap);
  };
  const finish = () => {
    if (done) return; done = true;
    cleanup();
    overlay.classList.add('fade');
    try { video.pause(); } catch { /* ignore */ }
    setTimeout(() => { overlay.hidden = true; overlay.classList.remove('fade'); done1(); }, 520);
  };
  const onKey = (e) => { if (e.key === 'Escape' || e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); finish(); } };

  video.src = `assets/${worldId}/intro.mp4`;
  video.onended = finish;
  video.onerror = finish;
  if (skip) skip.onclick = finish;
  document.addEventListener('keydown', onKey);
  overlay.hidden = false;
  overlay.classList.remove('fade');

  // if playback never actually starts (missing file, codec, autoplay block), bail out fast
  stall = setTimeout(() => { if (video.currentTime < 0.1) finish(); }, 4000);
  video.onplaying = () => { clearTimeout(stall); };
  // hard cap so a long clip never holds the player hostage
  cap = setTimeout(finish, 14000);

  try {
    const p = video.play();
    if (p && typeof p.catch === 'function') p.catch(() => finish());
  } catch { finish(); }
}
