// C28 (REQ-571): per use case AI infographics. A library of designed SVG layouts (6+ scenarios, landscape and portrait), a scenario picker
// with a deterministic fallback, and a styles list the dialog shows as examples. Pure functions, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveTheme } from '../src/lib/docgen/docStyles.js';
import { renderInfographic, infographicFor, SCENARIO_IDS, infographicStyles } from '../src/lib/docgen/designs/infographic.js';
import { fallbackPick, pickInfographic } from '../src/lib/docgen/designs/infographicPick.js';
import * as docSvg from '../src/lib/docgen/docSvg.js';

const raw = JSON.parse(fs.readFileSync(new URL('../../agent/demos/bakehouse/docs/Samples bakehouse-dbx_inspire.json', import.meta.url), 'utf8'));
const UCS = raw.domains.flatMap((d) => d.use_cases);
const LONGWORD = 'Supercalifragilisticexpialidocious'.repeat(2);
const FIXTURES = [
  { ...UCS[0], Name: 'Forecast Daily Product Demand with Production Planning Recommendations Across Every Channel and Every Region of the Business Portfolio' },
  { ...UCS[1], Name: `Predict ${LONGWORD} Churn`, Statement: 'A very long statement. '.repeat(40), Solution: 'Solution words '.repeat(60), 'Business Value': 'Saves about $2.4M a year. '.repeat(10) },
  { ...UCS[2], Name: 'Short', 'Analytics Technique': 'Anomaly detection and monitoring' },
];
const LONG_CONTENT = (scenario) => ({
  scenario, title: 'An extremely long infographic title that keeps going and going so it has to wrap onto several lines of the header area',
  steps: Array.from({ length: 5 }, (_, i) => ({ title: `Step ${i + 1} with a long heading that needs wrapping ${LONGWORD}`, text: 'Explanatory text '.repeat(30) })),
  outcomes: Array.from({ length: 4 }, (_, i) => ({ title: `Outcome ${i + 1} also with a long heading`, text: 'Outcome detail '.repeat(25) })),
  kpi: { value: '$12.4M a year', label: 'Estimated yearly value from acting on this use case every single day' },
});
const theme = resolveTheme('original', 'databricks', '', 'light');
const dark = resolveTheme('original', 'databricks', '', 'dark');
const vb = (svg) => /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg).slice(1).map(Number);
const overlap = (a, b) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

test('at least 6 scenarios, each rendered landscape (16:9) and portrait (A4) with the right viewBox ratio', () => {
  assert.ok(SCENARIO_IDS.length >= 6, `scenarios: ${SCENARIO_IDS}`);
  for (const scenario of SCENARIO_IDS) {
    for (const [orientation, ratio] of [['landscape', 16 / 9], ['portrait', 210 / 297]]) {
      const svg = infographicFor(FIXTURES[2], { orientation, scenario, theme });
      assert.ok(svg.startsWith('<svg'), `${scenario}/${orientation} is an svg`);
      const [w, h] = vb(svg);
      assert.ok(Math.abs(w / h - ratio) < 0.01, `${scenario}/${orientation}: ${w}x${h}`);
      assert.ok(!/NaN|undefined/.test(svg), `${scenario}/${orientation} has no NaN or undefined`);
    }
  }
});

test('no text overflows its box or overlaps another text, for long names, in every scenario, orientation and theme', () => {
  for (const th of [theme, dark]) {
    for (const scenario of SCENARIO_IDS) {
      for (const orientation of ['landscape', 'portrait']) {
        for (const [fi, uc] of FIXTURES.entries()) {
          for (const content of [null, LONG_CONTENT(scenario)]) {
            const { svg, blocks, width, height } = renderInfographic(uc, { orientation, scenario, theme: th, content });
            const tag = `${scenario}/${orientation}/fixture${fi}/${content ? 'long' : 'fallback'}`;
            assert.ok(blocks.length >= 5, `${tag}: text blocks logged (${blocks.length})`);
            assert.ok(svg.includes('<text'), tag);
            for (const b of blocks) {
              assert.ok(b.h <= b.boxH + 0.5, `${tag}: "${b.text}" is ${b.h} high in a ${b.boxH} box`);
              assert.ok(b.maxW <= b.w + 0.5, `${tag}: "${b.text}" is ${b.maxW} wide in a ${b.w} box`);
              assert.ok(b.size >= 12, `${tag}: "${b.text}" is ${b.size}px`);
              assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= width + 0.5 && b.y + b.h <= height + 0.5, `${tag}: "${b.text}" leaves the page`);
            }
            for (let i = 0; i < blocks.length; i += 1) {
              for (let j = i + 1; j < blocks.length; j += 1) assert.ok(!overlap(blocks[i], blocks[j]), `${tag}: "${blocks[i].text}" overlaps "${blocks[j].text}"`);
            }
          }
        }
      }
    }
  }
});

test('the logo goes into the page and a right-to-left page is mirrored', () => {
  const svg = infographicFor(FIXTURES[2], { orientation: 'landscape', scenario: SCENARIO_IDS[0], theme, logo: 'data:image/png;base64,AAAA' });
  assert.ok(svg.includes('<image') && svg.includes('data:image/png;base64,AAAA'));
  const rtl = infographicFor(FIXTURES[2], { orientation: 'landscape', scenario: SCENARIO_IDS[0], theme, rtl: true });
  assert.ok(rtl.includes('direction="rtl"'));
});

