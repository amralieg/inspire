// REQ-520 (owner, 11-25: "that wide screen pages ... is very ugly, I want art director review of all [Inspire] pages"): the MVP App
// that Inspire generates, measured with getBoundingClientRect on every section at 1920x1080 and 2560x1440, with a 1280x800 must-keep.
//   Column  .page stays a centred 1320 px column (shell.css .page), content inset by its 24 px padding.
//   Top bar the first item of .top starts at the column's content edge and the last one ends at it (+-2 px), so logo and avatar
//           frame the page instead of sitting 300-620 px outside it.
//   Mission the "Your mission" card (.welcome) starts at the same content edge as the page title.
//   Lines   no rendered line of text in .main is longer than 85 ch (Range.getClientRects against the font's "0" width), and no text
//           sits outside the column (the value footer today runs edge to edge).
//   Genie   in the full Genie view the question box is at most 960 px wide and centred, and the suggestions start at its left edge.
// Must-keep at 1280: no horizontal scroll and the column fills the viewport (1280 px), as today.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, TABLE, appInfo, openApp, serveDist } from './harness.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const COLUMN = 1320;
const PROSE_CH = 85;
const GENIE_BOX = 960;
const SECTIONS = ['dashboard', 'work', 'plan', 'performance', 'runs', 'alerts', 'settings'];
const PAGES = [['home', '', true], ...SECTIONS.map((s) => [s, `#/n01_u05/${s}`, false]), ['admin', '#/admin', true]];
const ADMIN = { 'admin/usage': ({ json }) => json(200, { users: [], pages: [], errors: {} }) };

const open = (hash, many, width, height) => openApp(browser, served.base, many ? appInfo(DECIDE, 3, TABLE) : appInfo(DECIDE),
  { hash, width, height, ready: '[data-ready]', routes: ADMIN });

const facts = (page) => page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && el.checkVisibility({ visibilityProperty: true }); };
  const col = document.querySelector('.main .page');
  const out = { vw, scrollW: document.documentElement.scrollWidth };
  if (!col) return { ...out, error: 'no .page column' };
  const cr = col.getBoundingClientRect();
  const cs = getComputedStyle(col);
  out.column = { l: Math.round(cr.left), r: Math.round(vw - cr.right), w: Math.round(cr.width) };
  out.content = { l: Math.round(cr.left + parseFloat(cs.paddingLeft)), r: Math.round(vw - cr.right + parseFloat(cs.paddingRight)) };
  const kids = [...(document.querySelector('header.top')?.children || [])].filter(shown).map((k) => k.getBoundingClientRect());
  out.top = kids.length ? { l: Math.round(Math.min(...kids.map((k) => k.left))), r: Math.round(vw - Math.max(...kids.map((k) => k.right))) } : null;
  const title = document.querySelector('.main .page h1');
  const welcome = document.querySelector('.main .welcome');
  out.title = title && shown(title) ? Math.round(title.getBoundingClientRect().left) : null;
  out.welcome = welcome && shown(welcome) ? Math.round(welcome.getBoundingClientRect().left) : null;
  const ctx = document.createElement('canvas').getContext('2d');
  out.long = [];
  out.outside = [];
  const walker = document.createTreeWalker(document.querySelector('.main'), NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (n.textContent.trim().length < 60 || !shown(el) || el.closest('input, textarea, pre, code, table, [role="dialog"], .toast')) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const rects = [...range.getClientRects()];
    ctx.font = getComputedStyle(el).font;
    const ch = Math.round(Math.max(...rects.map((q) => q.width)) / ctx.measureText('0').width);
    if (ch > 85) out.long.push(`${ch}ch "${n.textContent.trim().slice(0, 40)}"`);
    const left = Math.min(...rects.map((q) => q.left));
    const right = Math.max(...rects.map((q) => q.right));
    if (left < cr.left - 2 || right > cr.right + 2) out.outside.push(`"${n.textContent.trim().slice(0, 40)}" spans ${Math.round(left)}-${Math.round(right)}px`);
  }
  out.long = out.long.slice(0, 5);
  out.outside = out.outside.slice(0, 5);
  return out;
});

