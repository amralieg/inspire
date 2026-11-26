// RC7-B-08 (T-DOC-03): the four designs look different (fonts, layout), the infographic carries real graphics built from the use case data
// (also when no value is calculated yet), long text wraps and never ends in "...", and the deck has a sensible slide count with native charts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from 'jszip';
import { buildDocModel } from '../src/lib/docgen/docModel.js';
import { defaultDocOptions } from '../src/lib/docgen/docOptions.js';
import { resolveTheme } from '../src/lib/docgen/docStyles.js';
import { DESIGNS } from '../src/lib/docgen/designs/model.js';
import { infographicSvg } from '../src/lib/docgen/docSvg.js';
import { buildPptx } from '../src/lib/docgen/pptxDoc.js';

const FIXTURE = new URL('../../agent/demos/bakehouse/docs/Samples bakehouse-dbx_inspire.json', import.meta.url);
const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const WORDS = Array.from({ length: 85 }, (_, i) => `wd${String(i + 1).padStart(3, '0')}`);
const LONG = WORDS.join(' '); // 85 words, 595 characters
const UCS = raw.domains.flatMap((d) => d.use_cases.map((u) => ({ ...u, domain: d.domain_name }))).slice(0, 2).map((u, i) => (i === 0 ? { ...u, Statement: LONG } : u));
const IDS = ['original', 'editorial_ink', 'bold', 'consulting'];
const YEARLY = [1, 2, 3].map((year) => ({ year, low: 1000 * year, likely: 2000 * year, high: 3000 * year }));
const VALUES = Object.fromEntries(UCS.map((u, i) => [u.No, { amount: 90000 + i * 40000, currency: 'USD', status: 'estimated', verb: 'GROW REVENUE', story: 'It pays back.', yearly: i ? [] : YEARLY, factors: [] }]));
const options = { ...defaultDocOptions('English'), blocks: ['use_case_story', 'value_story', 'value_projection', 'data_used', 'inspire_score', 'disclaimer'] };
const docOf = (valued) => buildDocModel({ businessName: 'Acme Bakes', useCases: UCS, values: valued ? VALUES : {}, options });
const themeOf = (id, mode = 'light') => resolveTheme(id, 'databricks', '', mode);
const decode = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const fontsOf = (svg) => new Set([...svg.matchAll(/font-family="([^"]*)"/g)].map((x) => decode(x[1])));
const textOf = (svg) => decode([...svg.matchAll(/<text\b[^>]*>(.*?)<\/text>/gs)].map((x) => [...x[1].matchAll(/<tspan[^>]*>(.*?)<\/tspan>/gs)].map((s) => s[1]).join(' ') || x[1]).join(' \n '));
const iconBodies = (svg) => new Set([...svg.matchAll(/<g transform="translate\([-\d.]+ [-\d.]+\) scale\([-\d.]+\)" fill="none"[^>]*>(.*?)<\/g>/gs)].map((x) => x[1]));
const slideCount = (zip) => Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).length;

for (const valued of [false, true]) {
  const tag = valued ? 'with values' : 'no value calculated';
  test(`B1 ${tag}: each design draws in its own font family and the four fonts differ`, () => {
    const seen = new Map();
    for (const id of IDS) {
      const svg = infographicSvg(docOf(valued), themeOf(id));
      const fonts = fontsOf(svg);
      assert.ok(fonts.has(DESIGNS[id].fonts.body), `${id}: body font is used`);
      seen.set(id, [...fonts].sort().join('|'));
    }
    assert.equal(new Set(seen.values()).size, 4, `font sets differ per design: ${[...seen.values()].join(' // ')}`);
    // The serif display fonts of original and editorial_ink are set on the headings, not only the body font on the root.
    for (const id of ['original', 'editorial_ink']) assert.ok(fontsOf(infographicSvg(docOf(valued), themeOf(id))).has(DESIGNS[id].fonts.display), `${id}: display font is used`);
  });

  test(`B2 ${tag}: the infographic has at least 3 real graphics in every design and mode`, () => {
    for (const id of IDS) for (const mode of ['light', 'dark']) {
      const svg = infographicSvg(docOf(valued), themeOf(id, mode));
      const icons = iconBodies(svg).size;
      const donut = /<path d="M[^"]*A[\d.]+ [\d.]+ 0 [01] 1[^"]*Z"/.test(svg) ? 1 : 0;
      const dots = (svg.match(/<circle /g) || []).length >= 4 ? 1 : 0;
      const widths = new Set([...svg.matchAll(/<rect [^>]*?width="([\d.]+)"/g)].map((x) => x[1]));
      const bars = widths.size >= 6 ? 1 : 0; // bars or tiles of different lengths
      assert.ok(icons + donut + dots + bars >= 3, `${id}/${mode}: ${icons} icons + ${donut} donut + ${dots} dots + ${bars} bars`);
      if (!valued) assert.ok(/<rect [^>]*data-bar=/.test(svg) && donut === 1 && icons >= 2, `${id}/${mode}: a bar chart, a donut and 2 icons built from the use cases`);
    }
  });
}

