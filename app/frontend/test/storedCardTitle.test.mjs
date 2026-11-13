// REQ-155 (L4): a use case title reads the stored user name, never a generated text. name_with_technique is a generated
// display label, so a stale copy of it (joined text written while the name was joined) must never become the title.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cardTitlesOfUseCase, nameOfUseCase } from '../src/lib/useCaseFields.js';
import { implementGroups } from '../src/lib/implementWizard.js';

const CLEAN = 'Protect Tokyo Tidbits Card Payments from Fraud Losses';
const JOINED = `${CLEAN}${CLEAN}`;

test('a stale joined name_with_technique never becomes the title when the stored name is clean (must-exclude: no doubled title)', () => {
  const uc = { id: 'N01-U02', Name: CLEAN, name_with_technique: JOINED };
  assert.equal(nameOfUseCase(uc), CLEAN);
  assert.equal(cardTitlesOfUseCase(uc, 0).title, CLEAN);
});

test('the stored user name wins over the catalogue name, and a generated label is never read', () => {
  const uc = { id: 'N01-U02', user_use_case_name: 'Card fraud guard', Name: CLEAN, name_with_technique: JOINED };
  assert.equal(nameOfUseCase(uc), 'Card fraud guard');
});

test('a blank user name falls back to the stored catalogue name, not to the generated label', () => {
  const uc = { id: 'N01-U02', user_use_case_name: '   ', original_name: CLEAN, name_with_technique: JOINED };
  assert.equal(nameOfUseCase(uc), CLEAN);
});

test('a use case with only a generated label has no title, so the card falls back to its number (must-exclude)', () => {
  assert.equal(nameOfUseCase({ id: 'N01-U02', name_with_technique: JOINED }), '');
  assert.equal(cardTitlesOfUseCase({ id: 'N01-U02', name_with_technique: JOINED }, 1).title, 'Use Case 2');
});

test('the Build list row for a renamed use case shows the stored name, not a stale generated label', () => {
  const uc = { id: 'N01-U02', user_use_case_name: 'Card fraud guard', Name: CLEAN, name_with_technique: JOINED, Subdomain: 'Cards', _domain: 'Payments' };
  const items = implementGroups([uc], [], null, '').flatMap((group) => group.items);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'Card fraud guard');
});

test('a consistent technique label (the stored name plus the technique) is still shown on the card', () => {
  const uc = { id: 'N01-U02', user_use_case_name: 'Card fraud guard', name_with_technique: 'Card fraud guard using classification' };
  assert.equal(nameOfUseCase(uc), 'Card fraud guard using classification');
});

test('a label left over from an older name is not shown after a rename: the stored name stands (must-exclude)', () => {
  const uc = { id: 'N01-U02', user_use_case_name: 'Card fraud guard', Name: CLEAN, name_with_technique: `${CLEAN} using classification` };
  assert.equal(nameOfUseCase(uc), 'Card fraud guard');
});
