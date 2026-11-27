// C25 (REQ-560): the recorder keeps a generated document byte for byte, stamps the build, and refuses a document whose text names a real host, email or id.
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const S = require('../lib/showcase');
const { makeRecorder, showcaseLeaks, documentText } = require('../lib/showcaseRecord');

const pdf = (text) => {
  const data = zlib.deflateSync(Buffer.from(`BT (${text}) Tj ET`));
  return Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj\n<< /Filter /FlatDecode >>\nstream\n'), data, Buffer.from('\nendstream\nendobj\n%%EOF')]);
};
const zip = (name, text) => {
  const raw = zlib.deflateRawSync(Buffer.from(text));
  const head = Buffer.alloc(30);
  head.write('PK\x03\x04', 0, 'latin1');
  head.writeUInt16LE(8, 8);
  head.writeUInt32LE(raw.length, 18);
  head.writeUInt16LE(name.length, 26);
  return Buffer.concat([head, Buffer.from(name), raw]);
};
const exchange = (bytes) => ({ method: 'GET', url: 'https://app.example/api/workspace/export?path=%2FWorkspace%2Fdemo%2Fa.pdf&session_id=1001', status: 200, body: bytes.toString('base64'), base64: true, type: 'application/pdf' });

test('the recorder keeps a document as base64 with its content type, unchanged by the text redaction', () => {
  const bytes = pdf('Strategy 123456789012 demo');
  const rec = makeRecorder({ id: 'taxi', title: 'Taxi', business: 'Taxi', sessionId: '1001', mvps: [], build: 'v1.6.1' });
  const key = rec.addInspire(exchange(bytes));
  const bundle = rec.bundle();
  assert.deepEqual(bundle.inspire[key], { status: 200, body: bytes.toString('base64'), base64: true, type: 'application/pdf' });
  assert.equal(bundle.build, 'v1.6.1');
  assert.match(bundle.recorded_at, /^\d{4}-\d\d-\d\dT/);
  assert.equal(S.showcaseProblem(bundle, 'taxi.json'), '');
});

test('a recording made without a build stamp carries none', () => {
  const rec = makeRecorder({ id: 'taxi', title: 'Taxi', business: 'Taxi', sessionId: '1001', mvps: [] });
  assert.equal('build' in rec.bundle(), false);
});

test('documentText reads the text inside a PDF stream and inside a PPTX part', () => {
  assert.match(documentText(pdf('hello pdf')), /hello pdf/);
  assert.match(documentText(zip('ppt/slides/slide1.xml', '<a:t>hello slide</a:t>')), /hello slide/);
});

test('the leak scan reads the text of a document: a real host or email inside a PDF or PPTX is a leak, clean text is not', () => {
  const bundleOf = (bytes) => ({ inspire: { 'GET /api/workspace/export?path=a.pdf': { status: 200, body: bytes.toString('base64'), base64: true, type: 'application/pdf' } } });
  assert.deepEqual(showcaseLeaks(bundleOf(pdf('Prepared for the demo business'))), []);
  assert.equal(showcaseLeaks(bundleOf(pdf(`see https://adb-1.${['azure', 'databricks'].join('')}.net/x`))).length > 0, true);
  assert.equal(showcaseLeaks(bundleOf(zip('ppt/slides/slide1.xml', '<a:t>owner jane.doe@acme.com</a:t>'))).length > 0, true);
  assert.equal(showcaseLeaks(bundleOf(pdf('warehouse 0a1b2c3d4e5f6a7b'))).length > 0, true);
});
