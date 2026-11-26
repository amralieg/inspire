import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(HERE, '..', 'src', 'index.css'), 'utf8');
const PALETTES = JSON.parse(readFileSync(join(HERE, '..', '..', 'agent', 'agent', 'app_shell', 'web', 'src', 'palettes.json'), 'utf8'));

// Source: pixels sampled from the running Omnigent window, 26 Nov 2026
// (screencapture -l, see results/c25_theme_omnigent.md). Token name -> measured hex.
const OMNIGENT = {
  't-bg': '#0f0c19',            // main page background
  't-panel': '#13101d',         // sidebar / side panel
  't-surface': '#1a1724',       // composer and raised cards
  't-border': '#27292b',        // card and table border
  't-text-primary': '#f5f5f4',  // body text
  't-text-secondary': '#908f95',// secondary text ("Ran 1 shell command")
};
// Same measurement mapped to the generated-App shell palette keys.
const SHELL = { bg: '#0f0c19', panel: '#13101d', card: '#1a1724', line: '#27292b', ink: '#f5f5f4', muted: '#908f95' };

const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function lab(h) {
  const [r, g, b] = rgb(h).map(lin);
  const xyz = [(0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, 0.2126 * r + 0.7152 * g + 0.0722 * b, (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883];
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const [fx, fy, fz] = xyz.map(f);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const deltaE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

function darkTokens() {
  const b = [...CSS.matchAll(/\.dark \{([^}]*)\}/g)].map((m) => m[1]).find((x) => x.includes('--t-bg:'));
  assert.ok(b, 'index.css has a .dark block with --t-bg');
  const t = {};
  for (const m of b.matchAll(/--([\w-]+):\s*([^;]+);/g)) t[m[1]] = m[2].trim();
  return t;
}

test('app .dark tokens are within deltaE 3 of the measured Omnigent dark theme', () => {
  const t = darkTokens();
  for (const [k, want] of Object.entries(OMNIGENT)) {
    assert.match(t[k], /^#[0-9a-fA-F]{6}$/, `${k} is a 6-digit hex`);
    const d = deltaE(t[k], want);
    assert.ok(d <= 3, `${k} ${t[k]} vs Omnigent ${want}: deltaE ${d.toFixed(1)}`);
  }
});

test('shell dark palettes are within deltaE 3 of the measured Omnigent dark theme', () => {
  for (const [name, p] of Object.entries(PALETTES)) {
    for (const [k, want] of Object.entries(SHELL)) {
      if (name === 'mono' && k !== 'bg') continue; // mono is grey by design; only its page background follows Omnigent
      if (name === 'mono' && k === 'card') continue;
      const d = deltaE(p.dark.base[k], want);
      assert.ok(d <= 3, `${name} dark ${k} ${p.dark.base[k]} vs ${want}: deltaE ${d.toFixed(1)}`);
    }
  }
});
