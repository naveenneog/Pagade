// game.js — the 2D Pachisi renderer + interaction layer. All pure rules live in pachisi.js.
import {
  buildGeometry, cellAt, cellRC, isCastle, HOME, GRID,
  throwCowries, createGame, legalMoves, evaluateMove, applyMove, nextTurn, validateWorld,
} from './pachisi.js';
import { gameForWorld, charOf, pawnStyleFor } from './config.js';
import * as audio from './audio.js';
import { playIntro } from './intro.js';
import { pawnSVG } from './pawnsvg.js';
import { setVoice, narrate, stopSpeak } from './narrate.js';

const $ = (s) => document.querySelector(s);
const boardEl = $('#board');
const rosterEl = $('#roster');
const cowriesEl = $('#cowries');
const throwBtn = $('#throwBtn');
const throwValue = $('#throwValue');
const throwGrace = $('#throwGrace');
const statusEl = $('#status');
const worldSelect = $('#worldSelect');
const soundBtn = $('#soundBtn');
const voiceBtn = $('#voiceBtn');
const newGameBtn = $('#newGameBtn');
const worldTitle = $('#worldTitle');
const worldSubtitle = $('#worldSubtitle');
const reveal = $('#reveal');
const revealKind = $('#revealKind');
const revealTitle = $('#revealTitle');
const revealText = $('#revealText');
const skipBtn = $('#skipBtn');
const continueBtn = $('#continueBtn');
const winOverlay = $('#winOverlay');
const winTitle = $('#winTitle');
const winMeaning = $('#winMeaning');
const winNewGame = $('#winNewGame');

const geo = buildGeometry();
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

let world = null;
let state = null;
let pieceEls = {}; // `${player}-${piece}` -> element
let seatColor = {};
let currentThrow = null;
let pendingMoves = [];
let awaitingPick = false;
let busy = false;
let speakOn = true;
let currentFinish = null;
let fallbackTimer = null;

// which arm (seat) owns each cell's home lane + the gate cell into the Charkoni
const ARM_OF_SEAT = { 0: 'S', 1: 'E', 2: 'N', 3: 'W' };
const GATE = { 0: [8, 7], 1: [7, 8], 2: [6, 7], 3: [7, 6] };
const YARD_ANCHOR = { 0: [11.5, 2.5], 1: [11.5, 11.5], 2: [2.5, 11.5], 3: [2.5, 2.5] };

// --- pixel geometry (percentages over the square board) ---
const pct = (row, col) => ({ x: ((col + 0.5) / GRID) * 100, y: ((row + 0.5) / GRID) * 100 });
const cellPct = (id) => { const { row, col } = cellRC(id); return pct(row, col); };
const gatePct = (seat) => pct(GATE[seat][0], GATE[seat][1]);
function yardSlotPct(seat, pieceIdx) {
  const [ar, ac] = YARD_ANCHOR[seat];
  const dr = pieceIdx < 2 ? -0.95 : 0.95;
  const dc = pieceIdx % 2 === 0 ? -0.95 : 0.95;
  return pct(ar + dr, ac + dc);
}
function fanOffset(i, n) {
  if (n <= 1) return { dx: 0, dy: 0 };
  const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
  return { dx: Math.cos(ang) * 1.9, dy: Math.sin(ang) * 1.9 };
}

// --- classify a cross cell for rendering ---
function classifyCell(r, c) {
  const midR = r >= 6 && r <= 8;
  const midC = c >= 6 && c <= 8;
  if (!midR && !midC) return null; // corner void
  if (midR && midC) {
    if (r === 7 && c === 7) return { kind: 'charkoni-core' };
    for (const s of [0, 1, 2, 3]) if (GATE[s][0] === r && GATE[s][1] === c) return { kind: 'gate', seat: s };
    return { kind: 'track' }; // the four ring corner cells of the centre block
  }
  // an arm cell
  let seat, home;
  if (c >= 6 && c <= 8) { seat = r < 6 ? 2 : 0; home = c === 7; } // vertical arms
  else { seat = c < 6 ? 3 : 1; home = r === 7; } // horizontal arms
  const id = r * GRID + c;
  const castle = geo.castles.has(id);
  const tip = castle && (r === 0 || r === 14 || c === 0 || c === 14);
  return { kind: home ? 'home-lane' : 'track', seat, castle, tip };
}

