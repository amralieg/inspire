import { useEffect, useRef, useState } from 'react';
import { draftOf, ruleOf, ruleSentence } from '../../../agent/agent/app_shell/web/src/moneyRule.js';
import '../../../agent/agent/app_shell/web/src/styles/moneyRule.css';
import { compileExpression } from '../../../agent/agent/app_shell/web/src/moneyValue.js';
import { MONEY_PARTS } from '../lib/moneyParts.js';
import AVERAGES from '../../../backend/lib/fxAverages.json';
import { PlainMessage } from './TechnicalDetails.jsx';

const ISO = /^[A-Z]{3}$/;
const COLUMN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const EMPTY_PICK = { method: '', amount: '', column: '', expression: '', currencyBy: 'code', code: '', currencyColumn: '', text: '', proposal: null, explanation: '', error: '', used: null };
const METHODS = [
  { id: 'fixed', label: 'A fixed amount for each record', hint: 'Every record is worth the same amount, for example each lost booking costs 120.' },
  { id: 'column', label: 'A value from a data column', hint: 'The column already holds the amount each record is worth.' },
  { id: 'equation', label: 'An equation over columns', hint: 'Work the value out from columns, for example quantity * unit_price - discount.' },
  { id: 'describe', label: 'Describe it', hint: 'Write how the value works in your words; the App proposes the rule for you to check.' },
];
const DIRECTIONS = [
  { id: 'losses', label: 'Losses only', hint: 'A loss counts, a gain counts as zero.' },
  { id: 'gains', label: 'Gains only', hint: 'Needs a sign below: only the gain records count.' },
  { id: 'net', label: 'Losses and gains, netted', hint: 'Gains and losses cancel out inside each total.' },
];
const SOURCE_TEXT = { today: 'today’s rate', average: `ECB average, ${AVERAGES.period.from.slice(0, 4)}`, typed: 'typed in', base: 'reporting currency', missing: 'no rate yet, type it in' };

function pickOf(value) {
  if (!value || !['fixed', 'column', 'equation'].includes(value.method)) return { ...EMPTY_PICK };
  return {
    ...EMPTY_PICK, method: value.method, amount: value.amount == null ? '' : String(value.amount), column: value.column || '', expression: value.expression || '',
    currencyBy: value.currency_column !== undefined ? 'column' : 'code', code: value.currency || '', currencyColumn: value.currency_column || '',
  };
}

