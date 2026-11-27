// C29 phase 4 (REQ-574, REQ-571): the infographic never shows a cut sentence and has no empty band. No text ends in an ellipsis; a phrase the
// use case gave is whole (the full field, or a prefix that ends at a clause boundary); the largest empty horizontal band stays under 15% of the
// page height; a logo never removes an icon; the pick validator refuses a slot that is too long (the route then asks the model once more).
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { ROWS, flat } from './c27x_fixture.mjs';
import { bandOf, texts, sourcesOf, ellipsisProblems, cutPhraseProblems } from './tools/infogCheck.mjs';
import { validatePick, SCENARIO_IDS, LIMITS } from '../../backend/lib/infographicPick.mjs';
import { infographicFor } from '../src/lib/docgen/designs/infographic.js';

const IDS = SCENARIO_IDS; const ORIENTS = ['landscape', 'portrait'];
const byNo = new Map(ROWS.map((r) => [String(r.No), r]));
const SIX = ['N01-U01', 'N03-U01', 'N09-U01', 'N10-U01', 'N11-U01', 'N12-U01'];
const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const RUNS = []; for (const no of SIX) for (const id of IDS) for (const orientation of ORIENTS) RUNS.push({ no, id, orientation, tag: `${id}/${orientation}/${no}`, svg: infographicFor(byNo.get(no), { orientation, scenario: id }) });

const SOURCE = sourcesOf(ROWS);

test('(a) no text in any of the 144 drawings ends in an ellipsis, and none ends on a dangling word', () => {
  assert.equal(RUNS.length, 144);
  const bad = RUNS.flatMap((r) => ellipsisProblems(r.svg).map((p) => `${r.tag}: ${p}`));
  assert.deepEqual(bad.slice(0, 12), [], `${bad.length} cut texts`);
});

test('(b) a phrase taken from the use case is whole: the full text or a prefix that ends at a clause boundary', () => {
  const bad = RUNS.flatMap((r) => cutPhraseProblems(r.svg, SOURCE).map((p) => `${r.tag}: ${p}`));
  assert.deepEqual(bad.slice(0, 12), [], `${bad.length} cut phrases`);
});

test('(c) no band of the page is more than 15% of its height empty and no panel is under half filled', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); const bad = [];
    for (const r of RUNS) { const b = await bandOf(page, r.svg); if (b.gap > 0.15 * b.h) bad.push(`${r.tag}: ${Math.round(b.gap)} px empty at y=${Math.round(b.y)} (${Math.round((100 * b.gap) / b.h)}%)`); else if (b.panelFill.ratio < 0.5) bad.push(`${r.tag}: a panel at y=${Math.round(b.panelFill.y)} is only ${Math.round(100 * b.panelFill.ratio)}% filled`); }
    assert.deepEqual(bad.slice(0, 20), [], `${bad.length} drawings with an empty band`);
  } finally { await browser.close(); }
});

test('(d) a logo never removes an icon, and is drawn', () => {
  const bad = [];
  for (const r of RUNS) {
    const withLogo = infographicFor(byNo.get(r.no), { orientation: r.orientation, scenario: r.id, logo: LOGO });
    const n = (s) => (s.match(/data-icon=/g) || []).length;
    if (n(withLogo) < n(r.svg)) bad.push(`${r.tag}: ${n(r.svg)} icons, ${n(withLogo)} with a logo`);
    if (!withLogo.includes(LOGO)) bad.push(`${r.tag}: the logo is not drawn`);
  }
  assert.deepEqual(bad.slice(0, 12), [], `${bad.length} drawings lose an icon with a logo`);
});

test('(e) validatePick refuses an over-length slot (so the route asks again) and accepts one at the limit', () => {
  const base = { scenario: 'hub', title: 'A short headline', steps: ['Ask in plain words', 'Read the tables'], center: 'A data agent', spokes: ['Sales tables', 'Stock tables', 'Example questions'] };
  assert.ok(validatePick(base), 'a good pick');
  const long = 'x'.repeat(5).split('').map(() => 'word').join(' ').repeat(12);
  const cases = { title: { title: long }, step: { steps: ['Ask in plain words', long] }, spoke: { spokes: ['a b', 'c d', long] }, center: { center: long }, who: { who: long }, problem: { problem: long + long } };
  for (const [k, patch] of Object.entries(cases)) assert.equal(validatePick({ ...base, ...patch }), null, `an over-length ${k} is refused`);
  const atLimit = 'abcd '.repeat(40).slice(0, LIMITS.step).trim();
  assert.ok(validatePick({ ...base, steps: ['Ask in plain words', atLimit] }), 'a step at the limit is accepted');
  assert.equal(validatePick({ ...base, steps: ['Ask in plain words', `${atLimit} more`.padEnd(LIMITS.step + 5, 'z')] }), null, 'one over the limit is refused');
});
