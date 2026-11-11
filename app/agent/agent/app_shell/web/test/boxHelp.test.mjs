import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { DECIDE, appInfo, openApp, serveDist } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = readdirSync(join(HERE, '..', '..', 'examples')).filter((f) => f.endsWith('.json')).sort();
const STILL = (p) => p.emulateMedia({ reducedMotion: 'reduce' });

let served;
let base;
let browser;
before(async () => { served = await serveDist(); base = served.base; browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const BOXES = () => [...document.querySelectorAll('.main .card')]
  .filter((el) => el.getAttribute('role') !== 'status' && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0)
  .map((el) => ({
    name: el.getAttribute('aria-label') || el.querySelector('h2')?.textContent?.trim() || el.className,
    help: !!el.querySelector(':scope > header.card-h [data-section-help]'),
  }));

for (const file of EXAMPLES) {
  test(`every box on the ${file} layout shows a ? in its header that says what to do there`, async () => {
    const { page, context, seen } = await openApp(browser, base, appInfo(DECIDE, 1, {}, `examples/${file}`), { watch: STILL });
    await page.waitForSelector('.main .card', { state: 'visible', timeout: 20000 });
    await page.waitForTimeout(600);
    const boxes = await page.evaluate(BOXES);
    assert.ok(boxes.length > 0, `${file} shows at least one box`);
    const missing = boxes.filter((b) => !b.help).map((b) => b.name);
    assert.deepEqual(missing, [], `${file}: boxes without a ?`);
    assert.ok(!seen.errors.some((e) => /Uncaught|TypeError|ReferenceError/.test(String(e))), `${file}: no page error`);
    await context.close();
  });
}
