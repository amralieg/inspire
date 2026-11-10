const test = require('node:test');
const assert = require('node:assert/strict');
const { NAV_TABS, tabTitle } = require('../../frontend/src/lib/tabs.js');

const tab = (id) => NAV_TABS.find((t) => t.id === id);

test('a locked Monitor or Build tab says why it is locked, and an open tab keeps its plain label', () => {
  assert.equal(tabTitle(tab('monitor'), false), `${tab('monitor').label}: Start a run or open one from Start to see it here`);
  assert.equal(tabTitle(tab('implement'), false), `${tab('implement').label}: Open a run in Review first, then build its use cases here`);
  assert.equal(tabTitle(tab('monitor'), true), tab('monitor').label);
  assert.equal(tabTitle(tab('run'), false), tab('run').label, 'a tab with no lock reason never shows a blank reason');
});