function applyTheme(t = {}) {
  const root = document.documentElement.style;
  const map = { '--bg': t.bg, '--panel': t.panel, '--board': t.board, '--cloth': t.cloth, '--line': t.line, '--accent': t.accent, '--castle': t.castle, '--text': t.text, '--muted': t.muted, '--font': t.font };
  for (const [k, v] of Object.entries(map)) if (v) root.setProperty(k, v);
}

// --- build the board ---
function buildBoard() {
  boardEl.innerHTML = '';
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const info = classifyCell(r, c);
      if (!info) continue;
      const cell = document.createElement('div');
      cell.className = 'cell';
      const p = pct(r, c);
      cell.style.left = `${(c / GRID) * 100}%`;
      cell.style.top = `${(r / GRID) * 100}%`;
      if (info.kind === 'charkoni-core') cell.classList.add('charkoni-core');
      else if (info.kind === 'gate') { cell.classList.add('gate'); tintArm(cell, info.seat); }
      else if (info.kind === 'home-lane') { cell.classList.add('home-lane'); tintArm(cell, info.seat); }
      else cell.classList.add('track');
      if (info.castle) cell.classList.add('castle');
      if (info.tip) cell.classList.add('tip');
      boardEl.appendChild(cell);
    }
  }
  buildYards();
  buildPieces();
}

function tintArm(cell, seat) {
  cell.style.setProperty('--armc', seatColor[seat] || 'rgba(180,160,120,0.35)');
}

function buildYards() {
  for (const pl of state.players) {
    const y = document.createElement('div');
    y.className = 'yard';
    const [ar, ac] = YARD_ANCHOR[pl.seat];
    y.style.left = `${((ac + 0.5) / GRID) * 100}%`;
    y.style.top = `${((ar + 0.5) / GRID) * 100}%`;
    y.style.setProperty('--armc', pl.color);
    for (let i = 0; i < 4; i++) { const s = document.createElement('div'); s.className = 'slot'; y.appendChild(s); }
    boardEl.appendChild(y);
  }
}

function buildPieces() {
  pieceEls = {};
  for (const pl of state.players) {
    const shape = pawnStyleFor(world, pl);
    for (let pi = 0; pi < pl.pieces.length; pi++) {
      const el = document.createElement('div');
      el.className = 'piece';
      el.style.setProperty('--pc', pl.color);
      el.tabIndex = -1;
      el.innerHTML = pawnSVG(shape, pl.color);
      el.addEventListener('click', () => handlePieceClick(pl.idx, pi));
      boardEl.appendChild(el);
      pieceEls[`${pl.idx}-${pi}`] = el;
    }
  }
  placeAll(false);
}

// --- placement ---
function posBasePct(seat, pos) {
  if (pos <= 0) return null;
  if (pos >= HOME) return gatePct(seat);
  return cellPct(cellAt(geo, seat, pos));
}

function positionEl(player, piece, x, y, returning) {
  const el = pieceEls[`${player}-${piece}`];
  if (!el) return;
  el.style.left = `${x}%`;
  el.style.top = `${y}%`;
  el.classList.toggle('returning', Boolean(returning));
}

