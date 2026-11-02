#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const APP = path.resolve(__dirname, '..');
const IMPORT_LIMIT = 10000000;
const BUNDLE = 'backend/build/server.js';
const SWAGGER_UI = 'backend/build/swagger-ui';
const REQUIRED = ['app.yaml', 'start.sh', BUNDLE, 'frontend/dist/index.html', 'backend/api-docs.html',
  ...['swagger-ui-bundle.js', 'swagger-ui.css', 'LICENSE', 'NOTICE'].map((file) => `${SWAGGER_UI}/${file}`)];
const INSTALL_FILES = new Set(['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml',
  'requirements.txt', 'pyproject.toml', 'uv.lock', 'Pipfile', 'Pipfile.lock']);
const INSTALL_COMMAND = /\b(npm|npx|pnpm|yarn|pip3?|uv|curl|wget)\b/;
const OUTSIDE_LOADS = [
  /\.src\s*=\s*['"`]https?:\/\//,
  /<(script|img|iframe|source|video|audio)\b[^>]*\bsrc\s*=\s*['"{`]+https?:\/\//i,
  /<link\b[^>]*\bhref\s*=\s*['"]https?:\/\//i,
  /@import\s+(url\()?\s*['"]?https?:\/\//i,
  /url\(\s*['"]?https?:\/\//i,
  /\bimport\(\s*['"`]https?:\/\//,
  /\bfetch\(\s*['"`]https?:\/\//,
  /new\s+(Worker|EventSource|WebSocket)\(\s*['"`](https?|wss?):\/\//,
  /\bsrc:\s*['"`]https?:\/\//,
  /cdn\.jsdelivr\.net|cdn\.sheetjs\.com|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/,
];
const WEB_FILE = /^(frontend\/dist\/.*|backend\/build\/swagger-ui\/.*|backend\/[^/]+)\.(html|js|mjs|css)$/;
const MODULE_MARK = /^\/\/ (\S+\.(?:js|cjs|mjs|json))$/gm;
const URL_HOST = /\bhttps?:\/\/([^/'"`\s)\\]+)/g;
const NETWORK_CALL = /\b(?:fetch|request|get)\(\s*['"`]https?:\/\/([^/'"`\s)\\]+)/g;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1)$|(^|\.)example\.com$|\.invalid$/;
const MODULE_HOSTS = { 'server.js': new Set(['login.microsoftonline.com']) };

const hostOf = (raw) => raw.replace(/:[^:]*$/, '').toLowerCase();
const excerpt = (text, at) => text.slice(Math.max(0, at - 40), at + 80).replace(/\s+/g, ' ');

function bundleModules(text) {
  const marks = [...text.matchAll(MODULE_MARK)];
  const starts = [{ index: 0, name: '(esbuild runtime)' }, ...marks.map((m) => ({ index: m.index, name: m[1] }))];
  return { marked: marks.length, modules: starts.map((s, i) => ({ name: s.name, text: text.slice(s.index, i + 1 < starts.length ? starts[i + 1].index : text.length) })) };
}

function bundleProblems(text) {
  const { marked, modules } = bundleModules(text);
  if (!marked) return [`${BUNDLE} carries no esbuild module markers, so its own code cannot be told from its packages`];
  const problems = [];
  for (const mod of modules) {
    const own = !mod.name.split('/').includes('node_modules') && mod.name !== '(esbuild runtime)';
    const allowed = (host) => host.startsWith('$') || LOCAL_HOST.test(host) || (MODULE_HOSTS[mod.name] || new Set()).has(host);
    if (own) {
      for (const m of mod.text.matchAll(URL_HOST)) {
        if (!allowed(hostOf(m[1]))) problems.push(`${BUNDLE} ${mod.name}: names the internet host ${hostOf(m[1])}`);
      }
    }
    for (const m of mod.text.matchAll(NETWORK_CALL)) {
      if (!allowed(hostOf(m[1]))) problems.push(`${BUNDLE} ${mod.name}: calls the internet host ${hostOf(m[1])}: ${excerpt(mod.text, m.index)}`);
    }
  }
  return [...new Set(problems)];
}

function offlineProblems(entries, zipBytes) {
  const problems = [];
  if (zipBytes >= IMPORT_LIMIT) problems.push(`the zip is ${zipBytes} bytes, not under the ${IMPORT_LIMIT}-byte workspace import limit`);
  const byName = new Map(entries.map((e) => [e.name, e.data]));
  for (const name of REQUIRED) if (!byName.has(name)) problems.push(`${name} is missing`);
  for (const { name, data } of entries) {
    const parts = name.split('/');
    if (parts.includes('node_modules')) problems.push(`${name}: node_modules must not ship`);
    if (INSTALL_FILES.has(parts[parts.length - 1])) problems.push(`${name}: Databricks Apps installs packages from the internet for this file`);
    if (WEB_FILE.test(name)) {
      const text = data.toString('utf8');
      for (const re of OUTSIDE_LOADS) {
        for (const m of text.matchAll(new RegExp(re.source, `${re.flags}g`))) problems.push(`${name}: loads from an outside host: ${excerpt(text, m.index)}`);
      }
    }
  }
  for (const name of ['start.sh', 'app.yaml']) {
    const text = byName.has(name) ? byName.get(name).toString('utf8') : '';
    const m = INSTALL_COMMAND.exec(text);
    if (m) problems.push(`${name}: runs ${m[1]}, which needs the internet`);
  }
  if (byName.has('start.sh') && !byName.get('start.sh').toString('utf8').includes(BUNDLE)) problems.push(`start.sh does not start ${BUNDLE}`);
  if (byName.has(BUNDLE)) problems.push(...bundleProblems(byName.get(BUNDLE).toString('utf8')));
  return [...new Set(problems)];
}

function zipEntries(zipPath) {
  const AdmZip = createRequire(path.join(APP, 'backend', 'package.json'))('adm-zip');
  return new AdmZip(zipPath).getEntries().filter((e) => !e.isDirectory).map((e) => ({ name: e.entryName, data: e.getData() }));
}

function checkZip(zipPath) {
  return offlineProblems(zipEntries(zipPath), fs.statSync(zipPath).size);
}

if (require.main === module) {
  const zip = process.argv[2];
  const problems = checkZip(zip);
  if (problems.length) {
    console.error(`${zip} cannot install or run in a workspace with no internet:\n${problems.map((p) => `  ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`${zip}: no install step and no outside host, ${fs.statSync(zip).size} bytes`);
}

module.exports = { BUNDLE, IMPORT_LIMIT, OUTSIDE_LOADS, bundleProblems, checkZip, offlineProblems, zipEntries };
