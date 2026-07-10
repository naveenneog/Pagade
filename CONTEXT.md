# Pachisi — project context (read this to resume)

> **If you are an AI agent resuming work on this game, read this file first.** It is the durable
> memory of what Pachisi is, how it is built, what is shipped, and where to pick up. Sister
> projects: **Sopāna** (`../Sopana`) and **Chaturanga** (`../Chaturanga`), which pioneered the
> data-driven "worlds over a pure engine" pattern this game follows.

- **Owner:** @naveenneog (Naveen Gopalakrishna)
- **What:** a digital reconstruction of **Pachisi** — the ancient Indian **cross-and-cowries**
  journey game (Ludo's ancestor) — rebuilt with its original symbolism: *"From Fate to Dharma: The
  Journey Home."* Every piece is a soul; the centre (Charkoni) is home; every milestone reads a
  teaching aloud.
- **Status:** **v1.0 (M0)** — a complete, authentic, tested 2D game: cruciform board, six-cowrie
  throws, 2–4 hotseat players, capture / castles / blockades / exact-finish, a **Teaching Reveal**,
  three themed worlds, a lobby and a launch page. Procedural audio. **Not yet published** (see
  Publishing — ask before pushing to public Pages / cutting a release).
- **Run:** `npm run serve` → http://localhost:5175 · **Test:** `npm test` (24 tests) · **QA:**
  `node tooling/qa.mjs` (Playwright screenshots → `tooling/_qa/`).

---

## Architecture (data over a pure engine)
Served from `web/`:
```
index.html          LAUNCH / landing page (Play -> setup.html; installed app/PWA skip to setup.html)
setup.html + js/setup.js     LOBBY: world, 2-4 players, a character each -> sessionStorage (pachisi.game)
play.html + js/game.js       the 2D renderer + all interaction (the only mode today)
js/pachisi.js       PURE rules + geometry (no DOM) — the heart; fully unit-tested
js/config.js        hotseat config + SEATING (2 players seat opposite: South & North)
js/audio.js         procedural Web Audio (cowrie rattle, move, capture, castle, home, win + drone)
worlds/<id>.json    the game data (theme, characters, teaching banks)
css/styles.css      board + HUD + reveal styling (theme-driven CSS vars)
manifest.webmanifest  PWA — start_url = setup.html (installed app opens the game, not the landing)
assets/brand/       icon/favicon (NOT yet generated — see backlog)
```
Data flow: `worlds/<id>.json → validateWorld → createGame(state)`; `game.js` drives the state via
`throwCowries → legalMoves → (player picks) → applyMove → nextTurn`, animating each step and firing a
**Teaching Reveal** on milestones. Debug hook: **`window.__pachisi`** = `{ state, world, geo,
awaitingPick, pendingMoves, busy, throw, pick, loadWorld }` (used by QA + the DOM smoke test).

---

## The board geometry (the crux — generated + tested, never hand-edit)
A **15×15 lattice**; only the **cross** cells exist (`row∈[6,8]` OR `col∈[6,8]` = 81 cells). Arms are
**3 wide × 6 long**; the centre 3×3 is the **Charkoni**. `buildGeometry()` in `pachisi.js`:
- **Ring** — a **56-cell** public loop, built by walking one arm segment and rotating it 4× (90°
  CCW: `(r,c)→(14-c, r)`). Asserted closed + orthogonal.
- **Per-player path** — length **67** (position 1..67), then `HOME = 68`. Shape: **private middle
  column out (5)** + **full ring lap tip→tip (57)** + **private middle column in (5)**. Position 0 =
  in the Charkoni yard (un-introduced / captured). The middle column is traversed **twice** (out and
  back) — authentic Pachisi ("returning pieces laid on their side"); pieces at `pos ≥ 62` render with
  a dashed `.returning` style.
- **Players are indexed by `seat`** (0=South,1=East,2=North,3=West) → `geo.paths[seat]`. Player p's
  path is player 0's rotated p×90° CCW. `createGame` sets `player.seat` (defaults to array index);
  **all path lookups (`cellAt`, `occupantsOn`, `blockadeBetween`, `evaluateMove`) go through `seat`,
  not the turn index** — a 2-player game seats South & North (`config.js SEATING`).
- **12 castle squares** (safe): the 4 arm tips + 8 at "four in from the outer-column ends"
  (`buildCastles`). Private middle cells are exclusive to their owner (opponents only ever share the
  tip castle) — proven by the geometry tests, so capture can only happen on the shared ring.

If you change arm length / geometry, **edit the generator and re-run `test/pachisi.test.mjs`** (it
asserts ring closure, orthogonal same-length paths, on-cross-ness, 4-fold symmetry, private-column
exclusivity, ring sharing, and 12 castles). Do **not** hand-write path arrays.

---

## The rules (authentic Pachisi, all in `pachisi.js`)
- **Cowries** (`throwCowries`, `COWRIE_TABLE`): 6 shells; mouth-up count → value. `0→25, 1→10, 6→6`
  are **graces** (earn another throw); `2,3,4,5` are plain. (The name *paccīs* = 25, the top throw.)
- **Enter:** a yard piece (pos 0) may come onto **square 1 only on a grace**. `legalMoves` de-dupes
  the interchangeable yard pieces to one representative entry.
- **Move:** advance one piece by the throw value. **Exact throw to finish** (`to === HOME`);
  overshoot is illegal. Can't pass an opponent **blockade** (2+ of one opponent on a non-castle
  cell). Landing on an opponent off a castle **captures** (sends them to yard) and earns another
  throw. Can't land on an opponent-held **castle**. Own pieces stack + fan out visually.
