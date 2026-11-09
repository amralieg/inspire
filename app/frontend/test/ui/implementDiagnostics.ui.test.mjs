import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { defaultSpecFromUseCase } from '../../src/lib/implementWizard.js';
import { DIAGNOSTICS_PRIVACY_NOTE, INSPIRE_NEW_ISSUE_URL, REPORT_ISSUE_NOTE } from '../../src/lib/issues.js';
import { HARNESS_INSPIRE_URL, HARNESS_USE_CASE, HARNESS_SETTINGS, HARNESS_SESSION_ID } from './implementFixtures.js';
import { closeBrowser, openUi, painted } from './uiSupport.mjs';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const SECRET_TABLE = 'main.s.orders';
const ERROR = `[UNRESOLVED_COLUMN.WITH_SUGGESTION] A column with name \`basket_size\` cannot be resolved in ${SECRET_TABLE} WHERE tier = 'Gold' by ${OWNER}`;
const spec = () => ({
  ...defaultSpecFromUseCase(HARNESS_USE_CASE, { warehouseId: HARNESS_SETTINGS.warehouseId, inspireDatabase: HARNESS_SETTINGS.inspireDatabase, sessionId: HARNESS_SESSION_ID, owner: OWNER }),
  outputs: { dashboard: true, inspire_url: HARNESS_INSPIRE_URL },
});
const step = (phase, status, at, message = '') => ({
  step_id: `${phase}-${status}`, stage_name: 'Implement Use Cases', step_name: `Inspire is working on ${phase.toLowerCase()}`, sub_step_name: 'Completed: n01-u01',
  status, message, last_updated: at, result_json: JSON.stringify({ use_case_id: 'N01-U01', phase, spec_version: 1 }),
});
const STATE = {
  me: { userName: OWNER, displayName: 'Owner' },
  buildStamp: { version: '1.5.0', shell: 'feedface00112233' },
  history: [{
    session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status: 'failed', change_classes: 'initial', created_by: OWNER, spec_json: JSON.stringify(spec()),
    status_message: `Preview run failed: ${ERROR}`, job_id: '77', implement_run_id: '5555', last_preview_run_id: '9001',
    notebook_path: `/Users/${OWNER}/inspire/Acme_implemented/N01-U01`, created_at: '2026-11-08T10:00:00.000Z', updated_at: '2026-11-08T10:12:00.000Z',
  }],
  steps: [step('Plan', 'ended_success', '2026-11-08T10:01:00.000Z'), step('Preview run', 'ended_error', '2026-11-08T10:12:00.000Z', ERROR)],
};

const grantClipboard = async (page, origin) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await page.context().route('https://github.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>new issue</title>' }));
};

async function openCard(state = STATE) {
  const ui = await openUi('implement', state, '', { init: grantClipboard });
  try {
    await ui.page.locator('[data-progress-card] [data-diagnostics-download]').waitFor({ timeout: 15000 });
    await painted(ui.page);
  } catch (e) {
    await ui.close();
    throw e;
  }
  return ui;
}

