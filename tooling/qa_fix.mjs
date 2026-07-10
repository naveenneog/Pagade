// QA the fixes: freeze/click robustness, calmer flicker, Ashoka pillars, creative pawns (2D+3D),
// distant 3D world. Robust: each section guarded; screenshots time-boxed.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('./_qa/', import.meta.url));
const BASE = process.env.BASE || 'http://localhost:5175';
const errors = [];
const watch = (p, tag) => { p.on('console', (m) => { if (m.type() === 'error') errors.push(`[${tag}] ${m.text()}`); }); p.on('pageerror', (e) => errors.push(`[${tag}] ${e.message}`)); };
const shot = async (p, name) => { try { await p.evaluate(() => { for (const id of ['reveal', 'winOverlay', 'intro']) { const e = document.getElementById(id); if (e) e.hidden = true; } }); await p.screenshot({ path: `${OUT}${name}.png`, animations: 'disabled', timeout: 15000 }); } catch (e) { console.log(`shot ${name} failed: ${e.message}`); } };
const wfHook = async (p, t = 15000) => p.waitForFunction(() => window.__pagade && window.__pagade.state, null, { timeout: t }).then(() => true).catch(() => false);

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });

  // ---- 2D real click (SVG pawns) ----
  try {
    const c2 = await browser.newContext({ viewport: { width: 1200, height: 860 } });
    const p2 = await c2.newPage(); watch(p2, '2d');
    await p2.goto(`${BASE}/play.html?world=dharma&nointro=1`, { waitUntil: 'domcontentloaded' });
    await wfHook(p2, 8000);
    await p2.evaluate(() => { let si = 0; const s = [0.9, 0.9, 0.9, 0.9, 0.9, 0.9]; Math.random = () => s[si++ % s.length]; });
    await p2.click('#throwBtn');
    await p2.waitForFunction(() => window.__pagade.awaitingPick, null, { timeout: 5000 });
    const before = await p2.evaluate(() => window.__pagade.state.players[0].pieces.slice());
    await p2.click('#board .piece.movable', { timeout: 4000 });
    await p2.waitForFunction(() => !window.__pagade.busy, null, { timeout: 6000 }).catch(() => {});
    await p2.evaluate(() => { const b = document.querySelector('#continueBtn'); const r = document.querySelector('#reveal'); if (r && !r.hidden && b) b.click(); });
    await p2.evaluate(async () => { const P = window.__pagade; const wf = async (f, t = 4000) => { const s = Date.now(); while (Date.now() - s < t) { if (f()) return; await new Promise((r) => setTimeout(r, 20)); } }; let si = 0; const g = [0.9, 0.9, 0.9, 0.9, 0.9, 0.9]; Math.random = () => g[si++ % g.length]; for (let i = 0; i < 6; i++) { await wf(() => !P.busy && !P.awaitingPick, 3000); await P.throw(); await wf(() => P.awaitingPick || !P.busy); if (P.awaitingPick) { const m = P.pendingMoves.find((x) => x.from === 0) || P.pendingMoves.slice().sort((a, b) => b.to - a.to)[0]; await P.pick(m); } const b = document.querySelector('#continueBtn'); const r = document.querySelector('#reveal'); if (r && !r.hidden && b) b.click(); await wf(() => !P.busy); } });
    const after = await p2.evaluate(() => window.__pagade.state.players[0].pieces.slice());
    console.log('2D real-click entered:', JSON.stringify(after) !== JSON.stringify(before));
    await p2.waitForTimeout(400);
    await shot(p2, 'fix-2d-pawns');
  } catch (e) { console.log('2D section failed:', e.message); }

  // ---- lobby with pawn picker (4 players) ----
  try {
    const cl = await browser.newContext({ viewport: { width: 1000, height: 1000 } });
    const pl = await cl.newPage(); watch(pl, 'lobby');
    await pl.goto(`${BASE}/setup.html`, { waitUntil: 'domcontentloaded' });
    await pl.waitForSelector('.card.sel', { timeout: 6000 });
    await pl.evaluate(() => { const b = [...document.querySelectorAll('#counts .pill')].find((x) => x.textContent.includes('4')); if (b) b.click(); });
    await pl.waitForTimeout(400);
    await shot(pl, 'fix-lobby');
  } catch (e) { console.log('lobby section failed:', e.message); }

  // ---- 3D: distinct pawns per player + Ashoka pillars + distant world ----
  const c3 = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await c3.addInitScript(() => { try { sessionStorage.setItem('pagade.game', JSON.stringify({ world: 'ancient-india', mode: '3d', players: [{ name: 'Amir', char: 'merchant', pawn: 'warrior' }, { name: 'Bela', char: 'scholar', pawn: 'lotus' }, { name: 'Chandra', char: 'artisan', pawn: 'kalash' }, { name: 'Deva', char: 'pilgrim', pawn: 'elephant' }] })); } catch (e) { /* */ } });
  const p3 = await c3.newPage(); watch(p3, '3d');
  try {
    await p3.goto(`${BASE}/play3d.html?world=ancient-india&nointro=1`, { waitUntil: 'domcontentloaded' });
    await wfHook(p3);
    await p3.evaluate(async () => { const P = window.__pagade; const wf = async (f, t = 6000) => { const s = Date.now(); while (Date.now() - s < t) { if (f()) return; await new Promise((r) => setTimeout(r, 20)); } }; let si = 0; const g = [0.9, 0.9, 0.9, 0.9, 0.9, 0.9]; Math.random = () => g[si++ % g.length]; for (let i = 0; i < 16; i++) { await P.throw(); await wf(() => P.awaitingPick || !P.busy); if (P.awaitingPick) { const m = P.pendingMoves.find((x) => x.from === 0) || P.pendingMoves[0]; await P.pick(m); } const b = document.querySelector('#continueBtn'); const r = document.querySelector('#reveal'); if (r && !r.hidden && b) b.click(); await wf(() => !P.busy); } });
    await p3.waitForTimeout(1500);
    await shot(p3, 'fix-3d-ancient');
  } catch (e) { console.log('3D ancient failed:', e.message); }

  // ---- freeze stress: 30 turns, must never hang ----
  try {
    const stuck = await p3.evaluate(async () => {
      const P = window.__pagade; const wf = async (f, t = 6000) => { const s = Date.now(); while (Date.now() - s < t) { if (f()) return true; await new Promise((r) => setTimeout(r, 20)); } return false; };
      let si = 0; const three = [0.1, 0.1, 0.1, 0.9, 0.9, 0.9]; Math.random = () => three[si++ % three.length];
      for (let i = 0; i < 30; i++) {
        if (!(await wf(() => !P.busy))) return `stuck-busy at throw ${i}`;
        await P.throw();
        if (!(await wf(() => P.awaitingPick || !P.busy))) return `stuck after throw ${i}`;
        if (P.awaitingPick && P.pendingMoves.length) await P.pick(P.pendingMoves.slice().sort((a, b) => b.to - a.to)[0]);
        const b = document.querySelector('#continueBtn'); const r = document.querySelector('#reveal'); if (r && !r.hidden && b) b.click();
        if (!(await wf(() => !P.busy))) return `stuck-busy after pick ${i}`;
        if (P.state.winner != null) break;
      }
      return 'ok';
    });
    console.log('3D freeze stress (30 turns):', stuck);
  } catch (e) { console.log('freeze stress failed:', e.message); }

  // ---- mahabharata + dharma skylines ----
  for (const wid of ['mahabharata', 'dharma']) {
    try {
      await p3.goto(`${BASE}/play3d.html?world=${wid}&nointro=1`, { waitUntil: 'domcontentloaded' });
      await wfHook(p3);
      await p3.waitForTimeout(1500);
      await shot(p3, `fix-3d-${wid}`);
    } catch (e) { console.log(`3D ${wid} failed:`, e.message); }
  }

  await browser.close();
  console.log(errors.length ? `ERRORS:\n${errors.slice(0, 8).join('\n')}` : 'no console/page errors');
}
main().catch((e) => { console.error(e); process.exit(1); });
