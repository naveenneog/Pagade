// pachisi.js — pure, DOM-free game logic for Pachisi (the ancient Indian cross-and-cowries game).
// Shared by the browser UI (game.js) and the Node test suite (test/pachisi.test.mjs).
// Everything here is deterministic and framework-free so the rules stay regression-testable.
//
// The board is a symmetric cross ("cruciform"): four arms, each three columns of six squares,
// around a central square — the Charkoni — where every piece starts and finishes. A player's
// pieces travel DOWN the middle column of their own arm to the tip, then COUNTER-CLOCKWISE all
// the way around the outer columns, and finally back UP their own middle column to the Charkoni.
// Movement is decided by throwing six cowrie shells (see throwCowries).

export const GRID = 15; // 15x15 lattice; only the cross cells are used
export const CENTER = 7; // centre index (Charkoni is rows/cols 6..8)
export const ARM = 6; // squares along each arm column
export const HOME = 68; // position value of a finished piece (path is 1..67)
export const PIECES_PER_PLAYER = 4;

// A cell id packs a (row, col) into a single integer so positions can be compared cheaply.
export const cellId = (r, c) => r * GRID + c;
export const cellRC = (id) => ({ row: Math.floor(id / GRID), col: id % GRID });

// Rotate a cell 90 degrees counter-clockwise about the board centre (7,7).
// Used to derive the East/North/West players' paths from the South (base) player's path.
const rotCCW = (id) => {
  const { row, col } = cellRC(id);
  return cellId(GRID - 1 - col, row);
};
const rotN = (id, n) => {
  let x = id;
  for (let i = 0; i < n; i++) x = rotCCW(x);
  return x;
};

// The 56-cell public ring, in travel order, starting at the South tip (14,7) heading toward (14,8).
// Built by walking one arm's contribution and rotating it three times (4-fold symmetry).
function buildRing() {
  // Bottom (South) arm ring segment: centre-corner -> out along left outer col -> tip -> back along
  // right outer col. 14 cells. Rotating three times tiles the whole ring.
  const base = [
    cellId(8, 6), // centre corner
    cellId(9, 6), cellId(10, 6), cellId(11, 6), cellId(12, 6), cellId(13, 6), cellId(14, 6), // out
    cellId(14, 7), // tip castle
    cellId(14, 8), cellId(13, 8), cellId(12, 8), cellId(11, 8), cellId(10, 8), cellId(9, 8), // back
  ];
  const ring = [];
  for (let q = 0; q < 4; q++) for (const id of base) ring.push(rotN(id, q));
  return ring; // length 56; ring[0] === (8,6)
}

// Build the South player's full journey (index 1..67 -> cell ids), then the finish at HOME.
// private middle out (5) + full ring lap starting/ending at the tip (57) + private middle in (5).
function buildBasePath() {
  const tip = cellId(14, 7);
  const ring = buildRing();
  // rotate the ring so it starts at the South tip and heads toward (14,8)
  const t = ring.indexOf(tip);
  const fromTip = [...ring.slice(t), ...ring.slice(0, t)]; // 56 cells, fromTip[0] === tip
  const privateOut = [cellId(9, 7), cellId(10, 7), cellId(11, 7), cellId(12, 7), cellId(13, 7)];
  const privateIn = [...privateOut].reverse();
  // lap = tip ... around ... back to tip (the tip appears at both ends of the lap)
  const lap = [...fromTip, tip];
  return [...privateOut, ...lap, ...privateIn]; // length 67
}

// The twelve castle (safe) cells: four arm tips + eight "four squares in from the outer-column ends".
function buildCastles() {
  const base = [
    cellId(14, 7), // South tip
    cellId(10, 6), cellId(10, 8), // South outer castles (4 in from the tip)
  ];
  const set = new Set();
  for (let q = 0; q < 4; q++) for (const id of base) set.add(rotN(id, q));
  return set; // 12 ids
}

// Assemble the immutable geometry once. paths[p] is player p's ordered list of cell ids (1-indexed
// via path[pos-1]); castles is a Set of safe cell ids; charkoni is the centre home cell.
export function buildGeometry() {
  const basePath = buildBasePath();
  const paths = [];
  for (let p = 0; p < 4; p++) paths.push(basePath.map((id) => rotN(id, p)));
  return {
    grid: GRID,
    arm: ARM,
    center: CENTER,
    home: HOME,
    charkoni: cellId(7, 7),
    ring: buildRing(),
    castles: buildCastles(),
    paths,
    pathLen: basePath.length, // 67
  };
}

