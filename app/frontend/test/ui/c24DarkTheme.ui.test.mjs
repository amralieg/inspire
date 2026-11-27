// c24 REQ-548 (Amr: "the dark theme is too dark, can you make like omnigent theme here?"): neutral dark-grey backdrop, no purple tint.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_SESSIONS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const lum = ([r, g, b]) => { const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

// Resolve CSS colours of any syntax to rgb through a canvas pixel.
async function readTheme(page, dark) {
  await page.evaluate((d) => document.documentElement.classList.toggle('dark', d), dark);
  await page.waitForTimeout(500); // body background-color transitions 0.25s
  return page.evaluate((isDark) => {
    document.documentElement.classList.toggle('dark', isDark);
    const cs = getComputedStyle(document.documentElement);
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const rgb = (css) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
    const v = (n) => rgb(cs.getPropertyValue(n).trim());
    return { body: rgb(getComputedStyle(document.body).backgroundColor), bg: v('--t-bg'), surface: v('--t-surface'), border: v('--t-border'), primary: v('--t-text-primary'), secondary: v('--t-text-secondary'), accent: cs.getPropertyValue('--t-primary').trim() };
  }, dark);
}

test('dark backdrop is the measured Omnigent violet-black, surfaces lighter, borders lighter still, AA text; light unchanged', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, sessions: REVIEW_SESSIONS, results: REVIEW_RESULTS }, '');
  try {
    const light = await readTheme(ui.page, false);
    const dark = await readTheme(ui.page, true);
    const OMNIGENT_BG = [15, 12, 25]; // #0f0c19, measured from the Omnigent window (c25_theme_omnigent.md)
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(dark.body[i] - OMNIGENT_BG[i]) <= 3, `body ${dark.body} within 3 of Omnigent ${OMNIGENT_BG}`);
    assert.deepEqual(dark.body, dark.bg);
    assert.ok(lum(dark.surface) > lum(dark.bg), `surface ${dark.surface} lighter than ${dark.bg}`);
    assert.ok(lum(dark.border) > lum(dark.surface), `border ${dark.border} lighter than surface ${dark.surface}`);
    assert.ok(ratio(dark.primary, dark.surface) >= 4.5, 'primary text on surface');
    assert.ok(ratio(dark.secondary, dark.surface) >= 4.5, 'secondary text on surface');
    assert.equal(dark.accent, '#FF4A33');
    assert.deepEqual(light.bg, [247, 247, 248]);
    assert.deepEqual(light.body, light.bg);
    assert.ok(lum(light.bg) > 0.9, 'light backdrop still light');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});
