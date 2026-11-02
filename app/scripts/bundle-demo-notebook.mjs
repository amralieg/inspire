#!/usr/bin/env node
/**
 * Embed dbx_generate_demo_data.py for Databricks App runtime (no root .py in /app).
 * Output: backend/demo_notebook_bundle.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'dbx_generate_demo_data.py');
const out = path.join(root, 'backend', 'demo_notebook_bundle.js');

if (!fs.existsSync(src)) {
  console.error(`Missing ${src}`);
  process.exit(1);
}

const b64 = fs.readFileSync(src).toString('base64');
const text = `module.exports = ${JSON.stringify(b64)};\n`;
if (fs.existsSync(out) && fs.readFileSync(out, 'utf8') === text) {
  console.log(`${out} is current (${b64.length} chars base64)`);
} else {
  fs.writeFileSync(out, text, 'utf8');
  console.log(`Wrote ${out} (${b64.length} chars base64)`);
}
