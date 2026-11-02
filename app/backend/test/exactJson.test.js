const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../lib/exactJson');

const SID = '2222222222222222222';
const PARSERS = [['the source reader', X.parseExactJsonBySource], ['the token reader', X.parseExactJsonByTokens], ['the chosen reader', X.parseExactJson]];

test('a 19-digit session id written as a JSON number survives the read byte for byte, where JSON.parse rounds it', () => {
  const text = `{"_source_session_id": ${SID}, "rows": [{"session_id": -${SID}}]}`;
  assert.notEqual(String(JSON.parse(text)._source_session_id), SID, 'JSON.parse rounds the id');
  for (const [name, parse] of PARSERS) {
    assert.deepEqual(parse(text), { _source_session_id: SID, rows: [{ session_id: `-${SID}` }] }, name);
  }
});

test('the exact read keeps every other value as JSON.parse reads it, and a 16-digit integer becomes a string', () => {
  const text = String.raw`{"n": 42, "safe": 111122223333444, "sixteen": 5555555555555555, "neg": -7, "zero": 0, "pi": ${Math.PI},
    "share": ${Math.E / 10}, "big": 1e400, "exp": ${'1'.repeat(17)}e2, "s": "id ${SID} \"quoted\" \\", "list": [1, true, null, "x"],
    "nested": {"deep": [[-5555555555555555, 2.5]]}}`;
  const plain = JSON.parse(text);
  for (const [name, parse] of PARSERS) {
    const got = parse(text);
    assert.deepEqual(got, { ...plain, sixteen: '5555555555555555', nested: { deep: [['-5555555555555555', 2.5]] } }, name);
    assert.equal(got.big, Infinity, name);
    assert.equal(got.exp, plain.exp, `${name}: an exponent stays a number`);
  }
});

test('the exact read refuses what JSON.parse refuses, including a long integer with a leading zero', () => {
  for (const bad of [`{"a": 0${'1'.repeat(16)}}`, '{"a": 1', '', 'undefined', '{"a": "unterminated}']) {
    for (const [name, parse] of PARSERS) {
      assert.throws(() => parse(bad), SyntaxError, `${name}: ${bad}`);
    }
  }
});

test('the token reader quotes only long integers outside strings, so the text is otherwise unchanged', () => {
  assert.equal(X.quoteLongIntegers(`[${SID},"${SID}",12.${SID},${SID}e1,"a\\"${SID}"]`), `["${SID}","${SID}",12.${SID},${SID}e1,"a\\"${SID}"]`);
  assert.equal(X.quoteLongIntegers('{"a": 1}'), '{"a": 1}');
});

test('the App Node reads the number source, so it takes the source path', () => {
  assert.equal(X.READS_SOURCE, true);
});
