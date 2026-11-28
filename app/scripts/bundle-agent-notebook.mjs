#!/usr/bin/env node
/**
 * Copy the agent notebook into the App (app/dbx_inspire_ai_agent.ipynb); the App ships that one file.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const agent = path.join(root, 'agent', 'agent', 'dbx_inspire_ai_agent.ipynb');
const src = path.join(root, 'dbx_inspire_ai_agent.ipynb');

if (!fs.existsSync(agent)) {
  console.error(`Missing ${agent}`);
  process.exit(1);
}
const latest = fs.readFileSync(agent);
if (fs.existsSync(src) && fs.readFileSync(src).equals(latest)) {
  console.log(`${src} is the agent notebook`);
} else {
  fs.writeFileSync(src, latest);
  console.log(`Copied ${agent} to ${src}`);
}
