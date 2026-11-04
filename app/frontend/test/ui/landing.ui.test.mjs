import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, painted } from './uiSupport.mjs';
import { APP_TABS } from '../../src/lib/tabs.js';
import { SHOWCASE_BUTTON } from '../../src/lib/showcase.js';

test.after(closeBrowser);

const STALE = ['in under 30 minutes', 'in minutes', 'Scans 100+ tables', 'Genie-ready code instructions', 'executive presentations',
  'implementation-ready', 'clusters tables into business domains', 'The Pipeline', 'Deliver Artifacts', 'See Demo Results'];

const groups = (page) => page.locator('[data-landing-actions]');
const clicks = (page) => page.locator('output[aria-label="Landing clicks"]');

test('the home page offers exactly two calls to action, Get Started and See Demo, in the hero and at the end, and each does what it says', async () => {
  const ui = await openUi('landing');
  const { page } = ui;
  try {
    await page.getByText('Scroll to explore').waitFor();
    assert.equal(await groups(page).count(), 2, 'the hero and the closing section');
    for (let i = 0; i < 2; i += 1) {
      assert.deepEqual((await groups(page).nth(i).getByRole('button').allInnerTexts()).map((t) => t.trim()), ['Get Started', SHOWCASE_BUTTON]);
    }
    const names = await page.getByRole('button').evaluateAll((els) => els.map((el) => (el.getAttribute('aria-label') || el.textContent || el.title).trim()));
    assert.equal(names.filter((n) => n === 'Get Started').length, 2, 'Get Started shows only in the two call-to-action groups');
    assert.equal(names.filter((n) => n === SHOWCASE_BUTTON).length, 2, 'See Demo shows only in the two call-to-action groups');
    const others = names.filter((n) => !['Get Started', SHOWCASE_BUTTON, 'Workspace setup'].includes(n) && !/^Switch to (dark|light) mode$/.test(n));
    assert.deepEqual(others, ['Discover', 'Analyze', 'How it works', 'Agent', 'What you get', 'Try it'],
      'the rest are the section links and the theme switch, so nothing else asks the person to act');
    assert.equal(await page.locator('nav').getByRole('button', { name: 'Get Started' }).count(), 0, 'the top bar holds no third Get Started');
    assert.doesNotMatch(await page.locator('nav').first().innerText(), /\bv\d/i, 'the top bar shows no version badge');
    await groups(page).first().getByRole('button', { name: 'Get Started', exact: true }).click();
    await groups(page).first().getByRole('button', { name: SHOWCASE_BUTTON, exact: true }).click();
    await groups(page).last().getByRole('button', { name: 'Get Started', exact: true }).click();
    assert.equal(await clicks(page).textContent(), 'start,demo,start');
    assert.match(await page.locator('body').innerText(), /or open the demo to see a finished run/);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('scrolling the home page down and back step by step, through the section where the orb rings start and stop, writes no console error', async () => {
  const ui = await openUi('landing');
  const { page } = ui;
  try {
    await page.getByText('Scroll to explore').waitFor();
    const height = await page.locator('.snap-y').evaluate((el) => {
      el.style.scrollSnapType = 'none';
      el.style.scrollBehavior = 'auto';
      return el.scrollHeight - el.clientHeight;
    });
    const stops = Array.from({ length: 41 }, (_, i) => Math.round((height * i) / 40));
    const seen = new Set();
    for (const y of [...stops, ...[...stops].reverse(), ...stops]) {
      await page.locator('.snap-y').evaluate((el, to) => { el.scrollTop = to; }, y);
      await painted(page);
      const rings = await page.evaluate(() => [...document.querySelectorAll('[class*="rounded-full border"]')]
        .map((el) => `${el.style.animationName || 'none'} ${el.style.animationDelay || '0s'}`));
      for (const ring of rings) seen.add(ring);
    }
    assert.ok(seen.has('orbRing 0.5s'), `the scroll crosses the section where the rings run, each with its own delay: ${[...seen].join(', ')}`);
    assert.deepEqual(ui.pageErrors, [], 'no rerender mixes the animation shorthand with its delay');
  } finally {
    await ui.close();
  }
});

test('without a demo in the App the home page offers Get Started alone and does not mention the demo', async () => {
  const ui = await openUi('landing', {}, '&demo=0');
  const { page } = ui;
  try {
    await page.getByText('Scroll to explore').waitFor();
    for (let i = 0; i < 2; i += 1) {
      assert.deepEqual((await groups(page).nth(i).getByRole('button').allInnerTexts()).map((t) => t.trim()), ['Get Started']);
    }
    assert.doesNotMatch(await page.locator('body').innerText(), /demo/i);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('an App the installer set up shows no setup wizard on its home page, and a self-run App names Workspace setup without the word wizard', async () => {
  const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
    inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
  const mount = (app) => {
    app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
    app.get('/api/showcase', (_req, res) => res.json({}));
  };
  const installed = await openUi('app', {}, '', { mount });
  try {
    await installed.page.getByRole('button', { name: 'Get Started', exact: true }).first().waitFor({ timeout: 20000 });
    const text = await installed.page.locator('body').innerText();
    assert.doesNotMatch(text, /setup wizard/i);
    assert.doesNotMatch(text, /host, token/i);
    assert.equal(await installed.page.getByRole('button', { name: 'Workspace setup' }).count(), 0);
    const about = installed.page.getByRole('contentinfo', { name: 'About Inspire' });
    assert.equal(await about.count(), 1);
    assert.equal(await about.innerText(), 'Inspire is open source and provided as is. Databricks Support does not cover it: ask questions and request features on the Inspire GitHub Issues page.');
    assert.equal(await about.getByRole('link', { name: 'Inspire GitHub Issues page' }).getAttribute('href'), 'https://github.com/amralieg/inspire/issues');
    const hero = installed.page.getByRole('button', { name: 'Get Started', exact: true }).first().locator('xpath=ancestor::section[1]');
    assert.doesNotMatch(await hero.innerText(), /support|provided as/i, 'the notice sits in the footer, not under Get Started (must-exclude)');
    assert.deepEqual(installed.pageErrors, []);
  } finally {
    await installed.close();
  }
  const local = await openUi('landing');
  try {
    await local.page.getByText('Scroll to explore').waitFor();
    assert.doesNotMatch(await local.page.locator('body').innerText(), /wizard/i);
    await local.page.getByRole('button', { name: 'Workspace setup', exact: true }).click();
    assert.equal(await clicks(local.page).textContent(), 'setup');
    assert.deepEqual(local.pageErrors, []);
  } finally {
    await local.close();
  }
});

test('the home page walks through the five tabs as they work now and keeps none of the old claims', async () => {
  const ui = await openUi('landing');
  const { page } = ui;
  try {
    await page.getByText('Scroll to explore').waitFor();
    const steps = page.getByRole('list', { name: 'How Inspire works' }).getByRole('listitem');
    assert.equal(await steps.count(), APP_TABS.length);
    for (let i = 0; i < APP_TABS.length; i += 1) {
      const tab = APP_TABS[i];
      assert.equal(await steps.nth(i).getAttribute('data-landing-step'), tab.label);
      assert.equal((await steps.nth(i).getByRole('heading').innerText()).trim(), tab.label);
      assert.match(await steps.nth(i).innerText(), new RegExp(`0${i + 1}`));
      assert.equal((await steps.nth(i).locator('p').innerText()).trim(), tab.blurb);
    }
    assert.deepEqual(APP_TABS.map((t) => t.label), ['Start', 'Monitor', 'Review', 'Build', 'Run']);
    const text = await page.locator('body').innerText();
    for (const claim of STALE) assert.equal(text.includes(claim), false, claim);
    assert.doesNotMatch(text, /\bResults\b/, 'no section or step names the old Results tab');
    for (const claim of ['Genie then builds an MVP for each one you pick.', 'Writes a PDF catalog and, if you ask, a slide deck',
      'Hands each use case you pick to Genie to build its MVP', 'Ready to build.']) {
      assert.ok(text.includes(claim), claim);
    }
    assert.doesNotMatch(text, /[\u2013\u2014]/, 'no en or em dash in the home page text');
    const hint = page.getByText('Scroll to explore');
    assert.equal(await hint.isVisible(), true);
    await page.setViewportSize({ width: 1024, height: 768 });
    await hint.waitFor({ state: 'hidden', timeout: 15000 });
    assert.equal(await hint.isVisible(), false, 'on a short screen the scroll hint gives way to the setup note and the disclaimer');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