const boxes = (page) => page.locator('[data-progress-card]').evaluate((card) => {
  const of = (sel) => { const r = card.querySelector(sel).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
  const c = card.getBoundingClientRect();
  return { card: { left: c.left, right: c.right }, show: of('[data-progress-show]'), download: of('[data-diagnostics-download]'), copy: of('[data-diagnostics-copy]'), report: of('[data-diagnostics-report]'), note: of('[data-diagnostics-note]') };
});

const ROW = ['data-progress-show', 'data-diagnostics-download', 'data-diagnostics-copy', 'data-diagnostics-report'];

async function assertRow(page, rtl) {
  const order = await page.locator('[data-progress-card] [data-progress-show]').evaluate((show) => [...show.parentElement.children]
    .map((el) => ['data-progress-show', 'data-diagnostics-download', 'data-diagnostics-copy', 'data-diagnostics-report'].find((a) => el.hasAttribute(a)))
    .filter(Boolean));
  assert.deepEqual(order, ROW, 'the three controls follow Show progress in one row of the card');
  const b = await boxes(page);
  const line = [b.show, b.download, b.copy, b.report];
  for (const x of line) assert.ok(Math.abs(x.top - b.show.top) < 2, `every control sits on the Show progress line: ${JSON.stringify(b)}`);
  for (const x of line) assert.ok(x.left >= b.card.left - 0.5 && x.right <= b.card.right + 0.5, 'nothing spills out of the card');
  for (let i = 1; i < line.length; i += 1) {
    const gap = rtl ? line[i - 1].left - line[i].right : line[i].left - line[i - 1].right;
    assert.ok(gap >= 0 && gap <= 12, `control ${i} sits right next to the one before it (${gap}px, ${rtl ? 'right to left' : 'left to right'})`);
  }
  assert.ok(b.note.top >= b.show.bottom, 'the privacy note sits under the buttons');
}

test('Download diagnostics, Copy diagnostics and Report issue sit right after Show progress with the privacy note under them, left to right and right to left', async () => {
  const ui = await openCard();
  const { page } = ui;
  try {
    const card = page.locator('[data-progress-card]');
    assert.equal((await card.locator('[data-diagnostics-note]').textContent()).trim(), `${DIAGNOSTICS_PRIVACY_NOTE} ${REPORT_ISSUE_NOTE}`);
    assert.match(DIAGNOSTICS_PRIVACY_NOTE, /no data values, names, emails or workspace address, and table and column names are replaced by labels/);
    assert.match(REPORT_ISSUE_NOTE, /public/);
    await assertRow(page, false);
    await page.evaluate(() => { document.documentElement.dir = 'rtl'; });
    await painted(page);
    assert.equal(await card.locator('[data-diagnostics-download]').evaluate((el) => el.matches(':dir(rtl)')), true);
    await assertRow(page, true);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Download and Copy give the identical masked text, and Report issue opens a new tab on a prefilled GitHub issue that holds no log (must-exclude: no email, path or table name)', async () => {
  const ui = await openCard();
  const { page } = ui;
  try {
    const card = page.locator('[data-progress-card]');
    const [download] = await Promise.all([page.waitForEvent('download'), card.locator('[data-diagnostics-download]').click()]);
    assert.equal(download.suggestedFilename(), 'inspire-diagnostics-N01-U01-v1.txt');
    const saved = fs.readFileSync(await download.path(), 'utf8');
    await card.locator('[data-diagnostics-copy]').click();
    await card.getByRole('button', { name: 'Copied diagnostics' }).waitFor();
    assert.equal((await card.locator('[data-diagnostics-said]').textContent()).trim(), 'The diagnostics are on your clipboard.');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(copied, saved, 'Copy and Download hold the same text');
    for (const fact of ['App and agent version: 1.5.0', 'Build status: failed', 'Job id: 77', 'Build run id: 5555', '- Preview run: error', 'UNRESOLVED_COLUMN.WITH_SUGGESTION']) {
      assert.ok(saved.includes(fact), `the file says ${fact}`);
    }
    for (const secret of [OWNER, SECRET_TABLE, 'orders', 'basket_size', 'Gold', 'workspace.example.com', ['', 'Users', 'owner'].join('/'), 'Acme']) {
      assert.ok(!saved.includes(secret), `the file never holds ${secret}`);
    }
    const report = card.locator('[data-diagnostics-report]');
    await page.waitForFunction(() => document.querySelector('[data-diagnostics-report]').href.includes('?title='));
    assert.equal(await report.getAttribute('target'), '_blank');
    assert.equal(await report.getAttribute('rel'), 'noopener noreferrer');
    const href = await report.getAttribute('href');
    const url = new URL(href);
    assert.equal(`${url.origin}${url.pathname}`, INSPIRE_NEW_ISSUE_URL);
    const body = url.searchParams.get('body');
    assert.match(url.searchParams.get('title'), /^Build failed at Preview run in Inspire 1\.5\.0$/);
    assert.match(body, /Build step: Preview run \(error\)/);
    for (const secret of [OWNER, SECRET_TABLE, 'basket_size', 'Gold', 'Steps (', 'Job id']) assert.ok(!decodeURIComponent(href).includes(secret), `the issue never holds ${secret}`);
    const [tab] = await Promise.all([page.context().waitForEvent('page'), report.click()]);
    await tab.waitForLoadState();
    assert.equal(tab.url(), href, 'Report issue opens the prefilled issue in a new tab');
    assert.equal(await tab.evaluate(() => window.opener), null, 'the new tab cannot reach the App');
    await tab.close();
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the Build page reads no diagnostics until the person reaches for them, and a first Report issue click still opens the prefilled issue (must-exclude)', async () => {
  const ui = await openCard();
  const { page } = ui;
  const reads = [];
  page.on('request', (r) => { if (r.url().includes('/api/inspire/implement/diagnostics')) reads.push(r.url()); });
  try {
    const card = page.locator('[data-progress-card]');
    await page.waitForTimeout(1500);
    assert.deepEqual(reads, [], 'loading and polling the Build page sends no diagnostics read');
    const report = card.locator('[data-diagnostics-report]');
    assert.equal(await report.getAttribute('href'), INSPIRE_NEW_ISSUE_URL, 'nothing is read yet, so the link is the plain new issue page');
    const [tab] = await Promise.all([page.context().waitForEvent('page'), report.click()]);
    await tab.waitForURL(/\?title=/);
    const url = new URL(tab.url());
    assert.equal(`${url.origin}${url.pathname}`, INSPIRE_NEW_ISSUE_URL);
    assert.equal(url.searchParams.get('title'), 'Build failed at Preview run in Inspire 1.5.0');
    assert.ok(!url.searchParams.get('body').includes(OWNER) && !url.searchParams.get('body').includes(SECRET_TABLE), 'the issue is masked');
    assert.equal(await tab.evaluate(() => window.opener), null, 'the new tab cannot reach the App');
    assert.ok(reads.length >= 1, 'reaching for Report issue reads the diagnostics');
    await tab.close();
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the keyboard reaches Download, Copy and Report issue right after Show progress, and Enter and Space work them', async () => {
  const ui = await openCard();
  const { page } = ui;
  try {
    const card = page.locator('[data-progress-card]');
    await card.locator('[data-progress-show]').focus();
    const focused = () => page.evaluate(() => ['data-progress-show', 'data-diagnostics-download', 'data-diagnostics-copy', 'data-diagnostics-report']
      .find((a) => document.activeElement?.hasAttribute(a)) || document.activeElement?.tagName);
    const seen = [await focused()];
    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press('Tab');
      seen.push(await focused());
    }
    assert.deepEqual(seen, ROW);
    await card.locator('[data-diagnostics-copy]').focus();
    await page.keyboard.press('Space');
    await card.getByRole('button', { name: 'Copied diagnostics' }).waitFor();
    await card.locator('[data-diagnostics-download]').focus();
    const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
    assert.equal(download.suggestedFilename(), 'inspire-diagnostics-N01-U01-v1.txt');
    for (const sel of ROW.slice(1)) {
      assert.ok(await card.locator(`[${sel}]`).evaluate((el) => el.getAttribute('aria-describedby') && document.getElementById(el.getAttribute('aria-describedby'))?.textContent.includes('no private or personal data')),
        `${sel} is described by the privacy note`);
    }
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