- **Turn:** grace **or** capture → same player throws again; otherwise `nextTurn` (skips finished
  players). **Win** = all 4 pieces `HOME`; first to finish wins (game over).
- Deliberately **omitted** (variant/advanced): the "must capture before finishing", PYADA +1, and
  the nullify-by-triple-throw rules. `evaluateMove` returns a rich descriptor the renderer animates.

---

## Worlds + the Teaching Reveal (the cultural layer)
Three worlds in `web/worlds/`. Each has `theme` (CSS colours), `voice` (web lang + azure voice id
for later), `characters[]` (the four archetypes with a `symbol` + `color`), and **teaching banks**:
`enter, castle, capture, captured, home, win, journey[]` (each entry `{text, en}`; `journey` has an
`at` path-index). `game.js pickTeaching` picks the single most significant milestone per move and
`showReveal` narrates it (Web Speech word-highlight; silent timed fallback). On the **winning** move
the intermediate reveal is skipped — the win overlay shows the `win` teaching directly.

| World id | Title | Framing |
|---|---|---|
| `dharma` | From Fate to Dharma | flagship: soul's journey; fate (cowries) vs dharma (choice) |
| `mahabharata` | The Game of Kings | the epic's dice game; capture = a warrior falls; win = dharma restored |
| `ancient-india` | Journey Through Ancient India | each arm an age (Indus→Maurya→Gupta→Vijayanagara→Mughal); journey lines teach history |

Archetypes (shared lineage): **Warrior** (courage), **Scholar** (wisdom), **Merchant** (prosperity),
**Traveler** (discovery) — re-skinned per world (e.g. Arjuna/Bhima/Yudhishthira/Draupadi in
mahabharata). Add a world = a new `worlds/<id>.json` + register the id in `setup.js`, `game.js`'s
`#worldSelect`, and `index.html`.

---

## Features shipped (v1.0 / M0)
- Full authentic **cruciform + cowrie** game with capture, castles, blockades, grace/exact-finish.
- **Local hotseat 2–4**, seated around the arms (2 = opposite); live roster with per-piece pips
  (yard / active / home) and the current player highlighted; pieces **fan out** when sharing a cell.
- **Teaching Reveal** on enter/castle/capture/home/win/journey, **read aloud** with word highlight.
- **Three themed worlds** + an in-game world switcher; **procedural audio** (cowrie rattle, move,
  capture, castle bell, home arpeggio, win fanfare, tanpura drone) with a Sound + a Read-aloud toggle.
