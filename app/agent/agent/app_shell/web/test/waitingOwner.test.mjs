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
