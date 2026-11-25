// FX-113 (REQ-503): the in-App document library (approved wireframe req503 v2, runtime A: JS in the App). Pure functions, no browser:
// styles and palettes, wizard options and the file plan, the doc model, the SVG infographic and brief pages, PowerPoint, Excel, PDF.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DOC_STYLES, DOC_PALETTES, resolveTheme } from '../../src/lib/docgen/docStyles.js';
import { DOC_KINDS, CONTENT_BLOCKS, EXCEL_COLUMNS, defaultDocOptions, planFiles } from '../../src/lib/docgen/docOptions.js';
import { buildDocModel } from '../../src/lib/docgen/docModel.js';
import { infographicSvg, briefPagesSvg } from '../../src/lib/docgen/docSvg.js';
import { buildPptx } from '../../src/lib/docgen/pptxDoc.js';
import { buildXlsx } from '../../src/lib/docgen/xlsxDoc.js';
import { pdfFromImages } from '../../src/lib/docgen/pdfDoc.js';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');
const readXlsx = require('read-excel-file/node');

const UCS = [
  { No: 'N01-U01', Name: 'Predict delay risk per route', Statement: 'Cut delay payouts with a 48 h risk score', Solution: 'Score each route daily',
    'Business Value': 'Fewer payouts', 'Tables Involved': 'main.ops.flights', Subdomain: 'Operations', inspire_score: '9.1', domain: 'Operations' },
  { No: 'N01-U02', Name: 'R&D <spend> check', Statement: 'Flag overspend early', Solution: 'Compare plan vs actual', 'Business Value': 'Less waste',
    'Tables Involved': 'main.fin.spend', Subdomain: 'Finance', inspire_score: '8.7', domain: 'Finance' },
  { No: 'N02-U01', Name: 'Win back lapsed members', Statement: 'Target members silent for 6 months', Solution: 'Weekly win-back list',
    'Business Value': 'More repeat trips', 'Tables Involved': 'main.crm.members', Subdomain: 'Loyalty', inspire_score: '8.0', domain: 'Customer' },
];
const VALUES = {
  'N01-U01': { amount: 2400000, currency: 'USD', status: 'calculated', story: 'Fewer delay payouts on busy routes',
    yearly: [{ year: 1, low: 1.5e6, likely: 2.4e6, high: 3.0e6 }, { year: 2, low: 2e6, likely: 3e6, high: 3.8e6 }, { year: 3, low: 2.2e6, likely: 3.4e6, high: 4.4e6 }],
    factors: [{ name: 'Delay payouts', share: 0.62 }, { name: 'Seat fill', share: 0.31 }, { name: 'Market demand', share: 0.07 }] },
  'N01-U02': { amount: 1100000, currency: 'USD', status: 'estimated', story: 'Less spend above plan', yearly: [], factors: [] },
};
const model = (over = {}) => buildDocModel({ businessName: 'Acme Air', useCases: UCS, values: VALUES, options: { ...defaultDocOptions('English'), ...over } });
const theme = resolveTheme('midnight', 'databricks');

