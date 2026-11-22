// FX-84a: the value disclaimer is one JSON in the backend that the notebook carries as the pinned asset "value_disclaimer".
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const APP = path.join(__dirname, '..', '..');
const JSON_FILE = path.join(APP, 'backend', 'lib', 'valueDisclaimer.json');

function pins() {
  const text = fs.readFileSync(path.join(APP, 'dbx_inspire_ai_agent.ipynb'), 'utf8');
  const nb = JSON.parse(text);
  for (const cell of nb.cells) {
    const src = Array.isArray(cell.source) ? cell.source.join('') : String(cell.source);
    const line = src.split('\n').find((l) => l.startsWith('INSPIRE_NOTEBOOK_ASSETS = '));
    if (line) return JSON.parse(line.slice('INSPIRE_NOTEBOOK_ASSETS = '.length));
  }
  return null;
}

test('the notebook pins the value disclaimer asset to the backend JSON', () => {
  const all = pins();
  assert.ok(all, 'the notebook has an INSPIRE_NOTEBOOK_ASSETS cell');
  const pin = all.value_disclaimer;
  assert.ok(pin, 'value_disclaimer is pinned');
  assert.strictEqual(pin.file, 'notebook/value_disclaimer.json');
  const data = fs.readFileSync(JSON_FILE);
  assert.strictEqual(pin.sha256, crypto.createHash('sha256').update(data).digest('hex'));
  assert.strictEqual(pin.size, data.length);
});
