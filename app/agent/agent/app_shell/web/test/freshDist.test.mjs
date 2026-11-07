import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DIST_OUTPUTS, WEB, WEB_INPUTS, deadLockOwner, ensureDist, lockPathOf, staleReason, takeLock } from './freshDist.mjs';

const at = (file, seconds) => utimesSync(file, seconds, seconds);
const quiet = { log: () => {} };

function webTree() {
  const web = mkdtempSync(join(tmpdir(), 'inspire-web-'));
  mkdirSync(join(web, 'src'));
  for (const name of ['index.html', 'package.json', 'package-lock.json', 'vite.config.js', join('src', 'main.jsx'), join('src', 'App.jsx')]) {
    writeFileSync(join(web, name), 'x');
    at(join(web, name), 1000);
  }
  at(join(web, 'src'), 1000);
  return web;
}

function writeOutputs(dir, seconds) {
  mkdirSync(join(dir, 'assets'), { recursive: true });
  for (const name of DIST_OUTPUTS) {
    writeFileSync(join(dir, name), 'built');
    if (seconds) at(join(dir, name), seconds);
  }
}

const built = (web, seconds = 2000) => writeOutputs(join(web, 'dist'), seconds);

function counted() {
  const calls = [];
  return { calls, buildFn: async (web, out) => { calls.push(out); await new Promise((done) => { setTimeout(done, 300); }); writeOutputs(out); } };
}

test('every test file that opens the built App goes through the harness, and the harness builds dist before any test runs', () => {
  const harness = readFileSync(join(WEB, 'test', 'harness.mjs'), 'utf8');
  assert.match(harness, /^await ensureDist\(\);$/m);
  const tests = readdirSync(join(WEB, 'test')).filter((name) => name.endsWith('.test.mjs') && name !== 'freshDist.test.mjs');
  const readsDist = tests.filter((name) => /\bdist\b|serveDist/.test(readFileSync(join(WEB, 'test', name), 'utf8')));
  assert.ok(readsDist.length > 0, 'some test reads dist');
  assert.deepEqual(readsDist.filter((name) => !readFileSync(join(WEB, 'test', name), 'utf8').includes("from './harness.mjs'")), []);
});

test('dist counts as built from the same inputs the notebook embed hashes', () => {
  const embed = readFileSync(join(WEB, '..', 'embed.py'), 'utf8');
  const listed = /^WEB_INPUTS = \(([^)]*)\)/m.exec(embed);
  assert.ok(listed, 'embed.py names its web inputs');
  assert.deepEqual(WEB_INPUTS, [...listed[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
});

test('a missing dist, or a dist with an output gone, is stale and says which output is missing', () => {
  const web = webTree();
  try {
    assert.equal(staleReason(web), 'dist has no index.html and no assets/app.js');
    built(web);
    unlinkSync(join(web, 'dist', 'assets', 'app.js'));
    assert.equal(staleReason(web), 'dist has no assets/app.js');
  } finally {
    rmSync(web, { recursive: true, force: true });
  }
});

test('a dist newer than every input is current, and an input changed, added or removed after the build makes it stale', () => {
  const web = webTree();
  try {
    built(web);
    assert.equal(staleReason(web), '');
    at(join(web, 'src', 'App.jsx'), 3000);
    assert.equal(staleReason(web), 'src changed after dist was built');
    built(web, 4000);
    assert.equal(staleReason(web), '');
    unlinkSync(join(web, 'src', 'main.jsx'));
    at(join(web, 'src'), 5000);
    assert.equal(staleReason(web), 'src changed after dist was built');
    built(web, 6000);
    at(join(web, 'vite.config.js'), 7000);
    at(join(web, 'package-lock.json'), 7000);
    assert.equal(staleReason(web), 'package-lock.json, vite.config.js changed after dist was built');
    built(web, 8000);
    at(join(web, 'dist', 'index.html'), 500);
    assert.equal(staleReason(web), 'index.html, package.json, package-lock.json, vite.config.js, src changed after dist was built', 'the oldest output decides');
  } finally {
    rmSync(web, { recursive: true, force: true });
  }
});

test('a deleted dist is built once though many callers ask at the same time, and a current dist is never rebuilt', async () => {
  const web = webTree();
  const { calls, buildFn } = counted();
  try {
    const lines = [];
    const got = await Promise.all([1, 2, 3, 4].map(() => ensureDist(web, { log: (line) => lines.push(line), buildFn })));
    assert.deepEqual(got.sort(), [false, false, false, true]);
    assert.equal(calls.length, 1, 'one build for four callers');
    assert.deepEqual(lines, ['building dist: dist has no index.html and no assets/app.js']);
    assert.equal(staleReason(web), '');
    assert.equal(await ensureDist(web, { ...quiet, buildFn }), false);
    assert.equal(calls.length, 1, 'a current dist is not rebuilt');
    built(web, 2000);
    at(join(web, 'src', 'App.jsx'), 3000);
    assert.equal(await ensureDist(web, { ...quiet, buildFn }), true);
    assert.equal(calls.length, 2, 'a changed source rebuilds');
    assert.deepEqual(readdirSync(web).filter((name) => name.startsWith('.dist-')), [], 'no build folder is left behind');
    assert.equal(existsSync(lockPathOf(web)), false, 'the lock is released');
  } finally {
    rmSync(web, { recursive: true, force: true });
  }
});

test('a failed build leaves the old dist in place, no build folder behind and the lock free', async () => {
  const web = webTree();
  try {
    built(web);
    at(join(web, 'src', 'App.jsx'), 3000);
    await assert.rejects(ensureDist(web, { ...quiet, buildFn: async () => { throw new Error('vite failed'); } }), /vite failed/);
    assert.equal(readFileSync(join(web, 'dist', 'index.html'), 'utf8'), 'built');
    assert.deepEqual(readdirSync(web).filter((name) => name.startsWith('.dist-')), []);
    assert.equal(existsSync(lockPathOf(web)), false);
  } finally {
    rmSync(web, { recursive: true, force: true });
  }
});

test('a lock left by a test process that died is taken over, and a lock held by a live process is waited for, then named', async () => {
  const web = webTree();
  const lock = lockPathOf(web);
  try {
    const dead = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' });
    const deadPid = Number(dead.stdout.trim());
    mkdirSync(lock);
    writeFileSync(join(lock, 'pid'), String(deadPid));
    assert.equal(deadLockOwner(lock), deadPid);
    const release = await takeLock(lock, 5000);
    assert.equal(readFileSync(join(lock, 'pid'), 'utf8'), String(process.pid));
    assert.equal(deadLockOwner(lock), 0, 'this process is alive, so its lock is never taken over');
    await assert.rejects(takeLock(lock, 600), new RegExp(`waited 1 s for another test process to build dist; its lock is ${lock.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    release();
    assert.equal(existsSync(lock), false);
  } finally {
    rmSync(lock, { recursive: true, force: true });
    rmSync(web, { recursive: true, force: true });
  }
});

test('the real dist the suite runs on is current with the sources once the harness loads', async () => {
  await import('./harness.mjs');
  assert.equal(staleReason(), '');
});
