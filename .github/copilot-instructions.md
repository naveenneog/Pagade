# Copilot instructions — Pachisi

You are working on **Pachisi**, a data-driven digital reconstruction of the ancient Indian
**cross-and-cowries** journey game (the game that Ludo descends from). One JSON manifest per
**world** runs over a **pure rules engine** (`web/js/pachisi.js`) and is drawn by a 2D renderer
(`web/js/game.js`), with **local hotseat multiplayer (2–4)** and a **Teaching Reveal** that reads a
cultural teaching aloud at each milestone. Published to GitHub Pages + an Android Capacitor APK.
Sister projects: **Sopāna** (`../Sopana`) and **Chaturanga** (`../Chaturanga`).

**Before changing anything, read [`../CONTEXT.md`](../CONTEXT.md)** — the durable project memory:
board geometry, rules, the three worlds, build/test/QA commands, publishing, and the backlog.

Conventions:
- Keep it **data-driven** — a new game/theme is mostly a `web/worlds/<id>.json` (theme + characters
  + teaching banks); don't hardcode content in the renderer.
- **All rules live in `pachisi.js`** and stay DOM-free so `npm test` can regression-test them. The
  cruciform geometry is generated + asserted (orthogonal, 4-fold symmetric, 12 castles) — never
  hand-edit path arrays; change the generator and re-run the geometry tests.
- The engine indexes each player's path by their **`seat`** (0=South,1=East,2=North,3=West), not
  their turn-order index — a 2-player game seats South & North (opposite arms). Keep that mapping.
- **Authentic Pachisi:** six cowries (0→25, 1→10, 6→6 are graces + extra throw); a piece **enters
  only on a grace**; **exact** throw to finish; castles are safe; two same-colour pieces form a
  **blockade**; capture returns a piece to the Charkoni and earns another throw.
- Validate with `npm test` (node:test) and `node tooling/qa.mjs` (Playwright screenshots + a
  deterministic driven game via the `window.__pachisi` debug hook). **APK CI needs JDK 21.**
- **Ask before publishing** to the public Pages site or cutting a release.
