import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { TABLE, appInfo, openApp, serveDist, until } from './harness.mjs';

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

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const FILE = 'blocks/c414cd0e204de974f73753c7e28d7638e7b3691bb8b1a2bab6b25bb7fed7ce77.png';
const URL_SEEN = 'https://images.example.org/mascot.png';
const text = (id, where, of, extra = {}) => ({ id, kind: 'text', place: of ? { where, of } : { where }, width: 'full', align: 'left', content: `Block ${id}`, ...extra });
const MASCOT = { id: 'mascot', kind: 'image', place: { where: 'after', of: 'kpis' }, width: 'narrow', align: 'center',
  content: { url: URL_SEEN, file: FILE, alt: 'The mascot waving', caption: 'Our mascot', height: 120 } };
const PLACED = [text('top', 'top'), text('by_filters', 'after', 'filters'), text('by_kpi', 'before', 'loss_rate', { width: 'narrow' }), MASCOT,
  text('by_chart', 'after', 'by_category', { width: 'half' }), text('beside_list', 'beside', 'records', { width: 'narrow', align: 'right' }),
  text('end', 'bottom', null, { content: '## Read me\nSee **this** and [the guide](https://docs.example.org/g).' })];
const UNSAFE_LINK = '## Read me\nSee **this** and [the guide](https://docs.example.org/g) but not [that](javascript:alert(1)).';

