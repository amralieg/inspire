import { useCallback, useMemo, useState } from 'react';
import { refineReason, refineScores, ratioText, withRefinedScores } from './scoreRefine.js';
import { compareMeetsQualityBarFirst, nameOfUseCase, trackingIdOf } from './useCaseFields.js';
import { compareBestOfBestFirst } from './v130UseCase.js';

// REQ-433: the refine banner state for the Review page: the suggestions, Apply, Undo and Keep. Keep holds until a value changes.
const keepKey = (host, db, sid) => `inspire.refine.keep.v1|${host || ''}|${db || ''}|${sid || ''}`;
const readKeep = (key) => { try { return globalThis.localStorage?.getItem(key) || ''; } catch { return ''; } };
const writeKeep = (key, v) => { try { globalThis.localStorage?.setItem(key, v); } catch { /* storage unavailable: Keep lasts for this view */ } };

// The tier key of each use case in the default Results order: use cases the quality-bar and Best of Best comparisons cannot tell apart share a key.
export function tiersOf(list) {
  const heads = [];
  return list.map((uc) => {
    let head = heads.find((h) => compareMeetsQualityBarFirst(h, uc) === 0 && compareBestOfBestFirst(h._v130, uc._v130) === 0);
    if (!head) { head = uc; heads.push(uc); }
    return heads.indexOf(head);
  });
}

export function useScoreRefine({ useCases, yearlyOf, apiPostJson, host, inspireDatabase, warehouseId, sessionId }) {
  const [refined, setRefined] = useState({});
  const [applied, setApplied] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = keepKey(host, inspireDatabase, sessionId);
  const [kept, setKept] = useState(() => readKeep(key));
  const list = useMemo(() => withRefinedScores(useCases, refined, trackingIdOf), [useCases, refined]);
  const tiers = useMemo(() => tiersOf(list), [list]);
  const items = useMemo(() => list.map((uc, i) => ({ id: trackingIdOf(uc), tier: tiers[i], name: nameOfUseCase(uc), score: uc.inspire_score ?? null, entries: yearlyOf(trackingIdOf(uc))?.entries || null }))
    .filter((it) => it.id && it.score != null && it.score !== '').map((it) => ({ ...it, score: Number(it.score) })), [list, tiers, yearlyOf]);
  const found = useMemo(() => refineScores(items), [items]);
  const signature = useMemo(() => JSON.stringify(found.pairs.map((p) => [p.lower.id, p.higher.id, p.lowerAmount, p.higherAmount, p.lower.start])), [found]);
  const body = (extra) => ({ inspire_database: inspireDatabase, warehouse_id: warehouseId, session_id: String(sessionId), ...extra });

  const apply = useCallback(async () => {
    setBusy(true); setError('');
    const changes = found.changes.map((c) => {
      const pair = found.pairs.find((p) => p.lower.id === c.id);
      return { use_case_id: c.id, score: c.to, from: c.from, reason: pair ? refineReason(pair, ratioText(pair.ratio)) : 'Refined so the order follows the value.' };
    });
    try {
      await apiPostJson('/api/inspire/score-refine', body({ changes }));
      setRefined((prev) => ({ ...prev, ...Object.fromEntries(found.changes.map((c) => [c.id, { from: c.from, to: c.to }])) }));
      setApplied({ changes: found.changes, pairs: found.pairs, names: Object.fromEntries(items.map((it) => [it.id, it.name])) });
    } catch (err) {
      setError(err?.message || 'The scores could not be refined.');
    } finally {
      setBusy(false);
    }
  }, [found, items, apiPostJson, inspireDatabase, warehouseId, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const undo = useCallback(async () => {
    if (!applied) return;
    setBusy(true); setError('');
    try {
      await apiPostJson('/api/inspire/score-refine/undo', body({ use_case_ids: applied.changes.map((c) => c.id) }));
      setRefined((prev) => ({ ...prev, ...Object.fromEntries(applied.changes.map((c) => [c.id, { from: c.from, to: c.from, undone: true }])) }));
      setApplied(null);
    } catch (err) {
      setError(err?.message || 'The scores could not be restored.');
    } finally {
      setBusy(false);
    }
  }, [applied, apiPostJson, inspireDatabase, warehouseId, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // After a reload the banner is gone but the stored score still reads "Refined from X": the card restores it from the stored history.
  const undoCard = useCallback(async (id) => {
    const from = Number(list.find((uc) => trackingIdOf(uc) === id)?.refined_from);
    if (!id || !Number.isFinite(from)) return;
    setBusy(true); setError('');
    try {
      await apiPostJson('/api/inspire/score-refine/undo', body({ use_case_ids: [id] }));
      setRefined((prev) => ({ ...prev, [id]: { from, to: from, undone: true } }));
      setApplied((prev) => (prev ? { ...prev, changes: prev.changes.filter((c) => c.id !== id) } : prev));
    } catch (err) {
      setError(err?.message || 'The scores could not be restored.');
    } finally {
      setBusy(false);
    }
  }, [list, apiPostJson, inspireDatabase, warehouseId, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const keep = useCallback(() => { writeKeep(key, signature); setKept(signature); }, [key, signature]);
  const view = applied ? { applied: true, ...applied }
    : (found.changes.length && kept !== signature ? { applied: false, pairs: found.pairs, changes: found.changes, names: {} } : null);
  return { list, undoCard, banner: { view, busy, error, onApply: apply, onUndo: undo, onKeep: keep } };
}
