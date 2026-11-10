import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getListed } from '../src/api.js';
import { CODES } from '../src/records.js';

const WINDOWED = { page: 'n01_u05', window: 'today', time_zone: 'Asia/Dubai', filters: {}, offset: 0, limit: 5 };
const PLAIN = { page: 'n01_u05', filters: {}, offset: 0, limit: 5 };

function answer(replies) {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push(JSON.parse(init.body));
    const { status = 200, body } = replies.shift();
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { sent, restore: () => { globalThis.fetch = realFetch; } };
}

const refused = { status: 409, body: { error: 'this decision list keeps no actions, so it has no window of actions to show', code: CODES.noWindow } };
const listed = (actions) => ({ status: 200, body: { rows: [], total: 4, offset: 0, limit: 5, actions, changes: false, summary: null, errors: {} } });

test('a windowed list that answers is returned as windowed, sent once', async () => {
  const net = answer([listed(true)]);
  try {
    const out = await getListed(WINDOWED, PLAIN);
    assert.equal(out.unwindowed, false);
    assert.equal(out.data.total, 4);
    assert.deepEqual(net.sent, [WINDOWED]);
  } finally { net.restore(); }
});

test('a refused window falls back to the whole list and says so, so its count still shows', async () => {
  const net = answer([refused, listed(false)]);
  try {
    const out = await getListed(WINDOWED, PLAIN);
    assert.equal(out.unwindowed, true);
    assert.equal(out.data.total, 4);
    assert.deepEqual(net.sent, [WINDOWED, PLAIN]);
  } finally { net.restore(); }
});

test('a refused window with no plain list to fall back to rejects with the refusal', async () => {
  const net = answer([refused]);
  try {
    await assert.rejects(getListed(WINDOWED, null), (err) => err.code === CODES.noWindow);
    assert.deepEqual(net.sent, [WINDOWED]);
  } finally { net.restore(); }
});

test('a plain list that still keeps actions does not hide the refusal', async () => {
  const net = answer([refused, listed(true)]);
  try {
    await assert.rejects(getListed(WINDOWED, PLAIN), (err) => err.code === CODES.noWindow);
  } finally { net.restore(); }
});

test('an error other than a refused window is not retried as a plain list', async () => {
  const net = answer([{ status: 500, body: { error: 'the App broke' } }]);
  try {
    await assert.rejects(getListed(WINDOWED, PLAIN), (err) => err.message === 'the App broke');
    assert.equal(net.sent.length, 1);
  } finally { net.restore(); }
});
