import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

const policyRefusal = (route, rule, error) => ({ error, policy: { route, rule, needs: rule === 'managers' ? 'an App manager' : 'the person who launched it' } });
const NESTED_BUTTONS = /(cannot be a descendant of <%s>|cannot contain a nested %s)[\s\S]*<button>/;
const SESSION = { session_id: '1001', business_name: 'Acme Retail', completed_percent: 100, processing_status: 'done', created_at: '2026-10-01T09:00:00Z' };

test('Choose shows why the policy refused to delete a session, next to that session, and keeps the session listed', async () => {
  const deletes = [];
  const message = 'Only the person who launched session 1001 or an App manager can delete it. It was launched by launcher@example.com.';
  const ui = await openUi('choose', {}, '', {
    mount: (app) => {
      app.get('/api/inspire/sessions', (_req, res) => res.json({ sessions: [SESSION] }));
      app.delete('/api/inspire/session', (req, res) => {
        deletes.push(req.query.session_id);
        res.status(403).json(policyRefusal('DELETE /api/inspire/session', 'launcher', message));
      });
    },
  });
  try {
    await ui.page.getByText('Acme Retail').first().waitFor();
    await ui.page.getByTitle('Delete run').first().click();
    await ui.page.getByRole('button', { name: 'Delete', exact: true }).click();
    const alert = ui.page.getByRole('alert').filter({ hasText: 'Only the person who launched session 1001' });
    await alert.waitFor({ timeout: 10000 });
    assert.equal(await alert.innerText(), message);
    assert.deepEqual(deletes, ['1001']);
    assert.equal(await ui.page.getByText('Acme Retail').count() > 0, true, 'a refused delete keeps the session listed');
    assert.deepEqual(ui.pageErrors.filter((e) => !/403/.test(e) && !NESTED_BUTTONS.test(e)), []);
  } finally {
    await ui.close();
  }
});

test('Setup shows why the policy refused to publish the notebook, and offers Publish again', async () => {
  const publishes = [];
  const message = 'Only an App manager can republish the agent notebook. You need CAN MANAGE on the inspire-test-app App, so ask one of its managers.';
  const ui = await openUi('setup', {}, '', {
    mount: (app) => {
      app.get('/api/defaults', (_req, res) => res.json({ envSkipsSetupWizard: false }));
      app.get('/api/health', (_req, res) => res.json({ isDatabricksApp: false }));
      app.post('/api/setup/create-database', (_req, res) => res.json({ ok: true }));
      app.post('/api/setup/verify', (_req, res) => res.json({ ok: true, checks: { warehouse: { ok: true, message: 'The warehouse answers' } } }));
      app.post('/api/notebook/republish', (req, res) => {
        publishes.push(req.method);
        res.status(403).json(policyRefusal('POST /api/notebook/republish', 'managers', message));
      });
    },
  });
  try {
    for (let i = 0; i < 4; i += 1) {
      const next = ui.page.getByRole('button', { name: 'Continue' });
      await next.waitFor();
      await next.click();
    }
    await ui.page.getByRole('button', { name: 'Run Verification' }).click();
    await ui.page.getByRole('button', { name: 'Publish Notebook to Workspace' }).click();
    const alert = ui.page.getByRole('alert').filter({ hasText: 'Only an App manager can republish' });
    await alert.waitFor({ timeout: 10000 });
    assert.equal((await alert.innerText()).split('\n')[0], `Inspire could not publish the notebook: ${message}`);
    assert.equal(await alert.getByRole('button', { name: 'Copy what to send' }).count(), 1);
    assert.deepEqual(publishes, ['POST']);
    await ui.page.getByRole('button', { name: 'Publish Notebook to Workspace' }).click();
    await until(() => publishes.length === 2, 'a second publish attempt');
    assert.equal(await ui.page.getByLabel('Setup done').innerText(), 'no');
    assert.deepEqual(ui.pageErrors.filter((e) => !/403/.test(e)), []);
  } finally {
    await ui.close();
  }
});