test('styles: 8 named styles, at least 4 palettes, a custom brand colour leads the accents, a bad hex is ignored', () => {
  assert.equal(DOC_STYLES.length, 12); // REQ-526: 4 designs were added in front of the 8 named styles
  assert.equal(new Set(DOC_STYLES.map((s) => s.id)).size, 12);
  assert.ok(DOC_STYLES.every((s) => s.label && s.bg && s.ink));
  assert.ok(DOC_PALETTES.length >= 4);
  for (const s of DOC_STYLES) for (const p of DOC_PALETTES) {
    const t = resolveTheme(s.id, p.id);
    assert.match(t.bg, /^#[0-9a-f]{6}$/i); assert.match(t.ink, /^#[0-9a-f]{6}$/i);
    assert.ok(t.accents.length >= 3 && t.accents.every((a) => /^#[0-9a-f]{6}$/i.test(a)));
  }
  assert.equal(resolveTheme('midnight', 'databricks', '#123ABC').accents[0].toLowerCase(), '#123abc');
  assert.deepEqual(resolveTheme('midnight', 'databricks', 'red;}').accents, resolveTheme('midnight', 'databricks').accents);
});

test('options: the 4 kinds, the content blocks and Excel columns from the wireframe, sensible defaults', () => {
  assert.deepEqual(DOC_KINDS, ['infographic', 'pptx', 'pdf', 'xlsx']);
  const blocks = CONTENT_BLOCKS.map((b) => b.id);
  for (const id of ['use_case_story', 'value_story', 'value_projection', 'value_formula', 'inspire_score', 'strategy_link', 'data_used',
    'genie_questions', 'build_status', 'next_steps', 'sql', 'disclaimer']) assert.ok(blocks.includes(id), id);
  const cols = EXCEL_COLUMNS.map((c) => c.id);
  for (const id of ['name', 'inspire_score', 'value', 'value_status', 'domain', 'statement', 'use_case_story', 'value_story', 'projection', 'tables']) assert.ok(cols.includes(id), id);
  const d = defaultDocOptions('Arabic');
  assert.deepEqual(d.kinds, DOC_KINDS);
  assert.equal(d.layout, 'one');
  assert.deepEqual(d.languages, ['Arabic']);
  for (const id of ['use_case_story', 'value_story', 'value_projection', 'disclaimer']) assert.ok(d.blocks.includes(id), id);
  assert.ok(!d.blocks.includes('sql'));
  assert.deepEqual(d.columns.slice(0, 3), ['name', 'inspire_score', 'value']);
});

test('planFiles: one file for all vs one per use case, one set per language, safe unique names', () => {
  const one = planFiles({ ...defaultDocOptions('English'), businessName: 'Acme Air' }, UCS);
  assert.deepEqual(one.map((f) => f.ext), ['pdf', 'pptx', 'pdf', 'xlsx']);
  assert.ok(one.every((f) => f.useCaseIds.length === 3 && f.language === 'English'));
  const each = planFiles({ ...defaultDocOptions('English'), layout: 'each', businessName: 'Acme Air' }, UCS);
  assert.equal(each.filter((f) => f.kind === 'pptx').length, 3);
  assert.equal(each.filter((f) => f.kind === 'pdf').length, 3);
  assert.ok(each.filter((f) => f.kind === 'pptx').every((f) => f.useCaseIds.length === 1));
  assert.equal(each.filter((f) => f.kind === 'infographic').length, 1, 'the infographic is always one PDF of all selected');
  const two = planFiles({ ...defaultDocOptions('English'), languages: ['English', 'Arabic'], businessName: 'Acme / Air <x>' }, UCS);
  assert.equal(two.length, 8);
  const names = two.map((f) => f.name);
  assert.equal(new Set(names).size, names.length, 'names are unique');
  assert.ok(names.every((n, i) => /^[A-Za-z0-9._-]+$/.test(n) && n.endsWith(`.${two[i].ext}`)), names.join(' '));
  assert.deepEqual(planFiles({ ...defaultDocOptions('English'), kinds: [] }, UCS), []);
});

test('buildDocModel: selected order, numeric scores, values and a same-currency total, a use case with no value is null', () => {
  const m = model();
  assert.equal(m.businessName, 'Acme Air');
  assert.deepEqual(m.useCases.map((u) => u.id), ['N01-U01', 'N01-U02', 'N02-U01']);
  assert.equal(m.useCases[0].name, 'Predict delay risk per route');
  assert.equal(m.useCases[0].score, 9.1);
  assert.equal(m.useCases[0].value.amount, 2400000);
  assert.equal(m.useCases[2].value, null);
  assert.equal(m.total.amount, 3500000);
  assert.equal(m.total.currency, 'USD');
  assert.equal(m.total.nWithValue, 2);
  assert.equal(m.total.n, 3);
});

test('infographicSvg: one SVG of all selected, escaped names, theme colours, blocks on and off, "not calculated yet"', () => {
  const svg = infographicSvg(model(), theme);
  assert.match(svg, /^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.equal((svg.match(/<svg/g) || []).length, (svg.match(/<\/svg>/g) || []).length);
  assert.ok(svg.includes('Predict delay risk per route') && svg.includes('Win back lapsed members'));
  assert.ok(svg.includes('R&amp;D &lt;spend&gt; check') && !svg.includes('R&D <spend>'), 'names are XML-escaped');
  assert.ok(svg.toLowerCase().includes(theme.bg.toLowerCase()), 'uses the theme background');
  assert.match(svg, /not calculated yet/i);
  assert.match(svg, /\$3\.5M/);
  assert.match(svg, /data-block="value_projection"/);
  assert.match(svg, /data-block="value_story"/);
  const off = infographicSvg(model({ blocks: ['use_case_story'] }), theme);
  assert.doesNotMatch(off, /data-block="value_projection"/);
  assert.doesNotMatch(off, /data-block="value_story"/);
  const other = infographicSvg(model(), resolveTheme('organic', 'ocean'));
  assert.notEqual(other, svg, 'another style draws differently');
});

test('briefPagesSvg: a cover page plus one page per use case', () => {
  const pages = briefPagesSvg(model(), theme);
  assert.equal(pages.length, 4);
  assert.ok(pages.every((p) => p.startsWith('<svg')));
  assert.ok(pages[1].includes('Predict delay risk per route'));
});

test('buildPptx: a real deck with a cover, a summary, a slide per use case, every name present; projection off removes it', async () => {
  const bytes = await buildPptx(model(), theme);
  const zip = await JSZip.loadAsync(bytes);
  const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
  assert.ok(slides.length >= 5, `cover + summary + 3 use cases, got ${slides.length}`);
  const xml = (await Promise.all(slides.map((f) => zip.file(f).async('string')))).join('\n');
  for (const u of UCS) assert.ok(xml.includes(u.Name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')), u.Name);
  assert.match(xml, /projection/i);
  const offZip = await JSZip.loadAsync(await buildPptx(model({ blocks: ['use_case_story'] }), theme));
  const offXml = (await Promise.all(Object.keys(offZip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).map((f) => offZip.file(f).async('string')))).join('\n');
  assert.doesNotMatch(offXml, /projection/i);
});

test('buildXlsx: the chosen columns in the chosen order, one row per use case, value is a number', async () => {
  const out = await buildXlsx(model(), ['name', 'value', 'inspire_score']);
  const buf = Buffer.from(out instanceof Uint8Array ? out : new Uint8Array(await out.arrayBuffer()));
  const rows = (await readXlsx(buf))[0].data;
  const labels = ['name', 'value', 'inspire_score'].map((id) => EXCEL_COLUMNS.find((c) => c.id === id).label);
  assert.deepEqual(rows[0], labels);
  assert.equal(rows.length, 4);
  assert.equal(rows[1][0], 'Predict delay risk per route');
  assert.equal(typeof rows[1][1], 'number');
  assert.equal(rows[1][2], 9.1);
});

test('pdfFromImages: one PDF page per image', async () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const bytes = await pdfFromImages([{ dataUrl: PNG, width: 800, height: 1200 }, { dataUrl: PNG, width: 800, height: 1200 }]);
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(text.startsWith('%PDF'));
  assert.equal((text.match(/\/Type\s*\/Page[^s]/g) || []).length, 2);
});
