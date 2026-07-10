# Copilot instructions — Pagade

You are working on **Pagade** (the Karnataka name for **Pachisi**), a data-driven digital
reconstruction of the ancient Indian **cross-and-cowries** journey game (Ludo's ancestor). One JSON
manifest per **world** runs over a **pure rules engine** (`web/js/pachisi.js`) and is drawn **two
ways** — a 2D board (`web/js/game.js`) and a Three.js **3D** board (`web/js/board3d.js`, glowing
beehive pawns + bloom) — with **local hotseat multiplayer (2–4)**, a **Teaching Reveal** read aloud
at each milestone, per-world **Sora-2 intro films** and composed **music beds**. Published to GitHub
Pages (**naveenneog.github.io/Pagade**) + an Android Capacitor APK. Sisters: **Sopāna** (`../Sopana`)
and **Chaturanga** (`../Chaturanga`).

**Before changing anything, read [`../CONTEXT.md`](../CONTEXT.md)** — the durable project memory:
naming, board geometry, rules, the three worlds, the 3D + media pipeline, build/test/QA, publishing,
and the backlog.

Conventions:
- Keep it **data-driven** — a new game/theme is mostly a `web/worlds/<id>.json` (theme + characters
  + teaching banks) + a `music.mp3`/`intro.mp4`; don't hardcode content in a renderer.
- **All rules live in `pachisi.js`** and stay DOM-free so `npm test` can regression-test them. The
  cruciform geometry is generated + asserted (orthogonal, 4-fold symmetric, 12 castles) — never
  hand-edit path arrays; change the generator and re-run the geometry tests.
- The engine indexes each player's path by their **`seat`** (0=S,1=E,2=N,3=W), not turn-order — a
  2-player game seats South & North. Keep that mapping.
- **Authentic Pachisi:** six cowries (0→25, 1→10, 6→6 are graces + extra throw); enter **only on a
  grace**; **exact** throw to finish; castles are safe; two same-colour pieces **blockade**; capture
  returns a piece to the Charkoni and earns another throw.
- **Both renderers reuse** the engine + the DOM reveal/roster/cowrie HUD. When you change one mode's
  flow, mirror it in the other. **Always test a REAL click** (an invisible `[hidden]` overlay once
  silently blocked all clicks) — not just the `window.__pagade` debug hook.
- Validate with `npm test` (27) + `node tooling/qa.mjs` (2D) + `node tooling/qa3d.mjs` (3D,
  swiftshader). **APK CI needs JDK 21.** **Ask before publishing** / cutting a release.
