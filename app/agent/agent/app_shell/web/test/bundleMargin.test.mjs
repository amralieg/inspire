import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDist } from './freshDist.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN_BUDGET = 1_300_000;
const MIN_MARGIN = 50_000;

await ensureDist();

test('the main bundle keeps at least 50 KB under its 1,300,000-byte budget, so one more feature cannot break the build', () => {
  const size = statSync(join(HERE, '..', 'dist', 'assets', 'app.js')).size;
  assert.ok(MAIN_BUDGET - size >= MIN_MARGIN, `app.js is ${size} bytes, margin ${MAIN_BUDGET - size} bytes, need at least ${MIN_MARGIN}`);
});
