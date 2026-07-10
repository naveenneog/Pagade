// Headless DOM smoke test: proves game.js runs in a document, builds the cruciform board, pieces
// and roster, and that a forced grace throw lets a piece enter and then advance — dismissing the
// Teaching Reveal along the way. No browser; jsdom + disk-backed fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const webDir = fileURLToPath(new URL('../web/', import.meta.url));
const html = await readFile(new URL('../web/play.html', import.meta.url), 'utf8');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (pred, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(20); } return false; };

test('game.js builds the board and drives an entry + advance', async () => {
  const dom = new JSDOM(html, { url: 'http://localhost/play.html?world=dharma', pretendToBeVisual: true });
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.location = window.location;
  globalThis.requestAnimationFrame = window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.fetch = async (url) => {
    const body = await readFile(new URL(url, `file://${webDir}`), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  };
  // deterministic cowries: default to a grace (all shells mouth-down -> 25)
  let seq = null, si = 0;
  const realRandom = Math.random;
  Math.random = () => { if (seq) { const v = seq[si++ % seq.length]; return v; } return 0.9; };
  const setThrow = (kind) => { si = 0; seq = kind === 'grace' ? [0.9] : [0.1, 0.1, 0.1, 0.9, 0.9, 0.9]; };

  try {
    await import('../web/js/game.js');
    const P = window.__pagade;
    assert.ok(await waitFor(() => window.__pagade && window.__pagade.state), 'game initialises');

    // structure
    assert.ok(document.querySelectorAll('#board .cell').length >= 70, 'cruciform cells built');
    assert.ok(document.querySelectorAll('#board .piece').length === 8, 'two players × four pieces');
    assert.ok(document.querySelectorAll('#roster .rmp').length === 2, 'roster shows both players');

    // a reveal-dismisser so awaited moves resolve quickly
    const dismisser = setInterval(() => {
      const r = document.getElementById('reveal');
      if (r && !r.hidden) document.getElementById('continueBtn').click();
    }, 20);

    // throw a grace and enter a piece
    setThrow('grace');
    await P.throw();
    assert.ok(await waitFor(() => P.awaitingPick && P.pendingMoves.length), 'a legal move is offered');
    const enter = P.pendingMoves.find((m) => m.from === 0);
    assert.ok(enter, 'a grace offers a yard entry');
    await P.pick(enter);
    assert.ok(await waitFor(() => !P.busy), 'entry resolves');
    assert.ok(P.state.players[0].pieces.includes(1), 'a piece is now on square 1');

    // grace earns another throw for the same player; move that piece 3 forward
    setThrow('three');
    await P.throw();
    assert.ok(await waitFor(() => P.awaitingPick && P.pendingMoves.length), 'second throw offers a move');
    const adv = P.pendingMoves.find((m) => m.from === 1) || P.pendingMoves[0];
    await P.pick(adv);
    assert.ok(await waitFor(() => !P.busy), 'advance resolves');
    assert.ok(P.state.players[0].pieces.includes(4), 'the piece advanced from 1 to 4');

    clearInterval(dismisser);
  } finally {
    Math.random = realRandom;
  }
});
