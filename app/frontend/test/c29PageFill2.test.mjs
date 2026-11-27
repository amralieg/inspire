// C29 (REQ-566, REQ-574): the Word brief fills its pages, measured on the REAL render (not an estimate).
// The brief is built with real chart pictures (Chromium draws each chart SVG to a PNG, as the app does), converted to PDF by LibreOffice (soffice),
// drawn to grey bitmaps by pdftoppm, and the lowest non-white row of each page is compared with the page height (the content box ends at 93%).
// Every use case page (from the first use case to the page before Methodology) must be at least 75% full. Each use case title and Methodology is one heading.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import JSZip from 'jszip';
import { chromium } from 'playwright';
import { buildDocx } from '../src/lib/docgen/docxDoc.js';
import { buildDocModel } from '../src/lib/docgen/docModel.js';
import { buildAgentModel } from '../src/lib/docgen/agentModel.js';
import { defaultDocOptions } from '../src/lib/docgen/docOptions.js';
import { resolveTheme } from '../src/lib/docgen/docStyles.js';
import { ARGS, ROWS } from './c27x_fixture.mjs';

const BIN = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
const tool = (n) => { const p = BIN.map((d) => path.join(d, n)).find((f) => fs.existsSync(f)); assert.ok(p, `${n} is installed (the real render needs it)`); return p; };
const VERBS = ['GROW REVENUE', 'CUT COST', 'REDUCE RISK', 'CUT COST'];
const values = {};
ROWS.slice(0, 13).forEach((r, i) => {
  const amt = Math.round((0.8 + i * 0.3) * 1e6 * 0.6);
  values[r.No] = { amount: amt, currency: 'USD', status: 'calculated', verb: VERBS[i % 4], story: `Acting on ${String(r.Name).toLowerCase()} returns about ${Math.round(amt / 1e5) / 10}M a year once it runs every week.`,
    yearly: [1, 2, 3].map((y) => ({ year: y, low: Math.round(amt * y * 0.25), likely: Math.round(amt * y * 0.4), high: Math.round(amt * y * 0.55) })),
    factors: [{ name: 'Margin kept', share: 0.6, formula: 'buyers kept x margin per buyer' }, { name: 'Cost avoided', share: 0.4, formula: 'calls avoided x cost per call' }] };
});
const args = { ...ARGS, values };

let built;
async function build() {
  if (built) return built;
  const m = buildDocModel({ ...args, options: defaultDocOptions('English') });
  const theme = resolveTheme('original', 'databricks', '', 'light');
  const browser = await chromium.launch({ headless: true }); const pg = await browser.newPage();
  const chartPng = async (svg) => { const u = await pg.evaluate(async (s) => { const [, w, h] = /width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)"/.exec(s) || []; const img = new Image(); await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s); }); const c = document.createElement('canvas'); c.width = Number(w) * 2; c.height = Number(h) * 2; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c.toDataURL('image/png'); }, svg); return Uint8Array.from(Buffer.from(u.split(',')[1], 'base64')); };
  let bytes; try { bytes = await buildDocx(m, theme, { chartPng, views: buildAgentModel(args).ranked }); } finally { await browser.close(); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c29pf2-'));
  fs.writeFileSync(path.join(dir, 'brief.docx'), Buffer.from(bytes));
  execFileSync(tool('soffice'), ['--headless', `-env:UserInstallation=file://${dir}/profile`, '--convert-to', 'pdf', '--outdir', dir, path.join(dir, 'brief.docx')], { stdio: 'ignore' });
  const texts = execFileSync(tool('pdftotext'), ['-layout', path.join(dir, 'brief.pdf'), '-'], { maxBuffer: 1 << 26 }).toString().split('\f'); texts.pop();
  execFileSync(tool('pdftoppm'), ['-r', '50', '-gray', path.join(dir, 'brief.pdf'), path.join(dir, 'p')]);
  const files = fs.readdirSync(dir).filter((f) => /^p-\d+\.pgm$/.test(f)).sort();
  const fill = files.map((f) => {
    const b = fs.readFileSync(path.join(dir, f)); const [, w, h] = /^P5\s+(\d+)\s+(\d+)\s+255\s/.exec(b.subarray(0, 40).toString('latin1')).map(Number); const px = b.subarray(b.length - w * h);
    const top = Math.round(h * (1134 / 16838)); const bottom = h - top; let low = top;
    for (let y = bottom - 1; y >= top; y -= 1) { let dark = false; for (let x = 0; x < w; x += 1) if (px[y * w + x] < 235) { dark = true; break; } if (dark) { low = y + 1; break; } }
    return low / h; // the fraction of the whole page height, the stricter reading (the content box ends at 93%)
  });
  const zip = await JSZip.loadAsync(bytes);
  built = { m, texts, fill, xml: await zip.file('word/document.xml').async('string') };
  return built;
}
const useCasePages = (texts) => {
  const first = texts.findIndex((t) => /^\s*01\s+[A-Z]/m.test(t));
  const last = texts.findLastIndex((t) => /\bMethodology\b/.test(t));
  return { first, last };
};

test('Word (real render): every use case page is at least 75% full', async () => {
  const { texts, fill } = await build();
  assert.equal(texts.length, fill.length, 'one bitmap per page');
  const { first, last } = useCasePages(texts);
  assert.ok(first > 0 && last > first, `use case pages found (${first}..${last})`);
  const low = []; for (let i = first; i < last; i += 1) if (fill[i] < 0.75) low.push(`page ${i + 1}: ${Math.round(fill[i] * 100)}%`);
  const used = fill.slice(first, last).sort((a, b) => a - b);
  assert.equal(low.length, 0, `${low.length} of ${last - first} use case pages under 75% (min ${Math.round(used[0] * 100)}%, median ${Math.round(used[used.length >> 1] * 100)}%): ${low.slice(0, 12).join(', ')}`);
});

test('Word: each use case title and Methodology is exactly one section heading', async () => {
  const { m, xml } = await build();
  const heads = [...xml.matchAll(/<w:p>(?:(?!<\/w:p>)[\s\S])*?<w:pStyle w:val="Heading[12]"\/>[\s\S]*?<\/w:p>/g)].map((x) => [...x[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(''));
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  for (const u of m.useCases) assert.equal(heads.filter((h) => h.endsWith(esc(u.name)) && /^\d\d {2}/.test(h)).length, 1, `heading for ${u.name}`);
  assert.equal(heads.filter((h) => h === 'Methodology').length, 1, 'Methodology heading');
});
