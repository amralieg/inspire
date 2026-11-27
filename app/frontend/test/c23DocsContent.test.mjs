// C23 (Amr 26 Nov): the generated documents carry every use case detail the agent documents had (problem, solution, sponsor, beneficiary,
// KPIs, technical design, data used, ...) in full, and a document with no calculated value has no empty block and no overlapping text.
import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { buildDocModel } from '../src/lib/docgen/docModel.js';
import { defaultDocOptions, EXCEL_COLUMNS } from '../src/lib/docgen/docOptions.js';
import { resolveTheme } from '../src/lib/docgen/docStyles.js';
import { DESIGNS } from '../src/lib/docgen/designs/model.js';
import { briefPagesSvg, infographicSvg } from '../src/lib/docgen/docSvg.js';
import { buildPptx } from '../src/lib/docgen/pptxDoc.js';
import { buildXlsx } from '../src/lib/docgen/xlsxDoc.js';
import { layout } from './rc6bDocGeometry.mjs';

const ALL_BLOCKS = ['use_case_story', 'value_story', 'value_projection', 'inspire_score', 'data_used', 'disclaimer'];
const STATEMENT = 'Bakery managers cannot see which pastries sell out before noon, so they bake the wrong quantities each morning and throw away unsold stock while regulars leave empty handed. The shortfall is worst on weekends and on school holidays when the footfall pattern changes and the usual weekly average misleads the planning team badly.';
const FIX = {
  No: 'UC-C23-1', Name: 'Morning Bake Planner', Statement: STATEMENT,
  Solution: 'Forecast hourly demand per product and per shop from sales history, weather and local events, then suggest the bake plan each evening.',
  'Business Value': 'Cuts daily waste of unsold stock and lifts sales of the items that used to run out early.',
  Sponsor: 'Chief Operating Officer', Beneficiary: 'Shop managers and bakery production leads',
  'Analytics Technique': 'Time series forecasting',
  type: 'Risk',
  'Business Priority Alignment': 'Operational excellence',
  'Strategic Goals Alignment': 'Reduce food waste by thirty percent',
  'Tables Involved': 'bakehouse.sales.transactions, bakehouse.ops.stores',
  'High Level Design': 'A daily batch job reads the sales table and writes a demand forecast table that a dashboard shows each evening.',
  KPIs: [{ name: 'Waste rate', unit: '%', direction: 'down' }, { name: 'Sell out hours lost', unit: 'hours', direction: 'down' }],
  'Expected Key Results': [{ statement: 'Cut unsold stock by twenty percent within two quarters' }, { statement: 'Remove early sell outs on weekends' }],
  'Measures of Success': ['Weekly waste report signed off by finance', 'Store manager survey above eight'],
  'Financial Benefits': ['Lower ingredient purchasing cost'], 'Non-Financial Benefits': ['Happier regular customers'],
  domain: 'Operations', 'Inspire Score': 8.2,
};
const FULL = [
  STATEMENT, FIX.Solution, FIX['Business Value'], FIX.Sponsor, FIX.Beneficiary, FIX['Analytics Technique'], FIX['Business Priority Alignment'], FIX['Strategic Goals Alignment'],
  'Waste rate', 'Sell out hours lost', 'Cut unsold stock by twenty percent within two quarters', 'Remove early sell outs on weekends',
  'Weekly waste report signed off by finance', 'Store manager survey above eight', 'Lower ingredient purchasing cost', 'Happier regular customers',
];
const VALUE = { amount: 120000, currency: 'USD', status: 'calculated', verb: 'CUT COST', story: 'It pays back in the first year.', yearly: [1, 2, 3].map((year) => ({ year, low: 1000 * year, likely: 2000 * year, high: 3000 * year })), factors: [] };
const model = ({ values = { 'UC-C23-1': VALUE }, ucs = [FIX], businessName = 'Acme Bakes' } = {}) =>
  buildDocModel({ businessName, useCases: ucs, values, options: { ...defaultDocOptions('English'), blocks: ALL_BLOCKS } });

const un = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const svgText = (svg) => norm([...svg.matchAll(/<tspan\b[^>]*>(.*?)<\/tspan>/gs)].map((m) => un(m[1])).join(' '));
const missing = (hay) => FULL.filter((v) => !norm(hay).includes(norm(v)));
const themeOf = (id, mode = 'light') => ({ ...resolveTheme('executive', 'databricks', '', mode), design: id, tokens: DESIGNS[id].themes[mode], fonts: DESIGNS[id].fonts });
const slideText = async (bytes) => {
  const zip = await JSZip.loadAsync(bytes); let out = '';
  for (const f of Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) out += ` ${[...(await zip.file(f).async('string')).matchAll(/<a:t>(.*?)<\/a:t>/gs)].map((m) => un(m[1])).join(' ')}`;
  return out;
};

