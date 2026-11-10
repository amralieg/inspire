const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const backend = require('../lib/inspireImplement');

const libUrl = pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'implementWizard.js')).href;
const UC = { id: 'N01-U01', Name: 'Predict churn', statement: 'Cut churn in the top segment', sponsor: 'Head of Retention' };

test('the Measure step saves a converted rule into spec.money, and the backend keeps it as the clean rule', async () => {
  const w = await import(libUrl);
  const base = w.defaultSpecFromUseCase(UC, { warehouseId: 'wh1', inspireDatabase: 'main.inspire', owner: 'amr@example.com' });
  const rule = { currency: 'convert', base: 'USD', rates: { AED: 0.27 }, window: { periods: 12 } };
  const spec = w.withMoneyRule(base, rule);
  const { errors, spec: normalized } = backend.validateImplementSpec(backend.withInspireUrl(spec, 'https://inspire.example.com'));
  assert.deepEqual(errors, []);
  assert.deepEqual(normalized.money, rule);
});

test('choosing the default money rule removes spec.money, so the App keeps per currency', async () => {
  const w = await import(libUrl);
  const base = w.withMoneyRule(w.defaultSpecFromUseCase(UC, { warehouseId: 'wh1', inspireDatabase: 'main.inspire', owner: 'amr@example.com' }),
    { currency: 'convert', base: 'USD', rates: { AED: 0.27 } });
  assert.equal('money' in w.withMoneyRule(base, null), false);
});
