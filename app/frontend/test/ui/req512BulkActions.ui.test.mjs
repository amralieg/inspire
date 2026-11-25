// REQ-512 item 36 (Amr, 11-24 00:06: "the same actions at individual level will appear too when user select multiple use cases so you can do
// it in bulk"): with 2 rows ticked, each bulk button acts on exactly those 2. Coverage for ResultsPage.jsx:2120-2123 (ValueBulkBar onGenerate,
// onBuild) and :2310 (the build queue status); req511Review test 7 only checks the buttons are present.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser } from './uiSupport.mjs';
import { openReview } from './req512Support.mjs';

test.after(closeBrowser);

const PICK = ['N01-U02', 'N01-U03'];
async function pickTwo({ page, row }) {
  const names = [];
  for (const no of PICK) {
    await row(no).getByRole('checkbox').first().check();
    names.push((await row(no).locator('[data-row-name]').first().innerText()).replace(/\s+/g, ' ').trim());
  }
  const bar = page.getByRole('toolbar', { name: 'Actions for the selected use cases' });
  await bar.waitFor({ timeout: 10000 });
  return { bar, names };
}

test('B1: Generate docs for 2 opens the docs wizard for those 2 use cases', async () => {
  const r = await openReview();
  try {
    const { bar, names } = await pickTwo(r);
    await bar.getByRole('button', { name: /^Generate docs for 2/ }).click();
    const dialog = r.page.getByRole('dialog', { name: 'Generate documents' });
    await dialog.waitFor({ timeout: 10000 });
    const text = (await dialog.innerText()).replace(/\s+/g, ' ');
    for (const n of names) assert.ok(text.includes(n.slice(0, 20)), `the docs wizard names ${n}: ${text.slice(0, 300)}`);
    assert.deepEqual(r.ui.pageErrors, []);
  } finally { await r.ui.close(); }
});

test('B2: Build MVP for 2 opens the MVP wizard for the first picked use case and says "Building MVP 1 of 2"', async () => {
  const r = await openReview();
  try {
    const { bar, names } = await pickTwo(r);
    await bar.getByRole('button', { name: /^Build MVP for 2/ }).click();
    const wizard = r.page.locator('[data-implement-overlay] [role="dialog"]');
    await wizard.waitFor({ timeout: 15000 });
    assert.ok((await wizard.getAttribute('aria-label') || '').includes(names[0].slice(0, 20)), `the wizard is for ${names[0]}`);
    const queue = r.page.locator('[data-build-queue]');
    await queue.waitFor({ timeout: 5000 });
    assert.match(await queue.innerText(), /Building MVP 1 of 2/);
    assert.deepEqual(r.ui.pageErrors, []);
  } finally { await r.ui.close(); }
});
