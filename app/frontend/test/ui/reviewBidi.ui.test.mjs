import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const AR = {
  domain: 'العملاء',
  name: 'توقع تسرب العملاء في الشريحة الأعلى',
  subdomain: 'الاحتفاظ',
  technique: 'تصنيف',
  sponsor: 'رئيس الاحتفاظ',
  statement: `خفض نسبة تسرب العملاء بنسبة 10% في الربع القادم، مع ${'الاستبقاء'.repeat(30)} لكل شريحة.`,
  solution: 'نموذج تصنيف يحدد العملاء المعرضين للمغادرة كل أسبوع.',
  value: 'يحافظ على الإيرادات المتكررة (2.4 مليون).',
};

function arabicResults() {
  const [first, ...rest] = REVIEW_RESULTS.domains;
  const [uc, ...others] = first.use_cases;
  const arabic = {
    ...uc, Name: AR.name, Statement: AR.statement, Solution: AR.solution, 'Business Value': AR.value,
    Subdomain: AR.subdomain, 'Analytics Technique': AR.technique, Sponsor: AR.sponsor,
  };
  return { ...REVIEW_RESULTS, domains: [{ ...first, domain_name: AR.domain, use_cases: [arabic, ...others] }, ...rest] };
}

const list = (page) => page.getByRole('region', { name: 'Use case list' });
const cardOf = (page, name) => list(page).locator('div.rounded-xl').filter({ has: page.getByRole('heading', { name, exact: true }) }).first();

function layout(root) {
  const ARABIC = /[\u0600-\u06FF]/;
  const rect = root.getBoundingClientRect();
  const unisolated = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!ARABIC.test(n.data)) continue;
    let el = n.parentElement;
    let ok = false;
    while (el && root.contains(el)) {
      const cs = getComputedStyle(el);
      if (el.tagName === 'BDI' || el.hasAttribute('dir') || ['isolate', 'plaintext', 'isolate-override'].includes(cs.unicodeBidi)) {
        ok = true;
        break;
      }
      if (!['inline', 'contents'].includes(cs.display)) break;
      el = el.parentElement;
    }
    if (!ok) unisolated.push(n.data.trim().slice(0, 40));
  }
  const clipped = [];
  for (const el of root.querySelectorAll('*')) {
    if (el.closest('pre, [data-scrolls]')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.right > rect.right + 1 || r.left < rect.left - 1) clipped.push(`${el.tagName.toLowerCase()} ${(el.textContent || '').trim().slice(0, 30)}`);
  }
  return { unisolated, clipped };
}

function sideOf(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const text = range.getBoundingClientRect();
  const box = el.getBoundingClientRect();
  return { gapStart: Math.round(text.left - box.left), gapEnd: Math.round(box.right - text.right) };
}

async function openArabic(width = 1440) {
  const ui = await openUi('results', { ...REVIEW_STATE, results: arabicResults() }, '', { init: (page) => page.setViewportSize({ width, height: 1000 }) });
  await list(ui.page).waitFor();
  await cardOf(ui.page, AR.name).waitFor();
  return ui;
}

test('an Arabic use case card reads right to left, isolates every value it joins, and an English card beside it stays left to right (must-exclude)', async () => {
  const ui = await openArabic();
  const { page } = ui;
  try {
    const arabic = cardOf(page, AR.name);
    const title = arabic.getByRole('heading', { name: AR.name, exact: true });
    assert.equal(await title.evaluate((el) => el.matches(':dir(rtl)')), true, 'the Arabic title is right to left');
    const english = cardOf(page, 'Score upsell').getByRole('heading', { name: 'Score upsell', exact: true });
    assert.equal(await english.evaluate((el) => el.matches(':dir(ltr)')), true, 'an English title next to it stays left to right');
    const meta = arabic.locator('[data-use-case-meta]');
    assert.deepEqual(await meta.locator('bdi').allInnerTexts(), [AR.domain, AR.subdomain, AR.technique],
      'each value of the domain line sits in its own bdi, so the separators stay between them');
    assert.equal(await arabic.locator('[data-technique-chip]').count(), 0, 'with no kind, the technique is on the meta line');

    await arabic.locator('[aria-expanded]').click();
    const statement = arabic.locator('[data-use-case-text="statement"]');
    await statement.waitFor();
    const side = await statement.evaluate(sideOf);
    assert.ok(side.gapEnd <= 2 && side.gapStart >= 0, `the Arabic statement starts at the right edge: ${JSON.stringify(side)}`);
    const sponsor = arabic.locator('[data-use-case-fact="Sponsor"] [data-use-case-fact-value]');
    assert.equal(await sponsor.evaluate((el) => el.matches(':dir(rtl)')), true, 'the sponsor value reads right to left');
    const { unisolated, clipped } = await arabic.evaluate(layout);
    assert.deepEqual(unisolated, [], 'every Arabic run sits in an element that sets or isolates its own direction');
    assert.deepEqual(clipped, [], 'nothing in the Arabic card runs past its edge');

    const englishCard = cardOf(page, 'Score upsell');
    await englishCard.locator('[aria-expanded]').click();
    const plain = englishCard.locator('[data-use-case-text="statement"]');
    await plain.waitFor();
    const left = await plain.evaluate(sideOf);
    assert.ok(left.gapStart <= 2 && left.gapEnd > 20, `the English statement still starts at the left edge: ${JSON.stringify(left)}`);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('on a phone the Arabic card and its details wrap inside the card instead of clipping', async () => {
  const ui = await openArabic(390);
  const { page } = ui;
  try {
    const arabic = cardOf(page, AR.name);
    await arabic.locator('[aria-expanded]').click();
    await arabic.locator('[data-use-case-text="statement"]').waitFor();
    const { clipped } = await arabic.evaluate(layout);
    assert.deepEqual(clipped, [], 'nothing in the Arabic card runs past its edge on a 390 px screen');
  } finally {
    await ui.close();
  }
});

test('every Arabic value on the Review page sits in an element that sets or isolates its own direction', async () => {
  const ui = await openArabic();
  try {
    const order = ui.page.getByRole('list', { name: 'Suggested build order' });
    await order.waitFor();
    assert.match(await order.innerText(), new RegExp(AR.name), 'the build order lists the Arabic use case, so the check covers it');
    const { unisolated } = await ui.page.locator('body').evaluate(layout);
    assert.deepEqual(unisolated, []);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the use case search box takes Arabic right to left and English left to right', async () => {
  const ui = await openArabic();
  const { page } = ui;
  try {
    const box = page.getByPlaceholder('Search use cases...');
    assert.equal(await box.getAttribute('dir'), 'auto');
    await box.fill(AR.domain);
    assert.equal(await box.evaluate((el) => el.matches(':dir(rtl)')), true);
    await box.fill('churn');
    assert.equal(await box.evaluate((el) => el.matches(':dir(ltr)')), true);
  } finally {
    await ui.close();
  }
});

const TEXT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password']);

function jsxFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return jsxFiles(full);
    return /\.(jsx|js)$/.test(entry.name) ? [full] : [];
  });
}

function openingTags(source, names) {
  const tags = [];
  const start = new RegExp(`<(${names.join('|')})(?=[\\s/>])`, 'g');
  for (let m = start.exec(source); m; m = start.exec(source)) {
    let depth = 0;
    let quote = '';
    let i = m.index + m[0].length;
    for (; i < source.length; i += 1) {
      const c = source[i];
      if (quote) {
        if (c === quote && source[i - 1] !== '\\') quote = '';
      } else if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) break;
    }
    tags.push({ name: m[1], text: source.slice(m.index, i + 1), line: source.slice(0, m.index).split('\n').length });
  }
  return tags;
}

