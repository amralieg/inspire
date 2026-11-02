import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { TABLE, appInfo, openApp, serveDist } from './harness.mjs';
import { ADMIN_ROUTE, NO_PEOPLE, NO_USE, USAGE_LABELS, USAGE_RECORDED, USAGE_UNRECORDED, usageView } from '../src/admin.js';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const PERSON = ['pat.lee', 'example.com'].join('@');
const KINDS = ['action', 'edit', 'add', 'delete', 'assumption', 'refresh'];
const counts = (...n) => Object.fromEntries(KINDS.map((k, i) => [k, n[i] || 0]));
const USAGE = {
  days: 30, since: '2026-09-24', kinds: KINDS,
  pages: [{ id: 'n01_u05', title: 'Price-loss desk', counts: counts(11, 1, 1, 1, 2, 2), people: 3, total: 18, last: '2026-10-23T08:00:00Z', errors: [] },
    { id: 'n02_u01', title: 'Second desk 1', counts: counts(), people: 0, total: 0, last: null, errors: ['The changes people made could not load: PERMISSION_DENIED'] }],
  people: [{ who: PERSON, counts: counts(11, 0, 0, 1, 0, 2), pages: ['Price-loss desk'], total: 14, last: '2026-10-23T08:00:00Z' }],
};
const usageRoute = (status, body, asked) => ({ 'admin/usage': ({ json }) => { asked.push(status); return json(status, body); } });
const goAdmin = async (page) => {
  await page.goto(`${served.base}#/${ADMIN_ROUTE}`);
  await page.waitForFunction(() => document.querySelector('.pg-h h1')?.textContent === 'Admin');
};

test('the usage view counts each kind of change per use case and per person, in plain words', () => {
  const view = usageView(USAGE);
  assert.equal(view.title, 'Usage in the last 30 days');
  assert.equal(view.since, 'Since Sep 24, 2026');
  assert.deepEqual(view.kinds.map((k) => k.label), ['Actions', 'Edits', 'Added', 'Deleted', 'Assumption changes', 'Refreshes asked']);
  assert.deepEqual(view.pages[0].cells, ['11', '1', '1', '1', '2', '2']);
  assert.equal(view.pages[1].last, NO_USE);
  assert.deepEqual(view.pages[1].errors, USAGE.pages[1].errors);
  assert.deepEqual(view.people[0], { who: PERSON, pages: 'Price-loss desk', cells: ['11', '0', '0', '1', '0', '2'], total: '14', last: 'Oct 23, 2026' });
  assert.deepEqual(Object.keys(USAGE_LABELS), KINDS);
  assert.ok(/does not record who opens a page or asks Genie/.test(USAGE_UNRECORDED));
});

