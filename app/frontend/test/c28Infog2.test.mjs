// C28 (REQ-571 round 2): the use case infographics must read like a designed infographic: an icon on every card, wide gradient ribbons that
// join the cards (no loose connector), text sized for the page, and no big empty band. Acceptance tests, written before the redesign.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveTheme } from '../src/lib/docgen/docStyles.js';
import { renderInfographic, SCENARIO_IDS } from '../src/lib/docgen/designs/infographic.js';

const raw = JSON.parse(fs.readFileSync(new URL('../../agent/demos/bakehouse/docs/Samples bakehouse-dbx_inspire.json', import.meta.url), 'utf8'));
const UC = raw.domains.flatMap((d) => d.use_cases)[0];
const CONTENT = (scenario) => ({
  scenario, title: 'Forecast daily demand and plan production before the shelves run empty', subtitle: 'Supply chain',
  steps: [{ title: 'Collect sales data', text: 'Daily sales by product and store flow into one table.' }, { title: 'Train a forecast model', text: 'A time series model learns seasonality and holidays.' },
    { title: 'Plan production', text: 'Batch sizes are sent to each bakery every night.' }, { title: 'Review and alert the team', text: 'Managers see exceptions and approve changes.' }],
  outcomes: [{ title: 'Less waste', text: 'Fewer unsold products.' }, { title: 'Higher availability', text: 'Popular items stay on the shelf.' }, { title: 'Faster planning', text: 'Minutes, not hours.' }],
  kpi: { value: '$2.4M', label: 'estimated yearly value' }, hero: { value: '$2.4M', label: 'estimated yearly value' }, before: [{ title: 'Spreadsheets', text: 'Each store guesses.' }, { title: 'Late reports', text: 'Numbers arrive late.' }, { title: 'Stock-outs', text: 'Customers leave.' }],
});
const LONGWORD = 'Supercalifragilisticexpialidocious'.repeat(2);
const LONG = (scenario) => ({ ...CONTENT(scenario), title: 'An extremely long infographic title that keeps going and going so it wraps over several lines', steps: Array.from({ length: 5 }, (_, i) => ({ title: `Step ${i + 1} ${LONGWORD}`, text: 'Explanatory text '.repeat(30) })), outcomes: Array.from({ length: 4 }, (_, i) => ({ title: `Outcome ${i + 1} long heading`, text: 'Outcome detail '.repeat(25) })) });
const light = resolveTheme('original', 'databricks', '', 'light'); const dark = resolveTheme('original', 'databricks', '', 'dark');
const custom = resolveTheme('original', 'databricks', '#C2185B', 'light');
const ALL = []; for (const th of [light, dark, custom]) for (const s of SCENARIO_IDS) for (const o of ['landscape', 'portrait']) for (const [k, content] of [['normal', CONTENT(s)], ['long', LONG(s)]]) ALL.push({ th, s, o, k, r: renderInfographic(UC, { orientation: o, scenario: s, theme: th, content }) });
// C29: the c28 card-and-ribbon renderers (r.nodes, r.ribbons, r.blocks) are replaced by the 12 approved concepts, which draw icons, process
// diagrams and hero numbers of their own. Each check below is the same intent read from the drawn SVG; layout (overlap, off-canvas, 20 px) is
// measured in Chromium by c29Infog3p2 and c28Infog.

test('every drawing has icons drawn from <path> data (6 or more)', () => {
  assert.ok(ALL.length >= 36);
  for (const { s, o, k, r } of ALL) {
    const tag = `${s}/${o}/${k}`;
    const groups = r.svg.match(/<g data-icon="[^"]+"[^>]*>.*?<\/g>/g) || [];
    assert.ok(groups.length >= 6, `${tag}: icons ${groups.length}`);
    for (const g of groups) assert.ok(/<(path|circle|rect)/.test(g), `${tag}: an icon without shapes`);
  }
});

test('every drawing has a process diagram, and no thin round-capped connector line', () => {
  for (const { s, o, k, r } of ALL) {
    const tag = `${s}/${o}/${k}`;
    assert.ok(/<g data-process="[^"]+"/.test(r.svg), `${tag}: no process diagram`);
    assert.ok(!/<path[^>]*fill="none"[^>]*stroke-width="(1|2)"[^>]*stroke-linecap="round"/.test(r.svg), `${tag}: a thin stroked connector is left`);
  }
});

test('text is sized for the page: never below 20px at 1240px, in portrait and landscape', () => {
  for (const { s, o, k, r } of ALL) {
    const small = [...r.svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1])).filter((v) => v < 20);
    assert.deepEqual(small, [], `${s}/${o}/${k}`);
  }
});

test('the hero number has a colour gradient and the page defines a soft shadow', () => {
  for (const s of SCENARIO_IDS) {
    const r = renderInfographic(UC, { orientation: 'landscape', scenario: s, theme: light, content: CONTENT(s) });
    assert.ok(/<filter id="[^"]+"/.test(r.svg), `${s}: soft shadow`);
    assert.ok(/<text[^>]*fill="url\(#[^)]+\)"[^>]*>(<tspan[^>]*>)?\$2\.4M/.test(r.svg), `${s}: KPI number is not gradient filled`);
  }
});
