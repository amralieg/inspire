// REQ-526 part E: brief page 1 of the four designs shows the session's executive summary (or a "Where to start" list), with no empty half page.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { resolveTheme } from '../src/lib/docgen/docStyles.js';
import { briefPagesSvg } from '../src/lib/docgen/docSvg.js';
import { generateDocs, textsToTranslate } from '../src/lib/generateDocs.js';
import * as gen from '../src/lib/generateDocs.js';
import { buildDocModel } from '../src/lib/docgen/docModel.js';
import { toDesignModel } from '../src/lib/docgen/designs/model.js';
import { UCS, VALUED, mkValues, model, SUMMARY } from './req526c_fixture.mjs';

const IDS = ['original', 'editorial_ink', 'bold', 'consulting'];
const MODES = ['light', 'dark'];
const snap = JSON.parse(fs.readFileSync(new URL('./req526d_base.snapshot.json', import.meta.url), 'utf8'));
const h = (s) => crypto.createHash('sha256').update(s).digest('hex');
const page1 = (m, id, mode) => briefPagesSvg(m, resolveTheme(id, 'databricks', '', mode))[0];
// All the page's text as one string: tspans joined by a space, entities decoded.
const plain = (svg) => [...svg.matchAll(/<text [^>]*>(.*?)<\/text>/gs)].map((t) => t[1].replace(/<\/tspan>/g, ' ').replace(/<[^>]+>/g, '')).join(' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ');

// The tallest run of rows with nothing drawn (every pixel the same as the page margin) between y=150 and the footer at y=1050, drawn in Chromium.
let browser;
async function band(svg) {
  browser = browser || await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
  try {
    await page.setContent(`<body style="margin:0"><img id="i" width="794" height="1123" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}"></body>`);
    return await page.evaluate(async () => {
      const img = document.getElementById('i'); await img.decode();
      const c = document.createElement('canvas'); c.width = 794; c.height = 1123; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, 794, 1123).data; let best = 0; let run = 0;
      for (let y = 150; y < 1050; y += 1) {
        const o = y * 794 * 4; let blank = true;
        for (let x = 0; x < 794 && blank; x += 1) { const k = o + x * 4; if (Math.abs(d[k] - d[o + 8]) > 6 || Math.abs(d[k + 1] - d[o + 9]) > 6 || Math.abs(d[k + 2] - d[o + 10]) > 6) blank = false; }
        run = blank ? run + 1 : 0; best = Math.max(best, run);
      }
      return best;
    });
  } finally { await page.close(); }
}
test.after(async () => { if (browser) await browser.close(); });

