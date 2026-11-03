import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { TABLE, appInfo, openApp, serveDist } from './harness.mjs';
import { DEFAULT_QUESTION, WALK_INSPIRE, WALK_PROFILE, answerProblem, targetProblem, walkGenie, walkScope } from './genieWalk.mjs';

const WALK = fileURLToPath(new URL('./genieWalk.mjs', import.meta.url));

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const NO_DATA_ANSWERS = [
  'There is no data for winter wear in the last quarter.',
  'The query returned no rows for this period, so I cannot say which category lost the most.',
  'I found no results matching that question in the tables.',
  'No records match the filters you asked about, so the loss rate cannot be shown.',
  'The result is empty: 0 rows were returned for the channel breakdown last quarter.',
  'The tables in this space do not contain any data about discounts by channel.',
  'I could not answer that question with the data in this space.',
  'There are no matching items for this period in the decision list today.',
  'Nothing was found for the stores you named in the region filter this week.',
  'Sorry, I can\'t find any category with discount losses in the tables.',
];

test('a Genie answer that says there is no data fails the walk, and an answer with data passes', () => {
  for (const text of NO_DATA_ANSWERS) assert.notEqual(answerProblem({ text }), '', `must fail: ${text}`);
  assert.match(answerProblem({ text: NO_DATA_ANSWERS[0] }), /Genie says there is no data \("There is no data"\)/);
  assert.match(answerProblem({ text: 'Fine.' }), /only 5 characters/);
  assert.match(answerProblem({ text: 'Books lost the most to discounts last quarter, about a third of the total loss.' }), /no number and no result table/);
  assert.match(answerProblem({ text: 'x', failed: true, error: 'Genie is busy' }), /Genie returned an error: Genie is busy/);
  assert.equal(answerProblem({ text: 'Books lost the most to discounts last quarter: 300,000, a third of the total.' }), '');
  assert.equal(answerProblem({ text: 'Books lost the most.', rows: 3 }), '', 'a short answer with its result table carries data');
  assert.equal(answerProblem({ text: 'Online lost 180,000 and stores lost 120,000 last quarter, so online needs attention first.' }), '');
});

const SCOPE = { profile: 'test-ws', inspire: ['inspire-test'] };
const INSPIRE = { name: 'inspire-test', description: 'Inspire AI v1.3.0', service_principal_client_id: 'sp-test' };
const APP = { name: 'pricing-desk', description: 'Inspire use case N01-U05 (session 42): Price-loss decision desk', compute_status: { state: 'ACTIVE' },
  url: 'https://pricing-desk-1.azure.databricksapps.com', creator: 'sp-test' };
const target = (over = {}) => targetProblem({ scope: SCOPE, profile: 'test-ws', inspire: INSPIRE, app: APP, ...over });

test('the live walk runs only on a running App that the named test Inspire App built on the one allowed workspace, and walks nothing else', () => {
  assert.deepEqual(walkScope({ [WALK_PROFILE]: ' test-ws ', [WALK_INSPIRE]: 'inspire-test, inspire-test2,' }), { profile: 'test-ws', inspire: ['inspire-test', 'inspire-test2'] });
  assert.deepEqual(walkScope({}), { profile: '', inspire: [] });
  assert.equal(target(), '');
  for (const scope of [walkScope({}), { profile: 'test-ws', inspire: [] }, { profile: '', inspire: ['inspire-test'] }]) {
    assert.match(target({ scope }), new RegExp(`set ${WALK_PROFILE} .* and ${WALK_INSPIRE} .* without both it walks nothing`));
  }
  for (const profile of ['other-ws', '']) assert.match(target({ profile }), /runs on test-ws only/);
  for (const name of ['inspire-prod', 'inspire-test-copy', '']) {
    assert.match(target({ inspire: { ...INSPIRE, name } }), /is not a test Inspire App the walk may use, only inspire-test/, name);
  }
  assert.match(target({ inspire: { ...INSPIRE, service_principal_client_id: '' } }), /has no service principal/);
  assert.match(target({ app: { ...APP, creator: 'sp-prod' } }), /pricing-desk was not built by inspire-test, so the walk never touches it/);
  assert.match(target({ app: { ...APP, creator: 'someone@example.com' } }), /was not built by inspire-test/);
  assert.match(target({ app: INSPIRE }), /inspire-test is not an App that Inspire built/);
  assert.match(target({ app: { ...APP, description: 'Concierge demo' } }), /is not an App that Inspire built/);
  assert.match(target({ app: { ...APP, compute_status: { state: 'STOPPED' } } }), /is not running \(compute STOPPED\)/);
  assert.match(target({ app: { ...APP, url: 'http://pricing-desk' } }), /has no https URL/);
  assert.match(target({ app: null }), /no such App/);
});

