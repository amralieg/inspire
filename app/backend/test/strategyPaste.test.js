const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);
const LEVELS = ['Pillar', 'Goal', 'Objective', 'Priority'];
const names = (entries) => entries.map((e) => (e.children.length ? [e.name, names(e.children)] : e.name));

test('an indented list becomes the tree, with KPIs, key results and sponsors on the entry above them', async () => {
  const { parseStrategyPaste } = await lib('strategyPaste.js');
  const out = parseStrategyPaste([
    'Customer',
    '  - Win loyalty',
    '    KPI: Repeat purchase rate (%, increase)',
    '    Key result: Raise repeat purchase rate from 18% to 24%',
    '    Sponsor: Chief Customer Officer | reports to Chief Executive Officer',
    '  Grow basket',
    'Operations',
    '  1. Run lean',
    '       * Cut stockouts',
    'Sponsor: Chief Executive Officer',
  ].join('\n'), LEVELS);
  assert.deepEqual(names(out.strategy), [['Customer', ['Win loyalty', 'Grow basket']], ['Operations', [['Run lean', ['Cut stockouts']]]]]);
  const loyalty = out.strategy[0].children[0];
  assert.deepEqual(loyalty.kpis, [{ name: 'Repeat purchase rate', definition: '', unit: '%', direction: 'increase' }]);
  assert.deepEqual(loyalty.key_results, [{ statement: 'Raise repeat purchase rate from 18% to 24%', kpi: 'Repeat purchase rate' }]);
  assert.deepEqual(out.sponsors, [
    { role: 'Chief Customer Officer', name: '', reports_to: 'Chief Executive Officer', owns: ['Win loyalty'] },
    { role: 'Chief Executive Officer', name: '', reports_to: '', owns: [] },
  ], 'a top-level sponsor line owns nothing (must-exclude)');
  assert.deepEqual([out.entries, out.kpis, out.keyResults], [6, 1, 1]);
});

test('a line that names a level sets the depth, and a skipped level is reported instead of guessed', async () => {
  const { parseStrategyPaste } = await lib('strategyPaste.js');
  const out = parseStrategyPaste('Pillar: Customer\nGoal: Win loyalty\nKPI: Repeat rate\nPriority: Repeat buyers\nPillar: Operations\nGoal: Run lean', LEVELS);
  assert.deepEqual(names(out.strategy), [['Customer', [['Win loyalty', ['Repeat buyers']]]], ['Operations', ['Run lean']]]);
  assert.deepEqual(out.strategy[0].children[0].kpis.map((k) => k.name), ['Repeat rate'], 'an unindented KPI attaches to the entry above it');
  assert.match(out.notes.join(' '), /"Repeat buyers" is named a Priority but sits right under a Goal, so it becomes a Objective/);
});

test('a spreadsheet table with level headers fills blank cells from the row above and reads KPI and sponsor columns', async () => {
  const { parseStrategyPaste } = await lib('strategyPaste.js');
  const out = parseStrategyPaste([
    'Pillar\tGoal\tKPI\tUnit\tSponsor\tReports to\tNotes',
    'Customer\tWin loyalty\tRepeat purchase rate (increase)\t%\tChief Customer Officer\tChief Executive Officer\tx',
    '\tGrow basket\t\t\t\t\t',
    'Operations\tRun lean\t\t\tChief Operating Officer\t\t',
  ].join('\n'), LEVELS);
  assert.deepEqual(names(out.strategy), [['Customer', ['Win loyalty', 'Grow basket']], ['Operations', ['Run lean']]]);
  assert.deepEqual(out.strategy[0].children[0].kpis, [{ name: 'Repeat purchase rate', definition: '', unit: '%', direction: 'increase' }]);
  assert.deepEqual(out.sponsors.map((s) => [s.role, s.reports_to, s.owns]),
    [['Chief Customer Officer', 'Chief Executive Officer', ['Win loyalty']], ['Chief Operating Officer', '', ['Run lean']]]);
  assert.deepEqual(out.ignored, ['Notes']);
});

test('a markdown table and a headerless table map columns to levels in order', async () => {
  const { parseStrategyPaste } = await lib('strategyPaste.js');
  const md = parseStrategyPaste('| Pillar | Goal |\n|---|---|\n| Customer | Win loyalty |\n| | Grow basket |', LEVELS);
  assert.deepEqual(names(md.strategy), [['Customer', ['Win loyalty', 'Grow basket']]]);
  const bare = parseStrategyPaste('Customer\tWin loyalty\nOperations\tRun lean', LEVELS);
  assert.deepEqual(names(bare.strategy), [['Customer', ['Win loyalty']], ['Operations', ['Run lean']]]);
});

test('nothing pasted gives nothing, and a KPI line before any entry is not used', async () => {
  const { parseStrategyPaste } = await lib('strategyPaste.js');
  assert.deepEqual(parseStrategyPaste('  \n ', LEVELS).strategy, []);
  const out = parseStrategyPaste('KPI: Orphan rate\nCustomer', LEVELS);
  assert.deepEqual(names(out.strategy), ['Customer']);
  assert.deepEqual(out.strategy[0].kpis, [], 'the KPI does not jump onto a later entry (must-exclude)');
  assert.deepEqual(out.ignored, ['KPI: Orphan rate']);
});

test('the pasted tree serializes to what the agent accepts and validates clean', async () => {
  const { parseStrategyPaste } = await lib('strategyPaste.js');
  const ctx = await lib('strategyContext.js');
  const out = parseStrategyPaste('Customer\n  Win loyalty\n    KPI: Repeat rate (%)\nSponsor: CEO', LEVELS);
  const model = { ...ctx.emptyStrategy(), strategy: out.strategy, sponsors: out.sponsors };
  assert.deepEqual(ctx.validateStrategy(model), []);
  const sent = JSON.parse(ctx.serializeStrategy(model));
  assert.deepEqual(sent.levels, LEVELS);
  assert.deepEqual(sent.strategy, [{ name: 'Customer', children: [{ name: 'Win loyalty', kpis: [{ name: 'Repeat rate', unit: '%' }] }] }]);
  assert.deepEqual(sent.sponsors, [{ role: 'CEO' }]);
});

test('KPI and sponsor text read their parts', async () => {
  const { parseKpiText, parseSponsorText } = await lib('strategyPaste.js');
  assert.deepEqual(parseKpiText('On-time delivery (%, increase, share of orders on time)'),
    { name: 'On-time delivery', definition: 'share of orders on time', unit: '%', direction: 'increase' });
  assert.deepEqual(parseKpiText('Churn'), { name: 'Churn', definition: '', unit: '', direction: '' });
  assert.deepEqual(parseSponsorText('Chief Customer Officer, Dana Lee; reports to CEO; owns Customer, Loyalty'),
    { role: 'Chief Customer Officer', name: 'Dana Lee', reports_to: 'CEO', owns: ['Customer', 'Loyalty'] });
});
