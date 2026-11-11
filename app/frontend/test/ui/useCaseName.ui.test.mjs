import test from 'node:test';
import assert from 'node:assert/strict';
import { cardTitlesOfUseCase, favoriteKeyOf } from '../../src/lib/useCaseFields.js';
import { buildUseCaseList } from '../../src/lib/useCaseList.js';
import { caseNameOf, defaultSpecFromUseCase } from '../../src/lib/implementWizard.js';

const CATALOGUE = 'Predict churn risk';
const RENAMED = 'Churn early warning';
const base = { No: 'N01-U01', Name: CATALOGUE, use_case: CATALOGUE, 'Business Domain': 'Sales', Subdomain: 'Retention',
  Statement: 'Flag customers likely to leave.', Solution: 'A weekly score.' };
const renamedRow = {
  id: 'N01-U01', No: 'N01-U01', session_id: 42, use_case: CATALOGUE, user_use_case_name: RENAMED,
  original_name: CATALOGUE, Name: RENAMED, short_name: CATALOGUE, 'Business Domain': 'Sales', Subdomain: 'Retention',
  Statement: 'Flag customers likely to leave.', Solution: 'A weekly score.',
};

test('a favourite survives a rename: the key is the catalogue name, so renaming never drops it (must-exclude)', () => {
  const renamed = { ...base, Name: RENAMED, original_name: CATALOGUE };
  assert.equal(favoriteKeyOf(renamed), favoriteKeyOf(base));
  assert.notEqual(favoriteKeyOf({ ...base, Name: RENAMED }), favoriteKeyOf(base), 'without the catalogue name in the row the key would change');
});

test('the card title and the Build page name show the user name, not the technique name or the catalogue name', () => {
  const uc = { ...renamedRow, name_with_technique: 'Predict churn risk (classification)' };
  assert.equal(cardTitlesOfUseCase(uc).title, RENAMED);
  assert.equal(caseNameOf(uc), RENAMED);
  assert.equal(defaultSpecFromUseCase(uc, { warehouseId: 'wh', inspireDatabase: 'main.inspire', sessionId: 42 }).use_case_name, RENAMED,
    'the App title in the spec is the name the Build page showed');
  assert.equal(cardTitlesOfUseCase(base).title, CATALOGUE, 'an unnamed use case keeps its catalogue name');
});

test('the result table of a renamed use case is the default table of its id, never of its name', () => {
  const before = defaultSpecFromUseCase(base, { warehouseId: 'wh', inspireDatabase: 'main.inspire', sessionId: 42 });
  const after = defaultSpecFromUseCase(renamedRow, { warehouseId: 'wh', inspireDatabase: 'main.inspire', sessionId: 42 });
  assert.equal(after.config.result_table, before.config.result_table);
});

test('the Results list overlays the user name on results that come from the run JSON, and keeps the catalogue name for favourites', () => {
  const results = { domains: [{ domain_name: 'Sales', use_cases: [{ No: 'N01-U01', Name: CATALOGUE, Statement: 'Flag customers likely to leave.' }] }] };
  const [uc] = buildUseCaseList(results, [renamedRow]);
  assert.equal(uc.Name, RENAMED);
  assert.equal(uc.original_name, CATALOGUE);
  assert.equal(uc.user_use_case_name, RENAMED);
  assert.equal(uc.short_name, CATALOGUE, 'the App name stays on the catalogue name, so a rebuild never creates a new App');
  const [beforeRename] = buildUseCaseList(results, []);
  assert.equal(favoriteKeyOf(uc), favoriteKeyOf(beforeRename), 'the favourite made before the rename still matches');
});

test('a row with no user name leaves the list name exactly as the run wrote it', () => {
  const results = { domains: [{ domain_name: 'Sales', use_cases: [{ No: 'N01-U01', Name: CATALOGUE }] }] };
  const [uc] = buildUseCaseList(results, [{ ...renamedRow, user_use_case_name: null, Name: CATALOGUE, original_name: CATALOGUE }]);
  assert.equal(uc.Name, CATALOGUE);
  assert.equal(uc.user_use_case_name, undefined);
});
