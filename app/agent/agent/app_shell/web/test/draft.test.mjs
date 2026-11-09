import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { CONTRACT, DECIDE, TABLE, appInfo, openApp, serveDist, tracked, footerActions } from './harness.mjs';
import { DRAFT_COPIED, DRAFT_MANUAL, DRAFT_RECORDS } from '../src/records.js';

let served;
let browser;

before(async () => {
  served = await serveDist();
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  served?.close();
});

const FIRST = CONTRACT.draft.response;
const reply = (subject, body, extra = {}) => ({ ...FIRST, subject, body, text: `Subject: ${subject}\n\n${body}`, ...extra });
const SECOND = reply('Item 1 needs a price change', 'Hi [name],\n\nItem 1 is on the price-loss desk. Could you change its price by [date]?');

function drafting(answers) {
  const asked = [];
  const route = ({ route, json }) => {
    const body = route.request().postDataJSON();
    asked.push(body);
    const next = answers[Math.min(asked.length - 1, answers.length - 1)];
    return typeof next === 'function' ? next(json, body) : json(200, next);
  };
  return { asked, route };
}

async function openDrawer(answers, options = {}) {
  const draft = drafting(answers);
  const { calls, routes } = tracked({ 'records/draft': draft.route });
  const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { routes, ...options });
  await page.locator('.cell-t').first().click();
  const drawer = page.locator('dialog.drawer');
  await drawer.locator('.dr-act').waitFor();
  return { page, seen, context, calls, draft, drawer };
}

test('a record drafts a message to copy, regenerates it, and never changes the record', async () => {
  const { page, seen, context, calls, draft, drawer } = await openDrawer([FIRST, SECOND]);
  await page.evaluate(() => {
    window.copied = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.copied.push(text); } } });
  });
  assert.deepEqual(await footerActions(drawer), ['Mark done', 'Not an issue', 'Could not fix', 'Snooze…', 'Draft Message to Someone', 'Ask Genie to fix'].sort(), 'every drawer action can be reached');
  await drawer.getByRole('button', { name: 'Draft Message to Someone' }).click();
  const dialog = page.locator('dialog[data-draft]');
  const box = dialog.locator('textarea[name="draft_message"]');
  await box.waitFor();
  assert.deepEqual(draft.asked, [{ page: 'n01_u05', record_keys: ['R001'], attempt: 0 }]);
  assert.deepEqual(Object.keys(draft.asked[0]).sort(), Object.keys(CONTRACT.draft.request.body).sort(), 'the App asks with the contract draft request');
  assert.equal(await box.inputValue(), FIRST.text);
  assert.match(await dialog.locator('header p').innerText(), /^About Item number 1 .*Nothing on the record changes/);
  assert.equal(await dialog.locator('[data-draft-note]').count(), 0);
  await dialog.getByRole('button', { name: 'Copy' }).click();
  await page.waitForFunction(() => window.copied.length === 1);
  assert.deepEqual(await page.evaluate(() => window.copied), [FIRST.text]);
  await dialog.locator('.toast.is-on').waitFor();
  assert.equal(await dialog.locator('.toast-t').innerText(), DRAFT_COPIED);
  await dialog.getByRole('button', { name: 'Regenerate' }).click();
  await page.waitForFunction((text) => document.querySelector('dialog[data-draft] textarea')?.value === text, SECOND.text);
  assert.deepEqual(draft.asked.map((b) => b.attempt), [0, 1]);
  await box.fill('Edited by me');
  await dialog.getByRole('button', { name: 'Copy' }).click();
  await page.waitForFunction(() => window.copied.length === 2);
  assert.equal(await page.evaluate(() => window.copied[1]), 'Edited by me', 'Copy takes the text as the person edited it');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog[data-draft]'));
  assert.equal(await drawer.evaluate((d) => d.open), true, 'closing the draft leaves the record open');
  assert.deepEqual(calls.acts, [], 'drafting a message records no decision');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('without a clipboard the draft is selected for the keyboard, and the old copy command is tried first', async () => {
  const { page, seen, context, drawer } = await openDrawer([FIRST]);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    window.copyAnswer = false;
    document.execCommand = (name) => { window.commanded = name; return window.copyAnswer; };
  });
  await drawer.getByRole('button', { name: 'Draft Message to Someone' }).click();
  const dialog = page.locator('dialog[data-draft]');
  await dialog.locator('textarea').waitFor();
  await dialog.getByRole('button', { name: 'Copy' }).click();
  await dialog.locator('[data-draft-manual]').waitFor();
  assert.equal(await dialog.locator('[data-draft-manual]').innerText(), DRAFT_MANUAL);
  assert.equal(await page.evaluate(() => window.commanded), 'copy');
  const selected = await page.evaluate(() => { const t = document.querySelector('dialog[data-draft] textarea'); return [t === document.activeElement, t.selectionStart, t.selectionEnd, t.value.length]; });
  assert.deepEqual(selected, [true, 0, FIRST.text.length, FIRST.text.length]);
  await page.evaluate(() => { window.copyAnswer = true; });
  await dialog.getByRole('button', { name: 'Copy' }).click();
  await dialog.locator('.toast.is-on').waitFor();
  assert.equal(await dialog.locator('.toast-t').innerText(), DRAFT_COPIED);
  assert.equal(await dialog.locator('[data-draft-manual]').count(), 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a failed draft says why and tries again, and a template draft says it was built from the record', async () => {
  const template = CONTRACT.draft.template;
  const { page, seen, context, drawer } = await openDrawer([(json) => json(502, { error: 'the SQL warehouse is stopped' }), template]);
  await drawer.getByRole('button', { name: 'Draft Message to Someone' }).click();
  const dialog = page.locator('dialog[data-draft]');
  await dialog.locator('[data-draft-error]').waitFor();
  const failed = dialog.locator('[data-draft-error]');
  assert.equal((await failed.innerText()).split('\n')[0], 'The message could not be drafted: the SQL warehouse is stopped, so start it on the SQL Warehouses page or ask its owner to, then try again.');
  assert.equal(await failed.getByRole('button', { name: 'Copy what to send' }).count(), 1);
  assert.equal(await dialog.getByRole('button', { name: 'Copy', exact: true }).isDisabled(), true);
  assert.equal(await dialog.locator('textarea').count(), 0);
  await dialog.getByRole('button', { name: 'Try again' }).click();
  await dialog.locator('textarea').waitFor();
  assert.equal(await dialog.locator('[data-draft-error]').count(), 0);
  assert.equal(await dialog.locator('[data-draft-note]').innerText(), template.note);
  assert.equal(await dialog.locator('textarea').inputValue(), template.text);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await page.waitForFunction(() => !document.querySelector('dialog[data-draft]'));
  assert.deepEqual(seen.errors.filter((e) => !/502/.test(e)), []);
  await context.close();
});

