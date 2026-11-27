// REQ-574 / REQ-571: every infographic concept renders one use case with icons, a process diagram, text of at least 20 px and no overlapping text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { ROWS } from './c27x_fixture.mjs';
import { galleryFor, CONCEPTS } from '../src/lib/docgen/designs/infog/gallery.js';
import { checkSvg } from './tools/infogCheck.mjs';

const items = galleryFor(ROWS);

test('the gallery has at least 10 concepts, 3 portrait, 3 landscape, 6 use cases', () => {
  assert.equal(items.length, CONCEPTS.length, 'every concept finds its use case in the fixture');
  assert.ok(items.length >= 10, `${items.length} concepts`);
  assert.ok(items.filter((c) => c.orientation === 'portrait').length >= 3);
  assert.ok(items.filter((c) => c.orientation === 'landscape').length >= 3);
  assert.ok(new Set(items.map((c) => c.uc)).size >= 6);
  assert.equal(new Set(items.map((c) => c.pattern)).size, items.length, 'each concept has its own visual pattern');
});

test('each concept has 6+ icons, a process diagram and no font under 20 px', () => {
  for (const c of items) {
    assert.match(c.svg, /^<svg [^>]*data-infog=/, c.file);
    const icons = (c.svg.match(/data-icon=/g) || []).length;
    assert.ok(icons >= 6, `${c.file}: ${icons} icons`);
    assert.ok(/data-process=/.test(c.svg), `${c.file}: no data-process`);
    const small = [...c.svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1])).filter((v) => v < 20);
    assert.deepEqual(small, [], `${c.file}: font sizes under 20`);
  }
});

test('laid out in Chromium, no concept has overlapping, small or off-canvas text; a planted bad svg is caught', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const c of items) assert.deepEqual(await checkSvg(page, c.svg), [], c.file);
    const bad = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><text x="20" y="60" font-size="30">Overlapping line</text><text x="30" y="66" font-size="30">Overlapping line</text><text x="20" y="150" font-size="14">tiny</text></svg>';
    const found = await checkSvg(page, bad);
    assert.ok(found.some((p) => p.startsWith('overlap')), `overlap not caught: ${found}`);
    assert.ok(found.some((p) => p.startsWith('small 14px')), `small text not caught: ${found}`);
  } finally { await browser.close(); }
});
