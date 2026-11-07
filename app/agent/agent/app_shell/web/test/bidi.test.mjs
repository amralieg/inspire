import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { SRC, appInfo, openApp, pageData, resizeTo, serveDist } from './harness.mjs';

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

test('Arabic records read right to left inside every cell and value, the column keeps one alignment for Arabic and English rows, and every text box sets dir (must-exclude)', async () => {
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
    assert.ok(arabic.start <= 1 && arabic.end > 4, `the Arabic label starts where the column starts: ${JSON.stringify(arabic)}`);
    assert.equal(await cell.locator('.cell-t b bdi').evaluate((el) => el.matches(':dir(rtl)')), true, 'the Arabic label reads right to left inside its bdi');
    const key = cell.locator('.cell-t small');
    assert.deepEqual(await key.locator('bdi').allInnerTexts(), ['R001', AR.category], 'the key and the segment sit in their own bdi');
    const english = await page.locator('td', { hasText: /^Item 2/ }).first().locator('.cell-t b').evaluate(side);
    assert.ok(english.start <= 1 && english.end > 4, `an English label in the same column starts at the same side: ${JSON.stringify(english)}`);
    assert.deepEqual(seen.errors, []);
  } finally {
    await page.context().close();
  }
});

const UNITS = ['1,250 قطعة', '980 pcs', '12,400 قطعة', '7 pcs'];

function mixedData(filters) {
  const data = arabicData(filters);
  const rows = data.records.rows.map((r, i) => ({ ...r, entity_label: i % 2 ? `Item ${i + 1}` : `${AR.label} ${i + 1}`, units: UNITS[i % 4],
    recommended_action: i % 2 ? 'SELECT price FROM items WHERE discount > 0.1' : AR.action }));
  return { ...data, records: { ...data.records, rows } };
}

const MIXED = {
  page: ({ route, json }) => json(200, { ...mixedData(route.request().postDataJSON().filters), errors: {} }),
  records: ({ route, json }) => {
    const body = route.request().postDataJSON();
    const all = mixedData(body.filters).records.rows;
    const offset = body.offset || 0;
    return json(200, { rows: all.slice(offset, offset + (body.limit || 25)), total: all.length, offset, limit: body.limit || 25, actions: false, changes: false,
      summary: null, errors: {} });
  },
};

function mixedInfo() {
  const example = JSON.parse(readFileSync(join(SRC, '..', '..', 'example_page.json'), 'utf8'));
  const records = { ...example.records, columns: [...example.records.columns, { column: 'units', label: 'Units', format: 'number' },
    { column: 'recommended_action', label: 'Action', format: 'text' }] };
  const datasets = example.datasets.map((d) => (d.name === 'records' ? { ...d, sql: d.sql.replace('o.value,', 'o.value, o.units,') } : d));
  return appInfo({}, 1, { records, datasets });
}

function columns() {
  const table = document.querySelector('table.tbl');
  const heads = [...table.querySelectorAll('thead th')].map((th) => th.dataset.col);
  const at = (col) => heads.indexOf(col);
  const rows = [...table.querySelectorAll('tbody tr')].filter((tr) => tr.children.length === heads.length);
  const edge = (td) => {
    const range = document.createRange();
    range.selectNodeContents(td);
    const text = range.getBoundingClientRect();
    const box = td.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(td).paddingLeft);
    return { start: Math.round(text.left - box.left - pad), end: Math.round(box.right - parseFloat(getComputedStyle(td).paddingRight) - text.right) };
  };
  const column = (col) => rows.map((tr) => tr.children[at(col)]);
  const style = (td) => { const cs = getComputedStyle(td); return `${cs.unicodeBidi} ${cs.direction} ${cs.textAlign}`; };
  return {
    units: column('units').map((td) => ({ text: td.textContent, style: style(td), ...edge(td) })),
    money: column('value').map((td) => ({ style: style(td), ...edge(td) })),
    label: column('entity_label').map((td) => ({ ...edge(td.querySelector('.cell-t b')), rtl: (td.querySelector('.cell-t b bdi') || td.querySelector('.cell-t b')).matches(':dir(rtl)') })),
    action: column('recommended_action').map((td) => ({ style: style(td), text: td.textContent, ...edge(td),
      rtl: td.querySelector('bdi')?.matches(':dir(rtl)') ?? null })),
    head: style(table.querySelector('thead th[data-col="units"]')),
  };
}