test('an owner opens Admin from its link and reads the usage, and the menu never lists Admin', async () => {
  const asked = [];
  const { page, seen, context } = await openApp(browser, served.base, appInfo({}, 2, TABLE), { routes: usageRoute(200, USAGE, asked) });
  const before = await page.locator('nav.side').innerText();
  assert.ok(!/Admin/.test(before), 'Admin is hidden from the menu');
  await goAdmin(page);
  await page.locator('.tbl--usage').first().waitFor();
  assert.equal(await page.locator('.pg-h p').innerText(), 'Usage in the last 30 days. Since Sep 24, 2026');
  assert.equal(await page.locator('.admin .note').innerText(), `${USAGE_RECORDED} ${USAGE_UNRECORDED}`);
  const heads = await page.locator('.tbl--usage').first().locator('thead th').allInnerTexts();
  assert.deepEqual(heads.map((h) => h.toLowerCase()), ['use case', 'people', 'actions', 'edits', 'added', 'deleted', 'assumption changes', 'refreshes asked', 'all', 'last change']);
  const first = await page.locator('.tbl--usage').first().locator('tbody tr').first().locator('td').allInnerTexts();
  assert.deepEqual(first, ['Price-loss desk', '3', '11', '1', '1', '1', '2', '2', '18', 'Oct 23, 2026']);
  assert.match(await page.locator('.tbl--usage').first().locator('tbody tr').nth(1).innerText(), /could not load: PERMISSION_DENIED/);
  const person = await page.locator('section[aria-label="By person"] tbody tr').first().locator('td').allInnerTexts();
  assert.deepEqual(person, [PERSON, 'Price-loss desk', '11', '0', '0', '1', '0', '2', '14', 'Oct 23, 2026']);
  assert.equal(await page.evaluate(() => document.title), 'Admin · Pricing desk');
  assert.ok(!/Admin/.test(await page.locator('nav.side').innerText()), 'opening Admin does not add it to the menu');
  assert.deepEqual(asked, [200]);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('someone who is not an owner gets the refusal the App gives, never an empty page', async () => {
  const asked = [];
  const refusal = 'Only the owners of this App can open Admin';
  const { page, context } = await openApp(browser, served.base, appInfo({}, 2, TABLE), { routes: usageRoute(403, { error: refusal }, asked) });
  await goAdmin(page);
  await page.locator('.admin .refused').waitFor();
  assert.equal(await page.locator('.admin .refused').innerText(), refusal);
  assert.equal(await page.locator('.admin .refused').getAttribute('role'), 'alert');
  assert.equal(await page.locator('.tbl--usage').count(), 0, 'nothing about the usage shows to someone refused');
  assert.equal(await page.locator('.admin .note').count(), 0);
  assert.deepEqual(asked, [403]);
  await context.close();
});

test('Admin says when the usage could not load, and when nobody changed anything', async () => {
  const failed = await openApp(browser, served.base, appInfo({}, 1, TABLE), { routes: usageRoute(502, { error: 'the warehouse is stopped' }, []) });
  await goAdmin(failed.page);
  await failed.page.locator('.admin .tile-err').waitFor();
  assert.equal(await failed.page.locator('.admin .tile-err').innerText(), 'The usage could not load: the warehouse is stopped');
  await failed.context.close();
  const quiet = await openApp(browser, served.base, appInfo({}, 1, TABLE), { routes: usageRoute(200, { ...USAGE, pages: [USAGE.pages[1]], people: [] }, []) });
  await goAdmin(quiet.page);
  await quiet.page.waitForFunction((t) => [...document.querySelectorAll('.admin .more')].some((p) => p.textContent === t), NO_PEOPLE);
  assert.equal(await quiet.page.locator('.admin [role="status"]').count(), 0, 'the loading line is gone once the usage arrives');
  await quiet.context.close();
});

test('an owner sees the Admin link the server allows and it opens Admin, while the menu still never lists Admin', async () => {
  const owner = appInfo({ use_case_owners: { n01_u05: [PERSON] } }, 2, TABLE);
  assert.equal(owner.is_owner, true, 'the server signed the person in as an owner');
  assert.ok(!('admin' in owner), 'the App info never carries the owner it names');
  const asked = [];
  const { page, seen, context } = await openApp(browser, served.base, owner, { routes: usageRoute(200, USAGE, asked) });
  const link = page.locator('a.admin-link');
  await link.waitFor();
  assert.equal(await link.innerText(), 'Admin');
  assert.equal(await link.getAttribute('href'), `#/${ADMIN_ROUTE}`);
  assert.equal(await page.locator('.top a.admin-link').count(), 1, 'one link, in the top bar');
  assert.ok(!/Admin/.test(await page.locator('nav.side').innerText()), 'the use case menu never lists Admin');
  await link.click();
  await page.waitForFunction(() => document.querySelector('.pg-h h1')?.textContent === 'Admin');
  await page.locator('.tbl--usage').first().waitFor();
  assert.equal(await link.getAttribute('aria-current'), 'page');
  assert.deepEqual(asked, [200]);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('someone who is not an owner never sees the Admin link, so Admin stays hidden', async () => {
  const other = appInfo({}, 2, TABLE);
  assert.equal(other.is_owner, false, 'the server did not sign this person in as an owner');
  for (const info of [other, { ...other, is_owner: undefined }, { ...other, is_owner: 'true', admin: true }]) {
    const { page, context } = await openApp(browser, served.base, info);
    await page.locator('.top .mark').waitFor();
    await page.waitForFunction(() => document.querySelector('.genie-btn'));
    assert.equal(await page.locator('a.admin-link').count(), 0);
    assert.ok(!/Admin/.test(await page.locator('.top').innerText()), 'nothing in the top bar names Admin');
    assert.ok(!/Admin/.test(await page.locator('nav.side').innerText()));
    await context.close();
  }
});
