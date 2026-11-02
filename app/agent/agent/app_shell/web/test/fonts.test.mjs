import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { appInfo, openApp, serveDist } from './harness.mjs';

const PREFIX = '/run/n01-u05-fonts/';
const policy = (origin) => {
  const root = `${origin}${PREFIX}`;
  return [
    "default-src 'none'", `script-src ${root}assets/`, `style-src ${root}assets/`, `img-src ${root} data:`, `font-src ${root}`, `connect-src ${root}`,
    `form-action ${root}`, "object-src 'none'", "base-uri 'none'", "frame-ancestors 'self'",
  ].join('; ');
};

let served;
let browser;
before(async () => { served = await serveDist({ prefix: PREFIX, headers: (origin) => ({ 'content-security-policy': policy(origin) }) }); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const watcher = () => {
  const seen = { requests: [], fonts: [], document: null };
  const watch = async (page) => {
    page.on('request', (r) => seen.requests.push(r.url()));
    page.on('response', (r) => {
      if (r.url() === served.base) seen.document = r.headers()['content-security-policy'] || '';
      if (r.url().endsWith('.woff2')) seen.fonts.push({ url: r.url(), status: r.status(), type: r.headers()['content-type'] });
    });
    await page.addInitScript(() => {
      window.__violations = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__violations.push({ directive: e.effectiveDirective, blocked: e.blockedURI }));
    });
  };
  return { seen, watch };
};

const loadedFaces = (page) => page.evaluate(async () => {
  await document.fonts.ready;
  return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family).sort();
});

test('the App loads Inter and Newsreader from its own assets under a font-src limited to its own path, and nothing leaves its origin', async () => {
  const { seen: watched, watch } = watcher();
  const { page, seen, context } = await openApp(browser, served.base, appInfo({ style: 'c' }), { watch });
  assert.equal(watched.document, policy(served.origin), 'the page is served under the strict policy');
  await page.waitForFunction(() => ['Inter', 'Newsreader'].every((family) => [...document.fonts].some((f) => f.family === family && f.status === 'loaded')),
    null, { timeout: 20000 });
  assert.deepEqual(await loadedFaces(page), ['Inter', 'Newsreader']);
  assert.match(await page.evaluate(() => getComputedStyle(document.body).fontFamily), /^Inter,/);
  assert.match(await page.evaluate(() => getComputedStyle(document.querySelector('html[data-look="c"] .ph h1')).fontFamily), /^Newsreader,/);
  assert.deepEqual(watched.fonts.map((f) => f.url).sort(), [`${served.base}assets/fonts/inter-latin-wght-normal.woff2`,
    `${served.base}assets/fonts/newsreader-latin-opsz-normal.woff2`]);
  assert.ok(watched.fonts.every((f) => f.status === 200 && f.type === 'font/woff2'), JSON.stringify(watched.fonts));
  assert.deepEqual(watched.requests.filter((url) => !url.startsWith(served.base) && !url.startsWith('data:')), [], 'every request stays inside the page path');
  assert.deepEqual(await page.evaluate(() => window.__violations), [], 'the App needs nothing the policy blocks');
  assert.deepEqual(seen.errors, []);

  const blocked = await page.evaluate(async () => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap';
    document.head.appendChild(link);
    const face = new FontFace('Elsewhere', 'url(https://fonts.gstatic.com/s/inter/v1/elsewhere.woff2)');
    await face.load().catch(() => {});
    await new Promise((r) => { setTimeout(r, 300); });
    return { violations: window.__violations.map((v) => v.directive).sort(), face: face.status };
  });
  assert.deepEqual(blocked.violations, ['font-src', 'style-src-elem'], 'the same policy blocks the Google Fonts the App used to load');
  assert.equal(blocked.face, 'error');
  await context.close();
});

test('a look without Newsreader never downloads it', async () => {
  const { seen: watched, watch } = watcher();
  const { page, context } = await openApp(browser, served.base, appInfo({ style: 'a' }), { watch });
  await page.waitForFunction(() => [...document.fonts].some((f) => f.family === 'Inter' && f.status === 'loaded'), null, { timeout: 20000 });
  assert.deepEqual(await loadedFaces(page), ['Inter']);
  assert.deepEqual(watched.fonts.map((f) => f.url), [`${served.base}assets/fonts/inter-latin-wght-normal.woff2`]);
  await context.close();
});

test('text in Cyrillic, Greek, Vietnamese or Latin Extended loads just the subsets it shows, each from the page path, and every subset is served', async () => {
  const shipped = readdirSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'assets', 'fonts')).filter((name) => name.endsWith('.woff2')).sort();
  assert.equal(shipped.length, 10, shipped.join(' '));
  const { seen: watched, watch } = watcher();
  const { page, seen, context } = await openApp(browser, served.base, appInfo({ style: 'c' }), { watch });
  await page.waitForFunction(() => ['Inter', 'Newsreader'].every((family) => [...document.fonts].some((f) => f.family === family && f.status === 'loaded')),
    null, { timeout: 20000 });
  await page.evaluate(() => {
    for (const [text, family] of [['Привет мир', 'Inter'], ['Γειά σου κόσμε', 'Inter'], ['Zażółć gęślą jaźń', 'Inter'], ['Xin chào thế giới', 'Newsreader']]) {
      const line = document.createElement('p');
      line.textContent = text;
      line.style.fontFamily = family;
      document.body.appendChild(line);
    }
  });
  const wanted = ['inter-cyrillic-wght-normal.woff2', 'inter-greek-wght-normal.woff2', 'inter-latin-ext-wght-normal.woff2', 'inter-latin-wght-normal.woff2',
    'newsreader-latin-opsz-normal.woff2', 'newsreader-vietnamese-opsz-normal.woff2'];
  await page.waitForFunction((n) => [...document.fonts].filter((f) => f.status === 'loaded').length >= n, wanted.length, { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  assert.deepEqual(watched.fonts.map((f) => f.url.slice(`${served.base}assets/fonts/`.length)).sort(), wanted, 'a subset downloads only for text that needs it');
  assert.ok(watched.fonts.every((f) => f.status === 200 && f.type === 'font/woff2'));
  const all = await page.evaluate((names) => Promise.all(names.map((name) => fetch(`./assets/fonts/${name}`).then((r) => [name, r.status]))), shipped);
  assert.deepEqual(all, shipped.map((name) => [name, 200]), 'every subset the build ships is reachable inside the page path');
  assert.deepEqual(await page.evaluate(() => window.__violations), []);
  assert.deepEqual(seen.errors, []);
  await context.close();
});