function textBoxesWithoutDir(files) {
  return files.flatMap((file) => openingTags(fs.readFileSync(file, 'utf8'), ['input', 'textarea'])
    .filter((tag) => {
      const type = (tag.text.match(/\btype=["']([^"']*)["']/) || [])[1] ?? '';
      return (tag.name === 'textarea' || TEXT_TYPES.has(type) || /\btype=\{/.test(tag.text)) && !/\bdir=/.test(tag.text);
    })
    .map((tag) => `${path.relative(SRC, file)}:${tag.line}`));
}

const PHYSICAL = /(?<![\w-])(?:[a-z0-9-]+:)*-?(?:text-(?:left|right)|[mp][lr]-[\w.[\]/%-]+|border-[lr](?:-[\w.[\]/%-]+)?|rounded-(?:[lr]|[tb][lr])(?:-[\w.[\]/%-]+)?)(?![\w-])/g;
const PADDING = /(?:^|:)-?p[lr]-/;
const PHYSICAL_STYLE = /\b(?:margin|padding|border)(?:Left|Right)(?=\s*:)|textAlign:\s*['"](?:left|right)['"]/g;

function physicalClasses(files) {
  return files.flatMap((file) => {
    const source = fs.readFileSync(file, 'utf8');
    const boxes = [];
    for (const tag of openingTags(source, ['input', 'textarea', 'select'])) {
      const at = source.indexOf(tag.text);
      boxes.push([at, at + tag.text.length]);
    }
    const styles = [...source.matchAll(PHYSICAL_STYLE)].map((m) => `${path.relative(SRC, file)}:${source.slice(0, m.index).split('\n').length} ${m[0]}`);
    return [...source.matchAll(PHYSICAL)]
      .filter((m) => !(PADDING.test(m[0]) && boxes.some(([a, b]) => m.index >= a && m.index < b)))
      .map((m) => `${path.relative(SRC, file)}:${source.slice(0, m.index).split('\n').length} ${m[0]}`)
      .concat(styles);
  });
}

test('every text box in the App sets dir, and no class aligns, indents or rounds text by a physical side', () => {
  const files = jsxFiles(SRC);
  assert.ok(files.length > 50, `${files.length} source files`);
  assert.deepEqual(textBoxesWithoutDir(files), []);
  assert.deepEqual(physicalClasses(files), []);
});

test('the source checks name a text box without dir and a physical class, and spare a checkbox, a dir box, rounded-lg, text-start and the padding a text box keeps clear of its icon (must-exclude)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inspire-bidi-'));
  try {
    const file = path.join(dir, 'Seeded.jsx');
    fs.writeFileSync(file, [
      '<input type="text" value={a} onChange={(e) => go(e.target.value > 1)} />',
      '<input type="checkbox" checked />',
      '<input dir="auto" type="search" />',
      '<textarea className="w-full" />',
      '<p className="text-left ml-2 rounded-lg text-start ms-2 border-l-2 sm:text-right pl-7" />',
      '<input dir="auto" className="pl-9 pr-3 text-left" />',
      '<p style={{ marginLeft: 4, paddingInlineStart: 2, textAlign: \'right\' }} />',
    ].join('\n'));
    assert.deepEqual(textBoxesWithoutDir([file]).map((s) => s.split(':').pop()), ['1', '4']);
    assert.deepEqual(physicalClasses([file]).map((s) => s.split(' ').pop()), ['text-left', 'ml-2', 'border-l-2', 'sm:text-right', 'pl-7', 'text-left', 'marginLeft', "'right'"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
