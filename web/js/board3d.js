// board3d.js — the 3D Pagade renderer (Three.js). Same pure engine (pachisi.js) as the 2D board,
// drawn as a real 3D cruciform with glowing beehive pawns, a bloom-lit Charkoni, an orbit camera,
// and the shared DOM HUD / Teaching Reveal. Themed per world.
import * as THREE from '../vendor/three.module.js';
import { EffectComposer } from '../vendor/EffectComposer.js';
import { RenderPass } from '../vendor/RenderPass.js';
import { UnrealBloomPass } from '../vendor/UnrealBloomPass.js';
import { OutputPass } from '../vendor/OutputPass.js';
import {
  buildGeometry, cellAt, cellRC, isCastle, HOME, GRID,
  throwCowries, createGame, legalMoves, evaluateMove, applyMove, nextTurn, validateWorld,
} from './pachisi.js';
import { gameForWorld, charOf } from './config.js';
import * as audio from './audio.js';
import { playIntro } from './intro.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#c3d');
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
const MOBILE = matchMedia('(max-width: 640px)').matches;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

let world = null, state = null, seatColor = {};
let pieceGroups = {}; // `${player}-${piece}` -> THREE.Group
let currentThrow = null, pendingMoves = [], awaitingPick = false, busy = false, speakOn = true;
let currentFinish = null, fallbackTimer = null;

// ---------- scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !MOBILE, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, MOBILE ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 400);
const target = new THREE.Vector3(0, 0, 0.5);

