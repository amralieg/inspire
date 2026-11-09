#!/usr/bin/env node
/**
 * Verify the deployed Inspire AI app includes the "No data yet" UI and demo-data API.
 *
 * Local bundle only:
 *   node scripts/verify-app-ui.mjs
 *
 * Live Databricks App (open app while logged in, copy URL without path):
 *   INSPIRE_APP_URL="https://<your-app-url>" node scripts/verify-app-ui.mjs
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import redact from '../backend/lib/redact.js';

redact.redactOutput();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distJs = path.join(root, 'frontend/dist/assets');
const { INSPIRE_AGENT_VERSION } = createRequire(import.meta.url)(path.join(root, 'backend/lib/inspireJobParams.js'));
const V130_UI_STRINGS = ['Discovery Type', 'Strategy (optional)', 'Not tied to your strategy', 'Hidden by feedback', 'Your feedback'];

function checkLocalBundle() {
  if (!fs.existsSync(distJs)) {
    return { ok: false, message: 'frontend/dist missing — run: cd frontend && npm run build' };
  }
  const jsFiles = fs.readdirSync(distJs).filter((f) => f.endsWith('.js'));
  const html = path.join(root, 'frontend/dist/index.html');
  const entry = ((fs.existsSync(html) ? fs.readFileSync(html, 'utf8') : '').match(/assets\/(index-[A-Za-z0-9_-]+\.js)/) || [])[1];
  if (!entry || !jsFiles.includes(entry)) {
    return { ok: false, message: 'frontend/dist/index.html names no index-*.js in frontend/dist/assets' };
  }
  const text = jsFiles.map((f) => fs.readFileSync(path.join(distJs, f), 'utf8')).join('\n');
  const hasUi = text.includes('No data yet');
  const hasRetiredGenerationDefault = text.includes('PDF Catalog,Genie Code Instructions');
  const missingV130 = V130_UI_STRINGS.filter((s) => !text.includes(s));
  const ok = hasUi && !hasRetiredGenerationDefault && missingV130.length === 0;
  return {
    ok,
    jsBundle: entry,
    hasDemoDataUi: hasUi,
    hasV113GenerationOptions: !hasRetiredGenerationDefault,
    hasV130Ui: missingV130.length === 0,
    message: ok
      ? `Local bundle OK (${entry})`
      : `Local bundle STALE (${entry}) — ${
          !hasUi
            ? 'missing "No data yet"'
            : hasRetiredGenerationDefault
              ? 'still contains the retired Genie generation-option default'
              : `missing v1.3.0 UI text: ${missingV130.map((s) => `"${s}"`).join(', ')}`
        }; rebuild and redeploy`,
  };
}

async function checkLiveApp(baseUrl) {
  const url = baseUrl.replace(/\/$/, '');
  const defaultsResp = await fetch(`${url}/api/defaults`);
  if (!defaultsResp.ok) {
    return { ok: false, message: `/api/defaults returned ${defaultsResp.status}` };
  }
  const defaults = await defaultsResp.json();
  const templatesResp = await fetch(`${url}/api/demo-data/templates`);
  const templatesOk = templatesResp.ok;

  const ui = defaults?.frontendBuild?.hasDemoDataUi ?? defaults?.features?.demoDataUi;
  const agentVersionOk = defaults?.agentVersion === INSPIRE_AGENT_VERSION;
  const ok = ui === true && templatesOk && agentVersionOk;
  return {
    ok,
    agentVersion: defaults?.agentVersion,
    jsBundle: defaults?.frontendBuild?.jsBundle,
    hasDemoDataUi: ui,
    demoDataApi: templatesOk,
    message: ok
      ? `App OK — UI bundle ${defaults?.frontendBuild?.jsBundle || '?'}`
      : [
          ui ? null : 'UI bundle missing "No data yet" (stale deploy — run npm run deploy)',
          templatesOk ? null : '/api/demo-data/templates not found (stale backend)',
          agentVersionOk ? null : `/api/defaults reports agent ${defaults?.agentVersion || 'unknown'}, expected ${INSPIRE_AGENT_VERSION}`,
        ]
          .filter(Boolean)
          .join('; ') || 'check failed',
  };
}

async function main() {
  console.log('\n══ Inspire AI — "No data yet" UI check ══\n');

  const local = checkLocalBundle();
  console.log('Local zip source:');
  console.log(`  ${local.ok ? '✅' : '❌'} ${local.message}`);
  if (local.jsBundle) console.log(`  bundle: ${local.jsBundle}`);

  const appUrl = process.env.INSPIRE_APP_URL || process.env.DATABRICKS_APP_URL || '';
  if (!appUrl) {
    console.log('\nLive app: skipped (set INSPIRE_APP_URL to your inspire-ai app URL)\n');
    process.exit(local.ok ? 0 : 1);
  }

  console.log(`\nLive app (${appUrl}):`);
  try {
    const live = await checkLiveApp(appUrl);
    console.log(`  ${live.ok ? '✅' : '❌'} ${live.message}`);
    if (live.jsBundle) console.log(`  bundle: ${live.jsBundle}`);
    console.log('');
    process.exit(local.ok && live.ok ? 0 : 1);
  } catch (e) {
    console.log(`  ❌ ${e.message}`);
    console.log('  Open the app in your browser while logged in, then retry.\n');
    process.exit(1);
  }
}

main();
