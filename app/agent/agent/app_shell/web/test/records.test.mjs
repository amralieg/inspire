import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HELD, addedValues, aiValue, askQuestions, changedValues, columnLabel, doneText, dueText, evidenceOf, explainContext, formProblems, formValues,
  historyChanges, initials, inputOf, recordRef, recordView, savingText, suggestions, toInput, valueText, whenText, whoText,
} from '../src/records.js';
import { dayLabel, formatValue } from '../src/format.js';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileNames } from './harness.mjs';

process.env.TZ = 'Asia/Kolkata';
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

const FRONTEND = join(SRC, '..', '..', '..', '..', '..', 'frontend', 'src');
const SHARED = { 'kinds.js': join('lib', 'kinds.js') };

function sourcesUnder(dir, skip) {
  if (!existsSync(dir)) return '';
  return readdirSync(dir).map((name) => {
    const path = join(dir, name);
    const kind = lstatSync(path);
    if (kind.isDirectory()) return sourcesUnder(path, skip);
    return kind.isFile() && /\.jsx?$/.test(name) && path !== skip ? readFileSync(path, 'utf8') : '';
  }).join('\n');
}

const count = (text, name) => (text.match(new RegExp(`\\b${name}\\b`, 'g')) || []).length;
const stem = (file) => file.replace(/\.jsx?$/, '');