for (const id of IDS) for (const mode of MODES) {
  test(`E1: ${id} ${mode} page 1 shows the executive summary text`, () => {
    const p = page1(model({ summary: SUMMARY }), id, mode);
    assert.match(plain(p), /arvest Group/, 'the summary first words (the editorial drop cap takes the first letter)');
    assert.match(plain(p), /Concrete opportunities/, 'a second paragraph');
  });
  test(`E2: ${id} ${mode} with no summary page 1 lists the top use case by value`, () => {
    const m = model(); const top = m.useCases.filter((u) => u.value).sort((a, b) => b.value.amount - a.value.amount)[0];
    for (const none of [undefined, [], ['', '  ']]) {
      const txt = plain(page1(model({ summary: none }), id, mode));
      assert.ok(txt.includes((top.name || top.short).slice(0, 18)), `the top use case name: ${top.name}`);
    }
  });
  test(`E3: ${id} ${mode} a 3000-char summary stays inside 794x1123 and is shortened`, () => {
    const long = 'The business wants a single view of every order across all stores and channels so that planners can react the same day. '.repeat(26).slice(0, 3000);
    const p = page1(model({ summary: [long, long] }), id, mode);
    for (const t of p.matchAll(/<text ([^>]*)>(.*?)<\/text>/gs)) {
      const a = Object.fromEntries([...t[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
      let y = Number(a.y); for (const d of t[2].matchAll(/dy="([-\d.]+)"/g)) y += Number(d[1]);
      assert.ok(y >= 0 && y <= 1123, `y ${y}`);
      for (const s of t[2].matchAll(/<tspan x="([-\d.]+)"[^>]*>(.*?)<\/tspan>/gs)) {
        const x = Number(s[1]); const w = s[2].length * Number(a['font-size']) * 0.5; const x0 = a['text-anchor'] === 'end' ? x - w : x; const x1 = a['text-anchor'] === 'end' ? x : x + w;
        assert.ok(x0 >= 0 && x1 <= 794, `x ${x0.toFixed(0)}-${x1.toFixed(0)} ${s[2].slice(0, 30)}`);
      }
    }
  });
  for (const [label, summary] of [['with a summary', SUMMARY], ['without a summary', undefined]]) {
    test(`E4: ${id} ${mode} ${label}: no empty band over 120 px between y=150 and the footer`, async () => {
      const px = await band(page1(model({ summary }), id, mode));
      assert.ok(px <= 120, `empty band ${px}px`);
    });
  }
  test(`E5: ${id} ${mode} RTL Arabic page 1 keeps the mirror group and shows the summary`, () => {
    const p = page1(model({ language: 'Arabic', summary: SUMMARY }), id, mode);
    assert.ok(p.includes('<g transform="translate(794 0) scale(-1 1)">'));
    assert.match(plain(p), /arvest Group/);
  });
}

test('E6: must-keep, the old midnight style page 1 ignores the summary (hash equals the base)', () => {
  for (const mode of MODES) for (const rtl of [false, true]) {
    const p = page1(model({ language: rtl ? 'Arabic' : 'English', summary: SUMMARY }), 'midnight', mode);
    assert.equal(h(p), snap[`midnight|${mode}|${rtl ? 'rtl' : 'ltr'}`].p1);
  }
});

test('E7: the summary reaches the doc model and the design model, empty by default', () => {
  assert.deepEqual(model({ summary: SUMMARY }).summary, SUMMARY);
  assert.deepEqual(model().summary, []);
  assert.deepEqual(toDesignModel(model({ summary: SUMMARY })).summary, SUMMARY);
  assert.deepEqual(buildDocModel({ businessName: 'x', useCases: [], values: {}, options: {}, summary: [' a ', '', 'b'] }).summary, ['a', 'b']);
});

test('E8: generateDocs sends the summary to translation and the translated paragraphs reach the model', async () => {
  assert.equal(typeof gen.modelFor, 'function', 'modelFor is exported');
  const ucs = VALUED.slice(0, 2); const ids = ucs.map((u) => String(u.No));
  const texts = textsToTranslate(ucs, mkValues(), SUMMARY);
  assert.equal(texts['summary|0'], SUMMARY[0]); assert.equal(texts['summary|1'], SUMMARY[1]);
  const m = gen.modelFor({ businessName: 'Acme', useCases: ucs, values: mkValues(), options: { languages: ['Arabic'], blocks: [] }, language: 'Arabic', ids, translated: { 'summary|0': 'AR0' }, summary: SUMMARY });
  assert.deepEqual(m.summary, ['AR0', SUMMARY[1]]);
  const posts = [];
  await generateDocs({ plan: [{ name: 'a.xlsx', kind: 'xlsx', language: 'Arabic', useCaseIds: ids }], options: { languages: ['Arabic'], columns: [], style: 'clean', palette: 'default' },
    useCases: ucs, values: {}, businessName: 'Acme', summary: SUMMARY, folder: '/Workspace/x', post: async (path, body) => { posts.push({ path, body }); return path.endsWith('translate') ? { texts: {} } : {}; },
    inspireDatabase: 'main.inspire', warehouseId: 'wh', sessionId: 1, onFile: () => {} });
  const tr = posts.find((p) => p.path === '/api/inspire/docs/translate');
  assert.equal(tr.body.texts['summary|0'], SUMMARY[0]);
});
