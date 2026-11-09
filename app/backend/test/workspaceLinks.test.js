const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const libUrl = pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'workspaceLinks.js')).href;
const load = () => import(libUrl);

test('a notebook link opens the workspace path on the host, adding /Workspace and https only where they are missing', async () => {
  const { workspaceNotebookUrl } = await load();
  assert.equal(workspaceNotebookUrl('https://w.example.com/', '/Users/a@x/inspire/n01'), 'https://w.example.com/#workspace/Workspace/Users/a@x/inspire/n01');
  assert.equal(workspaceNotebookUrl('w.example.com', '/Workspace/Shared/n01'), 'https://w.example.com/#workspace/Workspace/Shared/n01');
  assert.equal(workspaceNotebookUrl('http://w.example.com', '/Shared/../demos/./n01'), 'https://w.example.com/#workspace/Workspace/demos/n01');
  assert.equal(workspaceNotebookUrl('', '/Shared/n01'), '');
  assert.equal(workspaceNotebookUrl('https://w.example.com', ''), '');
  assert.equal(workspaceNotebookUrl('https://w.example.com', null), '');
});

test('a job link opens the job on the host with https, and only a numeric job id makes one', async () => {
  const { workspaceJobUrl } = await load();
  assert.equal(workspaceJobUrl('https://w.example.com/', 42), 'https://w.example.com/#job/42');
  assert.equal(workspaceJobUrl('w.example.com', ' 7 '), 'https://w.example.com/#job/7');
  assert.equal(workspaceJobUrl('http://w.example.com', '9'), 'https://w.example.com/#job/9');
  for (const bad of ['', null, undefined, 'abc', '12a', '-3', '1.5', '../1']) assert.equal(workspaceJobUrl('https://w.example.com', bad), '', String(bad));
  assert.equal(workspaceJobUrl('', 42), '');
});

test('an MVP saved under /Shared warns that everyone can edit it, and no other folder does', async () => {
  const { sharedFolderWarning, generationFolder } = await load();
  const said = sharedFolderWarning('/Workspace/Shared/demos/acme');
  assert.equal(said, 'Inspire saves this MVP in /Workspace/Shared/demos/acme_implemented, a shared folder: anyone in the workspace can change or delete it, '
    + 'and each person sees its data only with their own access. To keep it to yourself, run Discover again and save it under your own user folder.');
  assert.doesNotMatch(said, /republish|generation path/i);
  assert.match(sharedFolderWarning('/Shared/demos/acme/'), /in \/Workspace\/Shared\/demos\/acme_implemented,/);
  assert.match(sharedFolderWarning(generationFolder({ generationPath: 'out', notebookPath: '/Shared/inspire-ai/dbx_inspire_ai_agent', businessName: 'Acme' })),
    /in \/Workspace\/Shared\/inspire-ai\/out\/acme_implemented/, 'a relative path resolved beside the agent notebook under /Shared also warns');
  for (const quiet of ['/Workspace/Users/a@x/out/acme', '/Users/a@x/out', '/Volumes/c/s/v/out', '/Workspace/SharedTeam/out', '/Shared/../Users/a@x/out',
    './../demos/acme', '', null, undefined]) {
    assert.equal(sharedFolderWarning(quiet), '', String(quiet));
  }
});

test('a session folder resolves a relative generation path from the agent notebook folder and adds the business folder', async () => {
  const { generationFolder } = await load();
  const nb = '/Shared/inspire-ai/dbx_inspire_ai_agent';
  assert.equal(generationFolder({ generationPath: './../demos/', notebookPath: nb, businessName: 'TPCDS Retail V130 Ship' }),
    '/Workspace/Shared/demos/tpcds_retail_v130_ship');
  assert.equal(generationFolder({ generationPath: 'out', notebookPath: `/Workspace${nb}`, businessName: 'Acme' }), '/Workspace/Shared/inspire-ai/out/acme');
  assert.equal(generationFolder({ generationPath: '/Workspace/Users/a@x/out/', notebookPath: nb, businessName: 'Acme Co.' }), '/Workspace/Users/a@x/out/acme_co');
  assert.equal(generationFolder({ generationPath: '/Volumes/c/s/v/out', notebookPath: nb, businessName: 'Acme' }), '/Volumes/c/s/v/out/acme');
  assert.equal(generationFolder({ generationPath: '/tmp/out', notebookPath: '', businessName: '' }), '/tmp/out');
  assert.equal(generationFolder({ generationPath: './../demos/', notebookPath: '', businessName: 'Acme' }), './../demos/acme', 'without the agent notebook path the folder stays relative');
  assert.equal(generationFolder({ generationPath: '', notebookPath: nb, businessName: 'Acme' }), '');
  assert.equal(generationFolder({ generationPath: '/tmp/out', notebookPath: nb, businessName: '!!!' }), '/tmp/out/_');
});

test('volume paths are kept as they are and blank paths stay blank', async () => {
  const { normalizeDatabricksFsPath, workspaceWebUiHashPath } = await load();
  assert.equal(workspaceWebUiHashPath('/Volumes/c/s/v/x/'), '/Volumes/c/s/v/x');
  assert.equal(normalizeDatabricksFsPath('  //Shared//a/../b  '), '/Shared/b');
  assert.equal(normalizeDatabricksFsPath('relative/path'), 'relative/path');
  assert.equal(normalizeDatabricksFsPath(42), '');
  assert.equal(workspaceWebUiHashPath(''), '');
});
