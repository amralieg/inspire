const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const backend = require('../lib/inspireImplement');

const CASES = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'money_rule_cases.json'), 'utf8')).cases;
const UC = { id: 'N01-U01', Name: 'Predict churn', statement: 'Cut churn in the top segment', sponsor: 'Head of Retention' };
const libUrl = pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'implementWizard.js')).href;

async function validSpec(money) {
  const w = await import(libUrl);
  const spec = w.defaultSpecFromUseCase(UC, { warehouseId: 'wh1', inspireDatabase: 'main.inspire', owner: 'amr@example.com' });
  return money === undefined ? spec : { ...spec, money };
}

test('a spec without a money rule validates as before and carries no money field', async () => {
  const { errors, spec } = backend.validateImplementSpec(backend.withInspireUrl(await validSpec(), 'https://inspire.example.com'));
  assert.deepEqual(errors, []);
  assert.equal('money' in spec, false);
});

for (const c of CASES.filter((x) => x.rule)) {
  test(`a spec carrying money "${c.name}" is ${c.valid ? 'kept as its clean rule' : 'refused with the reason'}`, async () => {
    const { errors, spec } = backend.validateImplementSpec(backend.withInspireUrl(await validSpec(c.rule), 'https://inspire.example.com'));
    if (c.valid) {
      assert.deepEqual(errors, []);
      assert.deepEqual(spec.money, c.clean);
    } else {
      assert.ok(errors.some((e) => e.startsWith('money: ')), JSON.stringify(errors));
    }
  });
}