test('a selection drafts one message for up to ten records, and an informational drawer offers no draft', async () => {
  const draft = drafting([reply('Two records need action', 'Hi [name],\n\n- Item 1\n- Item 2\nCould you take these on?', { records: 2 })]);
  const { calls, routes } = tracked({ 'records/draft': draft.route });
  const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { routes });
  const boxes = page.locator('.card--table tbody .pick-l input:not([disabled])');
  await boxes.first().waitFor();
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  const bar = page.locator('.bulk');
  await bar.getByRole('button', { name: 'Draft Message to Someone' }).click();
  const dialog = page.locator('dialog[data-draft]');
  await dialog.locator('textarea').waitFor();
  assert.equal(draft.asked.length, 1);
  assert.equal(draft.asked[0].record_keys.length, 2);
  assert.match(await dialog.locator('header p').innerText(), /^One message about 2 records\./);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await page.waitForFunction(() => !document.querySelector('dialog[data-draft]'));
  await page.locator('.card--table thead .pick-c input').check();
  const picked = await page.locator('.card--table tbody .pick-l input:checked').count();
  assert.ok(picked > DRAFT_RECORDS, `the page selects ${picked} records`);
  const over = bar.getByRole('button', { name: 'Draft Message to Someone' });
  assert.equal(await over.isDisabled(), true);
  assert.equal(await over.getAttribute('title'), 'One message covers at most 10 records: select fewer to draft one');
  assert.deepEqual(calls.acts, []);
  assert.deepEqual(seen.errors, []);
  await context.close();
  const plain = await openApp(browser, served.base, appInfo({}, 1, TABLE), { routes: tracked().routes });
  await plain.page.locator('.cell-t').first().click();
  await plain.page.locator('dialog.drawer[open]').waitFor();
  assert.equal(await plain.page.getByRole('button', { name: 'Draft Message to Someone' }).count(), 0, 'a row with no action to take has no message to draft');
  await plain.context.close();
});

