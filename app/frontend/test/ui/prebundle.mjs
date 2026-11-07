import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { optimizeDeps, resolveConfig } from 'vite';
import { PREBUNDLED_ENV, viteOptions } from './uiSupport.mjs';

let made = '';

export async function globalSetup() {
  made = fs.mkdtempSync(path.join(os.tmpdir(), 'inspire-ui-prebundle-'));
  await optimizeDeps(await resolveConfig(viteOptions(made), 'serve', 'development'));
  process.env[PREBUNDLED_ENV] = made;
}

export async function globalTeardown() {
  if (made) fs.rmSync(made, { recursive: true, force: true });
  made = '';
}
