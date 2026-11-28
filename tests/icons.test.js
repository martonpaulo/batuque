// The site icon (#30): every icon each built page links (index.html, 404.html and every rhythm path
// tools/build-site.mjs writes; a moved path's page only redirects and is never shown) answers 200 from the built site, and a PNG has the size its link declares.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { MOVED } from '../src/rhythms/index.js';
import { buildSite } from '../tools/build-site.mjs';
import { icoOf, icoPictures } from '../tools/ico.mjs';
import { startStaticServer } from '../tools/static-server.mjs';

const ICON_LINK = /<link rel="(?:icon|apple-touch-icon)" href="([^"]+)"[^>]*>/g;
const PNG_WIDTH_OFFSET = 16; // IHDR: width then height, big-endian, after the 8-byte signature and the chunk header

test('every page of the built site links icons that it serves, at their declared sizes', async () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), 'baque-icons-'));
  const out = path.join(parent, 'site');
  buildSite(out);
  const server = await startStaticServer(out, 0);
  try {
    const redirects = Object.keys(MOVED).map(id => `${id}.html`);
    for (const page of readdirSync(out).filter(name => name.endsWith('.html') && !redirects.includes(name))) {
      const links = [...readFileSync(path.join(out, page), 'utf8').matchAll(ICON_LINK)];
      assert.ok(
        links.some(([tag]) => tag.includes('image/svg+xml')),
        `${page} links the SVG icon`,
      );
      for (const [tag, href] of links) {
        const response = await fetch(new URL(href, server.url));
        assert.equal(response.status, 200, `${page}: ${href}`);
        const sizes = tag.match(/sizes="(\d+)x(\d+)"/);
        const file = Buffer.from(await response.arrayBuffer());
        if (!sizes) continue;
        // an icon file holds several pictures: the declared size is its largest
        const png = href.endsWith('.ico') ? icoPictures(file).at(-1).png : file;
        assert.deepEqual([png.readUInt32BE(PNG_WIDTH_OFFSET), png.readUInt32BE(PNG_WIDTH_OFFSET + 4)], [Number(sizes[1]), Number(sizes[2])], href);
      }
    }
  } finally {
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

// #69: Google Search and tools that never read the page ask for /favicon.ico.
test('favicon.ico holds the icon at 16, 32 and 48 px, each a PNG of its size, and is the first icon the home page links', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const pictures = icoPictures(readFileSync(path.join(root, 'favicon.ico')));
  assert.deepEqual(
    pictures.map(({ width, height }) => [width, height]),
    [
      [16, 16],
      [32, 32],
      [48, 48],
    ],
  );
  for (const { width, png } of pictures) {
    assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
    assert.equal(png.readUInt32BE(PNG_WIDTH_OFFSET), width);
  }
  const [first] = [...readFileSync(path.join(root, 'index.html'), 'utf8').matchAll(ICON_LINK)];
  assert.equal(first[1], 'favicon.ico');
});

test('an icon file is written from its pictures and read back whole, and a picture that is not square is refused', () => {
  const picture = (width, height = width) => {
    const png = Buffer.alloc(40 + width); // a PNG's first bytes: only the size is read
    png.write('\x89PNG', 0, 'latin1');
    png.writeUInt32BE(width, PNG_WIDTH_OFFSET);
    png.writeUInt32BE(height, PNG_WIDTH_OFFSET + 4);
    return png;
  };
  const pictures = [picture(16), picture(256)];
  const read = icoPictures(icoOf(pictures));
  assert.deepEqual(
    read.map(({ width, height }) => [width, height]),
    [
      [16, 16],
      [256, 256],
    ],
  );
  for (const [i, { png }] of read.entries()) assert.ok(png.equals(pictures[i]));
  assert.equal(icoPictures(icoOf([])).length, 0);
  assert.throws(() => icoOf([picture(16, 32)]), /square/);
  assert.throws(() => icoOf([picture(512)]), /at most 256/);
});