const fits = (locator) => locator.evaluate((b) => {
  const r = b.getBoundingClientRect();
  const texts = [...b.childNodes].filter((n) => n.nodeType === 3);
  const label = texts.map((n) => n.textContent).join('');
  const line = parseFloat(getComputedStyle(b).lineHeight) || 20;
  const range = document.createRange();
  range.setStart(texts[0], 0);
  range.setEnd(texts.at(-1), texts.at(-1).length);
  const lines = new Set([...range.getClientRects()].map((x) => Math.round(x.top))).size;
  return { label, clipped: b.scrollWidth > b.clientWidth + 1, inside: r.left >= 0 && r.right <= window.innerWidth + 0.5, lines, tall: r.height > line * 2.6 };
});

const footer = (drawer) => drawer.locator('footer.dr-f').evaluate((f) => {
  const cells = [...f.children].filter((c) => c.matches('.btn') && c.getBoundingClientRect().height > 0).map((c) => {
    const r = c.getBoundingClientRect();
    return { text: c.matches('select') ? 'select' : c.textContent.trim(), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), clipped: c.scrollWidth > c.clientWidth + 1 };
  });
  const rows = Object.values(Object.groupBy(cells, (c) => c.top)).map((row) => row.map((c) => [c.text, c.w]));
  return { rows, heights: [...new Set(cells.map((c) => c.h))], clipped: cells.filter((c) => c.clipped).map((c) => c.text), share: f.getBoundingClientRect().height / window.innerHeight, inner: f.clientWidth - parseFloat(getComputedStyle(f).paddingLeft) - parseFloat(getComputedStyle(f).paddingRight) };
});
const evenRows = (layout) => layout.rows.map((row) => row.length === 1 ? (row[0][0] === 'select' ? 'full' : 'one') : new Set(row.map(([, w]) => w)).size === 1 ? `${row.length} even` : 'uneven');

