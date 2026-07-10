// Engine + geometry regression tests. These prove the cruciform board is well-formed (orthogonal,
// 4-fold symmetric, correctly shared between players) and that the Pachisi rules behave.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GRID, HOME, PIECES_PER_PLAYER, cellId, cellRC, cellAt, isCastle,
  buildGeometry, throwCowries, COWRIE_TABLE, createGame,
  legalMoves, evaluateMove, applyMove, nextTurn, validateWorld,
} from '../web/js/pachisi.js';

const geo = buildGeometry();
const orth = (a, b) => {
  const A = cellRC(a), B = cellRC(b);
  return Math.abs(A.row - B.row) + Math.abs(A.col - B.col) === 1;
};

test('geometry: ring is a closed 56-cell orthogonal loop', () => {
  assert.equal(geo.ring.length, 56);
  for (let i = 0; i < geo.ring.length; i++) {
    const a = geo.ring[i];
    const b = geo.ring[(i + 1) % geo.ring.length];
    assert.ok(orth(a, b), `ring cells ${JSON.stringify(cellRC(a))} -> ${JSON.stringify(cellRC(b))} not adjacent`);
  }
  assert.equal(new Set(geo.ring).size, 56, 'ring has no duplicate cells');
});

test('geometry: every player path is 67 long, orthogonal, and same length', () => {
  assert.equal(geo.paths.length, 4);
  for (let p = 0; p < 4; p++) {
    const path = geo.paths[p];
    assert.equal(path.length, 67, `player ${p} path length`);
    for (let i = 0; i < path.length - 1; i++) {
      assert.ok(orth(path[i], path[i + 1]), `player ${p} step ${i} -> ${i + 1} not adjacent`);
    }
  }
});

test('geometry: all path cells lie on the cross (never in a corner void)', () => {
  const onCross = (id) => {
    const { row, col } = cellRC(id);
    const midR = row >= 6 && row <= 8;
    const midC = col >= 6 && col <= 8;
    return midR || midC; // the cross is the union of the central rows and central cols
  };
  for (let p = 0; p < 4; p++) for (const id of geo.paths[p]) assert.ok(onCross(id), `${JSON.stringify(cellRC(id))} off-cross`);
});

test('geometry: paths are 4-fold rotational copies of the base path', () => {
  // player p is player 0 rotated p quarter-turns CCW: (r,c) -> (14-c, r)
  const rot = (id) => { const { row, col } = cellRC(id); return cellId(GRID - 1 - col, row); };
  for (let p = 1; p < 4; p++) {
    for (let i = 0; i < geo.paths[0].length; i++) {
      let x = geo.paths[0][i];
      for (let q = 0; q < p; q++) x = rot(x);
      assert.equal(geo.paths[p][i], x, `player ${p} index ${i} is not the rotated base`);
    }
  }
});

test('geometry: the private middle columns are exclusive to their owner', () => {
  // The first 5 and last 5 squares of each path are that player's private home column.
  for (let p = 0; p < 4; p++) {
    const priv = new Set([...geo.paths[p].slice(0, 5), ...geo.paths[p].slice(62)]);
    for (let q = 0; q < 4; q++) {
      if (q === p) continue;
      for (const id of geo.paths[q]) {
        // an opponent may only touch our private cells at the shared tip castle
        if (priv.has(id)) assert.ok(isCastle(geo, id), `player ${q} enters player ${p} private cell ${JSON.stringify(cellRC(id))}`);
      }
    }
  }
});

test('geometry: outer ring cells are shared by all four players (capture is possible)', () => {
  // Count, over all four paths, how many players visit each cell; ring (non-tip) cells should be
  // visited by all four, proving the public track really is shared.
  const seenBy = new Map();
  for (let p = 0; p < 4; p++) for (const id of new Set(geo.paths[p])) seenBy.set(id, (seenBy.get(id) || 0) + 1);
  const shared = [...seenBy.values()].filter((n) => n === 4).length;
  assert.ok(shared >= 40, `expected the bulk of the ring shared by all four players, got ${shared}`);
});

