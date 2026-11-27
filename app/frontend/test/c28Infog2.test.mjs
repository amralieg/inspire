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
  kpi: { value: '$2.4M', label: 'estimated yearly value' }, before: [{ title: 'Spreadsheets', text: 'Each store guesses.' }, { title: 'Late reports', text: 'Numbers arrive late.' }, { title: 'Stock-outs', text: 'Customers leave.' }],
});
const LONGWORD = 'Supercalifragilisticexpialidocious'.repeat(2);
const LONG = (scenario) => ({ ...CONTENT(scenario), title: 'An extremely long infographic title that keeps going and going so it wraps over several lines', steps: Array.from({ length: 5 }, (_, i) => ({ title: `Step ${i + 1} ${LONGWORD}`, text: 'Explanatory text '.repeat(30) })), outcomes: Array.from({ length: 4 }, (_, i) => ({ title: `Outcome ${i + 1} long heading`, text: 'Outcome detail '.repeat(25) })) });
const light = resolveTheme('original', 'databricks', '', 'light'); const dark = resolveTheme('original', 'databricks', '', 'dark');
const custom = resolveTheme('original', 'databricks', '#C2185B', 'light');
const ALL = []; for (const th of [light, dark, custom]) for (const s of SCENARIO_IDS) for (const o of ['landscape', 'portrait']) for (const [k, content] of [['normal', CONTENT(s)], ['long', LONG(s)]]) ALL.push({ th, s, o, k, r: renderInfographic(UC, { orientation: o, scenario: s, theme: th, content }) });
const inside = (p, b, tol = 2) => p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol;

test('every card and funnel stage has an icon drawn from <path> data, inside its box', () => {
  assert.ok(ALL.length >= 36);
  for (const { s, o, k, r } of ALL) {
    const tag = `${s}/${o}/${k}`;
    const cards = r.nodes.filter((n) => n.kind === 'card' || n.kind === 'stage');
    assert.ok(cards.length >= 4, `${tag}: cards ${cards.length}`);
    for (const n of cards) assert.ok(r.icons.some((ic) => inside({ x: ic.x + ic.w / 2, y: ic.y + ic.h / 2 }, n, 0)), `${tag}: a card at ${Math.round(n.x)},${Math.round(n.y)} has no icon`);
    const groups = r.svg.match(/<g data-role="icon"[^>]*>.*?<\/g>/g) || [];
    assert.ok(groups.length >= cards.length, `${tag}: icon groups ${groups.length} < cards ${cards.length}`);
    for (const g of groups) assert.ok(g.includes('<path'), `${tag}: an icon without <path>`);
  }
});

test('ribbons are wide filled <path>s with a gradient fill, no thin connector lines', () => {
  for (const { s, o, k, r } of ALL) {
    const tag = `${s}/${o}/${k}`;
    const rib = r.svg.match(/<path data-role="ribbon"[^>]*>/g) || [];
    assert.ok(rib.length >= 2, `${tag}: ribbons ${rib.length}`);
    assert.equal(rib.length, r.ribbons.length, tag);
    for (const p of rib) {
      const id = /fill="url\(#([^)]+)\)"/.exec(p);
      assert.ok(id, `${tag}: ribbon without gradient fill`);
      assert.ok(r.svg.includes(`<linearGradient id="${id[1]}"`), `${tag}: gradient ${id[1]} is not defined`);
    }
    for (const q of r.ribbons) assert.ok(q.t >= 14 && q.t <= 28, `${tag}: ribbon is ${q.t} wide`);
    assert.ok(!/<path[^>]*fill="none"[^>]*stroke-width="(\d|1[0-9]|2[0-8])"[^>]*stroke-linecap="round"/.test(r.svg), `${tag}: a thin stroked connector is left`);
  }
});

test('no disconnected connector: both ends of every ribbon touch a card, stage, marker, hub or number panel', () => {
  for (const { s, o, k, r } of ALL) {
    for (const q of r.ribbons) for (const p of [{ x: q.x1, y: q.y1 }, { x: q.x2, y: q.y2 }]) assert.ok(r.nodes.some((n) => inside(p, n)), `${s}/${o}/${k}: ribbon end ${Math.round(p.x)},${Math.round(p.y)} touches no box`);
  }
});

test('text is sized for the page: portrait never below 22px, landscape never below 16px', () => {
  for (const { s, o, k, r } of ALL) for (const b of r.blocks) assert.ok(b.size >= (o === 'portrait' ? 22 : 16), `${s}/${o}/${k}: "${b.text}" is ${b.size}px`);
});

test('the page is filled: no empty band taller than 150px in the body, in portrait and landscape', () => {
  for (const { s, o, k, r } of ALL) {
    const top = o === 'portrait' ? 300 : 200; const bottom = r.height - 72;
    const spans = [...r.nodes.map((n) => [n.y, n.y + n.h]), ...r.ribbons.map((q) => [Math.min(q.y1, q.y2), Math.max(q.y1, q.y2)]), ...r.blocks.map((b) => [b.y, b.y + b.h])].sort((a, b) => a[0] - b[0]);
    let cur = top; let worst = 0;
    for (const [a, b] of spans) { if (b < top) continue; worst = Math.max(worst, a - cur); cur = Math.max(cur, b); }
    worst = Math.max(worst, bottom - cur);
    assert.ok(worst <= 150, `${s}/${o}/${k}: empty band of ${Math.round(worst)}px`);
  }
});

test('the headings carry the step count, the KPI number has a colour gradient, cards carry a soft shadow', () => {
  for (const s of SCENARIO_IDS) {
    const r = renderInfographic(UC, { orientation: 'landscape', scenario: s, theme: light, content: CONTENT(s) });
    assert.ok(/<filter id="[^"]+"/.test(r.svg) && r.svg.includes('filter="url(#'), `${s}: soft shadow`);
    assert.ok(/<text[^>]*fill="url\(#[^)]+\)"[^>]*>[^<]*<tspan[^>]*>\$2\.4M/.test(r.svg), `${s}: KPI number is not gradient filled`);
  }
  const r = renderInfographic(UC, { orientation: 'landscape', scenario: 'process_flow', theme: light, content: CONTENT('process_flow') });
  assert.ok(r.blocks.some((b) => /How it works: 4 steps/.test(b.text)), 'section head with the count');
});
