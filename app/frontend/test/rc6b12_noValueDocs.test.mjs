// RC6-B-12 (T-DOC-03): a document with no calculated value draws no empty projection block, no text meets another, and the deck charts what the data supports.
import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { resolveTheme } from '../src/lib/docgen/docStyles.js';
import { DESIGNS } from '../src/lib/docgen/designs/model.js';
import { infographicSvg } from '../src/lib/docgen/docSvg.js';
import { buildPptx } from '../src/lib/docgen/pptxDoc.js';
import { DESIGN_IDS, MODES, ALL_BLOCKS, noValueModel, layout, overlap } from './rc6bDocGeometry.mjs';

const LONG = 'Harvest Group of Bakeries and Pastry Kitchens across the Northern Region and Beyond';
const themeOf = (id, mode) => ({ ...resolveTheme('executive', 'databricks', '', mode), design: id, tokens: DESIGNS[id].themes[mode], fonts: DESIGNS[id].fonts });
const partsOf = async (bytes) => { const zip = await JSZip.loadAsync(bytes); return { zip, charts: Object.keys(zip.files).filter((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f)) }; };
const slideTexts = async (zip) => { const out = []; for (const f of Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) for (const x of (await zip.file(f).async('string')).matchAll(/<a:t>([^<]*)<\/a:t>/g)) out.push(x[1]); return out; };

for (const id of DESIGN_IDS) for (const mode of MODES) for (const name of ['Acme Bakes', LONG]) {
  test(`RC6-B-12 ${id}/${mode} "${name.slice(0, 12)}": no empty projection block and no text meets another in the no-value infographic`, () => {
    const svg = infographicSvg(noValueModel({ businessName: name }), resolveTheme(id, 'databricks', '', mode));
    assert.doesNotMatch(svg, /Three-year projection/, 'no projection block title');
    assert.doesNotMatch(svg, /Projection not calculated yet/, 'no empty projection text');
    const { texts } = layout(svg);
    const title = [...texts].sort((a, b) => b.size - a.size)[0];
    const titleLines = texts.filter((t) => t.size === title.size && t.y0 < 200);
    const sub = texts.find((t) => /use cases \| \d+ with a calculated value/.test(t.text));
    assert.ok(sub, 'the sub-title is there');
    for (const l of titleLines) assert.equal(overlap(l, sub), false, `title line "${l.text.slice(0, 20)}" meets the sub-title`);
    texts.forEach((a, i) => texts.slice(i + 1).forEach((b) => { if (a.size >= 15 && b.size >= 15 && !(titleLines.includes(a) && titleLines.includes(b))) assert.equal(overlap(a, b), false, `"${a.text.slice(0, 20)}" meets "${b.text.slice(0, 20)}"`); }));
  });
}

for (const id of DESIGN_IDS) {
  test(`RC6-B-12 ${id}: the deck of a document with scores but no value carries a chart`, async () => {
    const { charts } = await partsOf(await buildPptx(noValueModel(), themeOf(id, 'light')));
    assert.ok(charts.length >= 1, 'a native chart');
  });
  test(`RC6-B-12 ${id}: the deck with nothing numeric to chart says how to get a chart`, async () => {
    const m = noValueModel({ blocks: ALL_BLOCKS.filter((b) => b !== 'inspire_score') });
    const { zip, charts } = await partsOf(await buildPptx(m, themeOf(id, 'light')));
    assert.equal(charts.length, 0);
    assert.ok((await slideTexts(zip)).some((t) => /Calculate value to add the projection/i.test(t)));
  });
}

test('RC6-B-12 the classic deck of a document with scores but no value carries a chart', async () => {
  const { charts } = await partsOf(await buildPptx(noValueModel(), resolveTheme('executive', 'databricks', '', 'light')));
  assert.ok(charts.length >= 1);
});
