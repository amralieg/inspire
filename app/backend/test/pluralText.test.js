const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { plural } = require('../lib/plural');
const HELD = require('./fixtures/implement_held_cases.json');
const RELEASED = require('./fixtures/released_main_texts.json');

const APP = path.resolve(__dirname, '..', '..');
const REPO = path.resolve(APP, '..');
const espree = createRequire(path.join(APP, 'frontend', 'package.json'))('espree');
const HEDGE = /[A-Za-z]+\((?:s|es|ies)\)/;
const RELEASED_REASON = 'released main 4407364 text';
const PARSED_RELEASED_TEXTS = [];
const SOURCES = [
  ['app/backend', ['.js', '.py']],
  ['app/frontend', ['.js', '.jsx', '.mjs', '.html']],
  ['app/scripts', ['.js', '.mjs', '.sh']],
];
const SOURCE_FILES = ['app/dbx_generate_demo_data.py', 'app/dbx_inspire_after_demo.py', 'app/start.sh', 'inspire_installer.py'];
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'build', 'test', 'public']);
const GENERATED = new Set(['notebook_bundle.js', 'demo_notebook_bundle.js']);
const JS_TEXT_TOKENS = new Set(['String', 'Template', 'JSXText']);
const PY_TOKEN = /#[^\n]*|[rRbBuUfF]{0,2}("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')/g;

function walk(dir, extensions) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : walk(full, extensions);
    return extensions.includes(path.extname(entry.name)) && !GENERATED.has(entry.name) ? [full] : [];
  });
}

function sourceFiles() {
  return [...SOURCES.flatMap(([dir, extensions]) => walk(path.join(REPO, dir), extensions)), ...SOURCE_FILES.map((file) => path.join(REPO, file))];
}

function hit(origin, line, text) {
  const found = HEDGE.exec(text);
  return found ? [{ at: `${origin}:${line}`, hedge: found[0], text }] : [];
}

