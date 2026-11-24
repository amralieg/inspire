// REQ-508 L7 (Art Director pass, "A Calm Console"): four primitives in src/components/ui (Button, Badge, Tabs, EmptyState) carry the
// one primary-button signature, the status badge tones and the one tab style. Audit scratch/req508_art_director.md F22, F24, F25, section 2.2.
// Fail-pre (15eb146b9): there is no components/ui folder; four tab styles exist (TabStrip underline, ResultsNav boxed pills,
// ReportedIssues chips at ReportedIssues.jsx:80, Header pills) and the primary button is hand-written in 45 places.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { RULES, SRC, read } from './req508Lint.mjs';

const PRIMITIVES = ['Button', 'Badge', 'Tabs', 'EmptyState'];
const has = (rel) => existsSync(path.join(SRC, rel));
const src = (rel) => (has(rel) ? read(rel) : '');

test('the four primitives exist as components/ui/<Name>.jsx with a default export', () => {
  for (const name of PRIMITIVES) {
    const rel = `components/ui/${name}.jsx`;
    assert.ok(has(rel), `${rel} exists`);
    assert.match(src(rel), new RegExp(`export default function ${name}\\b`), `${rel} default-exports ${name}`);
  }
});

test('Button: primary / secondary / ghost / danger variants and sm / md sizes; primary is the token red with primary-fg text', () => {
  const s = src('components/ui/Button.jsx');
  for (const v of ['primary', 'secondary', 'ghost', 'danger']) assert.match(s, new RegExp(`\\b${v}\\s*:`), `variant ${v}`);
  for (const z of ['sm', 'md']) assert.match(s, new RegExp(`\\b${z}\\s*:`), `size ${z}`);
  assert.match(s, /\bbg-primary\b[^'"`]*\bhover:bg-primary-hover\b[^'"`]*\btext-primary-fg\b|\btext-primary-fg\b[^'"`]*\bbg-primary\b/, 'primary = bg-primary, hover:bg-primary-hover, text-primary-fg');
  assert.match(s, /\brounded-md\b/, 'buttons use radius md');
  assert.match(s, /\btransition-colors\b/, 'buttons transition colours only');
});

test('Button: a disabled primary turns neutral grey, never a faded red (no disabled:opacity on the fill)', () => {
  const s = src('components/ui/Button.jsx');
  assert.ok(s, 'Button.jsx exists');
  assert.match(s, /\bdisabled:bg-neutral-bg\b/);
  assert.match(s, /\bdisabled:text-neutral-fg\b/);
  assert.doesNotMatch(s, /\bdisabled:opacity-\d+/);
});

test('Badge: neutral / success / warning / danger / info tones, each on its -bg and -fg tokens, radius sm', () => {
  const s = src('components/ui/Badge.jsx');
  for (const t of ['neutral', 'success', 'warning', 'danger', 'info']) assert.match(s, new RegExp(`\\bbg-${t}-bg\\b[^'"\`]*\\btext-${t}-fg\\b`), `tone ${t}`);
  assert.match(s, /\brounded-sm\b/);
});

test('Tabs: one underline style (2px primary underline on the current tab), tablist / tab / tabpanel roles, and the panel fades in', () => {
  const s = src('components/ui/Tabs.jsx');
  for (const role of ['tablist', 'tab', 'tabpanel']) assert.match(s, new RegExp(`role[=:]\\s*['"{]*${role}\\b`), `role ${role}`);
  assert.match(s, /\bborder-b-2\b/);
  assert.match(s, /\bborder-primary\b/);
  assert.match(s, /\btab-panel-enter\b/, 'the panel carries the tab-panel-enter class (fade, --dur-base)');
  const css = read('index.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css.match(/\.tab-panel-enter\s*\{([^}]*)\}/)?.[1] || '', /animation\s*:[^;]*var\(--dur-base\)/);
});

test('the tab strips (TabStrip, ResultsNav, ReportedIssues) all render the Tabs primitive', () => {
  for (const [rel, spec] of [['components/TabStrip.jsx', './ui/Tabs'], ['components/results/ResultsNav.jsx', '../ui/Tabs'], ['components/ReportedIssues.jsx', './ui/Tabs']]) {
    assert.match(read(rel), new RegExp(`from ['"]${spec.replace(/[./]/g, (c) => `\\${c}`)}(?:\\.jsx)?['"]`), `${rel} imports ${spec}`);
  }
});

test('the L7 files carry no hand-written primary button (the hand-primary rule catches a planted one: must-fail / must-keep)', () => {
  assert.ok(RULES['hand-primary']('planted.jsx', '<button className="px-3 bg-db-red-solid text-white" />').length > 0);
  assert.ok(RULES['hand-primary']('planted.jsx', "const SAVE_BUTTON = 'px-3 bg-db-red-solid text-white';").length > 0);
  assert.deepEqual(RULES['hand-primary']('planted.jsx', '<div data-run-value-box="" className="bg-db-red-solid text-white" />'), [], 'a red value box is not a button');
  assert.deepEqual(RULES['hand-primary']('components/ui/Button.jsx', "const primary = 'bg-primary text-primary-fg';"), []);
  const owned = ['components/TabStrip.jsx', 'components/results/ResultsNav.jsx', 'components/ReportedIssues.jsx', 'components/ValueTotalsPanel.jsx'];
  assert.deepEqual(owned.flatMap((f) => RULES['hand-primary'](f, read(f))), []);
});
