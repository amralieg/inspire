// REQ-511 R3: each saved file tells the App which use cases it covers, so the Review list can show "docs made".
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDocs } from '../src/lib/generateDocs.js';

test('generateDocs posts use_case_ids for each file to /api/inspire/docs/save', async () => {
  const uc = (id) => ({ id, 'Tracking ID': id, Name: `Case ${id}`, use_case: `Case ${id}` });
  const plan = [
    { name: 'a.xlsx', kind: 'xlsx', language: 'English', useCaseIds: ['N01-U01', 'N02-U02'] },
    { name: 'b.xlsx', kind: 'xlsx', language: 'English', useCaseIds: ['N02-U02'] },
  ];
  const posts = [];
  const states = [];
  await generateDocs({
    plan, options: { languages: ['English'], columns: [], style: 'clean', palette: 'default' }, useCases: [uc('N01-U01'), uc('N02-U02')], values: {}, businessName: 'Acme',
    folder: '/Workspace/x', post: async (path, body) => { posts.push({ path, body }); return {}; },
    inspireDatabase: 'main.inspire', warehouseId: 'wh', sessionId: 42, onFile: (n, s, m) => states.push([n, s, m]),
  });
  const saves = posts.filter((p) => p.path === '/api/inspire/docs/save');
  assert.equal(saves.length, 2, JSON.stringify(states));
  assert.deepEqual(saves.map((p) => p.body.use_case_ids), [['N01-U01', 'N02-U02'], ['N02-U02']]);
});
