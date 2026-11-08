import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = path.join(frontend, 'dist');
const express = createRequire(path.join(frontend, '..', 'backend', 'package.json'))('express');
const MAIN_BUDGET = 1_300_000;
const PANEL = ['Turned into vibe', '/api/inspire/implement/feedback/status'];
const LATER = ['LaunchPage', 'GenerateDataPage', 'MonitorPage', 'ResultsPage', 'ImplementPage', 'RunPage'];
const DEFAULTS = {
  envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com',
  warehouseId: 'wh1', inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai',
};

const assets = () => fs.readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js'));
const entry = () => fs.readFileSync(path.join(DIST, 'index.html'), 'utf8').match(/assets\/(index-[A-Za-z0-9_-]+\.js)/)[1];
const read = (file) => fs.readFileSync(path.join(DIST, 'assets', file), 'utf8');

test('the main Inspire App file stays under its budget and leaves every later page, the Reported issues panel among them, to its own file', () => {
  const main = entry();
  const size = fs.statSync(path.join(DIST, 'assets', main)).size;
  assert.ok(size < MAIN_BUDGET, `${main} is ${size} B, over the ${MAIN_BUDGET} B budget`);
  const text = read(main);
  for (const marker of PANEL) {
    assert.equal(text.includes(marker), false, `the Reported issues panel (${marker}) is back in the main file`);
    const holders = assets().filter((f) => f !== main && read(f).includes(marker));
    assert.equal(holders.length, 1, `exactly one later file holds ${marker}`);
    assert.match(holders[0], /^ImplementPage-/);
  }
  for (const name of LATER) {
    const file = assets().find((f) => f.startsWith(`${name}-`));
    assert.ok(file, `${name} has its own file`);
    assert.ok(text.includes(file), `the main file loads ${file} when the person opens that page`);
  }
});

async function serve(dir) {
  const loads = [];
  const app = express();
  app.use((req, _res, next) => { loads.push(req.path); next(); });
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({ showcases: [] }));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not in this test' }));
  app.use(express.static(dir));
  app.get('/{*rest}', (_req, res) => res.sendFile(path.join(dir, 'index.html')));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { loads, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

function copyDist() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inspire-dist-'));
  fs.cpSync(DIST, dir, { recursive: true });
  return dir;
}

test('the built App opens the home page, fetches the later pages in the background, and opens the launch page from its own file', async () => {
  const dir = copyDist();
  const site = await serve(dir);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${site.base}/`);
    await page.getByRole('button', { name: 'Get Started' }).first().click();
    await page.getByText('No data yet').waitFor();
    for (const name of LATER) {
      await page.waitForFunction((n) => performance.getEntriesByType('resource').some((e) => e.name.includes(`/assets/${n}-`)), name);
    }
    await page.getByText('I have data in Unity Catalog').click();
    await page.getByText('Discovery Type').first().waitFor();
    assert.equal(site.loads.filter((p) => p === '/').length, 1, 'the page loaded once');
  } finally {
    await browser.close();
    await site.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('when a later page file is gone after a new deploy, the App reloads once to pick up the new files and does not loop', async () => {
  const dir = copyDist();
  const gone = assets().find((f) => f.startsWith('ImplementPage-'));
  fs.rmSync(path.join(dir, 'assets', gone));
  const site = await serve(dir);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${site.base}/`);
    await page.waitForFunction(() => sessionStorage.getItem('inspire-chunk-reload'));
    await page.getByRole('button', { name: 'Get Started' }).first().waitFor();
    await page.waitForTimeout(3000);
    assert.equal(site.loads.filter((p) => p === '/').length, 2, 'one reload, never a reload loop');
    assert.ok(site.loads.filter((p) => p === `/assets/${gone}`).length >= 2, 'the reload asked for the file again');
    await page.getByRole('button', { name: 'Get Started' }).first().click();
    await page.getByText('No data yet').waitFor();
  } finally {
    await browser.close();
    await site.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
