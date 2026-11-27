// REQ-520 (owner, 11-25: "that wide screen pages in home, start, etc is very ugly, I want art director review of all [Inspire] pages").
// Art-director layout system for wide screens, measured with getBoundingClientRect on every page of the real App:
//   FRAME   1440 px content column for the header and every working page (Start, Monitor, Review, Build, Run), centred.
//   WIZARD  1040 px column for one-task forms (Launch, Generate data, Setup), centred inside the frame.
//   LANDING 1280 px column for every Home section and the Home nav, centred.
//   PROSE   no rendered line of text longer than 85 ch (measured per line with Range.getClientRects and the font's "0" width).
//   CONTROL no input, select, textarea or button wider than the WIZARD column.
//   Header  the logo starts at the frame's left edge and the last header control ends at its right edge (+-2 px).
// The column is the deepest element that holds every visible leaf of the page (text, controls, images;
// overlays (absolute or fixed), aria-hidden layers, dialogs and menus excluded). It must be no wider than its cap and centred (margins equal +-2 px).
// Must-keep: at 1280x800 there is no horizontal scroll, every column is centred, the header sits on the 24 px gutter and the frame
// pages still fill the viewport less the gutters (passes before and after the fix). Width caps, line length and controls are judged at 1920 and 2560.
// Supersedes the 1920 px half of req512WideAllPages (see the REQ-520 escalation in the art review).
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';
import { mountReview } from './req512Support.mjs';

test.after(closeBrowser);

const FRAME = 1440;
const WIZARD = 1040;
const LANDING = 1280;
const PROSE_CH = 85;
const GUTTER = 24;
const KNOWN = { ...REVIEW_STATE, knownRuns: ['42', '41', '50', '51', '60', '61'] };
const PAGES = [
  ['Start', '#/start', FRAME], ['Launch', '#/launch', WIZARD], ['Generate data', '#/generate-data', WIZARD], ['Monitor', '#/monitor/42', FRAME],
  ['Review: Use cases', '#/review/42', FRAME], ['Review: Overview', '#/review/42', FRAME, 'Overview'],
  ['Build', '#/build/42', FRAME], ['Run', '#/run', FRAME],
];
const BUTTON = 640;
const CAPS = { control: WIZARD, button: BUTTON, prose: PROSE_CH };
const SIZES = [[1280, 800], [1920, 1080], [2560, 1440]];

// Geometry of one root (main, a Home section, or the setup body), run in the page.
const measure = (page, sel, cap) => page.evaluate(({ sel, cap }) => {
  const vw = document.documentElement.clientWidth;
  const root = document.querySelector(sel);
  if (!root) return { error: `no ${sel}` };
  const skip = (el) => {
    if (el.closest('[role="dialog"], [role="menu"], [role="listbox"], [role="tooltip"], [aria-hidden="true"], [data-review-reader]')) return true;
    for (let p = el; p && p !== root; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.position === 'fixed' || cs.position === 'absolute' || cs.pointerEvents === 'none') return true;
    }
    return false;
  };
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && el.checkVisibility({ visibilityProperty: true }); };
  const CTRL = 'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select, textarea, button';
  const leaves = [...root.querySelectorAll('*')].filter((el) => {
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') return false;
    if (!shown(el) || skip(el)) return false;
    if (el.matches(CTRL) || el.matches('img, svg, canvas')) return true;
    return [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  });
  const box = (el) => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(vw - r.right), w: Math.round(r.width) }; };
  let col = leaves[0] || root;
  for (const leaf of leaves) while (!col.contains(leaf)) col = col.parentElement;
  // The column is judged by its content box, so `max-w-[1488px] px-6` and `px-6` around `max-w-[1440px]` measure the same.
  const pad = getComputedStyle(col);
  const outer = box(col);
  const pl = Math.round(parseFloat(pad.paddingLeft));
  const pr = Math.round(parseFloat(pad.paddingRight));
  const column = { l: outer.l + pl, r: outer.r + pr, w: outer.w - pl - pr, el: `${col.tagName.toLowerCase()}.${String(col.className).slice(0, 60)}` };
  // A list row (a button holding two or more text blocks) and a table column header may span the column; a field may span the wizard column; a labelled action
  // button sizes to its label (at most cap.button).
  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const isRow = (c) => c.matches('button') && [c, ...c.querySelectorAll('*')].filter((e) => ownText(e) && shown(e)).length >= 2;
  const limit = (c) => (c.matches('button') ? cap.button : cap.control);
  const wideControls = [...root.querySelectorAll(CTRL)].filter((c) => shown(c) && !skip(c) && !isRow(c) && !c.closest('th, [role="columnheader"], [aria-sort]') && c.getBoundingClientRect().width > limit(c) + 1)
    .map((c) => `${c.tagName.toLowerCase()} "${(c.getAttribute('aria-label') || c.textContent || c.placeholder || '').trim().slice(0, 30)}" ${Math.round(c.getBoundingClientRect().width)}px`);
  const ctx = document.createElement('canvas').getContext('2d');
  const longLines = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (n.textContent.trim().length < 60 || !shown(el) || skip(el) || el.closest('input, textarea, pre, code, table')) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const widest = Math.max(...[...range.getClientRects()].map((q) => q.width));
    ctx.font = getComputedStyle(el).font;
    const ch = Math.round(widest / ctx.measureText('0').width);
    if (ch > cap.prose) longLines.push(`${ch}ch "${n.textContent.trim().slice(0, 40)}"`);
  }
  return { vw, scrollW: document.documentElement.scrollWidth, column, leaves: leaves.length, wideControls: wideControls.slice(0, 5), longLines: longLines.slice(0, 5) };
}, { sel, cap });

