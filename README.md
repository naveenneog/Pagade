# Pagade — the journey home

**The world's oldest strategic journey game, rebuilt as a living cultural experience.** Long before
Ludo, there was **Pachisi** — known in Karnataka as **Pagade** — played on a cloth cross with
**cowrie shells** in the courts and villages of ancient India. It was never *just* a game: every
piece is a soul, every journey a life, and the still centre — the **Charkoni** — is home. This is
Pagade reconstructed with its original symbolism intact: **"From Fate to Dharma: The Journey Home."**

Open the game and you land on a **launch page** (`index.html`); **Play** takes you to the **lobby**
(`setup.html`) to pick a **world**, **2–4 players**, a **character** (archetype) for each, and a
**mode** — then play **local pass-and-play** on one screen, seated around the cross.

- **3D** (`play3d.html`) — a real Three.js cruciform board with **glowing beehive pawns**, a
  bloom-lit Charkoni, a themed 3D environment, and an orbit/zoom camera.
- **2D Board** (`play.html`) — the classic flat cruciform board with cowrie throws, four pieces per
  player, captures, castle refuges, and a live turn roster.
- **Per-world film + music** — each world opens with a **Sora-2 intro film** and plays a composed,
  raga-flavoured **music bed**; every milestone reveals a **teaching, read aloud**.

**Play on the web** via GitHub Pages, or **install the Android APK** from Releases (built by CI with
Capacitor). Licensed under PolyForm Noncommercial 1.0.0.

## Run

```
npm run serve      # -> http://localhost:5175
```

Must be served over HTTP; opening `web/index.html` via `file://` blocks the `fetch` of the world JSON.

## Test

```
npm test                 # node:test unit suite (engine geometry + rules, worlds, assets, DOM smoke)
node tooling/qa.mjs       # Playwright: 2D board — console-error watch, a driven game, screenshots
node tooling/qa3d.mjs     # Playwright (swiftshader): 3D board per world, driven game, screenshots
```

## How Pachisi plays

- **Six cowrie shells** decide movement — the count landing mouth-up is your throw:

  | Cowries up | 0 | 1 | 2 | 3 | 4 | 5 | 6 |
  |---|---|---|---|---|---|---|---|
  | Move | **25** | **10** | 2 | 3 | 4 | 5 | **6** |
  | Grace? | yes | yes | – | – | – | – | yes |

  A **grace** (6, 10 or 25 — the name *Pachisi* means "twenty-five") lets a soul **enter** the board
  and earns **another throw**.
- Pieces travel **down the middle column of their own arm, counter-clockwise around the outer
  columns, and back up the middle** to the Charkoni. A piece needs an **exact** throw to finish.
- Land on an opponent (off a castle) to **capture** it — home it goes, and you throw again. **Castle
  squares** (✦) are safe. Two of your pieces on one square form a **blockade** none may pass.
- **Win** by bringing all **four** of your pieces home.

## Worlds (data-driven)

Each world is one file in `web/worlds/*.json` — a theme, a character roster (the four archetypes),
and **teaching banks** for each milestone (`enter`, `castle`, `capture`, `captured`, `home`, `win`,
`journey`).

| File | World | The journey |
|------|-------|-------------|
| `dharma.json` | From Fate to Dharma | every piece a soul; the flagship journey home |
| `mahabharata.json` | The Game of Kings | the epic's dice game — dharma restored |
| `ancient-india.json` | Journey Through Ancient India | each arm an age: Indus → Maurya → Gupta → Vijayanagara → Mughal |

The four archetypes carry the classic symbolism: **Warrior** (courage), **Scholar** (wisdom),
**Merchant** (prosperity), **Traveler** (discovery).

Add a world = drop in a JSON file and register its id in `web/js/setup.js`, `web/js/game.js`'s
`<select>`, and the landing page.

## Architecture

```
web/js/pachisi.js   PURE rules + geometry (DOM-free, fully unit-tested): cruciform board generator,
                    per-seat paths, cowrie throw, legalMoves/evaluateMove/applyMove, capture,
                    castle safety, blockade, exact finish, validateWorld
web/js/config.js    hotseat multiplayer config + seating (2 players face off S/N)
web/js/audio.js     procedural Web Audio SFX + a per-world music bed (falls back to a drone)
web/js/intro.js     the auto-dismissing per-world intro-film overlay (shared by both renderers)
web/js/game.js      2D renderer + interaction: flat board, cowrie thrower, Teaching Reveal
web/js/board3d.js   3D renderer (Three.js): cruciform + glowing beehive pawns + bloom + orbit camera
web/js/setup.js     the lobby (world / players / characters / mode)
web/vendor/         Three.js + the post-processing bloom chain
web/worlds/*.json   the game data (theme + characters + teaching banks)
web/assets/<world>/ music.mp3 (composed) + intro.mp4 (Sora-2)
tooling/            gen_intro.py (Sora-2), gen_music.py (numpy+ffmpeg), make_brand.py, qa*.mjs
```

## Generating the media (Azure, AAD via `az login`)

```
python tooling/gen_intro.py            # per-world Sora-2 intro films -> web/assets/<world>/intro.mp4
python tooling/gen_music.py            # per-world raga music beds     -> web/assets/<world>/music.mp3
python tooling/make_brand.py           # brand icons (the board as a logo)
```

## Roadmap

- **M0** web prototype — full authentic rules, three worlds, Teaching Reveal ✅
- **M1** per-world Sora-2 intro films + composed music beds ✅
- **M2** a real 3D board (Three.js) with glowing pawns + bloom ✅
- **M3** per-theme AI board art (gpt-image-2) + Azure Neural TTS narration; more regional variants
  (Pagade/Pachisi/Chaupar/Dayakattam), a simple AI opponent, online play
