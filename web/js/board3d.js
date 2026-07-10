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
const amb = new THREE.AmbientLight(0xffffff, 0.95);
const key = new THREE.DirectionalLight(0xfff0d8, 1.5);
key.position.set(6, 14, 8);
const rim = new THREE.DirectionalLight(0x88a0ff, 0.55);
rim.position.set(-8, 5, -6);
const hemi = new THREE.HemisphereLight(0xffe9c0, 0x241018, 0.6);
const glowLight = new THREE.PointLight(0xffdca0, 1.2, 44, 2);
glowLight.position.set(0, 5, 1);
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

// ---------- art direction ----------
let art = {};
let charkoni = null, charkoniFire = null, particles = null, partData = null;
let flickerMeshes = [];
let cowrieMeshes = [];
const cowrieAnims = [];
function hexColor(hex) { return new THREE.Color(hex); }
function mix(a, b, t) { return a.clone().lerp(b, t); }
let tileMesh = null;

// pawn silhouette profiles (radius, height) per world style
const PAWN_PROFILE = {
  stupa: [ // temple beehive + dome
    [0.00, 0.00], [0.40, 0.00], [0.42, 0.035], [0.37, 0.075], [0.41, 0.115], [0.35, 0.175],
    [0.37, 0.225], [0.30, 0.295], [0.31, 0.345], [0.23, 0.42], [0.235, 0.46], [0.15, 0.53],
    [0.14, 0.565], [0.07, 0.61], [0.03, 0.635], [0.0, 0.645],
  ],
  chariot: [ // squat, faceted bronze warrior/mace body
    [0.00, 0.00], [0.44, 0.00], [0.46, 0.05], [0.30, 0.10], [0.22, 0.16], [0.20, 0.34],
    [0.24, 0.40], [0.20, 0.46], [0.12, 0.50], [0.0, 0.51],
  ],
  pillar: [ // tall fluted Ashokan shaft
    [0.00, 0.00], [0.40, 0.00], [0.42, 0.05], [0.24, 0.10], [0.185, 0.16], [0.17, 0.60],
    [0.185, 0.64], [0.16, 0.68], [0.0, 0.69],
  ],
};

// ---------- board build (art-directed) ----------
function baseTileColor(scheme, cell, cloth, tileA, tileB) {
  if (scheme === 'checker') return ((cell.r + cell.c) % 2 === 0 ? tileA : tileB).clone().multiplyScalar(1.25);
  if (scheme === 'sandstone') { const v = 1.1 + 0.28 * (((cell.r * 7 + cell.c * 13) % 5) / 5); return tileA.clone().multiplyScalar(v); }
  return cloth.clone().multiplyScalar(1.5);
}

