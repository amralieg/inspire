// REQ-526 part D: the design infographic and brief page 1 mirror as a whole in right-to-left languages (pages 2+ already did).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { resolveTheme } from '../src/lib/docgen/docStyles.js';
import { briefPagesSvg, infographicSvg } from '../src/lib/docgen/docSvg.js';
import { model } from './req526c_fixture.mjs';

const IDS = ['original', 'editorial_ink', 'bold', 'consulting'];
const MODES = ['light', 'dark'];
const snap = JSON.parse(fs.readFileSync(new URL('./req526d_base.snapshot.json', import.meta.url), 'utf8'));
const h = (s) => crypto.createHash('sha256').update(s).digest('hex');
const MIRROR = '<g transform="translate(794 0) scale(-1 1)">';
const render = (id, mode, rtl) => {
  const m = model({ language: rtl ? 'Arabic' : 'English' }); const th = resolveTheme(id, 'databricks', '', mode);
  const p = briefPagesSvg(m, th); return { info: infographicSvg(m, th), p1: p[0], p2: p[1], rest: p.slice(2) };
};

for (const id of IDS) for (const mode of MODES) {
  const R = render(id, mode, true);
  for (const [name, svg] of [['infographic', R.info], ['page 1', R.p1]]) {
    test(`D1: ${id} ${mode} RTL ${name} is mirrored as a whole`, () => {
      const at = svg.indexOf(MIRROR);
      assert.ok(at > 0, 'the page mirror group');
      assert.ok(svg.indexOf('</defs>') < at, 'defs stay outside the mirror');
      assert.match(svg, /^<svg [^>]*direction="rtl"/, 'direction rtl kept');
      const inner = svg.slice(at);
      const icons = [...inner.matchAll(/<g transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)(?: ([-\d.]+))?\)" fill="none"/g)];
      // Coordinator fix: a page that draws no icons in LTR (consulting page 1) has none to flip; RTL must keep every LTR icon.
      const L = render(id, mode, false); const ltr = name === 'infographic' ? L.info : L.p1;
      assert.equal(icons.length, (ltr.match(/scale\([-\d.]+\)" fill="none"/g) || []).length, 'every LTR icon is kept');
      for (const i of icons) assert.ok(Number(i[3]) < 0 && Number(i[4]) > 0, `icon flipped back: ${i[0]}`);
      const texts = [...inner.matchAll(/<text ([^>]*)>/g)];
      assert.ok(texts.length > 0, 'has texts');
      for (const x of texts) assert.match(x[1], /^transform="translate\([-\d.]+ 0\) scale\(-1 1\)"/, `text flipped back: ${x[1].slice(0, 60)}`);
    });
  }
  test(`D2: ${id} ${mode} LTR infographic, page 1 and page 2 are byte-identical to the base`, () => {
    const L = render(id, mode, false); const s = snap[`${id}|${mode}|ltr`];
    assert.equal(h(L.info), s.info); assert.equal(h(L.p1), s.p1); assert.equal(h(L.p2), s.p2); assert.deepEqual(L.rest.map(h), s.rest);
  });
  test(`D3: ${id} ${mode} RTL page 2 and later are byte-identical to the base`, () => {
    const s = snap[`${id}|${mode}|rtl`];
    assert.equal(h(R.p2), s.p2); assert.deepEqual(R.rest.map(h), s.rest);
  });
}

test('D4: must-keep, the old midnight style is byte-identical, LTR and RTL', () => {
  for (const mode of MODES) for (const rtl of [false, true]) {
    const R = render('midnight', mode, rtl); const s = snap[`midnight|${mode}|${rtl ? 'rtl' : 'ltr'}`];
    assert.equal(h(R.info), s.info); assert.equal(h(R.p1), s.p1); assert.equal(h(R.p2), s.p2); assert.deepEqual(R.rest.map(h), s.rest);
  }
});
