import test from 'node:test';
import assert from 'node:assert/strict';
import { wizardSteps, pickedAfter, trailOf } from '../../src/lib/helpMeChoose.js';

// REQ-538: the "Help me choose" logic on a neutral 12-row fixture (made-up areas, sponsors and goals).
const row = (no, goals, domain, sponsor, type, ttv, avail, skills, extra = {}) => ({
  No: no, Name: `Case ${no}`, _domain: domain, 'Strategic Goals Alignment': goals, Sponsor: sponsor, Type: type,
  'Time to Value': ttv, 'Data Availability': avail, 'Team Skills': skills, ...extra,
});
const FIX = [
  row('1', 'Grow, Save', 'Area A', 'Sponsor 1', 'Opportunity', '5', '5', '5'),
  row('2', 'Grow', 'Area A', 'Sponsor 1', 'Improvement', '4', '4', '5'),
  row('3', 'Grow', 'Area A', 'Sponsor 2', 'Risk', '3', '5', '5'),
  row('4', 'Save', 'Area A', 'Sponsor 2', 'Problem', '2', '3', '3'),
  row('5', 'Save', 'Area B', 'Sponsor 1', 'Opportunity', '5', '4', '4'),
  row('6', 'Save, Comply', 'Area B', 'Sponsor 1', 'Opportunity', '4', '2', '5'),
  row('7', 'Comply', 'Area B', 'Sponsor 2', 'Risk', '3.5', '5', '4'),
  row('8', 'Comply', 'Area B', 'Sponsor 3', 'Weird', '1', '5', '5'),
  row('9', '', 'Area C', 'Sponsor 3', 'Improvement', '4', '4', '4', { 'Business Priority Alignment': 'Grow' }),
  row('10', 'Grow', 'Area C', 'Sponsor 3', 'Problem', '5', '3', '5'),
  row('11', 'Save', 'Area C', 'Sponsor 3', 'Opportunity', '3', '5', '4'),
  row('12', 'Comply', 'Area C', '', '', '', '', ''),
];
const step = (steps, id) => steps.find((s) => s.id === id);
const counts = (steps, id) => Object.fromEntries(step(steps, id).options.map((o) => [o.label, o.count]));
const nos = (list) => list.map((u) => u.No).sort((a, b) => Number(a) - Number(b));

test('the six questions come in the order the brief gives, each with its title', () => {
  const steps = wizardSteps(FIX, {});
  assert.deepEqual(steps.map((s) => s.id), ['goals', 'domain', 'sponsor', 'type', 'time', 'ready']);
  assert.equal(steps[0].title, 'What does the business need most right now?');
  assert.equal(steps[1].title, 'Which part of the business should move first?');
  assert.equal(steps[2].title, 'Who will sponsor it?');
  assert.equal(steps[3].title, 'Grow, or protect?');
  assert.equal(steps[4].title, 'How soon do you need results?');
  assert.equal(steps[5].title, 'How ready are your data and team?');
});

test('question 1 counts every goal in the comma list and falls back to Business Priority Alignment when the goals are blank', () => {
  assert.deepEqual(counts(wizardSteps(FIX, {}), 'goals'), { Grow: 5, Save: 5, Comply: 4 });
});

test('counts are live given the earlier answers, and an option that leaves nothing is disabled', () => {
  const steps = wizardSteps(FIX, { goals: ['grow'] });
  assert.deepEqual(counts(steps, 'domain'), { 'Area A': 3, 'Area B': 0, 'Area C': 2 });
  const b = step(steps, 'domain').options.find((o) => o.label === 'Area B');
  assert.equal(b.disabled, true);
  assert.equal(step(steps, 'domain').options.find((o) => o.label === 'Area A').disabled, false);
});

test('several picks inside one question are OR, picks across questions are AND', () => {
  assert.deepEqual(nos(pickedAfter(FIX, { goals: ['grow', 'comply'] })), ['1', '2', '3', '6', '7', '8', '9', '10', '12']);
  assert.deepEqual(nos(pickedAfter(FIX, { goals: ['save'], domain: ['area a', 'area c'] })), ['1', '4', '11']);
});

test('Grow means Opportunity or Improvement, Protect means Risk or Problem, Both is everything, an unknown Type is its own option', () => {
  const type = counts(wizardSteps(FIX, {}), 'type');
  assert.deepEqual(type, { Grow: 6, Protect: 4, Both: 12, Weird: 1 });
  assert.deepEqual(nos(pickedAfter(FIX, { type: ['grow'] })), ['1', '2', '5', '6', '9', '11']);
  assert.deepEqual(nos(pickedAfter(FIX, { type: ['protect'] })), ['3', '4', '7', '10']);
});

test('Time to Value: this quarter is 4 or more, within 6 months is 3.5 or more, bigger bets is any', () => {
  assert.deepEqual(counts(wizardSteps(FIX, {}), 'time'), { 'This quarter': 6, 'Within 6 months': 7, 'Bigger bets are fine': 12 });
});

test('readiness is the lower of Data Availability and Team Skills: 4 or more, or any', () => {
  assert.deepEqual(counts(wizardSteps(FIX, {}), 'ready'), { 'Use what we have today': 8, 'We can invest in data and skills': 12 });
});

test('a question that cannot narrow is skipped, and a field nobody has drops its question', () => {
  const same = FIX.map((u) => ({ ...u, Sponsor: 'Sponsor 1', 'Time to Value': '5' }));
  const steps = wizardSteps(same, {});
  assert.equal(step(steps, 'sponsor').skipped, true);
  assert.equal(step(steps, 'time').skipped, true);
  assert.equal(step(steps, 'goals').skipped, false);
  const noSponsor = FIX.map(({ Sponsor, ...rest }) => rest);
  assert.equal(step(wizardSteps(noSponsor, {}), 'sponsor').skipped, true);
  // after Grow the sponsor options leave 3, 1 and 1 against a base of 5, so the question narrows and stays
  assert.equal(step(wizardSteps(FIX, { goals: ['grow'] }), 'sponsor').skipped, false);
});

test('the trail names each answer with the count it left', () => {
  const answers = { goals: ['grow'], domain: ['area a'] };
  const steps = wizardSteps(FIX, answers);
  assert.deepEqual(trailOf(steps, answers, FIX.length), [
    { id: 'goals', label: 'Grow', count: 5 },
    { id: 'domain', label: 'Area A', count: 3 },
  ]);
});

test('blank, missing and odd rows never throw', () => {
  assert.doesNotThrow(() => wizardSteps([{}, null, undefined, { Name: 'x', 'Time to Value': 'soon' }, { Type: 5, Sponsor: null }], {}));
  assert.doesNotThrow(() => wizardSteps(null, {}));
  const empty = wizardSteps([{}, { Name: 'x' }], {});
  assert.ok(empty.every((s) => s.skipped), 'a list with no usable field asks nothing');
  assert.deepEqual(pickedAfter([{}, { Name: 'x' }], {}).length, 2);
});