function buildBoard() {
  boardGroup.clear();
  cowrieMeshes = []; cowrieAnims.length = 0; particles = null; partData = null; charkoni = null; charkoniFire = null; flickerMeshes = [];
  art = world.theme3d || {};
  const scheme = art.tileScheme || 'cloth';
  const surf = art.surface || 'cloth';
  const cloth = hexColor(world.theme.cloth || '#3a2413');
  const boardBase = hexColor(world.theme.board || '#2a1a10');
  const tileA = hexColor(art.tileA || world.theme.cloth || '#3a2413');
  const tileB = hexColor(art.tileB || world.theme.board || '#2a1a10');
  const accent = hexColor(world.theme.accent || '#e8b64a');
  const castleCol = hexColor(world.theme.castle || '#f0c862');
  const glow = hexColor(art.glow || world.theme.accent || '#ffcf7a');

  const cells = [];
  for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) { const info = classify(r, c); if (info) cells.push({ r, c, info }); }

  const matParams = surf === 'stone' ? { roughness: 0.5, metalness: 0.28 }
    : surf === 'sandstone' ? { roughness: 0.82, metalness: 0.06 } : { roughness: 0.9, metalness: 0.03 };
  const tileGeo = new THREE.BoxGeometry(0.94, 0.16, 0.94);
  const tileMat = new THREE.MeshStandardMaterial({ vertexColors: true, ...matParams });
  tileMesh = new THREE.InstancedMesh(tileGeo, tileMat, cells.length);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  cells.forEach((cell, i) => {
    const p = vec(cell.r, cell.c, 0);
    dummy.position.set(p.x, 0, p.z); dummy.updateMatrix();
    tileMesh.setMatrixAt(i, dummy.matrix);
    const info = cell.info;
    const seatTint = hexColor(seatColor[info.seat] || '#caa06a');
    let base;
    if (info.kind === 'core') base = glow.clone().multiplyScalar(0.9);
    else if (info.kind === 'gate') base = mix(boardBase, seatTint, 0.62);
    else if (info.kind === 'home') {
      base = seatColor[info.seat] ? mix(baseTileColor(scheme, cell, cloth, tileA, tileB), seatTint, 0.58)
        : baseTileColor(scheme, cell, cloth, tileA, tileB).multiplyScalar(0.9);
    } else {
      base = baseTileColor(scheme, cell, cloth, tileA, tileB);
      if (info.castle) base = mix(base, castleCol, 0.4);
    }
    tileMesh.setColorAt(i, col.copy(base));
  });
  tileMesh.instanceColor.needsUpdate = true;
  boardGroup.add(tileMesh);

  // castle star markers (emissive -> bloom)
  const starGeo = new THREE.OctahedronGeometry(0.12, 0);
  const starMat = new THREE.MeshStandardMaterial({ color: 0x2a1a0a, emissive: castleCol, emissiveIntensity: 1.3, roughness: 0.3, metalness: 0.4 });
  for (const id of geo.castles) { const { row, col: cc } = cellRC(id); const s = new THREE.Mesh(starGeo, starMat); s.position.copy(vec(row, cc, 0.24)); boardGroup.add(s); }

  // board slab + a wide ground plane for the environment
  const slab = new THREE.Mesh(new THREE.BoxGeometry(15.8, 0.4, 15.8), new THREE.MeshStandardMaterial({ color: boardBase.clone().multiplyScalar(0.6), roughness: 0.95 }));
  slab.position.y = -0.22; boardGroup.add(slab);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshStandardMaterial({ color: hexColor(art.ground || world.theme.bg || '#0c0716'), roughness: 1, metalness: 0 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.42; boardGroup.add(ground);

  buildCharkoni(art.charkoni || 'lotus', accent, castleCol, glow);
  buildProps(art.props || 'lamps', glow);
  buildParticles(art.particles || 'motes', glow);
  buildCowries3d();
}

function buildCharkoni(style, accent, castleCol, glow) {
  const g = new THREE.Group();
  if (style === 'fire') {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.5, 0.16, 40), new THREE.MeshStandardMaterial({ color: 0x2a1410, roughness: 0.7, metalness: 0.4 }));
    disc.position.y = 0.1; g.add(disc);
    charkoniFire = new THREE.Mesh(new THREE.SphereGeometry(0.58, 24, 18), new THREE.MeshStandardMaterial({ color: glow, emissive: glow, emissiveIntensity: 1.7, roughness: 0.4 }));
    charkoniFire.position.y = 0.38; charkoniFire.userData.baseEmissive = 1.7; flickerMeshes.push(charkoniFire); g.add(charkoniFire);
  } else if (style === 'chakra') {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.55, 0.14, 40), new THREE.MeshStandardMaterial({ color: accent.clone().multiplyScalar(0.9), emissive: accent, emissiveIntensity: 0.35, roughness: 0.5, metalness: 0.3 }));
    disc.position.y = 0.1; g.add(disc);
    const wheelMat = new THREE.MeshStandardMaterial({ color: castleCol, emissive: castleCol, emissiveIntensity: 1.1, roughness: 0.3, metalness: 0.5 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.07, 12, 48), wheelMat); rim.rotation.x = Math.PI / 2; rim.position.y = 0.22; g.add(rim);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.1, 20), wheelMat); hub.position.y = 0.24; g.add(hub);
    const spokeGeo = new THREE.BoxGeometry(0.04, 0.06, 1.05);
    for (let i = 0; i < 12; i++) { const s = new THREE.Mesh(spokeGeo, wheelMat); s.position.y = 0.22; s.rotation.y = (i / 12) * Math.PI * 2; g.add(s); }
  } else { // lotus
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.45, 0.14, 40), new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.6, roughness: 0.35, metalness: 0.6 }));
    disc.position.y = 0.12; g.add(disc);
    const petalMat = new THREE.MeshStandardMaterial({ color: castleCol, emissive: castleCol, emissiveIntensity: 0.9, roughness: 0.35, metalness: 0.4 });
    const petalGeo = new THREE.ConeGeometry(0.28, 0.75, 4); petalGeo.scale(1, 1, 0.5);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const pe = new THREE.Mesh(petalGeo, petalMat); pe.position.set(Math.cos(a) * 1.2, 0.22, Math.sin(a) * 1.2); pe.rotation.set(Math.PI / 2.2, -a, 0); g.add(pe); }
    const ringM = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.06, 12, 48), petalMat); ringM.rotation.x = Math.PI / 2; ringM.position.y = 0.2; g.add(ringM);
  }
  charkoni = g; boardGroup.add(g);
}

