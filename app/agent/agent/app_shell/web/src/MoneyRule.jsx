import { useEffect, useState } from 'react';
import { getSettings, previewMoneyRule, saveMoneyRule } from './api.js';
import { draftOf, previewLines, ruleOf, ruleSentence } from './moneyRule.js';
import { PlainNote } from './ui.jsx';

const LEFT_OUT = 'Rows without a date and rows from the running month are left out of every money total, and each total says how many.';

export function MoneyRule({ pageId }) {
  const [view, setView] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    let live = true;
    getSettings(pageId)
      .then((data) => { if (live && data?.money) { setView(data.money); setDraft(draftOf(data.money.rule)); } })
      .catch((err) => { if (live) setError(err.message); });
    return () => { live = false; };
  }, [pageId]);

  if (!view || !draft) return null;
  const shown = ruleOf(draft).rule;
  const set = (patch) => setDraft({ ...draft, ...patch });
  const setRate = (i, patch) => set({ rates: draft.rates.map((row, at) => (at === i ? { ...row, ...patch } : row)) });

  const look = async () => {
    const { rule, problems } = ruleOf(draft);
    if (problems.length) { setError(problems.join(' ')); return; }
    setError('');
    try {
      setPreview(await previewMoneyRule({ page: pageId, rule }));
    } catch (err) {
      setError(err.message);
    }
  };

  const save = async () => {
    const { rule, problems } = ruleOf(draft);
    if (problems.length) { setError(problems.join(' ')); return; }
    setBusy(true);
    setError('');
    try {
      const data = await saveMoneyRule({ page: pageId, rule });
      setView(data.money);
      setDraft(draftOf(data.money.rule));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="money-rule" data-money-rule>
      <h3>How money at stake is totalled</h3>
      <p data-money-sentence>{ruleSentence(shown)} {view.saved ? 'Saved by an owner.' : 'Set by the App design; no owner has saved a change.'}</p>
      <fieldset>
        <label><input type="radio" name="money-mode" value="per_currency" checked={draft.mode === 'per_currency'} onChange={() => set({ mode: 'per_currency' })} data-money-mode="per_currency" /> Per currency: one total for each currency</label>
        <label><input type="radio" name="money-mode" value="convert" checked={draft.mode === 'convert'} onChange={() => set({ mode: 'convert', rates: draft.rates.length ? draft.rates : [{ code: '', rate: '' }] })} data-money-mode="convert" /> Convert to one currency at rates I type in</label>
      </fieldset>
      {draft.mode === 'convert' && (
        <div data-money-convert>
          <label>Base currency <input value={draft.base} onChange={(e) => set({ base: e.target.value })} data-money-base /></label>
          {draft.rates.map((row, i) => (
            <div key={i} className="money-rate-row">
              <input aria-label="Currency code" value={row.code} onChange={(e) => setRate(i, { code: e.target.value })} data-money-rate-code />
              <input aria-label="Rate in base currency" value={row.rate} onChange={(e) => setRate(i, { rate: e.target.value })} data-money-rate />
              <button type="button" className="lnk" onClick={() => set({ rates: draft.rates.filter((_, at) => at !== i) })}>Remove</button>
            </div>
          ))}
          <button type="button" className="lnk" onClick={() => set({ rates: [...draft.rates, { code: '', rate: '' }] })} data-money-add-rate>Add a rate</button>
        </div>
      )}
      <p className="muted">{LEFT_OUT}</p>
      {error && <PlainNote text={error} role="alert" data-money-error />}
      <button type="button" className="lnk" onClick={look} data-money-preview-button>Preview this rule</button>
      {preview && (() => {
        const lines = previewLines(preview);
        return (
          <div data-money-preview>
            <p>Totals: {lines.totals.join(' · ') || 'no rows'}</p>
            {lines.top.length > 0 && <ol>{lines.top.map((t) => <li key={t}>{t}</li>)}</ol>}
            {lines.leftOut && <p className="muted">{lines.leftOut}</p>}
          </div>
        );
      })()}
      <button type="button" className="btn" onClick={save} disabled={busy} data-money-save>Save the money rule</button>
    </section>
  );
}
