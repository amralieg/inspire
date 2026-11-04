import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { closeBrowser, lowContrast, openUi, setDark, settled, until } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_SESSIONS, REVIEW_STATE, RUN_SUMMARY } from './reviewFixtures.js';
import { LATEST_RUN_LABEL } from '../../src/lib/reviewFigures.js';
import * as V from '../../src/lib/v130UseCase.js';
import * as A from '../../src/lib/artifactFiles.js';
import { START_MVP_LABEL } from '../../src/lib/implementWizard.js';

const AdmZip = createRequire(import.meta.url)('../../../backend/node_modules/adm-zip');

test.after(closeBrowser);

const list = (page) => page.getByRole('region', { name: 'Use case list' });
const cards = (page) => list(page).locator('[aria-expanded]');
const card = (page, name) => cards(page).filter({ hasText: name });
const portfolio = (page) => page.getByRole('region', { name: 'Across all runs' });
const insight = (page, title) => page.locator(`[data-insight="${title}"]`);
const heading = (page) => page.locator('[data-run-heading]');

async function ready(page) {
  await list(page).waitFor();
  await cards(page).first().waitFor();
}

function outsideHosts(page) {
  const sent = [];
  page.on('request', (r) => {
    const url = r.url();
    if (/^(data|blob):/.test(url)) return;
    if (!/^https?:\/\/127\.0\.0\.1:\d+\//.test(url)) sent.push(url);
  });
  return sent;
}

test('Review lists the documents of an absolute output folder, and never asks for a relative or .. folder when the agent notebook path is unknown (must-exclude)', async () => {
  const listed = async (generationPath) => {
    const sessions = REVIEW_SESSIONS.map((s) => (s.session_id === '42' ? { ...s, generation_path: generationPath } : s));
    const ui = await openUi('results', { ...REVIEW_STATE, sessions });
    const asked = [];
    ui.page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.pathname === '/api/workspace/list') asked.push(u.searchParams.get('path'));
    });
    try {
      await ready(ui.page);
      await settled(ui.page, '[aria-label="Figures of this run"]');
      await ui.page.waitForTimeout(1000);
      assert.deepEqual(ui.pageErrors, []);
      return asked;
    } finally {
      await ui.close();
    }
  };
  assert.deepEqual(await listed('/Workspace/Users/a@example.com/out/'), ['/Workspace/Users/a@example.com/out/acme', '/Users/a@example.com/out/acme'],
    'an absolute output folder is listed in both workspace forms, so the harness does load documents');
  const relative = await listed('./../demos/');
  assert.deepEqual(relative.filter((p) => !p.startsWith('/') || p.split('/').some((seg) => seg === '.' || seg === '..')), [], relative.join(', '));
});

