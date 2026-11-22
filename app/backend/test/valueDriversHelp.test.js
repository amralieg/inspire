// REQ-476: every input says in plain business words what to enter; no generic filler.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const VDC = require('../lib/valueDriversCalc');

test('every input has its own help of at least 20 characters', () => {
  const seen = new Map();
  for (const d of VDC.DEFINITION.drivers) {
    for (const i of d.inputs) {
      assert.equal(typeof i.help, 'string', `${d.id}.${i.id} has no help`);
      assert.ok(i.help.length >= 20, `${d.id}.${i.id} help too short`);
      assert.ok(!seen.has(i.help), `${d.id}.${i.id} help repeats ${seen.get(i.help)}`);
      seen.set(i.help, `${d.id}.${i.id}`);
    }
  }
});

test('"starting figure" is absent from lib/', () => {
  const dir = path.join(__dirname, '..', 'lib');
  for (const f of fs.readdirSync(dir).filter((n) => /\.(js|json)$/.test(n))) {
    assert.ok(!/starting figure/i.test(fs.readFileSync(path.join(dir, f), 'utf8')), f);
  }
});