for (const [width, height] of [[390, 844], [1280, 800]]) {
  test(`the Draft Message to Someone button shows its whole label on one line in the drawer and the bulk bar at ${width}x${height}`, async () => {
    const { routes } = tracked({ 'records/draft': drafting([FIRST]).route });
    const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { routes, width, height });
    const shots = process.env.FX_BUSY_SHOTS;
    if (shots) mkdirSync(shots, { recursive: true });
    const boxes = page.locator('.card--table tbody .pick-l input:not([disabled])');
    await boxes.first().waitFor();
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    const bulk = page.locator('.bulk').getByRole('button', { name: 'Draft Message to Someone' });
    await bulk.scrollIntoViewIfNeeded();
    assert.deepEqual(await fits(bulk), { label: 'Draft Message to Someone', clipped: false, inside: true, lines: 1, tall: false });
    if (shots) await page.locator('.bulk').screenshot({ path: `${shots}/bulk_draft_${width}x${height}.png` });
    await page.locator('.bulk').getByRole('button', { name: 'Clear selection' }).click();
    await page.locator('.cell-t').first().click();
    const drawer = page.locator('dialog.drawer');
    await drawer.locator('.dr-act').waitFor();
    const button = drawer.getByRole('button', { name: 'Draft Message to Someone' });
    await button.scrollIntoViewIfNeeded();
    assert.deepEqual(await fits(button), { label: 'Draft Message to Someone', clipped: false, inside: true, lines: 1, tall: false });
    const owner = await drawer.getByRole('combobox', { name: 'Give to someone' }).evaluate((sel) => {
      const css = getComputedStyle(sel);
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
      const text = sel.options[sel.selectedIndex].text;
      const room = sel.clientWidth - parseFloat(css.paddingLeft) - Math.max(parseFloat(css.paddingRight), 24);
      return { text, shows: ctx.measureText(text).width <= room, inside: sel.getBoundingClientRect().right <= window.innerWidth + 0.5 };
    });
    assert.deepEqual(owner, { text: 'With pat.lee@example.com', shows: true, inside: true }, 'the owner menu shows the whole owner');
    if (shots) await page.screenshot({ path: `${shots}/drawer_draft_${width}x${height}.png` });
    const layout = await footer(drawer);
    const phone = await drawer.locator('footer.dr-f').evaluate((f) => f.hasAttribute('data-narrow'));
    assert.equal(phone, (await drawer.locator('footer.dr-f').evaluate((f) => f.getBoundingClientRect().width)) < 470, 'the footer folds by its own width');
    assert.equal(phone, width < 560, 'the 480px drawer folds on a phone only');
    assert.deepEqual(layout.rows.map((row) => row.map(([text]) => text)), phone
      ? [['Mark done', 'Not an issue'], ['select'], ['Could not fix', 'More'], ['Draft Message to Someone']]
      : [['Mark done', 'Not an issue'], ['select'], ['Could not fix', 'Snooze…'], ['Draft Message to Someone', 'Ask Genie to fix']], 'two to a row, the owner menu on its own row');
    assert.deepEqual(evenRows(layout), ['2 even', 'full', '2 even', phone ? 'one' : '2 even'], JSON.stringify(layout.rows));
    if (phone) {
      assert.equal(layout.rows[3][0][1], Math.round(layout.inner), 'the draft button spans the footer on a phone');
      await drawer.getByRole('button', { name: 'More', exact: true }).click();
      const open = await footer(drawer);
      assert.deepEqual(open.rows.map((row) => row.map(([text]) => text)), [['Mark done', 'Not an issue'], ['select'], ['Could not fix', 'Fewer'], ['Draft Message to Someone'], ['Snooze…', 'Ask Genie to fix']], 'More shows every action');
      assert.deepEqual(evenRows(open), ['2 even', 'full', '2 even', 'one', '2 even']);
      if (shots) await page.screenshot({ path: `${shots}/drawer_more_${width}x${height}.png` });
      await drawer.getByRole('button', { name: 'Fewer', exact: true }).click();
    }
    assert.equal(layout.rows[1][0][1], Math.round(layout.inner), 'the owner menu spans the footer');
    assert.equal(layout.heights.length, 1, `one button height: ${layout.heights}`);
    assert.deepEqual(layout.clipped, []);
    assert.ok(layout.share <= 0.25, `the footer takes ${Math.round(layout.share * 100)}% of the screen`);
    assert.deepEqual(seen.errors, []);
    await context.close();
  });
}

test('on a phone with Edit and Delete too, the drawer footer keeps four rows and More shows every action', async () => {
  const { routes } = tracked({ 'records/draft': drafting([FIRST]).route });
  const { page, seen, context } = await openApp(browser, served.base, appInfo({ ...DECIDE, options: { ...DECIDE.options, modify: true } }, 1, TABLE), { routes, width: 390, height: 844 });
  await page.locator('.cell-t').first().click();
  const drawer = page.locator('dialog.drawer');
  await drawer.locator('.dr-act').waitFor();
  const folded = await footer(drawer);
  assert.deepEqual(folded.rows.map((row) => row.map(([text]) => text)), [['Mark done', 'Not an issue'], ['select'], ['Could not fix', 'More'], ['Draft Message to Someone']]);
  assert.deepEqual(evenRows(folded), ['2 even', 'full', '2 even', 'one']);
  assert.ok(folded.share <= 0.25, `folded, the footer takes ${Math.round(folded.share * 100)}% of the screen`);
  const more = drawer.getByRole('button', { name: 'More', exact: true });
  assert.equal(await more.getAttribute('aria-expanded'), 'false');
  await more.click();
  const open = await footer(drawer);
  assert.deepEqual(open.rows.map((row) => row.map(([text]) => text)), [['Mark done', 'Not an issue'], ['select'], ['Could not fix', 'Fewer'], ['Draft Message to Someone'], ['Snooze…', 'Ask Genie to fix'], ['Delete', 'Edit']]);
  assert.deepEqual(evenRows(open), ['2 even', 'full', '2 even', 'one', '2 even', '2 even']);
  assert.equal(await drawer.getByRole('button', { name: 'Fewer', exact: true }).getAttribute('aria-expanded'), 'true');
  await drawer.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('dialog', { name: /Edit/ }).first().waitFor();
  assert.deepEqual(seen.errors, []);
  await context.close();
});
