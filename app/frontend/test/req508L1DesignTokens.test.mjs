// REQ-508 L1 (Art Director pass, direction "A Calm Console", approved by Amr): the design tokens live in src/index.css, in light and
// dark. Wireframe ~/claude/inspire/wireframes/req508_art_director.html, audit scratch/req508_art_director.md section 2.1.
// Fail-pre (15eb146b9): there are two primary reds (db-red #FF3621 and db-red-solid #D92E1B), no primary/neutral/danger tokens, no
// type, radius, elevation, motion, z-index or container scale, and the ok/danger classes the value wizard uses compile to nothing (F11/F12).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SRC } from './req508Lint.mjs';

const CSS_SOURCE = readFileSync(path.join(SRC, 'index.css'), 'utf8');
const CSS = CSS_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '');

// The declarations of every top-level block whose selector (or at-rule) matches `select`, in source order.
function blocks(css, select) {
  const out = [];
  const re = /([^{};]+)\{/g;
  let m;
  while ((m = re.exec(css))) {
    const head = m[1].trim();
    let depth = 1;
    let i = re.lastIndex;
    while (depth && i < css.length) { if (css[i] === '{') depth += 1; else if (css[i] === '}') depth -= 1; i += 1; }
    const body = css.slice(re.lastIndex, i - 1);
    if (select(head)) out.push(body);
    if (!head.startsWith('@media') && !head.startsWith('@supports')) re.lastIndex = i;
  }
  return out;
}
const decls = (body) => Object.fromEntries([...body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const top = (css) => css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
const THEME = Object.assign({}, ...blocks(top(CSS), (h) => h === '@theme' || h === '@theme static' || h === '@theme inline').map(decls));
const ROOT = Object.assign({}, ...blocks(top(CSS), (h) => h === ':root').map(decls));
const DARK = Object.assign({}, ...blocks(top(CSS), (h) => h === '.dark').map(decls));
const REDUCED = Object.assign({}, ...blocks(CSS.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/g)?.join('\n') || '', () => true)
  .map((b) => decls(b)));

const norm = (v) => String(v ?? '').toLowerCase().replace(/\s+/g, '').replace(/0\./g, '.');
function resolve(name, mode, seen = new Set()) {
  const scope = mode === 'dark' ? { ...THEME, ...ROOT, ...DARK } : { ...THEME, ...ROOT };
  const raw = scope[name];
  if (raw === undefined || seen.has(name)) return undefined;
  seen.add(name);
  return raw.replace(/var\((--[\w-]+)(?:,\s*([^)]+))?\)/g, (_, v, fallback) => resolve(v, mode, seen) ?? fallback ?? `<missing ${v}>`).trim();
}
const same = (a, b, mode) => {
  assert.ok(resolve(a, mode) && !resolve(a, mode).includes('<missing'), `${a} is defined in ${mode}`);
  assert.equal(norm(resolve(a, mode)), norm(resolve(b, mode)), `${a} resolves to the same value as ${b} in ${mode}`);
};

let compiled = null;
async function builds(classes) {
  if (!compiled) {
    const { compile } = await import('@tailwindcss/node');
    compiled = await compile(CSS_SOURCE, { base: SRC, onDependency: () => {} });
  }
  const css = compiled.build(classes);
  return classes.filter((c) => !css.includes(`.${c.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`)}`));
}

test('one primary red: --color-primary is #E8311B in light and #FF4A33 in dark, with hover, subtle and fg tokens', () => {
  assert.equal(norm(resolve('--color-primary', 'light')), norm('#E8311B'));
  assert.equal(norm(resolve('--color-primary', 'dark')), norm('#FF4A33'));
  assert.equal(norm(resolve('--color-primary-fg', 'light')), norm('#FFFFFF'));
  for (const t of ['--color-primary-hover', '--color-primary-subtle', '--color-primary-fg']) {
    for (const mode of ['light', 'dark']) assert.ok(resolve(t, mode) && !resolve(t, mode).includes('<missing'), `${t} is defined in ${mode}`);
  }
  assert.notEqual(norm(resolve('--color-primary-subtle', 'light')), norm(resolve('--color-primary-subtle', 'dark')), 'primary-subtle has its own dark value');
});

test('F13: db-red and db-red-solid are aliases of the one primary, so the 155 + 61 uses render one red', () => {
  for (const mode of ['light', 'dark']) {
    same('--color-db-red', '--color-primary', mode);
    same('--color-db-red-solid', '--color-primary', mode);
    same('--color-db-red-hover', '--color-primary-hover', mode);
    same('--color-db-red-solid-hover', '--color-primary-hover', mode);
  }
});

test('status tokens: success, warning, danger, info and neutral each have a base, -bg and -fg, and dark mode has its own hues', () => {
  for (const s of ['success', 'warning', 'danger', 'info', 'neutral']) {
    for (const suffix of ['', '-bg', '-fg']) {
      const t = `--color-${s}${suffix}`;
      for (const mode of ['light', 'dark']) assert.ok(resolve(t, mode) && !resolve(t, mode).includes('<missing'), `${t} is defined in ${mode}`);
    }
    assert.notEqual(norm(resolve(`--color-${s}-fg`, 'light')), norm(resolve(`--color-${s}-fg`, 'dark')), `${s}-fg differs in dark mode`);
    assert.notEqual(norm(resolve(`--color-${s}-bg`, 'light')), norm(resolve(`--color-${s}-bg`, 'dark')), `${s}-bg differs in dark mode`);
  }
});

test('F11/F12: ok is an alias of success and error an alias of danger, so the value wizard\'s classes get a colour with no churn', async () => {
  for (const mode of ['light', 'dark']) {
    for (const suffix of ['', '-bg', '-fg']) {
      same(`--color-ok${suffix}`, `--color-success${suffix}`, mode);
      same(`--color-error${suffix}`, `--color-danger${suffix}`, mode);
    }
  }
  const missing = await builds(['bg-ok', 'bg-ok-bg', 'text-ok', 'text-ok-fg', 'border-ok', 'border-ok/30', 'text-danger', 'bg-danger-bg', 'text-danger-fg',
    'bg-primary', 'hover:bg-primary-hover', 'bg-primary-subtle', 'text-primary-fg', 'bg-neutral-bg', 'text-neutral-fg']);
  assert.deepEqual(missing, [], 'these classes compile to CSS');
});

test('type scale: caption 12/16 up to display 40/48; nothing smaller than 12px', async () => {
  const SCALE = { caption: [12, 16], 'body-sm': [13, 20], body: [14, 22], 'title-sm': [16, 24], title: [18, 26], h2: [22, 30], h1: [28, 36], display: [40, 48] };
  for (const [name, [size, lh]] of Object.entries(SCALE)) {
    assert.equal(norm(resolve(`--text-${name}`, 'light')), norm(`${size}px`), `--text-${name} is ${size}px`);
    assert.equal(norm(resolve(`--text-${name}--line-height`, 'light')), norm(`${lh}px`), `--text-${name}--line-height is ${lh}px`);
  }
  assert.deepEqual(await builds(Object.keys(SCALE).map((n) => `text-${n}`)), []);
});

test('radius sm 6 / md 10 / lg 14, elevation e1-e3, z-index nav 30 / drawer 40 / overlay 50 / dialog 51 / toast 60, page widths 1200 and 720', async () => {
  for (const [t, v] of [['--radius-sm', '6px'], ['--radius-md', '10px'], ['--radius-lg', '14px'],
    ['--z-index-nav', '30'], ['--z-index-drawer', '40'], ['--z-index-overlay', '50'], ['--z-index-dialog', '51'], ['--z-index-toast', '60'],
    ['--w-page', '1200px'], ['--w-narrow', '720px']]) {
    assert.equal(norm(resolve(t, 'light')), norm(v), `${t} is ${v}`);
  }
  for (const e of ['--shadow-e1', '--shadow-e2', '--shadow-e3']) assert.ok(resolve(e, 'light'), `${e} is defined`);
  assert.deepEqual(await builds(['rounded-sm', 'rounded-md', 'rounded-lg', 'shadow-e1', 'shadow-e2', 'shadow-e3', 'z-nav', 'z-drawer', 'z-overlay', 'z-dialog', 'z-toast',
    'max-w-(--w-page)', 'max-w-(--w-narrow)']), []);
});

test('motion: fast 120 / base 200 / slow 280 ms with the Calm Console easings, and reduced motion turns every duration to 0', () => {
  for (const [t, v] of [['--dur-fast', '120ms'], ['--dur-base', '200ms'], ['--dur-slow', '280ms'],
    ['--ease-out', 'cubic-bezier(.16,1,.3,1)'], ['--ease-in', 'cubic-bezier(.4,0,1,1)']]) {
    assert.equal(norm(resolve(t, 'light')), norm(v), `${t} is ${v}`);
  }
  for (const t of ['--dur-fast', '--dur-base', '--dur-slow']) {
    assert.ok(['0ms', '0s', '0'].includes(norm(REDUCED[t])), `prefers-reduced-motion sets ${t} to 0 (got ${REDUCED[t]})`);
  }
});