test('C23 the doc model carries every use case field', () => {
  const u = model().useCases[0];
  assert.equal(u.statement, STATEMENT);
  assert.equal(u.priorityAlignment, 'Operational excellence');
  assert.equal(u.strategicAlignment, FIX['Strategic Goals Alignment']);
  assert.equal(u.type, 'Risk');
  assert.equal(u.kpis.length, 2);
  assert.ok(u.kpis[0].includes('Waste rate'));
  assert.deepEqual(u.keyResults, ['Cut unsold stock by twenty percent within two quarters', 'Remove early sell outs on weekends']);
  assert.deepEqual(u.measures, FIX['Measures of Success']);
  assert.deepEqual(u.financial, FIX['Financial Benefits']);
  assert.deepEqual(u.nonFinancial, FIX['Non-Financial Benefits']);
});

for (const withValue of [true, false]) {
  const m = () => model({ values: withValue ? { 'UC-C23-1': VALUE } : {} });
  const tag = withValue ? 'valued' : 'no value';

  test(`C23 classic brief page (${tag}) prints every field in full`, () => {
    const pages = briefPagesSvg(m(), resolveTheme('executive', 'databricks', '', 'light'));
    assert.deepEqual(missing(pages.map(svgText).join(' ')), []);
  });

  for (const id of Object.keys(DESIGNS)) for (const mode of ['light', 'dark']) {
    test(`C23 ${id}/${mode} brief page (${tag}) prints every field in full`, () => {
      const pages = briefPagesSvg(m(), themeOf(id, mode));
      assert.deepEqual(missing(pages.map(svgText).join(' ')), []);
    });
  }

  test(`C23 classic PowerPoint (${tag}) prints every field in full`, async () => {
    assert.deepEqual(missing(await slideText(await buildPptx(m(), resolveTheme('executive', 'databricks', '', 'light')))), []);
  });
  for (const id of Object.keys(DESIGNS)) {
    test(`C23 ${id} PowerPoint (${tag}) prints every field in full`, async () => {
      assert.deepEqual(missing(await slideText(await buildPptx(m(), themeOf(id)))), []);
    });
  }

  test(`C23 Excel (${tag}) has a column for every field`, async () => {
    const ids = EXCEL_COLUMNS.map((c) => c.id);
    const bytes = new Uint8Array(await (await buildXlsx(m(), ids)).arrayBuffer());
    const zip = await JSZip.loadAsync(bytes);
    const cells = un([...(await zip.file('xl/sharedStrings.xml').async('string')).matchAll(/<t[^>]*>(.*?)<\/t>/gs)].map((x) => x[1]).join(' '));
    assert.deepEqual(missing(cells), []);
  });
}

test('C23 no calculated value: no empty projection block, the subtitle is clear of the tiles, name and value are apart', () => {
  const long = 'Harvest Group of Bakeries';
  const ucs = [FIX, { ...FIX, No: 'UC-C23-2', Name: 'Exposure to supplier price swings across every region' }];
  const svg = infographicSvg(model({ values: {}, ucs, businessName: long }), resolveTheme('executive', 'databricks', '', 'light'));
  assert.doesNotMatch(svg, /Three-year projection/);
  const { texts } = layout(svg);
  const sub = texts.find((t) => /use cases \| \d+ with a calculated value/.test(t.text));
  assert.ok(sub, 'subtitle present');
  for (const r of svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"[^>]*stroke=/g)) {
    const [y0, y1] = [Number(r[2]), Number(r[2]) + Number(r[4])];
    if (Number(r[4]) < 120 && Number(r[3]) < 600) assert.ok(y0 >= sub.y1 || y1 <= sub.y0, `a tile (y ${y0}-${y1}) covers the subtitle (y ${sub.y0}-${sub.y1})`);
  }
  // Each use case name ends before its "not calculated yet" starts (0.6 em per character is the conservative width).
  for (const nm of ['Morning Bake Planner', 'Exposure to supplier price swings across every region']) {
    const el = [...svg.matchAll(/<text\b[^>]*>(.*?)<\/text>/gs)].find((t) => un(t[0]).includes(nm.slice(0, 12)) && /font-size="13"/.test(t[0]));
    assert.ok(el, `row ${nm}`);
    const x = Number(/<tspan x="([\d.]+)"/.exec(el[0])[1]);
    const shown = [...el[0].matchAll(/<tspan\b[^>]*>(.*?)<\/tspan>/gs)].map((t) => un(t[1])).reduce((a, b) => (b.length > a.length ? b : a), '');
    const notYet = [...svg.matchAll(/<text x="([\d.]+)"[^>]*>(?:<tspan[^>]*>)?not calculated yet/g)].map((t) => Number(t[1]));
    const near = notYet.filter((nx) => nx > x);
    assert.ok(near.length > 0 && near.every((nx) => x + shown.length * 13 * 0.6 <= nx), `name "${shown}" runs into the not calculated text`);
  }
});