const composer = new EffectComposer(renderer);
composer.setPixelRatio(Math.min(devicePixelRatio || 1, MOBILE ? 1.5 : 2));
composer.setSize(innerWidth, innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.7, 0.7, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// lights
const amb = new THREE.AmbientLight(0xffffff, 0.72);
const key = new THREE.DirectionalLight(0xfff0d8, 1.35);
key.position.set(6, 14, 8);
const rim = new THREE.DirectionalLight(0x88a0ff, 0.5);
rim.position.set(-8, 5, -6);
const hemi = new THREE.HemisphereLight(0xffe9c0, 0x120a06, 0.45);
const glowLight = new THREE.PointLight(0xffdca0, 0.9, 34, 2);
glowLight.position.set(0, 4.5, 1);
scene.add(amb, key, rim, hemi, glowLight);

const boardGroup = new THREE.Group();
scene.add(boardGroup);

// ---------- geometry helpers ----------
const CENTER_XZ = 7;
const vec = (row, col, y = 0) => new THREE.Vector3(col - CENTER_XZ, y, row - CENTER_XZ);
const cellVec = (id, y = 0.12) => { const { row, col } = cellRC(id); return vec(row, col, y); };
const GATE = { 0: [8, 7], 1: [7, 8], 2: [6, 7], 3: [7, 6] };
const YARD_ANCHOR = { 0: [11.5, 2.5], 1: [11.5, 11.5], 2: [2.5, 11.5], 3: [2.5, 2.5] };
const gateVec = (seat, y = 0.12) => vec(GATE[seat][0], GATE[seat][1], y);
function yardVec(seat, pieceIdx, y = 0.12) {
  const [ar, ac] = YARD_ANCHOR[seat];
  const dr = pieceIdx < 2 ? -0.95 : 0.95;
  const dc = pieceIdx % 2 === 0 ? -0.95 : 0.95;
  return vec(ar + dr, ac + dc, y);
}
function fanXZ(i, n) {
  if (n <= 1) return [0, 0];
  const a = (i / n) * Math.PI * 2 - Math.PI / 2;
  return [Math.cos(a) * 0.26, Math.sin(a) * 0.26];
}
function classify(r, c) {
  const midR = r >= 6 && r <= 8, midC = c >= 6 && c <= 8;
  if (!midR && !midC) return null;
  if (midR && midC) {
    if (r === 7 && c === 7) return { kind: 'core' };
    for (const s of [0, 1, 2, 3]) if (GATE[s][0] === r && GATE[s][1] === c) return { kind: 'gate', seat: s };
    return { kind: 'track' };
  }
  let seat, home;
  if (c >= 6 && c <= 8) { seat = r < 6 ? 2 : 0; home = c === 7; }
  else { seat = c < 6 ? 3 : 1; home = r === 7; }
  const id = r * GRID + c;
  return { kind: home ? 'home' : 'track', seat, castle: geo.castles.has(id) };
}

// ---------- board build ----------
let tileMesh = null, castleGroup = new THREE.Group(), charkoni = null;
function hexColor(hex) { return new THREE.Color(hex); }
function mix(a, b, t) { return a.clone().lerp(b, t); }

function buildBoard() {
  // clear previous
  boardGroup.clear();
  const cells = [];
  for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) { const info = classify(r, c); if (info) cells.push({ r, c, info }); }

  const cloth = hexColor(world.theme.cloth || '#3a2413');
  const boardBase = hexColor(world.theme.board || '#2a1a10');
  const tileGeo = new THREE.BoxGeometry(0.92, 0.16, 0.92);
  const tileMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 });
  tileMesh = new THREE.InstancedMesh(tileGeo, tileMat, cells.length);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  cells.forEach((cell, i) => {
    const p = vec(cell.r, cell.c, 0);
    dummy.position.set(p.x, 0, p.z);
    dummy.updateMatrix();
    tileMesh.setMatrixAt(i, dummy.matrix);
    let base;
    const info = cell.info;
    if (info.kind === 'core') base = hexColor(world.theme.accent).multiplyScalar(0.95);
    else if (info.kind === 'gate') base = mix(boardBase, hexColor(seatColor[info.seat] || '#caa06a'), 0.6);
    else if (info.kind === 'home') base = mix(cloth.clone().multiplyScalar(1.1), hexColor(seatColor[info.seat] || '#caa06a'), seatColor[info.seat] ? 0.6 : 0.15);
    else base = cell.info.castle ? mix(cloth, hexColor(world.theme.castle || '#f0c862'), 0.4) : cloth.clone().multiplyScalar(1.12);
    tileMesh.setColorAt(i, col.copy(base));
  });
  tileMesh.instanceColor.needsUpdate = true;
  tileMesh.receiveShadow = true;
  boardGroup.add(tileMesh);

  // castle star markers (emissive -> bloom)
  castleGroup = new THREE.Group();
  const starGeo = new THREE.OctahedronGeometry(0.12, 0);
  const starMat = new THREE.MeshStandardMaterial({ color: 0x2a1a0a, emissive: hexColor(world.theme.castle || '#f0c862'), emissiveIntensity: 1.3, roughness: 0.3, metalness: 0.4 });
  for (const id of geo.castles) { const { row, col: cc } = cellRC(id); const s = new THREE.Mesh(starGeo, starMat); const p = vec(row, cc, 0.24); s.position.copy(p); castleGroup.add(s); }
  boardGroup.add(castleGroup);

  // Charkoni medallion (glowing home)
  const cGeo = new THREE.CylinderGeometry(1.35, 1.5, 0.14, 40);
  const cMat = new THREE.MeshStandardMaterial({ color: hexColor(world.theme.accent), emissive: hexColor(world.theme.accent), emissiveIntensity: 0.6, roughness: 0.35, metalness: 0.6 });
  charkoni = new THREE.Mesh(cGeo, cMat);
  charkoni.position.set(0, 0.12, 0);
  boardGroup.add(charkoni);
  const ringGeo = new THREE.TorusGeometry(1.5, 0.06, 12, 48);
  const ringMat = new THREE.MeshStandardMaterial({ color: hexColor(world.theme.castle || '#f0c862'), emissive: hexColor(world.theme.castle || '#f0c862'), emissiveIntensity: 1.2, roughness: 0.3, metalness: 0.5 });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.2; boardGroup.add(ring);

  // a soft board slab underneath
  const slab = new THREE.Mesh(new THREE.BoxGeometry(15.6, 0.4, 15.6), new THREE.MeshStandardMaterial({ color: boardBase.clone().multiplyScalar(0.6), roughness: 0.95 }));
  slab.position.y = -0.22; boardGroup.add(slab);
}

