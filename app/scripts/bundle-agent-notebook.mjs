#!/usr/bin/env node
/**
 * Embed dbx_inspire_ai_agent.ipynb for the backend fallback used when the
 * physical notebook is unavailable in the Databricks App runtime.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'dbx_inspire_ai_agent.ipynb');
const out = path.join(root, 'backend', 'notebook_bundle.js');

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
