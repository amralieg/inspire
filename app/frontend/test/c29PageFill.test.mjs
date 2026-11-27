// C29 (REQ-566 follow-up): the use case pages of the Word brief and the PDF fill the page.
// Word: the Statement of a use case is not forced onto a new page after the chart, and no use case page is under 60% of the page height.
//   Word has no layout model here, so a page is ESTIMATED from the XML: lines = characters / (text width / (0.5 em)), line = 1.2 x 1.15 x the font size,
//   plus the paragraph spacing, the pictures' printed height and the table rows (a row is as tall as its tallest cell). A page starts at every page break.
// PDF: the real pages are drawn in Chromium and the lowest text or chart (not the pinned notebook button) must reach 80% of the content box.
import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { chromium } from 'playwright';
import { agentPdfPages } from '../src/lib/docgen/agentPdf.js';
import { buildDocx } from '../src/lib/docgen/docxDoc.js';
import { buildDocModel } from '../src/lib/docgen/docModel.js';
import { defaultDocOptions } from '../src/lib/docgen/docOptions.js';
import { resolveTheme } from '../src/lib/docgen/docStyles.js';
import { ARGS, ROWS } from './c27x_fixture.mjs';

const VERBS = ['GROW REVENUE', 'CUT COST', 'REDUCE RISK', 'CUT COST'];
const values = {};
ROWS.slice(0, 13).forEach((r, i) => {
  const amt = Math.round((0.8 + i * 0.3) * 1e6 * 0.6);
  values[r.No] = { amount: amt, currency: 'USD', status: 'calculated', verb: VERBS[i % 4], story: `Acting on ${String(r.Name).toLowerCase()} returns about ${Math.round(amt / 1e5) / 10}M a year once it runs every week.`,
    yearly: [1, 2, 3].map((y) => ({ year: y, low: Math.round(amt * y * 0.25), likely: Math.round(amt * y * 0.4), high: Math.round(amt * y * 0.55) })),
    factors: [{ name: 'Margin kept', share: 0.6, formula: 'buyers kept x margin per buyer' }, { name: 'Cost avoided', share: 0.4, formula: 'calls avoided x cost per call' }] };
});

// ---- Word ----
const PAGE_PT = (16838 - 2268) / 20; // A4 minus the 2 cm margins
const TEXT_PT = 9638 / 20;
const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
function topLevel(xml) {
  const body = xml.slice(xml.indexOf('<w:body>') + 8, xml.lastIndexOf('<w:sectPr'));
  const out = []; let i = 0;
  while (i < body.length) {
    if (body.startsWith('<w:tbl>', i)) { const e = body.indexOf('</w:tbl>', i) + 8; out.push(body.slice(i, e)); i = e; } else if (body.startsWith('<w:p>', i)) { const e = body.indexOf('</w:p>', i) + 6; out.push(body.slice(i, e)); i = e; } else i += 1;
  }
  return out;
}
const sizeOf = (x) => Number((/<w:sz w:val="(\d+)"/.exec(x) || [])[1] || 22) / 2;
function estimator(styles) {
  const styleSpacing = (id) => { const m = id && new RegExp(`w:styleId="${id}"[\\s\\S]*?</w:style>`).exec(styles); const sp = m && /<w:spacing([^>]*)\/>/.exec(m[0]); return sp ? sp[1] : ' w:after="120"'; };
  const tw = (attrs, k) => { const m = new RegExp(`w:${k}="(\\d+)"`).exec(attrs || ''); return m ? Number(m[1]) / 20 : null; };
  const para = (p, width) => {
    const pic = /<wp:extent cx="\d+" cy="(\d+)"/.exec(p);
    const sp = (/<w:pPr>[\s\S]*?<\/w:pPr>/.exec(p) || [''])[0];
    const own = /<w:spacing([^>]*)\/>/.exec(sp); const st = /<w:pStyle w:val="(\w+)"/.exec(sp);
    const attrs = own ? own[1] : styleSpacing(st && st[1]);
    const before = tw(attrs, 'before') ?? tw(styleSpacing(st && st[1]), 'before') ?? 0; const after = tw(attrs, 'after') ?? tw(styleSpacing(st && st[1]), 'after') ?? 0;
    if (pic) return before + after + Number(pic[1]) / 12700;
    const text = [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
    const sz = Math.max(...[...p.matchAll(/<w:sz w:val="(\d+)"/g)].map((m) => Number(m[1]) / 2), 11);
    const lines = Math.max(1, Math.ceil(text.length / Math.max(1, width / (sz * 0.5))));
    return before + after + lines * sz * 1.2 * 1.15;
  };
  const row = (tr) => {
    const fixed = tw((/<w:trHeight([^>]*)\/>/.exec(tr) || [])[1], 'val') || 0;
    const cells = [...tr.matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)].map((c) => {
      const w = tw((/<w:tcW([^>]*)\/>/.exec(c[1]) || [])[1], 'w') || TEXT_PT; const ps = c[1].match(/<w:p>[\s\S]*?<\/w:p>/g) || [];
      return ps.reduce((a, p) => a + para(p, w - 11), 0);
    });
    return Math.max(fixed, ...cells);
  };
  return (el) => (el.startsWith('<w:tbl>') ? (el.match(/<w:tr>[\s\S]*?<\/w:tr>/g) || []).reduce((a, tr) => a + row(tr), 0) : para(el, TEXT_PT));
}
async function wordPages() {
  const m = buildDocModel({ ...ARGS, values, options: defaultDocOptions('English') });
  const theme = resolveTheme('original', 'databricks', '', 'light');
  const zip = await JSZip.loadAsync(await buildDocx(m, theme, { chartPng: async () => PNG }));
  const xml = await zip.file('word/document.xml').async('string');
  const est = estimator(await zip.file('word/styles.xml').async('string'));
  const pages = [];
  for (const el of topLevel(xml)) {
    if (!pages.length || /<w:pageBreakBefore\/>|<w:br w:type="page"\/>/.test(el)) pages.push({ h: 0, els: [] });
    const p = pages[pages.length - 1]; p.h += est(el); p.els.push(el);
  }
  return pages;
}

