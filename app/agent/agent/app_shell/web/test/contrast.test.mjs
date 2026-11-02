import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HUES, SERIES_TOKENS, TIER_TOKENS, themeTokens } from '../src/tokens.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const PALETTES = JSON.parse(readFileSync(join(SRC, 'palettes.json'), 'utf8'));
const LOOKS = readFileSync(join(SRC, 'styles', 'looks.css'), 'utf8');
const SHELL = readFileSync(join(SRC, 'styles', 'shell.css'), 'utf8');
const APP = readFileSync(join(SRC, 'styles', 'app.css'), 'utf8');
const CHROME = readFileSync(join(SRC, 'styles', 'chrome.css'), 'utf8');
const TEXT = 4.5;
const UI = 3;

function rgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

function luminance(hex) {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const mix = (a, b, share) => `#${rgb(a).map((x, i) => Math.round(x * share + rgb(b)[i] * (1 - share)).toString(16).padStart(2, '0')).join('')}`;

function pairs(t) {
  const out = [];
  const text = (fg, bg, where) => out.push({ kind: 'text', need: TEXT, fg, bg, where });
  const ui = (fg, bg, where) => out.push({ kind: 'ui', need: UI, fg, bg, where });
  const tint = mix(t.muted, t.ink, 0.6);
  const good = mix(t['green-ink'], t.ink, 0.7);
  const bad = mix(t.danger, t.ink, 0.7);
  for (const s of ['bg', 'card', 'well', 'panel', 'brand-wash']) text(t.ink, t[s], `ink on ${s}`);
  for (const s of ['bg', 'card', 'well', 'panel']) text(t.muted, t[s], `muted on ${s}`);
  for (const s of ['bg', 'card', 'well', 'panel', 'brand-wash']) text(t['brand-ink'], t[s], `brand-ink on ${s}`);
  for (const s of ['bg', 'card', 'danger-bg']) text(t.danger, t[s], `danger on ${s}`);
  for (const s of ['bg', 'card', 'green-bg']) text(t['green-ink'], t[s], `green-ink on ${s}`);
  for (const s of ['brand-wash', 'panel', 'well']) text(tint, t[s], `look b muted on ${s}`);
  text(t['btn-fg'], t['btn-bg'], 'button text on its fill');
  text(t.card, t.ink, 'toast text');
  text(t.card, t.danger, 'error toast and danger button text');
  for (const h of HUES) {
    for (const s of [`${h}-bg`, `${h}-tile`, 'bg', 'card', 'well']) text(t[`${h}-ink`], t[s], `${h}-ink on ${s}`);
    text(t.ink, t[`${h}-bg`], `ink on ${h}-bg`);
    text(tint, t[`${h}-bg`], `look b muted on ${h}-bg`);
    text(good, t[`${h}-bg`], `look b good delta and story on ${h}-bg`);
    text(bad, t[`${h}-bg`], `look b bad delta and story on ${h}-bg`);
  }
  for (const s of ['card', 'well']) {
    for (const token of SERIES_TOKENS) ui(t[token], t[s], `chart series ${token} on ${s}`);
    for (const [tier, token] of Object.entries(TIER_TOKENS)) ui(t[token], t[s], `chart tier ${tier} (${token}) on ${s}`);
  }
  for (const s of ['bg', 'card', 'well']) {
    ui(t['btn-bg'], t[s], `primary button fill on ${s}`);
    ui(t.brand, t[s], `focus ring on ${s}`);
  }
  for (const s of ['bg', 'card', 'well', 'panel']) ui(t.faint, t[s], `form field border on ${s}`);
  for (const s of ['bg', 'card', 'panel']) {
    ui(t.faint, t[s], `Genie resize grip edge on ${s}`);
    ui(t['btn-bg'], t[s], `Genie resize grip on hover and focus on ${s}`);
    ui(t.brand, t[s], `Genie resize edge line on ${s}`);
  }
  ui(t.muted, t.card, 'Genie resize grip dots');
  ui(t['btn-fg'], t['btn-bg'], 'Genie resize grip dots on hover and focus');
  return out;
}

const THEMES = ['light', 'dark'];
const ORDER = [...readFileSync(join(SRC, 'theme.js'), 'utf8').match(/PALETTE_ORDER = \[([^\]]+)\]/)[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);

export function contrastProblems(palettes, checked = []) {
  const problems = [];
  for (const [name, themes] of Object.entries(palettes)) {
    for (const theme of THEMES) {
      if (!themes[theme]?.base || !themes[theme]?.hues) {
        problems.push(`${name} ${theme}: the palette has no ${theme} colors`);
        continue;
      }
      checked.push(`${name} ${theme}`);
      const t = themeTokens(palettes, name, theme);
      for (const p of pairs(t)) {
        const r = ratio(p.fg, p.bg);
        if (r < p.need) problems.push(`${name} ${theme}: ${p.where} is ${r.toFixed(2)}:1 (${p.fg} on ${p.bg}), needs ${p.need}:1`);
      }
    }
  }
  return problems;
}

test('every palette in light and dark meets WCAG AA for text, charts and controls', () => {
  assert.equal(Object.keys(PALETTES).length, 13);
  assert.deepEqual([...ORDER].sort(), Object.keys(PALETTES).sort(), 'the palette menu offers exactly the palettes the gate checks');
  const checked = [];
  assert.deepEqual(contrastProblems(PALETTES, checked), []);
  assert.deepEqual(checked, Object.keys(PALETTES).flatMap((name) => THEMES.map((theme) => `${name} ${theme}`)));
  assert.equal(checked.length, 26);
});

test('the gate fails a palette that lacks its light or dark colors instead of skipping it', () => {
  const { dark: _dark, ...lightOnly } = PALETTES.berry;
  const checked = [];
  assert.deepEqual(contrastProblems({ berry: lightOnly, solid: { dark: PALETTES.solid.dark } }, checked),
    ['berry dark: the palette has no dark colors', 'solid light: the palette has no light colors']);
  assert.deepEqual(checked, ['berry light', 'solid dark']);
});

test('the gate fails a palette whose colours do not contrast', () => {
  const broken = structuredClone({ default: PALETTES.default });
  broken.default.light.base.muted = '#b8bec6';
  broken.default.light.hues.violet.line = '#d9cdee';
  broken.default.dark.base.danger = '#7a1f1a';
  broken.default.light.base.faint = '#cfd5dc';
  const problems = contrastProblems(broken);
  assert.ok(problems.some((p) => p.startsWith('default light: muted on card is ')), problems.join('\n'));
  assert.ok(problems.some((p) => p.startsWith('default light: chart series violet-line on card')), problems.join('\n'));
  assert.ok(problems.some((p) => p.startsWith('default dark: danger on card')), problems.join('\n'));
  assert.ok(problems.some((p) => p.startsWith('default light: form field border on bg')), problems.join('\n'));
  assert.ok(problems.every((p) => p.startsWith('default ')));
});

test('the ratio matches the WCAG reference values', () => {
  assert.equal(ratio('#000000', '#ffffff').toFixed(2), '21.00');
  assert.equal(ratio('#777777', '#ffffff').toFixed(2), '4.48');
  assert.equal(ratio('#fff', '#fff'), 1);
});

test('the gate reads the colours the styles really use', () => {
  assert.match(LOOKS, /--muted-tint:color-mix\(in srgb,var\(--muted\) 60%,var\(--ink\)\)/);
  assert.match(LOOKS, /--good-tint:color-mix\(in srgb,var\(--green-ink\) 70%,var\(--ink\)\)/);
  assert.match(LOOKS, /--bad-tint:color-mix\(in srgb,var\(--danger\) 70%,var\(--ink\)\)/);
  assert.ok(LOOKS.includes('html[data-look="b"] .kpi .delta.is-good,html[data-look="b"] .story .good{color:var(--good-tint)}'));
  assert.ok(LOOKS.includes('html[data-look="b"] .kpi .delta.is-bad,html[data-look="b"] .story .up{color:var(--bad-tint)}'));
  assert.match(APP, /\.toast--error\{background:var\(--danger\);color:var\(--card\)\}/);
  for (const field of ['.fld select,.fld input,.msel{', '.search{', '.pager select{', '.g-in input{', '.in input,.in select,.in textarea{', '.ask{']) {
    const rule = SHELL.slice(SHELL.indexOf(field), SHELL.indexOf('}', SHELL.indexOf(field)));
    assert.ok(SHELL.includes(field), field);
    assert.match(rule, /border:1px solid var\(--faint\)/, field);
  }
  assert.doesNotMatch(SHELL + APP + LOOKS, /color:#fff\b/);
});

test('the Genie resize grip draws with the colours the gate checks, at rest and on hover and focus', () => {
  const rule = (selector) => {
    const at = CHROME.indexOf(`${selector}{`);
    assert.ok(at >= 0, selector);
    return CHROME.slice(at, CHROME.indexOf('}', at));
  };
  const rest = rule('.g-grip');
  assert.match(rest, /border:1px solid var\(--faint\)/);
  assert.match(rest, /background:radial-gradient\(circle,var\(--muted\) [^)]*\) [^,]*,var\(--card\)/);
  const active = rule('.g-resize:hover .g-grip,.g-resize:focus-visible .g-grip,.g-resize.is-dragging .g-grip');
  assert.match(active, /border-color:var\(--btn-bg\)/);
  assert.match(active, /background:radial-gradient\(circle,var\(--btn-fg\) [^)]*\) [^,]*,var\(--btn-bg\)/);
  assert.match(rule('.g-resize:hover::before,.g-resize:focus-visible::before,.g-resize.is-dragging::before'), /background:var\(--brand\)/);
  assert.doesNotMatch(CHROME, /#[0-9a-f]{3,6}\b/i, 'the Genie window styles use theme tokens only');
});
