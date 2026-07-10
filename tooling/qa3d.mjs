// 3D QA: loads play3d.html with software WebGL, watches console/page errors, screenshots each
// world's 3D board, and drives a deterministic game via the debug hook.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('./_qa/', import.meta.url));
const BASE = process.env.BASE || 'http://localhost:5175';
const errors = [];

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  // skip intro films in QA
  await ctx.addInitScript(() => { try { ['dharma', 'mahabharata', 'ancient-india'].forEach((w) => sessionStorage.setItem(`pagade.intro.${w}`, '1')); } catch (e) { /* */ } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  for (const wid of ['dharma', 'mahabharata', 'ancient-india']) {
    await page.goto(`${BASE}/play3d.html?world=${wid}&nointro=1`, { waitUntil: 'networkidle' });
    const ok = await page.waitForFunction(() => window.__pagade && window.__pagade.state, null, { timeout: 15000 }).then(() => true).catch(() => false);
    await page.waitForTimeout(1200); // let the scene settle + first frames render
    await page.screenshot({ path: `${OUT}3d-${wid}.png` });
    console.log(`${wid}: init=${ok}`);
  }

  // drive a game in 3D on dharma
  await page.goto(`${BASE}/play3d.html?world=dharma&nointro=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__pagade && window.__pagade.state, null, { timeout: 15000 });
  await page.evaluate(() => {
    let seq = null, si = 0; const rr = Math.random;
    Math.random = () => { if (seq) { const v = seq[si++ % seq.length]; return v; } return rr(); };
    window.__setThrow = (k) => { si = 0; seq = k === 'grace' ? [0.9, 0.9, 0.9, 0.9, 0.9, 0.9] : [0.1, 0.1, 0.1, 0.9, 0.9, 0.9]; };
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = () => page.evaluate(async () => {
    const P = window.__pagade;
    const waitFor = async (pred, t = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < t) { if (pred()) return true; await new Promise((r) => setTimeout(r, 25)); } return false; };
    const cur = P.state.players[P.state.turn];
    window.__setThrow(cur.pieces.some((x) => x === 0) ? 'grace' : 'three');
    await P.throw();
    await waitFor(() => P.awaitingPick || !P.busy);
    if (P.awaitingPick && P.pendingMoves.length) {
      const enter = P.pendingMoves.find((m) => m.from === 0);
      const mv = enter || P.pendingMoves.slice().sort((a, b) => b.to - a.to)[0];
      await P.pick(mv);
    }
    await waitFor(() => !P.busy);
    return P.state.players.map((pl) => pl.pieces.slice());
  });
  let last = null;
  for (let i = 0; i < 20; i++) { last = await step(); await page.evaluate(() => { const r = document.querySelector('#reveal'); const b = document.querySelector('#continueBtn'); if (r && !r.hidden && b) b.click(); }); await sleep(120); }
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}3d-midgame.png` });

  // phone view
  const phone = await ctx.newPage();
  phone.on('pageerror', (e) => errors.push(`phone pageerror: ${e.message}`));
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(`${BASE}/play3d.html?world=mahabharata&nointro=1`, { waitUntil: 'networkidle' });
  await phone.waitForFunction(() => window.__pagade && window.__pagade.state, null, { timeout: 15000 });
  await phone.waitForTimeout(1200);
  await phone.screenshot({ path: `${OUT}3d-phone.png` });

  await browser.close();
  console.log('final 3D state:', JSON.stringify(last));
  console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no console/page errors (3D)');
}
main().catch((e) => { console.error(e); process.exit(1); });
