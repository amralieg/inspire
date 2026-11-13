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
