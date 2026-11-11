const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WIZARD = fs.readFileSync(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'pages', 'ImplementWizard.jsx'), 'utf8');

test('the wizard disables the build button while the source check refuses, with a plain reason beside it (must fail before the fix)', () => {
  const blocked = WIZARD.match(/const implementBlocked = ([\s\S]*?);\n/);
  assert.ok(blocked, 'implementBlocked is defined');
  assert.match(blocked[1], /sourceRefused/, 'implementBlocked includes the source refusal');
  assert.match(WIZARD, /const sourceRefused = preflight\?\.checks\?\.sources \? preflight\.checks\.sources\.ok === false : Boolean\(appUnreadable\)/, 'the preflight of the draft decides; the saved verdict only until it answers');
  assert.match(WIZARD, /data-source-refused=""/, 'a plain reason sits beside the build button');
  assert.doesNotMatch(WIZARD, /data-source-refused=""[^>]*>[^<]*(PERMISSION_DENIED|GRANT )/, 'the reason carries no raw error or GRANT');
});

test('the last step renders no build button while the source check refuses, only the plain reason (must fail before the fix)', () => {
  const lastStep = WIZARD.indexOf('{stepId !== \'notebook\' && !lastStep ? (');
  assert.ok(lastStep > 0, 'the footer picks Next or the build button by step');
  const footer = WIZARD.slice(lastStep, WIZARD.indexOf('</footer>', lastStep));
  assert.match(footer, /\) : sourceAccessRefused \? \(\s*<p data-source-refused=""[^>]*>\{SOURCE_REFUSED_REASON\}<\/p>\s*\) : \(\s*<button/, 'a refusal replaces the build button, it does not disable it');
  assert.match(WIZARD, /\bSOURCE_REFUSED_REASON\b/, 'both steps show the same reason');
  assert.equal((WIZARD.match(/The App cannot read its sources yet/g) || []).length, 0, 'the reason text lives in one place');
});

test('the wizard drops the previous preflight verdict when a new check starts, so no verdict shows before its check finishes (no flicker)', () => {
  const start = WIZARD.indexOf('setChecksBusy(true);');
  assert.ok(start > 0, 'the preflight effect starts a check');
  const body = WIZARD.slice(start, WIZARD.indexOf('const timer = setTimeout', start));
  assert.match(body, /setPreflight\(null\);/, 'the stale verdict is cleared before the new check runs');
});

test('the wizard names the build output table on every context call, so the context verdict never probes it as a source', () => {
  assert.match(WIZARD, /const contextQ = `\$\{q\}&result_table=\$\{encodeURIComponent\(spec\.config\?\.result_table \|\| ''\)\}`;/);
  const calls = WIZARD.match(/implement\/context\?\$\{[a-zA-Z]+\}/g) || [];
  assert.ok(calls.length >= 2, 'the context is fetched on load and on Grant');
  assert.deepEqual(calls.filter((c) => !c.endsWith('contextQ}')), [], 'every context call carries the output table');
});
