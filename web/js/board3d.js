// board3d.js — the 3D Pagade renderer (Three.js). Same pure engine (pachisi.js) as the 2D board,
// drawn as a real 3D cruciform with glowing beehive pawns, a bloom-lit Charkoni, an orbit camera,
// and the shared DOM HUD / Teaching Reveal. Themed per world.
import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { EffectComposer } from '../vendor/EffectComposer.js';
import { RenderPass } from '../vendor/RenderPass.js';
import { UnrealBloomPass } from '../vendor/UnrealBloomPass.js';
import { OutputPass } from '../vendor/OutputPass.js';
import {
  buildGeometry, cellAt, cellRC, isCastle, HOME, GRID,
  throwCowries, createGame, legalMoves, evaluateMove, applyMove, nextTurn, validateWorld,
} from './pachisi.js';
import { gameForWorld, charOf, pawnStyleFor } from './config.js';
import * as audio from './audio.js';
import { playIntro } from './intro.js';
import { setVoice, narrate, stopSpeak } from './narrate.js';

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
let starfield = null;
let cowrieMeshes = [];
const cowrieAnims = [];
function hexColor(hex) { return new THREE.Color(hex); }
function mix(a, b, t) { return a.clone().lerp(b, t); }
let tileMesh = null;

// pawn silhouette profiles (radius, height) per style
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
  lotus: [ // a lotus bud on a base
    [0.00, 0.00], [0.36, 0.00], [0.40, 0.05], [0.30, 0.11], [0.26, 0.17], [0.40, 0.30],
    [0.36, 0.42], [0.24, 0.52], [0.12, 0.60], [0.04, 0.64], [0.0, 0.65],
  ],
  kalash: [ // a sacred pot (bulbous body, narrow neck, flared mouth)
    [0.00, 0.00], [0.30, 0.00], [0.34, 0.04], [0.22, 0.10], [0.30, 0.18], [0.42, 0.30],
    [0.39, 0.42], [0.24, 0.50], [0.17, 0.54], [0.22, 0.60], [0.20, 0.63], [0.0, 0.64],
  ],
};
const STYLE_ALIAS = { warrior: 'chariot' };

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

  buildEnvironment(art, glow);
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
      buildAshokaPillar(g, x, z, glow);
    } else { // lamps (diya)
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.16, 0.16, 16), new THREE.MeshStandardMaterial({ color: 0x6a4a26, roughness: 0.5, metalness: 0.5 }));
      bowl.position.set(x, 0.28, z); g.add(bowl);
      const fire = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), flameMat.clone()); fire.scale.set(1, 1.5, 1); fire.position.set(x, 0.5, z); fire.userData.baseEmissive = 2.4; fire.userData.baseScaleY = 1.5; flickerMeshes.push(fire); g.add(fire);
    }
  }
  boardGroup.add(g);
}

function buildAshokaPillar(g, x, z, glow) {
  const sand = new THREE.MeshStandardMaterial({ color: 0xc9a465, roughness: 0.62, metalness: 0.08 });
  const lion = new THREE.MeshStandardMaterial({ color: 0xdcb46e, emissive: 0x3a2a10, emissiveIntensity: 0.3, roughness: 0.5, metalness: 0.15 });
  const gold = new THREE.MeshStandardMaterial({ color: glow, emissive: glow, emissiveIntensity: 0.75, roughness: 0.4, metalness: 0.6 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.2, 18), sand); base.position.set(x, 0.1, z); g.add(base);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.19, 2.3, 20), sand); shaft.position.set(x, 1.35, z); g.add(shaft);
  // inverted-lotus (Persian bell) capital, flaring downward
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.36, 0.36, 20), sand); bell.position.set(x, 2.66, z); g.add(bell);
  const abacus = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.14, 20), sand); abacus.position.set(x, 2.9, z); g.add(abacus);
  // four addorsed Asiatic lions, back to back, facing outward
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), lion);
    body.scale.set(0.85, 0.9, 1.5); body.position.set(x + Math.cos(a) * 0.12, 3.06, z + Math.sin(a) * 0.12); body.rotation.y = -a; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.095, 12, 10), lion); head.position.set(x + Math.cos(a) * 0.24, 3.16, z + Math.sin(a) * 0.24); g.add(head);
    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.1, 8), lion); snout.position.set(x + Math.cos(a) * 0.31, 3.11, z + Math.sin(a) * 0.31); snout.rotation.z = -Math.PI / 2; snout.rotation.y = -a; g.add(snout);
  }
  // crowning Ashoka Chakra (24-spoke wheel, simplified to 12)
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.028, 8, 28), gold); wheel.position.set(x, 3.42, z); wheel.rotation.x = Math.PI / 2; g.add(wheel);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.05, 12), gold); hub.position.set(x, 3.42, z); g.add(hub);
  for (let i = 0; i < 12; i++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.34), gold); sp.position.set(x, 3.42, z); sp.rotation.y = (i / 12) * Math.PI * 2; g.add(sp); }
}

