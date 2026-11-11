import { useEffect, useState } from 'react';
import { draftOf, formulaLine, ruleOf, ruleSentence, workedExample } from '../../../agent/agent/app_shell/web/src/moneyRule.js';
import { MoneyRuleFields } from '../../../agent/agent/app_shell/web/src/MoneyRuleFields.jsx';
import { PlainMessage } from './TechnicalDetails.jsx';

const DEFAULT_RULE = { currency: 'per_currency' };
const sameRule = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function MoneyRuleEditor({ value, onChange, sample = null, table = '', loadRates = null }) {
  const [rates, setRates] = useState([]);
  const [draft, setDraft] = useState(() => draftOf(value || DEFAULT_RULE));
  const [problems, setProblems] = useState([]);
  const set = (patch) => {
    const next = { ...draft, ...patch };
    const { rule, problems: found } = ruleOf(next);
    setDraft(next);
    setProblems(found);
    if (!found.length) onChange(sameRule(rule, DEFAULT_RULE) ? null : rule);
  };
  const setRate = (i, patch) => set({ rates: draft.rates.map((row, at) => (at === i ? { ...row, ...patch } : row)) });
  const shown = ruleOf(draft).rule || DEFAULT_RULE;
  const body = draft.mode !== 'convert' || !loadRates || !draft.base ? null
    : draft.rateSource === 'table' && draft.rateTable.table ? { rate_table: draft.rateTable, base: draft.base.toUpperCase() }
    : draft.rateSource === 'column' && draft.rateColumn && table && sample?.currency ? { table, currency_column: sample.currency, rate_column: draft.rateColumn }
    : null;
  const bodyKey = JSON.stringify(body);
  useEffect(() => {
    if (!body) { setRates([]); return undefined; }
    let live = true;
    loadRates(body).then((data) => { if (live) setRates(data.rates || []); }).catch(() => { if (live) setRates([]); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyKey]);

  return (
    <div className="space-y-3" data-money-rule-editor>
      <p className="text-[12px] text-text-primary bg-bg border border-border rounded-md p-3" data-money-sentence>{ruleSentence(shown)}</p>
      <p className="text-[12px] text-text-secondary" data-money-formula>{formulaLine(shown)}</p>
      <MoneyRuleFields draft={draft} set={set} setRate={setRate} />
      {sample && workedExample(shown, { ...sample, rates }).length > 0 && (
        <div className="space-y-1 text-[12px]" data-money-example>
          <p className="font-semibold text-text-primary">Worked example on the first rows of the table</p>
          <ol className="list-decimal ps-5">{workedExample(shown, { ...sample, rates }).map((line) => <li key={line}>{line}</li>)}</ol>
        </div>
      )}
      {problems.length > 0 && <PlainMessage text={problems.join(' ')} className="text-[12px] text-danger" data-money-error />}
      <p className="text-[11px] text-text-secondary">Exact totals and the largest rows show in Measurement once the App is built.</p>
    </div>
  );
}
