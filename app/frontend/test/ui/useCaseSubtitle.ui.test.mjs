// REQ-175: the card, the Build page and the use case page show the approved name as the title, with the subtitle under it
// (outcome, technique and scope). A person-typed name stays the title, and the subtitle never replaces it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cardTitlesOfUseCase, subtitleOfUseCase } from '../../src/lib/useCaseFields.js';

const NAME = 'Predict Customer Churn';
const SUBTITLE = 'Churn costs the business money. Analytics Technique: Predictive Modeling. Scope: Contoso.';
const row = {
  id: 'N01-U01', No: 'N01-U01', Name: NAME, use_case: NAME, usecase: 'Stop Customer Losses to Grow Revenue',
  subtitle: SUBTITLE, name_with_technique: NAME, Statement: 'Churn costs the business money.',
};

test('the card title is the approved name and the subtitle sits under it', () => {
  const { title, subtitle } = cardTitlesOfUseCase(row, 0);
  assert.equal(title, NAME);
  assert.equal(subtitle, SUBTITLE);
});

test('the headline never becomes the title: the title stays the approved name even when a headline is populated (must-exclude)', () => {
  assert.equal(cardTitlesOfUseCase(row, 0).title, NAME);
  assert.notEqual(cardTitlesOfUseCase(row, 0).title, row.usecase);
});

test('a person-typed name is the title, and the subtitle still carries the outcome, technique and scope', () => {
  const typed = { ...row, user_use_case_name: 'My churn watch', Name: NAME };
  const { title, subtitle } = cardTitlesOfUseCase(typed, 0);
  assert.equal(title, 'My churn watch');
  assert.equal(subtitle, SUBTITLE);
});

test('the use case page reads the same subtitle field the card does', () => {
  assert.equal(subtitleOfUseCase(row, NAME), SUBTITLE);
});
