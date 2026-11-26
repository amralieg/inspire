// RC6-B-11 (T-DOC-07): Arabic brief and deck. Right to left fits every page, every label is translated (no renderer prints its own English),
// and the icon sits on the logical start side, clear of the title. The Arabic is a stand-in translator (rc6bDocGeometry.fakeTranslated).
import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { resolveTheme } from '../src/lib/docgen/docStyles.js';
import { DESIGNS } from '../src/lib/docgen/designs/model.js';
import { briefPagesSvg, infographicSvg } from '../src/lib/docgen/docSvg.js';
import { buildPptx } from '../src/lib/docgen/pptxDoc.js';
import { DESIGN_IDS, MODES, arabicModel, layout, overlap, englishLeft } from './rc6bDocGeometry.mjs';

const W = 794; const H = 1123;

for (const id of DESIGN_IDS) for (const mode of MODES) {
  const th = resolveTheme(id, 'databricks', '', mode);
  test(`RC6-B-11 ${id}/${mode}: every Arabic brief text box lies inside the page`, () => {
    const pages = briefPagesSvg(arabicModel(), th);
    assert.ok(pages.length >= 3);
    pages.forEach((p, n) => {
      const bad = layout(p).texts.filter((t) => t.x0 < -0.5 || t.x1 > W + 0.5 || t.y0 < 0 || t.y1 > H).map((t) => `${t.x0.toFixed(0)}-${t.x1.toFixed(0)} ${t.text.slice(0, 24)}`);
      assert.deepEqual(bad, [], `page ${n + 1}`);
    });
    const info = layout(infographicSvg(arabicModel(), th)).texts.filter((t) => t.x0 < -0.5 || t.x1 > W + 0.5).map((t) => t.text.slice(0, 24));
    assert.deepEqual(info, [], 'infographic');
  });

  test(`RC6-B-11 ${id}/${mode}: no label of the English set is printed on any Arabic brief or infographic page`, () => {
    const m = arabicModel();
    const all = [...briefPagesSvg(m, th), infographicSvg(m, th)].flatMap((p) => layout(p).texts.map((t) => t.text));
    assert.deepEqual([...new Set(englishLeft(all))], []);
  });

  test(`RC6-B-11 ${id}/${mode}: the icon box does not meet the title box on the use case pages`, () => {
    briefPagesSvg(arabicModel(), th).slice(1).forEach((p, n) => {
      const { texts, icons } = layout(p); const title = texts.filter((t) => t.y0 < 260).sort((a, b) => b.size - a.size)[0];
      const box = { x0: Math.min(...texts.filter((t) => t.size === title.size && t.y0 < 260).map((t) => t.x0)), x1: Math.max(...texts.filter((t) => t.size === title.size && t.y0 < 260).map((t) => t.x1)), y0: title.y0, y1: Math.max(...texts.filter((t) => t.size === title.size && t.y0 < 260).map((t) => t.y1)) };
      icons.filter((i) => i.y0 < 200).forEach((i) => assert.equal(overlap(i, box), false, `page ${n + 2} icon ${i.x0.toFixed(0)}-${i.x1.toFixed(0)} meets the title ${box.x0.toFixed(0)}-${box.x1.toFixed(0)}`));
    });
  });

  test(`RC6-B-11 ${id}/${mode}: the Arabic deck prints no English label in a slide or a chart`, async () => {
    const theme = { ...resolveTheme('executive', 'databricks', '', mode), design: id, tokens: DESIGNS[id].themes[mode], fonts: DESIGNS[id].fonts };
    const zip = await JSZip.loadAsync(await buildPptx(arabicModel(), theme));
    const parts = Object.keys(zip.files).filter((f) => /^ppt\/(slides\/slide|charts\/chart)\d+\.xml$/.test(f));
    const strings = [];
    for (const f of parts) { const xml = await zip.file(f).async('string'); for (const x of xml.matchAll(/<(?:a:t|c:v)>([^<]*)<\/(?:a:t|c:v)>/g)) strings.push(x[1].replace(/&amp;/g, '&')); }
    assert.ok(strings.length > 20);
    assert.deepEqual([...new Set(englishLeft(strings))], []);
  });
}

test('RC6-B-11 the classic styles print their labels through the translation too', async () => {
  const th = resolveTheme('executive', 'databricks', '', 'light');
  const all = briefPagesSvg(arabicModel(), th).flatMap((p) => layout(p).texts.map((t) => t.text));
  assert.deepEqual([...new Set(englishLeft(all))], []);
  const zip = await JSZip.loadAsync(await buildPptx(arabicModel(), th));
  const strings = [];
  for (const f of Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) for (const x of (await zip.file(f).async('string')).matchAll(/<a:t>([^<]*)<\/a:t>/g)) strings.push(x[1]);
  assert.deepEqual([...new Set(englishLeft(strings))], []);
});