// ---------- distant 3D world (sky dome + starfield + horizon skyline) ----------
function buildSilhouette(kind, mat) {
  const g = new THREE.Group();
  if (kind === 'torches') { // Mughal palace: hall + dome + minarets
    const hall = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 1.2), mat); hall.position.y = 0.8; g.add(hall);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat); dome.position.y = 1.6; g.add(dome);
    for (const s of [-1, 1]) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 2.2, 8), mat); m.position.set(s * 1.3, 1.1, 0); g.add(m); const md = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat); md.position.set(s * 1.3, 2.2, 0); g.add(md); }
  } else if (kind === 'pillars') { // stupa domes + a pillar (ancient India)
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.0, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat); dome.position.y = 0.4; dome.scale.y = 0.8; g.add(dome);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.9, 8), mat); spire.position.y = 1.35; g.add(spire);
    const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 2.4, 8), mat); pil.position.set(1.5, 1.2, 0); g.add(pil);
  } else { // temple shikhara towers (dharma / default)
    let w = 1.4, y = 0; for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.6, w), mat); b.position.y = y + 0.3; g.add(b); y += 0.55; w *= 0.78; }
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.9, 8), mat); fin.position.y = y + 0.3; g.add(fin);
  }
  return g;
}

function buildEnvironment(art, glow) {
  const top = hexColor(art.ground || world.theme.bg || '#0c0716');
  // gradient sky dome
  const skyGeo = new THREE.SphereGeometry(240, 24, 16);
  const horizon = mix(hexColor(glow), top, 0.72);
  const pos = skyGeo.attributes.position, cols = [];
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) / 240; const t = Math.max(0, Math.min(1, (y + 0.12) / 0.55)); const cc = mix(horizon, top, t); cols.push(cc.r, cc.g, cc.b); }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }));
  boardGroup.add(sky);
  // starfield
  const N = MOBILE ? 160 : 320;
  const sp = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { const r = 150 + Math.random() * 70; const th = Math.random() * Math.PI * 2; const ph = Math.random() * Math.PI * 0.5 + 0.08; sp[i * 3] = r * Math.sin(ph) * Math.cos(th); sp[i * 3 + 1] = r * Math.cos(ph); sp[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  starfield = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xfff2d0, size: 0.9, sizeAttenuation: true, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
  boardGroup.add(starfield);
  // distant themed skyline
  const silMat = new THREE.MeshStandardMaterial({ color: mix(top, hexColor('#000000'), 0.25), emissive: hexColor(glow), emissiveIntensity: 0.14, roughness: 1, metalness: 0 });
  const count = MOBILE ? 16 : 30;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.12;
    const rr = 30 + Math.random() * 10;
    const s = buildSilhouette(art.props, silMat);
    s.position.set(Math.cos(a) * rr, -0.4, Math.sin(a) * rr);
    s.rotation.y = -a + Math.PI / 2;
    s.scale.setScalar(2.4 + Math.random() * 2.8);
    boardGroup.add(s);
  }
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

// ---------- pawns (per-world / per-player sculpts) ----------
const _pawnGeoCache = {};
function pawnGeoFor(style) {
  if (_pawnGeoCache[style]) return _pawnGeoCache[style];
  const seg = style === 'chariot' ? 10 : style === 'pillar' ? 20 : style === 'lotus' ? 12 : 28;
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
const _petalGeo = (() => { const g = new THREE.ConeGeometry(0.1, 0.34, 4); g.scale(1, 1, 0.5); return g; })();

// ---------- realistic carved GLB pawns (realistic-3d-objects skill) ----------
// Hand-carved ivory figurines authored via gpt-image-2 -> TripoSR -> Blender concept-projection.
// Loaded once (world-independent), then cloned + tinted toward each player's seat colour: the baked
// ivory map keeps the carved relief while we multiply it toward the hue and add a soft emissive so
// the bloom pass makes the piece glow. Procedural makePawn() stays as the fallback if a GLB is
// missing, so the board never breaks.
const PAWN_MODELS = {};                 // key -> normalised THREE.Group template (base at y=0)
const PAWN_KEYS = ['stupa', 'warrior', 'lotus', 'kalash', 'elephant', 'pillar'];
const PAWN_TARGET_H = 1.08;             // normalised pawn height (a touch taller than the procedural piece)
const glbKey = (style) => (style === 'chariot' ? 'warrior' : style); // themed mahabharata -> warrior
let pawnModelsLoaded = null;
function normalizePawn(obj, targetH) {
  let box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3(); box.getSize(size);
  obj.scale.setScalar(targetH / (size.y || 1));
  obj.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(obj);
  const c = new THREE.Vector3(); box.getCenter(c);
  obj.position.set(-c.x, -box.min.y, -c.z);   // centre on XZ, rest base on y=0
}
function loadPawnModels() {
  if (pawnModelsLoaded) return pawnModelsLoaded;
  const loader = new GLTFLoader();
  const one = (k) => new Promise((resolve) => {
    loader.load(`assets/models/${k}.glb`,
      (gltf) => { try { normalizePawn(gltf.scene, PAWN_TARGET_H); const t = new THREE.Group(); t.add(gltf.scene); PAWN_MODELS[k] = t; } catch { /* ignore */ } resolve(); },
      undefined,
      () => resolve());   // missing GLB -> procedural fallback
  });
  pawnModelsLoaded = Promise.all(PAWN_KEYS.map(one));
  return pawnModelsLoaded;
}
function makePawnGLB(color, style) {
  const tmpl = PAWN_MODELS[glbKey(style)];
  if (!tmpl) return null;
  const c = hexColor(color);
  const g = tmpl.clone(true);
  let mainMat = null;
  g.traverse((n) => {
    if (!n.isMesh) return;
    n.castShadow = true;
    const m = n.material.clone();
    // tint the baked ivory carving toward the seat hue but keep it slightly lightened so the
    // carved relief (brown recesses on cream) still reads; emissive uses the full saturated hue
    // so the bloom pass gives each carved piece a glorious coloured glow.
    m.color = c.clone().lerp(new THREE.Color(0xffffff), 0.18);
    m.emissive = c.clone();
    m.emissiveIntensity = 0.3;      // soft base glow (pulsed brighter on select)
    m.roughness = 0.5; m.metalness = 0.12;
    m.needsUpdate = true;
    n.material = m;
    if (!mainMat) mainMat = m;
  });
  g.userData.mat = mainMat;
  g.userData.baseEmissive = 0.3;
  g.userData.baseScale = 1;
  g.scale.setScalar(1);
  return g;
}

function makePawn(color, style, accent) {
  style = STYLE_ALIAS[style] || style;
  const c = hexColor(color);
  const gold = hexColor(accent || '#f0c862');
  const metal = style === 'chariot' ? 0.75 : style === 'pillar' || style === 'kalash' ? 0.15 : style === 'lotus' ? 0.25 : 0.35;
  const rough = style === 'chariot' ? 0.3 : style === 'pillar' ? 0.6 : 0.32;
  const emI = style === 'chariot' ? 0.6 : style === 'pillar' ? 0.4 : 0.5;
  const mat = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: emI, roughness: rough, metalness: metal });
  const goldMat = new THREE.MeshStandardMaterial({ color: gold, emissive: gold, emissiveIntensity: 0.7, roughness: 0.3, metalness: 0.6 });
  const g = new THREE.Group();

  if (style === 'elephant') {
    // stylized Gaja: rounded body + head + trunk + ears + tusks
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 16), mat); body.scale.set(1, 0.85, 1.15); body.position.y = 0.34; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 18, 14), mat); head.position.set(0, 0.5, 0.26); g.add(head);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.34, 10), mat); trunk.position.set(0, 0.36, 0.46); trunk.rotation.x = 0.7; g.add(trunk);
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), mat); ear.scale.set(0.5, 1, 0.2); ear.position.set(s * 0.22, 0.52, 0.18); g.add(ear);
      const tusk = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.16, 8), goldMat); tusk.position.set(s * 0.08, 0.4, 0.42); tusk.rotation.x = 1.9; g.add(tusk);
    }
    const cap = new THREE.Mesh(_torusGeo, goldMat); cap.position.set(0, 0.66, 0.2); cap.rotation.x = Math.PI / 2; g.add(cap);
  } else {
    const body = new THREE.Mesh(pawnGeoFor(style), mat);
    g.add(body);
    if (style === 'chariot') {
      const mace = new THREE.Mesh(_maceGeo, mat); mace.position.y = 0.6; g.add(mace);
      const spike = new THREE.Mesh(_spikeGeo, goldMat); spike.position.y = 0.82; g.add(spike);
    } else if (style === 'pillar') {
      const bell = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.16, 16, 1, true), goldMat); bell.position.y = 0.7; bell.rotation.x = Math.PI; g.add(bell);
      const abacus = new THREE.Mesh(_diskGeo, goldMat); abacus.position.y = 0.8; g.add(abacus);
      const chakra = new THREE.Mesh(_torusGeo, goldMat); chakra.position.y = 0.9; chakra.rotation.x = Math.PI / 2; g.add(chakra);
    } else if (style === 'lotus') {
      const petalMat = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.55, roughness: 0.3, metalness: 0.2 });
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const pe = new THREE.Mesh(_petalGeo, petalMat); pe.position.set(Math.cos(a) * 0.14, 0.5, Math.sin(a) * 0.14); pe.rotation.set(0.5, -a, 0); g.add(pe); }
      const bud = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.24, 10), mat); bud.position.y = 0.72; g.add(bud);
    } else if (style === 'kalash') {
      const coco = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), new THREE.MeshStandardMaterial({ color: 0x8a5a2a, roughness: 0.7 })); coco.position.y = 0.72; g.add(coco);
      const leafMat = new THREE.MeshStandardMaterial({ color: 0x3fae5a, emissive: 0x1f5a2e, emissiveIntensity: 0.25, roughness: 0.5 });
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const lf = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 6), leafMat); lf.position.set(Math.cos(a) * 0.15, 0.66, Math.sin(a) * 0.15); lf.rotation.set(0.8, -a, 0); g.add(lf); }
    } else { // stupa
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat); dome.position.y = 0.6; g.add(dome);
      const finial = new THREE.Mesh(_finialGeo, goldMat); finial.position.y = 0.72; g.add(finial);
    }
  }
  g.userData.mat = mat;
  g.userData.baseEmissive = emI;
  g.userData.baseScale = style === 'pillar' ? 0.82 : style === 'elephant' ? 0.9 : 0.86;
  g.scale.setScalar(g.userData.baseScale);
  return g;
}

