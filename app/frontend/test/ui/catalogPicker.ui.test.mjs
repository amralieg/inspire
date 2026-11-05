import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, dataToResults, onStep, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const next = (page) => page.getByRole('button', { name: 'Next' }).click();
const many = Array.from({ length: 80 }, (_, i) => `cat_${String(i).padStart(3, '0')}`);

async function resultStep(state) {
  const ui = await openUi('wizard', { me: { userName: 'owner@example.com', displayName: 'Owner' }, schemas: { main: ['inspire'] }, ...state });
  await onStep(ui.page, 'Choose');
  await next(ui.page);
  await onStep(ui.page, 'Data');
  await dataToResults(ui.page);
  const step = ui.page.getByRole('region', { name: 'Where the result table lives' });
  await step.getByRole('heading', { name: 'Where should the result table live?' }).waitFor();
  return { ui, step };
}

test('a long catalog list is searched by typing, a cut one says so, and a typed catalog past the cut can be chosen (must-exclude: a short list stays a plain pick)', async () => {
  const { ui, step } = await resultStep({ catalogs: ['main', ...many], catalogsCut: true });
  try {
    const catalog = step.getByLabel('Catalog');
    assert.equal(await catalog.evaluate((el) => el.tagName), 'INPUT');
    assert.equal(await step.locator('datalist option').count(), 81);
    assert.equal((await step.locator('[data-catalog-note]').innerText()).trim(),
      'Inspire listed the first 81 catalogs you can see; type the name of one that is not listed');
    await catalog.fill('zz_beyond');
    assert.equal((await step.locator('[data-catalog-note]').innerText()).trim(),
      'zz_beyond is not among the first 81 catalogs Inspire listed; Inspire checks it with Unity Catalog when it reads its schemas');
    assert.equal(await catalog.inputValue(), 'zz_beyond');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
  const short = await resultStep({ catalogs: ['main', 'sales'] });
  try {
    const catalog = short.step.getByLabel('Catalog');
    assert.equal(await catalog.evaluate((el) => el.tagName), 'SELECT');
    assert.equal(await short.step.locator('[data-catalog-note]').count(), 0);
  } finally {
    await short.ui.close();
  }
});
