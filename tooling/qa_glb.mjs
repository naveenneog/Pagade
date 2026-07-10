// Verify realistic GLB pawns are loaded + used, and grab a zoomed close-up per world.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('./_qa/', import.meta.url));
const BASE = process.env.BASE || 'http://localhost:5175';

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const errors = [];
  for (const wid of ['dharma', 'mahabharata', 'ancient-india']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript((w) => { try { sessionStorage.setItem('pagade.game', JSON.stringify({ world: w, mode: '3d', players: [{ name: 'Aa', char: 'warrior', pawn: 'warrior' }, { name: 'Bb', char: 'scholar', pawn: 'elephant' }] })); } catch (e) { /* */ } }, wid);
    const p = await ctx.newPage();
    p.on('console', (m) => { if (m.type() === 'error') errors.push(`[${wid}] ${m.text()}`); });
    p.on('pageerror', (e) => errors.push(`[${wid}] ${e.message}`));
    try {
      await p.goto(`${BASE}/play3d.html?world=${wid}&nointro=1`, { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.__pagade && window.__pagade.state && window.__pagade.pawnModels, null, { timeout: 20000 });
      // move a few pieces onto the board so pawns are visible on the arms
      await p.evaluate(async () => {
        const P = window.__pagade; const wf = async (f, t = 6000) => { const s = Date.now(); while (Date.now() - s < t) { if (f()) return; await new Promise((r) => setTimeout(r, 20)); } };
        let si = 0; const g = [0.9, 0.9, 0.1, 0.1, 0.1, 0.9]; Math.random = () => g[si++ % g.length];
        for (let i = 0; i < 6; i++) { await wf(() => !P.busy); await P.throw(); await wf(() => P.awaitingPick || !P.busy); if (P.awaitingPick && P.pendingMoves.length) await P.pick(P.pendingMoves.slice().sort((a, b) => b.to - a.to)[0]); const b = document.querySelector('#continueBtn'); const r = document.querySelector('#reveal'); if (r && !r.hidden && b) b.click(); await wf(() => !P.busy); }
      });
      // diagnostics: are GLBs loaded, and do pawn groups contain high-poly GLB meshes?
      const diag = await p.evaluate(() => {
        const P = window.__pagade;
        const groups = Object.values(P.pieceGroups || {});
        let maxVerts = 0, meshCount = 0, hasMap = 0;
        for (const grp of groups) grp.traverse((n) => { if (n.isMesh) { meshCount++; const v = n.geometry?.attributes?.position?.count || 0; if (v > maxVerts) maxVerts = v; if (n.material && n.material.map) hasMap++; } });
        return { pawnModels: P.pawnModels, groupCount: groups.length, meshCount, maxVerts, hasMap };
      });
      console.log(`[${wid}]`, JSON.stringify(diag));
      // zoom the camera in for a close-up (scroll to zoom)
      await p.mouse.move(600, 450); for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, -220); await p.waitForTimeout(60); }
      await p.evaluate(() => { for (const id of ['reveal', 'winOverlay', 'intro']) { const e = document.getElementById(id); if (e) e.hidden = true; } });
      await p.waitForTimeout(800);
      await p.screenshot({ path: `${OUT}glb-${wid}.png`, animations: 'disabled', timeout: 20000 });
    } catch (e) { console.log(`[${wid}] failed:`, e.message); }
    await ctx.close();
  }
  await browser.close();
  console.log(errors.length ? `ERRORS:\n${errors.slice(0, 8).join('\n')}` : 'no console/page errors');
}
main().catch((e) => { console.error(e); process.exit(1); });