- **Lobby** (world / count / character) + a **launch/landing page** (rules, cowrie table, worlds,
  CTA); PWA manifest (installed app opens the lobby). Responsive (desktop + phone verified).

---

## Build / run / test / QA
```bash
npm run serve                 # dev server -> http://localhost:5175 (scripts/serve.mjs)
npm test                      # node:test: pachisi (engine+geometry, 19) + worlds (4) + dom.smoke (1) = 24
node tooling/qa.mjs           # Playwright: watches console/page errors, screenshots landing/lobby/
                              # board/reveal/win/phone, and DRIVES a deterministic game via window.__pachisi
```
QA reuses the Chromium already downloaded for the sibling games (`~/AppData/Local/ms-playwright`).
Local `npm install` for jsdom/playwright used `--registry https://registry.npmjs.org` (private
registry 401s). The deterministic driver installs a controllable cowrie rng
(`window.__setThrow('grace'|'three')` → forces 25 / 3) so QA is repeatable.

---

## Publishing (NOT done yet — ask first)
Mirrors the sibling games (see `../Sopana/CONTEXT.md`). Ready but **not run**:
- **Web:** `.github/workflows/pages.yml` deploys `web/` to Pages (enable once via
  `gh api --method POST repos/naveenneog/Pachisi/pages -f build_type=workflow`).
- **APK:** `.github/workflows/apk.yml` wraps `web/` with **Capacitor 7** → `assembleDebug`. **CI must
  use JDK 21** (Capacitor 7 compiles source release 21; JDK 17 → `invalid source release: 21`).
  `capacitor.config.json` appId = `com.naveenneog.pachisi`. Publishes `Pachisi-vX.Y.Z.apk` + stable
  `Pachisi.apk`.
- **License:** PolyForm Noncommercial 1.0.0. **@naveenneog wants to be asked before publishing.**

---

## Gotchas (don't relearn)
1. **Seat, not turn index, indexes the path.** A 2-player game is seats [0,2] (S/N). All capture /
   move / occupancy checks use `player.seat`. Breaking this misaligns pieces with arms.
2. **The middle column is traversed twice** (out early, in late) so a cell can appear at two path
   indices for the same player — positions are indices, not cells. Fine for capture (private cells
   are never shared with opponents except the tip castle).
3. **CSS class collisions bite:** the legend chip was class `yard` and got hit by the board `.yard`
   rule (`position:absolute; width:26%`) → a stray 40px dashed box. It's now `.chip.charkoni`. Watch
   for shared class names between board elements and HUD elements.
4. **Geometry is generated + asserted** — never hand-edit `paths`; change the generator and keep the
   geometry tests green.
5. **Audio safely no-ops without an AudioContext** (jsdom) — every audio fn guards on `ensure()`.
6. **`ॐ` (Om), not a swastika**, is the brand/Charkoni glyph (chosen over the authentic-but-easily-
   -misread svastika for a public web build).
7. Emoji glyphs in world JSON use `\uXXXX` escapes to keep the files ASCII-safe.

---

## Backlog / where to resume
- **Brand assets** — `web/assets/brand/` (favicon, apple-touch, icon-192/512) are referenced but not
  generated yet; add a `tooling/` generator (gpt-image-2, per the sibling pipeline) + a logo.
- **Per-theme AI art + Azure TTS** (M1) — board cloth / piece art (gpt-image-2) and pre-rendered
  DragonHD narration for each teaching (the `voice.azure` ids are already in each world). See
  `../Sopana`/`../Chaturanga` tooling for the AAD `az login` pipeline.
- **3D board + cinematic mode** (M2) — match the siblings (Three.js). Geometry is already a clean
  cell-graph to lift into 3D.
- **More rules as options** — must-capture-to-finish, PYADA, doubling/blockade-carrying; a simple AI
  opponent; online multiplayer (needs a backend).
- **More regional variants** — Pagade (Karnataka), Dayakattam (Tamil Nadu), Chaupar (3 long dice).
- **First-run onboarding** tour (like Sopana) + landing-page gameplay recording.

Keep this file current as you ship.
