import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { UI_HEADER, VITE_CACHE_DIR, closeBrowser, openUi } from './uiSupport.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, '..', '..');
const shared = path.join(fs.realpathSync(path.join(frontend, 'node_modules')), '.vite');
const support = pathToFileURL(path.join(here, 'uiSupport.mjs')).href;

test.after(closeBrowser);

const stamp = (file) => (fs.existsSync(file) ? fs.statSync(file).mtimeMs : null);

test('each UI test process pre-bundles into its own vite cache, so a server of another tree or run never deletes the files a page is loading', async () => {
  const real = fs.realpathSync(VITE_CACHE_DIR);
  assert.ok(path.relative(shared, real).startsWith('..'), `the cache ${real} sits outside the shared ${shared}`);
  assert.ok(path.relative(fs.realpathSync(frontend), real).startsWith('..'), 'and outside the frontend folder every tree links to');
  const before = stamp(path.join(shared, 'deps', '_metadata.json'));
  const ui = await openUi('implement', {});
  try {
    await ui.page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    assert.ok(fs.existsSync(path.join(VITE_CACHE_DIR, 'deps', '_metadata.json')), 'the page loaded its dependencies from this process cache');
    assert.equal(stamp(path.join(shared, 'deps', '_metadata.json')), before, 'the shared cache is left as it was');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
  const other = spawnSync(process.execPath, ['--input-type=module', '-e', `import(${JSON.stringify(support)}).then((m) => console.log(m.VITE_CACHE_DIR))`],
    { encoding: 'utf8' });
  assert.equal(other.status, 0, other.stderr);
  const theirs = other.stdout.trim().split('\n').pop();
  assert.notEqual(theirs, VITE_CACHE_DIR, 'another process gets a cache of its own');
  assert.equal(fs.existsSync(theirs), false, 'and its cache is removed when it exits');
});

test('the UI tests of one process share one dev server, and each page reaches only the backend of its own test', async () => {
  const a = await openUi('implement', { stepResults: 'of A' });
  const b = await openUi('implement', { stepResults: 'of B' });
  const ask = (ui, headers) => ui.page.evaluate(async (sent) => {
    const got = await fetch('/api/inspire/step-results', { headers: sent || {} });
    return { status: got.status, text: await got.text() };
  }, headers);
  try {
    assert.equal(a.origin, b.origin, 'one dev server keeps its transforms for every test of the process');
    assert.deepEqual(JSON.parse((await ask(a)).text), { results: 'of A' });
    assert.deepEqual(JSON.parse((await ask(b)).text), { results: 'of B' });
    const plain = await fetch(`${a.origin}/api/inspire/step-results`);
    assert.equal(plain.status, 503, 'a request that names no test, with two tests open, reaches neither');
    const gone = await fetch(`${a.origin}/api/inspire/step-results`, { headers: { [UI_HEADER]: 'never-opened' } });
    assert.equal(gone.status, 503, 'and one naming a test that is not open reaches none');
    await b.close();
    const only = await fetch(`${a.origin}/api/inspire/step-results`);
    assert.deepEqual(await only.json(), { results: 'of A' }, 'a request from a page of the one open test, like a context it made, reaches that test');
  } finally {
    await a.close();
    await b.close();
  }
});

test('a suite run pre-bundles the dependencies once, and each UI test process starts from its own copy and never bundles them again', async () => {
  const prebundle = await import(pathToFileURL(path.join(here, 'prebundle.mjs')).href);
  const { PREBUNDLED_ENV } = await import(support);
  const had = process.env[PREBUNDLED_ENV];
  const probe = `
    import fs from 'node:fs';
    import path from 'node:path';
    const m = await import(${JSON.stringify(support)});
    const meta = path.join(m.VITE_CACHE_DIR, 'deps', '_metadata.json');
    const copied = fs.existsSync(meta) ? fs.statSync(meta).mtimeMs : null;
    const ui = await m.openUi('implement', {});
    await ui.page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await ui.close();
    await m.closeBrowser();
    console.log(JSON.stringify({ cache: fs.realpathSync(m.VITE_CACHE_DIR), copied, after: fs.statSync(meta).mtimeMs }));`;
  const run = (env) => {
    const got = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8', env });
    assert.equal(got.status, 0, got.stderr);
    return JSON.parse(got.stdout.trim().split('\n').pop());
  };
  try {
    await prebundle.globalSetup();
    const made = process.env[PREBUNDLED_ENV];
    assert.ok(fs.existsSync(path.join(made, 'deps', '_metadata.json')), 'the run bundled its dependencies once');
    const one = run(process.env);
    assert.notEqual(one.copied, null, 'the process starts from the run bundle');
    assert.equal(one.after, one.copied, 'and its server never bundles the dependencies again');
    assert.notEqual(one.cache, fs.realpathSync(made), 'the copy is the process cache of its own');
    const alone = run({ ...process.env, [PREBUNDLED_ENV]: '' });
    assert.equal(alone.copied, null, 'a file run on its own starts empty');
    assert.notEqual(alone.after, null, 'and bundles into its own cache');
    await prebundle.globalTeardown();
    assert.equal(fs.existsSync(made), false, 'the run bundle is removed when the run ends');
  } finally {
    await prebundle.globalTeardown();
    if (had === undefined) delete process.env[PREBUNDLED_ENV];
    else process.env[PREBUNDLED_ENV] = had;
  }
});