test('B3: with no value calculated the bar widths follow the Inspire scores of the use cases', () => {
  for (const id of IDS) {
    const doc = docOf(false);
    const svg = infographicSvg(doc, themeOf(id));
    const bars = [...svg.matchAll(/<rect [^>]*?width="([\d.]+)"[^>]*?data-bar="([^"]*)"/g)].map((x) => ({ w: Number(x[1]), score: Number(x[2]) }));
    assert.equal(bars.length, doc.useCases.length, `${id}: one bar per scored use case`);
    for (const b of bars) assert.ok(b.score > 0 && b.w > 0);
    const [a, b] = bars;
    assert.ok(Math.abs(a.w / b.w - a.score / b.score) < 0.02, `${id}: width ratio ${a.w / b.w} follows score ratio ${a.score / b.score}`);
  }
});

test('B4: a 600-character description wraps in full in every design and no text ends in "..."', () => {
  for (const id of IDS) {
    const text = textOf(infographicSvg(docOf(false), themeOf(id))).replace(/\s+/g, ' ');
    assert.ok(text.includes(WORDS.join(' ')), `${id}: all 85 words of the description appear in order`);
    assert.ok(!/\.\.\.|…/.test(text), `${id}: no ellipsis in the infographic text`);
  }
});

test('B5: the four designs differ in layout, not only in colour', () => {
  const shape = (id) => infographicSvg(docOf(false), themeOf(id)).replace(/#[0-9A-Fa-f]{6}/g, '#').replace(/font-family="[^"]*"/g, '').replace(/>[^<]*</g, '><').replace(/\d+(\.\d+)?/g, 'n');
  const shapes = IDS.map(shape);
  assert.equal(new Set(shapes).size, 4, 'four different drawings once colours, fonts, text and numbers are removed');
});

for (const valued of [false, true]) for (const id of IDS) for (const mode of ['light', 'dark']) {
  test(`B6 deck ${id}/${mode} ${valued ? 'with values' : 'no value'}: at most 10 slides for 2 use cases, a native chart on every use case slide, no "..."`, async () => {
    const zip = await JSZip.loadAsync(await buildPptx(docOf(valued), themeOf(id, mode)));
    const n = slideCount(zip);
    assert.ok(n <= 10, `${n} slides for 2 use cases`);
    const charts = Object.keys(zip.files).filter((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f)).length;
    assert.ok(charts >= 3, `${charts} native charts (one per use case slide and the portfolio)`);
    let withChart = 0;
    for (let i = 1; i <= n; i += 1) {
      const xml = await zip.file(`ppt/slides/slide${i}.xml`).async('string');
      const rel = await zip.file(`ppt/slides/_rels/slide${i}.xml.rels`).async('string');
      const t = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((x) => x[1]).join(' ');
      assert.ok(!/\.\.\.|…/.test(t), `slide ${i} has no ellipsis`);
      if (WORDS[0] && t.includes(WORDS[0])) assert.ok(/charts\/chart/.test(rel), `use case slide ${i} (the long description) has a chart`);
      if (/charts\/chart/.test(rel)) withChart += 1;
    }
    assert.ok(withChart >= 3, `${withChart} slides carry a chart`);
    for (const f of Object.keys(zip.files).filter((x) => /^ppt\/charts\/chart\d+\.xml$/.test(x))) assert.ok(!/\.\.\.|…/.test(await zip.file(f).async('string')), `${f} has no ellipsis in its labels`);
  });
}
