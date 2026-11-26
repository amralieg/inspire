// C24 (RC7-B-10): Results -> Assets shows each file's created date, so the folder listing route passes the modified time the workspace gives.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');

test.after(() => S.stopServer());

const DEMOS = '/Shared/demos';
const SESSION = { session_id: '1002', generation_path: DEMOS, business_name: 'Acme' };

test('RC7-B-10: the workspace folder listing carries modified_at for each file (milliseconds), so Assets can show a date', async () => {
  const file = `${DEMOS}/acme_brief.pdf`;
  S.reset({
    sessionRows: { [S.APP_DB]: [SESSION] },
    launches: [{ run_id: '91002', inspire_database: S.APP_DB, session_id: '1002', output_folder: DEMOS, output_checked: 'passed' }],
    leftoverFiles: [file],
    modifiedAt: { [file]: 1795694400000 },
  });
  const got = await S.request('GET', `/api/workspace/list?path=${encodeURIComponent(DEMOS)}`, { person: 'nonowner@example.com' });
  assert.equal(got.status, 200, got.text);
  const files = JSON.parse(got.text).files;
  assert.deepEqual(files.map((f) => f.name), ['acme_brief.pdf']);
  assert.equal(files[0].modified_at, 1795694400000, 'the listing keeps the workspace modified time');
});
