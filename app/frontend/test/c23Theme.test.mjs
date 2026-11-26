import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(HERE, '..', 'src', 'index.css'), 'utf8');
const PALETTES = JSON.parse(readFileSync(join(HERE, '..', '..', 'agent', 'agent', 'app_shell', 'web', 'src', 'palettes.json'), 'utf8'));

const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (h) => { const [r, g, b] = rgb(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

function darkBlock() {
  const blocks = [...CSS.matchAll(/\.dark \{([^}]*)\}/g)].map((m) => m[1]);
  const b = blocks.find((x) => x.includes('--t-bg:'));
  assert.ok(b, 'index.css has a .dark block with --t-bg');
  const tokens = {};
  for (const m of b.matchAll(/--([\w-]+):\s*([^;]+);/g)) tokens[m[1]] = m[2].trim();
  return tokens;
}

const TARGET = {
  't-bg': '#0e0b19',
  't-surface': '#181f25',
  't-bg-subtle': '#1f272d',
  't-panel': '#1a2129',
  't-border': 'oklch(28% .005 240)',
  't-input-bg': '#ffffff26',
};

test('app dark surface tokens equal the Omnigent dark values', () => {
  const t = darkBlock();
  for (const [k, v] of Object.entries(TARGET)) assert.equal(t[k], v, k);
});

test('app dark surfaces carry the soft Omnigent gradient', () => {
  assert.match(CSS, /\.dark body\s*\{[^}]*linear-gradient\(transparent 35%, #ffffff0f\)[^}]*linear-gradient\(135deg, #ffffff0a, transparent 60%\)/);
});

test('app dark body and secondary text meet AA on every solid surface', () => {
  const t = darkBlock();
  for (const s of ['t-bg', 't-surface', 't-bg-subtle', 't-panel']) {
    for (const f of ['t-text-primary', 't-text-secondary', 't-text-tertiary']) {
      const r = ratio(t[f].toUpperCase(), t[s]);
      assert.ok(r >= 4.5, `${f} on ${s} is ${r.toFixed(2)}:1`);
    }
  }
});

test('shell dark palettes use the Omnigent surfaces and keep AA text', () => {
  for (const [name, p] of Object.entries(PALETTES)) {
    const b = p.dark.base;
    assert.equal(b.bg, '#0e0b19', `${name} bg`);
    if (name === 'mono') continue;
    assert.equal(b.card, '#181f25', `${name} card`);
    assert.equal(b.well, '#1f272d', `${name} well`);
    assert.equal(b.panel, '#1a2129', `${name} panel`);
    assert.equal(b.line, '#27292b', `${name} line`);
    for (const s of ['bg', 'card', 'well', 'panel']) {
      for (const f of ['ink', 'muted']) {
        const r = ratio(b[f], b[s]);
        assert.ok(r >= 4.5, `${name} ${f} on ${s} is ${r.toFixed(2)}:1`);
      }
    }
  }
});