const TIPS = [[14, 7], [7, 14], [0, 7], [7, 0]];
function buildProps(style, glow) {
  const g = new THREE.Group();
  const flameMat = new THREE.MeshStandardMaterial({ color: glow, emissive: glow, emissiveIntensity: 2.4, roughness: 0.5 });
  for (const [tr, tc] of TIPS) {
    const base = vec(tr, tc, 0);
    const dir = new THREE.Vector3(base.x, 0, base.z).normalize().multiplyScalar(0.9); // push just beyond the tip
    const x = base.x + dir.x, z = base.z + dir.z;
    if (style === 'torches') {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 1.6, 10), new THREE.MeshStandardMaterial({ color: 0x2a1810, roughness: 0.8 }));
      post.position.set(x, 0.8, z); g.add(post);
      const fire = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), flameMat.clone()); fire.position.set(x, 1.7, z); fire.userData.baseEmissive = 2.4; flickerMeshes.push(fire); g.add(fire);
    } else if (style === 'pillars') {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.5, 14), new THREE.MeshStandardMaterial({ color: 0x9a7a44, roughness: 0.7 }));
      shaft.position.set(x, 0.75, z); g.add(shaft);
      const bell = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.35, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0xb08a4e, roughness: 0.6, side: THREE.DoubleSide })); bell.position.set(x, 1.6, z); bell.rotation.x = Math.PI; g.add(bell);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), new THREE.MeshStandardMaterial({ color: glow, emissive: glow, emissiveIntensity: 0.8, roughness: 0.4, metalness: 0.4 })); cap.position.set(x, 1.85, z); g.add(cap);
    } else { // lamps (diya)
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.16, 0.16, 16), new THREE.MeshStandardMaterial({ color: 0x6a4a26, roughness: 0.5, metalness: 0.5 }));
      bowl.position.set(x, 0.28, z); g.add(bowl);
      const fire = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), flameMat.clone()); fire.scale.set(1, 1.5, 1); fire.position.set(x, 0.5, z); fire.userData.baseEmissive = 2.4; fire.userData.baseScaleY = 1.5; flickerMeshes.push(fire); g.add(fire);
    }
  }
  boardGroup.add(g);
}

function buildParticles(style, glow) {
  const N = MOBILE ? 40 : 80;
  const pos = new Float32Array(N * 3);
  partData = { vy: new Float32Array(N), vx: new Float32Array(N), style };
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 22;
    pos[i * 3 + 1] = Math.random() * 9;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 22;
    if (style === 'embers') { partData.vy[i] = 0.008 + Math.random() * 0.02; partData.vx[i] = (Math.random() - 0.5) * 0.004; }
    else if (style === 'dust') { partData.vy[i] = (Math.random() - 0.5) * 0.004; partData.vx[i] = 0.006 + Math.random() * 0.01; }
    else { partData.vy[i] = 0.003 + Math.random() * 0.006; partData.vx[i] = (Math.random() - 0.5) * 0.003; }
  }
  const geoP = new THREE.BufferGeometry();
  geoP.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: glow, size: style === 'embers' ? 0.13 : style === 'dust' ? 0.1 : 0.09, transparent: true, opacity: style === 'dust' ? 0.5 : 0.8, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
  particles = new THREE.Points(geoP, mat);
  boardGroup.add(particles);
}

