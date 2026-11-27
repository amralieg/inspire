import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sharedNote } from '../../src/lib/implementControl.js';
import { reviewLinkText } from '../../src/lib/runPages.js';
import { catalogRow } from '../../src/lib/useCaseFacets.js';
import { implementGroups } from '../../src/lib/implementWizard.js';

// REQ-569 (UI side): every use case id a person reads prints AIx-UCx, even when the stored id is the old Nx-Ux. Stored values, URLs and API bodies stay.
const OLD = /\bN\d+-U\d+\b/;
const yes = (re, text, msg) => assert.ok(re.test(text), `expected ${re} in ${msg}`);
const no = (re, text, msg) => assert.ok(!re.test(text), `found ${re} in ${msg}`);
const read = (rel) => readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8');

test('sentences built from an old stored id print the new form', () => {
  const builtBy = { use_case_id: 'N01-U03', session_id: 's1' };
  const note = sharedNote('app', { target: 'the App', others: [] }, builtBy);
  yes(/AI01-UC03/, note, 'sharedNote'); no(OLD, note, 'sharedNote');
  const link = reviewLinkText({ sessionId: 's1', useCaseId: 'N02-U01', valid: true }, 'db', 'no_use_case');
  yes(/AI02-UC01/, link, 'reviewLinkText'); no(OLD, link, 'reviewLinkText');
});

test('catalog row title and the Build list fallback name print the new form', () => {
  const row = catalogRow({ No: 'N04-U02' }, 0, {});
  no(OLD, String(row.title), 'catalog title');
  const groups = implementGroups([], [{ use_case_id: 'N05-U01', use_case_name: '' }], null, '');
  no(OLD, JSON.stringify(groups).replace(/"(id|use_case_id)":"N\d+-U\d+"/g, ''), 'implementGroups names');
});

test('JSX sites that print an id route it through displayId', () => {
  const wiz = read('frontend/src/pages/ImplementWizard.jsx');
  yes(/\{displayId\(spec\.use_case_id\)\} selected/, wiz, 'ImplementWizard selected line');
  yes(/Built by use case \$\{displayId\(/, wiz, 'ImplementWizard built-by');
  yes(/\|\| displayId\(spec\.use_case_id\)/, wiz, 'ImplementWizard title');
  yes(/item\.name \|\| displayId\(useCaseId\)/, read('frontend/src/pages/ImplementPage.jsx'), 'ImplementPage uninstall title');
  no(/#\$\{uc\.id\}|#\$\{sc\.id\}/, read('frontend/src/components/monitor/EveryStepDialog.jsx'), 'EveryStepDialog raw ids');
  yes(/\{displayId\(id\)\}/, read('frontend/src/components/UseCaseStrategyDetail.jsx'), 'UseCaseStrategyDetail');
  yes(/nameOfUseCase\(uc\) \|\| displayId\(id\)/, read('frontend/src/pages/ResultsPage.jsx'), 'ResultsPage describeUseCase');
});

test('README, docs and openapi examples show the new form', () => {
  for (const rel of ['backend/openapi.yaml', 'docs/CLAUDE.md', 'docs/usecase_billing_tags.md']) no(OLD, read(rel), rel);
});