// Return the cell id a piece of player `p` occupies at position `pos`, or null when off the
// board (in the yard, pos 0) or finished (HOME).
export function cellAt(geo, p, pos) {
  if (pos <= 0 || pos >= HOME) return null;
  return geo.paths[p][pos - 1];
}

export const isCastle = (geo, id) => id != null && geo.castles.has(id);

// --- cowrie throw -------------------------------------------------------------------------------
// Six shells. The count landing mouth-up maps to a value; 0/1/6 are "graces" that earn another turn.
export const COWRIE_TABLE = {
  0: { value: 25, grace: true },
  1: { value: 10, grace: true },
  2: { value: 2, grace: false },
  3: { value: 3, grace: false },
  4: { value: 4, grace: false },
  5: { value: 5, grace: false },
  6: { value: 6, grace: true },
};

// Throw six cowries. rng() returns a float in [0,1); each shell is mouth-up with probability 0.5.
// Returns { up, shells:[0/1 x6], value, grace }.
export function throwCowries(rng = Math.random) {
  const shells = [];
  let up = 0;
  for (let i = 0; i < 6; i++) {
    const u = rng() < 0.5 ? 1 : 0;
    shells.push(u);
    up += u;
  }
  const { value, grace } = COWRIE_TABLE[up];
  return { up, shells, value, grace };
}

// --- state --------------------------------------------------------------------------------------
// Create a fresh game state for `players` ([{name,color,char}]) on a validated `world`.
export function createGame(world, players, geo = buildGeometry()) {
  return {
    world,
    geo,
    players: players.slice(0, 4).map((pl, i) => ({
      idx: i,
      seat: pl.seat != null ? pl.seat : i, // which arm (0=S,1=E,2=N,3=W) this player travels
      name: pl.name || `Player ${i + 1}`,
      color: pl.color,
      char: pl.char,
      pawn: pl.pawn || 'themed',
      pieces: Array.from({ length: PIECES_PER_PLAYER }, () => 0), // all in the Charkoni yard
    })),
    turn: 0,
    winner: null,
  };
}

// How many opponent pieces (belonging to `notPlayer`) sit on cell `id`.
function occupantsOn(state, id, notPlayer) {
  let n = 0;
  const owners = [];
  state.players.forEach((pl) => {
    if (pl.idx === notPlayer) return;
    pl.pieces.forEach((pos, pi) => {
      if (pos > 0 && pos < HOME && cellAt(state.geo, pl.seat, pos) === id) {
        n += 1;
        owners.push({ player: pl.idx, piece: pi });
      }
    });
  });
  return { n, owners };
}

// Is there an opponent BLOCKADE (2+ of one opponent's pieces on a single non-castle cell) on any
// cell strictly after `from` up to and including `to` for player `p`? Such a wall cannot be passed.
function blockadeBetween(state, p, from, to) {
  const { geo } = state;
  const seat = state.players[p].seat;
  for (let pos = from + 1; pos <= to && pos < HOME; pos++) {
    const id = cellAt(geo, seat, pos);
    if (id == null || isCastle(geo, id)) continue;
    // count same-owner opponent stacks on this cell
    const tally = new Map();
    state.players.forEach((pl) => {
      if (pl.idx === p) return;
      pl.pieces.forEach((pp) => {
        if (pp > 0 && pp < HOME && cellAt(geo, pl.seat, pp) === id) {
          tally.set(pl.idx, (tally.get(pl.idx) || 0) + 1);
        }
      });
    });
    for (const cnt of tally.values()) if (cnt >= 2) return true;
  }
  return false;
}