// ---------- pawns (per-world sculpts) ----------
const _pawnGeoCache = {};
function pawnGeoFor(style) {
  if (_pawnGeoCache[style]) return _pawnGeoCache[style];
  const seg = style === 'chariot' ? 10 : style === 'pillar' ? 20 : 28;
  const g = new THREE.LatheGeometry((PAWN_PROFILE[style] || PAWN_PROFILE.stupa).map(([x, y]) => new THREE.Vector2(x, y)), seg);
  g.computeVertexNormals();
  _pawnGeoCache[style] = g;
  return g;
}
const _finialGeo = new THREE.SphereGeometry(0.06, 14, 10);
const _spikeGeo = new THREE.ConeGeometry(0.05, 0.14, 12);
const _maceGeo = new THREE.IcosahedronGeometry(0.18, 0);
const _diskGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.05, 18);
const _torusGeo = new THREE.TorusGeometry(0.14, 0.03, 8, 20);

function makePawn(color, style, accent) {
  const c = hexColor(color);
  const gold = hexColor(accent || '#f0c862');
  const metal = style === 'chariot' ? 0.75 : style === 'pillar' ? 0.15 : 0.35;
  const rough = style === 'chariot' ? 0.3 : style === 'pillar' ? 0.6 : 0.32;
  const emI = style === 'chariot' ? 0.6 : style === 'pillar' ? 0.4 : 0.5;
  const mat = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: emI, roughness: rough, metalness: metal });
  const goldMat = new THREE.MeshStandardMaterial({ color: gold, emissive: gold, emissiveIntensity: 0.7, roughness: 0.3, metalness: 0.6 });
  const g = new THREE.Group();
  const body = new THREE.Mesh(pawnGeoFor(style), mat);
  g.add(body);
  if (style === 'chariot') {
    const mace = new THREE.Mesh(_maceGeo, mat); mace.position.y = 0.6; g.add(mace);
    const spike = new THREE.Mesh(_spikeGeo, goldMat); spike.position.y = 0.82; g.add(spike);
  } else if (style === 'pillar') {
    const bell = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.16, 16, 1, true), goldMat); bell.position.y = 0.7; bell.rotation.x = Math.PI; g.add(bell);
    const abacus = new THREE.Mesh(_diskGeo, goldMat); abacus.position.y = 0.8; g.add(abacus);
    const chakra = new THREE.Mesh(_torusGeo, goldMat); chakra.position.y = 0.9; chakra.rotation.x = Math.PI / 2; g.add(chakra);
  } else { // stupa
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat); dome.position.y = 0.6; g.add(dome);
    const finial = new THREE.Mesh(_finialGeo, goldMat); finial.position.y = 0.72; g.add(finial);
  }
  g.userData.mat = mat;
  g.userData.baseEmissive = emI;
  g.userData.baseScale = style === 'pillar' ? 0.82 : 0.86;
  g.scale.setScalar(g.userData.baseScale);
  return g;
}

function buildPawns() {
  Object.values(pieceGroups).forEach((g) => scene.remove(g));
  pieceGroups = {};
  const style = (world.theme3d && world.theme3d.pawn) || 'stupa';
  const accent = world.theme.accent;
  for (const pl of state.players) {
    for (let pi = 0; pi < pl.pieces.length; pi++) {
      const g = makePawn(pl.color, style, accent);
      g.userData.player = pl.idx; g.userData.piece = pi; g.userData.seat = pl.seat;
      scene.add(g);
      pieceGroups[`${pl.idx}-${pi}`] = g;
    }
  }
  placeAll();
}

