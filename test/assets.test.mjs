// Asset-sync regression: every world should ship a music bed and an intro film, with valid
// headers and non-trivial size. Skips gracefully when assets have not been generated yet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const asset = (id, f) => fileURLToPath(new URL(`../web/assets/${id}/${f}`, import.meta.url));
const WORLDS = ['dharma', 'mahabharata', 'ancient-india'];

for (const id of WORLDS) {
  test(`world ${id} has a valid music bed + intro film`, async (t) => {
    const mp3 = asset(id, 'music.mp3');
    const mp4 = asset(id, 'intro.mp4');
    if (!existsSync(mp3) && !existsSync(mp4)) { t.skip(`no media generated for ${id}`); return; }

    assert.ok(existsSync(mp3), `${id} music.mp3 present`);
    assert.ok((await stat(mp3)).size > 20000, `${id} music.mp3 non-trivial`);
    const m = await readFile(mp3);
    const id3 = m[0] === 0x49 && m[1] === 0x44 && m[2] === 0x33; // 'ID3'
    const frame = m[0] === 0xff && (m[1] & 0xe0) === 0xe0; // MPEG frame sync
    assert.ok(id3 || frame, `${id} music.mp3 valid MP3 header`);

    assert.ok(existsSync(mp4), `${id} intro.mp4 present`);
    assert.ok((await stat(mp4)).size > 100000, `${id} intro.mp4 non-trivial`);
    const v = await readFile(mp4, { encoding: null });
    // MP4 files carry an 'ftyp' box near the start
    assert.ok(v.slice(4, 8).toString('latin1') === 'ftyp', `${id} intro.mp4 valid MP4 header`);
  });
}
