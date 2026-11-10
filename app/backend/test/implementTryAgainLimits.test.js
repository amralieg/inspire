const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);
const PAIR = ['Make the App header dark green.', 'Make the App header bright orange, never green.'];

test('Try again on a failed version whose asks conflict builds without the two asks and names them', async () => {
  const W = await lib('implementWizard.js');
  const failed = { spec_version: 3, status: 'failed', spec_json: { use_case_id: 'N01-U01', outputs: { app: true }, data: {}, vibes: [...PAIR, 'Sort the rows by risk.'].join('\n'), vibe_previous: 'keep' } };
  const next = W.nextSpecFrom(failed, W.buildAgainChanges(failed));
  assert.deepEqual(W.vibesProblems(next, 2), []);
  assert.equal(W.withoutSkippedAsks(next).vibes, 'Sort the rows by risk.');
  assert.match(W.skippedAsksText(next), /^Inspire builds without these 2 asks: “Make the App header dark green\.” and “Make the App header bright orange, never green\.” ask for opposite things\.$/);
  const fine = { ...failed, spec_json: { ...failed.spec_json, vibes: 'Make the App header dark green.\nSort the rows by risk.' } };
  assert.equal(W.skippedAsksText(W.nextSpecFrom(fine, W.buildAgainChanges(fine))), '');
});

test('an ask that rules a value out conflicts only with an ask that sets that value on the same thing', async () => {
  const { vibeConflicts } = await lib('vibeLimits.js');
  for (const asks of [PAIR, ['Make the header green', 'Make the header not green'], ['Show the churn chart', 'Remove the churn chart']]) {
    assert.equal(vibeConflicts(asks).length, 1, asks.join(' | '));
  }
  for (const asks of [['Make the App header dark green.', 'Make the footer blue, never green.'], ['Show revenue in green', 'Show costs in red, never green'],
    ['Color the bars green', 'Never use red'], ['Make the App header dark green.', 'Make the App header bright orange, never red.']]) {
    assert.deepEqual(vibeConflicts(asks), [], asks.join(' | '));
  }
});

test('every Try again and every Rebuild on the Build page goes through the one checked submit', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'pages', 'ImplementPage.jsx'), 'utf8');
  assert.equal(page.includes('submitNext(buildAgainChanges(latest))'), false, 'no Try again skips the limits check');
  assert.match(page, /const submitChecked = async \(next\) => \{\n\s+const problems = vibesProblems\(next, builtOn\);/);
  assert.match(page, /const sendAgain = async \(\) => \{\n\s+if \(!terminal\) return submitChecked\(nextSpecFrom\(latest, buildAgainChanges\(latest\)\)\);\n\s+openFeatures\(\);\n\s+setRebuildError\(TERMINAL_NEEDS_CHANGE\);\n\s+return false;/,
    'a terminal failure is never sent again unchanged');
  assert.match(page, /if \(choice\.changes\) return submitChecked\(nextSpecFrom\(latest, \{ \.\.\.buildAgainChanges\(latest\), \.\.\.choice\.changes \}\)\);/,
    'a failure choice goes through the checked submit');
  assert.equal((page.match(/sendAgain\(\)/g) || []).length, 3, 'the banner, the drawer and the progress card send again through it; Check again re-runs the preflight and never submits');
  assert.match(page, /if \(!\(await submitChecked\(rebuildSpec\(latest, vibes, builtOn, previous\)\)\)\) \{\n\s+keepCollected\(sent\);/);
  assert.equal(page.includes("heldAction('retry'"), false, 'a held version has no Try again: a build with unmet asks is published, not held');
  assert.equal((page.match(/submitSpec\(next\)/g) || []).length, 1, 'only the checked submit sends a rebuild spec');
});
