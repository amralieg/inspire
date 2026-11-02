const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);
const SID = '2222222222222222222';
const AT = { pathname: '/', hash: '' };
const quoted = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

const opened = (R, search) => {
  const moved = R.queryLink({ ...AT, search });
  return { moved, link: R.hashLink(new URL(moved, 'https://inspire.example.com').hash) };
};

test('a ?review=<session>&uc=<use case> link becomes one Review hash through the same helper as ?run=, and keeps every other query', async () => {
  const R = await lib('runPages.js');
  assert.equal(R.queryLink({ ...AT, search: `?review=${SID}&uc=N01-U01` }), `/#/review/${SID}/N01-U01`);
  assert.equal(R.queryLink({ ...AT, search: `?open=app&review=${SID}&uc=N01-U01&x=1` }), `/?open=app&x=1#/review/${SID}/N01-U01`);
  assert.equal(R.queryLink({ ...AT, search: `?review=${SID}` }), `/#/review/${SID}/`, 'no use case opens the run alone');
  assert.equal(R.queryLink({ ...AT, search: `?run=n01-u01-a&review=${SID}&uc=N01-U01` }), '/#/run/n01-u01-a', 'one link at a time: run first, and the review query goes too');
  assert.equal(R.queryLink({ ...AT, search: '?uc=N01-U01' }), '', 'a use case with no run is no link');
  assert.equal(R.queryLink({ ...AT, search: '?open=app' }), '');
  assert.deepEqual(R.hashLink(`#/review/${SID}/N01-U01`), { page: R.REVIEW_TAB, sessionId: SID, useCaseId: 'N01-U01', valid: true });
  assert.deepEqual(R.hashLink(`#/review/${SID}/`), { page: R.REVIEW_TAB, sessionId: SID, useCaseId: '', valid: true });
  assert.deepEqual(R.hashLink('#/run/n01-u01-a'), { page: R.RUN_TAB, id: 'n01-u01-a' });
  for (const none of ['', '#/', '#/review', `#/review/${SID}`, `#/review/${SID}/a/b`, '#review/1/2', '#/build/1/2']) assert.equal(R.hashLink(none), null, none);
});

test('every quoted use case id opens exactly that use case: spaces, a slash, an ampersand, a plus and non-Latin letters', async () => {
  const R = await lib('runPages.js');
  for (const id of ['N01 U01', 'N01/U02', 'A&B=1', 'N01+U03', "it's (1)", 'تقرير-٣', '顧客-01', 'Ünïcode U01', '100%', '#?']) {
    for (const quote of [encodeURIComponent, quoted]) {
      const { link } = opened(R, `?review=${SID}&uc=${quote(id)}`);
      assert.deepEqual([link.page, link.sessionId, link.useCaseId, link.valid], [R.REVIEW_TAB, SID, id, true], `${id} quoted as ${quote(id)}`);
    }
  }
  const { link } = opened(R, `?review=${SID}&uc=N01+U01`);
  assert.equal(link.useCaseId, 'N01 U01', 'an unquoted plus reads as a space, the way every query does; the agent quotes it as %2B');
  const spaced = opened(R, `?review=${SID}&uc=%20N01-U01%20`).link;
  assert.equal(spaced.useCaseId, 'N01-U01', 'spaces around the id are not part of it');
});

test('a session id that is not a run id reads back exactly but is not valid, so it never reaches the server, and the reason quotes it', async () => {
  const R = await lib('runPages.js');
  for (const [search, asked] of [['?review=abc&uc=N01-U01', 'abc'], ['?review=12%2034&uc=N01-U01', '12 34'], ['?review=&uc=N01-U01', ''],
    [`?review=${'9'.repeat(20)}&uc=N01-U01`, '9'.repeat(20)], ['?review=-1&uc=N01-U01', '-1'], ['?review=1.5&uc=N01-U01', '1.5']]) {
    const { link } = opened(R, search);
    assert.deepEqual([link.page, link.sessionId, link.valid], [R.REVIEW_TAB, asked, false], search);
  }
  const broken = R.hashLink('#/review/%E0%A4%A/N01-U01');
  assert.deepEqual([broken.sessionId, broken.valid], ['', false], 'a broken escape is no run id');
  assert.equal(R.hashLink('#/review/%2042%20/N01-U01').valid, true, 'spaces around a run id are not part of it');
  assert.equal(R.reviewLinkText({ sessionId: 'abc', valid: false }, 'main.inspire'), 'That link names no run Inspire can open: abc is not a run id. Here is every run.');
  assert.equal(R.reviewLinkText({ sessionId: '', valid: false }, 'main.inspire'), 'That link names no run. Here is every run.');
  assert.equal(R.reviewLinkText({ sessionId: 'x'.repeat(300), valid: false }, 'main.inspire').length, 'That link names no run Inspire can open:  is not a run id. Here is every run.'.length + 80);
  assert.equal(R.reviewLinkText({ sessionId: '42' }, 'main.inspire', 'missing'), 'That link names no run Inspire can open: 42 is not a run id. Here is every run.',
    'only a link the parser marked valid counts as a run');
});

test('each reason says which: no such run, no read access, or no such use case in the run', async () => {
  const R = await lib('runPages.js');
  const link = { sessionId: '42', useCaseId: 'N09-U09', valid: true };
  assert.equal(R.reviewLinkText(link, 'main.inspire', 'missing'), 'Inspire has no run 42 in the Inspire Database main.inspire. Here is every run.');
  assert.equal(R.reviewLinkText(link, 'main.inspire', 'denied'),
    'You cannot read run 42: your sign-in has no read access to the Inspire Database main.inspire. Ask its owner for SELECT on it.');
  assert.equal(R.reviewLinkText(link, 'main.inspire', 'no_use_case'), 'Run 42 has no use case N09-U09, so Review shows every use case of the run.');
  assert.equal(R.reviewLinkText(link, '', 'missing'), 'Inspire has no run 42 in this Inspire Database. Here is every run.');
  assert.equal(R.reviewLinkText(link, 'main.inspire', 'found'), '', 'a run that opened needs no reason');
  for (const text of [R.REVIEW_LEFT_DEMO, R.reviewLinkText(link, 'main.inspire', 'denied')]) assert.doesNotMatch(text, /[\u2013\u2014]/);
});

test('the Run hash follows the Run tab and leaves a Review hash alone', async () => {
  const R = await lib('runPages.js');
  assert.equal(R.runHashLink({ pathname: '/', search: '', hash: `#/review/${SID}/N01-U01` }, null), null);
  assert.equal(R.runHashLink({ pathname: '/', search: '', hash: '#/run/n01-u01-a' }, null), '/');
});
