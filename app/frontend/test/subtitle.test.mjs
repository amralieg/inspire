// REQ-175: the card shows the name alone and the subtitle carries the outcome, technique and scope. The subtitle field the
// agent writes is read first; a generated "using <technique>" name is never the subtitle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cardTitlesOfUseCase, subtitleOfUseCase } from '../src/lib/useCaseFields.js';

test('the subtitle field the agent writes is the card subtitle', () => {
  const uc = { Name: 'Predict Customer Churn', subtitle: 'Churn costs the business money. Technique: Predictive Modeling.' };
  assert.equal(subtitleOfUseCase(uc, 'Predict Customer Churn'), 'Churn costs the business money. Technique: Predictive Modeling.');
  assert.equal(cardTitlesOfUseCase(uc, 0).subtitle, 'Churn costs the business money. Technique: Predictive Modeling.');
});

test('the card title is the stored name alone, with no generated technique tail', () => {
  const uc = { Name: 'Predict Customer Churn', name_with_technique: 'Predict Customer Churn', subtitle: 'Technique: Simulation.' };
  assert.equal(cardTitlesOfUseCase(uc, 0).title, 'Predict Customer Churn');
});

test('a use case with no subtitle field falls back to the old description fields', () => {
  assert.equal(subtitleOfUseCase({ Name: 'Predict Customer Churn', description: 'Stop lost customers.' }, 'Predict Customer Churn'),
    'Stop lost customers.');
});
