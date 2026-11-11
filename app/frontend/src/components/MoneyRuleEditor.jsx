import { useEffect, useState } from 'react';
import { draftOf, ruleOf, ruleSentence } from '../../../agent/agent/app_shell/web/src/moneyRule.js';
import { compileExpression } from '../lib/moneyValue.js';
import { PlainMessage } from './TechnicalDetails.jsx';

const ISO = /^[A-Z]{3}$/;
const COLUMN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const EMPTY_PICK = { method: '', amount: '', column: '', expression: '', currencyBy: 'code', code: '', currencyColumn: '' };
const METHODS = [
  { id: 'fixed', label: 'A fixed amount for each record', hint: 'Every record is worth the same amount, for example each lost booking costs 120.' },
  { id: 'column', label: 'A value from a data column', hint: 'The column already holds the amount each record is worth.' },
  { id: 'equation', label: 'An equation over columns', hint: 'Work the value out from columns, for example quantity * unit_price - discount.' },
];
const DIRECTIONS = [
  { id: 'losses', label: 'Losses only', hint: 'A loss counts, a gain counts as zero.' },
  { id: 'net', label: 'Losses and gains, netted', hint: 'Gains and losses cancel out inside each total.' },
];
const SOURCE_TEXT = { today: 'today’s rate', average: 'saved average', typed: 'typed in', base: 'reporting currency', missing: 'no rate yet, type it in' };

function pickOf(value) {
  if (!value || !METHODS.some((m) => m.id === value.method)) return { ...EMPTY_PICK };
  return {
    method: value.method, amount: value.amount == null ? '' : String(value.amount), column: value.column || '', expression: value.expression || '',
    currencyBy: value.currency_column !== undefined ? 'column' : 'code', code: value.currency || '', currencyColumn: value.currency_column || '',
  };
}

function valueOf(pick) {
  if (!pick.method) return { value: null, problems: [] };
  const problems = [];
  const currency = pick.currencyBy === 'column' ? { currency_column: pick.currencyColumn.trim() } : { currency: pick.code.trim().toUpperCase() };
  if (pick.currencyBy === 'column' && !COLUMN.test(pick.currencyColumn.trim())) problems.push('Pick the column that holds the currency of each record.');
  if (pick.currencyBy !== 'column' && !ISO.test(currency.currency)) problems.push('The value currency is a three-letter code such as USD.');
  if (pick.method === 'fixed') {
    const amount = Number(pick.amount);
    if (!(amount > 0)) problems.push('A fixed value is a positive amount for each record, such as 120.');
    return { value: { method: 'fixed', amount, ...currency }, problems };
  }
  if (pick.method === 'column') {
    if (!COLUMN.test(pick.column)) problems.push('Pick the column that holds the amount of each record.');
    return { value: { method: 'column', column: pick.column, ...currency }, problems };
  }
  const compiled = compileExpression(pick.expression);
  if (compiled.problem) problems.push(compiled.problem);
  return { value: { method: 'equation', expression: pick.expression.trim(), ...currency }, problems };
}

const shownAmount = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

