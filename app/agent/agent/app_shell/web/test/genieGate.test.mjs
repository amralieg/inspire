import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentIntro, genieOn, genieOf } from '../src/genieAsk.js';

const page = (genie) => ({ id: 'p1', title: 'Use case', genie });
const app = (genie) => ({ auth: 'sp', pages: [page(genie)], genie: null });

test('agent answers and the page has no Genie space: Ask is on', () => {
  const a = app({ enabled: false, agent: true, title: '', url: '', note: 'The Genie Agent is not ready: it was not built' });
  assert.equal(genieOn(a, 'p1'), true);
  assert.equal(genieOf(a, 'p1').note, 'The Genie Agent is not ready: it was not built');
});

test('no agent and no Genie space: Ask is off, with the reason in the note', () => {
  const a = app({ enabled: false, agent: false, title: '', url: '', note: 'No chat model. The Genie Agent is not ready: it was not built' });
  assert.equal(genieOn(a, 'p1'), false);
  assert.match(genieOf(a, 'p1').note, /No chat model/);
});

test('Genie space and no agent: Ask is on in Genie mode', () => {
  const a = app({ enabled: true, agent: false, title: 'Sales', url: 'https://h/genie/rooms/sp-1', note: '' });
  assert.equal(genieOn(a, 'p1'), true);
});

test('in a multi-page App an unknown page id never turns Ask on', () => {
  const a = { auth: 'sp', pages: [page({ enabled: true, agent: true, title: '', url: '', note: '' }), { id: 'p2', title: 'Other', genie: { enabled: true, agent: true, title: '', url: '', note: '' } }], genie: null };
  assert.equal(genieOn(a, 'nope'), false);
});

test('the agent intro names the Genie Agent only when the use case has a space', () => {
  assert.match(agentIntro('Loss', true), /asks the Genie Agent when it needs the data/);
  assert.doesNotMatch(agentIntro('Loss', false), /Genie Agent/);
  assert.match(agentIntro('Loss', false), /reads this use case's data when it needs more/);
});

test('cold cache, no space, agentStatus says agent: Ask is on', () => {
  const cold = app({ enabled: false, agent: false, title: '', url: '', note: 'The Genie Agent is not ready: it was not built' });
  assert.equal(genieOn(cold, 'p1'), false, 'before the status answer the payload alone is off');
  assert.equal(genieOn(cold, 'p1', 'agent'), true, 'the agentStatus answer turns it on');
  assert.equal(genieOn(cold, 'p1', 'checking'), false, 'checking is not agent');
});
