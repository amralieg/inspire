import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { FILTERS, TABLE, appInfo, openApp, serveDist } from './harness.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const INSPIRE = 'https://inspire.example.com';
const review = (uc) => `${INSPIRE}/?review=2222222222222222222&uc=${encodeURIComponent(uc)}`;
const LABEL = 'Open in Inspire Review';
const IMPACT = { visible: true, tracked: false, note: 'no run of this use case has written its results yet', promised: null };
const SUMMARY = { run: { currency: 'USD', decision_basis: 'measured', as_of_date: '2026-10-20' }, categories: {}, note: '' };
const MY_WORK = { period: { window: 'week', from: '2026-10-19', to: '2026-10-25', today: '2026-10-24', zone: 'UTC' }, pages: {}, activity: [], total: 0, errors: {} };
const PERF_ROUTES = { impact: ({ json }) => json(200, IMPACT), summary: ({ json }) => json(200, SUMMARY), my_work: ({ json }) => json(200, MY_WORK) };
const links = (scope) => scope.locator('[data-review]').evaluateAll((all) => all.map((a) => ({
  page: a.dataset.review, href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel'), text: a.textContent })));
const stub = (context) => context.route(`${INSPIRE}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Inspire Review</p>' }));

test('an App of its own shows Open in Inspire Review on its page, and it opens the use case on Inspire in a new tab', async () => {
  const info = appInfo({}, 1, { ...TABLE, review: review('N01-U05') });
  assert.equal(info.inside, false);
  assert.equal(info.pages[0].review, review('N01-U05'));
  const { page, seen, context } = await openApp(browser, served.base, info, { hash: '#/n01_u05/settings', ready: '[data-settings]' });
  await stub(context);
  assert.deepEqual(await links(page), [{ page: 'n01_u05', href: review('N01-U05'), target: '_blank', rel: 'noopener noreferrer', text: LABEL }]);
  const [tab] = await Promise.all([context.waitForEvent('page'), page.locator('[data-review]').click()]);
  await tab.waitForLoadState();
  assert.equal(tab.url(), review('N01-U05'));
  assert.deepEqual(seen.errors, []);
  await context.close();
});

for (const layout of ['sidebar', 'home']) {
  test(`each use case of a shared App (${layout} layout) links to its own use case on its Settings and on its Performance section`, async () => {
    const info = appInfo({ layout }, 3, { ...TABLE, review: review('N01-U05') });
    assert.deepEqual(info.pages.map((p) => [p.use_case_id, p.review]), [['N01-U05', review('N01-U05')], ['N02-U01', review('N02-U01')],
      ['N02-U02', review('N02-U02')]]);
    const { page, seen, context } = await openApp(browser, served.base, info, { routes: PERF_ROUTES, ready: '.kpi-v, .hcard, .pg-h h1' });
    for (const p of info.pages) {
      await page.goto(`${served.base}#/${p.id}/settings`);
      await page.waitForFunction((id) => document.querySelector(`[data-settings] [data-review="${id}"]`), p.id);
      assert.deepEqual(await links(page.locator('[data-settings]')), [{ page: p.id, href: p.review, target: '_blank', rel: 'noopener noreferrer', text: LABEL }]);
      await page.goto(`${served.base}#/${p.id}/performance`);
      await page.waitForFunction((id) => document.querySelector(`[data-performance][data-page="${id}"] .imp [data-review="${id}"]`), p.id);
      assert.deepEqual((await links(page.locator('[data-performance] .imp'))).map((l) => [l.page, l.href]), [[p.id, p.review]],
        'Performance links only to its own use case (must-exclude the other two)');
    }
    assert.deepEqual(seen.errors, []);
    await context.close();
  });
}

test('a page whose filters load after the person moved to Performance leaves the address on Performance and Performance shows', async () => {
  const info = appInfo({}, 3, TABLE);
  let release;
  const held = new Promise((r) => { release = r; });
  const routes = {
    ...PERF_ROUTES,
    filters: async ({ json, url }) => { if (url.searchParams.get('page') === 'n02_u01') await held; return json(200, FILTERS); },
  };
  const { page, seen, context } = await openApp(browser, served.base, info, { routes, ready: '.kpi-v, .hcard, .pg-h h1' });
  await page.goto(`${served.base}#/n02_u01`);
  await page.locator('.ph h1', { hasText: 'Second desk 1' }).waitFor();
  await page.evaluate(() => window.history.pushState(window.history.state, '', '#/n02_u01/performance'));
  release();
  await page.locator('.fbar', { hasText: 'Category' }).waitFor();
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  assert.equal(await page.evaluate(() => window.location.hash), '#/n02_u01/performance', 'the page that loaded late never rewrites an address that left it (must-exclude)');
  await page.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
  await page.locator('[data-performance][data-page="n02_u01"]').waitFor();
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a page inside Inspire opens the use case on Inspire\'s Review tab in the same window, never a new tab', async () => {
  const info = appInfo({ host: 'inspire', auth: 'user' }, 1, { ...TABLE, review: review('N01-U05') });
  assert.equal(info.inside, true);
  const { page, seen, context } = await openApp(browser, served.base, info, { hash: '#/n01_u05/settings', ready: '[data-settings]' });
  assert.deepEqual(await links(page), [{ page: 'n01_u05', href: review('N01-U05'), target: '_top', rel: null, text: LABEL }]);
  await stub(context);
  const runTab = `${served.origin}/run-tab`;
  await context.route(runTab, (route) => route.fulfill({ status: 200, contentType: 'text/html',
    body: `<!doctype html><title>Run tab</title><iframe title="page" src="${served.base}#/n01_u05/settings" style="width:1200px;height:800px"></iframe>` }));
  await page.goto(runTab);
  const framed = page.frameLocator('iframe');
  await framed.locator('[data-review]').waitFor();
  await Promise.all([page.waitForURL(review('N01-U05')), framed.locator('[data-review]').click()]);
  assert.equal(page.url(), review('N01-U05'));
  assert.equal(context.pages().length, 1, 'no new tab opened');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a page with no review link, or with no use case id, shows no link at all', async () => {
  const info = appInfo({}, 1, TABLE);
  assert.equal(info.pages[0].review, '');
  const bare = await openApp(browser, served.base, info, { hash: '#/n01_u05/settings', ready: '[data-settings]' });
  await bare.page.locator('[data-settings] .auth').waitFor();
  assert.equal(await bare.page.locator('[data-review]').count(), 0);
  assert.equal(await bare.page.getByText(LABEL).count(), 0);
  assert.deepEqual(bare.seen.errors, []);
  await bare.context.close();
  const { page, seen, context } = await openApp(browser, served.base, { ...appInfo({}, 1, TABLE), pages: appInfo({}, 1, TABLE).pages.map((p) => ({ ...p, review: review('N01-U05'), use_case_id: '' })) }, { hash: '#/n01_u05/settings', ready: '[data-settings]' });
  await page.locator('[data-settings] .auth').waitFor();
  assert.equal(await page.locator('[data-review]').count(), 0, 'the App itself never shows a link that names no use case');
  assert.deepEqual(seen.errors, []);
  await context.close();
});
