const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = path.resolve(__dirname, '..', '..', 'frontend', 'src');
const lib = (name) => import(pathToFileURL(path.join(SRC, name)).href);
const source = (name) => fs.readFileSync(path.join(SRC, name), 'utf8');

test('a run with PDF or Presentation and no document language is written in English, and a picked language is kept', async () => {
  const D = await lib('constants/documentLanguages.js');
  assert.equal(D.DEFAULT_DOCUMENT_LANGUAGE, 'English');
  assert.deepEqual(D.launchDocLanguages({ '09_generation_options': 'PDF Catalog', '12_documents_languages': '' }), ['English']);
  assert.deepEqual(D.launchDocLanguages({ '09_generation_options': 'Presentation', '12_documents_languages': undefined }), ['English']);
  assert.deepEqual(D.launchDocLanguages({ '09_generation_options': 'PDF Catalog', '12_documents_languages': 'Arabic' }), ['Arabic']);
  assert.deepEqual(D.launchDocLanguages({ '09_generation_options': 'Excel', '12_documents_languages': '' }), [], 'no documents, no language added');
  const page = source('pages/LaunchPage.jsx');
  assert.doesNotMatch(page, /Pick a document language/i);
  assert.match(page, /launchDocLanguages\(/);
});

test('a strategy saved last session is prefilled only when it is valid', () => {
  const page = source('pages/LaunchPage.jsx');
  assert.match(page, /validateStrategicContextText\(savedStrategy\)\.length/);
});

test('the output folder check blocks only a refusal: a failed call or an unclear answer lets Get Started go on with a note (must-exclude)', async () => {
  const O = await lib('lib/outputFolderCheck.js');
  const refused = O.outputCheckVerdict('/Users/someone@example.com/x', null, { status: 403, message: 'You cannot write to /Users/someone@example.com/x.' });
  assert.equal(refused.state, 'refused');
  const failed = O.outputCheckVerdict('/Users/someone@example.com/x', null, { status: 502, message: 'warehouse stopped' });
  assert.equal(failed.state, 'unchecked');
  assert.equal(failed.text, 'Inspire could not check the output folder (warehouse stopped). Get Started still works, and the run checks the folder again.');
  assert.equal(O.outputCheckVerdict('/x', { allowed: false }, null).state, 'unchecked');
  const passed = O.outputCheckVerdict('/Shared/demos', { allowed: true, folder: '/Users/someone@example.com/inspire_output', warnings: ['/Shared/demos is locked, so Inspire saves to /Users/someone@example.com/inspire_output.', ''] }, null);
  assert.deepEqual([passed.state, passed.folder, passed.warnings], ['passed', '/Users/someone@example.com/inspire_output', ['/Shared/demos is locked, so Inspire saves to /Users/someone@example.com/inspire_output.']]);
  assert.match(source('lib/outputFolderCheck.js'), /ready: current\.state === 'passed' \|\| current\.state === 'unchecked'/);
});

test('a readiness or output check call that fails goes on with a note, and only a refusal of the person still blocks (must-exclude)', async () => {
  const W = await lib('lib/implementWizard.js');
  assert.equal(W.checkCallRefused({ status: 403 }), true);
  assert.equal(W.checkCallRefused({ status: 401 }), true);
  assert.equal(W.checkCallRefused({ status: 500 }), false);
  assert.equal(W.checkCallRefused(new TypeError('Failed to fetch')), false);
  const uncounted = W.uncountedReadiness({ table: 'main.s.orders' });
  assert.equal(W.readinessText(uncounted, { table: 'main.s.orders' }), 'Inspire could not count the rows in main.s.orders. You can go on; the preview run checks the data.');
  assert.ok(W.readinessText(uncounted, { table: 'main.s.orders' }).split(/\s+/).length <= 20);
  assert.equal(W.outputUncheckedText('main.inspire.out', { message: 'timeout' }), 'Inspire could not check that you can write main.inspire.out (timeout). You can go on; the build checks it again.');
  const page = source('pages/ImplementWizard.jsx');
  assert.equal((page.match(/if \(checkCallRefused\(e\)\) throw e;/g) || []).length, 2, 'only a refusal stops each check');
  assert.match(page, /uncountedReadiness\(/);
  assert.match(page, /outputUncheckedText\(/);
});

test('the wizard sends keep for the built version when no choice was made, and names the asks the server builds without', async () => {
  const W = await lib('lib/implementWizard.js');
  const spec = W.defaultSpecFromUseCase({ id: 'N01-U01', use_case: 'Predict churn', primary_table: 'main.s.orders', tables_involved: 'main.s.orders' }, { warehouseId: 'wh1', inspireDatabase: 'main.inspire', sessionId: '1' });
  const vibed = { ...spec, vibes: 'Add a region filter\ndelete source rows from main.s.orders' };
  const sent = W.sentSpec(vibed, null, 2);
  assert.equal(sent.vibe_previous, 'keep');
  assert.equal(sent.vibes, vibed.vibes, 'the server takes the skipped asks out, so it can name them after the build');
  assert.match(W.skippedAsksText(vibed), /^Inspire builds without this ask: “delete source rows from main\.s\.orders”/);
  assert.equal(W.sentSpec({ ...vibed, vibe_previous: 'remove' }, null, 2).vibe_previous, 'remove');
  assert.equal(W.sentSpec(vibed, null, null).vibe_previous, undefined, 'a first build has no version before it');
  assert.ok(source('components/VibesEditor.jsx').includes('const value = picked || VIBE_PREVIOUS_DEFAULT;'));
  assert.equal(W.VIBE_PREVIOUS_DEFAULT, 'keep');
});

test('the Build page and the Run page show what Inspire changed to start, and the wizard runs the role and look fixes on their own', () => {
  assert.match(source('pages/ImplementPage.jsx'), /setBuildNotes\(Array\.isArray\(data\?\.warnings\) \? data\.warnings : \[\]\)/);
  assert.match(source('pages/ImplementPage.jsx'), /data-build-notes/);
  assert.ok(source('pages/ImplementPage.jsx').includes("setNotice([resultTableMoveNote(data?.summary), ...(Array.isArray(data?.warnings) ? data.warnings : [])].filter(Boolean).join(' '));"));
  assert.match(source('pages/MonitorPage.jsx'), /data-testid="launch-notes"/);
  const wizard = source('pages/ImplementWizard.jsx');
  assert.match(wizard, /withoutMissingRoles\(spec, columnsByTable\)/);
  assert.match(wizard, /withAppLookDefaults\(prev, look\)/);
});
