import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'backend');
const require = createRequire(path.join(backend, 'package.json'));
const express = require('express');
const H = require('./lib/hostedRun.js');
const { HOSTED_OWNER, shellFolder, workspaceOf, fakeWarehouse } = require('./test/support/hostedShell.js');

const ROOT = '/Workspace/Users/someone/hosted/n01-u05-csp/v1';
const ID = 'n01-u05-csp';
const VIEWER = { 'x-forwarded-access-token': 'viewer-token', 'x-forwarded-email': HOSTED_OWNER, 'x-forwarded-preferred-username': 'Owner' };

async function startInspire(python, warehouseUrl) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-csp-'));
  const { page, files } = shellFolder(ROOT, { title: 'Hosted CSP test' });
  const hosted = H.createHostedRun({
    files: () => workspaceOf(files),
    tmpRoot: tmp,
    env: { PATH: process.env.PATH, HOME: os.homedir(), LANG: 'C.UTF-8', DATABRICKS_HOST: warehouseUrl, DATABRICKS_CLIENT_ID: 'never-given',
      DATABRICKS_CLIENT_SECRET: 'never-given' },
    pickPython: async () => python,
  });
  const inspireHits = [];
  const app = express();
  app.all('/run/:id/{*rest}', (req, _res, next) => { req.dbHost = warehouseUrl; req.dbToken = 'sp-token'; next(); }, hosted.proxy);
  app.get('/api/secret', (req, res) => { inspireHits.push(req.url); res.json({ secret: 'service principal data' }); });
  app.get('/', (_req, res) => res.type('html').send(`<!doctype html><title>Inspire</title><iframe id="run" src="/run/${ID}/#/${page.id}"></iframe>`));
  app.get('/plain', (_req, res) => res.type('html').send('<!doctype html><title>No policy</title><p>no policy</p>'));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const record = { id: ID, source: ROOT, version: 1, warehouse_id: 'wh2', page: page.id, published_at: '2026-10-31T05:00:00Z' };
  hosted.setListed([{ kind: 'inspire', id: ID, hosted: record, owners: [HOSTED_OWNER] }], { key: 'db' });
  return {
    page, hosted, inspireHits, base: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      hosted.stopAll();
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}

async function watched(context) {
  const tab = await context.newPage();
  const problems = [];
  tab.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  tab.on('pageerror', (e) => problems.push(e.message));
  await tab.addInitScript(() => {
    window.__violations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__violations.push({ directive: e.effectiveDirective || e.violatedDirective, blocked: e.blockedURI, sample: e.sample || '' });
    });
  });
  return { tab, problems };
}