function judge(name, w, f, { keep }) {
  assert.ok(!f.error, `${name} @${w}: ${f.error}`);
  const problems = [];
  if (f.scrollW > f.vw) problems.push(`horizontal scroll: ${f.scrollW}px in ${f.vw}px`);
  if (Math.abs(f.column.l - f.column.r) > 2) problems.push(`column off centre: ${f.column.l}px / ${f.column.r}px`);
  if (keep) {
    if (f.column.w < Math.min(COLUMN, f.vw) - 2) problems.push(`must-keep: column ${f.column.w}px, expected ${Math.min(COLUMN, f.vw)}px`);
    assert.deepEqual(problems, [], `${name} @${w}px (must-keep):\n  ${problems.join('\n  ')}`);
    return;
  }
  if (f.column.w > COLUMN + 2) problems.push(`column ${f.column.w}px, cap ${COLUMN}px`);
  if (!f.top) problems.push('no top bar');
  else {
    if (Math.abs(f.top.l - f.content.l) > 2) problems.push(`top bar starts at ${f.top.l}px, the page content at ${f.content.l}px`);
    if (Math.abs(f.top.r - f.content.r) > 2) problems.push(`top bar ends ${f.top.r}px from the right, the page content ${f.content.r}px`);
  }
  if (f.welcome !== null && f.title !== null && Math.abs(f.welcome - f.title) > 2) problems.push(`mission card starts at ${f.welcome}px, the page title at ${f.title}px`);
  for (const l of f.long) problems.push(`line longer than ${PROSE_CH}ch: ${l}`);
  for (const o of f.outside) problems.push(`text outside the column: ${o}`);
  assert.deepEqual(problems, [], `${name} @${w}px:\n  ${problems.join('\n  ')}`);
}

for (const [w, h] of [[1280, 800], [1920, 1080], [2560, 1440]]) {
  for (const [name, hash, many] of PAGES) {
    test(`REQ-520 MVP ${name} @${w}x${h}: centred column, top bar on the column edge, short lines`, async () => {
      const { page, context, seen } = await open(hash, many, w, h);
      try {
        await page.waitForTimeout(800);
        judge(name, w, await facts(page), { keep: w === 1280 });
        assert.deepEqual(seen.errors, []);
      } finally {
        await context.close();
      }
    });
  }

  test(`REQ-520 MVP Genie @${w}x${h}: the question box is at most ${GENIE_BOX}px and centred, suggestions start at its edge`, async () => {
    const { page, context } = await open('#/n01_u05/genie', false, w, h);
    try {
      await page.waitForSelector('aside.genie form.g-in input');
      const g = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const box = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(vw - r.right), w: Math.round(r.width) }; };
        return { vw, scrollW: document.documentElement.scrollWidth, form: box('aside.genie form.g-in'), sugg: box('aside.genie .g-sugg .sugg') };
      });
      const problems = [];
      if (g.scrollW > g.vw) problems.push(`horizontal scroll: ${g.scrollW}px in ${g.vw}px`);
      if (w > 1280) {
        if (g.form.w > GENIE_BOX + 2) problems.push(`question box ${g.form.w}px, cap ${GENIE_BOX}px`);
        if (Math.abs(g.form.l - g.form.r) > 2) problems.push(`question box off centre: ${g.form.l}px / ${g.form.r}px`);
        if (g.sugg && Math.abs(g.sugg.l - g.form.l) > 16 + 2) problems.push(`first suggestion starts at ${g.sugg.l}px, the question box at ${g.form.l}px`);
      }
      assert.deepEqual(problems, [], `Genie @${w}px:\n  ${problems.join('\n  ')}`);
    } finally {
      await context.close();
    }
  });
}
