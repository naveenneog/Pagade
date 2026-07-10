// QA the art-directed 3D worlds + the animated cowrie throw.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('./_qa/', import.meta.url));
const BASE = process.env.BASE || 'http://localhost:5175';
const errors = [];

const enterPieces = async (page, n) => page.evaluate(async (n) => {
  const P = window.__pagade;
  const wf = async (f, t = 5000) => { const s = Date.now(); while (Date.now() - s < t) { if (f()) return; await new Promise((r) => setTimeout(r, 25)); } };
  let si = 0; const seq = [0.9, 0.9, 0.9, 0.9, 0.9, 0.9]; Math.random = () => seq[si++ % seq.length];
  for (let i = 0; i < n; i++) { await P.throw(); await wf(() => P.awaitingPick); const e = P.pendingMoves.find((m) => m.from === 0) || P.pendingMoves[0]; if (e) await P.pick(e); await wf(() => !P.busy); }
}, n);

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  for (const wid of ['dharma', 'mahabharata', 'ancient-india']) {
    await page.goto(`${BASE}/play3d.html?world=${wid}&nointro=1`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__pagade && window.__pagade.state, null, { timeout: 15000 });
    await enterPieces(page, 4);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}art-${wid}.png` });
  }

  // capture the cowrie throw mid-tumble (dharma)
  await page.goto(`${BASE}/play3d.html?world=dharma&nointro=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__pagade && window.__pagade.state, null, { timeout: 15000 });
  await page.evaluate(() => { let si = 0; const seq = [0.1, 0.1, 0.1, 0.9, 0.9, 0.9]; Math.random = () => seq[si++ % seq.length]; window.__pagade.throw(); });
  await page.waitForTimeout(380);
  await page.screenshot({ path: `${OUT}art-cowries.png` });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}art-cowries-settled.png` });

  await browser.close();
  console.log(errors.length ? `ERRORS:\n${errors.slice(0, 6).join('\n')}` : 'no console/page errors (art 3D)');
}
main().catch((e) => { console.error(e); process.exit(1); });