async function open(info, options = {}) {
  const opened = await openApp(browser, served.base, info, { width: 1440, ...options });
  await opened.page.route('**/blocks/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await opened.page.reload();
  await opened.page.waitForSelector('.kpi-v, .hcard');
  opened.seen.errors.splice(0);
  await opened.page.reload();
  await opened.page.waitForSelector('.kpi-v, .hcard');
  return opened;
}

const follows = (page, first, second) => page.evaluate(([a, b]) => {
  const x = document.querySelector(a);
  const y = document.querySelector(b);
  return !!x && !!y && !!(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING);
}, [first, second]);

test('each block shows at the place the page names, the image from the App\u2019s own copy', async () => {
  const info = appInfo({}, 1, { blocks: PLACED });
  info.pages[0].blocks.find((b) => b.id === 'end').content = UNSAFE_LINK;
  const { page, seen, context } = await open(info);
  await page.waitForSelector('[data-block="end"]');
  assert.ok(await follows(page, '[data-block="top"]', '.fbar'), 'the top block sits above the filter bar');
  assert.ok(await follows(page, '.fbar', '[data-block="by_filters"]') && await follows(page, '[data-block="by_filters"]', '.kpis'));
  const row = await page.locator('.kpis').evaluate((el) => [...el.children].map((c) => c.dataset.block || c.querySelector('.kpi-l')?.textContent));
  assert.equal(row.indexOf('by_kpi') + 1, row.findIndex((label) => /loss rate/i.test(label || '')), 'the block sits in the KPI row just before its KPI');
  assert.equal(await page.locator('.kpis').getAttribute('data-n'), '4');
  assert.ok(await follows(page, '.kpis', '[data-block="mascot"]') && await follows(page, '[data-block="mascot"]', 'section.charts'),
    'the image sits in the middle of the page, between the KPIs and the charts');
  const chartRow = await page.locator('section.charts').evaluate((el) => [...el.children].map((c) => c.dataset.block || c.dataset.card || c.className));
  const driverRow = await page.locator('[data-drivers] .charts').evaluate((el) => [...el.children].map((c) => c.dataset.block || c.dataset.card));
  assert.deepEqual(driverRow, ['by_category', 'by_chart'], 'the chart block sits in the grid of its chart, the Drivers section');
  assert.ok(chartRow.length === 3, chartRow.join());
  const beside = page.locator('.blk-beside');
  assert.equal(await beside.locator('[data-block="beside_list"]').count(), 1);
  assert.equal(await beside.locator('.blk-main').count(), 1);
  const [main, side] = await beside.evaluate((el) => [el.querySelector('.blk-main').getBoundingClientRect(), el.querySelector('[data-block="beside_list"]').getBoundingClientRect()]
    .map((r) => ({ left: r.left, width: r.width })));
  assert.ok(side.left > main.left && Math.abs(side.width * 2 - main.width) < 40, `the narrow block takes a third, on the right: ${JSON.stringify([main, side])}`);
  const image = page.locator('[data-block="mascot"] img');
  await until(() => image.evaluate((img) => img.complete && img.naturalWidth === 1));
  assert.equal(await image.getAttribute('src'), FILE);
  assert.equal(await image.getAttribute('alt'), 'The mascot waving');
  assert.equal(await page.locator('[data-block="mascot"] figcaption').innerText(), 'Our mascot');
  assert.equal(await image.evaluate((img) => getComputedStyle(img).height), '120px');
  const [box, block] = await page.evaluate(() => ['.main', '[data-block="mascot"]'].map((s) => document.querySelector(s).getBoundingClientRect())
    .map((r) => ({ left: r.left, width: r.width })));
  assert.ok(Math.abs(block.left + block.width / 2 - (box.left + box.width / 2)) < 40, 'a centered narrow block sits in the middle of the page');
  assert.ok(await follows(page, 'section.card--records, .records, [data-block="beside_list"]', '[data-block="end"]'));
  const end = page.locator('[data-block="end"]');
  assert.equal(await end.locator('h3').innerText(), 'Read me');
  assert.equal(await end.locator('strong').innerText(), 'this');
  const link = end.locator('a');
  assert.equal(await link.count(), 1, 'a javascript link shows as plain text');
  assert.deepEqual([await link.getAttribute('href'), await link.getAttribute('target'), await link.getAttribute('rel')],
    ['https://docs.example.org/g', '_blank', 'noopener noreferrer']);
  assert.ok((await end.innerText()).includes('but not that'));
  const html = await page.content();
  assert.ok(!html.includes(URL_SEEN), 'the page never loads or names the image\u2019s web address');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

const HOSTILE = [
  '<style>.x{color:rgb(1, 2, 3)} @import "https://x.example.org/a.css";</style><div class="x" style="font-weight:700">Styled words</div>',
  '<script>window.__blk = 1</script>',
  '<img src="data:image/png;base64,AAAA" alt="dot" onerror="window.__blk = 2">',
  '<img src="https://x.example.org/hotlink.png" alt="far">',
  '<a href="javascript:window.__blk = 3">bad link</a><a href="https://docs.example.org" target="_blank">good link</a>',
  '<iframe src="https://x.example.org"></iframe><object data="x"></object><embed src="x"><form><input></form>',
  '<div style="background:url(https://x.example.org/t.gif)">tracked</div><svg><script>window.__blk = 4</script></svg>',
].join('');

test('html that reaches the browser goes through the sanitizer: no script, handler, javascript link, frame or outside load', async () => {
  const info = appInfo({}, 1, {});
  info.pages[0].blocks = [{ id: 'raw', kind: 'html', place: { where: 'after', of: 'kpis' }, width: 'full', align: 'left', content: HOSTILE }];
  const { page, context } = await open(info);
  await page.waitForSelector('[data-block="raw"] .blk-html');
  await until(() => page.evaluate(() => !!document.querySelector('[data-block="raw"] .blk-html').shadowRoot?.textContent.includes('Styled words')));
  const out = await page.evaluate(() => {
    const root = document.querySelector('[data-block="raw"] .blk-html').shadowRoot;
    const all = [...root.querySelectorAll('*')];
    return {
      tags: [...new Set(all.map((el) => el.tagName.toLowerCase()))].sort(),
      handlers: all.flatMap((el) => [...el.attributes].map((a) => a.name)).filter((n) => n.startsWith('on')),
      hrefs: all.filter((el) => el.hasAttribute('href')).map((el) => el.getAttribute('href')),
      srcs: all.filter((el) => el.hasAttribute('src')).map((el) => el.getAttribute('src')),
      styles: all.filter((el) => el.hasAttribute('style')).map((el) => el.getAttribute('style')),
      sheet: root.querySelector('style')?.textContent || '',
      color: getComputedStyle(root.querySelector('.x')).color,
      outside: getComputedStyle(document.body).color,
      flag: window.__blk,
    };
  });
  assert.equal(out.flag, undefined, 'no script or handler ran');
  assert.deepEqual(out.handlers, []);
  for (const tag of ['script', 'iframe', 'object', 'embed', 'form', 'input', 'svg']) assert.ok(!out.tags.includes(tag), tag);
  assert.deepEqual(out.hrefs, ['https://docs.example.org']);
  assert.deepEqual(out.srcs, ['data:image/png;base64,AAAA']);
  assert.deepEqual(out.styles, ['font-weight:700']);
  assert.equal(out.sheet, '', 'a style sheet that imports is emptied');
  assert.notEqual(out.color, 'rgb(1, 2, 3)');
  assert.notEqual(out.outside, 'rgb(1, 2, 3)', 'the block\u2019s styles never reach the rest of the App');
  await context.close();
});

test('a style sheet in an html block styles only its own block', async () => {
  const info = appInfo({}, 1, {});
  info.pages[0].blocks = [{ id: 'card', kind: 'html', place: { where: 'top' }, width: 'half', align: 'right',
    content: '<style>p{color:rgb(9, 99, 199)} .kpi-v{color:rgb(9, 99, 199)}</style><p>Inside</p>' }];
  const { page, context } = await open(info);
  await until(() => page.evaluate(() => !!document.querySelector('[data-block="card"] .blk-html').shadowRoot?.querySelector('p')));
  const [inside, kpi] = await page.evaluate(() => [getComputedStyle(document.querySelector('[data-block="card"] .blk-html').shadowRoot.querySelector('p')).color,
    getComputedStyle(document.querySelector('.kpi-v')).color]);
  assert.equal(inside, 'rgb(9, 99, 199)');
  assert.notEqual(kpi, 'rgb(9, 99, 199)');
  const [box, block] = await page.evaluate(() => ['.main', '[data-block="card"]'].map((s) => document.querySelector(s).getBoundingClientRect())
    .map((r) => ({ right: r.right, width: r.width })));
  assert.ok(Math.abs(block.right - box.right) < 40 && block.width < box.width * 0.6, 'a half block aligned right sits on the right');
  await context.close();
});

test('a page without blocks draws no block and the same page as an empty block list', async () => {
  const plain = await open(appInfo({}, 1, {}));
  await plain.page.waitForSelector('section.charts [data-card], section.charts .card');
  const shape = (page) => page.evaluate(() => {
    const main = document.querySelector('.main');
    return { blocks: main.querySelectorAll('.blk, .blk-beside, .blk-main').length, kpis: main.querySelector('.kpis').dataset.n,
      wide: [...main.querySelectorAll('section.charts > *')].map((c) => c.classList.contains('card--wide')),
      order: [...main.querySelectorAll('.fbar, .kpis, section.charts, .card--records, .rec, section.card')].map((el) => el.className.split(' ')[0]) };
  });
  const without = await shape(plain.page);
  await plain.context.close();
  const listed = await open(appInfo({}, 1, { blocks: [] }));
  await listed.page.waitForSelector('section.charts [data-card], section.charts .card');
  const empty = await shape(listed.page);
  await listed.context.close();
  assert.equal(without.blocks, 0);
  assert.deepEqual(empty, without);
  assert.equal(without.kpis, '3');
});

const RUNS = { updated: '2026-10-20T06:00:00Z', as_of: '2026-10-20', cadence_days: 7, next: '2026-10-27', stale: false, count: 6, failed: false };
const ITEM = { key: 'a', label: 'Blue denim jacket, store 12', tier: 'Act now', money: 8400, why: 'Too deep a discount.', owner: null, status: null,
  reason: 'Discount too deep', due: null };
const ENTRY = { visible: true, tracked: true, money: true, categories: ['ai_cat_driver'], served: 'delta', items: [ITEM], total: 1,
  truncated: false, runs: RUNS, weeks: [], done: { fixed: 1, fixed_q: 1, dismissed: 0, dismissed_q: 0, saved_n: 0, saved: 0, saved_q_n: 0, saved_q: 0,
    first_fixed: '2026-09-01T10:00:00Z', first_saved: null } };
const HUB_ROUTES = {
  overview: ({ json }) => json(200, { today: '2026-10-24', quarter: '2026-10-01', since: '2026-08-03', errors: {}, pages: { n01_u05: ENTRY } }),
  summary: ({ json }) => json(200, { run: { summary: 'Discounts lose margin.', nothing_to_act: null, decision_basis: 'measured', currency: 'USD',
    as_of_date: '2026-10-20' }, categories: { ai_cat_driver: { meaning: 'why', values: ['Discount too deep'] } }, note: '' }),
};

test('on a page that tracks its decision list the blocks sit by the tiles, the charts and the list', async () => {
  const blocks = [text('top', 'top'), text('by_kpi', 'before', 'total_loss'), text('mid', 'after', 'kpis'), text('trend_note', 'after', 'loss_trend'),
    text('by_list', 'beside', 'records', { width: 'half', align: 'left' }), text('end', 'bottom')];
  const { page, seen, context } = await open(appInfo({}, 1, { ...TABLE, blocks }), { routes: HUB_ROUTES });
  await page.waitForSelector('[data-tile="fix"]');
  await page.waitForSelector('[data-block="end"]');
  const tiles = '.kpis:has([data-tile="fix"])';
  assert.ok(await follows(page, '[data-block="top"]', tiles), 'the top block sits above the tiles');
  assert.ok(await follows(page, '[data-block="by_kpi"]', tiles), 'a block by a KPI sits by the tiles, which stand for the KPIs here');
  assert.ok(await follows(page, tiles, '[data-block="mid"]') && await follows(page, '[data-block="mid"]', '.fbar'));
  assert.equal(await page.locator('section.charts [data-block="trend_note"]').count(), 1, 'the trend chart\u2019s block sits in its chart grid');
  assert.equal(await page.locator('section.charts').first().locator('.card--wide').count(), 0,
    'the trend chart keeps its half of the row beside the reason bars, as it did before blocks');
  assert.equal(await page.locator('.blk-beside [data-block="by_list"]').count(), 1);
  const order = await page.locator('.blk-beside').evaluate((el) => [...el.children].map((c) => c.dataset.block || c.className));
  assert.deepEqual(order, ['by_list', 'blk-main'], 'a block aligned left sits left of the list');
  assert.ok(await follows(page, '.blk-beside', '[data-block="end"]'));
  assert.deepEqual(seen.errors, []);
  await context.close();
});