test('a table mixing Arabic and English rows keeps one alignment per column, lines up its numbers, and never reorders SQL (must-exclude)', async () => {
  const { page, seen } = await openApp(browser, served.base, mixedInfo(), { routes: MIXED });
  try {
    await page.locator('td', { hasText: new RegExp(`^${AR.label} 1(?!\\d)`) }).first().waitFor();
    const got = await page.evaluate(columns);
    assert.ok(got.units.length >= 4, JSON.stringify(got.units));
    assert.deepEqual([...new Set(got.units.map((u) => u.style))], ['isolate ltr end'], 'every number cell isolates itself, reads left to right and keeps its end alignment');
    assert.equal(got.head, 'isolate ltr end', 'the number column heading lines up with its numbers');
    assert.deepEqual([...new Set(got.units.map((u) => u.end))], [0], `every number in the Units column ends at the same edge: ${JSON.stringify(got.units)}`);
    assert.ok(got.units.every((u) => /^[\d,]+ /.test(u.text)), 'each number is written before its unit, Arabic or English');
    assert.deepEqual([...new Set(got.money.map((u) => u.style))], ['isolate ltr end']);
    assert.deepEqual([...new Set(got.money.map((u) => u.end))], [0], `the money column lines up too: ${JSON.stringify(got.money)}`);
    assert.deepEqual([...new Set(got.label.map((l) => l.start))], [0], `Arabic and English labels start at the same side of their column: ${JSON.stringify(got.label)}`);
    assert.deepEqual(got.label.map((l) => l.rtl), got.label.map((_l, i) => i % 2 === 0), 'only the Arabic labels read right to left, inside their bdi');
    assert.deepEqual([...new Set(got.action.map((a) => a.style))], ['isolate ltr start'], 'a text cell isolates its text and follows the table direction');
    assert.deepEqual([...new Set(got.action.map((a) => a.start))], [0], `Arabic and English text in one column start at the same side: ${JSON.stringify(got.action)}`);
    assert.deepEqual(got.action.map((a) => a.rtl), got.action.map((_a, i) => i % 2 === 0), 'the SQL reads left to right and the Arabic right to left');
    const sql = await page.locator('td bdi', { hasText: /^SELECT price/ }).first().evaluate((el) => {
      const range = document.createRange();
      const node = el.firstChild;
      const at = (i) => { range.setStart(node, i); range.setEnd(node, i + 1); return range.getBoundingClientRect().left; };
      const text = node.data;
      return [at(0), at(text.indexOf('FROM')), at(text.indexOf('WHERE'))];
    });
    assert.ok(sql[0] < sql[1] && sql[1] < sql[2], `the SQL keeps its order from left to right: ${sql}`);
    assert.deepEqual(seen.errors, []);
  } finally {
    await page.context().close();
  }
});

test('the style sheet isolates every table cell instead of letting each pick its own direction, and keeps code left to right (must-exclude)', () => {
  const css = readFileSync(join(SRC, 'styles', 'shell.css'), 'utf8');
  const plaintext = css.match(/:where\(([^)]*)\)\{unicode-bidi:plaintext/)[1].split(',');
  assert.ok(!plaintext.includes('td') && !plaintext.includes('th'), plaintext.join());
  assert.ok(plaintext.includes('p') && plaintext.includes('li'));
  assert.ok(css.includes(':where(td,th){unicode-bidi:isolate;'));
  assert.ok(css.includes(':where(td.num,th.num){unicode-bidi:isolate;direction:ltr}'));
  assert.ok(css.includes(':where(code,pre,kbd,samp){unicode-bidi:isolate;direction:ltr}'));
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
  const jsx = readdirSync(SRC).filter((f) => f.endsWith('.jsx'));
  assert.ok(jsx.length > 20);
  assert.deepEqual(jsx.flatMap((f) => boxesWithoutDir(readFileSync(join(SRC, f), 'utf8')).map((line) => `${f}:${line}`)), []);
  const css = readdirSync(join(SRC, 'styles')).filter((f) => f.endsWith('.css'));
  assert.deepEqual(css.flatMap((f) => physicalRules(readFileSync(join(SRC, 'styles', f), 'utf8')).map((hit) => `${f}:${hit}`)), []);
});

test('the source checks name a text box without dir and a physical rule, and spare a checkbox, a dir box and a picked side (must-exclude)', () => {
  assert.deepEqual(boxesWithoutDir('<input value={a} />\n<input type="checkbox" />\n<input dir="auto" type="search" />\n<textarea rows={2} />'), [1, 4]);
  assert.deepEqual(physicalRules('.a{text-align:left;margin-inline-start:4px}\n.b{padding-right:0;border-left:1px solid}\n.blk--a-left{margin-right:auto;text-align:left}'),
    ['1 text-align:left', '2 padding-right:', '2 border-left:']);
});
