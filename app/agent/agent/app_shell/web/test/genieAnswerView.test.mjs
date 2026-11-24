// The Ask answer table and its steps: every header sits over its own values, and the steps stay out of the answer body (REQ-330).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerLabel, cellText } from '../src/format.js';
import { STEPS_SUMMARY, answerColumns, progressLabel } from '../src/genieAnswerView.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (name) => readFileSync(join(SRC, name), 'utf8');

// A four-column Genie answer, with fake ids and fake names.
const ANSWER = {
  columns: [
    { name: 'product_name', type: 'STRING' },
    { name: 'franchise_revenue_per_sale', type: 'DECIMAL' },
    { name: 'peer_median_revenue_per_sale', type: 'DECIMAL' },
    { name: 'gap_to_peer_median', type: 'DECIMAL' },
  ],
  rows: [
    { product_name: 'Product A', franchise_revenue_per_sale: 3, peer_median_revenue_per_sale: 18.38, gap_to_peer_median: -15.38 },
    { product_name: 'Product B', franchise_revenue_per_sale: 12.43, peer_median_revenue_per_sale: 17.45, gap_to_peer_median: -5.03 },
  ],
};

test('four Genie columns render four headers, each over its own values', () => {
  const columns = answerColumns(ANSWER);
  assert.deepEqual(columns.map((c) => c.key), ANSWER.columns.map((c) => c.name), 'the headers follow the Genie columns in order');
  assert.deepEqual(columns.map((c) => c.label), ANSWER.columns.map((c) => answerLabel(c.name)));
  ANSWER.rows.forEach((row) => {
    columns.forEach((c) => assert.equal(c.render(row), cellText(row[c.key], ANSWER.columns.find((x) => x.name === c.key))));
  });
  assert.equal(columns[0].render(ANSWER.rows[0]), 'Product A', 'the product column shows the product, never a number');
  assert.equal(columns[1].render(ANSWER.rows[0]), cellText(3, ANSWER.columns[1]), 'the revenue column shows the revenue, not the franchise');
});

test('a missing answer or a missing column list gives no columns', () => {
  assert.deepEqual(answerColumns(undefined), []);
  assert.deepEqual(answerColumns({ rows: [] }), []);
});

test('the steps are summarised as What Genie did, under Details', () => {
  assert.equal(STEPS_SUMMARY, 'What Genie did');
});

test('a finished answer shows its steps under Details, after the answer text, and never before it', () => {
  const genie = read('Genie.jsx');
  assert.match(genie, /\{!done && <AgentSteps steps=\{message\.steps\} \/>\}/, 'steps show before the answer only while it runs');
  assert.match(genie, /\{done && <StepsDetails steps=\{message\.steps\} \/>\}/, 'a finished answer keeps its steps under Details');
  assert.doesNotMatch(genie, /<AgentSteps steps=\{message\.steps\} \/>\s*\n\s*<Typing/, 'the answer text is never preceded by the steps');
  // REQ-506: the Agent page is gone; the agent chat answers in this same Genie answer view, so its turns get the same Details.
  assert.match(genie, /\{m\.state === 'done' && <Answer message=\{m\}/, 'the agent chat shows its steps under Details too: one Answer view, not gated on the agent flag');
});

test('the answer table is built only from the Genie columns, not from text written by the model', () => {
  assert.doesNotMatch(read('Genie.jsx'), /function answerColumns/, 'one shared answerColumns, in genieAnswerView.js');
});

// REQ-330 follow-up: while an answer runs, the panel says it is asking Genie, never the relay text the step log keeps.
test('while Genie is asked the panel shows Asking Genie, never the relay text', () => {
  assert.equal(progressLabel('Asked Genie: For franchises 3000039, what is the gap by product?'), 'Asking Genie');
  assert.equal(progressLabel('Read record 3000039'), 'Read record 3000039');
  assert.equal(progressLabel(''), 'Reading your question');
  const genie = read('Genie.jsx');
  assert.match(genie, /\{progressLabel\(m\.step\)\}/, 'the running line reads progressLabel');
  assert.doesNotMatch(genie, /m\.state === 'running' && <div className="msg-b"><AgentSteps/, 'the running panel no longer lists the relay steps');
});