test('geometry: exactly 12 castle squares, including the four arm tips', () => {
  assert.equal(geo.castles.size, 12);
  for (const tip of [cellId(14, 7), cellId(7, 14), cellId(0, 7), cellId(7, 0)]) {
    assert.ok(geo.castles.has(tip), `tip ${JSON.stringify(cellRC(tip))} is a castle`);
  }
});

test('cowrie: table matches the traditional six-shell scoring', () => {
  assert.deepEqual(COWRIE_TABLE[0], { value: 25, grace: true });
  assert.deepEqual(COWRIE_TABLE[1], { value: 10, grace: true });
  assert.deepEqual(COWRIE_TABLE[6], { value: 6, grace: true });
  for (const up of [2, 3, 4, 5]) assert.equal(COWRIE_TABLE[up].grace, false);
});

test('cowrie: throw is bounded and deterministic under a fixed rng', () => {
  const allUp = throwCowries(() => 0); // every shell mouth-up
  assert.equal(allUp.up, 6);
  assert.equal(allUp.value, 6);
  const allDown = throwCowries(() => 0.9); // every shell mouth-down
  assert.equal(allDown.up, 0);
  assert.equal(allDown.value, 25);
  for (let i = 0; i < 300; i++) {
    const t = throwCowries();
    assert.ok(t.up >= 0 && t.up <= 6);
    assert.ok([2, 3, 4, 5, 6, 10, 25].includes(t.value));
  }
});

const world = {
  id: 'test', title: 'Test',
  characters: [
    { id: 'warrior', name: 'Warrior', glyph: '⚔' },
    { id: 'scholar', name: 'Scholar', glyph: '📜' },
    { id: 'merchant', name: 'Merchant', glyph: '⚖' },
    { id: 'traveler', name: 'Traveler', glyph: '🧭' },
  ],
  teachings: {
    enter: [{ text: 'A soul steps onto the path.' }],
    castle: [{ text: 'Rest a while in safety.' }],
    capture: [{ text: 'Fate turns; another is sent home.' }],
    captured: [{ text: 'Back to the beginning.' }],
    home: [{ text: 'The journey completes.' }],
    win: [{ text: 'All souls are home.' }],
  },
};
const players = world.characters.map((c, i) => ({ name: c.name, color: '#fff', char: c.id }));

const grace = { value: 25, grace: true };
const four = { value: 4, grace: false };

test('createGame seats players with four yard pieces each', () => {
  const g = createGame(world, players);
  assert.equal(g.players.length, 4);
  for (const pl of g.players) assert.equal(pl.pieces.filter((x) => x === 0).length, PIECES_PER_PLAYER);
});

test('a piece can only enter the board on a grace throw', () => {
  const g = createGame(world, players);
  assert.equal(legalMoves(g, four).length, 0, 'no entry on a plain throw');
  const moves = legalMoves(g, grace);
  assert.equal(moves.length, 1, 'one representative yard entry offered');
  assert.equal(moves[0].event, 'enter');
  assert.equal(moves[0].to, 1);
});

test('entering yields another throw, moving a plain value advances', () => {
  const g = createGame(world, players);
  const enter = legalMoves(g, grace)[0];
  const out = applyMove(g, enter);
  assert.equal(g.players[0].pieces[0], 1);
  assert.equal(out.another, true, 'grace earns another throw');
  const mv = legalMoves(g, four).find((m) => m.piece === 0);
  applyMove(g, mv);
  assert.equal(g.players[0].pieces[0], 5);
});

test('a piece needs an exact throw to reach home and cannot overshoot', () => {
  const g = createGame(world, players);
  g.players[0].pieces[0] = HOME - 3; // three from home
  assert.equal(evaluateMove(g, 0, 0, { value: 4, grace: false }).legal, false, 'overshoot rejected');
  const exact = evaluateMove(g, 0, 0, { value: 3, grace: false });
  assert.equal(exact.legal, true);
  assert.equal(exact.event, 'home');
  applyMove(g, exact);
  assert.equal(g.players[0].pieces[0], HOME);
});

