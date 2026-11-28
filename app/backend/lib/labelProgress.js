// c39 (REQ-585 item 9): the labelling progress of a launch, kept in memory per session id so the wizard can show "n of N tables".
//   GET /api/inspire/labels/progress?session_id=  ->  { session_id, done, total, state: 'labelling' | 'done' | 'none' }
// Only the person who launched reads it; anyone else, or an unknown session, gets 0 of 0 'none'. A finished entry is dropped KEEP_MS later.
const RP = require('./routePolicy');

const KEEP_MS = 10 * 60 * 1000;

function createLabelProgress(now = () => Date.now()) {
  const entries = new Map();
  const prune = () => {
    for (const [id, e] of entries) if (e.finishedAt && now() - e.finishedAt > KEEP_MS) entries.delete(id);
  };
  return {
    begin(sessionId, owner) { prune(); entries.set(String(sessionId), { owner: String(owner || '').toLowerCase(), done: 0, total: 0, finishedAt: 0 }); },
    update(sessionId, { done, total }) {
      const e = entries.get(String(sessionId));
      if (e && !e.finishedAt) { e.done = Number(done) || 0; e.total = Number(total) || 0; }
    },
    finish(sessionId) { const e = entries.get(String(sessionId)); if (e) e.finishedAt = now(); },
    read(sessionId, owner) {
      prune();
      const e = entries.get(String(sessionId));
      if (!e || !e.owner || e.owner !== String(owner || '').toLowerCase()) return { done: 0, total: 0, state: 'none' };
      return { done: e.done, total: e.total, state: e.finishedAt ? 'done' : 'labelling' };
    },
  };
}

function registerLabelProgressRoute(app, { requireToken, progress }) {
  app.get('/api/inspire/labels/progress', requireToken, (req, res) => {
    const sessionId = String((req.query && req.query.session_id) || '').trim();
    if (!/^\d+$/.test(sessionId)) return res.status(400).json({ error: 'session_id is required.' });
    return res.json({ session_id: sessionId, ...progress.read(sessionId, RP.forwardedPerson(req.headers || {})) });
  });
}

module.exports = { createLabelProgress, registerLabelProgressRoute };
