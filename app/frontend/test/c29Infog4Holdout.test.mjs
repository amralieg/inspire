// C29 phase 4 holdout (REQ-574, REQ-571): the infographic works on use cases the code was never tuned on. Holdout A: every distinct use case of
// the three recorded sessions (about 117). Holdout B: seeded synthetic edge cases (missing fields, odd units, 1 and 9 steps, very long text,
// Arabic, an unknown technique, only a name). Invariants: no ellipsis, whole phrases, no overlap or small text, 6+ icons, the title, no empty band.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { chromium } from 'playwright';
import { ROWS, rowByNo } from './c27x_fixture.mjs';
import { checkSvg, bandOf, sourcesOf, ellipsisProblems, cutPhraseProblems, flatText } from './tools/infogCheck.mjs';
import { validatePick, SCENARIO_IDS } from '../../backend/lib/infographicPick.mjs';
import { infographicFor } from '../src/lib/docgen/designs/infographic.js';
import { fallbackPick } from '../src/lib/docgen/designs/infographicPick.js';
import { plainBusiness } from '../src/lib/docgen/docText.js';

const load = (name) => { const d = JSON.parse(zlib.brotliDecompressSync(fs.readFileSync(new URL(`../../backend/showcase/${name}.json.br`, import.meta.url)))); const k = Object.keys(d.inspire).find((x) => x.includes('/api/inspire/results?'));
  return d.inspire[k].body.results.domains.flatMap((dm) => dm.use_cases); };
const A = []; for (const f of ['kinds-retail', 'nyctaxi', 'tpcds-retail']) { const seen = new Set(); for (const r of load(f)) { const id = String(r.No); if (!seen.has(id)) { seen.add(id); A.push({ ...r, __src: `${f}:${id}` }); } } }
const SOURCE = sourcesOf(A);
// Seeded sample of 20 for the all-concepts check (deterministic, not chosen by content).
let seed = 20261127; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const SAMPLE = [...A].map((r) => [rnd(), r]).sort((x, y) => x[0] - y[0]).slice(0, 20).map((x) => x[1]);
const heroOf = (row) => ((/At stake:[^$\d]*(\$?\d[\d,.]*\s?[MKB]?)/.exec(String(row['Business Value'])) || [])[1] || '').replace(/[.,]$/, '').trim();

const runs = [];
for (const r of A) { const pick = fallbackPick(r); for (const o of ['landscape', 'portrait']) runs.push({ row: r, tag: `${r.__src}/${pick.scenario}/${o}`, orient: o, id: pick.scenario }); }
for (const r of SAMPLE) for (const id of SCENARIO_IDS) runs.push({ row: r, tag: `${r.__src}/${id}/landscape`, orient: 'landscape', id });
for (const x of runs) x.svg = infographicFor(x.row, { orientation: x.orient, scenario: x.id });

test('holdout A is real and large: 100+ distinct use cases from 3 sessions', () => { assert.ok(A.length >= 100, `${A.length}`); assert.equal(new Set(A.map((r) => r.__src)).size, A.length); });

test('holdout A: the fallback pick is valid for every use case; report the distribution', () => {
  const dist = {}; for (const r of A) { const p = fallbackPick(r); assert.ok(validatePick(p), `${r.__src}: invalid pick`); dist[p.scenario] = (dist[p.scenario] || 0) + 1; }
  console.log('FALLBACK DISTRIBUTION', JSON.stringify(dist));
  assert.ok(Object.keys(dist).length >= 5, `only ${Object.keys(dist).length} concepts used: ${JSON.stringify(dist)}`);
});

test('holdout A: no ellipsis, no dangling word, whole phrases', () => {
  const bad = runs.flatMap((r) => [...ellipsisProblems(r.svg), ...cutPhraseProblems(r.svg, SOURCE)].map((p) => `${r.tag}: ${p}`));
  assert.deepEqual(bad.slice(0, 15), [], `${bad.length} cut texts in ${runs.length} drawings`);
});

test('holdout A: title, hero, 6+ icons, no overlap or small text, no empty band', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); const bad = [];
    for (const r of runs) {
      const t = flatText(r.svg); const name = plainBusiness(r.row.Name).trim();
      if (name && !t.includes(name)) bad.push(`${r.tag}: title not whole`);
      const h = heroOf(r.row); if (h && !t.includes(h)) bad.push(`${r.tag}: hero ${h} missing`);
      const icons = (r.svg.match(/data-icon=/g) || []).length; if (icons < 6) bad.push(`${r.tag}: ${icons} icons`);
      const p = await checkSvg(page, r.svg); if (p.length) bad.push(`${r.tag}: ${p.slice(0, 2).join('; ')}`);
      const b = await bandOf(page, r.svg); if (b.gap > 0.15 * b.h) bad.push(`${r.tag}: ${Math.round((100 * b.gap) / b.h)}% empty at y=${Math.round(b.y)}`); else if (b.panelFill.ratio < 0.5) bad.push(`${r.tag}: panel ${Math.round(100 * b.panelFill.ratio)}% filled`);
    }
    assert.deepEqual(bad.slice(0, 25), [], `${bad.length} problems in ${runs.length} drawings`);
  } finally { await browser.close(); }
});