test('on a small screen the figures of the run below the fold already read their numbers before anyone scrolls to them', async () => {
  const ui = await openUi('results', REVIEW_STATE, '', { init: (page) => page.setViewportSize({ width: 390, height: 260 }) });
  const { page } = ui;
  try {
    await ready(page);
    const tile = (label) => page.locator(`[aria-label="Figures of this run"] [data-stat="${label}"]`);
    const below = await tile('Live assets').evaluate((el) => el.getBoundingClientRect().top >= window.innerHeight);
    assert.equal(below, true, 'the last figure starts below the fold, so the check covers a tile nobody has scrolled to');
    await settled(page, '[aria-label="Figures of this run"]');
    await page.waitForTimeout(1500);
    const read = async (label) => (await tile(label).locator('[data-stat-value]').innerText()).trim();
    assert.equal(await read('Best of Best'), '2');
    assert.equal(await read('Subdomains'), '5');
    assert.equal(await read('Live assets'), '4');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Review heads the open run with its catalog, business and date, shows each figure of this run once, and no totals across runs', async () => {
  const ui = await openUi('results', REVIEW_STATE);
  const { page } = ui;
  const outside = outsideHosts(page);
  try {
    await ready(page);
    assert.equal((await page.locator('h1').innerText()).trim(), 'Review', 'the page title is the tab');
    const head = heading(page);
    assert.equal(await head.getByRole('heading', { level: 2 }).innerText(), 'Acme Use Cases Catalog', 'a run with no catalog title reads Use Cases');
    assert.equal(await head.locator('[data-run-business]').innerText(), 'Acme');
    assert.match(await head.innerText(), /^This run\n/i);
    assert.match(await head.innerText(), /Updated Oct 31, 2026/);
    assert.equal(await head.locator('[data-latest-run]').innerText(), LATEST_RUN_LABEL);
    assert.equal(await head.getByRole('button', { name: 'Change run' }).count(), 1, 'Change run sits with the run it changes');

    const stat = (label, want) => page.waitForFunction(([l, w]) => {
      const el = document.querySelector(`[aria-label="Figures of this run"] [data-stat="${l}"] [data-stat-value]`);
      return el && el.textContent.trim() === w;
    }, [label, want], { timeout: 5000 });
    await stat('Best of Best', '2');
    await stat('Live assets', '4');
    await stat('Subdomains', '5');
    assert.equal(await page.locator('[data-portfolio], [data-portfolio-card]').count(), 0, 'with the portfolio read, Review still shows no totals across runs');
    assert.equal(await portfolio(page).count(), 0);
    assert.equal(await page.getByText('Across all runs in this Inspire Database').count(), 0);
    const runScope = await page.evaluate(() => {
      const words = ['Use Cases', 'Domains', 'High Priority'];
      const seen = Object.fromEntries(words.map((w) => [w, 0]));
      for (const el of document.querySelectorAll('main *, body *')) {
        if (el.closest('[data-browse]') || el.closest('[data-run-heading]')) continue;
        const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ');
        if (words.includes(own)) seen[own] += 1;
      }
      return seen;
    });
    assert.deepEqual(runScope, { 'Use Cases': 1, Domains: 1, 'High Priority': 1 },
      'above the use case browser, the Execution Complete strip no longer repeats the run cards');
    assert.equal(await page.getByText('Every step of the run finished.').count(), 1);
    const summary = page.locator('[data-executive-summary]');
    assert.deepEqual(await summary.locator('p').allInnerTexts(), RUN_SUMMARY.paragraphs, 'the summary results_json holds, in its paragraphs');
    assert.equal(await page.locator('canvas').count(), 0, 'opening a finished run fires no confetti');
    assert.deepEqual(outside, [], 'Review loads nothing from an outside host');

    await head.getByRole('button', { name: 'Change run' }).click();
    const runs = page.getByRole('group', { name: 'Runs' });
    await runs.locator('[data-run="42"]').waitFor();
    assert.equal((await runs.getByRole('heading').innerText()).trim().toLowerCase(), 'runs (6)');
    const row = (sid) => runs.locator(`[data-run="${sid}"]`);
    const badges = {};
    for (const sid of ['42', '41', '50', '51', '60', '61']) badges[sid] = await row(sid).locator('[data-latest-run]').count();
    assert.deepEqual(badges, { 42: 1, 41: 0, 50: 0, 51: 0, 60: 0, 61: 0 },
      'only a business with two runs gets the label, on its newest; one run and unnamed runs get none');
    assert.equal(await row('42').locator('[data-run-figures]').innerText(), '6 use cases · 2 domains · 5 subdomains · 2 Best of Best · 1 MVP, 1 live · 4 live assets');
    assert.equal(await row('51').locator('[data-run-figures]').innerText(), '3 use cases · 1 domain', 'a run the portfolio does not list falls back to its overview');
    for (const dark of [false, true]) {
      await setDark(page, dark);
      const measured = await lowContrast(page, ['[aria-label="Runs"]']);
      assert.ok(measured.checked >= 18, `${dark ? 'dark' : 'light'}: measured ${measured.checked}`);
      assert.deepEqual(measured.low, [], `${dark ? 'dark' : 'light'} run list`);
    }
    await row('41').click();
    await ready(page);
    assert.equal(await heading(page).locator('[data-latest-run]').count(), 0, 'an older run of a business has no label');
    for (const dark of [false, true]) {
      await setDark(page, dark);
      const measured = await lowContrast(page, ['[data-run-heading]', '[data-executive-summary]']);
      assert.ok(measured.checked >= 6, `${dark ? 'dark' : 'light'}: measured ${measured.checked}`);
      assert.deepEqual(measured.low, [], `${dark ? 'dark' : 'light'} run heading and summary`);
    }
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a run whose results_json holds no summary string shows no summary panel', async () => {
  const { executive_summary: _gone, ...bare } = REVIEW_RESULTS;
  for (const [label, summary] of [['none', undefined], ['empty', ''], ['an object', { markdown: 'Written by no agent' }], ['a list', ['Written by no agent']]]) {
    const ui = await openUi('results', { ...REVIEW_STATE, results: { ...bare, domains_summary: '', ...(summary === undefined ? {} : { executive_summary: summary }) } });
    const { page } = ui;
    try {
      await ready(page);
      await page.locator('[data-stat="Use Cases"]').waitFor();
      assert.equal(await page.locator('#executive-summary').count(), 0, label);
      assert.equal(await page.getByText('Executive summary', { exact: true }).count(), 0, label);
      assert.deepEqual(ui.pageErrors, [], label);
    } finally {
      await ui.close();
    }
  }
});

const progressive = (extra = {}) => ({
  title: 'Use Cases Catalog (In Progress)', domains_summary: '', table_registry: {}, column_registry: {},
  domains: REVIEW_RESULTS.domains, _progressive: true, _use_case_count: 6, _step_count: 9, ...extra,
});

test('a run that is still going shows the summary its results_json already holds, and none when it holds none', async () => {
  for (const [label, stepResults, shown] of [
    ['written', progressive({ executive_summary: RUN_SUMMARY.results_json.executive_summary }), RUN_SUMMARY.paragraphs],
    ['not yet', progressive({ executive_summary: '' }), []],
  ]) {
    const ui = await openUi('results', { ...REVIEW_STATE, results: null, stepResults });
    const { page } = ui;
    try {
      await ready(page);
      await page.getByText('Live Preview').waitFor();
      assert.match(await page.locator('[data-testid="live-use-case-count"]').innerText(), /^\d+ use cases? drafted so far$/, label);
      assert.doesNotMatch(await page.locator('body').innerText(), /completed steps/, label);
      assert.deepEqual(await page.locator('[data-executive-summary] p').allInnerTexts(), shown, label);
      assert.deepEqual(ui.pageErrors, [], label);
    } finally {
      await ui.close();
    }
  }
});

test('Start lists the runs with Latest Run only on the newest run of a business with two or more runs, on its first page and on the launch form', async () => {
  const want = { 42: 1, 41: 0, 50: 0, 51: 0, 60: 0, 61: 0 };
  const read = async (page, scope) => {
    const seen = {};
    for (const sid of Object.keys(want)) seen[sid] = await scope.locator(`[data-run="${sid}"] [data-latest-run]`).count();
    return seen;
  };
  const choose = await openUi('choose', REVIEW_STATE);
  try {
    await choose.page.getByText('Beta Foods', { exact: true }).first().waitFor();
    assert.equal(await choose.page.locator('button button').count(), 0, 'no button sits inside another button');
    await choose.page.locator('[data-run="42"]').waitFor();
    await choose.page.getByRole('button', { name: /Show 1 more experiment/ }).click();
    await choose.page.locator('[data-run="61"]').waitFor();
    assert.deepEqual(await read(choose.page, choose.page), want);
    assert.equal(await choose.page.locator('button button').count(), 0, 'and none after Show more either');
    const opened = () => choose.page.locator('output[aria-label="Opened runs"]').textContent();
    const box = await choose.page.locator('[data-run="42"]').boundingBox();
    await choose.page.mouse.click(box.x + box.width - 10, box.y + box.height / 2);
    assert.equal(await opened(), '42', 'a click anywhere on the row opens the run, its chevron edge too');
    await choose.page.locator('[data-run="51"]').getByRole('button', { name: 'Quick View' }).click();
    await choose.page.locator('[data-run="51"]').getByRole('button', { name: 'Hide' }).waitFor();
    assert.equal(await opened(), '42', 'Quick View opens its panel and not the run');
    await choose.page.locator('[data-run="42"]').getByRole('button', { name: /Acme/ }).first().waitFor();
    assert.deepEqual(choose.pageErrors, []);
  } finally {
    await choose.close();
  }
  const launch = await openUi('launch', REVIEW_STATE);
  try {
    await launch.page.getByRole('button', { name: /Discovery Overview/ }).click();
    const overview = launch.page.getByRole('region', { name: 'Discovery Overview' });
    await overview.locator('[data-run="61"]').waitFor();
    assert.deepEqual(await read(launch.page, overview), want);
    assert.equal(await overview.getByRole('button', { name: 'Open in Review' }).count(), 6);
    assert.equal(await overview.locator('[data-run="60"]').getByText('No business name').count(), 1);
  } finally {
    await launch.close();
  }
});

const blankBelow = (page) => page.locator('[data-insight]').evaluateAll((els) => els.map((el) => {
  const kids = [...el.querySelectorAll('*')].filter((k) => k.getBoundingClientRect().height > 0);
  const last = Math.max(...kids.map((k) => k.getBoundingClientRect().bottom));
  return { title: el.dataset.insight, blank: Math.round(el.getBoundingClientRect().bottom - last) };
}));

test('the insight cards stack at full width with no Strategy coverage card and no Data foundations card, and no card holds a tall empty area', async () => {
  const ui = await openUi('results', REVIEW_STATE);
  const { page } = ui;
  try {
    await ready(page);
    const grid = page.locator('[data-insights-grid]');
    await grid.waitFor();
    assert.ok(REVIEW_STATE.results.foundations.length > 0, 'the results still carry shared foundations');
    assert.equal(await grid.getAttribute('data-insights-grid'), '1');
    assert.equal(await grid.getAttribute('data-insights-columns'), '1');
    assert.equal(await insight(page, 'Strategy coverage').count(), 0, 'no Strategy coverage card');
    assert.equal(await insight(page, 'Data foundations').count(), 0, 'no Data foundations card');
    assert.equal(await page.getByText('Data foundations').count(), 0, 'the page never says Data foundations');
    for (const width of [1440, 1024, 700]) {
      await page.setViewportSize({ width, height: 1000 });
      await settled(page, '[data-insights-grid]');
      const order = await page.locator('[data-insight]').evaluateAll((els) => els.map((el) => el.dataset.insight));
      assert.deepEqual(order, ['Feedback and value'], `${width}: the feedback note alone`);
      const widths = await page.locator('[data-insight]').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().width)));
      assert.equal(new Set(widths).size, 1, `${width}: each card takes the whole width`);
      for (const b of await blankBelow(page)) assert.ok(b.blank <= 24, `${width}: ${b.title} ends where its content ends (${b.blank}px blank)`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });

    const note = insight(page, 'Feedback and value');
    assert.equal(await note.locator('[data-feedback-note]').innerText(), V.FEEDBACK_OFF_TEXT);
    assert.doesNotMatch(await note.innerText(), /\bv?\d+\.\d+(\.\d+)?\b/, 'no version number');

    await card(page, 'Score upsell').click();
    await until(async () => (await card(page, 'Score upsell').getAttribute('aria-expanded')) === 'true', 'the use case opens');
    assert.equal(await page.getByText('Data foundations').count(), 0, 'an open use case shows no Data foundations');

    for (const dark of [false, true]) {
      await setDark(page, dark);
      const measured = await lowContrast(page, ['[data-insights-grid]']);
      assert.ok(measured.checked >= 2, `${dark ? 'dark' : 'light'}: measured ${measured.checked}`);
      assert.deepEqual(measured.low, [], `${dark ? 'dark' : 'light'} insight cards`);
    }
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('with feedback on and none given yet, the feedback note says how to give it and stands alone', async () => {
  const feedback = (app) => app.get('/api/inspire/feedback', (_req, res) => res.json({ available: true, latest: [], history: [] }));
  const { strategy_coverage: _s, ...noCoverage } = REVIEW_RESULTS;
  const ui = await openUi('results', { ...REVIEW_STATE, results: noCoverage }, '', { mount: feedback });
  const { page } = ui;
  try {
    await ready(page);
    const grid = page.locator('[data-insights-grid="1"]');
    await grid.waitFor();
    assert.equal(await grid.getAttribute('data-insights-columns'), '1');
    assert.equal(await insight(page, 'Feedback and value').locator('[data-feedback-note]').innerText(), V.FEEDBACK_EMPTY_TEXT);
    const widths = await page.locator('[data-insight]').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().width)));
    assert.equal(new Set(widths).size, 1, 'each card takes the whole width');
    for (const b of await blankBelow(page)) assert.ok(b.blank <= 24, `${b.title}: ${b.blank}px blank`);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
function workbook() {
  const zip = new AdmZip();
  const add = (name, text) => zip.addFile(name, Buffer.from(`${XML}${text}`, 'utf8'));
  add('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    + '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>');
  add('_rels/.rels', `<Relationships xmlns="${RELS}"><Relationship Id="rId1" Type="${DOC}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  add('xl/workbook.xml', `<workbook xmlns="${MAIN}" xmlns:r="${DOC}"><sheets><sheet name="Use Cases" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  add('xl/_rels/workbook.xml.rels', `<Relationships xmlns="${RELS}"><Relationship Id="rId1" Type="${DOC}/worksheet" Target="worksheets/sheet1.xml"/>`
    + `<Relationship Id="rId2" Type="${DOC}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`);
  add('xl/sharedStrings.xml', `<sst xmlns="${MAIN}" count="4" uniqueCount="4"><si><t>No</t></si><si><t>Name</t></si><si><t>N01-U01</t></si><si><t>Predict churn</t></si></sst>`);
  add('xl/worksheets/sheet1.xml', `<worksheet xmlns="${MAIN}"><sheetData>`
    + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>Score</t></is></c></row>'
    + '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c><c r="C2"><v>4.6</v></c></row></sheetData></worksheet>');
  return zip.toBuffer();
}

test('an Excel catalog previews from the code Inspire ships, with no script from an outside host, and a broken file says so', async () => {
  const folder = '/Workspace/Users/someone/inspire/acme';
  const files = { 'catalog.xlsx': workbook(), 'broken.xlsx': Buffer.from('not a workbook') };
  const mount = (app) => {
    app.get('/api/workspace/list', (_req, res) => res.json({ files: Object.keys(files).map((name) => ({ name, path: `${folder}/${name}`, is_directory: false, file_size: 2048 })) }));
    app.get('/api/workspace/export', (req, res) => res.type('application/octet-stream').send(files[String(req.query.path).split('/').pop()]));
  };
  const sessions = REVIEW_STATE.sessions.map((s) => (s.session_id === '42' ? { ...s, generation_path: folder, widget_values: { ...s.widget_values, generation_path: folder } } : s));
  const ui = await openUi('results', { ...REVIEW_STATE, sessions }, '', { mount });
  const { page } = ui;
  const outside = outsideHosts(page);
  try {
    await ready(page);
    const quick = page.locator('div', { has: page.getByRole('heading', { name: /^Quick access/i }) })
      .filter({ has: page.getByRole('button', { name: /Preview/ }) }).last();
    await quick.waitFor();
    const fileRow = (name) => quick.locator('div', { hasText: name }).filter({ has: page.getByRole('button', { name: /Preview/ }) }).last();
    await fileRow('catalog.xlsx').getByRole('button', { name: /Preview/ }).click();
    const table = quick.locator('table');
    await table.waitFor({ timeout: 15000 });
    assert.deepEqual((await table.locator('thead th').allInnerTexts()).map((t) => t.trim()), ['#', 'No', 'Name', 'Score']);
    assert.deepEqual((await table.locator('tbody tr').first().locator('td').allInnerTexts()).map((t) => t.trim()), ['1', 'N01-U01', 'Predict churn', '4.6']);
    assert.deepEqual(await table.locator('[data-grid-move]').evaluateAll((els) => els.map((b) => b.getAttribute('aria-label'))),
      ['Move the No column', 'Move the Name column', 'Move the Score column'], 'every sheet column moves, the row number stays first');
    assert.equal(await table.getByRole('button', { name: 'Filter Score' }).count(), 1);
    await fileRow('broken.xlsx').getByRole('button', { name: /Preview/ }).click();
    await quick.getByText(A.EXCEL_UNREADABLE).waitFor({ timeout: 15000 });
    assert.deepEqual(outside, [], 'nothing came from an outside host');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a live preview heads the run with its business name and offers no MVP start for use cases the run has not saved yet (must-exclude)', async () => {
  const { title: _final, ...preview } = REVIEW_RESULTS;
  const live = await openUi('results', { ...REVIEW_STATE, results: null, stepResults: { ...preview, _progressive: true, _use_case_count: 3, _step_count: 4 } });
  try {
    await ready(live.page);
    await live.page.getByText('Live Preview', { exact: true }).waitFor();
    const named = (await heading(live.page).locator('h2').innerText()).trim();
    const business = (await heading(live.page).locator('[data-run-business]').innerText()).trim();
    assert.equal(named, `${business} Use Cases Catalog`, 'the heading names the business, never its description');
    assert.equal(await live.page.getByRole('button', { name: START_MVP_LABEL }).count(), 0, 'a preview row is not in the use case table yet');
    assert.ok((await live.page.getByText(`${START_MVP_LABEL} opens on each use case once the run has saved it.`).count()) > 0);
    assert.deepEqual(live.pageErrors, []);
  } finally {
    await live.close();
  }
  const saved = await openUi('results', REVIEW_STATE);
  try {
    await ready(saved.page);
    assert.ok((await saved.page.getByRole('button', { name: START_MVP_LABEL }).count()) > 0, 'a finished run still offers the MVP start');
  } finally {
    await saved.close();
  }
});
