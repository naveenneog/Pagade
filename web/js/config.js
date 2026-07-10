// Shared configuration for personalisation + local hotseat multiplayer.
// The lobby (setup.js) writes a config to sessionStorage; the game (game.js) reads it so the same
// players, characters and theme carry across the session. Two-player games are seated on OPPOSITE
// arms (South & North) so the board stays balanced; three/four fill the remaining arms.

// The four traditional Pachisi seat colours (red, green, yellow, black), brightened so every piece
// reads clearly on the dark cloth board. Index = arm/seat order (South, East, North, West).
export const PLAYER_COLORS = ['#e5484d', '#46c76a', '#e8c24a', '#8b7bf0'];
const KEY = 'pagade.game';

// Two players face each other across the board; more fill in counter-clockwise.
export const SEATING = {
  2: [0, 2], // South, North
  3: [0, 1, 2], // South, East, North
  4: [0, 1, 2, 3], // all four arms
};

export function loadConfig() {
  try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; }
}

export function saveConfig(cfg) {
  try { sessionStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* private mode */ }
}

// Return a coherent { world, players[] } for the world being rendered. Players from the lobby are
// reused; characters are (re)assigned from this world's roster when the stored config was for a
// different theme or lacks a character. Seats are drawn from SEATING for the player count.
export function gameForWorld(world) {
  const roster = (world && world.characters) || [];
  const stored = loadConfig();
  const pick = (i) => (roster.length ? roster[i % roster.length].id : null);
  const sameWorld = stored && stored.world === world.id;
  let raw;
  if (stored && Array.isArray(stored.players) && stored.players.length) {
    raw = stored.players.slice(0, 4);
  } else {
    raw = [{}, {}]; // default: a two-player game
  }
  const seats = SEATING[raw.length] || SEATING[4];
  const players = raw.map((p, i) => ({
    name: (p && p.name) || `Player ${i + 1}`,
    seat: seats[i],
    color: (p && p.color) || PLAYER_COLORS[seats[i]],
    char: (sameWorld && p && p.char && roster.some((c) => c.id === p.char)) ? p.char : pick(i),
  }));
  return { world: world.id, players };
}

export function charOf(world, id) {
  const roster = (world && world.characters) || [];
  return roster.find((c) => c.id === id) || roster[0] || { name: 'Player', glyph: '●' };
}
