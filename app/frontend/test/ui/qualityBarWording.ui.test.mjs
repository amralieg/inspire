import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { qualityBarCountText } from '../../src/lib/qualityBarWording.js';

test.after(closeBrowser);

test('the quality-bar count has one wording for every count, singular for one use case', () => {
  assert.equal(qualityBarCountText(6, 3), '3 of 6 use cases meet the quality bar');
  assert.equal(qualityBarCountText(6, 0), '0 of 6 use cases meet the quality bar');
  assert.equal(qualityBarCountText(1, 1), '1 of 1 use case meets the quality bar');
  assert.equal(qualityBarCountText(1, 0), '0 of 1 use case meets the quality bar');
  assert.equal(qualityBarCountText(undefined, null), '0 of 0 use cases meet the quality bar');
  assert.equal(qualityBarCountText(6, 3, 'High'), '3 of 6 use cases meet the High quality bar');
  assert.equal(qualityBarCountText(1, 0, 'Ultra High'), '0 of 1 use case meets the Ultra High quality bar');
});

test('Start shows the same quality-bar sentence that Review and Monitor show for the same counts', async () => {
  const sessions = [{
    session_id: '44', business_name: 'Same Count Retail', completed_percent: 100, processing_status: 'done', create_at: new Date().toISOString(),
    usecase_overview: { total: 6, high: 3, meets: 3, below: 3, domains: 2, unread: {}, preview_use_cases: [] },
  }];
  const ui = await openUi('choose', { sessions });
  try {
    const chip = ui.page.locator('[data-run="44"] [data-run-count="quality_bar"]');
    await chip.waitFor({ timeout: 10000 });
    assert.equal((await chip.innerText()).replace(/\s+/g, ' ').trim(), qualityBarCountText(6, 3));
    assert.equal(await ui.page.locator('[data-run="44"] [data-run-count="high_quality"]').count(), 0, 'the old high quality / low quality chips are gone');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('every Start run row names the bar it was judged against, from the run list, and a run with no bar says the plain count', async () => {
  const sessions = [
    { session_id: '51', business_name: 'High Bar Retail', completed_percent: 100, processing_status: 'done', create_at: new Date().toISOString(),
      bar_mode: 'High', usecase_overview: { total: 6, high: 3, meets: 3, below: 3, domains: 2, unread: {}, preview_use_cases: [] } },
    { session_id: '52', business_name: 'Good Bar Retail', completed_percent: 100, processing_status: 'done', create_at: new Date().toISOString(),
      bar_mode: 'Good', usecase_overview: { total: 4, high: 1, meets: 1, below: 3, domains: 1, unread: {}, preview_use_cases: [] } },
    { session_id: '53', business_name: 'No Bar Retail', completed_percent: 100, processing_status: 'done', create_at: new Date().toISOString(),
      bar_mode: null, usecase_overview: { total: 2, high: 0, meets: 0, below: 2, domains: 1, unread: {}, preview_use_cases: [] } },
  ];
  const ui = await openUi('choose', { sessions });
  try {
    const row = (sid) => ui.page.locator(`[data-run="${sid}"] [data-run-count="quality_bar"]`);
    await row('51').waitFor({ timeout: 10000 });
    assert.equal((await row('51').innerText()).replace(/\s+/g, ' ').trim(), qualityBarCountText(6, 3, 'High'));
    assert.equal((await row('52').innerText()).replace(/\s+/g, ' ').trim(), qualityBarCountText(4, 1, 'Good'));
    assert.equal((await row('53').innerText()).replace(/\s+/g, ' ').trim(), qualityBarCountText(2, 0), 'no bar, the plain sentence');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