// ---------- pawns (glowing beehive) ----------
const BEEHIVE = [
  [0.00, 0.00], [0.40, 0.00], [0.42, 0.035], [0.37, 0.075], [0.41, 0.115], [0.35, 0.175],
  [0.37, 0.225], [0.30, 0.295], [0.31, 0.345], [0.23, 0.42], [0.235, 0.46], [0.15, 0.53],
  [0.14, 0.565], [0.07, 0.61], [0.03, 0.635], [0.0, 0.645],
];
const pawnGeo = new THREE.LatheGeometry(BEEHIVE.map(([x, y]) => new THREE.Vector2(x, y)), 32);
pawnGeo.computeVertexNormals();
const topGeo = new THREE.SphereGeometry(0.06, 16, 12);

function makePawn(color) {
  const c = hexColor(color);
  const mat = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.45, roughness: 0.32, metalness: 0.35 });
  const g = new THREE.Group();
  const body = new THREE.Mesh(pawnGeo, mat);
  const bead = new THREE.Mesh(topGeo, mat);
  bead.position.y = 0.7;
  g.add(body, bead);
  g.userData.mat = mat;
  g.userData.baseEmissive = 0.45;
  g.scale.setScalar(0.86);
  return g;
}

function buildPawns() {
  Object.values(pieceGroups).forEach((g) => scene.remove(g));
  pieceGroups = {};
  for (const pl of state.players) {
    for (let pi = 0; pi < pl.pieces.length; pi++) {
      const g = makePawn(pl.color);
      g.userData.player = pl.idx; g.userData.piece = pi; g.userData.seat = pl.seat;
      scene.add(g);
      pieceGroups[`${pl.idx}-${pi}`] = g;
    }
  }
  placeAll();
}

function pawn(player, piece) { return pieceGroups[`${player}-${piece}`]; }

function baseVec(seat, pos, pi) {
  if (pos <= 0) return yardVec(seat, pi);
  if (pos >= HOME) return gateVec(seat);
  return cellVec(cellAt(geo, seat, pos));
}

function placeAll() {
  const groups = new Map();
  for (const pl of state.players) {
    pl.pieces.forEach((pos, pi) => {
      if (pos <= 0) { const v = yardVec(pl.seat, pi); pawn(pl.idx, pi).position.copy(v); return; }
      const keyk = pos >= HOME ? `home:${pl.seat}` : `cell:${cellAt(geo, pl.seat, pos)}`;
      if (!groups.has(keyk)) groups.set(keyk, []);
      groups.get(keyk).push({ pl, pi, pos });
    });
  }
  for (const members of groups.values()) {
    members.forEach((m, i) => {
      const b = baseVec(m.pl.seat, m.pos, m.pi);
      const [dx, dz] = fanXZ(i, members.length);
      pawn(m.pl.idx, m.pi).position.set(b.x + dx, b.y, b.z + dz);
    });
  }
}

// ---------- tweens ----------
const tweens = [];
function tweenTo(obj, to, dur, hop = 0) {
  return new Promise((res) => tweens.push({ obj, from: obj.position.clone(), to: to.clone(), t0: performance.now(), dur, hop, res }));
}
function stepTweens(now) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    const k = Math.min(1, (now - tw.t0) / tw.dur);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    tw.obj.position.lerpVectors(tw.from, tw.to, e);
    tw.obj.position.y += tw.hop * Math.sin(k * Math.PI);
    if (k >= 1) { tw.obj.position.copy(tw.to); tweens.splice(i, 1); tw.res(); }
  }
}

async function glide(move) {
  const seat = state.players[move.player].seat;
  const g = pawn(move.player, move.piece);
  const steps = move.from === 0 ? [1] : [];
  if (move.from !== 0) for (let p = move.from + 1; p <= move.to; p++) steps.push(p);
  for (const pos of steps) {
    const to = pos >= HOME ? gateVec(seat) : cellVec(cellAt(geo, seat, pos));
    await tweenTo(g, to, 150, 0.28);
    audio.sfx('step');
  }
}