function buildPawns() {
  Object.values(pieceGroups).forEach((g) => scene.remove(g));
  pieceGroups = {};
  const accent = world.theme.accent;
  for (const pl of state.players) {
    const style = pawnStyleFor(world, pl);
    for (let pi = 0; pi < pl.pieces.length; pi++) {
      const g = makePawnGLB(pl.color, style) || makePawn(pl.color, style, accent);
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
    let settled = false;
    const finish = () => { if (settled) return; settled = true; resolve(); };
    let pending = 6;
    const done = () => { if (--pending <= 0) finish(); };
    // hard safety: never let the throw hang the turn even if a frame is dropped
    setTimeout(finish, 2200);
    for (let i = 0; i < 6; i++) {
      const c = cowrieMeshes[i];
      if (!c) { done(); continue; }
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
canvas.addEventListener('pointerdown', (e) => { dragging = true; moved = false; lastX = e.clientX; lastY = e.clientY; try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ } });
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  if (Math.abs(dx) + Math.abs(dy) > 8) moved = true;
  cam.theta -= dx * 0.006;
  cam.phi = Math.max(0.35, Math.min(1.35, cam.phi - dy * 0.005));
  lastX = e.clientX; lastY = e.clientY;
});
canvas.addEventListener('pointerup', (e) => { const wasDrag = moved; dragging = false; try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ } if (!wasDrag) pickAt(e.clientX, e.clientY); });
canvas.addEventListener('pointercancel', () => { dragging = false; });
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
  if (!awaitingPick || busy) return;
  const rect = canvas.getBoundingClientRect();
  const px = clientX - rect.left, py = clientY - rect.top;
  const ndc = new THREE.Vector2((px / rect.width) * 2 - 1, -(py / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const movable = pendingMoves.map((m) => ({ m, g: pawn(m.player, m.piece) })).filter((x) => x.g);
  let chosen = null;
  const hits = raycaster.intersectObjects(movable.map((x) => x.g), true);
  if (hits.length) {
    let o = hits[0].object;
    while (o && o.userData.player === undefined) o = o.parent;
    if (o) chosen = pendingMoves.find((m) => m.player === o.userData.player && m.piece === o.userData.piece);
  }
  if (!chosen) {
    // forgiving fallback: pick the movable pawn nearest the tap in screen space
    let bestD = 48;
    for (const { m, g } of movable) {
      const wp = g.position.clone(); wp.y += 0.4; wp.project(camera);
      const sx = (wp.x * 0.5 + 0.5) * rect.width, sy = (-wp.y * 0.5 + 0.5) * rect.height;
      const d = Math.hypot(sx - px, sy - py);
      if (d < bestD) { bestD = d; chosen = m; }
    }
  }
  if (chosen) pick(chosen);
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
  try {
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
  } catch (e) {
    console.warn('onThrow recovered:', e);
    cowriesEl.classList.remove('rolling'); busy = false; awaitingPick = false; throwBtn.disabled = false;
    statusEl.textContent = `${whoLabel()}'s turn — throw the cowries.`;
  }
}

async function pick(move) {
  if (!awaitingPick) return;
  awaitingPick = false; clearHighlight(); busy = true;
  try {
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
  } catch (e) {
    console.warn('pick recovered:', e);
    try { placeAll(); renderRoster(); } catch (e2) { /* ignore */ }
    busy = false; endThrow(false);
  }
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
    let autoTimer = null;
    const finish = () => {
      if (closed) return; closed = true; if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; } stopSpeak(words);
      reveal.classList.remove('show');
      continueBtn.removeEventListener('click', finish); skipBtn.removeEventListener('click', finish);
      currentFinish = null; setTimeout(() => { reveal.hidden = true; resolve(); }, 220);
    };
    currentFinish = finish;
    continueBtn.addEventListener('click', finish); skipBtn.addEventListener('click', finish);
    narrate(teaching.text, words, speakOn, () => { autoTimer = setTimeout(finish, 900); });
  });
}

