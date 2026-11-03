import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { TABLE, appInfo, chartsDrawn, openApp, serveDist, toastSays, until } from './harness.mjs';
import { LINK_STALE, UNKNOWN_PAGE, VIEWS_KEY, VIEW_STALE, decodeFilters, encodeFilters, parseHash } from '../src/links.js';

let served;
let base;
let browser;

before(async () => {
  served = await serveDist();
  base = served.base;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  served?.close();
});

const b64 = (text) => Buffer.from(text, 'utf8').toString('base64url');
const hashOf = (page) => new URL(page.url()).hash;
const linkOf = (page) => decodeFilters(parseHash(hashOf(page)).f);
const TWELVE = { run_date: { from: '2025-11-01', to: '2026-10-15' } };
const stored = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), VIEWS_KEY);
const seed = (page, value) => page.evaluate(([key, text]) => localStorage.setItem(key, text), [VIEWS_KEY, typeof value === 'string' ? value : JSON.stringify(value)]);
const STUB_CLIPBOARD = () => {
  window.__copied = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } } });
};
const REFUSE_CLIPBOARD = () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError')) } });
};
const STUB_PRINT = () => { window.__printed = 0; window.print = () => { window.__printed += 1; }; };

async function openAt(hash, info = appInfo(), { routes = {}, init, ready = '.ph h1', width } = {}) {
  const opened = await openApp(browser, base, info, { routes, width });
  if (init) await opened.page.addInitScript(init);
  await opened.page.goto('about:blank');
  const mark = opened.seen.pages.length;
  await opened.page.goto(`${base}${hash}`);
  await opened.page.waitForSelector(ready);
  return { ...opened, mark };
}

async function pickCategory(page, value) {
  await page.getByRole('button', { name: /^All/ }).first().click();
  await page.getByRole('listbox', { name: 'Category' }).getByText(value).click();
  await page.keyboard.press('Escape');
  await page.waitForFunction((v) => [...document.querySelectorAll('.chip')].some((c) => c.textContent.includes(v)), value);
}

async function openViews(page) {
  await page.getByRole('button', { name: 'Views', exact: true }).click();
  const pop = page.getByRole('dialog', { name: 'Saved views' });
  await pop.waitFor();
  return pop;
}

