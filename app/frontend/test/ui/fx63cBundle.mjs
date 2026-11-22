// FX-63c: bundles a few components for a bare Chromium page, so a hook or an editor is driven with real events and no app shell.
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let browser = null;
let script = null;

export async function bundleScript() {
  if (script) return script;
  const out = await build({
    stdin: {
      contents: [
        "import * as React from 'react';",
        "import { createRoot } from 'react-dom/client';",
        "import { BuildNextPanel } from './src/components/BuildNext.jsx';",
        "import { MoneyRuleEditor } from './src/components/MoneyRuleEditor.jsx';",
        'window.__lib = { React, createRoot, BuildNextPanel, MoneyRuleEditor };',
      ].join('\n'),
      resolveDir: root, loader: 'jsx', sourcefile: 'fx63c-entry.jsx',
    },
    bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent', jsx: 'automatic', loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"development"' },
  });
  script = out.outputFiles[0].text;
  return script;
}

export async function barePage() {
  if (!browser) browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  await page.addScriptTag({ content: await bundleScript() });
  return { page, errors };
}

export async function closeBare() { if (browser) { await browser.close(); browser = null; } }
