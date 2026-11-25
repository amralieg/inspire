// REQ-508 item 22 (Amr, 11-23 12:59: "smooth pages transition"): route changes (req508L2HeaderMotion F27), tab panels (tab-panel-enter) and
// dialogs (dialog-enter) already move. What still jumps with no motion at 0289c7e85:
//   X1 the Review reader (ReviewReader.jsx:13-14, a fixed <aside> with no drawer-enter), it pops in;
//   X2 the steps of the Calculate value wizard (CalculateValueDialog.jsx:250-267 swaps the step body with no enter motion);
//   X3 the pages of the Generate docs wizard (GenerateDocsDialog.jsx:92 swaps [data-docs-page] with no enter motion).
// Contract: each of these fires a CSS animation (an animationstart event) on the newly shown panel or its wrapper, at least 120 ms long
// (--dur-fast), using the existing motion tokens. Reduced motion is handled by index.css's prefers-reduced-motion block (must-keep, F27 rule 6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser } from './uiSupport.mjs';
import { openCard, openWizard } from './valueWizardSupport.mjs';
import { mountReq507 } from './req507Support.mjs';
import { openReview } from './req512Support.mjs';

test.after(closeBrowser);

// Records every animation that starts on an element holding `selector` (or being it), with its computed duration in ms.
const watch = (page, selector) => page.evaluate((sel) => {
  window.__enter = [];
  document.addEventListener('animationstart', (e) => {
    const t = e.target;
    if (!(t instanceof Element) || !(t.matches(sel) || t.querySelector(sel))) return;
    const ms = parseFloat(getComputedStyle(t).animationDuration) * (getComputedStyle(t).animationDuration.endsWith('ms') ? 1 : 1000);
    window.__enter.push({ name: e.animationName, ms, tag: t.tagName.toLowerCase(), attrs: [...t.attributes].map((a) => a.name).filter((n) => n.startsWith('data-')).join(',') });
  }, true);
}, selector);
const seen = (page) => page.evaluate(() => window.__enter);
const moved = (list) => list.some((a) => a.ms >= 120);

test('X0 (must-keep, proves the probe): opening the Generate docs dialog is seen as its dialog-enter animation', async () => {
  const { ui, page, row } = await openReview();
  try {
    await watch(page, '[role="dialog"]');
    await row('N01-U02').getByRole('checkbox').first().check();
    await page.getByRole('toolbar', { name: 'Actions for the selected use cases' }).getByRole('button', { name: /^Generate docs for 1/ }).click();
    await page.getByRole('dialog', { name: 'Generate documents' }).waitFor({ timeout: 10000 });
    await page.waitForTimeout(400);
    const a = await seen(page);
    assert.ok(a.some((x) => x.name === 'dialogEnter' && x.ms >= 120), `dialogEnter is seen, saw ${JSON.stringify(a)}`);
  } finally { await ui.close(); }
});

test('X1: the Review reader slides in when a row opens it', async () => {
  const { ui, page, list } = await openReview();
  try {
    await watch(page, '[data-review-reader]');
    await list.locator('[data-use-case-row]').first().locator('[data-row-name]').click();
    await page.locator('[data-review-reader]').waitFor({ timeout: 10000 });
    await page.waitForTimeout(400);
    const a = await seen(page);
    assert.ok(moved(a), `the reader enters with a 120 ms+ animation, saw ${JSON.stringify(a)}`);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('X2: each step of the Calculate value wizard enters with motion', async () => {
  const { ui, card, page } = await openCard(mountReq507());
  try {
    const dialog = await openWizard(page, card);
    const step = dialog.locator('[data-wizard-page]').first();
    await step.waitFor({ timeout: 15000 });
    const from = await step.getAttribute('data-wizard-page');
    await watch(page, '[data-wizard-page]');
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await page.waitForFunction((f) => {
      const p = document.querySelector('[role="dialog"] [data-wizard-page]');
      return p && p.getAttribute('data-wizard-page') !== f;
    }, from, { timeout: 15000 });
    await page.waitForTimeout(400);
    const a = await seen(page);
    assert.ok(moved(a), `the next step (${from} -> next) enters with a 120 ms+ animation, saw ${JSON.stringify(a)}`);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('X3: each page of the Generate docs wizard enters with motion', async () => {
  const { ui, page, row } = await openReview();
  try {
    await row('N01-U02').getByRole('checkbox').first().check();
    const bar = page.getByRole('toolbar', { name: 'Actions for the selected use cases' });
    await bar.getByRole('button', { name: /^Generate docs for 1/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Generate documents' });
    await dialog.locator('[data-docs-page="documents"]').waitFor({ timeout: 10000 });
    await page.waitForTimeout(400);
    await watch(page, '[data-docs-page]');
    await dialog.getByRole('button', { name: /^Next/ }).click();
    await dialog.locator('[data-docs-page="layout"]').waitFor({ timeout: 10000 });
    await page.waitForTimeout(400);
    const a = await seen(page);
    assert.ok(moved(a), `the Layout page enters with a 120 ms+ animation, saw ${JSON.stringify(a)}`);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});