// ---------- camera orbit ----------
const cam = { theta: 0.0, phi: 0.92, zoom: 1.0 };
let baseR = 20;
function fitRadius() {
  const fovy = camera.fov * Math.PI / 180;
  const fovx = 2 * Math.atan(Math.tan(fovy / 2) * camera.aspect);
  const extent = 17;
  return Math.max(extent / 2 / Math.tan(fovy / 2), extent / 2 / Math.tan(fovx / 2)) * 1.0;
}
function updateCamera() {
  baseR = fitRadius();
  const R = baseR / cam.zoom;
  const sp = Math.sin(cam.phi), cp = Math.cos(cam.phi);
  camera.position.set(target.x + R * sp * Math.sin(cam.theta), target.y + R * cp, target.z + R * sp * Math.cos(cam.theta));
  camera.lookAt(target);
}

// pointer: drag to orbit, wheel/pinch to zoom, tap to pick
let dragging = false, moved = false, lastX = 0, lastY = 0, pinchD = 0;
canvas.addEventListener('pointerdown', (e) => { dragging = true; moved = false; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
  cam.theta -= dx * 0.006;
  cam.phi = Math.max(0.35, Math.min(1.35, cam.phi - dy * 0.005));
  lastX = e.clientX; lastY = e.clientY;
});
canvas.addEventListener('pointerup', (e) => { dragging = false; if (!moved) pickAt(e.clientX, e.clientY); });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.zoom = Math.max(0.7, Math.min(2.2, cam.zoom * (e.deltaY < 0 ? 1.1 : 0.9))); }, { passive: false });
canvas.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2) {
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    if (pinchD) cam.zoom = Math.max(0.7, Math.min(2.2, cam.zoom * (d / pinchD)));
    pinchD = d; e.preventDefault();
  }
}, { passive: false });
canvas.addEventListener('touchend', () => { pinchD = 0; });

const raycaster = new THREE.Raycaster();
function pickAt(clientX, clientY) {
  if (!awaitingPick) return;
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const movable = pendingMoves.map((m) => pawn(m.player, m.piece)).filter(Boolean);
  const hits = raycaster.intersectObjects(movable, true);
  if (!hits.length) return;
  let o = hits[0].object;
  while (o && o.userData.player === undefined) o = o.parent;
  if (!o) return;
  const move = pendingMoves.find((m) => m.player === o.userData.player && m.piece === o.userData.piece);
  if (move) pick(move);
}

// ---------- game flow (mirrors game.js, 3D pawns) ----------
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function whoLabel() { const p = state.players[state.turn]; const ch = charOf(world, p.char); return `${(ch && ch.glyph) || ''} ${p.name}`; }

function renderRoster() {
  rosterEl.innerHTML = '';
  state.players.forEach((pl) => {
    const ch = charOf(world, pl.char);
    const row = document.createElement('div');
    row.className = 'rmp' + (pl.idx === state.turn && state.winner == null ? ' cur' : '') + (pl.pieces.every((p) => p >= HOME) ? ' won' : '');
    row.style.setProperty('--pc', pl.color);
    const pips = pl.pieces.map((p) => `<i class="pip ${p >= HOME ? 'home' : p > 0 ? 'active' : ''}"></i>`).join('');
    row.innerHTML = `<span class="g">${(ch && ch.glyph) || '●'}</span><span class="nm">${escapeHtml(pl.name)} <small>${ch ? ch.symbol || ch.name : ''}</small></span><span class="prog">${pips}</span>`;
    rosterEl.appendChild(row);
  });
}
function announceTurn(again) {
  statusEl.textContent = again ? `${whoLabel()} earns another throw.` : `${whoLabel()}'s turn — throw the cowries.`;
  renderRoster();
}
function renderCowries(shells) {
  cowriesEl.innerHTML = '';
  const s = shells || [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 6; i++) { const c = document.createElement('div'); c.className = 'cowrie' + (s[i] ? ' up' : ''); cowriesEl.appendChild(c); }
}