test('a page Inside Inspire renders under its strict CSP, reads as the viewer, and no injected script or call to Inspire runs', async (t) => {
  const python = await H.pythonFor(process.env.PATH, process.cwd());
  if (!python) {
    t.skip(`no python3 or python on PATH imports ${H.HOSTED_PYTHON_MODULES.join(', ')}, so the real page cannot run on this machine`);
    return;
  }
  const warehouse = await fakeWarehouse();
  const inspire = await startInspire(python, warehouse.url);
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ extraHTTPHeaders: VIEWER, viewport: { width: 1280, height: 900 } });
    const { tab, problems } = await watched(context);
    const fonts = [];
    tab.on('response', (r) => { if (r.url().endsWith('.woff2')) fonts.push({ url: r.url(), status: r.status(), type: r.headers()['content-type'] }); });
    const documentResponse = tab.waitForResponse((r) => r.url() === `${inspire.base}/run/${ID}/`);
    const appCall = tab.waitForResponse((r) => r.url().endsWith(`/run/${ID}/api/app`), { timeout: 90000 });
    const pageCall = tab.waitForResponse((r) => r.url().endsWith(`/run/${ID}/api/page`), { timeout: 90000 });
    await tab.goto(`${inspire.base}/run/${ID}/#/${inspire.page.id}`, { timeout: 90000 });
    const doc = await documentResponse;
    assert.equal(doc.headers()['content-security-policy'], H.hostedCsp(inspire.base, ID));
    const csp = doc.headers()['content-security-policy'];
    for (const part of ["default-src 'none'", `script-src ${inspire.base}/run/${ID}/assets/`, "object-src 'none'", "base-uri 'none'", "frame-ancestors 'self'"]) {
      assert.ok(csp.split('; ').includes(part), `${part} in ${csp}`);
    }
    assert.ok(!/unsafe-inline|unsafe-eval/.test(csp), 'no unsafe-inline and no unsafe-eval');
    const appResponse = await appCall;
    assert.equal(appResponse.status(), 200, 'the page reaches its own API under connect-src');
    assert.equal((await appResponse.json()).image_export, false,
      'a page Inside Inspire signs viewers in as themselves, so it offers no chart image download, the only blob: use in the shell, and no policy needs blob:');
    await tab.getByText('Hosted CSP test', { exact: false }).first().waitFor({ timeout: 60000 });
    await tab.waitForFunction(() => document.querySelectorAll('#root *').length > 20, null, { timeout: 60000 });
    await pageCall;
    const queried = warehouse.calls.filter((c) => c.url === '/api/2.0/sql/statements');
    assert.ok(queried.length > 0, 'the page ran its queries');
    assert.ok(queried.every((c) => c.authorization === 'Bearer viewer-token'), 'every query reads as the viewer, never as the service principal');
    await tab.waitForFunction(() => [...document.fonts].some((f) => f.family === 'Inter' && f.status === 'loaded'), null, { timeout: 30000 });
    assert.match(await tab.evaluate(() => getComputedStyle(document.body).fontFamily), /^Inter,/);
    assert.deepEqual(fonts, [{ url: `${inspire.base}/run/${ID}/assets/fonts/inter-latin-wght-normal.woff2`, status: 200, type: 'font/woff2' }],
      'the page loads its font from its own assets, under a font-src limited to its own path');
    const rendered = await tab.evaluate(() => window.__violations);
    assert.deepEqual(rendered, [], `the page needs nothing the policy blocks, fonts included: ${JSON.stringify(rendered)}`);

    const inject = async (ownApi) => {
      const before = (window.__violations || []).length;
      const script = document.createElement('script');
      script.textContent = 'window.__inline = "ran"';
      document.body.appendChild(script);
      document.body.insertAdjacentHTML('beforeend', '<img id="pwn" src="x-missing.png" onerror="window.__handler = \'ran\'">');
      setTimeout('window.__timer = "ran"', 0);
      let fetchResult = 'fetched';
      try {
        await fetch('/api/secret');
      } catch (e) {
        fetchResult = `blocked: ${e.name}`;
      }
      const own = ownApi ? await fetch(ownApi).then((r) => r.status) : null;
      const image = new Image();
      image.src = '/api/secret?via=image';
      const settled = (img) => new Promise((r) => { if (img.complete) r(); else { img.addEventListener('load', r); img.addEventListener('error', r); } });
      await Promise.all([settled(image), settled(document.getElementById('pwn'))]);
      return { inline: window.__inline, handler: window.__handler, timer: window.__timer, fetchResult, own, violations: (window.__violations || []).slice(before) };
    };
    const injected = await tab.evaluate(inject, './api/app');
    assert.equal(injected.inline, undefined, 'an injected inline script does not run');
    assert.equal(injected.handler, undefined, 'an injected inline event handler does not run');
    assert.equal(injected.timer, undefined, 'a string timer, which needs eval, does not run');
    assert.match(injected.fetchResult, /^blocked/, 'a fetch from the page to Inspire is blocked');
    assert.equal(injected.own, 200, 'the page still reaches its own API');
    assert.deepEqual(inspire.inspireHits, [], 'Inspire never answered the page');
    const directives = [...new Set(injected.violations.map((v) => v.directive))].sort();
    for (const directive of ['connect-src', 'img-src', 'script-src', 'script-src-attr', 'script-src-elem']) {
      assert.ok(directives.includes(directive), `${directive} in ${directives}`);
    }

    const control = await context.newPage();
    await control.goto(`${inspire.base}/plain`);
    const open = await control.evaluate(inject, null);
    assert.deepEqual([open.inline, open.handler, open.timer, open.fetchResult], ['ran', 'ran', 'ran', 'fetched'],
      'the same injections all run on a page with no policy, so the policy is what stops them');
    assert.equal(inspire.inspireHits.length, 2, 'and on that page they reach Inspire, by fetch and by image');
    assert.ok(problems.every((text) => /Content Security Policy|Refused|ERR_BLOCKED|x-missing\.png|404|Failed to fetch|EvalError/i.test(text)),
      `only the blocked attempts show up as errors: ${problems.join(' | ')}`);

    const { tab: parent } = await watched(context);
    await parent.goto(`${inspire.base}/`);
    const frame = parent.frameLocator('#run');
    await frame.getByText('Hosted CSP test', { exact: false }).first().waitFor({ timeout: 60000 });
    const framed = await parent.evaluate(() => document.getElementById('run').contentWindow.__violations);
    assert.deepEqual(framed, [], 'the page renders inside an Inspire iframe, which frame-ancestors self allows');
  } finally {
    await browser.close();
    await inspire.close();
    await warehouse.close();
  }
});