test('the fallback pick follows the use case fields and is always a usable content', () => {
  for (const uc of FIXTURES) {
    const pick = fallbackPick(uc);
    assert.ok(SCENARIO_IDS.includes(pick.scenario));
    assert.ok(pick.title && pick.steps.length >= 2 && pick.outcomes.length >= 1);
  }
  assert.equal(fallbackPick({ Name: 'x', 'Analytics Technique': 'Time series forecasting', Statement: 'a. b.', Solution: 'c.', 'Business Value': 'd.' }).scenario, 'timeline');
  assert.ok(fallbackPick({ Name: 'x', Statement: 'a.', Solution: 'b.', 'Business Value': 'Saves $2.4M a year' }).kpi.value.includes('2.4M'));
  assert.ok(fallbackPick({}).title, 'an empty use case still gets a pick');
});

test('the picker falls back when the LLM is unavailable or returns junk, and keeps a valid payload', async () => {
  const uc = FIXTURES[2];
  const junk = [null, {}, { pick: null }, { pick: 'text' }, { pick: { scenario: 'nope', title: 't', steps: [], outcomes: [] } }, { pick: { scenario: SCENARIO_IDS[0], title: '', steps: ['a', 'b'], outcomes: ['c'] } },
    { pick: { scenario: SCENARIO_IDS[0], title: 't', steps: 'x', outcomes: ['c'] } }, { pick: { scenario: SCENARIO_IDS[0], title: 't', steps: ['only one'], outcomes: ['c'] } }];
  for (const reply of junk) {
    const r = await pickInfographic(uc, { post: async () => reply });
    assert.equal(r.source, 'fallback', JSON.stringify(reply));
    assert.deepEqual(r.pick, fallbackPick(uc));
  }
  const thrown = await pickInfographic(uc, { post: async () => { throw new Error('503'); } });
  assert.equal(thrown.source, 'fallback');
  const none = await pickInfographic(uc, {});
  assert.equal(none.source, 'fallback');
  const good = { scenario: SCENARIO_IDS[1], title: 'Better story', steps: [{ title: 'One', text: 'a' }, 'Two'], outcomes: [{ title: 'Win', text: 'b' }], kpi: { value: '42%', label: 'faster' } };
  const ok = await pickInfographic(uc, { post: async () => ({ pick: good }) });
  assert.equal(ok.source, 'ai');
  assert.equal(ok.pick.scenario, SCENARIO_IDS[1]);
  assert.equal(ok.pick.steps[1].title, 'Two');
  assert.equal(ok.pick.kpi.value, '42%');
});

test('the vibe text, the use case and a chosen scenario reach the request', async () => {
  const seen = [];
  await pickInfographic(FIXTURES[2], { vibe: 'warm and playful for executives', scenario: 'funnel', orientation: 'portrait', where: { session_id: '7' }, post: async (route, body) => { seen.push({ route, body }); return {}; } });
  assert.equal(seen[0].route, '/api/inspire/docs/infographic-pick');
  assert.equal(seen[0].body.vibe, 'warm and playful for executives');
  assert.equal(seen[0].body.scenario, 'funnel');
  assert.equal(seen[0].body.session_id, '7');
  assert.equal(seen[0].body.use_case.Name, 'Short');
  assert.ok(!('tables' in seen[0].body.use_case) && !('Tables Involved' in seen[0].body.use_case), 'only the story fields are sent');
});

test('a chosen scenario wins over the picked one', () => {
  const svg = infographicFor(FIXTURES[2], { orientation: 'landscape', scenario: 'funnel', content: { ...LONG_CONTENT('timeline'), steps: LONG_CONTENT('x').steps.slice(0, 3) }, theme });
  assert.ok(svg.includes('data-scenario="funnel"'));
});

test('the styles list has an id, a name and a thumbnail svg per scenario and orientation', () => {
  const styles = infographicStyles(theme);
  assert.ok(styles.length >= 6);
  assert.deepEqual(styles.map((s) => s.id), SCENARIO_IDS);
  for (const s of styles) {
    assert.ok(s.name && s.description);
    assert.ok(s.thumbnails.landscape.startsWith('<svg') && s.thumbnails.portrait.startsWith('<svg'), s.id);
    assert.ok(s.thumbnails.landscape.length < 60000, 'thumbnails stay light');
  }
});

test('docSvg exports the infographic API for the dialog', () => {
  for (const k of ['infographicFor', 'infographicStyles', 'pickInfographic', 'fallbackPick']) assert.equal(typeof docSvg[k], 'function', k);
});

test('infographicApi gives the dialog infographicFor (style and palette pick the theme) and INFOGRAPHIC_STYLES with a thumbnail', async () => {
  const api = await import('../src/lib/docgen/infographicApi.js');
  assert.ok(api.INFOGRAPHIC_STYLES.length >= 6 && api.INFOGRAPHIC_STYLES.every((s) => s.id && s.name && s.thumbnail.startsWith('<svg')));
  const a = api.infographicFor(FIXTURES[2], { orientation: 'portrait', scenario: 'timeline', businessName: 'Acme', values: {}, style: 'bold', palette: 'databricks', customColor: '' });
  assert.ok(a.startsWith('<svg') && a.includes('data-scenario="timeline"'));
});
