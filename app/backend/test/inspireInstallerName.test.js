const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const SKIPPED = new Set(['node_modules', '.git']);
const BINARY = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.woff', '.woff2', '.ttf', '.zip', '.dbc']);
const OLD_NAMES = new RegExp([['installer', 'workspace'].join('_'), ['installer', 'Workspace'].join(''), ['Installer', 'Workspace'].join('')].join('|'));
const EMBEDDED = new Set(['notebook_bundle.js', 'demo_notebook_bundle.js']);

function textsOf(file) {
  const text = fs.readFileSync(file, 'utf8');
  const encoded = EMBEDDED.has(path.basename(file)) && /module\.exports = "([A-Za-z0-9+/=]+)"/.exec(text);
  return [['', text]].concat(encoded ? [[' embedded', Buffer.from(encoded[1], 'base64').toString('utf8')]] : []);
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (SKIPPED.has(entry.name)) return [];
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() ? [full] : [];
  });
}

function oldNameSites(files) {
  return files.flatMap((file) => {
    const sites = OLD_NAMES.test(path.basename(file)) ? [`${path.relative(REPO, file)}: file name`] : [];
    if (BINARY.has(path.extname(file).toLowerCase())) return sites;
    return sites.concat(textsOf(file).flatMap(([where, text]) => text.split('\n').flatMap((line, i) =>
      (OLD_NAMES.test(line) ? [`${path.relative(REPO, file)}${where}:${i + 1}`] : []))));
  });
}

test('the installer is inspire_installer.py at the repo root and no file names it by its old name', () => {
  assert.ok(fs.existsSync(path.join(REPO, 'inspire_installer.py')), 'inspire_installer.py is at the repo root');
  const files = walk(REPO);
  assert.ok(files.some((file) => file.endsWith(path.join('frontend', 'dist', 'index.html'))), 'the built frontend is scanned too');
  assert.deepEqual(oldNameSites(files), []);
});

test('the scan skips node_modules and .git when they are symlinks, as worktrees link them', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'inspire-name-'));
  const target = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'inspire-name-target-'));
  const old = ['installer', 'workspace'].join('_');
  fs.mkdirSync(path.join(target, 'pkg'));
  fs.writeFileSync(path.join(target, 'pkg', `${old}.js`), `${old}\n`);
  fs.mkdirSync(path.join(dir, 'app'));
  fs.symlinkSync(target, path.join(dir, 'app', 'node_modules'), 'dir');
  fs.symlinkSync(target, path.join(dir, '.git'), 'dir');
  fs.writeFileSync(path.join(dir, 'app', 'kept.txt'), 'fine\n');
  try {
    const files = walk(dir).map((file) => path.relative(dir, file));
    assert.deepEqual(files, [path.join('app', 'kept.txt')]);
    assert.deepEqual(oldNameSites(walk(dir)), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('the old-name scan finds the old name in a file name, a line of text and a built bundle', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'inspire-name-'));
  const old = ['installer', 'workspace'].join('_');
  fs.writeFileSync(path.join(dir, `${old}.py`), 'print(1)\n');
  fs.writeFileSync(path.join(dir, 'notes.md'), `run\n${old}.py once\n`);
  fs.writeFileSync(path.join(dir, 'index-x.js'), `const a="${['installer', 'Workspace'].join('')}";`);
  fs.writeFileSync(path.join(dir, 'logo.png'), old);
  fs.writeFileSync(path.join(dir, 'demo_notebook_bundle.js'), `module.exports = ${JSON.stringify(Buffer.from(`# x\nrun ${old}.py\n`).toString('base64'))};\n`);
  const sites = oldNameSites(walk(dir)).map((site) => site.replace(path.relative(REPO, dir) + path.sep, ''));
  assert.deepEqual(sites.sort(), ['demo_notebook_bundle.js embedded:2', 'index-x.js:1', `${old}.py: file name`, 'notes.md:2']);
  fs.rmSync(dir, { recursive: true, force: true });
});
