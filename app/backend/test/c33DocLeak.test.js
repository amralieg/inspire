// C33 (REQ-560): the demo leak scan reads what a PDF viewer shows. The App's PDFs are drawn pages: indexed-colour images whose colour table is a
// hex string and whose pixels are binary. Read as text, those matched the 12-digit, object id and warehouse id patterns by chance, so no PDF could be
// kept in a demo. An image is left out of the scan; page text, metadata and dictionaries are still read.
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { showcaseLeaks } = require('../lib/showcaseRecord');

const obj = (n, dict, data) => Buffer.concat([Buffer.from(`${n} 0 obj\n${dict}\nstream\n`), data, Buffer.from('\nendstream\nendobj\n')]);
const palette = '000000123456789012345678ffffff0a1b2c3d4e5f6a7b8c';
const image = (pixels) => obj(3, `<< /Type /XObject /Subtype /Image /Width 4 /Height 4 /ColorSpace [/Indexed /DeviceRGB 7 <${palette}>] /BitsPerComponent 4 /Filter /FlateDecode /Length 9 >>`, zlib.deflateSync(Buffer.from(pixels)));
const page = (text) => obj(4, '<< /Filter /FlateDecode /Length 9 >>', zlib.deflateSync(Buffer.from(`BT (${text}) Tj ET`)));
const pdf = (...parts) => Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n'), ...parts, Buffer.from('%%EOF')]);
const leaks = (bytes) => showcaseLeaks({ inspire: { 'GET /api/workspace/export?path=a.pdf': { status: 200, body: bytes.toString('base64'), base64: true, type: 'application/pdf' } } });

test('C33 (must-fail before): the colour table and pixels of a drawn page are not text, so they are no leak', () => {
  assert.deepEqual(leaks(pdf(image('pixels 0a1b2c3d4e5f6a7b 123456789012345 end'), page('Prepared for the demo business'))), []);
});

test('C33 (must-keep): a host or email in the page text, or in a dictionary next to an image, is still a leak', () => {
  const email = ['jane.doe', 'corp.org'].join('@');
  assert.ok(leaks(pdf(image('plain pixels'), page(`owner ${email}`))).length > 0, 'an email in a page text stream');
  assert.ok(leaks(pdf(image('plain pixels'), obj(5, `<< /Title (adb-1.${['azure', 'databricks'].join('')}.net) /Length 1 >>`, Buffer.from('x')))).length > 0, 'a host in a dictionary');
  assert.ok(leaks(pdf(image('plain pixels'), page('warehouse 0a1b2c3d4e5f6a7b'))).length > 0, 'a warehouse id in the page text');
});