// Evaluate moving player `p`'s piece `pi` by cowrie value `v`. Returns a move descriptor when
// legal, else { legal:false, reason }.
export function evaluateMove(state, p, pi, cowrie) {
  const geo = state.geo;
  const player = state.players[p];
  const seat = player.seat;
  const pos = player.pieces[pi];
  const v = cowrie.value;

  // Introduce a piece from the yard: only on a grace throw, landing on square 1.
  if (pos === 0) {
    if (!cowrie.grace) return { legal: false, reason: 'need a grace (6, 10 or 25) to enter' };
    const to = 1;
    const id = cellAt(geo, seat, to);
    const opp = occupantsOn(state, id, p);
    if (opp.n && isCastle(geo, id)) return { legal: false, reason: 'entry blocked by an opponent on a castle' };
    const capture = opp.n && !isCastle(geo, id) ? opp : null;
    return { legal: true, player: p, piece: pi, from: 0, to, event: 'enter', capture, castle: isCastle(geo, id), grace: true };
  }

  if (pos >= HOME) return { legal: false, reason: 'piece already home' };

  const to = pos + v;
  if (to > HOME) return { legal: false, reason: 'overshoots home — needs an exact throw' };
  if (to === HOME) {
    return { legal: true, player: p, piece: pi, from: pos, to: HOME, event: 'home', capture: null, castle: false, grace: cowrie.grace };
  }
  if (blockadeBetween(state, p, pos, to)) return { legal: false, reason: 'blocked by an opponent wall' };

  const id = cellAt(geo, seat, to);
  const opp = occupantsOn(state, id, p);
  if (opp.n && isCastle(geo, id)) return { legal: false, reason: 'a castle held by an opponent cannot be entered' };
  const capture = opp.n && !isCastle(geo, id) ? opp : null;
  return {
    legal: true,
    player: p,
    piece: pi,
    from: pos,
    to,
    event: capture ? 'capture' : isCastle(geo, id) ? 'castle' : 'move',
    capture,
    castle: isCastle(geo, id),
    grace: cowrie.grace,
  };
}

// All legal moves for the current player given a cowrie throw.
export function legalMoves(state, cowrie, p = state.turn) {
  const moves = [];
  const player = state.players[p];
  for (let pi = 0; pi < player.pieces.length; pi++) {
    const m = evaluateMove(state, p, pi, cowrie);
    if (m.legal) moves.push(m);
  }
  // de-duplicate pieces sitting in the yard (they are interchangeable) to keep choices tidy
  const seenYard = new Set();
  return moves.filter((m) => {
    if (m.from !== 0) return true;
    if (seenYard.has(m.player)) return false;
    seenYard.add(m.player);
    return true;
  });
}

// Apply a legal move descriptor to the state (mutating). Returns an outcome describing what
// happened, including any captured pieces and whether the player earns another throw.
export function applyMove(state, move) {
  const player = state.players[move.player];
  const captured = [];
  if (move.capture) {
    for (const o of move.capture.owners) {
      state.players[o.player].pieces[o.piece] = 0; // sent back to the Charkoni yard
      captured.push(o);
    }
  }
  player.pieces[move.piece] = move.to;

  const allHome = player.pieces.every((pos) => pos >= HOME);
  if (allHome && state.winner == null) state.winner = move.player;

  // A grace throw, or a capture, earns another throw (an extra turn).
  const another = Boolean(move.grace || captured.length);
  return {
    ...move,
    captured,
    another,
    allHome,
    won: state.winner === move.player,
  };
}

// Advance to the next player who has not yet won. Call when a turn ends (no extra throw).
export function nextTurn(state) {
  if (state.winner != null) return state.turn;
  for (let step = 1; step <= state.players.length; step++) {
    const cand = (state.turn + step) % state.players.length;
    if (state.players[cand].pieces.some((pos) => pos < HOME)) {
      state.turn = cand;
      return cand;
    }
  }
  return state.turn;
}

// --- world validation ---------------------------------------------------------------------------
const TEACH_KINDS = ['enter', 'castle', 'capture', 'captured', 'home', 'win', 'journey'];

// Validate a world manifest. Throws on structural error; returns the world on success.
export function validateWorld(world) {
  for (const k of ['id', 'title']) {
    if (!world[k]) throw new Error(`world missing "${k}"`);
  }
  if (!Array.isArray(world.characters) || world.characters.length < 4) {
    throw new Error('world needs at least 4 characters (one per piece archetype)');
  }
  for (const c of world.characters) {
    for (const f of ['id', 'name', 'glyph']) {
      if (!c[f]) throw new Error(`character missing "${f}": ${JSON.stringify(c)}`);
    }
  }
  const t = world.teachings || {};
  for (const kind of TEACH_KINDS) {
    const arr = t[kind];
    if (arr != null && !Array.isArray(arr)) throw new Error(`teachings.${kind} must be an array`);
    for (const e of arr || []) {
      if (!e || !e.text) throw new Error(`teachings.${kind} entry missing "text": ${JSON.stringify(e)}`);
    }
  }
  // every milestone kind that the UI narrates must have at least one line to draw from
  for (const kind of ['enter', 'castle', 'capture', 'home', 'win']) {
    if (!(t[kind] && t[kind].length)) throw new Error(`teachings.${kind} needs at least one entry`);
  }
  return world;
}