export function MoneyRuleEditor({ value, onChange, sample = null, table = '', columns = [], api = {} }) {
  const [draft, setDraft] = useState(() => ({ ...draftOf({ currency: 'convert', base: value?.base || '', rates: value?.rates || {} }), mode: 'convert', rateSource: 'typed' }));
  const [pick, setPick] = useState(() => pickOf(value?.value));
  const [problems, setProblems] = useState([]);
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState(null);
  const hasCurrencyColumn = Boolean(sample?.currency);

  const save = (nextDraft, nextPick) => {
    const { rule, problems: found } = ruleOf(nextDraft);
    const picked = valueOf(nextPick);
    const all = [...found, ...picked.problems];
    setProblems(all);
    if (!all.length && rule) onChange(picked.value ? { ...rule, value: picked.value } : rule);
  };
  const setDraftPart = (patch) => { const next = { ...draft, ...patch }; setDraft(next); save(next, pick); };
  const setPickPart = (patch) => { const next = { ...pick, ...patch }; setPick(next); save(draft, next); };
  const setRate = (i, patch) => setDraftPart({ rates: draft.rates.map((row, at) => (at === i ? { ...row, ...patch, source: 'typed' } : row)) });

  const loadRates = (asked) => {
    if (!table || !hasCurrencyColumn || !api.currencies) return;
    api.currencies({ table, currency_column: sample.currency, base: asked }).then((data) => {
      const rates = data.rates || {};
      const sources = data.sources || {};
      const rows = [{ code: data.base, rate: '1', source: 'base' }, ...(data.currencies || []).filter((c) => c.code !== data.base).map((c) => ({
        code: c.code, rate: rates[c.code] !== undefined ? String(rates[c.code]) : '', source: sources[c.code] || 'missing',
      }))];
      const next = { ...draft, mode: 'convert', base: data.base, rates: rows };
      setDraft(next);
      setNotice(data.offline || data.message ? (data.message || '') : '');
      save(next, pick);
    }).catch((err) => setNotice(err?.message || 'The rates could not be read; type them in.'));
  };

  useEffect(() => {
    loadRates('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, sample?.currency]);

  const { value: picked, problems: pickProblems } = valueOf(pick);
  const previewKey = JSON.stringify(pickProblems.length ? null : picked);
  useEffect(() => {
    if (!picked || pickProblems.length || !table || !api.preview) { setPreview(null); return undefined; }
    let live = true;
    api.preview({ table, value: picked }).then((data) => { if (live) setPreview({ rows: data.rows || [] }); })
      .catch((err) => { if (live) setPreview({ error: err?.message || 'The example rows could not be read.' }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, table]);

  const shown = ruleOf(draft).rule;
  const sentence = shown ? ruleSentence(shown) : '';

  return (
    <div className="space-y-4" data-money-rule-editor>
      <fieldset className="space-y-2" data-measure-value>
        <legend className="text-[13px] font-semibold text-text-primary">How does your business measure the value of each record?</legend>
        {METHODS.map((m) => (
          <label key={m.id} className="flex items-start gap-2 cursor-pointer" data-measure-method={m.id}>
            <input type="radio" name="measure-method" className="mt-1" checked={pick.method === m.id} onChange={() => setPickPart({ method: m.id })} data-money-method={m.id} />
            <span className="text-[12px]"><span className="font-medium text-text-primary">{m.label}</span><span className="block text-text-secondary">{m.hint}</span></span>
          </label>
        ))}
      </fieldset>

      {pick.method === 'fixed' && (
        <label className="block text-[12px]">Amount for each record
          <input dir="auto" className="block mt-1 w-40" value={pick.amount} onChange={(e) => setPickPart({ amount: e.target.value })} data-money-fixed-amount />
        </label>
      )}
      {pick.method === 'column' && (
        <label className="block text-[12px]">Column with the amount
          <select className="block mt-1" value={pick.column} onChange={(e) => setPickPart({ column: e.target.value })} data-money-value-column>
            <option value="">Pick a column</option>
            {columns.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      )}
      {pick.method === 'equation' && (
        <label className="block text-[12px]">Equation over columns
          <input dir="auto" className="block mt-1 w-full" list="money-equation-columns" value={pick.expression} placeholder="quantity * unit_price - discount"
            onChange={(e) => setPickPart({ expression: e.target.value })} data-money-equation />
          <datalist id="money-equation-columns">{columns.map((name) => <option key={name} value={name} />)}</datalist>
        </label>
      )}

      {pick.method && (
        <div className="space-y-2 text-[12px]" data-money-value-currency>
          <p className="font-medium text-text-primary">Currency of those values</p>
          {hasCurrencyColumn && (
            <label className="flex items-center gap-2"><input type="radio" name="value-currency-by" checked={pick.currencyBy === 'column'} onChange={() => setPickPart({ currencyBy: 'column', currencyColumn: pick.currencyColumn || sample.currency })} data-money-value-currency-by="column" /> Each record has its own currency column</label>
          )}
          <label className="flex items-center gap-2"><input type="radio" name="value-currency-by" checked={pick.currencyBy !== 'column'} onChange={() => setPickPart({ currencyBy: 'code' })} data-money-value-currency-by="code" /> One currency for all records</label>
          {pick.currencyBy === 'column' && <label>Currency column <input className="ms-2" value={pick.currencyColumn} onChange={(e) => setPickPart({ currencyColumn: e.target.value })} data-money-value-currency-column /></label>}
          {pick.currencyBy !== 'column' && <label>Currency code <input className="ms-2 w-24" value={pick.code} onChange={(e) => setPickPart({ code: e.target.value })} data-money-value-code /></label>}
        </div>
      )}

      {pick.method && !pickProblems.length && (
        <div className="space-y-1 text-[12px]" data-money-value-preview>
          <p className="font-semibold text-text-primary">Value of three example rows</p>
          {preview?.error && <PlainMessage text={preview.error} className="text-[12px] text-danger" />}
          {preview?.rows && <ol className="list-decimal ps-5" data-money-preview-rows>{preview.rows.map((row, i) => <li key={i}>{`${shownAmount(row.stake)} ${row.currency}`}</li>)}</ol>}
          {!preview && <p className="text-text-secondary">Reading the rows</p>}
        </div>
      )}

      <fieldset className="space-y-2" data-measure-direction>
        <legend className="text-[13px] font-semibold text-text-primary">Which movement counts?</legend>
        {DIRECTIONS.map((d) => (
          <label key={d.id} className="flex items-start gap-2 cursor-pointer">
            <input type="radio" name="measure-direction" className="mt-1" checked={(draft.rule || 'losses') === d.id} onChange={() => setDraftPart({ rule: d.id })} data-money-rule-kind={d.id} />
            <span className="text-[12px]"><span className="font-medium text-text-primary">{d.label}</span><span className="block text-text-secondary">{d.hint}</span></span>
          </label>
        ))}
      </fieldset>

      <div className="space-y-2" data-money-convert>
        <p className="text-[13px] font-semibold text-text-primary">Report every amount in one currency</p>
        <label className="block text-[12px]">Reporting currency
          <input dir="auto" className="block mt-1 w-28" list="money-currency-codes" value={draft.base} placeholder={hasCurrencyColumn ? '' : 'USD'}
            onChange={(e) => setDraftPart({ base: e.target.value.toUpperCase() })} onBlur={(e) => { if (ISO.test(e.target.value.trim().toUpperCase())) loadRates(e.target.value.trim().toUpperCase()); }} data-money-base />
          <datalist id="money-currency-codes">{(draft.rates || []).map((row) => <option key={row.code} value={row.code} />)}</datalist>
        </label>
        {notice && <p className="text-[12px] text-text-secondary" data-money-rates-notice>{notice}</p>}
        {!hasCurrencyColumn && <p className="text-[12px] text-text-secondary">The table has no currency column, so every amount is taken as the reporting currency.</p>}
        {draft.rates.length > 0 && (
          <table className="text-[12px]" data-money-rates>
            <thead><tr><th className="text-start pe-4">Currency</th><th className="text-start pe-4">1 unit is worth, in {draft.base || 'the reporting currency'}</th><th className="text-start">Source</th></tr></thead>
            <tbody>
              {draft.rates.map((row, i) => (
                <tr key={row.code || i} data-money-rate-row={row.code}>
                  <td className="pe-4" data-money-rate-code>{row.code}</td>
                  <td className="pe-4"><input dir="auto" className="w-32" aria-label={`Rate for ${row.code}`} value={row.rate} onChange={(e) => setRate(i, { rate: e.target.value })} data-money-rate /></td>
                  <td className="text-text-secondary" data-money-rate-source={row.source}>{SOURCE_TEXT[row.source] || row.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <details className="text-[12px]" data-money-more>
        <summary className="cursor-pointer text-text-secondary">More options</summary>
        <div className="space-y-2 pt-2">
          <label className="block">Closed periods to total (empty for every closed period)
            <input className="block mt-1 w-24" value={draft.window} onChange={(e) => setDraftPart({ window: e.target.value })} data-money-window />
          </label>
          <label className="block">Statuses that count, comma-separated (empty for all)
            <input className="block mt-1 w-full" value={draft.statuses} onChange={(e) => setDraftPart({ statuses: e.target.value })} data-money-statuses />
          </label>
          {draft.statuses.trim() && (
            <label className="block">Status column
              <input className="block mt-1 w-40" value={draft.statusColumn} onChange={(e) => setDraftPart({ statusColumn: e.target.value })} data-money-status-column />
            </label>
          )}
          <label className="flex items-center gap-2"><input type="checkbox" checked={draft.off} onChange={(e) => setDraftPart({ off: e.target.checked })} data-money-off /> Off: show no money total, chart or Genie money answer</label>
        </div>
      </details>

      {sentence && <p className="text-[12px] text-text-primary bg-bg border border-border rounded-md p-3" data-money-sentence>{sentence}</p>}
      {problems.length > 0 && <PlainMessage text={problems.join(' ')} className="text-[12px] text-danger" data-money-error />}
    </div>
  );
}
