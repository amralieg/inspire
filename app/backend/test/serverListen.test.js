const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { fakeWorkspace, startInspire } = require('./support/serverProcess');

test('Inspire stops with exit code 1 and one plain message when its port is taken, and never says it is running', async () => {
  const holder = net.createServer();
  await new Promise((resolve) => holder.listen(0, resolve));
  const { port } = holder.address();
  const workspace = await fakeWorkspace(() => null);
  try {
    await assert.rejects(startInspire({ DATABRICKS_HOST: workspace.url, PORT: String(port) }, { readyMs: 30000 }), (err) => {
      assert.match(err.message, /^server\.js exited with 1:/);
      assert.match(err.message, new RegExp(`Inspire AI cannot listen on port ${port}: .*EADDRINUSE`));
      assert.doesNotMatch(err.message, /Inspire AI running/);
      return true;
    });
  } finally {
    await workspace.close();
    await new Promise((resolve) => holder.close(resolve));
  }
});

test('on PORT 0 Inspire names the port it really listens on, and that port answers', async () => {
  const workspace = await fakeWorkspace(() => null);
  let inspire = null;
  try {
    inspire = await startInspire({ DATABRICKS_HOST: workspace.url });
    const { port } = new URL(inspire.url);
    assert.ok(Number(port) > 0, inspire.url);
    assert.match(inspire.output(), new RegExp(`Inspire AI running on http://localhost:${port}\\n`));
    assert.equal((await fetch(`${inspire.url}/api/health`)).status, 200);
  } finally {
    if (inspire) await inspire.stop();
    await workspace.close();
  }
});