// ---------- 3D cowrie shells (the throw) ----------
// resting spots in a loose arc in front of the Charkoni (toward South / the camera)
const COWRIE_LAND = [[-1.6, 2.6], [-1.0, 3.3], [-0.35, 2.7], [0.35, 3.3], [1.0, 2.7], [1.6, 3.3]];
const _shellGeo = (() => { const g = new THREE.SphereGeometry(0.5, 18, 14); g.scale(0.34, 0.2, 0.48); return g; })();
const _slitGeo = new THREE.BoxGeometry(0.05, 0.05, 0.36);
function makeCowrie() {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(_shellGeo, new THREE.MeshStandardMaterial({ color: 0xefe4cf, roughness: 0.45, metalness: 0.05 }));
  g.add(shell);
  const slit = new THREE.Mesh(_slitGeo, new THREE.MeshStandardMaterial({ color: 0x2a1a0e, roughness: 0.85 }));
  slit.position.y = -0.09; g.add(slit);
  g.visible = false;
  return g;
}
function buildCowries3d() {
  cowrieMeshes = [];
  for (let i = 0; i < 6; i++) { const c = makeCowrie(); boardGroup.add(c); cowrieMeshes.push(c); }
}
// tumble the 6 cowries onto the board, settling to a predetermined result (shells[i]=1 -> mouth up)
function throwCowries3d(shells) {
  return new Promise((resolve) => {
    cowrieAnims.length = 0;
    if (!cowrieMeshes.length) { resolve(); return; }
    let pending = 6;
    const done = () => { if (--pending <= 0) resolve(); };
    for (let i = 0; i < 6; i++) {
      const c = cowrieMeshes[i];
      c.visible = true;
      const [lx, lz] = COWRIE_LAND[i];
      const from = new THREE.Vector3(lx * 0.35 + (Math.random() - 0.5), 4 + Math.random() * 1.6, lz - 1.4 + (Math.random() - 0.5));
      const to = new THREE.Vector3(lx + (Math.random() - 0.5) * 0.25, 0.2, lz + (Math.random() - 0.5) * 0.25);
      c.position.copy(from);
      cowrieAnims.push({
        c, from, to,
        rx: shells[i] ? Math.PI : 0,            // flat/slit side up == mouth up
        ry: Math.random() * Math.PI * 2,
        spinX: (2 + Math.floor(Math.random() * 3)) * Math.PI * 2,
        spinZ: (Math.random() - 0.5) * 6 * Math.PI,
        t0: performance.now() + i * 55, dur: 640 + Math.random() * 180, hop: 1.5, res: done,
      });
    }
  });
}
function stepCowries(now) {
  for (let i = cowrieAnims.length - 1; i >= 0; i--) {
    const a = cowrieAnims[i];
    const k = Math.min(1, Math.max(0, (now - a.t0) / a.dur));
    const e = 1 - Math.pow(1 - k, 3);
    a.c.position.lerpVectors(a.from, a.to, e);
    a.c.position.y += Math.sin(Math.min(1, k) * Math.PI) * a.hop * (1 - k * 0.35);
    a.c.rotation.set(a.rx + (1 - e) * a.spinX, a.ry, (1 - e) * a.spinZ);
    if (k >= 1) { a.c.position.copy(a.to); a.c.rotation.set(a.rx, a.ry, 0); cowrieAnims.splice(i, 1); a.res(); }
  }
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
  statusEl.textContent = `${whoLabel()} casts the cowries…`;
  await throwCowries3d(t.shells);
  audio.sfx('step');
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
  stepCowries(now);
  // pulse movable pawns
  const s = 0.5 + 0.5 * Math.sin(now * 0.006);
  for (const [k, g] of Object.entries(pieceGroups)) {
    const on = movableSet.has(k);
    const base = g.userData.baseScale || 0.86;
    g.userData.mat.emissiveIntensity = on ? (g.userData.baseEmissive + 0.5 * s) : g.userData.baseEmissive;
    g.scale.setScalar(on ? base + 0.06 * s : base);
  }
  // ambient particles
  if (particles && partData) {
    const p = particles.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let y = p.getY(i) + partData.vy[i];
      let x = p.getX(i) + partData.vx[i];
      if (partData.style === 'dust') { if (x > 11) x = -11; if (x < -11) x = 11; if (y > 9 || y < 0) y = Math.random() * 2; }
      else { if (y > 9) { y = 0; x = (Math.random() - 0.5) * 22; } }
      p.setX(i, x); p.setY(i, y);
    }
    p.needsUpdate = true;
  }
  // flicker fires
  for (const f of flickerMeshes) {
    const fl = 0.7 + 0.5 * Math.sin(now * 0.02 + f.position.x * 3) + 0.15 * Math.sin(now * 0.05 + f.position.z);
    f.material.emissiveIntensity = (f.userData.baseEmissive || 2) * Math.max(0.5, fl);
    f.scale.y = (f.userData.baseScaleY || 1) * (0.92 + 0.16 * Math.max(0, fl - 0.7));
  }
  if (charkoni) charkoni.rotation.y = now * 0.00018;
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