// ---------- theme + lifecycle ----------
function applyTheme(t) {
  const root = document.documentElement.style;
  const map = { '--bg': t.bg, '--panel': t.panel, '--board': t.board, '--cloth': t.cloth, '--line': t.line, '--accent': t.accent, '--castle': t.castle, '--text': t.text, '--muted': t.muted, '--font': t.font };
  for (const [k, v] of Object.entries(map)) if (v) root.setProperty(k, v);
  scene.background = hexColor(t.bg || '#140d1e');
  scene.fog = new THREE.Fog(new THREE.Color(t.bg || '#140d1e'), 40, 140);
}

async function loadWorld(id) {
  const res = await fetch(`worlds/${id}.json`);
  if (!res.ok) throw new Error(`Failed to load world ${id}`);
  world = validateWorld(await res.json());
  const cfg = gameForWorld(world);
  seatColor = {}; cfg.players.forEach((p) => { seatColor[p.seat] = p.color; });
  state = createGame(world, cfg.players, geo);
  try { const vr = await fetch(`assets/${world.id}/voice/voice.json`); setVoice(vr.ok ? await vr.json() : {}, `assets/${world.id}`, (world.voice && world.voice.web) || 'en-IN'); } catch { setVoice({}, `assets/${world.id}`, 'en-IN'); }
  applyTheme(world.theme);
  worldTitle.textContent = world.title; worldSubtitle.textContent = world.subtitle || '';
  document.title = `${world.title} — Pagade (3D)`;
  try { await loadPawnModels(); } catch { /* procedural fallback */ }
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
  try {
    stepTweens(now);
    stepCowries(now);
    // pulse movable pawns
    const s = 0.5 + 0.5 * Math.sin(now * 0.006);
    for (const [k, g] of Object.entries(pieceGroups)) {
      const on = movableSet.has(k);
      const base = g.userData.baseScale || 0.86;
      if (g.userData.mat) g.userData.mat.emissiveIntensity = on ? (g.userData.baseEmissive + 0.5 * s) : g.userData.baseEmissive;
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
    // gentle fire flicker (slow, low amplitude — no strobing)
    for (const f of flickerMeshes) {
      if (!f.material) continue;
      const fl = 0.88 + 0.12 * Math.sin(now * 0.004 + f.position.x * 1.7) + 0.05 * Math.sin(now * 0.011 + f.position.z);
      f.material.emissiveIntensity = (f.userData.baseEmissive || 2) * fl;
      f.scale.y = (f.userData.baseScaleY || 1) * (0.97 + 0.05 * Math.sin(now * 0.006 + f.position.x));
    }
    if (charkoni) charkoni.rotation.y = now * 0.00018;
    if (starfield) starfield.rotation.y = now * 0.00002;
    updateCamera();
    composer.render();
  } catch (e) {
    if (!tick._warned) { console.warn('3D frame error (recovering):', e); tick._warned = true; }
  }
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

window.__pagade = { get state() { return state; }, get world() { return world; }, get awaitingPick() { return awaitingPick; }, get pendingMoves() { return pendingMoves; }, get busy() { return busy; }, geo, throw: onThrow, pick, loadWorld, mode: '3d', get scene() { return scene; }, get pieceGroups() { return pieceGroups; }, get pawnModels() { return Object.keys(PAWN_MODELS); } };
