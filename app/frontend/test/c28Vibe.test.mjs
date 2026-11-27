// C28 (REQ-572 follow-up): the "Vibe your docs" text shapes the wording of EVERY language, English included. With a vibe, the story texts go through one
// rewrite call per language; with no vibe nothing is sent and the files are byte-identical to before; a failed call keeps the deterministic texts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultDocOptions, planFiles } from '../src/lib/docgen/docOptions.js';
import { logoTypeOf } from '../src/lib/docgen/docOptions.js';
import { generateDocs, textsToTranslate } from '../src/lib/generateDocs.js';

const uc = (id, name) => ({ No: id, Name: name, usecase: name, 'Business Domain': 'Logistics', Subdomain: 'Delivery', type: 'Opportunity', Statement: 'Planners cannot see late deliveries early.',
  Solution: 'A model flags late deliveries.', 'Inspire Score': 8.7, Quality: 'Very High', 'Quality Score': 4.3, best_of_best: 'N' });
const USE_CASES = [uc('P01-U01', 'Predict late deliveries'), uc('P01-U02', 'Cover a quiet depot')];
const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABsSFBcUERsXFhceHBsgKEIrKCUlKFE6PTBCYFVlZF9VXVtqeJmBanGQc1tdhbWGkJ6jq62rZ4C8ybqmx5moq6T/2wBDARweHigjKE4rK06kbl1upKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKT/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCjRRRXOewf/9k=';
const REWRITE = 'Here is the sharper board voice for this very paragraph.';
const VIBE = 'Board-level tone, lead with value.';

// A browser stand-in just big enough for svgToPng: every SVG the documents draw is recorded, and each draw gives back a tiny real JPEG.
function fakeBrowser() {
  const drawn = [];
  const RealDate = Date; // a frozen clock, so two runs of the same input give the same PDF bytes
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [1795000000000])); } static now() { return 1795000000000; } };
  globalThis.Image = class { set src(v) { drawn.push(decodeURIComponent(String(v).split(',').slice(1).join(','))); queueMicrotask(() => this.onload && this.onload()); } };
  globalThis.document = { createElement: () => ({ getContext: () => ({ fillRect() {}, drawImage() {} }), toDataURL: () => `data:image/jpeg;base64,${JPEG}` }) };
  return drawn;
}

async function run({ vibe, translate }) {
  const drawn = fakeBrowser();
  const calls = []; const saved = []; const files = [];
  const post = async (url, body) => {
    calls.push({ url, body });
    if (url === '/api/inspire/docs/translate') return translate(body);
    saved.push(body);
    return { path: `${body.folder}/${body.name}`, name: body.name, size: 1 };
  };
  const options = { ...defaultDocOptions('English'), layout: 'one', kinds: ['pdf'], businessName: 'Acme', ...(vibe === undefined ? {} : { vibe }) };
  const plan = planFiles(options, USE_CASES);
  await generateDocs({ plan, options, useCases: USE_CASES, values: {}, businessName: 'Acme', summary: ['Acme ships daily.'], foundations: [], folder: '/f', post,
    inspireDatabase: 'main.inspire', warehouseId: 'wh', sessionId: '42', onFile: (name, state, message) => files.push({ name, state, message }) });
  return { calls, saved, files, drawn };
}
// The saved PDF as text, minus jsPDF's random file id (the only part that differs between two runs of one input).
const pdfOf = (run_) => Buffer.from(run_.saved[0].content_base64, 'base64').toString('latin1').replace(/\/ID \[[^\]]*\]/, '');
const rewriteAll = (body) => ({ language: body.language, texts: Object.fromEntries(Object.entries(body.texts).map(([k, v]) => [k, k === 'story|exec|0' ? REWRITE : v])) });

test('(a) English with a vibe: one rewrite request holding the vibe and the story keys; the PDF prints the rewritten text', async () => {
  const r = await run({ vibe: VIBE, translate: rewriteAll });
  const asks = r.calls.filter((c) => c.url === '/api/inspire/docs/translate');
  assert.equal(asks.length, 1, 'one call for the one language');
  assert.equal(asks[0].body.language, 'English');
  assert.equal(asks[0].body.vibe, VIBE);
  const keys = Object.keys(asks[0].body.texts);
  assert.ok(keys.includes('story|exec|0') && keys.some((k) => k.startsWith('story|purpose|')), 'the story keys are sent');
  assert.ok(keys.every((k) => k.startsWith('story|') || k.startsWith('summary|')), 'fixed labels and use case fields are not rewritten');
  assert.ok(r.drawn.some((svg) => svg.includes(REWRITE)), 'the rewritten paragraph is on a PDF page');
  assert.deepEqual(r.files.filter((f) => f.state === 'failed'), []);
});

test('(b) an empty vibe sends no request and the PDF is byte-identical to no vibe', async () => {
  const never = () => { throw new Error('no translate call expected'); };
  const none = await run({ translate: never });
  const blank = await run({ vibe: '   ', translate: never });
  assert.equal(blank.calls.filter((c) => c.url.includes('translate')).length, 0);
  assert.equal(none.saved.length, 1);
  assert.equal(pdfOf(blank), pdfOf(none));
});

test('(c) a failed rewrite keeps the deterministic text and nothing throws', async () => {
  const plain = await run({ translate: () => { throw new Error('unused'); } });
  const r = await run({ vibe: VIBE, translate: () => { throw new Error('model down'); } });
  assert.equal(r.saved.length, 1, 'the file is still made and saved');
  assert.deepEqual(r.files.filter((f) => f.state === 'failed'), []);
  assert.equal(pdfOf(r), pdfOf(plain), 'the same file as without a vibe');
});

test('textsToTranslate still carries the story keys the rewrite call picks from', () => {
  assert.ok(Object.keys(textsToTranslate(USE_CASES, {}, ['Acme ships daily.'], 'Acme')).some((k) => k.startsWith('story|exec|')));
});

test('a logo whose browser type is empty is read by its extension; a real GIF stays refused', () => {
  assert.equal(logoTypeOf({ name: 'Brand.PNG', type: '' }), 'image/png');
  assert.equal(logoTypeOf({ name: 'a.jpg', type: '' }), 'image/jpeg');
  assert.equal(logoTypeOf({ name: 'a.svg', type: '' }), 'image/svg+xml');
  assert.equal(logoTypeOf({ name: 'a.png', type: 'image/png' }), 'image/png');
  assert.equal(logoTypeOf({ name: 'a.gif', type: 'image/gif' }), 'image/gif');
});