let movableSet = new Set();
function highlightMovable(moves) { movableSet = new Set(moves.map((m) => `${m.player}-${m.piece}`)); }
function clearHighlight() { movableSet = new Set(); }

async function onThrow() {
  if (busy || awaitingPick || state.winner != null) return;
  busy = true; throwBtn.disabled = true;
  audio.resume(); audio.sfx('throw');
  cowriesEl.classList.add('rolling');
  const t = throwCowries();
  currentThrow = t;
  await delay(420);
  renderCowries(t.shells);
  cowriesEl.classList.remove('rolling');
  throwValue.textContent = t.value; throwGrace.hidden = !t.grace;
  const moves = legalMoves(state, t);
  pendingMoves = moves;
  if (!moves.length) {
    statusEl.textContent = `${whoLabel()} threw ${t.value}${t.grace ? ' (grace)' : ''} — no move possible.`;
    await delay(800); busy = false; endThrow(t.grace); return;
  }
  highlightMovable(moves); awaitingPick = true; busy = false;
  statusEl.textContent = `${whoLabel()} threw ${t.value}${t.grace ? ' — a grace!' : ''} — tap a glowing piece.`;
  if (moves.length === 1) setTimeout(() => { if (awaitingPick && pendingMoves[0] === moves[0]) pick(moves[0]); }, 700);
}

async function pick(move) {
  if (!awaitingPick) return;
  awaitingPick = false; clearHighlight(); busy = true;
  const out = applyMove(state, move);
  await glide(move);
  if (out.captured.length) {
    audio.sfx('capture');
    for (const o of out.captured) { const g = pawn(o.player, o.piece); await tweenTo(g, yardVec(state.players[o.player].seat, o.piece), 380, 1.2); }
  } else if (out.event === 'home') audio.sfx('home');
  else if (move.castle) audio.sfx('castle');
  else audio.sfx('move');
  placeAll(); renderRoster();
  const teaching = out.won ? null : pickTeaching(move, out);
  if (teaching) await showReveal(teaching);
  if (out.won) { showWin(state.players[move.player]); busy = false; return; }
  endThrow(out.another); busy = false;
}

function pickTeaching(move, out) {
  const t = world.teachings || {};
  const rnd = (a) => (a && a.length ? a[Math.floor(Math.random() * a.length)] : null);
  const dec = (kind, e) => (e ? { kind, ...e } : null);
  if (out.captured.length) return dec('capture', rnd(t.capture));
  if (out.event === 'home') return dec('home', rnd(t.home));
  if (move.from === 0) return dec('enter', rnd(t.enter));
  if (move.castle) return dec('castle', rnd(t.castle));
  const crossed = (t.journey || []).filter((j) => j.at > move.from && j.at <= move.to).sort((a, b) => b.at - a.at)[0];
  return crossed ? dec('journey', crossed) : null;
}

function endThrow(another) {
  currentThrow = null; pendingMoves = [];
  throwValue.textContent = '—'; throwGrace.hidden = true;
  if (state.winner != null) return;
  if (!another) nextTurn(state);
  announceTurn(another); throwBtn.disabled = false;
}

function showWin(pl) {
  const t = world.teachings || {};
  const line = (t.win && t.win.length) ? t.win[Math.floor(Math.random() * t.win.length)] : null;
  winTitle.textContent = `🏵 ${pl.name} — ${world.goalLabel || 'the journey is complete'}`;
  winMeaning.textContent = (line && line.text) || world.goalMeaning || '';
  winOverlay.hidden = false;
  requestAnimationFrame(() => winOverlay.classList.add('show'));
  audio.sfx('win');
}

