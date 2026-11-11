const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const FRONT = path.resolve(__dirname, '..', '..', 'frontend', 'src');
const WIZARD = fs.readFileSync(path.join(FRONT, 'pages', 'ImplementWizard.jsx'), 'utf8');

function sentences(text) {
  return String(text).split(/(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean);
}

test('the App read sentence on the Build page is one plain sentence with no GRANT and no owner address (REQ-041, must fail before the fix)', async () => {
  const W = await import(pathToFileURL(path.join(FRONT, 'lib', 'implementWizard.js')).href);
  const reads = { tables: [{ table: 'main.s.orders', owner: 'your data owner', grants: ['GRANT SELECT ON TABLE `main`.`s`.`orders` TO `app-sp`;'] }] };
  const text = W.appReadsText(reads, 'riverside-assets');
  assert.equal(sentences(text).length, 1, `one sentence: ${text}`);
  assert.doesNotMatch(text, /GRANT|PERMISSION_DENIED|@/);
  assert.match(text, /^The build finished, but the App riverside-assets cannot read this table, so its pages show no data from it yet/);
});

test('the Build page card renders the offer sentence through PlainMessage and keeps the grant SQL under Details (REQ-041)', () => {
  const SHARED = fs.readFileSync(path.join(FRONT, 'components', 'AppReadAccess.jsx'), 'utf8');
  const body = SHARED.slice(SHARED.indexOf('export function AppReadAccess('));
  assert.match(body, /<PlainMessage text=\{offer\.text\}/, 'the offer goes through PlainMessage, which moves statements and codes to Details');
  assert.doesNotMatch(body, /<p className="text-text-secondary">\{offer\.text\}<\/p>/, 'the raw offer text is not rendered as a paragraph');
  assert.match(body, /<TechnicalDetails items=\{offer\.grants\} \/>/, 'the grant SQL sits under Details');
  assert.doesNotMatch(body, /<GrantList/, 'no grant list is shown outside Details');
});

test('Check again re-reads the live source verdict and the preflight replaces it, so no earlier refusal outlives the check (REQ-042, must fail before the fix)', () => {
  const start = WIZARD.indexOf('const checkAgain = async () => {');
  assert.ok(start > 0, 'Check again is an async re-read, not only a counter bump');
  const body = WIZARD.slice(start, WIZARD.indexOf('const footerRetry', start));
  assert.match(body, /apiFetch\(`\/api\/inspire\/implement\/context\?\$\{contextQ\}`\)/, 'it fetches the live context');
  assert.match(body, /setAppUnreadable\(data\.app_unreadable \|\| null\)/, 'the live verdict replaces the stored one');
  assert.match(body, /setGrantRound\(\(n\) => n \+ 1\)/, 'and the preflight runs again');
  assert.match(WIZARD, /if \(pre\.status === 'fulfilled'\) setAppUnreadable\(pre\.value\.app_unreadable \|\| null\);/, 'the preflight verdict carries the live App offer');
});

test('no Build button sits beside a source refusal (REQ-042, MVP-ADP-08, must fail before the fix)', () => {
  const button = WIZARD.indexOf('data-build-now=""');
  assert.ok(button > 0);
  const opening = WIZARD.lastIndexOf('{mode === \'mvp\' && stepIndex > 0 && !lastStep', button);
  assert.match(WIZARD.slice(opening, button), /!sourceRefused/, 'the Build button is not rendered while the source is refused');
});
