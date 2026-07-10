// Visual + smoke QA: loads each page, captures console/page errors, drives a deterministic game
// through the debug hook, and writes screenshots to tooling/_qa/.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('./_qa/', import.meta.url));
const BASE = process.env.BASE || 'http://localhost:5175';

const errors = [];
function watch(page, tag) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${tag}] console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  watch(page, 'play');

  // --- landing + lobby ---
  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}landing.png`, fullPage: true });

  await page.goto(`${BASE}/setup.html?world=dharma`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.card.sel', { timeout: 5000 });
  await page.screenshot({ path: `${OUT}lobby.png` });

  // --- the game ---
  await page.goto(`${BASE}/play.html?world=dharma`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__pachisi && window.__pachisi.state, null, { timeout: 5000 });
  await page.screenshot({ path: `${OUT}board-initial.png` });

  // install a controllable cowrie rng, then play a deterministic sequence of turns
  await page.evaluate(() => {
    let seq = null, si = 0;
    const realRandom = Math.random;
    Math.random = () => { if (seq) { const v = seq[si % seq.length]; si += 1; return v; } return realRandom(); };
    window.__setThrow = (kind) => { si = 0; seq = kind === 'grace' ? [0.9, 0.9, 0.9, 0.9, 0.9, 0.9] : [0.1, 0.1, 0.1, 0.9, 0.9, 0.9]; };
  });

  // capture a Teaching Reveal card (throw a grace, enter a piece, hold the reveal open)
  await page.evaluate(async () => {
    const P = window.__pachisi;
    const waitFor = async (pred, t = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < t) { if (pred()) return true; await new Promise((r) => setTimeout(r, 25)); } return false; };
    window.__setThrow('grace');
    await P.throw();
    await waitFor(() => P.awaitingPick && P.pendingMoves.length);
    const enter = P.pendingMoves.find((m) => m.from === 0) || P.pendingMoves[0];
    P.pick(enter);
    await waitFor(() => { const r = document.getElementById('reveal'); return r && !r.hidden && r.classList.contains('show'); });
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}reveal.png` });
  await page.evaluate(() => { const r = document.querySelector('#reveal'); const b = document.querySelector('#continueBtn'); if (r && !r.hidden && b) b.click(); });
  await page.waitForTimeout(300);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = async () => page.evaluate(async () => {
    const P = window.__pachisi;
    const waitFor = async (pred, t = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < t) { if (pred()) return true; await new Promise((r) => setTimeout(r, 25)); } return false; };
    // choose a throw: grace when the current player still has a yard piece, else a plain 3
    const cur = P.state.players[P.state.turn];
    const hasYard = cur.pieces.some((x) => x === 0);
    window.__setThrow(hasYard ? 'grace' : 'three');
    await P.throw();
    const picked = await waitFor(() => P.awaitingPick || !P.busy);
    if (P.awaitingPick && P.pendingMoves.length) {
      // prefer entering a piece, else advance the furthest piece
      const enter = P.pendingMoves.find((m) => m.from === 0);
      const mv = enter || P.pendingMoves.slice().sort((a, b) => b.to - a.to)[0];
      await P.pick(mv);
    }
    await waitFor(() => !P.busy);
    return { turn: P.state.turn, winner: P.state.winner, pieces: P.state.players.map((pl) => pl.pieces.slice()) };
  });

  let last = null;
  for (let i = 0; i < 24; i++) {
    last = await step();
    // dismiss any open teaching card so the loop keeps flowing
    await page.evaluate(() => { const b = document.querySelector('#continueBtn'); const r = document.querySelector('#reveal'); if (r && !r.hidden) b && b.click(); });
    await sleep(120);
  }
  await page.screenshot({ path: `${OUT}board-midgame.png` });

  // force a near-win to exercise the exact-finish rule + win overlay
  await page.evaluate(async () => {
    const P = window.__pachisi;
    const waitFor = async (pred, t = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < t) { if (pred()) return true; await new Promise((r) => setTimeout(r, 25)); } return false; };
    P.state.turn = 0;
    P.state.players[0].pieces = [68, 68, 68, 66]; // three home, one two-from-home
    let si = 0; const two = [0.1, 0.1, 0.9, 0.9, 0.9, 0.9]; Math.random = () => two[si++ % two.length];
    await P.throw();
    await waitFor(() => P.awaitingPick && P.pendingMoves.length);
    const home = P.pendingMoves.find((m) => m.to === 68) || P.pendingMoves[0];
    P.pick(home);
    await waitFor(() => { const w = document.getElementById('winOverlay'); return w && !w.hidden; });
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}win.png` });

  // a phone-sized view
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  watch(phone, 'phone');
  await phone.goto(`${BASE}/play.html?world=mahabharata`, { waitUntil: 'networkidle' });
  await phone.waitForFunction(() => window.__pachisi && window.__pachisi.state, null, { timeout: 5000 });
  await phone.screenshot({ path: `${OUT}board-phone.png` });

  await browser.close();
  console.log('final state:', JSON.stringify(last));
  console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no console/page errors');
}

main().catch((e) => { console.error(e); process.exit(1); });
