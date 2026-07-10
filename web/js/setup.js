// Lobby: pick a world/theme, 2-4 players and a character (archetype) for each, then begin.
import { PLAYER_COLORS, SEATING, saveConfig, loadConfig } from './config.js';

const WORLD_IDS = ['dharma', 'mahabharata', 'ancient-india'];
const worlds = {};
const state = { world: 'dharma', count: 2, players: [] };

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

function seatFor(i) { return (SEATING[state.count] || SEATING[4])[i]; }

function defaultPlayer(i) {
  const roster = (worlds[state.world] && worlds[state.world].characters) || [];
  return { name: `Player ${i + 1}`, char: roster.length ? roster[i % roster.length].id : null };
}

function ensurePlayers() {
  while (state.players.length < state.count) state.players.push(defaultPlayer(state.players.length));
  state.players.length = state.count;
  const roster = (worlds[state.world] && worlds[state.world].characters) || [];
  const used = new Set();
  state.players.forEach((p, i) => {
    const valid = roster.some((c) => c.id === p.char);
    if (!valid || (used.has(p.char) && used.size < roster.length)) {
      const free = roster.find((c) => !used.has(c.id));
      p.char = free ? free.id : (roster.length ? roster[i % roster.length].id : null);
    }
    used.add(p.char);
  });
}

function renderThemes() {
  const box = $('#themes'); box.innerHTML = '';
  for (const id of WORLD_IDS) {
    const w = worlds[id];
    const c = el('button', 'card' + (id === state.world ? ' sel' : ''));
    c.setAttribute('aria-pressed', String(id === state.world));
    c.style.setProperty('--accent', (w.theme && w.theme.accent) || '#e8b64a');
    c.innerHTML = `<div class="t">${w.title}</div><div class="s">${w.subtitle || ''}</div><div class="swatch"></div>`;
    c.addEventListener('click', () => { state.world = id; ensurePlayers(); renderThemes(); renderPlayers(); });
    box.appendChild(c);
  }
}

function renderCounts() {
  const box = $('#counts'); box.innerHTML = '';
  for (let n = 2; n <= 4; n++) {
    const b = el('button', 'pill' + (n === state.count ? ' sel' : ''), `${n} players`);
    b.setAttribute('aria-pressed', String(n === state.count));
    b.addEventListener('click', () => { state.count = n; ensurePlayers(); renderCounts(); renderPlayers(); });
    box.appendChild(b);
  }
}

function renderPlayers() {
  ensurePlayers();
  const roster = (worlds[state.world] && worlds[state.world].characters) || [];
  const box = $('#players'); box.innerHTML = '';
  const seatName = { 0: 'South', 1: 'East', 2: 'North', 3: 'West' };
  state.players.forEach((p, i) => {
    const seat = seatFor(i);
    const color = PLAYER_COLORS[seat];
    const row = el('div', 'prow');
    row.style.setProperty('--pc', color);
    const dot = el('span', 'dot');
    const name = el('input', 'pname'); name.value = p.name; name.maxLength = 14; name.setAttribute('aria-label', `Player ${i + 1} name`);
    name.addEventListener('input', () => (p.name = name.value || `Player ${i + 1}`));
    const seatTag = el('span', 'seat', seatName[seat]);
    const chars = el('div', 'chars');
    for (const c of roster) {
      const chip = el('button', 'chip' + (c.id === p.char ? ' sel' : ''), `${c.glyph}<span class="cn">${c.name}</span>`);
      chip.setAttribute('aria-pressed', String(c.id === p.char));
      chip.setAttribute('aria-label', `${c.name} — ${c.symbol || ''}`);
      chip.title = `${c.name} · ${c.symbol || ''}`;
      chip.style.setProperty('--pc', color);
      chip.addEventListener('click', () => { p.char = c.id; renderPlayers(); });
      chars.appendChild(chip);
    }
    row.append(dot, name, seatTag, chars);
    box.appendChild(row);
  });
}

function begin() {
  saveConfig({ world: state.world, players: state.players.map((p) => ({ name: p.name, char: p.char })) });
  location.href = `play.html?world=${state.world}`;
}

async function main() {
  const arr = await Promise.all(WORLD_IDS.map((id) => fetch(`worlds/${id}.json`).then((r) => r.json())));
  WORLD_IDS.forEach((id, i) => (worlds[id] = arr[i]));

  const params = new URLSearchParams(location.search);
  const w = params.get('world');
  if (w && worlds[w]) state.world = w;

  const prev = loadConfig();
  if (prev && Array.isArray(prev.players) && prev.players.length) {
    state.count = Math.min(4, Math.max(2, prev.players.length));
    if (prev.world && worlds[prev.world] && !w) state.world = prev.world;
    state.players = prev.players.slice(0, 4).map((p, i) => ({ name: p.name || `Player ${i + 1}`, char: p.char }));
  }
  ensurePlayers();

  renderThemes();
  renderCounts();
  renderPlayers();
  $('#begin').addEventListener('click', begin);
}

main();
