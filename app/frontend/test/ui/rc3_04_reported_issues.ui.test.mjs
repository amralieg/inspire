import test from 'node:test';
import assert from 'node:assert/strict';
import { OWNER, built } from './implementFixtures.js';
import { closeBrowser, openBuild } from './uiSupport.mjs';
import { splitTechnical } from '../../src/lib/plainText.js';

test.after(closeBrowser);

// RC3-04 (live walk, Build page after an MVP build): the Reported issues read got no answer and the panel showed
// "Inspire could not read the reported issues: Failed to fetch". The browser is made to drop that read here, as it did live.
const NETWORK = splitTechnical('Failed to fetch').plain;
const TABLE = JSON.parse(built().spec_json).config.result_table.split('.').map((p) => `\`${p}\``).join('.').replace(/`$/, '_feedback`');
const ISSUE = { feedback_id: 'f1', section: 'work', record_key: 'R001', text: 'Issue f1', filters: 'none', reported_by: 'someone@example.com',
  reported_at: '2026-11-08 10:00:00', status: 'new', vibe_text: null, handled_by: null, handled_at: null };
const state = () => ({ history: [built()], forwardedToken: 'person-token', forwardedEmail: '',
  statements: { [`FROM ${TABLE} WHERE use_case_id = :uc ORDER BY`]: () => ({ rows: [ISSUE] }) }, appApi: { 'GET /api/app': [{ pages: [] }] } });
const isList = (url) => url.pathname === '/api/inspire/implement/feedback';
const notDropped = (errors) => errors.filter((e) => !/ERR_FAILED|Failed to load resource/.test(e));

function dropList(drop) {
  const seen = { dropped: 0, passed: 0 };
  const init = async (page) => {
    await page.route(isList, async (route) => {
      if (drop(seen)) { seen.dropped += 1; await route.abort('failed'); return; }
      seen.passed += 1;
      await route.fallback();
    });
  };
  return { seen, init };
}

test('RC3-04 a Reported issues read that never gets an answer says what happened and what to do, and Try again lists them', async () => {
  let failing = true;
  const { seen, init } = dropList(() => failing);
  const ui = await openBuild({ me: { userName: OWNER, displayName: 'Owner' }, ...state() }, { init });
  try {
    const panel = ui.page.getByRole('region', { name: 'Reported issues' });
    const error = panel.locator('[data-issues-error]');
    await error.waitFor({ timeout: 20000 });
    const sentence = await error.locator('p').first().innerText();
    assert.equal(sentence, `Inspire could not read the reported issues: ${NETWORK}`);
    assert.doesNotMatch(sentence, /Failed to fetch|TypeError|NetworkError/, 'no raw browser error in the sentence');
    // must-keep: Try again reads the list again and shows the issue.
    failing = false;
    await error.getByRole('button', { name: 'Try again' }).click();
    await panel.locator('[data-issue="f1"]').waitFor({ timeout: 15000 });
    assert.equal(await panel.locator('[data-issues-error]').count(), 0);
    assert.ok(seen.dropped >= 1 && seen.passed >= 1, JSON.stringify(seen));
    assert.deepEqual(notDropped(ui.pageErrors), []);
  } finally {
    await ui.close();
  }
});

// The one automatic retry of a read is proven in rc3_04_api_network.ui.test.mjs: on this page the list is read more than once while the
// build status settles, so a page-level count cannot tell a retry from a re-read.