function jsTokens(source) {
  let failure = null;
  for (const sourceType of ['module', 'commonjs']) {
    try {
      return espree.tokenize(source, { ecmaVersion: 'latest', sourceType, ecmaFeatures: { jsx: true }, loc: true });
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}

function jsHedges(source, origin) {
  return jsTokens(source).flatMap((token) => {
    if (token.type === 'RegularExpression') return hit(origin, token.loc.start.line, token.regex.pattern.replace(/\\([()])/g, '$1'));
    return JS_TEXT_TOKENS.has(token.type) ? hit(origin, token.loc.start.line, token.value) : [];
  });
}

function pyHedges(source, origin) {
  return [...source.matchAll(PY_TOKEN)].flatMap((match) => (match[1] === undefined ? []
    : hit(origin, source.slice(0, match.index).split('\n').length, match[1])));
}

function textHedges(source, origin) {
  return source.split('\n').flatMap((line, i) => hit(origin, i + 1, line));
}

function hedgesIn(file, source = fs.readFileSync(file, 'utf8')) {
  const origin = path.relative(REPO, file);
  const extension = path.extname(file);
  if (['.js', '.jsx', '.mjs', '.cjs'].includes(extension)) return jsHedges(source, origin);
  return extension === '.py' ? pyHedges(source, origin) : textHedges(source, origin);
}

function unexplained(found, allowed) {
  return found.filter((h) => !allowed.some((a) => a.reason === RELEASED_REASON && h.text.includes(a.text)));
}

test('no App source text hedges a plural with (s), but for a text the App parses from released main 4407364 rows', () => {
  const files = sourceFiles();
  const count = (extensions) => files.filter((f) => extensions.includes(path.extname(f))).length;
  assert.ok(count(['.js', '.jsx', '.mjs']) >= 100, `scanned ${count(['.js', '.jsx', '.mjs'])} JavaScript files`);
  assert.ok(count(['.py']) >= 4 && count(['.sh']) >= 3 && count(['.html']) >= 1, files.join('\n'));
  assert.ok(files.includes(path.join(REPO, 'inspire_installer.py')) && files.some((f) => f.endsWith(path.join('frontend', 'src', 'pages', 'ImplementWizard.jsx'))));
  assert.ok(!files.some((f) => /[/\\](node_modules|dist|test)[/\\]/.test(f) || GENERATED.has(path.basename(f))), 'no dependency, build, test or generated bundle');
  const found = files.flatMap((file) => hedgesIn(file));
  assert.deepEqual(unexplained(found, PARSED_RELEASED_TEXTS).map((h) => `${h.at}: ${h.hedge} in ${h.text.slice(0, 120)}`), [],
    'every count names its noun through plural() from lib/plural.js, or the sentence needs no count');
});

test('the allow list holds only texts released main 4407364 writes, each with that reason', () => {
  const released = JSON.stringify(RELEASED);
  for (const allowed of PARSED_RELEASED_TEXTS) {
    assert.equal(allowed.reason, RELEASED_REASON, allowed.text);
    assert.ok(released.includes(JSON.stringify(allowed.text).slice(1, -1)), `${allowed.text} is not a released main 4407364 text`);
  }
});

const planted = (name, source) => hedgesIn(path.join(REPO, name), source).map((h) => h.hedge);

test('the scan catches a planted hedge in a string, a template, JSX text and attributes, a regex, Python and HTML', () => {
  assert.deepEqual(planted('x.js', "log('wrote ' + n + ' row(s)');"), ['row(s)']);
  assert.deepEqual(planted('x.js', 'const t = `${n} batch(es) done`;'), ['batch(es)']);
  assert.deepEqual(planted('x.jsx', 'const p = <p>{n} alert(s) could not be read</p>;'), ['alert(s)']);
  assert.deepEqual(planted('x.jsx', 'const p = <b title="2 entry(ies)">x</b>;'), ['entry(ies)']);
  assert.deepEqual(planted('x.js', 'const R = /; (\\d+) ask\\(s\\) no part can do$/;'), ['ask(s)']);
  assert.deepEqual(planted('x.mjs', 'console.log(`ok (${rows} catalog row(s) via warehouse)`);'), ['row(s)']);
  assert.deepEqual(planted('x.py', 'print(f"  Removed {len(removed)} older bundle item(s) under {root}")'), ['item(s)']);
  assert.deepEqual(planted('x.py', 'SOURCE = """\nwrote {n} row(s)\n"""'), ['row(s)']);
  assert.deepEqual(planted('x.sh', 'echo "removed $n file(s)"'), ['file(s)']);
  assert.deepEqual(planted('x.html', '<p>3 item(s) left</p>'), ['item(s)']);
});

test('the scan leaves code, comments and real plurals alone', () => {
  assert.deepEqual(planted('x.js', 'rows.map((s) => keyOf(s)).filter((s) => trim(s) && s); stripAiDemoDisclaimerHtml(s);'), []);
  assert.deepEqual(planted('x.js', "const t = `${plural(n, 'row')} left`; const u = '(see the rows above)'; // 2 row(s)\n/* a row(s) */"), []);
  assert.deepEqual(planted('x.jsx', 'const p = <p>{plural(n, "alert")} could not be read</p>;'), []);
  assert.deepEqual(planted('x.py', 'n = len(s)  # row(s)\nnames = [f(s) for s in x]\nprint(f"{_plural(n, \'item\')}")'), []);
});

test('an allowed released text passes only with the released main reason, and anything else is still reported', () => {
  const found = hedgesIn(path.join(REPO, 'x.js'), "const a = 'ready: preview wrote 3 row(s)';");
  assert.equal(found.length, 1);
  assert.deepEqual(unexplained(found, [{ text: 'preview wrote 3 row(s)', reason: RELEASED_REASON }]), []);
  assert.equal(unexplained(found, [{ text: 'preview wrote 3 row(s)', reason: 'an older build text' }]).length, 1);
  assert.equal(unexplained(found, [{ text: 'wrote 4 row(s)', reason: RELEASED_REASON }]).length, 1);
});

test('plural writes the count and the words that agree with it at 0, 1 and 2, as the agent inspire_plural does, on both sides', async () => {
  const front = (await import(pathToFileURL(path.join(APP, 'frontend', 'src', 'lib', 'plural.js')).href)).plural;
  assert.deepEqual([0, 1, 2].map((n) => plural(n, 'row')), ['0 rows', '1 row', '2 rows']);
  assert.deepEqual([0, 1, 2].map((n) => plural(n, 'more widget keeps its default', 'more widgets keep their defaults')),
    ['0 more widgets keep their defaults', '1 more widget keeps its default', '2 more widgets keep their defaults']);
  assert.equal(plural('1', 'row'), '1 row', 'a count read from a table row as text');
  assert.ok(HELD.plural.length >= 20, HELD.source);
  for (const [n, one, many, agent] of HELD.plural) {
    assert.equal(plural(n, one, many ?? undefined), agent, `${n} ${one}: ${HELD.source}`);
    assert.equal(front(n, one, many ?? undefined), agent, `${n} ${one}: the frontend helper`);
  }
});
