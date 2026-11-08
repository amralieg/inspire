#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { apiWatch, openShowcase, readOnlyInspire, recordMvpApp, tabButton, walkMvpViews, walkRun, watchOffline } from './showcaseRecorder.mjs';
import { START_MVP_LABEL } from '../frontend/src/lib/implementWizard.js';
import { SCOPE_WALK_READS, checkRunScope, checkScope, checkWizardSteps, profileWatch } from './scopeWalk.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(root, 'frontend/node_modules/playwright'));

const env = process.env;
const need = (name) => {
  const value = String(env[name] || '').trim();
  if (!value) {
    console.error(`Set ${name}. Usage: INSPIRE_URL=<Inspire App URL> DATABRICKS_PROFILE=<profile> OUT=<folder> node scripts/offline-walk.mjs`);
    process.exit(2);
  }
  return value;
};

const profile = need('DATABRICKS_PROFILE');
const inspireUrl = need('INSPIRE_URL').replace(/\/+$/, '');
const out = path.resolve(need('OUT'));
const token = JSON.parse(execFileSync('databricks', ['auth', 'token', '-p', profile, '-o', 'json'], { encoding: 'utf8' })).access_token;
const origin = new URL(inspireUrl).origin;
const origins = new Set([origin]);
const sections = [];
const blocked = [];
const mvpUrls = new Set();
const scope = [];
const log = (line) => console.log(`[offline] ${line}`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
context.setDefaultTimeout(10000);
const watch = await watchOffline(context, origins);
const page = await context.newPage();
await readOnlyInspire(page, origin, blocked, SCOPE_WALK_READS);
const scopeProfile = profileWatch(page);
page.on('response', async (resp) => {
  if (!resp.url().startsWith(`${origin}/api/`) || resp.status() >= 300 || !/json/i.test(resp.headers()['content-type'] || '')) return;
  const text = await resp.text().catch(() => '');
  for (const m of text.matchAll(/"app_url"\s*:\s*"(https:\/\/[^"]+)"/g)) mvpUrls.add(m[1]);
});
const settle = apiWatch(page);

async function section(name, run) {
  watch.at(name);
  const started = Date.now();
  try {
    const detail = await run();
    sections.push({ name, ok: true, detail: detail || '', seconds: Math.round((Date.now() - started) / 1000) });
    log(`${name}: ok${detail ? ` (${detail})` : ''}`);
  } catch (err) {
    fs.mkdirSync(out, { recursive: true });
    await page.screenshot({ path: path.join(out, `${name.replace(/[^A-Za-z0-9]+/g, '_')}.png`) }).catch(() => null);
    const header = await page.locator('header button').allInnerTexts().catch(() => []);
    sections.push({ name, ok: false, detail: String(err.message).split('\n')[0].slice(0, 300), header: header.map((t) => t.trim()).filter(Boolean).slice(0, 12), seconds: Math.round((Date.now() - started) / 1000) });
    log(`${name}: ${String(err.message).split('\n')[0]}`);
  }
}

const home = async () => {
  await page.goto(`${inspireUrl}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.getByRole('button', { name: 'Get Started' }).first().waitFor({ timeout: 120000 });
  await settle();
};

try {
  await section('Home', home);
  await section('Header pages', async () => {
    const bar = page.locator('header, nav').first();
    const labels = [...new Set((await bar.getByRole('button').or(bar.getByRole('link')).allInnerTexts())
      .map((t) => t.trim()).filter(Boolean))];
    const opened = [];
    for (const label of labels) {
      watch.at(`Header ${label}`);
      const item = bar.getByRole('button', { name: label, exact: true }).or(bar.getByRole('link', { name: label, exact: true }));
      if (!(await item.count())) continue;
      await item.first().click();
      await settle();
      opened.push(`${label} ${await page.evaluate(() => location.hash || location.pathname)}`);
    }
    await home();
    return opened.join(', ');
  });
  await section('Setup', async () => {
    await page.getByRole('button', { name: 'Workspace setup' }).click();
    await settle();
    let steps = 1;
    for (; steps < 8; steps += 1) {
      const next = page.getByRole('button', { name: 'Continue' });
      if (!(await next.count()) || await next.isDisabled()) break;
      await next.click();
      await settle();
    }
    await home();
    return `${steps} steps`;
  });
  await section('Start', async () => {
    await page.getByRole('button', { name: 'Get Started' }).first().click();
    await settle();
    await page.locator('main [data-run]').first().waitFor({ timeout: 120000 }).catch(() => null);
    await settle();
    return `${await page.locator('main [data-run]').count()} runs`;
  });
  await section('Launch', async () => {
    await page.getByRole('button', { name: /I have data/ }).first().click();
    await page.getByLabel('Generation Path').waitFor({ timeout: 60000 });
    await settle();
    return 'opened, nothing launched';
  });
  await section('Review', async () => {
    await tabButton(page, 'results').click();
    const cards = page.getByRole('region', { name: 'Use case list' }).locator('[aria-expanded]');
    await cards.first().waitFor({ timeout: 180000 });
    await settle();
    const n = Math.min(10, await cards.count());
    for (let i = 0; i < n; i += 1) {
      await cards.nth(i).click();
      await settle();
    }
    return `${n} use cases opened`;
  });
  await section('Build', async () => {
    await tabButton(page, 'implement').click();
    const rail = page.locator('nav[aria-label="Use cases"] section button');
    await rail.first().waitFor({ timeout: 120000 });
    await settle();
    const m = Math.min(8, await rail.count());
    const tabs = new Set();
    for (let i = 0; i < m; i += 1) {
      await rail.nth(i).click();
      await settle();
      for (const id of await walkMvpViews(page, settle)) tabs.add(id);
    }
    return `${m} use cases, tabs ${[...tabs].join(' ')}`;
  });
  await section('Start MVP wizard', async () => {
    const start = page.getByRole('button', { name: START_MVP_LABEL });
    if (!(await start.count())) return 'no use case without an MVP';
    await start.first().click();
    const dialog = page.getByRole('dialog');
    await dialog.first().waitFor();
    await settle();
    const seen = [];
    for (let i = 0; i < 10; i += 1) {
      const step = (await page.locator('[aria-current="step"]').first().innerText().catch(() => '?')).trim().replace(/^\d+\.\s*/, '');
      seen.push(step);
      if (/^(Data groups|MVP Test Run)$/.test(step)) {
        for (const c of await checkScope(dialog.first(), scopeProfile.profile, { part: step === 'Data groups' ? 'grouping' : 'first_run' })) scope.push({ where: `wizard ${step}`, ...c });
      }
      const next = page.getByRole('button', { name: 'Next', exact: true });
      if (!(await next.count()) || await next.isDisabled()) break;
      await next.click();
      await settle();
    }
    await page.keyboard.press('Escape');
    await settle();
    for (const c of checkWizardSteps(seen, scopeProfile.profile)) scope.push({ where: 'wizard', ...c });
    return `steps ${seen.join(' > ')}, not started`;
  });
  await section('Run', async () => `${await walkRun(page, settle, async (i) => {
    for (const c of await checkRunScope(page)) scope.push({ where: `Run page ${i + 1}`, ...c });
  })} pages`);
  await section('Monitor', async () => {
    await tabButton(page, 'monitor').click();
    await page.getByRole('heading', { name: 'Pipeline Monitor' }).waitFor({ timeout: 120000 });
    await settle();
    return 'opened';
  });
  await section('Demo', async () => {
    await home();
    await page.getByRole('button', { name: 'Get Started' }).first().click();
    await page.locator('[data-start-choice="data"]').waitFor({ timeout: 120000 });
    if (!(await page.locator('[data-start-choice="demo"]').count())) return 'this App offers no demo';
    await openShowcase(page);
    await page.getByRole('region', { name: 'Use case list' }).waitFor({ timeout: 120000 });
    await settle();
    for (const id of ['results', 'implement', 'run', 'choose']) {
      await tabButton(page, id).click();
      await settle();
    }
    return 'Review, Build, Run and Start of the demo';
  });
  for (const url of [...mvpUrls].sort()) {
    const mvpOrigin = new URL(url).origin;
    origins.add(mvpOrigin);
    await section(`MVP App ${new URL(url).hostname.split('.')[0]}`, async () => {
      const lines = [];
      await recordMvpApp(context, { url, exchanges: [], blocked, log: (line) => lines.push(line), questions: 0 });
      return lines.join('; ');
    });
  }
} finally {
  await browser.close();
}

const report = { inspire: origin, mvpApps: [...mvpUrls].sort().map((u) => new URL(u).origin), sections, scope, blocked: [...new Set(blocked)], ...watch.report() };
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'offline_walk.json'), `${JSON.stringify(report, null, 1)}\n`);
const rows = [['page', 'outside host', 'path', 'initiator']].concat(report.outside.map((o) => [o.page, o.host, o.path, o.initiator]));
const errors = [['page', 'kind', 'error']].concat(report.pageErrors.map((e) => [e.page, 'page error', e.error]), report.consoleErrors.map((e) => [e.page, 'console error', e.error]));
fs.writeFileSync(path.join(out, 'offline_walk.tsv'), `${rows.map((r) => r.join('\t')).join('\n')}\n\n${errors.map((r) => r.join('\t')).join('\n')}\n`);
log(`scope checks: ${scope.filter((c) => c.ok === true).length} passed, ${scope.filter((c) => c.ok === false).length} failed, ${scope.filter((c) => c.ok === null).length} not checkable`);
log(`${report.outside.length} outside requests, ${report.pageErrors.length} page errors, ${report.consoleErrors.length} console errors, ${sections.filter((s) => !s.ok).length} of ${sections.length} sections failed; wrote ${out}`);
