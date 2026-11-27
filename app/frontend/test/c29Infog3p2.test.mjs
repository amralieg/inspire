// C29 phase 2 (REQ-571, REQ-574): the 12 approved infographic concepts are the per use case infographic. The AI picks the concept whose
// shape matches the story and fills its fields; with no model a local picker uses the "when it fits" rules. Every concept draws in both
// orientations (re-flowed), with icons, a process diagram, text of at least 20 px, no overlapping text, the use case's own title and value.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { ROWS, flat } from './c27x_fixture.mjs';
import { checkSvg } from './tools/infogCheck.mjs';
import { SCENARIO_IDS as SHARED_IDS, SCENARIOS, validatePick, buildMessages } from '../../backend/lib/infographicPick.mjs';
import { SCENARIO_IDS, infographicFor } from '../src/lib/docgen/designs/infographic.js';
import { fallbackPick, pickInfographic } from '../src/lib/docgen/designs/infographicPick.js';
import * as API from '../src/lib/docgen/infographicApi.js';
import * as G from '../src/lib/generateDocs.js';
import { defaultDocOptions } from '../src/lib/docgen/docOptions.js';
import { resolveTheme } from '../src/lib/docgen/docStyles.js';
import { plainBusiness } from '../src/lib/docgen/docText.js';
import { displayId } from '../../shared/useCaseId.mjs';

const IDS = ['journey', 'cycle', 'isometric', 'pictogram', 'beforeafter', 'timeline', 'funnel', 'hub', 'map', 'network', 'waterfall', 'balance'];
const ORIENTS = ['landscape', 'portrait'];
const byNo = new Map(ROWS.map((r) => [String(r.No), r]));
// The row each concept was approved with in the gallery, plus one row whose story has a different shape (the concept must still re-flow).
const HOME = { journey: 'N09-U01', cycle: 'N06-U04', isometric: 'N04-U02', pictogram: 'N01-U04', beforeafter: 'N02-U02', timeline: 'N03-U01', funnel: 'N01-U01', hub: 'N11-U01', map: 'N10-U01', network: 'N10-U03', waterfall: 'N12-U01', balance: 'N08-U01' };
const OTHER = 'N05-U01';
const heroOf = (row) => ((/At stake:[^$\d]*(\$?\d[\d,.]*\s?[MKB]?)/.exec(String(row['Business Value'])) || [])[1] || '').replace(/[.,]$/, '').trim();
const OLD = /\bN\d+-U\d+\b/;

test('(a) the one shared scenario list is exactly the 12 approved concepts', () => {
  assert.deepEqual(SHARED_IDS, IDS);
  assert.deepEqual(SCENARIO_IDS, IDS, 'the renderer exports the same list');
  for (const s of SCENARIOS) {
    assert.ok(s.name && s.when && s.when.length > 20, `${s.id}: a name and a "when it fits" rule`);
    assert.ok(Array.isArray(s.required) && s.required.length >= 1, `${s.id}: its own required fields`);
  }
});

const RENDERS = [];
for (const id of IDS) for (const no of [HOME[id], OTHER]) for (const orientation of ORIENTS) RENDERS.push({ id, no, orientation, svg: infographicFor(byNo.get(no), { orientation, scenario: id }) });

test('(b) every concept x orientation draws its own concept with 6+ icons, a process element, the title and the hero value', () => {
  assert.equal(RENDERS.length, 48);
  for (const r of RENDERS) {
    const tag = `${r.id}/${r.orientation}/${r.no}`; const row = byNo.get(r.no);
    assert.match(r.svg, /^<svg [^>]*width="1240"/, `${tag}: drawn at 1240 px`);
    assert.match(r.svg, new RegExp(`data-concept="${r.id}"`), `${tag}: concept marker`);
    assert.match(r.svg, new RegExp(`data-orientation="${r.orientation}"`), tag);
    const icons = (r.svg.match(/data-icon=/g) || []).length; assert.ok(icons >= 6, `${tag}: ${icons} icons`);
    assert.ok(/data-process="/.test(r.svg), `${tag}: no process element`);
    const small = [...r.svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1])).filter((v) => v < 20);
    assert.deepEqual(small, [], `${tag}: font sizes under 20`);
    const text = flat(r.svg);
    assert.ok(text.includes(plainBusiness(row.Name).trim()), `${tag}: title "${row.Name}" not in full`);
    const hero = heroOf(row); assert.ok(hero && text.includes(hero), `${tag}: hero value "${hero}"`);
  }
});

