#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.join(root, 'backend');
const backendRequire = createRequire(path.join(backend, 'package.json'));
const { BUNDLE_FILE } = backendRequire('./lib/appPaths');
const NOTICES_FILE = path.join(path.dirname(BUNDLE_FILE), 'THIRD_PARTY_NOTICES');
const SWAGGER_FROM = path.join(backend, 'node_modules', 'swagger-ui-dist');
const SWAGGER_TO = path.join(path.dirname(BUNDLE_FILE), 'swagger-ui');
const SWAGGER_FILES = ['swagger-ui-bundle.js', 'swagger-ui.css', 'LICENSE', 'NOTICE'];
const LICENSE_FILE = /^(licen[cs]e|copying)(\.(md|txt|markdown))?$/i;
const PACKAGE_DIR = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//;

let esbuild;
try {
  esbuild = backendRequire('esbuild');
} catch (e) {
  console.error(`esbuild is not installed in ${backend}: run npm ci there (package-for-workspace.sh does it unless SKIP_BUILD=1). ${e.message}`);
  process.exit(1);
}

function packageNotice(dir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(backend, dir, 'package.json'), 'utf8'));
  const licenseFile = fs.readdirSync(path.join(backend, dir)).find((name) => LICENSE_FILE.test(name));
  if (!pkg.license && !licenseFile) throw new Error(`${pkg.name} names no license and carries no license file`);
  const text = licenseFile ? fs.readFileSync(path.join(backend, dir, licenseFile), 'utf8').trim() : `No license file ships with this package; its package.json names ${pkg.license}.`;
  return { name: pkg.name, version: pkg.version, license: pkg.license || 'see text', text };
}

fs.rmSync(path.dirname(BUNDLE_FILE), { recursive: true, force: true });
const result = await esbuild.build({
  absWorkingDir: backend,
  entryPoints: ['server.js'],
  outfile: BUNDLE_FILE,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  legalComments: 'none',
  metafile: true,
  logLevel: 'warning',
});
const dirs = [...new Set(Object.keys(result.metafile.inputs).map((file) => (PACKAGE_DIR.exec(file) || [])[1]).filter(Boolean))].sort();
const notices = dirs.map(packageNotice);
fs.writeFileSync(NOTICES_FILE, `${notices.map((n) => `${n.name} ${n.version} (${n.license})\n\n${n.text}\n`).join('\n\n')}`, 'utf8');
const missing = SWAGGER_FILES.filter((file) => !fs.existsSync(path.join(SWAGGER_FROM, file)));
if (missing.length) {
  console.error(`swagger-ui-dist in ${SWAGGER_FROM} lacks ${missing.join(', ')}: run npm ci there (package-for-workspace.sh does it unless SKIP_BUILD=1).`);
  process.exit(1);
}
fs.mkdirSync(SWAGGER_TO, { recursive: true });
for (const file of SWAGGER_FILES) fs.copyFileSync(path.join(SWAGGER_FROM, file), path.join(SWAGGER_TO, file));
console.log(`Wrote ${BUNDLE_FILE} (${fs.statSync(BUNDLE_FILE).size} bytes, ${notices.length} packages), ${NOTICES_FILE} and ${SWAGGER_TO}`);