// ---------- reveal + narration (shared with the 2D board) ----------
function showReveal(teaching) {
  return new Promise((resolve) => {
    const labels = { enter: 'A soul sets out', castle: 'Refuge', capture: 'The wheel turns', home: 'Come home', win: 'Fulfilment', journey: 'On the road' };
    revealKind.textContent = labels[teaching.kind] || 'Teaching';
    revealKind.className = 'kind ' + teaching.kind;
    revealTitle.textContent = teaching.en || labels[teaching.kind] || '';
    revealText.innerHTML = '';
    const words = teaching.text.split(/\s+/).map((w, i, arr) => {
      const s = document.createElement('span'); s.className = 'w'; s.textContent = w; revealText.appendChild(s);
      if (i < arr.length - 1) revealText.appendChild(document.createTextNode(' '));
      return s;
    });
    reveal.hidden = false; requestAnimationFrame(() => reveal.classList.add('show'));
    let closed = false;
    const finish = () => {
      if (closed) return; closed = true; stopSpeak(words);
      reveal.classList.remove('show');
      continueBtn.removeEventListener('click', finish); skipBtn.removeEventListener('click', finish);
      currentFinish = null; setTimeout(() => { reveal.hidden = true; resolve(); }, 220);
    };
    currentFinish = finish;
    continueBtn.addEventListener('click', finish); skipBtn.addEventListener('click', finish);
    narrate(teaching.text, words, () => { fallbackTimer = setTimeout(finish, 900); });
  });
}
function pickVoice(lang) {
  const voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  if (!voices.length || !lang) return null;
  return voices.find((v) => v.lang && v.lang.toLowerCase() === lang.toLowerCase())
    || voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase())) || null;
}
function clearWords(words) { words.forEach((w) => w.classList.remove('on')); }
function timedHighlight(words, per, done) { let i = 0; const step = () => { clearWords(words); if (i < words.length) { words[i].classList.add('on'); i += 1; fallbackTimer = setTimeout(step, per); } else if (done) done(); }; step(); }
function stopSpeak(words) { if (window.speechSynthesis) speechSynthesis.cancel(); if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; } if (words) clearWords(words); }
function narrate(text, words, onend) {
  let ended = false; const done = () => { if (!ended) { ended = true; clearWords(words); onend(); } };
  if (!speakOn || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') { timedHighlight(words, 260, done); return; }
  const u = new SpeechSynthesisUtterance(text);
  const lang = (world.voice && world.voice.web) || 'en-IN';
  const v = pickVoice(lang); if (v) u.voice = v; u.lang = lang; u.rate = 0.96;
  u.onboundary = (e) => { if (e.name && e.name !== 'word') return; clearWords(words); let acc = 0; for (let k = 0; k < words.length; k++) { const wl = words[k].textContent.length + 1; if (e.charIndex < acc + wl) { words[k].classList.add('on'); break; } acc += wl; } };
  u.onend = done; u.onerror = done;
  fallbackTimer = setTimeout(done, Math.max(4000, text.length * 90));
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}

// ---------- theme + lifecycle ----------
function applyTheme(t) {
  const root = document.documentElement.style;
  const map = { '--bg': t.bg, '--panel': t.panel, '--board': t.board, '--cloth': t.cloth, '--line': t.line, '--accent': t.accent, '--castle': t.castle, '--text': t.text, '--muted': t.muted, '--font': t.font };
  for (const [k, v] of Object.entries(map)) if (v) root.setProperty(k, v);
  scene.background = hexColor(t.bg || '#140d1e');
  scene.fog = new THREE.Fog(new THREE.Color(t.bg || '#140d1e'), 26, 70);
}

async function loadWorld(id) {
  const res = await fetch(`worlds/${id}.json`);
  if (!res.ok) throw new Error(`Failed to load world ${id}`);
  world = validateWorld(await res.json());
  const cfg = gameForWorld(world);
  seatColor = {}; cfg.players.forEach((p) => { seatColor[p.seat] = p.color; });
  state = createGame(world, cfg.players, geo);
  applyTheme(world.theme);
  worldTitle.textContent = world.title; worldSubtitle.textContent = world.subtitle || '';
  document.title = `${world.title} — Pagade (3D)`;
  buildBoard(); buildPawns(); renderCowries(null); renderRoster();
  resetTransient(); announceTurn(false);
  updateCamera();
  audio.setMusic(`assets/${world.id}/music.mp3`);
  if (new URLSearchParams(location.search).has('nointro')) { audio.resume(); audio.startBed(); }
  else playIntro(world.id, { onDone: () => { audio.resume(); audio.startBed(); } });
}
function resetTransient() {
  awaitingPick = false; busy = false; currentThrow = null; pendingMoves = []; clearHighlight();
  throwValue.textContent = '—'; throwGrace.hidden = true; throwBtn.disabled = false;
  reveal.hidden = true; reveal.classList.remove('show'); winOverlay.hidden = true; winOverlay.classList.remove('show');
}
function newGame() { stopSpeak(); loadWorld(worldSelect.value).catch((e) => (statusEl.textContent = String(e.message || e))); }

// ---------- render loop ----------
function tick(now) {
  stepTweens(now);
  // pulse movable pawns
  const pulse = 0.45 + 0.5 * (0.5 + 0.5 * Math.sin(now * 0.006));
  for (const [k, g] of Object.entries(pieceGroups)) {
    const on = movableSet.has(k);
    g.userData.mat.emissiveIntensity = on ? pulse : g.userData.baseEmissive;
    g.scale.setScalar(on ? 0.86 + 0.05 * (0.5 + 0.5 * Math.sin(now * 0.006)) : 0.86);
  }
  if (charkoni) charkoni.rotation.y = now * 0.0002;
  updateCamera();
  composer.render();
  requestAnimationFrame(tick);
}

// ---------- events ----------
throwBtn.addEventListener('click', onThrow);
newGameBtn.addEventListener('click', newGame);
winNewGame.addEventListener('click', () => { winOverlay.classList.remove('show'); winOverlay.hidden = true; newGame(); });
worldSelect.addEventListener('change', () => { const l = $('#lnkLobby'); if (l) l.href = `setup.html?world=${worldSelect.value}`; const d = $('#lnk2d'); if (d) d.href = `play.html?world=${worldSelect.value}`; newGame(); });
soundBtn.addEventListener('click', () => { const on = !audio.isEnabled(); audio.setEnabled(on); soundBtn.setAttribute('aria-pressed', String(on)); soundBtn.textContent = on ? '🎵 Sound' : '🔇 Muted'; if (on) { audio.resume(); audio.startBed(); } });
voiceBtn.addEventListener('click', () => { speakOn = !speakOn; voiceBtn.setAttribute('aria-pressed', String(speakOn)); voiceBtn.textContent = speakOn ? '🔊 Read aloud' : '🔇 Silent'; if (!speakOn) stopSpeak(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && currentFinish) { currentFinish(); return; } if (e.code === 'Space' && reveal.hidden && winOverlay.hidden && !awaitingPick) { e.preventDefault(); onThrow(); } });
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); bloom.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); updateCamera(); });
if (window.speechSynthesis) { speechSynthesis.onvoiceschanged = () => {}; speechSynthesis.getVoices(); }
const kick = () => { audio.resume(); audio.startBed(); removeEventListener('pointerdown', kick); };
addEventListener('pointerdown', kick);

const wparam = new URLSearchParams(location.search).get('world');
if (wparam && [...worldSelect.options].some((o) => o.value === wparam)) worldSelect.value = wparam;
const l2 = $('#lnk2d'); if (l2) l2.href = `play.html?world=${worldSelect.value}`;
const ll = $('#lnkLobby'); if (ll) ll.href = `setup.html?world=${worldSelect.value}`;

updateCamera();
requestAnimationFrame(tick);
loadWorld(worldSelect.value).catch((e) => (statusEl.textContent = String(e.message || e)));

window.__pagade = { get state() { return state; }, get world() { return world; }, get awaitingPick() { return awaitingPick; }, get pendingMoves() { return pendingMoves; }, get busy() { return busy; }, geo, throw: onThrow, pick, loadWorld, mode: '3d' };