function effectiveOf(pick) {
  return pick.method === 'describe' ? (pick.used || { ...EMPTY_PICK }) : pick;
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

function columnsOf(value) {
  if (value.method === 'column') return [value.column, value.currency_column].filter(Boolean);
  if (value.method === 'equation') return [...compileExpression(value.expression).columns || [], value.currency_column].filter(Boolean);
  return [value.currency_column].filter(Boolean);
}

function ruleTextOf(value) {
  if (!value) return '';
  const where = value.currency_column !== undefined ? `in the currency of ${value.currency_column}` : `in ${value.currency}`;
  if (value.method === 'fixed') return `${value.amount} ${where}, for each record`;
  if (value.method === 'column') return `the amount in ${value.column}, ${where}`;
  return `${value.expression}, ${where}`;
}

const shownAmount = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

export function MoneyRuleEditor({ value, onChange, sample = null, table = '', columns = [], api = {}, part = null }) {
  const onlyPart = MONEY_PARTS.includes(part) ? part : null;
  const show = (name) => !onlyPart || onlyPart === name;
  const [draft, setDraft] = useState(() => ({ ...draftOf({ ...(value || {}), currency: 'convert', base: value?.base || '', rates: value?.rates || {} }), mode: 'convert', rateSource: 'typed' }));
  const [pick, setPick] = useState(() => ({ ...pickOf(value?.value) }));
  const [signPick, setSignPick] = useState(() => ({ kind: value?.sign?.kind || '', column: value?.sign?.column || '', value: value?.sign?.value || '', losses: (value?.sign?.losses || []).join(', ') }));
  const [problems, setProblems] = useState([]);
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState(null);
  const [proposalRows, setProposalRows] = useState(null);
  const hasCurrencyColumn = Boolean(sample?.currency);
  const effective = effectiveOf(pick);

  const save = (nextDraft, nextPick) => {
    const { rule, problems: found } = ruleOf(nextDraft);
    const picked = valueOf(effectiveOf(nextPick));
    const gone = picked.value && columns.length ? columnsOf(picked.value).filter((name) => !columns.includes(name)) : [];
    const all = [...found, ...picked.problems, ...gone.map((name) => `The column ${name} is not in this table, so the rule cannot use it.`)];
    setProblems(all);
    if (!all.length && rule) onChange(picked.value ? { ...rule, value: picked.value } : rule);
  };
  const pickSign = (patch) => {
    const next = { ...signPick, ...patch };
    setSignPick(next);
    const column = next.column.trim();
    const ready = COLUMN.test(column) && (next.kind === 'column' || (next.kind === 'status' && next.value.trim() !== ''));
    const losses = next.losses.split(',').map((v) => v.trim()).filter(Boolean);
    setDraftPart({ sign: !ready ? null : next.kind === 'column' ? { kind: 'column', column } : { kind: 'status', column, value: next.value.trim(), losses } });
  };
  const setDraftPart = (patch) => { const next = { ...draft, ...patch }; setDraft(next); save(next, pick); };
  const setPickPart = (patch) => { const next = { ...pick, ...patch }; setPick(next); save(draft, next); };
  const setRate = (i, patch) => setDraftPart({ rates: draft.rates.map((row, at) => (at === i ? { ...row, ...patch, source: 'typed' } : row)) });

  const latest = useRef({ draft, pick });
  latest.current = { draft, pick };
  const ratesRequest = useRef(0);
  const proposalRequest = useRef(0);

  const shownBase = useRef(value?.base || '');
  const mergedRates = (current, data) => {
    const rates = data.rates || {};
    const sources = data.sources || {};
    const fresh = [{ code: data.base, rate: '1', source: 'base' }, ...(data.currencies || []).filter((c) => c.code !== data.base).map((c) => ({
      code: c.code, rate: rates[c.code] !== undefined ? String(rates[c.code]) : '', source: sources[c.code] || 'missing',
    }))];
    const baseChanged = data.base !== shownBase.current;
    const typedRows = (current.rates || []).filter((row) => row.source === 'typed');
    const dropped = typedRows.filter((row) => baseChanged || row.code === data.base).map((row) => row.code);
    const kept = new Map(typedRows.filter((row) => !baseChanged && row.code !== data.base).map((row) => [row.code, row]));
    return { rows: fresh.map((row) => (kept.has(row.code) ? kept.get(row.code) : row)), dropped };
  };

  const loadRates = (asked) => {
    if (!table || !hasCurrencyColumn || !api.currencies) return;
    const request = ++ratesRequest.current;
    const tableAt = table;
    const currencyAt = sample.currency;
    api.currencies({ table: tableAt, currency_column: currencyAt, base: asked }).then((data) => {
      if (request !== ratesRequest.current || tableAt !== table || currencyAt !== sample?.currency) return;
      const current = latest.current;
      const merged = mergedRates(current.draft, data);
      const next = { ...current.draft, mode: 'convert', base: data.base, rates: merged.rows };
      shownBase.current = data.base;
      setDraft(next);
      const droppedText = merged.dropped.length ? `Your typed rate for ${merged.dropped.join(', ')} was for the previous reporting currency, so it was dropped; check the rate.` : '';
      setNotice([data.message, droppedText].filter(Boolean).join(' '));
      save(next, current.pick);
    }).catch((err) => { if (request === ratesRequest.current) setNotice(err?.message || 'The rates could not be read; type them in.'); });
  };

  useEffect(() => {
    loadRates('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, sample?.currency]);

  const { value: picked, problems: pickProblems } = valueOf(effective);
  const gone = picked && columns.length ? columnsOf(picked).filter((name) => !columns.includes(name)) : [];
  const previewKey = JSON.stringify(pickProblems.length || gone.length ? null : picked);
  useEffect(() => {
    if (!picked || pickProblems.length || gone.length || !table || !api.preview) { setPreview(null); return undefined; }
    let live = true;
    api.preview({ table, value: picked }).then((data) => { if (live) setPreview({ rows: data.rows || [] }); })
      .catch((err) => { if (live) setPreview({ error: err?.message || 'The example rows could not be read.' }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, table]);

  const propose = () => {
    const text = pick.text.trim();
    const request = ++proposalRequest.current;
    setProposalRows(null);
    setPick((p) => ({ ...p, error: '', proposal: null, explanation: '' }));
    api.describe({ table, text, columns, currency_column: sample?.currency || '' }).then((data) => {
      if (request !== proposalRequest.current) return null;
      setPick((p) => ({ ...p, proposal: data.value, explanation: data.explanation || '', error: '' }));
      return api.preview({ table, value: data.value }).then((pv) => { if (request === proposalRequest.current) setProposalRows(pv.rows || []); });
    }).catch((err) => { if (request === proposalRequest.current) setPick((p) => ({ ...p, proposal: null, error: err?.message || 'The rule could not be proposed; choose one of the other ways.' })); });
  };

  const useProposal = () => {
    const used = pickOf(pick.proposal);
    setPickPart({ used, method: 'describe' });
  };

  const shown = ruleOf(draft).rule;
  const sentence = shown && draft.base ? ruleSentence(shown) : '';

  return (
    <div className="money-rule space-y-4" data-money-rule-editor>
      {show('method') && (<>
      <fieldset className="space-y-2" data-measure-value>
        <legend className="text-[13px] font-semibold text-text-primary">How does your business measure the value of each record?</legend>
        {METHODS.map((m) => (
          <label key={m.id} className="flex items-start gap-2 cursor-pointer" data-measure-method={m.id}>
            <input type="radio" name="measure-method" className="mt-1" checked={pick.method === m.id} onChange={() => setPickPart({ method: m.id })} data-money-method={m.id} />
            <span className="text-[12px]"><span className="font-medium text-text-primary">{m.label}</span><span className="block text-text-secondary">{m.hint}</span></span>
          </label>
        ))}
      </fieldset>

      {pick.method === 'describe' && (
        <div className="space-y-2 text-[12px]" data-money-describe>
          <label>How does the value of each record work?
            <textarea rows={3} dir="auto" className="block mt-1 w-full" value={pick.text} onChange={(e) => { proposalRequest.current += 1; setPickPart({ text: e.target.value, proposal: null }); }} data-money-describe-text />
          </label>
          <button type="button" className="lnk" disabled={!pick.text.trim()} onClick={propose} data-money-describe-propose>Turn into a rule</button>
          {pick.error && <PlainMessage text={pick.error} className="text-[12px] text-danger" data-money-describe-error />}
          {pick.proposal && (
            <div className="space-y-1" data-money-describe-proposal>
              <p className="text-text-primary" data-money-describe-explanation>{pick.explanation}</p>
              <p className="text-text-secondary" data-money-describe-rule>{`Proposed rule: ${ruleTextOf(pick.proposal)}`}</p>
              {proposalRows && <ol className="list-decimal ps-5" data-money-describe-rows>{proposalRows.map((row, i) => <li key={i}>{`${shownAmount(row.stake)} ${row.currency}`}</li>)}</ol>}
              <button type="button" className="lnk" onClick={useProposal} data-money-describe-use>Use this rule</button>
            </div>
          )}
        </div>
      )}

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

      {pick.method && pick.method !== 'describe' && (
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

      {effective.method && !pickProblems.length && !gone.length && (
        <div className="space-y-1 text-[12px]" data-money-value-preview>
          <p className="font-semibold text-text-primary">Value of three example rows</p>
          {preview?.error && <PlainMessage text={preview.error} className="text-[12px] text-danger" />}
          {preview?.rows && <ol className="list-decimal ps-5" data-money-preview-rows>{preview.rows.map((row, i) => <li key={i}>{`${shownAmount(row.stake)} ${row.currency}`}</li>)}</ol>}
          {!preview && <p className="text-text-secondary">Reading the rows</p>}
        </div>
      )}

      </>)}
      {show('direction') && (<>
      <fieldset className="space-y-2" data-measure-direction>
        <legend className="text-[13px] font-semibold text-text-primary">Which movement counts?</legend>
        {DIRECTIONS.map((d) => (
          <label key={d.id} className="flex items-start gap-2 cursor-pointer">
            <input type="radio" name="measure-direction" className="mt-1" disabled={d.id === 'gains' && !draft.sign} checked={(draft.rule || 'losses') === d.id} onChange={() => setDraftPart({ rule: d.id })} data-money-rule-kind={d.id} />
            <span className="text-[12px]"><span className="font-medium text-text-primary">{d.label}</span><span className="block text-text-secondary">{d.hint}</span></span>
          </label>
        ))}
      </fieldset>

      </>)}
        {show('direction') && (
        <fieldset className="space-y-2 text-[12px]" data-measure-sign>
          <legend className="text-[13px] font-semibold text-text-primary">Which records are gains?</legend>
          <label className="flex items-start gap-2"><input type="radio" name="measure-sign" checked={signPick.kind === 'column'} onChange={() => setSignPick({ ...signPick, kind: 'column' })} data-money-sign-kind="column" /> <span>A column: its positive values are gains</span></label>
          {signPick.kind === 'column' && (
            <label className="block">Column <select className="ms-2" value={signPick.column} onChange={(e) => pickSign({ column: e.target.value })} data-money-sign-column>
              <option value="">Pick a column</option>{columns.map((name) => <option key={name} value={name}>{name}</option>)}
            </select></label>
          )}
          <label className="flex items-start gap-2"><input type="radio" name="measure-sign" checked={signPick.kind === 'status'} onChange={() => setSignPick({ ...signPick, kind: 'status' })} data-money-sign-kind="status" /> <span>A status value marks a gain</span></label>
          {signPick.kind === 'status' && (
            <div className="space-y-1">
              <label className="block">Status column <select className="ms-2" value={signPick.column} onChange={(e) => pickSign({ column: e.target.value })} data-money-sign-status-column>
                <option value="">Pick a column</option>{columns.map((name) => <option key={name} value={name}>{name}</option>)}
              </select></label>
              <label className="block">Status value that marks a gain <input className="ms-2 w-40" dir="auto" value={signPick.value} onChange={(e) => pickSign({ value: e.target.value })} data-money-sign-value /></label>
              <label className="block">Statuses that mark a loss, comma-separated (any other status counts neither) <input className="ms-2 w-56" dir="auto" value={signPick.losses} onChange={(e) => pickSign({ losses: e.target.value })} data-money-sign-losses /></label>
            </div>
          )}
          {!draft.sign && <p className="text-text-secondary" data-money-sign-needed>Gains only needs a sign: name the column whose positive values are gains, or the status value that marks a gain.</p>}
        </fieldset>
        )}
      {show('currency') && (<>
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
                  <td className="pe-4"><input dir="auto" className="w-32" aria-label={`Rate for ${row.code}`} value={row.rate} disabled={row.source === 'base'} onChange={(e) => setRate(i, { rate: e.target.value })} data-money-rate /></td>
                  <td className="text-text-secondary" data-money-rate-source={row.source}>{SOURCE_TEXT[row.source] || row.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      </>)}
      {(!onlyPart || onlyPart === 'window' || onlyPart === 'off') && (
      <details className="text-[12px]" data-money-more>
        <summary className="cursor-pointer text-text-secondary">More options</summary>
        <div className="space-y-2 pt-2">
          {show('window') && (<>
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
          </>)}
          {show('off') && <label className="flex items-center gap-2"><input type="checkbox" checked={draft.off} onChange={(e) => setDraftPart({ off: e.target.checked })} data-money-off /> Off: show no money total, chart or Genie money answer</label>}
        </div>
      </details>
      )}
      {!effective.method && <p className="text-[12px] text-text-secondary" data-money-genie-estimate>Until you choose how to measure value, the totals are Genie estimate, not your rule.</p>}
      {!draft.base && <p className="text-[12px] text-text-secondary" data-money-base-needed>Pick the reporting currency: every amount is reported in it.</p>}
      {sentence && <p className="sentence text-[12px] text-text-primary" data-money-sentence>{sentence}</p>}
      {problems.length > 0 && <PlainMessage text={problems.join(' ')} className="text-[12px] text-danger" data-money-error />}
    </div>
  );
}