test('(b) the two orientations re-flow (different layouts, not one picture scaled)', () => {
  for (const id of IDS) {
    const [l, p] = ORIENTS.map((o) => RENDERS.find((r) => r.id === id && r.no === HOME[id] && r.orientation === o).svg);
    assert.match(l, /height="698"/, `${id}: landscape 16:9`); assert.match(p, /height="1754"/, `${id}: portrait A4`);
    assert.ok(!/transform="scale\(/.test(l.slice(0, 400)) && !/transform="scale\(/.test(p.slice(0, 400)), `${id}: no whole-page scale`);
    const xs = (s) => [...s.matchAll(/<text [^>]*?x="([\d.]+)"/g)].slice(0, 12).map((m) => m[1]).join(',');
    assert.notEqual(xs(l), xs(p), `${id}: same text positions in both orientations`);
  }
});

test('(b) laid out in Chromium: no overlapping, small or off-canvas text in any of the 48 drawings', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const bad = [];
    for (const r of RENDERS) { const p = await checkSvg(page, r.svg); if (p.length) bad.push(`${r.id}/${r.orientation}/${r.no}: ${p.slice(0, 3).join('; ')}`); }
    assert.deepEqual(bad, []);
  } finally { await browser.close(); }
});

test('(c) with no model, the local picker maps different kinds of use case to at least 4 concepts by the "when it fits" rules', () => {
  const six = ['N01-U01', 'N03-U01', 'N09-U01', 'N10-U01', 'N11-U01', 'N12-U01'].map((n) => byNo.get(n));
  assert.equal(new Set(six.map((r) => r.kind_label || r['Analytics Technique'])).size, 6, 'six different kinds');
  const picks = six.map((r) => fallbackPick(r).scenario);
  for (const p of picks) assert.ok(IDS.includes(p), p);
  assert.ok(new Set(picks).size >= 4, `distinct: ${picks}`);
  for (const r of ROWS) assert.ok(validatePick(fallbackPick(r)), `${r.No}: the local pick is itself a valid pick`);
  // Rename the industry words: the same pick (rules read the technique and the shape of the facts, never the industry).
  const swap = (v) => (typeof v === 'string' ? v.replace(/store/gi, 'branch').replace(/buyer/gi, 'member').replace(/warehouse/gi, 'depot').replace(/order/gi, 'request').replace(/invoice/gi, 'claim').replace(/promotion/gi, 'campaign') : v);
  for (const r of ROWS) assert.equal(fallbackPick(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, swap(v)]))).scenario, fallbackPick(r).scenario, `${r.No}: industry words changed the pick`);
  const src = ['src/lib/docgen/designs/infographicPick.js', '../backend/lib/infographicPick.mjs', ...fs.readdirSync('src/lib/docgen/designs/infog').map((f) => `src/lib/docgen/designs/infog/${f}`), 'src/lib/docgen/designs/infographic.js'].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  for (const w of ['W5', 'Store 12', 'S3', 'buyer', 'warehouse', 'invoice', 'freight', 'promotion', 'refund', 'checkout', 'rings are new', 'Orders wait']) assert.ok(!src.includes(w), `row-specific or industry text in the code: "${w}"`);
});

const WELL = {
  journey: { steps: ['Collect the timestamps', 'Measure each wait', 'Show the slow step'], pain: { value: '14 hours', label: 'the longest wait' } },
  cycle: { steps: ['Learn what goes together', 'Pick the next offer', 'Send it', 'Measure the take-up'], hub: { value: '1.8x', label: 'better than the default list' } },
  isometric: { steps: ['Fit the drivers', 'Run the scenarios', 'Show the range'] },
  pictogram: { steps: ['Score each item', 'Rank them', 'Call the top ones'], share: { value: 58, label: 'reached by the first calls' } },
  beforeafter: { steps: ['Match each line', 'Flag the gaps', 'Send the list'], before: ['Checks by hand', 'Gaps found late'], after: ['Every line checked', 'Gaps flagged the same day'] },
  timeline: { steps: ['Learn the history', 'Forecast the range', 'Set the plan'], trend: { value: '+6%', label: 'over the next 4 weeks' } },
  funnel: { steps: ['Score everyone', 'Rank by value', 'Call the top'], stages: [{ value: '1,240', label: 'ready to lapse' }, { value: '200', label: 'called this week' }, { value: '41%', label: 'of the value reached' }] },
  hub: { steps: ['Ask in plain words', 'Read the tables', 'Answer with the source'], center: 'A data agent', spokes: ['Sales tables', 'Stock tables', 'Example questions'] },
  map: { steps: ['Estimate demand', 'Pick the sites', 'Show the map'], places: ['Five new sites', 'One site takes from a neighbour', 'Current locations'] },
  network: { steps: ['Link the accounts', 'Find the groups', 'Review the new ones'], groups: ['11 groups', '74 accounts', '2 new this week'] },
  waterfall: { steps: ['Split the change', 'Show each driver'], bars: [{ label: 'Volume', value: '-$0.21M' }, { label: 'Price', value: '-$0.12M' }, { label: 'Mix', value: '+$0.04M' }], total: { label: 'Total change', value: '-$0.40M' } },
  balance: { steps: ['Match a baseline', 'Measure the lift', 'Decide'], options: [{ label: 'Keep', value: '+$212K' }, { label: 'Stop', value: '-$35K' }] },
};
const pickOf = (id) => ({ scenario: id, title: 'A short headline', hero: { value: '$1.2M', label: 'a year' }, who: 'The planning team', cadence: 'Weekly', ...WELL[id] });

