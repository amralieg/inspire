// REQ-575 (REQ-165 class): the quality-bar notices in the documents (agentModel doc_bar_partial_notice, doc_fallback_notice) carry the
// count sentence from qualityBarCountText, so one use case reads "1 of 1 use case meets", never a hand-written "use cases meet".
import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_EN, agentText, buildAgentModel } from '../src/lib/docgen/agentModel.js';
import { qualityBarCountText } from '../src/lib/qualityBarWording.js';

const CASES = [[1, 1], [1, 3], [0, 2], [3, 3]];

for (const key of ['doc_bar_partial_notice', 'doc_fallback_notice']) {
  for (const [meets, total] of CASES) {
    test(`${key} for ${meets}/${total} opens with the qualityBarCountText wording`, () => {
      const count = qualityBarCountText(total, meets, 'Good');
      const text = agentText({}, key, { mode: 'Good', total, meets, count });
      assert.ok(text.startsWith(`${count}.`), `"${text}" must start with "${count}."`);
    });
  }
}

test('the document model puts the same sentence in the executive summary', () => {
  const row = (no, status) => ({ No: no, id: no, Name: `Case ${no}`, Statement: 's', Solution: 'x', 'Business Domain': 'Ops', Tables: 'a.b.c', elite_status: status });
  const m = buildAgentModel({ businessName: 'Acme', useCases: [row('AI01-UC01', ''), row('AI01-UC02', 'DOMAIN_COVERAGE_PICK'), row('AI01-UC03', 'DOMAIN_COVERAGE_PICK')], values: {}, language: 'English' });
  assert.ok(m.executive[0].startsWith(`${qualityBarCountText(3, 1, 'Good')}.`), m.executive[0]);
  const none = buildAgentModel({ businessName: 'Acme', useCases: [row('AI01-UC02', 'DOMAIN_COVERAGE_PICK'), row('AI01-UC03', 'DOMAIN_COVERAGE_PICK')], values: {}, language: 'English' });
  assert.ok(none.executive[0].startsWith(`${qualityBarCountText(2, 0, 'Good')}.`), none.executive[0]);
  assert.ok(AGENT_EN.doc_fallback_notice.includes('{count}'));
});
