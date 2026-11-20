// REQ-418 (D-SL-10B): the App's service principal starts the demo data run. This replaces the run-as demo test the service-principal change
// retired: the pipeline is handed the App token, and every job call it makes carries that token, never a person's.
const test = require('node:test');
const assert = require('node:assert/strict');
const RP = require('../lib/routePolicy');
const { triggerDemoDataPipeline } = require('../lib/demoDataPipeline');

const APP_TOKEN = 'app-sp-token';

test('a demo data start runs as the App: the pipeline is given the App token and every job call carries it, never a manager’s (REQ-418)', async () => {
  assert.equal(RP.identityFor('POST /api/demo-data/start'), 'app', 'the demo start route reads and launches as the App');
  const tokens = [];
  const fetcher = async (host, token, url) => {
    tokens.push([url, token]);
    if (url === '/api/2.0/clusters/list') return { ok: true, json: async () => ({ clusters: [] }) };
    if (url === '/api/2.1/jobs/create') return { ok: true, json: async () => ({ job_id: 7 }) };
    if (url === '/api/2.1/jobs/run-now') return { ok: true, json: async () => ({ run_id: 9 }) };
    return { ok: true, json: async () => ({}) };
  };
  await triggerDemoDataPipeline(fetcher, () => 'https://h/run', 'https://h', APP_TOKEN, {
    description: 'A retailer with stores', businessName: 'Acme Retail', inspireDatabase: 'main._inspire', sessionId: '2001',
    cluster_id: '', resolveWorkspaceNotebookObjectPath: async (host, token, p) => p, notebookPath: '/Shared/inspire-test-app/dbx_inspire_ai_agent',
  });
  const jobCalls = tokens.filter(([url]) => url.startsWith('/api/2.1/jobs/'));
  assert.ok(jobCalls.some(([url]) => url === '/api/2.1/jobs/create') && jobCalls.some(([url]) => url === '/api/2.1/jobs/run-now'), 'the demo job is created and run');
  assert.deepEqual([...new Set(jobCalls.map(([, token]) => token))], [APP_TOKEN], 'the demo job is started as the App, never with a person’s token');
});
