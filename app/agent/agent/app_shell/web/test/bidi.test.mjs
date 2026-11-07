import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { SRC, appInfo, fileNames, openApp, pageData, resizeTo, serveDist } from './harness.mjs';

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

const AR = { label: 'منتج رقم', category: 'كتب', action: 'خفض الخصم الدائم إلى 10%', reason: 'عمق خصم مرتفع' };

function arabicData(filters) {
  const data = pageData(filters);
  const rows = data.records.rows.map((r, i) => ({
    ...r, entity_label: i === 1 ? 'Item 2' : `${AR.label} ${i + 1}`, category: AR.category, recommended_action: AR.action, top_reasons: [AR.reason, 'falling margin'],
  }));
  return { ...data, records: { ...data.records, rows } };
}

const ROUTES = {
  page: ({ route, json }) => json(200, { ...arabicData(route.request().postDataJSON().filters), errors: {} }),
  records: ({ route, json }) => {
    const body = route.request().postDataJSON();
    const all = arabicData(body.filters).records.rows;
    const offset = body.offset || 0;
    return json(200, { rows: all.slice(offset, offset + (body.limit || 25)), total: all.length, offset, limit: body.limit || 25, actions: false, changes: false,
      summary: null, errors: {} });
  },
};

function layout() {
  const ARABIC = /[\u0600-\u06FF]/;
  const unisolated = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!ARABIC.test(n.data)) continue;
    let el = n.parentElement;
    let ok = false;
    while (el) {
      const cs = getComputedStyle(el);
      if (el.tagName === 'BDI' || el.hasAttribute('dir') || ['isolate', 'plaintext', 'isolate-override'].includes(cs.unicodeBidi)) {
        ok = true;
        break;
      }
      if (!['inline', 'contents'].includes(cs.display)) break;
      el = el.parentElement;
    }
    if (!ok) unisolated.push(`${n.parentElement.tagName.toLowerCase()}.${[...n.parentElement.classList].join('.')} ${n.data.trim().slice(0, 30)}`);
  }
  const boxes = [...document.querySelectorAll('input, textarea')].filter((el) => !['checkbox', 'radio', 'range', 'number', 'date', 'hidden', 'file', 'color'].includes(el.type))
    .filter((el) => el.getAttribute('dir') !== 'auto').map((el) => el.getAttribute('aria-label') || el.name || el.type);
  return { unisolated, boxes, pageScroll: document.documentElement.scrollWidth - window.innerWidth };
}

test('Arabic records read right to left in every cell and value, an English cell stays left to right, and every text box sets dir (must-exclude)', async () => {
  const { page, seen } = await openApp(browser, served.base, appInfo(), { routes: ROUTES });
  try {
    const cell = page.locator('td', { hasText: new RegExp(`^${AR.label} 1(?!\\d)`) }).first();
    await cell.waitFor();
    const got = await page.evaluate(layout);
    assert.deepEqual(got.unisolated, [], 'every Arabic run sits in an element that sets or isolates its own direction');
    assert.deepEqual(got.boxes, [], 'every text box on the page sets dir="auto"');
    const side = (el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const text = range.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return { start: Math.round(text.left - box.left), end: Math.round(box.right - text.right) };
    };
    const arabic = await cell.locator('.cell-t b').evaluate(side);
    assert.ok(arabic.end <= 1 && arabic.start > 4, `the Arabic label hugs the right of its cell: ${JSON.stringify(arabic)}`);
    const key = cell.locator('.cell-t small');
    assert.deepEqual(await key.locator('bdi').allInnerTexts(), ['R001', AR.category], 'the key and the segment sit in their own bdi');
    const english = await page.locator('td', { hasText: /^Item 2/ }).first().locator('.cell-t b').evaluate(side);
    assert.ok(english.start <= 1 && english.end > 4, `an English label in the same column still hugs the left: ${JSON.stringify(english)}`);
    assert.deepEqual(seen.errors, []);
  } finally {
    await page.context().close();
  }
});

test('on a phone the Arabic records page does not run past the screen', async () => {
  const { page, seen } = await openApp(browser, served.base, appInfo(), { routes: ROUTES, width: 375 });
  try {
    await page.locator('td', { hasText: new RegExp(`^${AR.label} 1(?!\\d)`) }).first().waitFor();
    await resizeTo(page, 375);
    assert.equal((await page.evaluate(layout)).pageScroll, 0);
    assert.deepEqual(seen.errors, []);
  } finally {
    await page.context().close();
  }
});

const TEXT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password']);
const PHYSICAL_CSS = /text-align:\s*(?:left|right)\b|(?<![\w-])(?:margin|padding|border)-(?:left|right)(?:-\w+)?\s*:|(?<![\w-])border-(?:top|bottom)-(?:left|right)-radius\s*:/g;
const CHOSEN_SIDE = /^\.blk--a-(?:left|center|right)\b/;

function boxesWithoutDir(source) {
  const missing = [];
  for (const m of source.matchAll(/<(input|textarea)(?=[\s/>])[^>]*?(?:\/>|>)/gs)) {
    const type = (m[0].match(/\btype=["']([^"']*)["']/) || [])[1] ?? '';
    if ((m[1] === 'textarea' || TEXT_TYPES.has(type) || /\btype=\{/.test(m[0])) && !/\bdir=/.test(m[0])) missing.push(source.slice(0, m.index).split('\n').length);
  }
  return missing;
}

function physicalRules(source) {
  return source.split('\n').flatMap((line, i) => (CHOSEN_SIDE.test(line) ? [] : [...line.matchAll(PHYSICAL_CSS)].map((m) => `${i + 1} ${m[0].trim()}`)));
}

test('every text box in the App sets dir, and no style aligns or spaces text by a physical side except a side the page owner picked', () => {
  const jsx = fileNames(SRC).filter((f) => f.endsWith('.jsx'));
  assert.ok(jsx.length > 20);
  assert.deepEqual(jsx.flatMap((f) => boxesWithoutDir(readFileSync(join(SRC, f), 'utf8')).map((line) => `${f}:${line}`)), []);
  const css = fileNames(join(SRC, 'styles')).filter((f) => f.endsWith('.css'));
  assert.deepEqual(css.flatMap((f) => physicalRules(readFileSync(join(SRC, 'styles', f), 'utf8')).map((hit) => `${f}:${hit}`)), []);
});

test('the source checks name a text box without dir and a physical rule, and spare a checkbox, a dir box and a picked side (must-exclude)', () => {
  assert.deepEqual(boxesWithoutDir('<input value={a} />\n<input type="checkbox" />\n<input dir="auto" type="search" />\n<textarea rows={2} />'), [1, 4]);
  assert.deepEqual(physicalRules('.a{text-align:left;margin-inline-start:4px}\n.b{padding-right:0;border-left:1px solid}\n.blk--a-left{margin-right:auto;text-align:left}'),
    ['1 text-align:left', '2 padding-right:', '2 border-left:']);
});
