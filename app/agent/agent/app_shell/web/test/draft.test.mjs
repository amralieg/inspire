import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { CONTRACT, DECIDE, TABLE, appInfo, openApp, serveDist, tracked } from './harness.mjs';
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
  const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { hash: '#/n01_u05/work', routes, ...options });
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
  assert.deepEqual(await drawer.locator('.panel-f > button').allInnerTexts(), ['Mark done', 'Not an issue', 'Could not fix', 'Snooze…', 'Draft Message to Someone', 'Ask Genie to fix']);
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
  assert.equal(await dialog.locator('[data-draft-error]').innerText(), 'The message could not be drafted: the SQL warehouse is stopped');
  assert.equal(await dialog.getByRole('button', { name: 'Copy' }).isDisabled(), true);
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
  const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { routes, hash: '#/n01_u05/work' });
  const boxes = page.locator('.card--table tbody .pick-l input:not([disabled])');
  await boxes.first().waitFor();
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  const bar = page.locator('.bulk');
  await bar.getByRole('button', { name: 'Draft one message…' }).click();
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
  const over = bar.getByRole('button', { name: 'Draft one message…' });
  assert.equal(await over.isDisabled(), true);
  assert.equal(await over.getAttribute('title'), 'One message covers at most 10 records: select fewer to draft one');
  assert.deepEqual(calls.acts, []);
  assert.deepEqual(seen.errors, []);
  await context.close();
  const plain = await openApp(browser, served.base, appInfo({}, 1, TABLE), { routes: tracked().routes, hash: '#/n01_u05/work' });
  await plain.page.locator('.cell-t').first().click();
  await plain.page.locator('dialog.drawer[open]').waitFor();
  assert.equal(await plain.page.getByRole('button', { name: 'Draft Message to Someone' }).count(), 0, 'a row with no action to take has no message to draft');
  await plain.context.close();
});
