# Pagade — project context (read this to resume)

> **If you are an AI agent resuming work on this game, read this file first.** It is the durable
> memory of what Pagade is, how it is built, what is shipped, and where to pick up. Sister
> projects: **Sopāna** (`../Sopana`) and **Chaturanga** (`../Chaturanga`), which pioneered the
> data-driven "worlds over a pure engine" pattern this game follows.

- **Owner:** @naveenneog (Naveen Gopalakrishna)
- **Naming:** the game is **Pagade** (the Karnataka name for **Pachisi**). The public repo is
  **github.com/naveenneog/Pagade** (Pages: **naveenneog.github.io/Pagade**). The local dev folder is
  historically `C:\Users\navg\DailyApps\Pachisi` and the pure engine file stays `web/js/pachisi.js`
  (it implements the Pachisi/Pagade rules) — everything user-facing says **Pagade**.
- **What:** a digital reconstruction of the ancient Indian **cross-and-cowries** journey game
  (Ludo's ancestor) — rebuilt with its original symbolism: *"From Fate to Dharma: The Journey Home."*
  Every piece is a soul; the centre (Charkoni) is home; every milestone reads a teaching aloud.
- **Status:** **v1.1** — a complete, authentic, tested game in **2D and 3D**: cruciform board,
  six-cowrie throws, 2–4 hotseat players, capture / castles / blockades / exact-finish, a **Teaching
  Reveal**, three themed worlds, per-world **Sora-2 intro films** + composed **music beds**, a lobby
  (with a 2D|3D mode toggle) and a launch page. **Published & live** at naveenneog.github.io/Pagade
  (v1.0.0 released with an APK; cut v1.1.0 for the 3D+media build). **Ask before publishing further.**
- **Run:** `npm run serve` → http://localhost:5175 · **Test:** `npm test` (27 tests) · **QA:**
  `node tooling/qa.mjs` (2D) + `node tooling/qa3d.mjs` (3D, swiftshader) → `tooling/_qa/`.

---

## Architecture (data over a pure engine, two renderers)
Served from `web/`:
```
index.html          LAUNCH / landing page (Play -> setup.html; installed app/PWA skip to setup.html)
setup.html + js/setup.js     LOBBY: world, 2-4 players, a character each, MODE (2D|3D) -> sessionStorage (pagade.game)
play.html   + js/game.js     Renderer A — flat 2D cruciform board + all interaction
play3d.html + js/board3d.js  Renderer B — Three.js 3D board: glowing beehive pawns, bloom, orbit camera
js/pachisi.js       PURE rules + geometry (no DOM) — the heart; fully unit-tested
js/config.js        hotseat config + SEATING (2 players seat opposite: South & North)
js/audio.js         Web Audio SFX + a per-world music-bed loop (setMusic); falls back to a drone
js/intro.js         auto-dismissing per-world intro-film overlay (shared by both renderers)
vendor/             three.module.js + three.core.js + the bloom chain (EffectComposer/RenderPass/UnrealBloomPass/OutputPass + shaders)
worlds/<id>.json    the game data (theme, characters, teaching banks)
css/styles.css      board + HUD + reveal + 3D-layout + intro-overlay styling (theme-driven CSS vars)
manifest.webmanifest  PWA — start_url = setup.html (installed app opens the game, not the landing)
assets/brand/       icons/favicon (tooling/make_brand.py — the board as a logo)
assets/<world>/     music.mp3 (tooling/gen_music.py) + intro.mp4 (tooling/gen_intro.py, Sora-2)
```
Data flow: `worlds/<id>.json → validateWorld → createGame(state)`; each renderer drives the state via
`throwCowries → legalMoves → (player picks) → applyMove → nextTurn`, animating each step and firing a
**Teaching Reveal** on milestones. Both renderers reuse the engine + the DOM reveal/roster/cowrie HUD.
Debug hook: **`window.__pagade`** = `{ state, world, geo, awaitingPick, pendingMoves, busy, throw,
pick, loadWorld, mode }` (used by QA + the DOM smoke test). `?nointro=1` skips the intro film.

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

## Features shipped (v1.1)
- Full authentic **cruciform + cowrie** game with capture, castles, blockades, grace/exact-finish.
- **Two renderers** from one engine: a flat **2D** board (`game.js`) and a **3D** board (`board3d.js`,
  Three.js) with glowing beehive **LatheGeometry pawns**, a bloom-lit Charkoni + castle stars, an
  orbit/zoom/pinch camera (`fitRadius`), and per-world 3D environment (bg/fog/lights from `theme`).
- **Local hotseat 2–4**, seated around the arms (2 = opposite); live roster with per-piece pips
  (yard / active / home); pieces **fan out** when sharing a cell.
- **Teaching Reveal** on enter/castle/capture/home/win/journey, **read aloud** with word highlight.
- **Per-world Sora-2 intro films** (`intro.js` overlay, once per session, always skippable) and
  composed **raga music beds** (`audio.setMusic`, falls back to a procedural drone). Sound + Read-
  aloud toggles.
- **Three themed worlds** + in-game world switcher; **lobby** (world / count / character / **mode**)
  + a **launch page**; PWA manifest. Responsive (desktop + phone verified in both modes).

## 3D renderer + media pipeline
- `board3d.js` is **art-directed per world** from a `theme3d` block in each world JSON:
  `surface`/`tileScheme` (dharma indigo cloth · mahabharata red/ivory **checker** stone court ·
  ancient-india **sandstone**), `pawn` sculpt (**stupa** beehive+finial · **chariot** bronze mace ·
  **pillar** Ashokan column+chakra — all keep the player colour + emissive), `charkoni`
  (**lotus** petals · **fire** ember orb · Ashoka **chakra** wheel), `props` at the arm tips (**diya
  lamps** · **torches** · **pillars**), and `particles` (**gold motes** · rising **embers** ·
  drifting **dust**). Add a world's 3D look = its `theme3d`; the style ids map to builders in board3d.js.
- **3D cowrie throw:** six real shell meshes **tumble from above and settle** to the engine's
  predetermined result (`shells[i]` → mouth-up = flat side up), animated in the render loop
  (`throwCowries3d`/`stepCowries`), then rest on the board. `WebGLRenderer` (ACESFilmic, exposure
  1.18) + an **EffectComposer bloom chain** so emissive pawns/Charkoni/fires halo; flickering fires
  + animated particles + a slowly turning Charkoni in `tick`.
- **Media generators** (Azure, AAD via `az login`, endpoint `ai-contosohub530569751908`):
  `tooling/gen_intro.py` → Sora-2 **text-to-video** (`/openai/v1/videos?api-version=preview`,
  `Bearer` token, ~1–2 min each, sequential) → `assets/<world>/intro.mp4`. `tooling/gen_music.py`
  → numpy additive-synth raga loops + ffmpeg mp3 (seamless-loop tail-wrap) → `assets/<world>/music.mp3`.
  `tooling/gen_voice.py` → **DragonHD Indian narration** for every teaching (Azure Speech REST,
  `aad#<RESOURCE_ID>#<token>` — NO "Bearer"; pitch as `%` never `0st`) → `assets/<world>/voice/<hash>.mp3`
  + `voice.json`. dharma/mahabharata = `en-IN-Arjun:DragonHDLatestNeural`, ancient-india = `en-IN-Neerja`.

## Realistic carved GLB pawns (v1.4)
- The six pawn sculpts are now **real carved-ivory GLB figurines** (was procedural Three.js). Built
  with the **`realistic-3d-objects`** skill (`~/.copilot/skills/realistic-3d-objects`): a matched
  museum set — temple **stupa**, mace-bearing **warrior**, **lotus** bloom, sacred **kalash**,
  caparisoned **elephant** (Gaja), Ashoka **pillar** (four-lion capital). Manifest:
  `tooling/pawns.manifest.json`.
- **Pipeline** (reuses Chaturanga's `.venv3d` CPU env + Blender 5.1; AAD `az login`): `gen_refs.py`
  (gpt-image-2 concepts, ivory figurines on lotus pedestals) → `ivory_bg.py` (rembg → `.proj.jpg`) →
  **`hf_batch.py`** (free tencent/Hunyuan3D-2 HF Space, GPU, ~11s/piece, dense crisp mesh — *far*
  better than TripoSR) → **Blender `texture_project.py`** (orient + two-sided concept projection →
  `web/assets/models/<key>.glb`, ~640KB each, 28k faces w/ JPEG texture).
- **Orientation gotcha (hard-won):** the skill's default `ROTX=0 CAM=+Y` for Hunyuan assumes its
  Chaturanga framing; our **tall 1024×1536 portrait** concepts came out of Hunyuan **inverted/tilted**
  → use **`ROTX=180 CAM=+Y`**. Verify with the texture_project DBG (`up=[~0,~0,1]`, small `body lean`)
  and **trimesh bounds** (tall along **Y**, base at y=0) — the Blender QA renders (`inspect_glb.py`
  vs `axis_views.py`) use opposite camera-up conventions and disagree, so trust trimesh / the actual
  Three.js render, not those.
- **Wiring** (`board3d.js`): vendored `GLTFLoader.js` + `BufferGeometryUtils.js` + `SkeletonUtils.js`
  (import map maps `three`). `loadPawnModels()` preloads the 6 GLBs once, `normalizePawn` scales to
  `PAWN_TARGET_H` + rests base at y=0. `makePawnGLB(color,style)` clones the template, **tints**
  `material.color` toward the seat hue (lightened 18% so the carved relief reads) + emissive = full
  hue for a bloom glow, and sets `userData.mat/baseEmissive/baseScale` so the existing select-pulse
  works. **Procedural `makePawn` stays as the fallback** if a GLB is missing. `chariot`→`warrior`
  GLB alias. QA: `node tooling/qa_glb.mjs` (per-world GLB-usage diag + console errors).

## Narration, pawns, distant world (v1.3)
- **Voice** (`web/js/narrate.js`, shared by both renderers): plays the pre-generated **DragonHD**
  clip for a teaching (word-highlight synced to the clip), and only falls back to the (robotic)
  browser voice, then a silent timed highlight, if a clip is missing/blocked. `setVoice(map, base,
  lang)` is called per world from the fetched `voice.json`.
- **Creative pawns** (`web/js/pawnsvg.js` + `config.js PAWN_SHAPES`/`pawnStyleFor`): players pick a
  pawn per player in the lobby — stupa / warrior / lotus / kalash / elephant / pillar, or "Themed"
  (the world's own sculpt). 2D renders a shaded SVG token; 3D renders the matching sculpt
  (`board3d.js makePawn`). `chariot`↔`warrior` are aliased.
- **Per-world 3D scene** driven by `theme3d`: distinct tiles, `charkoni` (lotus/fire/chakra),
  arm-tip props (diya lamps / torches / **authentic Ashoka Stambha** pillars — shaft + inverted-lotus
  bell + abacus + four-lion capital + chakra), particles (motes/embers/dust), plus a **distant 3D
  world** (`buildEnvironment`: gradient sky dome + starfield + a themed horizon skyline). A **3D
  cowrie throw** tumbles six real shells onto the board.

---

## Build / run / test / QA
```bash
npm run serve                 # dev server -> http://localhost:5175 (scripts/serve.mjs)
npm test                      # node:test: pachisi (engine+geometry 19) + worlds (4) + assets (3) + dom.smoke (1) = 27
node tooling/qa.mjs           # Playwright (2D): console/page-error watch, screenshots, driven game
node tooling/qa3d.mjs         # Playwright (3D, --use-angle=swiftshader): per-world 3D shots + driven game
```
QA reuses the Chromium already downloaded for the sibling games (`~/AppData/Local/ms-playwright`).
Local `npm install` for jsdom/playwright used `--registry https://registry.npmjs.org` (private
registry 401s). The deterministic driver installs a controllable cowrie rng
(`window.__setThrow('grace'|'three')` → forces 25 / 3) so QA is repeatable. **3D QA needs software
WebGL** (`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`) and is slow (minutes).

---

## Publishing (DONE — ask before further releases)
- **Web:** live at **https://naveenneog.github.io/Pagade/** (`.github/workflows/pages.yml` deploys
  `web/` on push to `main`; enabled once via `gh api --method POST repos/naveenneog/Pagade/pages -f
  build_type=workflow`).
- **APK:** `.github/workflows/apk.yml` wraps `web/` with **Capacitor 7** → `assembleDebug`. **CI must
  use JDK 21** (Capacitor 7 compiles source release 21; JDK 17 → `invalid source release: 21`).
  `capacitor.config.json` appId = `com.naveenneog.pagade`. Publishes `Pagade-vX.Y.Z.apk` + stable
  `Pagade.apk`. v1.0.0 released (2D); cut v1.1.0 for the 3D+media build.
- **License:** PolyForm Noncommercial 1.0.0. **@naveenneog wants to be asked before publishing.**

---

## Gotchas (don't relearn)
1. **Seat, not turn index, indexes the path.** A 2-player game is seats [0,2] (S/N). All capture /
   move / occupancy checks use `player.seat`. Breaking this misaligns pieces with arms.
2. **The middle column is traversed twice** (out early, in late) so a cell can appear at two path
   indices for the same player — positions are indices, not cells. Fine for capture (private cells
   are never shared with opponents except the tip castle).
3. **`[hidden]` needs an explicit escape when the class sets `display`.** `.reveal`/`.intro` set
   `display:grid`, which (author-origin) **overrides the UA `[hidden]{display:none}`** — so the
   overlays never hid and the invisible reveal/win overlay **silently blocked every real board
   click** (QA used the debug hook, so it hid for weeks). Fixed with `.reveal[hidden],.intro[hidden]
   { display:none !important }`. **Always test a REAL click, not just the debug hook.**
4. **Fixed panels: set `top:auto`.** `.hud.floating3d` inherited `top:0.5rem` from `.hud`; with its
   own `bottom` that stretched it to full height and it covered the whole 3D board on mobile.
5. **CSS class collisions bite:** the legend chip class `yard` got hit by the board `.yard` rule
   (`position:absolute; width:26%`) → a stray 40px box. Renamed to `.chip.charkoni`.
6. **Geometry is generated + asserted** — never hand-edit `paths`; change the generator, keep tests green.
7. **Media play() guards:** `intro.js` video.play() and `audio.js` musicEl.play() are wrapped in
   try/catch (jsdom throws "Not implemented"); audio also no-ops without an AudioContext.
8. **Sora-2** = text-to-video only (image refs with people get moderation-blocked); `Bearer` token on
   the `/openai/v1/videos` route. **Headless Chromium can't decode the H.264 intro** — `intro.js`
   backstops on stall/error and `?nointro=1` skips it (QA uses that).
9. **`ॐ` (Om), not a swastika**, is the brand/Charkoni glyph. World-JSON emoji use `\uXXXX` escapes.
10. **Every async turn step must reset `busy`.** A thrown error in `onThrow`/`pick` (or a dead render
    loop) left `busy=true` forever → the 3D board "stopped, can't click". Both renderers now wrap the
    flow in try/catch/finally, `board3d.js tick()` is wrapped in try/catch and **always** reschedules
    `requestAnimationFrame`, `throwCowries3d` has a hard-timeout resolve, and 3D taps use a forgiving
    raycast + screen-space nearest fallback. Regression-guarded by `tooling/qa_fix.mjs` (30-turn stress).
11. **`narrate.js` guards `new Audio()`** (`typeof Audio !== 'undefined'` + try/catch) — jsdom has no
    Audio, and an unguarded throw here previously hung the whole move flow (and the test suite).

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
