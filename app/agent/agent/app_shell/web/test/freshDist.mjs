import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const WEB_INPUTS = ['index.html', 'package.json', 'package-lock.json', 'vite.config.js', 'src'];
export const DIST_OUTPUTS = ['index.html', join('assets', 'app.js')];
const LOCK_POLL_MS = 250;
const LOCK_WAIT_MS = 600000;
const UNCLAIMED_LOCK_MS = 60000;

function newestInput(path) {
  const kind = lstatSync(path, { throwIfNoEntry: false });
  if (!kind) return 0;
  if (!kind.isDirectory()) return kind.mtimeMs;
  return readdirSync(path).reduce((newest, name) => Math.max(newest, newestInput(join(path, name))), kind.mtimeMs);
}

export function staleReason(web = WEB) {
  const outputs = DIST_OUTPUTS.map((name) => join(web, 'dist', name));
  const missing = DIST_OUTPUTS.filter((name, i) => !existsSync(outputs[i]));
  if (missing.length) return `dist has no ${missing.join(' and no ')}`;
  const built = Math.min(...outputs.map((file) => lstatSync(file).mtimeMs));
  const changed = WEB_INPUTS.filter((name) => newestInput(join(web, name)) > built);
  return changed.length ? `${changed.join(', ')} changed after dist was built` : '';
}

export const lockPathOf = (web = WEB) => join(tmpdir(), `inspire-web-dist-${createHash('sha256').update(resolve(web)).digest('hex').slice(0, 16)}.lock`);

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

export function deadLockOwner(lock) {
  const pid = Number(readFileSync(join(lock, 'pid'), 'utf8').trim());
  return Number.isInteger(pid) && pid > 0 && !alive(pid) ? pid : 0;
}

function freeDeadLock(lock) {
  let owner = 0;
  try {
    owner = deadLockOwner(lock);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const since = lstatSync(lock, { throwIfNoEntry: false });
    if (since && Date.now() - since.mtimeMs > UNCLAIMED_LOCK_MS) rmSync(lock, { recursive: true, force: true });
    return;
  }
  if (owner) rmSync(lock, { recursive: true, force: true });
}

export async function takeLock(lock, wait = LOCK_WAIT_MS) {
  const end = Date.now() + wait;
  for (;;) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, 'pid'), String(process.pid));
      return () => rmSync(lock, { recursive: true, force: true });
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    freeDeadLock(lock);
    if (Date.now() > end) throw new Error(`waited ${Math.round(wait / 1000)} s for another test process to build dist; its lock is ${lock}`);
    await new Promise((done) => { setTimeout(done, LOCK_POLL_MS); });
  }
}

async function buildInto(web, out) {
  const { build } = await import('vite');
  await build({ root: web, configFile: join(web, 'vite.config.js'), logLevel: 'warn', build: { outDir: out, emptyOutDir: true } });
}

export async function ensureDist(web = WEB, { log = console.log, buildFn = buildInto } = {}) {
  if (!staleReason(web)) return false;
  const release = await takeLock(lockPathOf(web));
  const out = mkdtempSync(join(web, '.dist-'));
  try {
    const reason = staleReason(web);
    if (!reason) return false;
    log(`building dist: ${reason}`);
    await buildFn(web, out);
    const dist = join(web, 'dist');
    const old = `${out}-old`;
    if (existsSync(dist)) renameSync(dist, old);
    renameSync(out, dist);
    rmSync(old, { recursive: true, force: true });
    const after = staleReason(web);
    if (after) throw new Error(`the build left dist stale: ${after}`);
    return true;
  } finally {
    rmSync(out, { recursive: true, force: true });
    release();
  }
}
