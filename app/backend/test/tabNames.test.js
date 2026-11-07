const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fileNames } = require('./support/sourceFiles');
const { pathToFileURL } = require('node:url');

const APP = path.resolve(__dirname, '..', '..');
const tabs = () => import(pathToFileURL(path.join(APP, 'frontend', 'src', 'lib', 'tabs.js')).href);
const showcase = () => import(pathToFileURL(path.join(APP, 'frontend', 'src', 'lib', 'showcase.js')).href);

function sources() {
  const files = [];
  const walk = (dir, ext) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, ext);
      else if (entry.isFile() && ext.test(entry.name)) files.push(full);
    }
  };
  walk(path.join(APP, 'frontend', 'src'), /\.(jsx?|mjs)$/);
  walk(path.join(APP, 'backend', 'lib'), /\.js$/);
  walk(path.join(APP, 'scripts'), /\.(mjs|js)$/);
  for (const name of fileNames(path.join(APP, 'backend'))) if (name.endsWith('.js')) files.push(path.join(APP, 'backend', name));
  return files;
}

test('the top tabs read Home, Start, Monitor, Review, Build and Run, in that order, and the header renders that one list', async () => {
  const { APP_TABS, HOME_TAB, NAV_TABS } = await tabs();
  assert.deepEqual(APP_TABS.map((t) => [t.id, t.label]),
    [['choose', 'Start'], ['monitor', 'Monitor'], ['results', 'Review'], ['implement', 'Build'], ['run', 'Run']]);
  assert.deepEqual(HOME_TAB, { id: 'landing', label: 'Home' });
  assert.deepEqual(NAV_TABS, [HOME_TAB, ...APP_TABS], 'Home comes first, and the pipeline tabs follow it unchanged');
  const header = fs.readFileSync(path.join(APP, 'frontend', 'src', 'components', 'Header.jsx'), 'utf8');
  assert.match(header, /import \{ NAV_TABS \} from '\.\.\/lib\/tabs'/);
  assert.doesNotMatch(header, /label: '/, 'the header keeps no tab names of its own');
});

test('no text in the App, its backend or its scripts names a tab that no longer exists', async () => {
  const { APP_TABS, REMOVED_TAB_LABELS } = await tabs();
  const live = APP_TABS.map((t) => t.label);
  for (const gone of REMOVED_TAB_LABELS) assert.equal(live.includes(gone), false, `${gone} is no longer a tab`);
  const patterns = REMOVED_TAB_LABELS.flatMap((label) => [
    new RegExp(`\\b${label} ([Pp]age|[Tt]ab)\\b`),
    new RegExp(`\\b(from|in|go to|open|Open) ${label}\\b`),
  ]);
  const found = [];
  for (const file of sources()) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (patterns.some((re) => re.test(line))) found.push(`${path.relative(APP, file)}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(found, []);
});

test('the demo button reads See Demo, and the recorder clicks the label the App shows instead of a copy of it', async () => {
  const { SHOWCASE_BUTTON } = await showcase();
  assert.equal(SHOWCASE_BUTTON, 'See Demo');
  const recorder = fs.readFileSync(path.join(APP, 'scripts', 'showcaseRecorder.mjs'), 'utf8');
  assert.match(recorder, /import \{ SHOWCASE_BUTTON \} from '\.\.\/frontend\/src\/lib\/showcase\.js'/);
  assert.match(recorder, /getByRole\('button', \{ name: SHOWCASE_BUTTON, exact: true \}\)/);
  for (const file of sources()) assert.equal(fs.readFileSync(file, 'utf8').includes('See Demo Results'), false, path.relative(APP, file));
});
