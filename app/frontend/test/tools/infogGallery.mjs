// REQ-574 / REQ-571: renders the infographic concept gallery to SVG and 2x PNG for review.
// Usage (from app/frontend): node test/tools/infogGallery.mjs <outdir> [concept numbers, comma separated]
import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright';
import { ROWS } from '../c27x_fixture.mjs';
import { galleryFor } from '../../src/lib/docgen/designs/infog/gallery.js';
import { checkSvg } from './infogCheck.mjs';

const [out, only] = process.argv.slice(2);
if (!out) { console.error('usage: node test/tools/infogGallery.mjs <outdir> [n,n]'); process.exit(2); }
fs.mkdirSync(out, { recursive: true });
const pick = only ? new Set(only.split(',').map(Number)) : null;
const items = galleryFor(ROWS).filter((c) => !pick || pick.has(c.n));
const browser = await chromium.launch({ headless: true }); const page = await browser.newPage({ deviceScaleFactor: 2 });
for (const c of items) {
  const [, w, h] = /width="(\d+)" height="(\d+)"/.exec(c.svg);
  fs.writeFileSync(path.join(out, `${c.file}.svg`), c.svg);
  await page.setViewportSize({ width: Number(w), height: Number(h) });
  await page.setContent(`<html><body style="margin:0">${c.svg}</body></html>`);
  const buf = await page.locator('svg').first().screenshot({ scale: 'device', omitBackground: false, animations: 'disabled', timeout: 30000 }).catch(() => null);
  if (buf) fs.writeFileSync(path.join(out, `${c.file}.png`), buf);
  const bad = await checkSvg(page, c.svg); const icons = (c.svg.match(/data-icon=/g) || []).length;
  console.log(c.file, buf ? 'png' : 'PNG FAILED', `icons=${icons}`, bad.length ? `PROBLEMS ${bad.length}: ${bad.slice(0, 8).join(' | ')}` : 'clean');
}
await browser.close();
