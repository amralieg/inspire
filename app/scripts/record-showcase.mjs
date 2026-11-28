#!/usr/bin/env node
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { apiWatch, keepToOrigins, recordMvpApp, routeInspireDemo, walkInspireDemo } from './showcaseRecorder.mjs';
import { DEMO_READS_WHEN, demoReads, unrecorded } from './showcaseRoutes.mjs';
import { addShowcasePdfs, pageLayout, pageRasterize } from './showcasePdfs.mjs';
import redact from '../backend/lib/redact.js';

redact.redactOutput();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(root, 'frontend/node_modules/playwright'));
const JSZip = require(path.join(root, 'frontend/node_modules/jszip'));
const { showcaseStale } = require('../backend/lib/showcase.js');
const { installReplace, installTagReplace, makeRecorder, makeSanitizer, mvpUrlsFrom, showcaseFile, showcaseLeaks, showcaseSizeProblem, showcaseSizes, showcaseText } = require('../backend/lib/showcaseRecord.js');

const env = process.env;
const need = (name) => {
  const value = String(env[name] || '').trim();
  if (!value) {
    console.error(`Set ${name}. Usage: INSPIRE_URL=<Inspire App URL> DATABRICKS_PROFILE=<profile> SESSION_ID=<session> SHOWCASE_ID=<id> SHOWCASE_TITLE=<title> [MVPS=<use case ids, comma separated>] [INSPIRE_DATABASE=<catalog.schema of the run, when it is not the App's own>] node scripts/record-showcase.mjs`);
    process.exit(2);
  }
  return value;
};

if (!String(env.MVPS || '').trim()) {
  console.error('Set MVPS=<use case ids of built MVPs>: a demo needs at least one MVP App (REQ-560)');
  process.exit(2);
}
const profile = need('DATABRICKS_PROFILE');
const cli = (...args) => JSON.parse(execFileSync('databricks', [...args, '-p', profile, '-o', 'json'], { encoding: 'utf8' }));
const appName = (url) => new URL(url).hostname.split('.')[0].replace(/-\d+$/, '');

const inspireUrl = need('INSPIRE_URL').replace(/\/+$/, '');
const sessionId = need('SESSION_ID');
const id = need('SHOWCASE_ID');
const title = need('SHOWCASE_TITLE');
const mvpIds = String(env.MVPS || '').split(',').map((s) => s.trim()).filter(Boolean);
const out = path.resolve(env.OUT || path.join(root, 'backend/showcase', `${id}.json.br`));
const distDir = path.resolve(env.DIST || path.join(root, 'frontend/dist'));
if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  console.error(`${distDir} has no index.html: run npm run build in app/frontend first`);
  process.exit(2);
}

const token = cli('auth', 'token').access_token;
const authHeaders = { Authorization: `Bearer ${token}` };
const defaults = await (await fetch(`${inspireUrl}/api/defaults`, { headers: authHeaders })).json();
const real = { inspire_database: String(env.INSPIRE_DATABASE || '').trim() || defaults.inspireDatabase, warehouse_id: defaults.warehouseId };

