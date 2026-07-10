// Every shipped world must be valid JSON, pass validateWorld, and be narratable end-to-end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateWorld } from '../web/js/pachisi.js';

const WORLD_IDS = ['dharma', 'mahabharata', 'ancient-india'];
const load = async (id) =>
  JSON.parse(await readFile(fileURLToPath(new URL(`../web/worlds/${id}.json`, import.meta.url)), 'utf8'));

const hex = /^#[0-9a-fA-F]{6}$/;

for (const id of WORLD_IDS) {
  test(`world ${id} is valid, themed and fully narratable`, async () => {
    const w = await load(id);
    assert.equal(w.id, id, 'id matches filename');
    assert.doesNotThrow(() => validateWorld(w));
    assert.ok(w.characters.length >= 4, 'four archetypes');
    for (const c of w.characters) {
      assert.ok(c.symbol, `${c.id} has a symbolic meaning`);
      assert.ok(hex.test(c.color), `${c.id} colour is a hex value`);
    }
    // theme colour sanity — catches stray typos in the palette
    for (const k of ['bg', 'panel', 'board', 'accent', 'text']) {
      assert.ok(hex.test(w.theme[k]), `theme.${k} is a valid hex colour (got ${w.theme[k]})`);
    }
    // narration banks the UI relies on
    for (const kind of ['enter', 'castle', 'capture', 'captured', 'home', 'win']) {
      assert.ok(w.teachings[kind] && w.teachings[kind].length, `${kind} bank present`);
      for (const e of w.teachings[kind]) assert.ok(e.text && e.text.length > 8, `${kind} lines are substantial`);
    }
    // journey milestones are ordered and in path range (1..67)
    for (const j of w.teachings.journey || []) {
      assert.ok(j.at >= 1 && j.at <= 67, `journey milestone ${j.at} in range`);
      assert.ok(j.text, 'journey milestone has text');
    }
  });
}

test('worlds share the four-archetype symbolism (Warrior/Scholar/Merchant/Traveler lineage)', async () => {
  for (const id of WORLD_IDS) {
    const w = await load(id);
    const symbols = w.characters.map((c) => c.symbol);
    assert.equal(new Set(symbols).size, symbols.length, `${id} archetype meanings are distinct`);
  }
});
