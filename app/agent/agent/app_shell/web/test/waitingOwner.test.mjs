import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'src', 'WaitingForAccess.jsx'), 'utf8');

test('the waiting view names the owner the server returns, and falls back to your data owner when none is known (REQ-040)', () => {
  assert.match(source, /const owner = waiting\?\.owners\?\.length \? waiting\.owners\.join\(' or '\) : WAITING_OWNER;/);
  assert.match(source, /Ask \{owner\} to grant it\./);
  assert.doesNotMatch(source, /Ask \{WAITING_OWNER\}/, 'the view no longer hardcodes the generic owner');
});

test('the App root and the Home hub show the one waiting view for a refused read, and never the generic start-up error (REQ-040)', () => {
  const app = readFileSync(join(here, '..', 'src', 'App.jsx'), 'utf8');
  assert.match(app, /error\.code === WAITING_FOR_ACCESS_CODE \? <WaitingForAccess waiting=\{error\.detail\} onCheck=\{boot\} \/>/);
  assert.match(app, /\{!admin && !page && hubWaiting && <WaitingForAccess waiting=\{hubWaiting\.detail\} onCheck=\{loadHub\} \/>\}/);
  assert.match(app, /\.catch\(\(e\) => \{ if \(mine === seq\.current\) setError\(e\); \}\);/, 'the hub keeps the error object, so its code survives');
});

test('the waiting view carries the one access action (grant with my permissions, copy the SQL, check again), not its own button (REQ-082)', () => {
  const view = readFileSync(join(here, '..', 'src', 'WaitingForAccess.jsx'), 'utf8');
  assert.match(view, /import \{ ACCESS_CHECKED, AccessActions \} from '\.\/ui\.jsx';/);
  assert.match(view, /const actions = <AccessActions \/>;/);
  assert.doesNotMatch(view, /data-check-again/, 'the view has no Check again button of its own');
});

test('Runs, Records, Alerts and Genie show the same waiting component when their read is refused (REQ-040, one implementation)', () => {
  for (const name of ['Records.jsx', 'Alerts.jsx', 'Genie.jsx', 'Freshness.jsx']) {
    const text = readFileSync(join(here, '..', 'src', name), 'utf8');
    assert.match(text, /waitingOf/, `${name} keeps the waiting state of its refused read`);
  }
  assert.match(readFileSync(join(here, '..', 'src', 'Runs.jsx'), 'utf8'), /const \{ data, error, waiting, busy \} = runs;/, 'Runs reads the waiting state from its runs hook');
  for (const name of ['Runs.jsx', 'Records.jsx', 'Alerts.jsx', 'Genie.jsx']) {
    const text = readFileSync(join(here, '..', 'src', name), 'utf8');
    assert.match(text, /<WaitingForAccess [^>]*compact/, `${name} renders the waiting component compact`);
    assert.doesNotMatch(text, /WAITING_FOR_ACCESS_TITLE|waiting-access--/, `${name} does not restyle the waiting view itself`);
  }
});