// ---------- holdout B: synthetic edge cases ----------
const BASE = rowByNo('N01-U01');
const words = (n, w = 'word') => Array.from({ length: n }, (_, i) => `${w}${i % 7}`).join(' ');
const sentencesN = (n) => Array.from({ length: n }, (_, i) => `Step number ${i + 1} reads the data and shows the result to the team.`).join(' ');
const CASES = {
  noWhoNoCadence: { Beneficiary: '', 'Decision Cadence': '' },
  hoursNotMoney: { 'Business Value': 'Cuts the wait. At stake: 14.6 hours a week.', Statement: 'Orders wait 14.6 hours at one step. 2,400 orders a week are late.' },
  countsNotMoney: { 'Business Value': 'Fewer late orders. At stake: 2,400 orders a month.' },
  otherCurrency: { 'Business Value': 'Margin kept. At stake: AED 4.2M a year.', Statement: 'Costs rose AED 4.2M: volume took AED 2.0M, price AED 1.5M and mix AED 0.7M.' },
  noValue: { 'Business Value': '', Statement: 'Teams read the same report in different ways and decisions come late.' },
  oneStep: { Solution: 'Technique: a model ranks the items.', method_summary: 'Technique: a model ranks the items.', serving_summary: '' },
  nineSteps: { Solution: `Technique: ${sentencesN(9)}`, method_summary: `Technique: ${sentencesN(9)}` },
  longTitle: { Name: `${words(18, 'Headline')} for the whole planning group` },
  longFields: { Statement: `${words(80)}. ${words(80)}.`, Solution: `Technique: ${words(100)}. ${words(100)}.`, 'Business Value': `${words(90)}. At stake: $2.4M a year.`, Beneficiary: words(60), 'Decision Cadence': words(40), serving_summary: `${words(60)}: ${words(60)}` },
  arabic: { Name: 'توقع الطلب الأسبوعي للمنتجات', Statement: 'يتأخر الطلب 14.6 ساعة في خطوة واحدة. تتأثر 2,400 طلبية كل أسبوع.', Beneficiary: 'فريق التخطيط', 'Decision Cadence': 'أسبوعيا', 'Business Value': 'قيمة محفوظة. At stake: $1.2M a year.' },
  unknownTechnique: { 'Analytics Technique': 'Zeta Quokka Folding', kind_label: 'Zeta Quokka Folding' },
  onlyName: Object.fromEntries(Object.keys(BASE).map((k) => [k, k === 'Name' ? 'A name only' : typeof BASE[k] === 'string' ? '' : Array.isArray(BASE[k]) ? [] : BASE[k]])),
};
const B = Object.entries(CASES).map(([k, patch]) => ({ k, row: { ...BASE, ...patch, No: BASE.No } }));

test('holdout B: every synthetic edge case gets a valid concept and draws all 12 concepts in both orientations without a cut text', async () => {
  const browser = await chromium.launch({ headless: true }); const bad = [];
  try {
    const page = await browser.newPage();
    for (const { k, row } of B) {
      const pick = fallbackPick(row); if (!validatePick(pick)) bad.push(`${k}: invalid fallback pick`);
      for (const id of SCENARIO_IDS) for (const o of ['landscape', 'portrait']) {
        const rtl = k === 'arabic'; const svg = infographicFor(row, { orientation: o, scenario: id, rtl }); const tag = `${k}/${id}/${o}`;
        const e = ellipsisProblems(svg); if (e.length) bad.push(`${tag}: ${e[0]}`);
        const c = cutPhraseProblems(svg, sourcesOf([row])); if (c.length) bad.push(`${tag}: ${c[0]}`);
        const p = await checkSvg(page, svg); if (p.length) bad.push(`${tag}: ${p[0]}`);
        const b = await bandOf(page, svg); if (b.gap > 0.15 * b.h) bad.push(`${tag}: ${Math.round((100 * b.gap) / b.h)}% empty at y=${Math.round(b.y)}`);
        if (k !== 'onlyName' && (svg.match(/data-icon=/g) || []).length < 6) bad.push(`${tag}: under 6 icons`);
      }
    }
    assert.deepEqual(bad.slice(0, 30), [], `${bad.length} problems`);
  } finally { await browser.close(); }
});