test('the walk command refuses before it reads any App when its scope is not set or the target is outside it', () => {
  const run = (args, env) => spawnSync(process.execPath, [WALK, ...args], { encoding: 'utf8', env: { PATH: '/nonexistent', ...env } });
  const unset = run(['--app', 'pricing-desk', '--inspire', 'inspire-test', '--profile', 'test-ws'], {});
  assert.equal(unset.status, 2);
  assert.match(unset.stderr, /FAIL set INSPIRE_WALK_PROFILE .* without both it walks nothing/);
  const env = { [WALK_PROFILE]: 'test-ws', [WALK_INSPIRE]: 'inspire-test' };
  assert.match(run(['--app', 'pricing-desk', '--inspire', 'inspire-prod', '--profile', 'test-ws'], env).stderr, /inspire-prod is not a test Inspire App/);
  assert.match(run(['--app', 'pricing-desk', '--inspire', 'inspire-test', '--profile', 'other-ws'], env).stderr, /runs on test-ws only, not other-ws/);
  assert.match(run(['--app', 'pricing-desk'], env).stderr, /usage: genieWalk\.mjs --app <built App> --inspire <test Inspire App> --profile <profile>/);
});

function genieRoutes(answers) {
  const asks = [];
  return {
    asks,
    routes: {
      'genie/ask': ({ route, json }) => {
        const body = route.request().postDataJSON();
        asks.push(body);
        return json(200, { conversation_id: `c-${body.page}`, message_id: `m${asks.length}` });
      },
      'genie/message': ({ json, url }) => {
        const said = answers[url.searchParams.get('page')] || { text: 'Books lost 300,000 to discounts last quarter.' };
        return json(200, { state: 'done', sql: 'SELECT 1', columns: [], rows: [], truncated: false, ...said });
      },
    },
  };
}

test('the walk asks every suggested question on every hub page and fails the page whose Genie answers with no data', async () => {
  const info = appInfo({}, 2, TABLE);
  const { asks, routes } = genieRoutes({ n02_u01: { text: 'There is no data for this question in the tables of this space.' } });
  const { page, seen, context } = await openApp(browser, served.base, info, { routes });
  const results = await walkGenie(page, served.base, info, { answerMs: 20000, pageMs: 20000 });
  const questions = info.pages[0].questions;
  assert.equal(questions.length, 2);
  assert.deepEqual(results.map((r) => [r.page, r.question, r.ok]), [
    ['n01_u05', questions[0], true], ['n01_u05', questions[1], true], ['n02_u01', questions[0], false], ['n02_u01', questions[1], false]]);
  assert.match(results[2].problem, /Genie says there is no data \("There is no data"\)/);
  assert.deepEqual(asks.map((a) => [a.page, a.question, a.conversation_id]), [
    ['n01_u05', questions[0], ''], ['n01_u05', questions[1], ''], ['n02_u01', questions[0], ''], ['n02_u01', questions[1], '']], 'each question starts a new chat');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a hub page with Ask Genie off, a page with no suggested question and a Genie error all show in the walk', async () => {
  const info = appInfo({}, 3, TABLE);
  info.pages[1].questions = [];
  info.pages[2].genie = { enabled: false, title: '', url: '', note: 'Ask Genie is off on this page because it has no Genie Agent yet.' };
  const { asks, routes } = genieRoutes({ n01_u05: { state: 'failed', error: 'Genie could not run the query' } });
  const { page, seen, context } = await openApp(browser, served.base, info, { routes });
  const results = await walkGenie(page, served.base, info, { answerMs: 20000, pageMs: 20000 });
  assert.deepEqual(results.map((r) => [r.page, r.ok]), [['n01_u05', false], ['n01_u05', false], ['n02_u01', true], ['n02_u02', false]]);
  assert.match(results[0].problem, /Genie returned an error: Genie could not run the query/);
  assert.equal(results[2].question, DEFAULT_QUESTION, 'a page without suggestions is asked the default question');
  assert.match(results[3].problem, /^Ask Genie is off on this page: .*no Genie Agent yet/);
  assert.equal(asks.filter((a) => a.page === 'n02_u02').length, 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});