test('(d) validatePick accepts a well-formed pick for every concept and refuses an unknown concept or a missing required field', () => {
  assert.deepEqual(Object.keys(WELL), IDS);
  for (const id of IDS) {
    const ok = validatePick(pickOf(id)); assert.ok(ok, `${id}: refused a good pick`); assert.equal(ok.scenario, id);
    const s = SCENARIOS.find((x) => x.id === id);
    for (const f of [...s.required, 'title']) { const bad = pickOf(id); delete bad[f]; assert.equal(validatePick(bad), null, `${id}: accepted a pick with no ${f}`); }
    assert.equal(validatePick({ ...pickOf(id), scenario: 'kpi_hero' }), null, 'an old or unknown id');
    const svg = infographicFor(byNo.get(HOME[id]), { orientation: 'landscape', scenario: id, content: ok });
    assert.ok(flat(svg).includes('A short headline'), `${id}: the model's title is drawn`);
  }
  assert.equal(validatePick(pickOf('funnel'), 'timeline').scenario, 'timeline', 'a chosen concept wins over the model');
  const msg = JSON.stringify(buildMessages({ useCase: { Name: 'x', 'Tables Involved': 'main.s.secret' }, scenario: '' }));
  for (const id of IDS) assert.ok(msg.includes(id), `the prompt lists ${id}`);
  assert.ok(!msg.includes('main.s.secret') && /business/i.test(msg), 'business text only, no tables');
});

test('(d) the browser falls back on junk or a failed route, and uses a good AI pick', async () => {
  const uc = byNo.get('N01-U01');
  for (const res of [null, { pick: { scenario: 'nope' } }, { pick: { scenario: 'funnel', title: 't', steps: ['a', 'b'] } }]) {
    const r = await pickInfographic(uc, { post: async () => res }); assert.equal(r.source, 'fallback'); assert.deepEqual(r.pick, fallbackPick(uc));
  }
  assert.equal((await pickInfographic(uc, { post: async () => { throw new Error('502'); } })).source, 'fallback');
  const ai = await pickInfographic(uc, { post: async () => ({ pick: pickOf('hub') }) });
  assert.equal(ai.source, 'ai'); assert.equal(ai.pick.scenario, 'hub');
});

test('(e) the dialog styles are "Let the AI choose" (the default) plus the 12 concepts drawn by the library; choosing one forces it', async () => {
  assert.equal(defaultDocOptions('English').infographicStyle, '', 'the default lets the AI choose');
  assert.deepEqual(API.INFOGRAPHIC_STYLES.map((s) => s.id), IDS);
  for (const s of API.INFOGRAPHIC_STYLES) {
    for (const o of ORIENTS) { const t = s.thumbnails[o]; assert.ok(t.startsWith('<svg') && t.includes(`data-concept="${s.id}"`) && t.length < 60000, `${s.id}/${o}: a library-drawn thumbnail`); }
    assert.ok(!/\.png/i.test(s.thumbnail));
  }
  const page = fs.readFileSync('src/components/GenerateDocsPages.jsx', 'utf8');
  assert.match(page, /Let the AI choose/);
  const asked = [];
  const post = async (_route, body) => { asked.push(body); return { pick: pickOf('cycle') }; };
  const theme = resolveTheme('original', 'databricks', '', 'light'); const where = { inspire_database: 'db', warehouse_id: 'w', session_id: '1' };
  const draw = (style, orientation) => G.drawInfographic(byNo.get('N01-U01'), { options: { ...defaultDocOptions('English'), orientation, infographicStyle: style }, theme, post, where });
  const auto = await draw('', 'portrait');
  assert.ok(!('scenario' in asked[0]), 'the AI chooses when no concept is chosen'); assert.match(auto, /data-concept="cycle"/); assert.match(auto, /data-orientation="portrait"/);
  const forced = await draw('waterfall', 'landscape');
  assert.equal(asked[1].scenario, 'waterfall'); assert.match(forced, /data-concept="waterfall"/);
});

test('(f) no old Nx-Ux id anywhere in an infographic; the display id is printed', () => {
  for (const r of RENDERS) {
    assert.ok(!OLD.test(r.svg), `${r.id}/${r.orientation}/${r.no}: old id`);
    assert.ok(flat(r.svg).includes(displayId(r.no)), `${r.id}/${r.orientation}: display id ${displayId(r.no)}`);
  }
});

test('theme accent, logo and right to left still apply', () => {
  const row = byNo.get('N01-U01');
  const custom = infographicFor(row, { orientation: 'landscape', scenario: 'funnel', theme: resolveTheme('original', 'custom', '#C2185B', 'light') });
  assert.ok(/#C2185B/i.test(custom), 'the custom accent colours the drawing');
  assert.ok(!/#C2185B/i.test(infographicFor(row, { orientation: 'landscape', scenario: 'funnel' })), 'and only when chosen');
  assert.match(infographicFor(row, { orientation: 'portrait', scenario: 'map', logo: 'data:image/png;base64,AAAA' }), /<image [^>]*href="data:image\/png;base64,AAAA"/);
  assert.match(infographicFor(row, { orientation: 'landscape', scenario: 'hub', rtl: true }), /^<svg direction="rtl"/);
});
