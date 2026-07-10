# Pachisi — the journey home

**The world's oldest strategic journey game, rebuilt as a living cultural experience.** Long before
Ludo, there was **Pachisi** — played on a cloth cross with **cowrie shells** in the courts and
villages of ancient India. It was never *just* a game: every piece is a soul, every journey a life,
and the still centre — the **Charkoni** — is home. This is Pachisi reconstructed with its original
symbolism intact: **"From Fate to Dharma: The Journey Home."**

Open the game and you land on a **launch page** (`index.html`); **Play** takes you to the **lobby**
(`setup.html`) to pick a **world**, **2–4 players**, and a **character** (archetype) for each. Then
play **local pass-and-play** on one screen, seated around the cross like a family around the cloth.

- **Board** (`play.html`) — the classic 2D cruciform board with cowrie-shell throws, four pieces
  per player, captures, castle refuges, and a live turn roster.
- **Teaching Reveal** — entering the board, capturing, resting on a castle, and coming home each
  reveal a **teaching, read aloud** (browser speech in this build; Azure Neural TTS planned). Play
  the game, absorb the culture.

**Play on the web** via GitHub Pages, or **install the Android APK** from Releases (built by CI with
Capacitor). Licensed under PolyForm Noncommercial 1.0.0.

## Run

```
npm run serve      # -> http://localhost:5175
```

Must be served over HTTP; opening `web/index.html` via `file://` blocks the `fetch` of the world JSON.

## Test

```
npm test                 # node:test unit suite (engine geometry + rules, worlds, DOM smoke)
node tooling/qa.mjs       # Playwright: console-error watch, a driven game, screenshots -> tooling/_qa/
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
web/js/audio.js     procedural Web Audio (cowrie rattle, move, capture, castle, home, win + drone)
web/js/game.js      2D renderer + interaction: board, cowrie thrower, pieces, Teaching Reveal
web/js/setup.js     the lobby
web/worlds/*.json   the game data (theme + characters + teaching banks)
```

## Roadmap

- **M0** web prototype (this) — full authentic rules, three worlds, Teaching Reveal ✅
- **M1** per-theme AI art (gpt-image-2 board/tokens) + Azure Neural TTS narration
- **M2** a 3D board (Three.js) and a cinematic mode, matching the sibling games
- **M3** more regional variants (Pagade, Dayakattam, Chaupar), online play
