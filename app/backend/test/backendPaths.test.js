const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { fileNames } = require('./support/sourceFiles');
const { APP_DIR, APP_FILES, APP_FILES_WHEN_PRESENT, BACKEND_DIR, BUNDLE_FILE } = require('../lib/appPaths');

const RUNTIME_FILES = ['server.js', 'implementRoutes.js', 'stripAiDisclaimer.js', ...fileNames(path.join(BACKEND_DIR, 'lib')).map((f) => `lib/${f}`)]
  .filter((f) => f.endsWith('.js'));
const NOT_SHIPPED = new Set(['.env', '../.env', 'backend/.env', 'backend/.notebook_publish_sig', 'backend/dbx_inspire_ai_agent.ipynb', 'backend/node_modules/swagger-ui-dist']);
const APP_DIR_JOIN = /path\.(?:join|resolve)\(\s*(APP_DIR|BACKEND_DIR)\b([^)]*)\)/g;

function unshippedReads(files, shipped) {
  const problems = [];
  for (const [name, text] of files) {
    const named = Object.fromEntries([...text.matchAll(/^const (\w+) = '([^']*)';$/gm)].map((m) => [m[1], m[2]]));
    for (const [call, base, rest] of text.matchAll(APP_DIR_JOIN)) {
      const parts = rest.split(',').map((arg) => arg.trim()).filter(Boolean)
        .map((arg) => (/^'[^']*'$/.test(arg) ? arg.slice(1, -1) : named[arg]));
      if (parts.some((part) => part === undefined)) {
        problems.push(`${name}: cannot tell which file ${call} reads`);
        continue;
      }
      const rel = path.posix.join(base === 'APP_DIR' ? '.' : 'backend', ...parts);
      if (!NOT_SHIPPED.has(rel) && !shipped.some((item) => rel === item || rel.startsWith(`${item}/`))) problems.push(`${name}: ${rel} is not in the App zip`);
    }
  }
  return problems;
}

const SWAGGER_SHA256 = {
  'swagger-ui-bundle.js': 'c50b94bbc4f02394326fb7aed1f4fb693b3677f4b3d3344e0d6131808cbf281f',
  'swagger-ui.css': '8f33d996025317049d4a9864f421eab2b2a247872f388026fa94c654913259e7',
  LICENSE: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
  NOTICE: '0d20d1adef18aee3f40dd258172155521ce702ac445cb5f7b7d60ed32dad2fb2',
};

test('backend runtime code finds files only through lib/appPaths.js and reads the notebook data from disk', () => {
  assert.equal(BACKEND_DIR, path.resolve(__dirname, '..'));
  assert.equal(APP_DIR, path.resolve(__dirname, '..', '..'));
  assert.equal(BUNDLE_FILE, path.join(BACKEND_DIR, 'build', 'server.js'));
  const DIRNAME = /\b__(dirname|filename)\b/;
  const INLINED = /require\(\s*['"`][^'"`]*bundle['"`]\s*\)/;
  assert.ok(DIRNAME.test("path.resolve(__dirname, '..', 'showcase')") && INLINED.test("require('../notebook_bundle')"), 'the probes catch the old forms');
  const hits = RUNTIME_FILES.filter((f) => f !== 'lib/appPaths.js').flatMap((f) => fs.readFileSync(path.join(BACKEND_DIR, f), 'utf8').split('\n')
    .map((line, i) => (DIRNAME.test(line) || INLINED.test(line) ? `${f}:${i + 1}: ${line.trim()}` : null)).filter(Boolean));
  assert.deepEqual(hits, []);
});

test('every file the backend reads from the App folder ships in the App zip, from the one list package-for-workspace.sh stages', () => {
  const shipped = [...APP_FILES, ...APP_FILES_WHEN_PRESENT];
  assert.ok(APP_FILES_WHEN_PRESENT.includes('backend/showcase'), 'demo recordings ship when present');
  const probes = [
    ['lib/a.js', "const SHOWCASE_DIR = path.join(BACKEND_DIR, 'showcase');"],
    ['lib/b.js', "const FILE = 'x.ipynb';\nconst P = path.join(APP_DIR, FILE);"],
    ['lib/c.js', 'const P = path.join(BACKEND_DIR, pick());'],
    ['lib/d.js', "const P = path.join(APP_DIR, 'frontend', 'dist', 'index.html');"],
  ];
  assert.deepEqual(unshippedReads(probes, ['frontend/dist']), [
    'lib/a.js: backend/showcase is not in the App zip',
    'lib/b.js: x.ipynb is not in the App zip',
    'lib/c.js: cannot tell which file path.join(BACKEND_DIR, pick() reads',
  ]);
  const files = RUNTIME_FILES.filter((f) => f !== 'lib/appPaths.js').map((f) => [f, fs.readFileSync(path.join(BACKEND_DIR, f), 'utf8')]);
  const reads = files.flatMap(([, text]) => [...text.matchAll(APP_DIR_JOIN)]).length;
  assert.ok(reads >= 15, `${reads} reads found`);
  assert.deepEqual(unshippedReads(files, shipped), []);
  const script = fs.readFileSync(path.join(APP_DIR, 'scripts', 'package-for-workspace.sh'), 'utf8');
  assert.match(script, /require\('\$APP_ROOT\/backend\/lib\/appPaths\.js'\)\.\$1/);
  assert.match(script, /APP_FILES="\$\(app_files APP_FILES\)"/);
  assert.match(script, /APP_FILES_WHEN_PRESENT="\$\(app_files APP_FILES_WHEN_PRESENT\)"/);
  const keptList = (text) => text.split('\n').map((line) => line.trim()).filter((line) => shipped.includes(line));
  assert.deepEqual(keptList('RUNTIME_FILES=(\n  app.yaml\n  frontend/dist\n)'), ['app.yaml', 'frontend/dist'], 'the probe catches a list kept in the script');
  assert.deepEqual(keptList(script), [], 'the zip list lives only in lib/appPaths.js');
});

test('Swagger UI is the pinned 5.18.2 release with its license, its analytics install step is off, and the docs page loads it from the App', () => {
  for (const [file, sha] of Object.entries(SWAGGER_SHA256)) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(BACKEND_DIR, 'node_modules', 'swagger-ui-dist', file))).digest('hex'), sha, file);
  }
  const lock = JSON.parse(fs.readFileSync(path.join(BACKEND_DIR, 'package-lock.json'), 'utf8')).packages;
  assert.equal(lock['node_modules/swagger-ui-dist'].version, '5.18.2');
  assert.equal(lock['node_modules/swagger-ui-dist'].dev, true);
  assert.equal(lock['node_modules/swagger-ui-dist'].resolved, 'https://registry.npmjs.org/swagger-ui-dist/-/swagger-ui-dist-5.18.2.tgz');
  const pkg = JSON.parse(fs.readFileSync(path.join(BACKEND_DIR, 'package.json'), 'utf8'));
  assert.equal(pkg.devDependencies['swagger-ui-dist'], '5.18.2');
  assert.deepEqual(pkg.scarfSettings, { enabled: false }, 'the @scarf/scarf install step under swagger-ui-dist sends nothing');
  assert.equal('swagger-ui-dist' in pkg.dependencies, false);
  const page = fs.readFileSync(path.join(BACKEND_DIR, 'api-docs.html'), 'utf8');
  const refs = page.match(/(?:src|href)="[^"]+"/g);
  assert.deepEqual(refs.filter((ref) => !/^(src|href)="\/([^/]|$)/.test(ref)), [], 'every link and load on the docs page is an App path');
  assert.ok(refs.includes('href="/api-docs/swagger-ui.css"') && refs.includes('src="/api-docs/swagger-ui-bundle.js"'));
  assert.match(page, /validatorUrl: null,/);
  const server = fs.readFileSync(path.join(BACKEND_DIR, 'server.js'), 'utf8');
  assert.match(server, /const SWAGGER_UI_DIR = \[path\.join\(BACKEND_DIR, 'build', 'swagger-ui'\), path\.join\(BACKEND_DIR, 'node_modules', 'swagger-ui-dist'\)\]/);
  assert.match(server, /\? express\.static\(SWAGGER_UI_DIR, \{ index: false, redirect: false, setHeaders: staticHeaders \}\)/);
});
