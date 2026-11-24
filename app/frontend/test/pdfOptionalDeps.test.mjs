// FX-113 build: jspdf lazily imports html2canvas and dompurify only for doc.html().
// pdfDoc.js never calls it, so the build must not ship those chunks; html2canvas's
// unicode tables also trip the repo secret scan (aws-access-token false positive).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('vite aliases the unused jspdf html() deps to a stub that throws when used', async () => {
  const config = (await import(path.join(root, 'vite.config.js'))).default;
  const alias = config.resolve?.alias || {};
  for (const name of ['html2canvas', 'dompurify']) {
    assert.ok(alias[name], `${name} is aliased`);
    const stub = await import(alias[name]);
    assert.throws(() => stub.default(), /not bundled/, `${name} stub throws`);
  }
});

test('pdfDoc never calls jspdf html(), so the stub is never reached', () => {
  const src = fs.readFileSync(path.join(root, 'src/lib/docgen/pdfDoc.js'), 'utf8');
  assert.doesNotMatch(src, /\.html\(/);
});

test('the built dist ships no html2canvas or dompurify chunk and no aws-key-shaped text', () => {
  const dir = path.join(root, 'dist/assets');
  const files = fs.readdirSync(dir);
  assert.deepEqual(files.filter((f) => /^(html2canvas|purify)/.test(f)), []);
  for (const f of files.filter((n) => n.endsWith('.js'))) {
    assert.doesNotMatch(fs.readFileSync(path.join(dir, f), 'utf8'), /\b(AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/, f);
  }
});
