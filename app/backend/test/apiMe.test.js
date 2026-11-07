const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');

test.after(() => S.stopServer());

test('/api/me names the signed-in person from the proxy headers, and the App separately', async () => {
  S.reset();
  const got = await S.request('GET', '/api/me', { person: 'Person.One@Example.com' });
  assert.equal(got.status, 200, got.text);
  assert.equal(got.data.person.username, 'Person.One@Example.com');
  assert.equal(got.data.person.source, 'proxy');
  assert.equal(got.data.app.username, S.APP_SP);
  assert.notEqual(got.data.person.username, got.data.app.username);
  assert.equal(got.data.username, undefined, 'no unlabeled top-level identity');
});

test('every frontend consumer of /api/me shows the person, never an unlabeled username', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..', '..', 'frontend', 'src');
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /\.(jsx?|mjs)$/.test(entry.name)) files.push(full);
    }
  };
  walk(root);
  const consumers = files.filter((f) => /['"`]\/api\/me['"`]/.test(fs.readFileSync(f, 'utf8')));
  assert.ok(consumers.length >= 1, 'no /api/me consumer found, so the scan is broken');
  for (const file of consumers) {
    const text = fs.readFileSync(file, 'utf8');
    const after = text.slice(text.search(/['"`]\/api\/me['"`]/), text.search(/['"`]\/api\/me['"`]/) + 400);
    assert.match(after, /\.person\b/, `${path.relative(root, file)} must read the person from /api/me`);
    assert.doesNotMatch(after, /data\.username|data\.displayName/, `${path.relative(root, file)} reads an unlabeled identity`);
  }
});

test('/api/me refuses with a plain sentence when the proxy sent no person', async () => {
  S.reset();
  const got = await S.request('GET', '/api/me', { signedIn: false });
  assert.equal(got.status, 401, got.text);
  assert.match(got.data.error, /signed-in person/);
});
