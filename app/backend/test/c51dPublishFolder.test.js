'use strict';
// REQ-586 c51d: /api/publish receives the discover notebook path the Config page shows
// (/Shared/inspire-ai/inspire_discover); the split agent goes into that path's folder, not a sub-folder named after the notebook.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const pub = require('../lib/agentPublish');

test('c51d-a agentFolderOf: a notebook path publishes into its folder; a plain folder stays itself', () => {
  assert.strictEqual(typeof pub.agentFolderOf, 'function', 'agentPublish exports agentFolderOf');
  assert.strictEqual(pub.agentFolderOf('/Shared/inspire-ai/inspire_discover'), '/Shared/inspire-ai');
  assert.strictEqual(pub.agentFolderOf('/Shared/inspire-ai/inspire_generate'), '/Shared/inspire-ai');
  assert.strictEqual(pub.agentFolderOf('/Shared/inspire-ai/inspire_discover/'), '/Shared/inspire-ai');
  assert.strictEqual(pub.agentFolderOf('/Users/a@b.com/inspire'), '/Users/a@b.com/inspire');
  assert.strictEqual(pub.agentFolderOf('/Users/a@b.com/inspire/'), '/Users/a@b.com/inspire');
});

test('c51d-b /api/publish resolves the folder with agentFolderOf before publishAgent', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const start = src.indexOf("app.post('/api/publish'");
  assert.ok(start > 0, '/api/publish route exists');
  const body = src.slice(start, src.indexOf('\napp.', start + 10));
  assert.match(body, /folder:\s*agentFolderOf\(\s*destination_path\s*\)/, 'publishAgent gets folder: agentFolderOf(destination_path)');
  assert.doesNotMatch(body, /folder:\s*destination_path\b/, 'destination_path is never used as the folder as-is');
  assert.match(body, /folder_path:\s*agentFolderOf\(\s*destination_path\s*\)|folder_path:\s*folder\b/, 'the reply names the real folder');
});
