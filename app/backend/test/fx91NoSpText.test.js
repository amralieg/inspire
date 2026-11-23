// REQ-478 (FX-91): no "service principal", SP, GRANT, MANAGE or app-id text reaches a business user.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const I = require('../lib/inspireImplement');

const BANNED = [/service principal/i, /\bSP\b/, /GRANT /, /MANAGE/, /app-[a-z0-9]{4,}/];
const clean = (label, text) => {
  for (const re of BANNED) assert.ok(!re.test(text), `${label} matches ${re}: ${text}`);
  assert.ok(String(text).trim().length > 20, `${label} still says what to do`);
};

const catalogGap = [{ level: 'catalog', privilege: 'USE CATALOG', object: '`main`', owner: '' }];
const mixedGaps = [{ level: 'schema', privilege: 'USE SCHEMA', object: '`main`.`s`', owner: 'a@b.c' },
  { level: 'table', privilege: 'SELECT', object: '`main`.`s`.`t`', owner: 'a@b.c' }];
const offer = (grants) => ({ tables: ['main.s.t'], app: { name: 'My App', id: 'app-abc12345' }, grants, can_grant: grants.length > 0 });

test('appAccessMessage never names the principal, privileges or MANAGE', () => {
  clean('catalog gap', I.appAccessMessage('main.s.t', catalogGap));
  clean('mixed gaps', I.appAccessMessage('main.s.t', mixedGaps));
  clean('one gap', I.appAccessMessage('main.s.t', mixedGaps.slice(0, 1)));
});

test('appUnreadableMessage and the policy sentence name no principal or app id', () => {
  const g = ['GRANT SELECT ON TABLE `main`.`s`.`t` TO `app-abc12345`'];
  for (const job of ['build', 'discover']) {
    clean(`granted ${job}`, I.appUnreadableMessage(offer(g), job));
    clean(`ungranted ${job}`, I.appUnreadableMessage({ ...offer(g), can_grant: false }, job));
    clean(`nogrant ${job}`, I.appUnreadableMessage(offer([]), job));
  }
  clean('abac', I.abacUnreadableSentence('app-abc12345', { app: true }));
});

test('accessGapMessage and the Permission Required why carry no MANAGE or principal words', () => {
  clean('share gap', I.accessGapMessage('the team', mixedGaps));
  clean('why', I.appAccessPermission(mixedGaps, 'me@x.y').why);
});

test('static scan: user-string sources hold no banned wording outside comments and admin statements', () => {
  const lib = path.join(__dirname, '..', 'lib');
  const code = (f) => fs.readFileSync(path.join(lib, f), 'utf8').split('\n')
    .map((l, i) => [i + 1, l]).filter(([, l]) => !/^\s*(\/\/|\/\*|\*)/.test(l));
  const hits = [];
  for (const f of ['sourceAccess.js', 'requestPerson.js']) {
    for (const [n, l] of code(f)) if (/service principal/i.test(l.replace(/\bservice_principal\w*/g, ''))) hits.push(`${f}:${n}`);
  }
  const src = fs.readFileSync(path.join(lib, 'inspireImplement.js'), 'utf8');
  for (const name of ['abacUnreadableSentence', 'appUnreadableMessage', 'accessGapMessage', 'appAccessMessage']) {
    const start = src.indexOf(`function ${name}(`);
    const body = src.slice(start, src.indexOf('\n}\n', start)).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    for (const re of [/service principal/i, /MANAGE/, /GRANT /]) if (re.test(body)) hits.push(`${name} ${re}`);
  }
  const ucr = fs.readFileSync(path.join(lib, 'ucReads.js'), 'utf8');
  if (/knows no App service principal/.test(ucr)) hits.push('ucReads.js refusal prose');
  assert.deepEqual(hits, []);
});
