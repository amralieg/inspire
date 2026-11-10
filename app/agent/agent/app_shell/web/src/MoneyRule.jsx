import { useEffect, useState } from 'react';
import { getSettings, previewMoneyRule, saveMoneyRule } from './api.js';
import { draftOf, formulaLine, previewLines, ruleOf, ruleSentence, workedExample } from './moneyRule.js';
import { PlainNote } from './ui.jsx';
import { BUILD_FIELDS, MoneyRuleFields } from './MoneyRuleFields.jsx';

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
      <h3>How each total is counted</h3>
      <p className="sentence" data-money-sentence>{ruleSentence(shown)} {view.saved ? 'Saved by an owner.' : 'Set by the App design; no owner has saved a change.'}</p>
      <MoneyRuleFields draft={draft} set={set} setRate={setRate} locked={BUILD_FIELDS} />
      <p className="muted" data-money-formula>{formulaLine(shown)}</p>
      <p className="muted">{LEFT_OUT}</p>
      {error && <PlainNote text={error} role="alert" data-money-error />}
      <button type="button" className="lnk" onClick={look} data-money-preview-button>Preview this rule</button>
      {preview && (() => {
        const lines = previewLines(preview);
        const example = workedExample(shown, { amount: 'raw', currency: 'currency', rows: preview.top || [] });
        return (
          <div data-money-preview>
            <p>Totals: {lines.totals.join(' · ') || 'no rows'}</p>
            {example.length > 0 && <p className="muted" data-money-example-title>Worked example, top rows</p>}
            {example.length > 0 && <ol data-money-example>{example.map((t) => <li key={t}>{t}</li>)}</ol>}
            {lines.leftOut && <p className="muted">{lines.leftOut}</p>}
          </div>
        );
      })()}
      <button type="button" className="btn" onClick={save} disabled={busy} data-money-save>Save the money rule</button>
    </section>
  );
}
