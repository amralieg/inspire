// C33 (REQ-560): the build feed keys each line by its time, kind and text. Two notes written in the same second that start with the same 60
// characters (a grant on a folder, then on a notebook under it) shared one key: React warned of duplicate keys and could drop a line, and the
// typing schedule gave both lines one start. The key now carries the whole text.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);
const grant = 'person@example.com can manage /Workspace/Shared/demo-app/demo_business/session_1001/';
const a = { at: '2026-01-02T10:00:05Z', kind: 'note', text: `${grant}area/AI01-UC01 - first_use_case` };
const b = { at: '2026-01-02T10:00:05Z', kind: 'note', text: `${grant}notebooks/area/first_domain` };

test('C33 (must-fail before): two notes of the same second with the same first 60 characters have their own feed keys', async () => {
  const { feedKey, feedArrivals } = await lib('mvpProgress.js');
  assert.notEqual(feedKey(a), feedKey(b));
  assert.equal(feedArrivals(null, [a, b], 1).size, 2);
});

test('C33 (must-keep): the same line read again keeps its key, and a repeated poll adds no line', async () => {
  const { feedKey, steadyFeed } = await lib('mvpProgress.js');
  assert.equal(feedKey({ ...a }), feedKey(a));
  const build = { latest: { session_id: '1001', use_case_id: 'AI01-UC01', spec_version: 1, implement_run_id: 7 } };
  const first = { ...build, feed: [a, b] };
  assert.equal(steadyFeed(first, { ...build, feed: [{ ...a }, { ...b }] }).feed.length, 2);
});