const headerEdges = (page, sel) => page.evaluate((sel) => {
  const header = document.querySelector(sel);
  if (!header) return null;
  const vw = document.documentElement.clientWidth;
  const parts = [...header.querySelectorAll('a, button, img, svg')].filter((el) => el.checkVisibility() && el.getBoundingClientRect().width > 0 && !el.closest('svg *'));
  if (!parts.length) return null;
  return { left: Math.round(Math.min(...parts.map((p) => p.getBoundingClientRect().left))), right: Math.round(vw - Math.max(...parts.map((p) => p.getBoundingClientRect().right))) };
}, sel);

const expected = (vw, cap) => Math.min(cap, vw - 2 * GUTTER);

// keep: the 1280 px must-keep case. It passes on the current wide design and must still pass after the fix: no horizontal scroll, a
// centred column, and the frame pages filling the viewport less the gutters (the REQ-512 wide design at laptop width).
function judge(name, w, facts, cap, { fill = false, keep = false } = {}) {
  assert.ok(!facts.error, `${name} @${w}: ${facts.error}`);
  const problems = [];
  if (facts.scrollW > facts.vw) problems.push(`horizontal scroll: ${facts.scrollW}px content in a ${facts.vw}px viewport`);
  const { column } = facts;
  if (!keep && column.w > cap + 2) problems.push(`column ${column.el} is ${column.w}px wide, cap ${cap}px`);
  if (Math.abs(column.l - column.r) > 2) problems.push(`column ${column.el} is off centre: left margin ${column.l}px, right margin ${column.r}px`);
  if (fill && column.w < expected(facts.vw, cap) - 2) problems.push(`must-keep: column ${column.w}px, expected ${expected(facts.vw, cap)}px (viewport less gutters)`);
  if (keep) { assert.deepEqual(problems, [], `${name} @${w}px (must-keep):\n  ${problems.join('\n  ')}`); return; }
  for (const c of facts.wideControls) problems.push(`stretched control (field cap ${WIZARD}px, button cap ${BUTTON}px): ${c}`);
  for (const l of facts.longLines) problems.push(`line longer than ${PROSE_CH}ch: ${l}`);
  assert.deepEqual(problems, [], `${name} @${w}px:\n  ${problems.join('\n  ')}`);
}

function judgeHeader(name, w, edges, cap) {
  assert.ok(edges, `${name} @${w}: no header found`);
  const margin = Math.round((w - expected(w, cap)) / 2);
  const problems = [];
  if (Math.abs(edges.left - margin) > 2) problems.push(`header starts at ${edges.left}px, the column starts at ${margin}px`);
  if (Math.abs(edges.right - margin) > 2) problems.push(`header ends ${edges.right}px from the right, the column ends ${margin}px from it`);
  assert.deepEqual(problems, [], `${name} header @${w}px:\n  ${problems.join('\n  ')}`);
}

for (const [w, h] of SIZES) {
  for (const [name, hash, cap, tab] of PAGES) {
    test(`REQ-520 ${name} @${w}x${h}: centred ${cap}px column, aligned header, short lines, no stretched control`, async () => {
      const ui = await openUi('app', KNOWN, hash, { mount: mountReview });
      const { page } = ui;
      try {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForFunction(() => (document.querySelector('main')?.getBoundingClientRect().height || 0) > 200, null, { timeout: 20000 });
        if (tab) await page.getByRole('navigation', { name: 'Results sections' }).getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
        await page.waitForTimeout(1200);
        const facts = await measure(page, 'main', CAPS);
        judge(name, w, facts, cap, { fill: w === 1280 && cap === FRAME, keep: w === 1280 });
        judgeHeader(name, w, await headerEdges(page, 'header'), FRAME);
      } finally {
        await ui.close();
      }
    });
  }

  test(`REQ-520 Setup @${w}x${h}: the setup wizard sits in a centred ${WIZARD}px column`, async () => {
    const ui = await openUi('setup', {}, '&step=blank');
    const { page } = ui;
    try {
      await page.setViewportSize({ width: w, height: h });
      await page.getByText('Step 1 of 5').waitFor({ timeout: 20000 });
      await page.waitForTimeout(600);
      judge('Setup', w, await measure(page, 'body', CAPS), WIZARD, { keep: w === 1280 });
    } finally {
      await ui.close();
    }
  });

  test(`REQ-520 Home @${w}x${h}: every section and the nav sit in a centred ${LANDING}px column`, async () => {
    const ui = await openUi('landing');
    const { page } = ui;
    try {
      await page.setViewportSize({ width: w, height: h });
      await page.getByText('Scroll to explore').waitFor({ state: 'attached', timeout: 20000 });
      const count = await page.evaluate(() => document.querySelectorAll('.overflow-y-auto.scrollbar-hide > section').length);
      assert.ok(count >= 5, `Home has ${count} sections`);
      const failures = [];
      for (let i = 0; i < count; i += 1) {
        await page.evaluate((k) => document.querySelectorAll('.overflow-y-auto.scrollbar-hide > section')[k].scrollIntoView({ behavior: 'instant' }), i);
        await page.waitForTimeout(1400);
        await page.evaluate((k) => document.querySelectorAll('.overflow-y-auto.scrollbar-hide > section').forEach((s, j) => s.toggleAttribute('data-req520-probe', j === k)), i);
        const facts = await measure(page, '[data-req520-probe]', CAPS);
        try { judge(`Home section ${i + 1}`, w, facts, LANDING, { keep: w === 1280 }); } catch (e) { failures.push(e.message); }
      }
      try { judgeHeader('Home', w, await headerEdges(page, 'nav'), LANDING); } catch (e) { failures.push(e.message); }
      assert.deepEqual(failures, []);
    } finally {
      await ui.close();
    }
  });
}