function localNames(text, file, name) {
  return [...text.matchAll(/import\s+(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*'\.\/([^']+)'/g)].filter((m) => stem(m[2]) === stem(file))
    .flatMap((m) => m[1].split(',').map((part) => part.trim().split(/\s+as\s+/)).filter(([imported]) => imported === name).map((pair) => pair[pair.length - 1]));
}

function unusedExports(files, callers = {}) {
  const used = (file, name) => count(files[file], name) >= 2 || count(callers[file] || '', name) >= 2
    || Object.entries(files).some(([other, text]) => other !== file && localNames(text, file, name).some((local) => count(text, local) >= 2));
  return Object.entries(files).flatMap(([file, text]) => [...text.matchAll(/^export (?:async )?(?:const|function|class) ([A-Za-z_]\w*)/gm)]
    .map((m) => m[1]).filter((name) => !used(file, name)).map((name) => `${file}: ${name}`));
}

test('every helper the App exports has a caller in the App, and the check catches one that has none', () => {
  const files = Object.fromEntries(fileNames(SRC).filter((f) => /\.jsx?$/.test(f)).map((f) => [f, readFileSync(join(SRC, f), 'utf8')]));
  assert.ok(Object.keys(files).length > 30);
  const callers = Object.fromEntries(Object.entries(SHARED).map(([file, relay]) => [file, sourcesUnder(FRONTEND, join(FRONTEND, relay))]));
  assert.deepEqual(unusedExports(files, callers), []);
  assert.deepEqual(unusedExports({ ...files, 'extra.js': 'export function lonely() {\n  return 1;\n}\nexport const used = 2;\nconst twice = used;\n' }, callers),
    ['extra.js: lonely']);
  assert.deepEqual(unusedExports({ ...files, 'kinds.js': `${files['kinds.js']}export const nobodyReads = 1;\n` }, callers), ['kinds.js: nobodyReads'],
    'a shared helper still needs a caller in the App or the Inspire App, not only the line that passes it on');
  assert.deepEqual(unusedExports(files, { 'kinds.js': callers['kinds.js'].replace(/\b(familyOf|kindForTechnique)\b/g, 'x') }).sort(),
    ['kinds.js: familyOf', 'kinds.js: kindForTechnique']);
  const twin = { 'a.js': 'export const pick = (id) => id;\n', 'b.js': 'export const pick = (page) => page.id;\nconst both = (p) => pick(p);\n' };
  assert.deepEqual(unusedExports(twin), ['a.js: pick'], 'a helper of the same name in another file is not a caller');
  assert.deepEqual(unusedExports({ ...twin, 'c.js': "import { pick as choose } from './a.js';\nexport const one = choose(1);\nconst again = one;\n" }), [],
    'a file that imports the helper, even under another name, is its caller');
  assert.deepEqual(unusedExports({ ...twin, 'c.js': "import { pick } from './a.js';\nexport const one = 1;\nconst again = one;\n" }), ['a.js: pick'],
    'an import that is never used is not a caller');
});

const F = (name, kind, extra = {}) => ({ name, kind, type: 'STRING', role: 'business', editable: true, ...extra });
const FIELDS = [
  F('entity_id', 'text', { role: 'id', editable: false }), F('entity_label', 'text'), F('rank', 'integer', { type: 'INT' }),
  F('value', 'decimal', { type: 'DECIMAL' }), F('flagged', 'boolean', { type: 'BOOLEAN' }), F('due', 'date', { type: 'DATE' }),
  F('seen_at', 'timestamp', { type: 'TIMESTAMP' }), F('top_reasons', 'lines', { type: 'ARRAY' }), F('recommended_action', 'text'),
  F('as_of_date', 'date', { role: 'run', editable: false }), F('valid_from', 'timestamp', { role: 'history', editable: false }),
];
const META = { key: 'entity_id', label: 'entity_label', label_title: 'Item', tier: 'priority_tier', rank: 'rank', action: 'recommended_action',
  columns: [{ column: 'value', label: 'Loss', format: 'currency', currency: 'USD' }], detail: [] };
const ROW = { entity_id: 'R1', entity_label: 'Item 1', rank: 3, value: 120.5, flagged: false, due: '2026-10-01', seen_at: '2026-10-27T03:01:02.123Z',
  top_reasons: ['late', 'price rise'], recommended_action: 'Cut it', as_of_date: '2026-10-15' };

test('each column type gets its own input', () => {
  assert.deepEqual(inputOf(FIELDS[2]), { tag: 'input', type: 'number', step: '1', inputMode: 'numeric' });
  assert.equal(inputOf(FIELDS[3]).step, 'any');
  assert.equal(inputOf(FIELDS[4]).tag, 'select');
  assert.equal(inputOf(FIELDS[5]).type, 'date');
  assert.equal(inputOf(FIELDS[6]).type, 'datetime-local');
  assert.equal(inputOf(FIELDS[7]).tag, 'textarea');
  assert.equal(inputOf(FIELDS[8]).tag, 'textarea', 'an action is long text');
  assert.equal(inputOf(FIELDS[1], 'short').tag, 'input');
  assert.equal(inputOf(FIELDS[1], 'x'.repeat(61)).tag, 'textarea');
});

test('values load into inputs and only the changed ones are sent', () => {
  const form = formValues(FIELDS, ROW);
  assert.deepEqual(Object.keys(form), ['entity_label', 'rank', 'value', 'flagged', 'due', 'seen_at', 'top_reasons', 'recommended_action']);
  assert.equal(form.flagged, 'false');
  assert.equal(form.seen_at, '2026-10-27T03:01:02');
  assert.equal(form.top_reasons, 'late\nprice rise');
  assert.deepEqual(changedValues(FIELDS, ROW, form), {});
  const edited = { ...form, value: '99', top_reasons: 'late\n\n new one ', recommended_action: '' };
  assert.deepEqual(changedValues(FIELDS, ROW, edited), { value: '99', top_reasons: ['late', 'new one'], recommended_action: '' });
  assert.equal(toInput(FIELDS[4], null), '');
  assert.equal(toInput(FIELDS[6], '2026-10-27 03:01:02+04:00'), '2026-10-27T03:01:02');
});

test('a new record needs its id and sends only the values filled in', () => {
  const blank = formValues(FIELDS, null, 'entity_id');
  assert.equal(blank.entity_id, '');
  assert.deepEqual(formProblems(FIELDS, blank, 'entity_id'), { entity_id: 'A new record needs this id' });
  const filled = { ...blank, entity_id: 'R9', entity_label: 'Walk-in', rank: '2.5', value: 'abc' };
  assert.deepEqual(formProblems(FIELDS, filled, 'entity_id'), { rank: 'Enter a whole number', value: 'Enter a number' });
  assert.deepEqual(addedValues(FIELDS, { ...filled, rank: '2', value: '' }, 'entity_id'), { entity_id: 'R9', entity_label: 'Walk-in', rank: '2' });
  assert.deepEqual(formProblems(FIELDS, { entity_label: 'x' }, null), {});
});

test('history marks the fields each version changed', () => {
  const versions = [
    { ...ROW, change_source: 'run', changed_by: 'run 77', valid_from: '2026-10-15T06:00:00Z' },
    { ...ROW, value: 99, recommended_action: 'Hold', change_source: 'edit', changed_by: 'pat.lee', valid_from: '2026-10-20T09:00:00Z' },
    { ...ROW, value: 99, recommended_action: 'Hold', change_source: 'delete', changed_by: 'pat.lee', valid_from: '2026-10-21T09:00:00Z' },
  ];
  const items = historyChanges(FIELDS, versions);
  assert.deepEqual(items.map((i) => i.changes.map((c) => c.field.name)), [[], ['value', 'recommended_action'], []]);
  assert.equal(items[1].changes[0].from, 120.5);
  assert.equal(valueText(FIELDS[3], 99, META), '$99');
  assert.equal(valueText(FIELDS[4], true, META), 'Yes');
  assert.equal(valueText(FIELDS[8], null, META), 'empty');
  assert.equal(valueText(FIELDS[7], ['a', 'b'], META), 'a · b');
  const added = historyChanges(FIELDS, [{ entity_id: 'R9', entity_label: 'Walk-in', change_source: 'add' }]);
  assert.deepEqual(added[0].set.map((c) => c.field.name), ['entity_id', 'entity_label']);
  assert.equal(whoText({ changed_by: 'run 77' }), 'the job, run 77');
  assert.equal(whoText({ changed_by: '' }), 'someone');
});

test('labels come from the page, then from the column name', () => {
  assert.equal(columnLabel('value', META), 'Loss');
  assert.equal(columnLabel('entity_label', META), 'Item');
  assert.equal(columnLabel('recommended_action', META), 'Recommended action');
  assert.equal(columnLabel('store_region_code', META), 'Store region code');
});

test('a record is found by its record_key when the list carries one', () => {
  assert.deepEqual(recordRef(META, { entity_id: 'R1', record_key: 'k-1' }), { record_key: 'k-1' });
  assert.deepEqual(recordRef(META, { entity_id: 7 }), { key: '7' });
});

test('text fields suggest values already on the list', () => {
  assert.deepEqual(suggestions([{ t: 'b' }, { t: 'a' }, { t: 'b' }, { t: null }, { t: 3 }], 't'), ['a', 'b']);
});

test('a warehouse timestamp reads as UTC whatever the viewer\u2019s time zone', () => {
  for (const raw of ['2026-10-27 03:01:02.123', '2026-10-27T03:01:02.123Z', '2026-10-27T03:01:02', '2026-10-27T08:31:02+05:30']) {
    assert.equal(whenText(raw), 'Oct 27, 2026, 03:01 AM UTC', raw);
  }
  assert.equal(whenText('not a time'), 'not a time');
  assert.equal(whenText(null), '');
  assert.equal(dayLabel('2026-10-27 02:00:00'), 'Oct 27, 2026');
  assert.equal(formatValue('2026-10-27T02:00:00', 'date'), 'Oct 27, 2026');
  assert.equal(dayLabel('2026-10-27'), 'Oct 27, 2026');
});

const PLANNED = {
  ai_explanation: '  It has been 40% off for 6 weeks and is not selling more. ', ai_evidence: JSON.stringify(['The discount went from 20% to 40%.', ' Sales stayed at 35 a week. ', '']),
  confidence_level: 'High', ai_confidence_reason: 'Six weeks of sales since the change.', ai_next_action: 'Cut the discount to 20%',
  ai_expected_result: 'About $1,400 of margin a week comes back.', ai_other_option: 'End the promotion at the next price change.',
  value_at_stake: 8400, currency: 'USD', value_at_stake_formula: '$1,400 margin lost a week x 6 weeks left in the season',
};

test('the record panel reads every AI column of the current version, and money shows with its formula', () => {
  assert.deepEqual(recordView(META, PLANNED, { recommended_action: 'Cut it' }), {
    explanation: 'It has been 40% off for 6 weeks and is not selling more.', held: '', evidence: ['The discount went from 20% to 40%.', 'Sales stayed at 35 a week.'],
    confidence: { level: 'High', reason: 'Six weeks of sales since the change.' }, action: 'Cut the discount to 20%',
    expected: 'About $1,400 of margin a week comes back.', other: 'End the promotion at the next price change.',
    saving: { text: '$8,400', formula: '$1,400 margin lost a week x 6 weeks left in the season' },
  });
  assert.equal(recordView(META, { ...PLANNED, confidence_level: 'Very high' }, {}).confidence, null, 'only High, Medium or Low is a confidence');
  assert.equal(recordView(META, { ...PLANNED, value_at_stake: 'n/a' }, {}).saving, null);
  assert.equal(recordView(META, { ...PLANNED, value_at_stake: null }, {}).saving, null);
});

test('an older table shows only the AI columns it has, read from the list row while the history loads', () => {
  const aliases = { ai_explanation: '_inspire_ai_explanation', confidence_level: '_inspire_confidence_level' };
  const row = { _inspire_ai_explanation: 'Margin fell after the markdown.', _inspire_confidence_level: 'Low', recommended_action: 'Cut it' };
  assert.deepEqual(recordView(META, null, row, aliases), {
    explanation: 'Margin fell after the markdown.', held: '', evidence: [], confidence: { level: 'Low', reason: '' }, action: 'Cut it', expected: '', other: '', saving: null,
  });
  assert.equal(recordView(META, null, row).explanation, '', 'an alias is read only when the list names it');
  assert.equal(aiValue('ai_explanation', { ai_explanation: 'From the history' }, row, aliases), 'From the history');
  assert.deepEqual(recordView({ ...META, action: null }, {}, {}), { explanation: '', held: '', evidence: [], confidence: null, action: '', expected: '', other: '', saving: null });
});

test('a record whose AI reasoning failed the checks after the repair round carries its plain flag, and a passing one carries none', () => {
  const held = recordView(META, { ai_check: ' hedged explanation ', confidence_level: 'Medium' }, {});
  assert.equal(held.held, 'hedged explanation');
  assert.equal(held.explanation, '', 'a flagged record shows no AI text');
  assert.equal(recordView(META, PLANNED, {}).held, '');
  assert.match(HELD, /^Inspire left out the AI reasoning for this record because it failed a check after one repair round$/);
  assert.doesNotMatch(HELD, /[\u2013\u2014]/);
});

test('an explain carries the level the notebook set and the facts behind it, and never a level the App does not know', () => {
  const meta = { key: 'entity_id', label: 'entity_label', tier: 'priority_tier', action: 'recommended_action', columns: [], detail: [] };
  const data = { fields: [], versions: [], current: { entity_label: 'A', confidence_level: 'Low', ai_facts: 'weeks of sales: 2\nloss a week: 1,400 USD' } };
  const context = explainContext(meta, data, {});
  assert.equal(context.confidence, 'Low');
  assert.equal(context.facts, 'weeks of sales: 2\nloss a week: 1,400 USD');
  const listed = explainContext(meta, null, { entity_label: 'A', _inspire_confidence_level: 'High' });
  assert.deepEqual([listed.confidence, listed.facts], ['High', ''], 'the list row gives the level while the history loads');
  for (const odd of ['Very high', '', null, 'high']) {
    const out = explainContext(meta, { ...data, current: { ...data.current, confidence_level: odd } }, {});
    assert.ok(!('confidence' in out) && !('facts' in out), String(odd));
  }
  const long = explainContext(meta, { ...data, current: { ...data.current, ai_facts: 'x'.repeat(1500) } }, {});
  assert.equal(long.facts.length, 1000);
});

test('a saving keeps its currency from the record, then from the page, and is a plain number without one', () => {
  const meta = { ...META, columns: [{ column: 'value_at_stake', label: 'Could save', format: 'currency', currency: 'EUR' }] };
  assert.deepEqual(recordView(meta, { value_at_stake: '1200.4' }, {}).saving, { text: '€1,200', formula: '' });
  assert.equal(recordView(meta, { value_at_stake: 1200, currency: 'usd' }, {}).saving.text, '€1,200', 'a malformed currency is ignored');
  assert.equal(recordView(META, { value_at_stake: 1200 }, {}).saving.text, '1,200');
  assert.equal(savingText(8400, 'USD'), '$8,400');
  assert.equal(savingText(8400.6, ''), '8,401');
});

test('evidence is a JSON array of sentences, and broken JSON never shows', () => {
  assert.deepEqual(evidenceOf('["a", " b ", ""]'), ['a', 'b']);
  assert.deepEqual(evidenceOf(['x', null, 3]), ['x', '3']);
  assert.deepEqual(evidenceOf('[not json'), []);
  assert.deepEqual(evidenceOf('[1, "two"'), []);
  assert.deepEqual(evidenceOf('{"a": 1}'), ['{"a": 1}']);
  assert.deepEqual(evidenceOf('One plain sentence.'), ['One plain sentence.']);
  assert.deepEqual(evidenceOf('   '), []);
  assert.deepEqual(evidenceOf(null), []);
});

test('the Genie questions name the kind of record the way the list header does', () => {
  assert.deepEqual(askQuestions(META), ['Show the history of this item', 'Are there others like this?', 'What happens if we do nothing?']);
  assert.equal(askQuestions({ label: 'entity_label' })[0], 'Show the history of this item', 'the list calls an untitled label an Item');
  assert.equal(askQuestions({ label: 'sku', label_title: 'SKU' })[0], 'Show the history of this SKU');
  assert.equal(askQuestions({ label: 'store', label_title: 'Store item' })[0], 'Show the history of this store item');
  assert.equal(askQuestions({ label: 'store', columns: [{ column: 'store', label: 'Store' }] })[0], 'Show the history of this store');
  assert.equal(askQuestions({})[0], 'Show the history of this record');
});

test('the owner, the due date and the done line read like a person wrote them', () => {
  assert.equal(initials('pat.lee@example.com'), 'PL');
  assert.equal(initials('Sam Ortiz'), 'SO');
  assert.equal(initials('x'), 'X');
  assert.equal(initials(''), '?');
  assert.deepEqual(dueText('2026-10-20', 'New', '2026-10-28'), { text: 'Due Oct 20, 2026', late: true });
  assert.deepEqual(dueText('2026-10-20T00:00:00Z', null, '2026-10-28'), { text: 'Due Oct 20, 2026', late: true });
  assert.equal(dueText('2026-10-20', 'Done', '2026-10-28').late, false, 'a done record is never late');
  assert.equal(dueText('2026-10-28', 'In progress', '2026-10-28').late, false, 'due today is not late yet');
  assert.equal(dueText(null, 'New'), null);
  assert.equal(doneText({ action_status: 'Done' }), 'Marked done. The next run checks whether it worked.');
  assert.equal(doneText({ action_status: 'Done', action_outcome: 'Resolved' }), 'Marked done. A later run found it resolved.');
  assert.equal(doneText({ action_status: 'Done', action_outcome: 'Still flagged' }), 'Marked done, but a later run still flags it.');
  assert.equal(doneText({ action_status: 'Dismissed', dismiss_reason: ' The store closed. ' }), 'Marked as not an issue. Reason: The store closed.');
  assert.equal(doneText({ action_status: 'Dismissed' }), 'Marked as not an issue.');
  assert.equal(doneText({ action_status: 'In progress' }), '');
  assert.equal(doneText(null), '');
});
