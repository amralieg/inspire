#!/usr/bin/env node
/**
 * Copy the split agent into the App (app/inspire_discover.ipynb, app/inspire_generate.ipynb, app/inspire_lib.py); the App ships those three files.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['inspire_discover.ipynb', 'inspire_generate.ipynb', 'inspire_lib.py'];

for (const name of FILES) {
  const agent = path.join(root, 'agent', 'agent', name);
  const src = path.join(root, name);
  if (!fs.existsSync(agent)) {
    console.error(`Missing ${agent}`);
    process.exit(1);
  }
  const latest = fs.readFileSync(agent);
  if (fs.existsSync(src) && fs.readFileSync(src).equals(latest)) {
    console.log(`${src} is the agent file`);
  } else {
    fs.writeFileSync(src, latest);
    console.log(`Copied ${agent} to ${src}`);
  }
}