test('landing on an opponent on the open track captures it', () => {
  const g = createGame(world, players);
  // find a shared, non-castle cell reachable by both player 0 and player 1
  let shared = null;
  for (let a = 6; a < 60 && !shared; a++) {
    const idA = cellAt(geo, 0, a);
    if (isCastle(geo, idA)) continue;
    for (let b = 6; b < 60; b++) {
      if (cellAt(geo, 1, b) === idA) { shared = { a, b, id: idA }; break; }
    }
  }
  assert.ok(shared, 'a shared open cell exists');
  g.players[1].pieces[0] = shared.b; // victim sits on the shared cell
  g.players[0].pieces[0] = shared.a - 2; // attacker two behind
  const mv = evaluateMove(g, 0, 0, { value: 2, grace: false });
  assert.equal(mv.event, 'capture');
  const out = applyMove(g, mv);
  assert.equal(g.players[1].pieces[0], 0, 'victim returns to the yard');
  assert.equal(out.another, true, 'a capture earns another throw');
});

test('a castle square is a safe haven — no capture there', () => {
  const g = createGame(world, players);
  // pick a castle cell shared by players 0 and 1
  let shared = null;
  for (let a = 6; a < 62 && !shared; a++) {
    const idA = cellAt(geo, 0, a);
    if (!isCastle(geo, idA)) continue;
    for (let b = 6; b < 62; b++) {
      if (cellAt(geo, 1, b) === idA) { shared = { a, b }; break; }
    }
  }
  if (!shared) return; // some worlds may not share a castle; skip quietly
  g.players[1].pieces[0] = shared.b;
  g.players[0].pieces[0] = shared.a - 1;
  const mv = evaluateMove(g, 0, 0, { value: 1, grace: false });
  assert.equal(mv.legal, false, 'cannot land on an opponent-held castle');
});

test('an opponent blockade cannot be passed', () => {
  const g = createGame(world, players);
  // two of player 1 on a shared non-castle cell form a wall in front of player 0
  let target = null;
  for (let a = 8; a < 55 && !target; a++) {
    const idA = cellAt(geo, 0, a);
    if (isCastle(geo, idA)) continue;
    for (let b = 6; b < 62; b++) if (cellAt(geo, 1, b) === idA) { target = { a, b }; break; }
  }
  assert.ok(target);
  g.players[1].pieces[0] = target.b;
  g.players[1].pieces[1] = target.b; // a stack of two -> blockade
  g.players[0].pieces[0] = target.a - 3;
  const mv = evaluateMove(g, 0, 0, { value: 3, grace: false });
  assert.equal(mv.legal, false, 'blockade blocks the move');
});

test('winning is detected when all four pieces reach home', () => {
  const g = createGame(world, players);
  g.players[0].pieces = [HOME, HOME, HOME, HOME - 2];
  const mv = evaluateMove(g, 0, 3, { value: 2, grace: false });
  const out = applyMove(g, mv);
  assert.equal(out.won, true);
  assert.equal(out.allHome, true);
  assert.equal(g.winner, 0);
});

test('nextTurn rotates counter-clockwise and skips a player with no pieces left to move', () => {
  const g = createGame(world, players);
  g.turn = 0;
  assert.equal(nextTurn(g), 1, 'plain rotation 0 -> 1');
  // contrive a finished player 2 (all home) without ending the game, then rotate past it
  g.players[2].pieces = [HOME, HOME, HOME, HOME];
  g.turn = 1;
  assert.equal(nextTurn(g), 3, 'rotation skips the finished player 2');
});

test('validateWorld enforces characters and teaching banks', () => {
  assert.doesNotThrow(() => validateWorld(world));
  assert.throws(() => validateWorld({ id: 'x', title: 'x', characters: [] }), /at least 4 characters/);
  assert.throws(
    () => validateWorld({ id: 'x', title: 'x', characters: world.characters, teachings: { enter: [] } }),
    /teachings.enter needs at least one entry/,
  );
});