test('Word: no forced page break between the chart and the Statement of a use case', async () => {
  const pages = await wordPages();
  const xml = pages.flatMap((p) => p.els);
  const stmt = xml.filter((e) => e.startsWith('<w:p>') && /<w:pStyle w:val="Heading2"\/>/.test(e) && />Statement</.test(e));
  assert.ok(stmt.length >= 10, `${stmt.length} Statement headings`);
  const broken = stmt.filter((e) => /<w:pageBreakBefore\/>/.test(e));
  assert.equal(broken.length, 0, `${broken.length} of ${stmt.length} Statement headings start a new page`);
});

test('Word: no use case page is under 60% of the page height (estimated)', async () => {
  const pages = await wordPages();
  const text = (p) => p.els.join('');
  const first = pages.findIndex((p) => /<w:pStyle w:val="Heading2"\/>[\s\S]*?>\d\d  /.test(text(p)));
  const last = pages.findIndex((p, i) => i > first && />Methodology</.test(text(p)));
  assert.ok(first > 0 && last > first, `use case pages found (${first}..${last})`);
  const low = [];
  for (let i = first; i < last; i += 1) {
    const n = Math.max(1, Math.ceil(pages[i].h / PAGE_PT)); const fill = (pages[i].h - (n - 1) * PAGE_PT) / PAGE_PT;
    if (fill < 0.6) low.push(`page ${i + 1}: ${Math.round(fill * 100)}%`);
  }
  assert.equal(low.length, 0, `${low.length} use case pages under 60%: ${low.slice(0, 8).join(', ')}`);
});

// ---- PDF ----
async function pdfFills(args) {
  const pages = agentPdfPages(args);
  const browser = await chromium.launch(); const pg = await browser.newPage({ viewport: { width: 794, height: 1123 } });
  const out = [];
  try {
    for (const [i, p] of pages.entries()) {
      if (!['cards', 'story', 'domain'].includes(p.kind)) continue;
      const html = p.svg.replace(/^.*?<div xmlns="http:\/\/www.w3.org\/1999\/xhtml"/s, '<div').replace(/<\/div><\/foreignObject><\/svg>$/, '</div>');
      await pg.setContent(`<body style="margin:0">${html}</body>`);
      const fill = await pg.evaluate(() => {
        const c = document.querySelector('.content'); const cb = c.getBoundingClientRect(); let mx = cb.top;
        const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT); let n;
        while ((n = w.nextNode())) { if (!n.textContent.trim() || n.parentElement.closest('.foot')) continue; const r = document.createRange(); r.selectNodeContents(n); const q = r.getBoundingClientRect(); if (q.height) mx = Math.max(mx, q.bottom); }
        for (const e of c.querySelectorAll('svg,img')) mx = Math.max(mx, e.getBoundingClientRect().bottom);
        return (mx - cb.top) / cb.height;
      });
      out.push({ page: i + 1, kind: p.kind, fill });
    }
  } finally { await browser.close(); }
  return out;
}
for (const [label, extra] of [['without values', {}], ['with values', { values }]]) {
  test(`PDF: every use case page reaches 80% of the page height (${label})`, async () => {
    const fills = await pdfFills({ ...ARGS, ...extra });
    assert.ok(fills.length >= 20, `${fills.length} use case pages measured`);
    const low = fills.filter((f) => f.fill < 0.8).map((f) => `p${f.page} ${f.kind} ${Math.round(f.fill * 100)}%`);
    assert.equal(low.length, 0, `${low.length} of ${fills.length} pages under 80%: ${low.slice(0, 8).join(', ')}`);
  });
}