const log = (line) => console.log(`[record] ${line}`);
const inspire = [];
const mvpExchanges = Object.fromEntries(mvpIds.map((m) => [m, []]));
const blocked = [];
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, extraHTTPHeaders: authHeaders });
  const origins = new Set([new URL(inspireUrl).origin]);
  const outside = [];
  await keepToOrigins(context, origins, outside);
  const page = await context.newPage();
  const settle = apiWatch(page);
  await routeInspireDemo(page, {
    origin: new URL(inspireUrl).origin,
    distDir,
    summary: { id, title, business: env.SHOWCASE_BUSINESS || title, summary: env.SHOWCASE_SUMMARY || '', session_id: sessionId, mvps: [] },
    real,
    authHeaders,
    exchanges: inspire,
    blocked,
  });
  await page.goto(`${inspireUrl}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const walk = await walkInspireDemo(page, { settle, log, mvps: mvpIds.length > 0 });
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.close();
  if (!walk.assets) throw new Error('the session has no generated PDF, PPTX, DOCX or XLSX in its Assets folder, so the demo would show no documents; generate documents for the run first (REQ-560)');
  const missed = unrecorded(inspire, demoReads(mvpIds.length > 0, walk));
  if (missed.length) throw new Error(`the walk did not record ${missed.join(', ')}, so the demo would show views with no saved answer; pick a session that has them`);
  for (const route of unrecorded(inspire, DEMO_READS_WHEN)) log(`the session has no ${route}: ${DEMO_READS_WHEN[route]}`);

  const urls = mvpUrlsFrom(inspire, mvpIds);
  const lost = mvpIds.filter((m) => !urls[m]);
  if (lost.length) throw new Error(`the session has no App for ${lost.join(', ')}`);
  for (const m of mvpIds) origins.add(new URL(urls[m]).origin);
  for (const m of mvpIds) {
    await recordMvpApp(context, { url: urls[m], authHeaders, exchanges: mvpExchanges[m], blocked, log: (line) => log(`${m} ${line}`) });
  }

  const replace = {};
  const me = cli('current-user', 'me');
  if (me.displayName) replace[me.displayName] = 'Demo User';
  if (me.userName) replace[me.userName] = 'person@example.com';
  for (const database of [real.inspire_database, defaults.inspireDatabase]) {
    const catalog = String(database || '').split('.')[0];
    if (catalog && !['main', 'samples', 'hive_metastore'].includes(catalog)) replace[catalog] = 'demo_catalog';
  }
  for (const url of [inspireUrl, ...Object.values(urls)]) {
    const app = cli('apps', 'get', appName(url));
    if (app.service_principal_name) replace[app.service_principal_name] = 'the App service principal';
    if (app.service_principal_client_id) replace[app.service_principal_client_id] = 'the App service principal';
  }
  Object.assign(replace, installReplace(inspireUrl), installTagReplace(inspireUrl)); // C33: the scratch App name in the Build notes
  Object.assign(replace, env.SHOWCASE_REPLACE ? JSON.parse(env.SHOWCASE_REPLACE) : {});

  const titleOf = (m) => {
    const home = mvpExchanges[m].find((x) => x.method === 'GET' && new URL(x.url).pathname === '/api/app' && x.status === 200);
    return (home && home.body && home.body.title) || m;
  };
  const recorder = makeRecorder({
    id, title, business: env.SHOWCASE_BUSINESS || title, summary: env.SHOWCASE_SUMMARY || '', sessionId, replace,
    build: env.SHOWCASE_BUILD || require('../backend/lib/inspireJobParams.js').INSPIRE_AGENT_VERSION,
    mvps: mvpIds.map((m) => ({ id: m, title: titleOf(m), url: urls[m] })),
  });
  // REQ-560: a generated document names the real workspace, run, catalog and person. The recorder keeps document bytes as they are, so each
  // PPTX/DOCX/XLSX is cleaned here with the same sanitizer as the answers. A PDF is drawn pages, so its pixels cannot be cleaned: C33 draws each listed
  // PDF again from the cleaned answers (showcasePdfs.mjs) after the bundle is made.
  const clean = makeSanitizer({ replace, sessionId, mvpUrls: Object.fromEntries(mvpIds.filter((m) => urls[m]).map((m) => [m, urls[m]])), hostedPaths: {} });
  // A chart in a PPTX carries its data as an embedded XLSX, which is cleaned the same way.
  const cleanZip = async (bytes) => {
    const zip = await JSZip.loadAsync(bytes);
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      if (/\.(xml|rels)$/i.test(name)) zip.file(name, clean.text(await entry.async('string')).replace(/\s+panose="[0-9A-Fa-f]*"/g, ''));
      else if (/\.(xlsx|docx|pptx)$/i.test(name)) zip.file(name, await cleanZip(await entry.async('nodebuffer')));
    }
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  };
  const cleanDocument = async (x) => {
    const bytes = Buffer.from(x.body, 'base64');
    if (bytes.subarray(0, 2).toString('latin1') !== 'PK') return null;
    return { ...x, body: (await cleanZip(bytes)).toString('base64') };
  };
  for (const x of inspire) {
    if (!x.base64) { recorder.addInspire(x); continue; }
    const cleaned = await cleanDocument(x);
    if (cleaned) recorder.addInspire(cleaned);
    else log(`drawing ${new URL(x.url).searchParams.get('path')} again from the cleaned answers: a live PDF shows the real names in its pixels`);
  }
  for (const m of mvpIds) for (const x of mvpExchanges[m]) recorder.addMvp(m, x);
  const bundle = recorder.bundle();
  const pdfPage = await browser.newPage();
  await addShowcasePdfs(bundle, pageRasterize(pdfPage), { layout: await pageLayout(await browser.newPage()), banned: [...Object.keys(replace), sessionId, new URL(inspireUrl).hostname], log });
  await pdfPage.close();
  const stale = showcaseStale(bundle);
  if (stale.length) throw new Error(`the recording is stale, so nothing was written: ${stale.join(', ')}`);
  const leaks = showcaseLeaks(bundle, [...Object.keys(replace), sessionId, new URL(inspireUrl).hostname]);
  const tooBig = showcaseSizeProblem(bundle);
  if (tooBig) {
    console.error(`The recording is too large for the App, so nothing was written: ${tooBig}`);
    process.exitCode = 1;
  } else if (leaks.length) {
    console.error(`The recording still names private details, so nothing was written:\n${leaks.slice(0, 40).join('\n')}`);
    process.exitCode = 1;
  } else {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const sizes = showcaseSizes(bundle);
    fs.writeFileSync(out, out.endsWith('.br') ? showcaseFile(bundle) : out.endsWith('.gz') ? zlib.gzipSync(showcaseText(bundle), { level: 9 }) : showcaseText(bundle));
    log(`wrote ${out}: ${Object.keys(bundle.inspire).length} Inspire answers, ${mvpIds.length ? `${mvpIds.map((m) => `${m} ${Object.keys(bundle.mvps[m].api).length}`).join(', ')} MVP answers` : 'no MVP'}, ${sizes.packed} bytes compressed from ${sizes.json} bytes of JSON`);
  }
  if (blocked.length) log(`refused ${blocked.length} writes during the walk: ${[...new Set(blocked)].join(', ')}`);
  if (outside.length) log(`fetched nothing from ${outside.length} requests to hosts outside the App and its MVP Apps: ${[...new Set(outside.map((u) => new URL(u).host))].join(', ')}`);
} finally {
  await browser.close();
}
