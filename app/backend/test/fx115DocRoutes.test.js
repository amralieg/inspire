// FX-115 (REQ-503): the two App routes behind the Generate docs wizard. The browser makes every file; the App only saves it into the run's
// own Assets folder (POST /api/inspire/docs/save) and translates the selected use case texts for a second language through the App's model
// (POST /api/inspire/docs/translate). Each route refuses what it must: a folder outside the run's generation path, a path trick, a bad name or
// type, bytes that are not what the name says, a file over the size limit, an unreadable language or no texts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeApp, listen } = require('./support/implementApp');

const GEN = '/Workspace/Users/me@example.com/inspire_out';
const FOLDER = `${GEN}/acme`;
const SESSION = { business_name: 'Acme', discovery_type: 'Deep', catalogs: 'main', schemas_str: 's', tables_str: 'main.s.t', inspire_database_name: 'main.inspire', generation_path: GEN, table_scope: JSON.stringify({}) };
const ENDPOINTS = { 'GET /api/2.0/serving-endpoints': [{ endpoints: [{ name: 'chat-new', state: { ready: 'READY' }, task: 'llm/v1/chat' }] }] };
const BASE = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42' };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(600, 7)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(600, 32)]);
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(600, 1)]);

function harness({ modelReply } = {}) {
  const imports = [];
  const asked = [];
  const workspace = ({ path: p, method, body }) => {
    if (p.startsWith('/api/2.0/workspace/import') && method === 'POST') { imports.push(body); return [{}, 200]; }
    if (p.endsWith('/chat-new/invocations')) {
      asked.push(body);
      return [{ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(modelReply ? modelReply(body) : {}) } }] }, 200];
    }
    return undefined;
  };
  const made = makeApp({ forwardedToken: 'person-tok', session: SESSION, columns: [], workspace, responses: ENDPOINTS });
  return { made, imports, asked };
}
async function post(srv, route, body) {
  const resp = await fetch(`${srv.url}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-email': 'p@example.com' }, body: JSON.stringify(body) });
  const text = await resp.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) { data = text; }
  return { status: resp.status, data };
}
const save = (srv, over) => post(srv, '/api/inspire/docs/save', { ...BASE, folder: FOLDER, name: 'Acme_infographic.png', content_base64: PNG.toString('base64'), ...over });

test('save: a real file goes into the run\'s Assets folder through one workspace import (AUTO, overwrite) and the reply names its path and size', async () => {
  const h = harness();
  const srv = await listen(h.made.app);
  try {
    for (const [name, bytes] of [['Acme_infographic.png', PNG], ['Acme_brief.pdf', PDF], ['Acme_deck.pptx', ZIP], ['Acme_use_cases_Arabic.xlsx', ZIP]]) {
      const r = await save(srv, { name, content_base64: bytes.toString('base64') });
      assert.equal(r.status, 200, `${name}: ${JSON.stringify(r.data)}`);
      assert.deepEqual({ path: r.data.path, name: r.data.name, size: r.data.size }, { path: `${FOLDER}/${name}`, name, size: bytes.length });
    }
    assert.equal(h.imports.length, 4, 'one import per file');
    const first = h.imports[0];
    assert.equal(first.path, `${FOLDER}/Acme_infographic.png`);
    assert.equal(first.format, 'AUTO');
    assert.equal(first.overwrite, true);
    assert.equal(first.content, PNG.toString('base64'), 'the bytes are saved as sent');
    const root = await save(srv, { folder: GEN });
    assert.equal(root.status, 200, 'the generation path itself is allowed');
  } finally {
    await srv.close();
  }
});

test('save refuses a folder outside the run, a path trick, a bad name or type, bytes that are not what the name says, and a missing run; nothing is written', async () => {
  const h = harness();
  const srv = await listen(h.made.app);
  try {
    const cases = [
      ['a folder of another person', { folder: '/Workspace/Users/other@example.com/inspire_out' }, [400, 403]],
      ['a sibling folder that only starts with the path', { folder: `${GEN}_evil` }, [400, 403]],
      ['a path trick', { folder: `${GEN}/../../other@example.com` }, [400, 403]],
      ['a name with a folder in it', { name: '../Acme_infographic.png' }, [400]],
      ['a name with a slash', { name: 'sub/Acme_infographic.png' }, [400]],
      ['a type the wizard does not make', { name: 'Acme_run.sh', content_base64: Buffer.from('#!/bin/sh\n').toString('base64') }, [400, 415]],
      ['PDF bytes named .png', { name: 'Acme_infographic.png', content_base64: PDF.toString('base64') }, [415]],
      ['PNG bytes named .xlsx', { name: 'Acme_use_cases.xlsx', content_base64: PNG.toString('base64') }, [415]],
      ['no content', { content_base64: '' }, [400]],
      ['no run', { session_id: '' }, [400]],
    ];
    for (const [what, over, statuses] of cases) {
      const r = await save(srv, over);
      assert.ok(statuses.includes(r.status), `${what}: got ${r.status} ${JSON.stringify(r.data)}`);
      assert.equal(typeof (r.data && r.data.error), 'string', `${what}: the refusal says why`);
    }
    assert.equal(h.imports.length, 0, 'a refused save writes nothing');
  } finally {
    await srv.close();
  }
});

test('docFiles: the pure check behind save, with a size limit the workspace import accepts (413 over it)', () => {
  const { docFileProblem, DOC_MAX_BYTES } = require('../lib/docFiles');
  assert.ok(Number.isInteger(DOC_MAX_BYTES) && DOC_MAX_BYTES >= 1024 * 1024 && DOC_MAX_BYTES <= 10 * 1024 * 1024, `limit ${DOC_MAX_BYTES}`);
  assert.equal(docFileProblem({ generationPath: GEN, folder: FOLDER, name: 'Acme_brief.pdf', bytes: PDF }), null, 'a good file has no problem');
  const big = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(DOC_MAX_BYTES, 32)]);
  const over = docFileProblem({ generationPath: GEN, folder: FOLDER, name: 'Acme_brief.pdf', bytes: big });
  assert.equal(over && over.status, 413);
  assert.equal(docFileProblem({ generationPath: GEN, folder: `${GEN}_x`, name: 'Acme_brief.pdf', bytes: PDF }).status >= 400, true);
  assert.equal(docFileProblem({ generationPath: '', folder: FOLDER, name: 'Acme_brief.pdf', bytes: PDF }).status >= 400, true, 'a run with no generation path saves nothing');
  const vol = '/Volumes/main/s/out';
  assert.equal(docFileProblem({ generationPath: vol, folder: `${vol}/acme`, name: 'Acme_deck.pptx', bytes: ZIP }), null, 'a Volume generation path is allowed');
});

test('translate: English is returned as sent with no model call; another language asks the App\'s model once and a key it drops keeps its source text', async () => {
  const h = harness({ modelReply: () => ({ a: 'توقع فقدان العملاء', c: 'قيمة' }) });
  const srv = await listen(h.made.app);
  try {
    const texts = { a: 'Predict churn', b: 'Score upsell', c: 'Value' };
    const en = await post(srv, '/api/inspire/docs/translate', { ...BASE, language: 'English', texts });
    assert.equal(en.status, 200, JSON.stringify(en.data));
    assert.deepEqual(en.data.texts, texts);
    assert.equal(h.asked.length, 0, 'English needs no model call');
    const ar = await post(srv, '/api/inspire/docs/translate', { ...BASE, language: 'Arabic', texts });
    assert.equal(ar.status, 200, JSON.stringify(ar.data));
    assert.equal(ar.data.language, 'Arabic');
    assert.equal(h.asked.length, 1, 'one model call for the whole set');
    const prompt = JSON.stringify(h.asked[0].messages);
    assert.ok(prompt.includes('Arabic') && prompt.includes('Predict churn') && prompt.includes('Score upsell'), 'the model is given the language and every text');
    assert.deepEqual(ar.data.texts, { a: 'توقع فقدان العملاء', b: 'Score upsell', c: 'قيمة' });
    assert.deepEqual(ar.data.untranslated, ['b'], 'the dropped key is named');
  } finally {
    await srv.close();
  }
});

test('translate refuses an unreadable language, no texts, too many or too long texts, and says why when no model is there', async () => {
  const h = harness({ modelReply: () => ({}) });
  const srv = await listen(h.made.app);
  try {
    const cases = [
      ['no language', { language: '', texts: { a: 'x' } }, [400]],
      ['a language that is not a name', { language: 'Arabic"; DROP', texts: { a: 'x' } }, [400]],
      ['no texts', { language: 'Arabic', texts: {} }, [400]],
      ['texts that are not strings', { language: 'Arabic', texts: { a: { b: 1 } } }, [400]],
      ['too many texts', { language: 'Arabic', texts: Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`k${i}`, 'x'])) }, [400, 413]],
      ['a text too long', { language: 'Arabic', texts: { a: 'x'.repeat(20001) } }, [400, 413]],
    ];
    for (const [what, body, statuses] of cases) {
      const r = await post(srv, '/api/inspire/docs/translate', { ...BASE, ...body });
      assert.ok(statuses.includes(r.status), `${what}: got ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
    }
    assert.equal(h.asked.length, 0, 'a refused translation asks no model');
  } finally {
    await srv.close();
  }
  const none = makeApp({ forwardedToken: 'person-tok', session: SESSION, columns: [], responses: { 'GET /api/2.0/serving-endpoints': [{ endpoints: [] }] } });
  const srv2 = await listen(none.app);
  try {
    const r = await post(srv2, '/api/inspire/docs/translate', { ...BASE, language: 'Arabic', texts: { a: 'Predict churn' } });
    assert.equal(r.status, 503, JSON.stringify(r.data));
    assert.equal(typeof r.data.error, 'string');
  } finally {
    await srv2.close();
  }
});

test('both routes have a route policy entry that runs as the App, and an API description', () => {
  const P = require('../lib/routePolicy');
  for (const key of ['POST /api/inspire/docs/save', 'POST /api/inspire/docs/translate']) {
    assert.equal(P.identityFor(key), 'app', `${key} runs as the App`);
  }
  const spec = fs.readFileSync(path.join(__dirname, '..', 'openapi.yaml'), 'utf8');
  for (const p of ['/api/inspire/docs/save:', '/api/inspire/docs/translate:']) assert.ok(spec.includes(`\n  ${p}`), `openapi.yaml describes ${p}`);
});
