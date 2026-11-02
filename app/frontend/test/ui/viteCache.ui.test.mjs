import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { VITE_CACHE_DIR, closeBrowser, openUi } from './uiSupport.mjs';

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
