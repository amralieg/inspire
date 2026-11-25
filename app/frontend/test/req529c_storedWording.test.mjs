// REQ-529 part C: text stored by older runs that says "Genie Code" reads "Databricks AI" wherever a person sees it. Data keys and stored data stay.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { aiWording, displayCleanText, sidePanelTextOf, hasShippedGenieCode } from '../src/lib/useCaseFields.js';
import { executiveSummaryOf } from '../src/lib/reviewFigures.js';
import { buildDocModel } from '../src/lib/docgen/docModel.js';
import { defaultDocOptions } from '../src/lib/docgen/docOptions.js';
import { resolveTheme } from '../src/lib/docgen/docStyles.js';
import { briefPagesSvg } from '../src/lib/docgen/docSvg.js';
import { buildXlsx } from '../src/lib/docgen/xlsxDoc.js';
import { ALL_BLOCKS } from './req526c_fixture.mjs';

const OLD = ['Databricks Genie', 'Code'].join(' ');
const OLD_SENTENCE = `${OLD} aggregates the orders each night.`;
const NEW_SENTENCE = 'Databricks AI aggregates the orders each night.';
const UC = { No: 'N01-U01', Name: 'Predict churn', Domain: 'Sales', Statement: OLD_SENTENCE, Solution: `The ${OLD} notebook ranks customers.`, 'Business Value': `${OLD} saves analyst time.`,
  'Tables Involved': 'main.s.orders', 'Has Genie Code': 'Yes', has_genie_code: true, genie_code: 'kept' };

test('aiWording: every variant reads Databricks AI, Genie alone stays', () => {
  assert.equal(aiWording(OLD_SENTENCE), NEW_SENTENCE);
  assert.equal(aiWording('Use genie code, GENIE CODE and Genie-Code and genie-code here.'), 'Use Databricks AI, Databricks AI and Databricks AI and Databricks AI here.');
  assert.equal(aiWording('Ask the Genie space about Genie Agents.'), 'Ask the Genie space about Genie Agents.');
  assert.equal(aiWording('Genie Codes'), 'Genie Codes', 'whole words only');
  assert.equal(aiWording(null), '');
  assert.equal(aiWording('Databricks AI already'), 'Databricks AI already');
});

test('aiWording never changes stored data: keys and the has-flag still read the original', () => {
  assert.equal(Object.keys(UC).includes('Has Genie Code'), true);
  assert.equal(hasShippedGenieCode(UC), true);
  assert.equal(sidePanelTextOf(UC).statement, NEW_SENTENCE);
  assert.equal(UC.Statement, OLD_SENTENCE, 'the stored use case is untouched');
});

test('displayCleanText and the executive summary paragraphs say Databricks AI', () => {
  assert.equal(displayCleanText(`<p>${OLD_SENTENCE}</p>`), NEW_SENTENCE);
  assert.deepEqual(executiveSummaryOf({ executive_summary: `${OLD_SENTENCE}\n\nSecond ${OLD} paragraph.` }), [NEW_SENTENCE, 'Second Databricks AI paragraph.']);
});

test('the use case side panel text reads Databricks AI in statement, solution and business value', () => {
  const t = sidePanelTextOf(UC);
  assert.equal(t.statement, NEW_SENTENCE);
  assert.equal(t.solution, 'The Databricks AI notebook ranks customers.');
  assert.equal(t.businessValue, 'Databricks AI saves analyst time.');
});

const model = () => buildDocModel({ businessName: 'Acme', useCases: [UC], values: {}, options: { ...defaultDocOptions('English'), blocks: ALL_BLOCKS }, summary: [OLD_SENTENCE] });

test('the doc model, brief page 2 and the Excel rows read Databricks AI', async () => {
  const m = model();
  assert.equal(m.useCases[0].statement, NEW_SENTENCE);
  assert.equal(m.useCases[0].solution, 'The Databricks AI notebook ranks customers.');
  assert.equal(m.useCases[0].businessValue, 'Databricks AI saves analyst time.');
  assert.deepEqual(m.summary, [NEW_SENTENCE]);
  const page2 = briefPagesSvg(m, resolveTheme('executive', 'databricks'))[1];
  assert.match(page2, /Databricks AI/);
  assert.doesNotMatch(page2, /Genie Code/i);
  const JSZip = createRequire(import.meta.url)('jszip');
  const zip = await JSZip.loadAsync(Buffer.from(await (await buildXlsx(m, ['name', 'statement', 'use_case_story'])).arrayBuffer()));
  const strings = await zip.file('xl/sharedStrings.xml').async('string');
  assert.match(strings, /Databricks AI aggregates/);
  assert.doesNotMatch(strings, /Genie Code/i);
});
