// REQ-300: the Permission Required dialog copies only the GRANT statements, says the copy line once, bounds the statement box with a
// scrollbar, gives each grantee a short heading, and shows a non-grant reason as one plain sentence outside the copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const STATE = { catalogs: ['main'], schemas: { main: ['s'] }, tables: { 'main.s': ['orders'] } };
const APP = '11111111-2222-3333-4444-555555555555';
const GRANTS = [
  `GRANT USE CATALOG ON CATALOG \`main\` TO \`${APP}\``,
  `GRANT USE SCHEMA ON SCHEMA \`main\`.\`s\` TO \`${APP}\``,
  `GRANT SELECT ON TABLE \`main\`.\`s\`.\`orders\` TO \`${APP}\``,
];
// REQ-313: the one instruction line sits under Advanced (REQ-300: exactly one instruction line).
const COPY_LINE = 'Copy the text below and pass it on to your Databricks admin.';
const REBUILD = 'The App inspire-fwa-batch-a-walk-fraud reads inspire_kinds_rc7._inspire.sales_transactions directly, so its viewers cannot see that data. A rebuild reads them through the App views.';

async function openLaunch(checkPermissions) {
  const ui = await openUi('launch', { ...STATE, checkPermissions });
  const { page, made } = ui;
  await page.getByPlaceholder(BUSINESS).fill('Acme');
  await page.locator('button[title="main"]').click();
  await page.locator('button[title="s"]').click();
  await page.locator('button[title="orders"]').click();
  await idle(page);
  await until(async () => !(await page.getByRole('button', { name: 'Get Started' }).isDisabled()), 'Get Started opens');
  return { ui, page, made };
}

async function openDialog(page) {
  await page.getByRole('button', { name: 'Get Started' }).click();
  await page.locator('[data-launch-run-unsaved]').click();
  const dialog = page.locator('[data-permission-dialog=""]');
  await dialog.waitFor({ timeout: 15000 });
  return dialog;
}

test('Copy puts only the GRANT statements on the clipboard, never the reason or the rebuild sentence', async () => {
  const permission = { statements: GRANTS, principal: APP, why: 'Discover reads main.s.orders as the App, and the App cannot read it yet.',
    instructions: [REBUILD] };
  const { ui, page } = await openLaunch([permission]);
  try {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin });
    const dialog = await openDialog(page);
    await dialog.getByRole('button', { name: 'Copy' }).click();
    await until(async () => (await dialog.getByRole('button', { name: 'Copied' }).count()) === 1, 'the button says Copied');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(copied, GRANTS.map((s) => `${s};`).join('\n'));
    assert.doesNotMatch(copied, /Rebuild|directly|Try again/);
  } finally {
    await ui.close();
  }
});

test('the copy line reads once, and no grantee paragraph says Ask your admin', async () => {
  const { ui, page } = await openLaunch([{ statements: GRANTS, principal: APP, why: 'The App reads its views.' },
    { statements: [GRANTS[2]], principal: 'admins', why: 'Admins open the App.' }]);
  try {
    const dialog = await openDialog(page);
    // REQ-313: the copy line sits under Advanced; open it so the text reads.
    await dialog.locator('details[data-permission-advanced=""]').evaluate((el) => { el.open = true; });
    const text = await dialog.innerText();
    assert.equal(text.split(COPY_LINE).length - 1, 1, 'the copy line appears exactly once');
    assert.doesNotMatch(text, /Ask your admin/);
    assert.match(text, new RegExp(`For ${APP}`));
    assert.match(text, /For admins/);
  } finally {
    await ui.close();
  }
});

test('the statement box is height-bounded and scrolls, so a long list does not make a tall dialog', async () => {
  const many = Array.from({ length: 60 }, (_, i) => `GRANT SELECT ON TABLE \`main\`.\`s\`.\`t${i}\` TO \`${APP}\``);
  const { ui, page } = await openLaunch([{ statements: many, principal: APP }]);
  try {
    const dialog = await openDialog(page);
    const box = dialog.locator('[data-permission-box=""]');
    const style = await box.evaluate((el) => ({ overflowY: getComputedStyle(el).overflowY, maxHeight: getComputedStyle(el).maxHeight,
      scroll: el.scrollHeight, client: el.clientHeight }));
    assert.equal(style.overflowY, 'auto', 'the box scrolls');
    assert.notEqual(style.maxHeight, 'none', 'the box has a height bound');
    assert.ok(style.scroll > style.client, 'the statements overflow the box, so the scrollbar is used');
  } finally {
    await ui.close();
  }
});

test('a non-grant reason is one plain sentence, shown without a Copy button when nothing is granted', async () => {
  const { ui, page } = await openLaunch([{ statements: [], principal: 'inspire-fwa-batch-a-walk-fraud', instructions: [REBUILD] }]);
  try {
    const dialog = await openDialog(page);
    assert.equal(await dialog.getByRole('button', { name: 'Copy' }).count(), 0, 'no Copy button: there is no GRANT to copy');
    assert.equal(await dialog.locator('[data-permission-statements=""]').count(), 0, 'no statement box');
    const notes = await dialog.locator('[data-permission-notes=""]').innerText();
    assert.equal(notes.trim(), REBUILD, 'the rebuild sentence shows once, as a plain note');
    assert.equal(await dialog.getByRole('button', { name: 'Copy steps' }).count(), 0, 'a note has no Copy steps button');
    assert.doesNotMatch(await dialog.innerText(), new RegExp(COPY_LINE));
  } finally {
    await ui.close();
  }
});

// AUTO-4: folder Share and CLI steps have their own Copy steps button; Copy stays for the GRANT statements only.
test('Copy steps copies the folder Share step and CLI line, and Copy still copies only the GRANT statements', async () => {
  const STEPS = ['In Workspace, open /Workspace/Users/pat/out > Share, add inspire-sp with Can Edit',
    "databricks api patch /api/2.0/permissions/directories/<object_id> --json '{}'"];
  const { ui, page } = await openLaunch([{ statements: GRANTS, principal: APP, steps: STEPS }]);
  try {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin });
    const dialog = await openDialog(page);
    await dialog.getByRole('button', { name: 'Copy steps' }).click();
    await until(async () => (await page.evaluate(() => navigator.clipboard.readText())) === STEPS.join('\n'), 'Copy steps copies the steps');
    await dialog.getByRole('button', { name: 'Copy', exact: true }).click();
    await until(async () => (await page.evaluate(() => navigator.clipboard.readText())) === GRANTS.map((s) => `${s};`).join('\n'),
      'Copy copies the GRANT statements only');
  } finally {
    await ui.close();
  }
});
