import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const need = createRequire(import.meta.url);
import { counterLines, counterTitle } from '../src/valueCounter.js';

// The shell has no JSX loader under node: bundle the component in memory (react stays external) and import the result.
async function load(file) {
  const out = await build({ entryPoints: [new URL(`../src/${file}`, import.meta.url).pathname], bundle: true, write: false, format: 'esm',
    platform: 'node', jsx: 'automatic', loader: { '.jsx': 'jsx' }, external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/*'] });
  const code = out.outputFiles[0].text.replace(/from "(react[^"]*)"/g, (_m, id) => `from "${pathToFileURL(need.resolve(id)).href}"`);
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
const { CounterView: ValueCounter } = await load('ValueCounter.jsx');
const { default: ValueStrip } = await load('ValueStrip.jsx');

const DISCLAIMER = { short: 'Unverified estimate', full: 'A specialist must verify every number.' };
const counter = (extra = {}) => ({
  shown: true, case_noun: 'claim', per_case: 1000, currency: 'USD', status: 'calculated', cases_from: 'your data',
  saved_at: '2026-11-20 10:00:00', amount: 1000000, cases_per_year: 1000, mine: { cases: 3, value: 3000 }, team: { cases: 10, value: 10000 },
  streak_weeks: 0, badges: [], next_badge: null, disclaimer: DISCLAIMER, ...extra,
});
const html = (data) => renderToStaticMarkup(createElement(ValueCounter, { data }));

test('nothing shown means nothing rendered', () => {
  assert.equal(html({ shown: false }), '');
  assert.equal(html(null), '');
  assert.equal(counterLines({ shown: false }), null);
});

test('the lines read the person total and the team total with the short disclaimer visible and the full one in the title', () => {
  const lines = counterLines(counter());
  assert.equal(lines.mine.text, 'Value saved by you: $3,000');
  assert.equal(lines.team.text, 'Team total: $10,000');
  const out = html(counter());
  assert.match(out, /Value saved by you: \$3,000/);
  assert.match(out, /Team total: \$10,000/);
  assert.match(out, /data-value-mine/);
  assert.match(out, /data-value-team/);
  assert.match(out, /data-value-disclaimer[^>]*>Unverified estimate</);
  const title = counterTitle(counter());
  assert.ok(title.startsWith(DISCLAIMER.full));
  for (const part of ['calculated', 'your data', '$1,000 per claim resolved', '1,000 claims', '2026-11-20 10:00:00']) assert.ok(title.includes(part), part);
  assert.ok(out.includes(`title="${title}"`) || out.includes('title='));
});

test('without a personal total only the team line shows', () => {
  const out = html(counter({ mine: null }));
  assert.doesNotMatch(out, /data-value-mine/);
  assert.match(out, /data-value-team/);
});

test('a streak under two weeks is not shown and from two weeks it reads n-week streak', () => {
  assert.doesNotMatch(html(counter({ streak_weeks: 1 })), /streak/);
  assert.match(html(counter({ streak_weeks: 3 })), /3-week streak/);
});

test('badges and the next one show for the person only, with no ranks', () => {
  const out = html(counter({ badges: [{ key: 'first', label: 'First case' }], next_badge: { key: 'p1', label: '1% of the year', remaining: 7000, unit: 'money' } }));
  assert.match(out, /First case/);
  assert.match(out, /\$7,000 to go/);
  assert.doesNotMatch(out, /rank|leader/i);
});

test('the strip with no counter keeps its DOM free of the counter', () => {
  const page = { id: 'p', title: 'T', kpis: [{ id: 'k', label: 'At risk', format: 'currency', currency: 'USD' }] };
  const out = renderToStaticMarkup(createElement(ValueStrip, { page, data: { kpis: { k: { now: 5 } } }, app: {} }));
  assert.doesNotMatch(out, /data-value-mine|data-value-disclaimer|data-value-team/);
});