function placeAll(animate = true) {
  const groups = new Map();
  for (const pl of state.players) {
    pl.pieces.forEach((pos, pi) => {
      if (pos <= 0) { const s = yardSlotPct(pl.seat, pi); positionEl(pl.idx, pi, s.x, s.y, false); return; }
      const key = pos >= HOME ? `home:${pl.seat}` : `cell:${cellAt(geo, pl.seat, pos)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ pl, pi, pos });
    });
  }
  for (const members of groups.values()) {
    members.forEach((m, i) => {
      const base = posBasePct(m.pl.seat, m.pos);
      const off = fanOffset(i, members.length);
      positionEl(m.pl.idx, m.pi, base.x + off.dx, base.y + off.dy, m.pos >= 62 && m.pos < HOME);
    });
  }
  if (!animate) {
    for (const el of Object.values(pieceEls)) { el.style.transition = 'none'; requestAnimationFrame(() => (el.style.transition = '')); }
  }
}

// --- roster ---
function renderRoster() {
  rosterEl.innerHTML = '';
  state.players.forEach((pl) => {
    const ch = charOf(world, pl.char);
    const row = document.createElement('div');
    row.className = 'rmp' + (pl.idx === state.turn && state.winner == null ? ' cur' : '') + (pl.pieces.every((p) => p >= HOME) ? ' won' : '');
    row.style.setProperty('--pc', pl.color);
    const pips = pl.pieces.map((p) => `<i class="pip ${p >= HOME ? 'home' : p > 0 ? 'active' : ''}"></i>`).join('');
    row.innerHTML = `<span class="g">${(ch && ch.glyph) || '●'}</span>` +
      `<span class="nm">${escapeHtml(pl.name)} <small>${ch ? ch.symbol || ch.name : ''}</small></span>` +
      `<span class="prog">${pips}</span>`;
    rosterEl.appendChild(row);
  });
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// --- turn + throw flow ---
function who() { const p = state.players[state.turn]; const ch = charOf(world, p.char); return `${(ch && ch.glyph) || ''} ${p.name}`; }

function announceTurn(again) {
  statusEl.textContent = again
    ? `${who()} earns another throw.`
    : `${who()}'s turn — throw the cowries.`;
  renderRoster();
}

async function onThrow() {
  if (busy || awaitingPick || state.winner != null) return;
  busy = true;
  throwBtn.disabled = true;
  audio.resume();
  audio.sfx('throw');
  cowriesEl.classList.add('rolling');
  const t = throwCowries();
  currentThrow = t;
  await delay(420);
  renderCowries(t.shells);
  cowriesEl.classList.remove('rolling');
  throwValue.textContent = t.value;
  throwGrace.hidden = !t.grace;

  const moves = legalMoves(state, t);
  pendingMoves = moves;
  if (moves.length === 0) {
    statusEl.textContent = `${who()} threw ${t.value}${t.grace ? ' (grace)' : ''} — no move possible.`;
    await delay(populatedYard() ? 850 : 650);
    busy = false;
    endThrow(t.grace);
    return;
  }

  highlightMovable(moves);
  awaitingPick = true;
  busy = false;
  statusEl.textContent = `${who()} threw ${t.value}${t.grace ? ' — a grace!' : ''} — tap a glowing piece.`;
  if (moves.length === 1) setTimeout(() => { if (awaitingPick && pendingMoves[0] === moves[0]) pick(moves[0]); }, 650);
}

function populatedYard() { return state.players[state.turn].pieces.some((p) => p === 0); }

function highlightMovable(moves) {
  clearHighlights();
  for (const m of moves) {
    const el = pieceEls[`${m.player}-${m.piece}`];
    if (el) el.classList.add('movable');
  }
}
function clearHighlights() {
  for (const el of Object.values(pieceEls)) el.classList.remove('movable', 'picked');
}

function handlePieceClick(player, piece) {
  if (!awaitingPick) return;
  const move = pendingMoves.find((m) => m.player === player && m.piece === piece);
  if (move) pick(move);
}

async function pick(move) {
  if (!awaitingPick) return;
  awaitingPick = false;
  const el = pieceEls[`${move.player}-${move.piece}`];
  clearHighlights();
  if (el) el.classList.add('picked');
  busy = true;
  try {
    await applyAndAnimate(move);
  } catch (e) {
    console.warn('pick recovered:', e);
    try { placeAll(); renderRoster(); } catch (e2) { /* ignore */ }
    if (state.winner == null) endThrow(false);
  } finally {
    if (el) el.classList.remove('picked');
    busy = false;
  }
}

async function glide(move) {
  const seat = state.players[move.player].seat;
  const el = pieceEls[`${move.player}-${move.piece}`];
  if (!el) return;
  const steps = [];
  if (move.from === 0) steps.push(1);
  else for (let pos = move.from + 1; pos <= move.to; pos++) steps.push(pos);
  for (const pos of steps) {
    const b = posBasePct(seat, pos);
    el.style.left = `${b.x}%`;
    el.style.top = `${b.y}%`;
    el.classList.toggle('returning', pos >= 62 && pos < HOME);
    audio.sfx('step');
    await delay(150);
  }
}

async function applyAndAnimate(move) {
  const mover = state.players[move.player];
  const out = applyMove(state, move); // mutate state: piece advanced, captures sent to yard
  await glide(move);
  if (out.captured.length) { audio.sfx('capture'); }
  else if (out.event === 'home') audio.sfx('home');
  else if (move.castle) audio.sfx('castle');
  else audio.sfx('move');
  placeAll(); // settles fan-out and flies captured pieces back to their yards
  renderRoster();

  const teaching = out.won ? null : pickTeaching(move, out);
  if (teaching) await showReveal(teaching);

  if (out.won) { showWin(mover); return; }
  endThrow(out.another);
}

// choose a single teaching for the move's most significant milestone
function pickTeaching(move, out) {
  const t = world.teachings || {};
  const rnd = (arr) => (arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null);
  if (out.captured.length) return decorate('capture', rnd(t.capture));
  if (out.event === 'home') return decorate('home', rnd(t.home));
  if (move.from === 0) return decorate('enter', rnd(t.enter));
  if (move.castle) return decorate('castle', rnd(t.castle));
  // journey milestone crossed on this move?
  const crossed = (t.journey || []).filter((j) => j.at > move.from && j.at <= move.to).sort((a, b) => b.at - a.at)[0];
  if (crossed) return decorate('journey', crossed);
  return null;
}
function decorate(kind, entry) { return entry ? { kind, ...entry } : null; }

// --- teaching reveal + narration ---
function showReveal(teaching) {
  return new Promise((resolve) => {
    const labels = { enter: 'A soul sets out', castle: 'Refuge', capture: 'The wheel turns', captured: 'Sent home', home: 'Come home', win: 'Fulfilment', journey: 'On the road' };
    revealKind.textContent = labels[teaching.kind] || 'Teaching';
    revealKind.className = 'kind ' + teaching.kind;
    revealTitle.textContent = teaching.en || labels[teaching.kind] || '';
    revealText.innerHTML = '';
    const words = teaching.text.split(/\s+/).map((w, i, arr) => {
      const s = document.createElement('span');
      s.className = 'w';
      s.textContent = w;
      revealText.appendChild(s);
      if (i < arr.length - 1) revealText.appendChild(document.createTextNode(' '));
      return s;
    });

    reveal.hidden = false;
    requestAnimationFrame(() => reveal.classList.add('show'));

    let closed = false;
    let autoTimer = null;
    const finish = () => {
      if (closed) return;
      closed = true;
      if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
      stopSpeak(words);
      reveal.classList.remove('show');
      continueBtn.removeEventListener('click', finish);
      skipBtn.removeEventListener('click', finish);
      currentFinish = null;
      setTimeout(() => { reveal.hidden = true; resolve(); }, 220);
    };
    currentFinish = finish;
    continueBtn.addEventListener('click', finish);
    skipBtn.addEventListener('click', finish);
    narrate(teaching.text, words, speakOn, () => { autoTimer = setTimeout(finish, 900); });
  });
}

// --- end of throw / turn ---
function endThrow(another) {
  currentThrow = null;
  pendingMoves = [];
  throwValue.textContent = '—';
  throwGrace.hidden = true;
  if (state.winner != null) return;
  if (!another) nextTurn(state);
  announceTurn(another);
  throwBtn.disabled = false;
}

function showWin(pl) {
  const t = world.teachings || {};
  const line = (t.win && t.win.length) ? t.win[Math.floor(Math.random() * t.win.length)] : null;
  const ch = charOf(world, pl.char);
  winTitle.textContent = `🏵 ${pl.name} — ${world.goalLabel || 'the journey is complete'}`;
  winMeaning.textContent = (line && line.text) || world.goalMeaning || '';
  winOverlay.hidden = false;
  requestAnimationFrame(() => winOverlay.classList.add('show'));
  audio.sfx('win');
}

// --- cowrie visuals ---
function renderCowries(shells) {
  cowriesEl.innerHTML = '';
  const s = shells || [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 6; i++) {
    const c = document.createElement('div');
    c.className = 'cowrie' + (s[i] ? ' up' : '');
    cowriesEl.appendChild(c);
  }
}

// --- lifecycle ---
async function loadWorld(id) {
  const res = await fetch(`worlds/${id}.json`);
  if (!res.ok) throw new Error(`Failed to load world ${id}: ${res.status}`);
  world = validateWorld(await res.json());
  const cfg = gameForWorld(world);
  seatColor = {};
  cfg.players.forEach((p) => { seatColor[p.seat] = p.color; });
  state = createGame(world, cfg.players, geo);
  try { const vr = await fetch(`assets/${world.id}/voice/voice.json`); setVoice(vr.ok ? await vr.json() : {}, `assets/${world.id}`, (world.voice && world.voice.web) || 'en-IN'); } catch { setVoice({}, `assets/${world.id}`, 'en-IN'); }

  applyTheme(world.theme);
  worldTitle.textContent = world.title;
  worldSubtitle.textContent = world.subtitle || '';
  document.title = `${world.title} — Pagade`;
  buildBoard();
  renderCowries(null);
  renderRoster();
  resetTransientUi();
  announceTurn(false);
  audio.setMusic(`assets/${world.id}/music.mp3`);
  if (new URLSearchParams(location.search).has('nointro')) { audio.resume(); audio.startBed(); }
  else playIntro(world.id, { onDone: () => { audio.resume(); audio.startBed(); } });
}

function resetTransientUi() {
  awaitingPick = false;
  busy = false;
  currentThrow = null;
  pendingMoves = [];
  throwValue.textContent = '—';
  throwGrace.hidden = true;
  throwBtn.disabled = false;
  reveal.hidden = true; reveal.classList.remove('show');
  winOverlay.hidden = true; winOverlay.classList.remove('show');
}

function newGame() {
  stopSpeak();
  const id = worldSelect.value;
  loadWorld(id).catch((e) => (statusEl.textContent = String(e.message || e)));
}

// --- events ---
throwBtn.addEventListener('click', onThrow);
newGameBtn.addEventListener('click', newGame);
winNewGame.addEventListener('click', () => { winOverlay.classList.remove('show'); winOverlay.hidden = true; newGame(); });
worldSelect.addEventListener('change', () => { syncLobbyLink(); newGame(); });

soundBtn.addEventListener('click', () => {
  const on = !audio.isEnabled();
  audio.setEnabled(on);
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.textContent = on ? '🎵 Sound' : '🔇 Muted';
  if (on) { audio.resume(); audio.startBed(); }
});
voiceBtn.addEventListener('click', () => {
  speakOn = !speakOn;
  voiceBtn.setAttribute('aria-pressed', String(speakOn));
  voiceBtn.textContent = speakOn ? '🔊 Read aloud' : '🔇 Silent';
  if (!speakOn) stopSpeak();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && currentFinish) { currentFinish(); return; }
  if (e.code === 'Space' && reveal.hidden && winOverlay.hidden && !awaitingPick) { e.preventDefault(); onThrow(); }
});

if (window.speechSynthesis) { speechSynthesis.onvoiceschanged = () => {}; speechSynthesis.getVoices(); }

// honour ?world= from the lobby / deep links
const wparam = new URLSearchParams(location.search).get('world');
if (wparam && [...worldSelect.options].some((o) => o.value === wparam)) worldSelect.value = wparam;
function syncLobbyLink() { const l = $('#lnkLobby'); if (l) l.href = `setup.html?world=${worldSelect.value}`; const d = $('#lnk3d'); if (d) d.href = `play3d.html?world=${worldSelect.value}`; }
syncLobbyLink();

// start the ambient bed on the first interaction (autoplay policies)
const kick = () => { audio.resume(); audio.startBed(); window.removeEventListener('pointerdown', kick); };
window.addEventListener('pointerdown', kick);

loadWorld(worldSelect.value).catch((e) => (statusEl.textContent = String(e.message || e)));

// Debug/test hook — lets the smoke test and manual QA drive the game deterministically.
window.__pagade = {
  get state() { return state; },
  get world() { return world; },
  get awaitingPick() { return awaitingPick; },
  get pendingMoves() { return pendingMoves; },
  get busy() { return busy; },
  geo,
  throw: onThrow,
  pick,
  loadWorld,
};
