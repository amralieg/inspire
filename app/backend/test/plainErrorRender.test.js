const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SRC, relative, sourceFiles, withoutComments } = require('./support/frontendSource');

const ERROR_PATH = String.raw`(?:[\w$]+\??\.)*(?:[\w$]*[Ee]rror|[\w$]+\??\.message)`;
const RAW_SHAPES = [
  new RegExp(String.raw`(?:^|[>\s(}])\{${ERROR_PATH}\}(?!\s*=)`),
  new RegExp(String.raw`(?:^|[>\s}])\{(?!\s)[^{}\n]*\`[^\`\n]*\$\{${ERROR_PATH}\}`),
];
const NOT_TEXT = [/\btext=\{/, /Counts\.error\}/, /^\s*(?:const|let|return|if|set[A-Z]\w*\()/];

function rawErrorRenders(source) {
  return withoutComments(source).split('\n').flatMap((line, i) => (
    RAW_SHAPES.some((re) => re.test(line)) && !NOT_TEXT.some((re) => re.test(line)) ? [`${i + 1}: ${line.trim().slice(0, 140)}`] : []
  ));
}

test('the scan catches every way an error reached the screen raw, and leaves the plain renders alone (must-exclude)', () => {
  for (const raw of [
    '<p role="alert" className="x">{publishResult.message}</p>',
    '{destinationsError && <p className="t">Notification destinations are not available to you ({destinationsError}). Use email recipients.</p>}',
    '{lookError && <p className="t">Inspire could not read the App looks from its agent notebook: {lookError}</p>}',
    '      {error}',
    '<span className="text-sm text-error-fg">{publishMessage.message}</span>',
    "<span>Attempt {round.attempt}{round.error ? ` failed: ${round.error}` : ' failed'}. </span>",
    '{change.error ? `Inspire could not compare the tables: ${change.error}` : change.text}',
  ]) assert.equal(rawErrorRenders(raw).length, 1, raw);
  for (const plain of [
    '{lookError && <PlainMessage text={`Inspire could not read the App looks: ${lookError}`} onRetry={onLookRetry} />}',
    '<BuildWarehouseField warehousesError={warehousesError} />',
    '{statusCounts.error > 0 && <span>{statusCounts.error} errors</span>}',
    "const note = error ? `Inspire could not list it: ${error}` : '';",
    'setState({ busy: false, error: `Inspire could not create it: ${e.message}` });',
    '<p className="t">{look.text}</p>',
  ]) assert.deepEqual(rawErrorRenders(plain), [], plain);
});

test('no page or component of the Inspire App shows an error text raw: each goes through PlainMessage, so codes, grants and ids sit under Details', () => {
  const hits = sourceFiles(SRC, ['.jsx']).flatMap((file) => rawErrorRenders(fs.readFileSync(file, 'utf8')).map((hit) => `${relative(file)}:${hit}`));
  assert.deepEqual(hits, []);
});

test('no screen of a generated MVP App shows an error text raw: each goes through PlainNote, so codes and ids sit under Details', () => {
  const shell = path.resolve(__dirname, '..', '..', 'agent', 'agent', 'app_shell', 'web', 'src');
  const hits = sourceFiles(shell, ['.jsx']).flatMap((file) => rawErrorRenders(fs.readFileSync(file, 'utf8')).map((hit) => `${path.relative(shell, file)}:${hit}`));
  assert.deepEqual(hits, []);
});