async function saveAs(page, name) {
  const pop = await openViews(page);
  await pop.getByRole('button', { name: 'Save this view' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save this view' });
  await dialog.waitFor();
  await dialog.getByRole('textbox', { name: 'Name' }).fill(name);
  await dialog.getByRole('button', { name: 'Save view' }).click();
  return dialog;
}

test('a link restores the filters once the filter list has loaded, and the first request already uses them', async () => {
  const f = encodeFilters({ r: { run_date: '3m' }, s: { category: ['Music', 'Books'] } });
  const { page, seen, context, mark } = await openAt(`#/n01_u05?f=${f}`);
  await page.waitForFunction(() => document.querySelectorAll('.chip').length === 2);
  await until(() => seen.pages.length > mark);
  await page.waitForTimeout(400);
  assert.deepEqual(seen.pages.slice(mark).map((p) => p.filters), [{ run_date: { from: '2026-08-01', to: '2026-10-15' }, category: ['Music', 'Books'] }]);
  assert.deepEqual(await page.locator('.chip').allInnerTexts(), ['Category: Music', 'Category: Books']);
  assert.equal(await page.locator('.fld--range select').inputValue(), '3m');
  assert.equal(hashOf(page), `#/n01_u05?f=${f}`);
  assert.equal(await page.locator('.toast').count(), 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the view in a link opens its tab, and tabs and filters update the address without adding history entries', async () => {
  const { page, seen, context, mark } = await openAt('#/n01_u05?v=runs', appInfo({}, 1, TABLE));
  await page.waitForFunction(() => document.querySelector('[role="tab"][aria-selected="true"]')?.dataset.view === 'runs');
  await page.locator('.runs .runs-tbl').waitFor();
  assert.equal(hashOf(page), '#/n01_u05?v=runs');
  const entries = await page.evaluate(() => history.length);
  await page.getByRole('tab', { name: 'Things to fix' }).click();
  await page.locator('.kpi-v').first().waitFor();
  assert.equal(hashOf(page), '#/n01_u05');
  await until(() => seen.pages.length > mark);
  assert.deepEqual(seen.pages[mark].filters, TWELVE);
  await pickCategory(page, 'Music');
  await page.locator('.fld--range select').selectOption('6m');
  await page.waitForFunction(() => location.hash.includes('f='));
  assert.deepEqual(linkOf(page), { r: { run_date: '6m' }, s: { category: ['Music'] } });
  await page.getByRole('tab', { name: 'Runs' }).click();
  await page.waitForFunction(() => location.hash.startsWith('#/n01_u05?v=runs&f='));
  assert.deepEqual(linkOf(page), { r: { run_date: '6m' }, s: { category: ['Music'] } });
  assert.equal(await page.evaluate(() => history.length), entries);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('an old link or a saved view that names the removed Trend tab opens Things to fix with its filters and no error', async () => {
  const asked = [];
  const routes = { trend: ({ route, json }) => { asked.push(route.request().url()); return json(404, { error: 'no API route POST /api/trend' }); } };
  const f = encodeFilters({ s: { category: ['Music'] } });
  const { page, seen, context } = await openAt(`#/n01_u05?v=trend&f=${f}`, appInfo({}, 1, TABLE), { routes });
  await toastSays(page, LINK_STALE);
  await page.waitForFunction(() => document.querySelector('[role="tab"][aria-selected="true"]')?.dataset.view === 'overview');
  assert.deepEqual(await page.locator('[role="tab"] > span').allInnerTexts(), ['Things to fix', 'Runs']);
  await page.waitForFunction(() => document.querySelectorAll('.chip').length === 1);
  assert.deepEqual(await page.locator('.chip').allInnerTexts(), ['Category: Music']);
  await page.waitForFunction(() => !location.hash.includes('v='));
  assert.deepEqual(linkOf(page), { s: { category: ['Music'] } });
  await page.locator('.kpi-v').first().waitFor();
  await seed(page, { n01_u05: [{ name: 'Old trend', view: 'trend', filters: { s: { category: ['Books'] } } }] });
  const pop = await openViews(page);
  await pop.getByRole('button', { name: 'Old trend', exact: true }).click();
  await toastSays(page, VIEW_STALE);
  await page.waitForFunction(() => [...document.querySelectorAll('.chip')].map((c) => c.textContent).join() === 'Category: Books');
  assert.equal(await page.locator('[role="tab"][aria-selected="true"]').getAttribute('data-view'), 'overview');
  assert.deepEqual(linkOf(page), { s: { category: ['Books'] } });
  assert.deepEqual(asked, [], 'nothing asks for the removed trend');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('stale values in a link are dropped with one notice, and the address keeps only what applies', async () => {
  const f = encodeFilters({ r: { run_date: ['2020-01-01', '2020-02-01'] }, s: { category: ['Music', 'Vinyl'], ghost: ['x'] } });
  const { page, seen, context, mark } = await openAt(`#/n01_u05?f=${f}`);
  await toastSays(page, LINK_STALE);
  await page.waitForFunction(() => document.querySelectorAll('.chip').length === 1);
  await until(() => seen.pages.length > mark);
  await page.waitForTimeout(400);
  assert.deepEqual(await page.locator('.chip').allInnerTexts(), ['Category: Music']);
  assert.deepEqual(seen.pages.slice(mark).map((p) => p.filters), [{ ...TWELVE, category: ['Music'] }]);
  assert.deepEqual(linkOf(page), { s: { category: ['Music'] } });
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a malformed link opens the page with its defaults and the same notice, never a crash', async () => {
  const cases = [['not base64url', '#/n01_u05?f=%%%'], ['escaped junk', '#/n01_u05?f=%25%25%25'], ['empty', '#/n01_u05?f='], ['a JSON array', `#/n01_u05?f=${b64('[1,2]')}`],
    ['not JSON', `#/n01_u05?f=${b64('{oops')}`], ['JSON null', `#/n01_u05?f=${b64('null')}`], ['an unknown view', '#/n01_u05?v=pivot']];
  for (const [label, hash] of cases) {
    const { page, seen, context, mark } = await openAt(hash);
    await toastSays(page, LINK_STALE);
    await until(() => seen.pages.length > mark);
    await page.waitForSelector('.kpi-v');
    assert.deepEqual(seen.pages.at(-1).filters, TWELVE, label);
    assert.equal(hashOf(page), '#/n01_u05', label);
    assert.equal(await page.locator('.chip').count(), 0, label);
    assert.deepEqual(seen.errors, [], label);
    await context.close();
  }
});

test('old links and the sidebar, tabs and home layouts keep working, and #/home opens the Overview', async () => {
  for (const layout of ['sidebar', 'tabs']) {
    const { page, seen, context } = await openAt('#/n02_u01', appInfo({ layout }, 2));
    await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Second desk 1');
    await until(() => seen.pages.some((p) => p.page === 'n02_u01'));
    await page.waitForTimeout(300);
    assert.equal(hashOf(page), '#/n02_u01', layout);
    assert.equal(await page.locator('.toast').count(), 0, layout);
    assert.deepEqual(seen.errors, [], layout);
    await context.close();
  }
  const { page, seen, context } = await openAt('#/home', appInfo({ layout: 'home' }, 2), { ready: '.pg-h h1' });
  await page.waitForTimeout(500);
  assert.equal(hashOf(page), '#/home');
  assert.equal(await page.locator('.main h1').innerText(), 'Overview');
  assert.equal(await page.locator('.toast').count(), 0);
  await page.locator('.side .nav-i', { hasText: 'Second desk 1' }).click();
  await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Second desk 1');
  await page.locator('.fld--range select').selectOption('3m');
  await page.waitForFunction(() => location.hash.startsWith('#/n02_u01?f='));
  await page.reload();
  await page.waitForSelector('.kpi-v');
  await page.waitForFunction(() => document.querySelector('.fld--range select')?.value === '3m');
  await page.getByRole('button', { name: 'All use cases' }).click();
  await page.waitForFunction(() => document.querySelector('.main h1')?.textContent === 'Overview');
  await page.waitForTimeout(300);
  assert.equal(hashOf(page), '#/overview');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a new link pasted into the open page applies, and Back returns to the filters of the page before', async () => {
  const { page, seen, context } = await openAt('#/n01_u05', appInfo({ layout: 'sidebar' }, 2));
  await page.waitForSelector('.kpi-v');
  const f = encodeFilters({ r: { run_date: '6m' }, s: { region: ['North'] } });
  await page.evaluate((h) => { location.hash = h; }, `#/n01_u05?f=${f}`);
  await page.waitForFunction(() => document.querySelector('.fld--range select')?.value === '6m');
  await page.waitForFunction(() => document.querySelectorAll('.chip').length === 1);
  await page.waitForTimeout(300);
  assert.deepEqual(seen.pages.at(-1).filters, { run_date: { from: '2026-05-01', to: '2026-10-15' }, region: ['North'] });
  await page.evaluate(() => { location.hash = '#/n01_u05'; });
  await page.waitForFunction((h) => location.hash === h, `#/n01_u05?f=${f}`);
  assert.equal(await page.locator('.chip').count(), 1, 'a bare link to the open page keeps its filters');
  await page.locator('.side .nav-i', { hasText: 'Second desk 1' }).click();
  await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Second desk 1');
  await page.waitForFunction(() => location.hash === '#/n02_u01');
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Price-loss decision desk');
  await page.waitForFunction(() => document.querySelector('.fld--range select')?.value === '6m');
  assert.equal(hashOf(page), `#/n01_u05?f=${f}`);
  assert.deepEqual(await page.locator('.chip').allInnerTexts(), ['Region: North']);
  assert.equal(await page.locator('.toast').count(), 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a link to an unknown page opens the App with a notice instead of breaking', async () => {
  const f = encodeFilters({ s: { category: ['Music'] } });
  let { page, seen, context } = await openAt(`#/gone_page?f=${f}`, appInfo({ layout: 'sidebar' }, 2), { ready: '.pg-h h1' });
  await toastSays(page, UNKNOWN_PAGE);
  assert.equal(await page.locator('.main h1').innerText(), 'Overview');
  assert.equal(await page.locator('.side .nav-i').count(), 5);
  assert.deepEqual(seen.errors, []);
  await context.close();

  ({ page, seen, context } = await openAt('#/gone_page', appInfo({ layout: 'home' }, 2), { ready: '.pg-h h1' }));
  await toastSays(page, UNKNOWN_PAGE);
  assert.equal(await page.locator('.main h1').innerText(), 'Overview');
  assert.deepEqual(seen.errors, []);
  await context.close();

  ({ page, seen, context } = await openAt('#/gone_page', appInfo({ layout: 'sidebar' }, 1), {}));
  await toastSays(page, UNKNOWN_PAGE);
  await page.waitForFunction(() => location.hash === '#/n01_u05');
  assert.equal(await page.locator('.ph h1').innerText(), 'Price-loss decision desk');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('Copy link copies the address of this exact view and says so', async () => {
  const { page, seen, context } = await openAt('#/n01_u05', appInfo(), { init: STUB_CLIPBOARD });
  await pickCategory(page, 'Home');
  await page.waitForFunction(() => location.hash.includes('f='));
  await page.getByRole('button', { name: 'Copy link' }).click();
  await toastSays(page, 'Link copied');
  const copied = await page.evaluate(() => window.__copied);
  assert.deepEqual(copied, [page.url()]);
  assert.deepEqual(decodeFilters(parseHash(new URL(copied[0]).hash).f), { s: { category: ['Home'] } });
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('when the browser refuses the clipboard, the link shows selected in a dialog to copy by hand', async () => {
  const { page, seen, context } = await openAt('#/n01_u05', appInfo(), { init: REFUSE_CLIPBOARD });
  await pickCategory(page, 'Toys');
  await page.waitForFunction(() => location.hash.includes('f='));
  for (const round of ['refused', 'missing']) {
    if (round === 'missing') await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
    await page.getByRole('button', { name: 'Copy link' }).click();
    const dialog = page.getByRole('dialog', { name: 'Copy this link' });
    await dialog.waitFor();
    const field = await page.evaluate(() => {
      const input = document.querySelector('dialog[open] input');
      return { value: input.value, focused: document.activeElement === input, start: input.selectionStart, end: input.selectionEnd, readOnly: input.readOnly };
    });
    assert.deepEqual(field, { value: page.url(), focused: true, start: 0, end: page.url().length, readOnly: true }, round);
    assert.notEqual(await page.evaluate(() => document.querySelector('.toast')?.textContent || ''), 'Link copied', round);
    await dialog.getByRole('button', { name: 'Done' }).click();
    await dialog.waitFor({ state: 'hidden' });
  }
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('save this view, apply it from the Views menu with the address following, and delete it after a confirmation', async () => {
  const { page, seen, context } = await openApp(browser, base, appInfo());
  await page.locator('.fld--range select').selectOption('3m');
  await pickCategory(page, 'Music');
  let pop = await openViews(page);
  assert.match(await pop.innerText(), /No saved views yet/);
  await page.keyboard.press('Escape');
  const dialog = await saveAs(page, '  Music last quarter ');
  await dialog.waitFor({ state: 'hidden' });
  await toastSays(page, 'Saved the view "Music last quarter"');
  const view = { name: 'Music last quarter', view: 'overview', filters: { r: { run_date: '3m' }, s: { category: ['Music'] } } };
  assert.deepEqual(await stored(page), { n01_u05: [view] });

  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.locator('.fld--range select').selectOption('12m');
  await page.waitForFunction(() => location.hash === '#/n01_u05');
  await page.getByRole('button', { name: 'Views', exact: true }).focus();
  await page.keyboard.press('Enter');
  pop = page.getByRole('dialog', { name: 'Saved views' });
  await pop.waitFor();
  const focused = () => page.evaluate(() => document.activeElement?.textContent);
  assert.equal(await focused(), 'Save this view', 'the menu takes the keyboard focus');
  await page.keyboard.press('Tab');
  assert.equal(await focused(), 'Music last quarter', 'Tab reaches the saved views');
  assert.equal(await pop.getByRole('button', { name: 'Music last quarter', exact: true }).getAttribute('aria-current'), null);
  await page.keyboard.press('Enter');
  await toastSays(page, 'Showing the view "Music last quarter"');
  await page.waitForFunction(() => document.querySelectorAll('.chip').length === 1);
  assert.equal(await page.locator('.fld--range select').inputValue(), '3m');
  await page.waitForFunction(() => location.hash.includes('f='));
  assert.deepEqual(linkOf(page), view.filters);
  await page.waitForTimeout(300);
  assert.deepEqual(seen.pages.at(-1).filters, { run_date: { from: '2026-08-01', to: '2026-10-15' }, category: ['Music'] });
  pop = await openViews(page);
  assert.equal(await pop.getByRole('button', { name: 'Music last quarter', exact: true }).getAttribute('aria-current'), 'true');

  await pop.getByRole('button', { name: 'Delete the view Music last quarter' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete the view Music last quarter' });
  await confirm.waitFor();
  assert.match(await confirm.innerText(), /Delete the view "Music last quarter"\?/);
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await confirm.waitFor({ state: 'hidden' });
  assert.deepEqual(await stored(page), { n01_u05: [view] });
  pop = await openViews(page);
  await pop.getByRole('button', { name: 'Delete the view Music last quarter' }).click();
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await toastSays(page, 'Deleted the view "Music last quarter"');
  assert.deepEqual(await stored(page), {});
  pop = await openViews(page);
  assert.match(await pop.innerText(), /No saved views yet/);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the save dialog refuses a blank, a 61-character or a duplicate name, and the 21st view', async () => {
  const { page, seen, context } = await openApp(browser, base, appInfo());
  const weekly = { name: 'Weekly review', view: 'overview', filters: {} };
  await seed(page, { n01_u05: [weekly], n02_u01: [{ name: 'Elsewhere', view: 'overview', filters: {} }] });
  const dialog = await saveAs(page, '');
  const hint = dialog.locator('.hint');
  await hint.waitFor();
  assert.equal(await hint.innerText(), 'Give the view a name.');
  for (const [name, problem] of [['x'.repeat(61), 'Use 60 characters or fewer.'], [' weekly REVIEW ', 'A view with this name is already saved on this page.']]) {
    await dialog.getByRole('textbox', { name: 'Name' }).fill(name);
    assert.equal(await hint.count(), 0, 'typing clears the problem');
    await dialog.getByRole('button', { name: 'Save view' }).click();
    assert.equal(await hint.innerText(), problem);
  }
  assert.equal((await stored(page)).n01_u05.length, 1);
  await dialog.getByRole('textbox', { name: 'Name' }).fill('y'.repeat(60));
  await dialog.getByRole('button', { name: 'Save view' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual((await stored(page)).n01_u05.map((v) => v.name), ['Weekly review', 'y'.repeat(60)]);
  assert.equal((await stored(page)).n02_u01.length, 1, 'other pages keep their views');

  await seed(page, { n01_u05: Array.from({ length: 20 }, (_, i) => ({ name: `View ${i + 1}`, view: 'overview', filters: {} })) });
  const full = await saveAs(page, 'One more');
  await full.locator('.hint').waitFor();
  assert.equal(await full.locator('.hint').innerText(), 'This page already keeps 20 saved views. Delete one to save another.');
  await full.getByRole('button', { name: 'Cancel' }).click();
  assert.equal((await stored(page)).n01_u05.length, 20);
  const pop = await openViews(page);
  assert.equal(await pop.locator('.vmenu-apply').count(), 20);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('corrupt saved views in storage are ignored safely and a new save repairs them', async () => {
  const { page, seen, context } = await openApp(browser, base, appInfo());
  for (const raw of ['{not json', '[1,2]', 'null', JSON.stringify({ n01_u05: 'x', other: [{ name: 5 }] })]) {
    await seed(page, raw);
    const pop = await openViews(page);
    assert.match(await pop.innerText(), /No saved views yet/, raw);
    await page.keyboard.press('Escape');
  }
  await seed(page, { n01_u05: [{ name: 'Twin' }, { name: 'twin' }, { name: 7 }, null] });
  let pop = await openViews(page);
  assert.deepEqual(await pop.locator('.vmenu-apply').allInnerTexts(), ['Twin']);
  await page.keyboard.press('Escape');
  await seed(page, '{not json');
  const dialog = await saveAs(page, 'Fresh');
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(await stored(page), { n01_u05: [{ name: 'Fresh', view: 'overview', filters: {} }] });
  pop = await openViews(page);
  await pop.getByRole('button', { name: 'Fresh', exact: true }).click();
  await toastSays(page, 'Showing the view "Fresh"');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a saved view whose filters went stale applies what it can and says so', async () => {
  const { page, seen, context } = await openApp(browser, base, appInfo());
  await seed(page, { n01_u05: [{ name: 'Old', view: 'overview', filters: { s: { category: ['Music', 'Vinyl'] } } }] });
  const pop = await openViews(page);
  await pop.getByRole('button', { name: 'Old', exact: true }).click();
  await toastSays(page, 'Some filters in this view no longer apply');
  await page.waitForFunction(() => document.querySelectorAll('.chip').length === 1);
  assert.deepEqual(linkOf(page), { s: { category: ['Music'] } });
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('Print opens the browser print, and the print styles keep the title, the filters in words and the data date while hiding the controls', async () => {
  const f = encodeFilters({ s: { category: ['Music', 'Vinyl'] } });
  const { page, seen, context } = await openAt(`#/n01_u05?f=${f}`, appInfo({ layout: 'sidebar' }, 2), { init: STUB_PRINT });
  await toastSays(page, LINK_STALE);
  await page.waitForFunction(chartsDrawn, 4);
  await page.getByRole('button', { name: 'Ask Genie', exact: true }).click();
  await page.locator('.genie').waitFor();
  assert.equal(await page.locator('.print-filters').isVisible(), false, 'the filters in words are for paper only');
  await page.getByRole('button', { name: 'Print' }).click();
  assert.equal(await page.evaluate(() => window.__printed), 1);

  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(500);
  const report = await page.evaluate(() => {
    const shown = (el) => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
    const hiddenAll = (sel) => [...document.querySelectorAll(sel)].length > 0 && [...document.querySelectorAll(sel)].every((el) => !shown(el));
    const top = (sel) => document.querySelector(sel).getBoundingClientRect().top;
    const grid = document.querySelector('.charts');
    const cards = [...document.querySelectorAll('.charts > [data-card]')];
    return {
      hidden: Object.fromEntries(['.genie', '.ptools button', '.top .genie-btn', '.top .ibtn', '.side', '.toast', '.fbar', '.chips', '.tbar', '.pager select', '.pager button']
        .map((s) => [s, hiddenAll(s)])),
      rows: shown(document.querySelector('.pager-n')) && document.querySelector('.pager-n').textContent,
      title: shown(document.querySelector('.ph h1')) && document.querySelector('.ph h1').textContent,
      app: shown(document.querySelector('.top .mark')),
      words: shown(document.querySelector('.print-filters')) && document.querySelector('.print-filters').textContent,
      through: shown(document.querySelector('.ph-meta')) && /Data through Oct 15, 2026/.test(document.querySelector('.ph-meta').textContent),
      order: top('.ph h1') < top('.ph-meta') && top('.ph-meta') < top('.print-filters') && top('.print-filters') < top('.kpis'),
      columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
      fullWidth: cards.every((c) => Math.abs(c.getBoundingClientRect().width - grid.getBoundingClientRect().width) <= 1),
      unbroken: cards.every((c) => ['avoid', 'avoid-page'].includes(getComputedStyle(c).breakInside)),
      fits: cards.every((c) => { const cv = c.querySelector('canvas'); return cv && cv.getBoundingClientRect().width <= c.getBoundingClientRect().width + 1; }),
    };
  });
  assert.deepEqual(report.hidden, Object.fromEntries(Object.keys(report.hidden).map((k) => [k, true])));
  assert.equal(report.title, 'Price-loss decision desk');
  assert.equal(report.app, true);
  assert.equal(report.rows, 'Showing 1 to 25 of 30', 'paper says the list shows a slice of its rows');
  assert.equal(report.words, 'Filters: Run date: last 12 months; Category: Music');
  assert.equal(report.through, true);
  assert.equal(report.order, true, 'title, data date, then the filters in words, all above the KPIs');
  assert.equal(report.columns, 1);
  assert.equal(report.fullWidth, true);
  assert.equal(report.unbroken, true);
  assert.equal(report.fits, true);

  await page.emulateMedia({ media: 'screen' });
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await page.emulateMedia({ media: 'print' });
  const adjust = await page.evaluate(() => { const cs = getComputedStyle(document.documentElement); return cs.printColorAdjust || cs.webkitPrintColorAdjust; });
  assert.equal(adjust, 'exact', 'a dark page prints its own colours instead of light text on white paper');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('on a phone the page tools shrink to labelled icons and the page still fits', async () => {
  const { page, seen, context } = await openApp(browser, base, appInfo({ layout: 'tabs' }, 2), { width: 375 });
  await page.goto(`${base}#/n01_u05`);
  await page.waitForFunction(chartsDrawn, 4);
  const tools = await page.evaluate(() => [...document.querySelectorAll('.ptools > .btn')].map((b) => {
    const r = b.getBoundingClientRect();
    return { name: b.getAttribute('aria-label'), width: Math.round(r.width), label: getComputedStyle(b.querySelector('span')).display, inView: r.left >= 0 && r.right <= window.innerWidth };
  }));
  assert.deepEqual(tools.map((t) => t.name), ['Copy link', 'Views', 'Print']);
  assert.ok(tools.every((t) => t.width >= 40 && t.width <= 44 && t.label === 'none' && t.inView), JSON.stringify(tools));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.getByRole('button', { name: 'Views', exact: true }).click();
  const pop = await page.getByRole('dialog', { name: 'Saved views' }).boundingBox();
  assert.ok(pop.x >= 0 && pop.x + pop.width <= 375, JSON.stringify(pop));
  assert.deepEqual(seen.errors, []);
  await context.close();
});
