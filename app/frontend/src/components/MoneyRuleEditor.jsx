import { useEffect, useRef, useState } from 'react';
import { draftOf, ruleOf, ruleSentence } from '../../../agent/agent/app_shell/web/src/moneyRule.js';
import '../../../agent/agent/app_shell/web/src/styles/moneyRule.css';
import { compileExpression } from '../../../agent/agent/app_shell/web/src/moneyValue.js';
import { MONEY_PARTS } from '../lib/moneyParts.js';
import { ALL_PERIODS, MONEY_CURRENCY_CHOICES, WINDOW_CHOICES, valueTextOf } from '../lib/moneyDefaults.js';
import AVERAGES from '../../../backend/lib/fxAverages.json';
import { PlainMessage } from './TechnicalDetails.jsx';

const ISO = /^[A-Z]{3}$/;
const COLUMN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const EMPTY_PICK = { method: '', amount: '', column: '', expression: '', currencyBy: 'code', code: 'USD', currencyColumn: '', text: '', proposal: null, explanation: '', error: '', used: null };
const METHODS = [
  { id: 'rule', label: 'The amount the rule computes', hint: 'Each flagged record counts the amount its own rule works out. Nothing to fill in.' },
  { id: 'fixed', label: 'A fixed amount for each record', hint: 'Every record is worth the same amount.' },
  { id: 'lost', label: 'The cost of each lost opportunity (count × value)', hint: 'Counts the records whose status says the opportunity was lost, each worth the amount you set.' },
  { id: 'column', label: 'A value from a data column', hint: 'The column already holds the amount each record is worth.' },
  { id: 'equation', label: 'An equation over columns', hint: 'Work the value out from several columns.' },
  { id: 'describe', label: 'Describe it', hint: 'Write how the value works in your words; Inspire proposes the rule for you to check.' },
];
const DIRECTIONS = [
  { id: 'losses', label: 'Losses only', hint: 'A loss counts; a gain counts as 0.' },
  { id: 'gains', label: 'Gains only', hint: 'Needs a sign on the right: only the gain records count.' },
  { id: 'net', label: 'Losses and gains, netted', hint: 'Gains and losses cancel out inside each total.' },
];
const OFF_RULE = { currency: 'per_currency', off: true };
const SOURCE_TEXT = { today: 'today’s rate', average: `ECB average, ${AVERAGES.period.from.slice(0, 4)}`, typed: 'typed in', base: 'reporting currency', missing: 'no rate yet, type it in' };
const DESCRIBE_EXAMPLE = 'Example: Each cancelled booking is worth its ticket_price in the currency column, and a refund counts as 0.';

// A saved rule with no value counts the amount its own rule computes: that is the 'rule' choice, not an empty one.
// A fixed amount that a rule filters to statuses is the cost of each lost opportunity: the same rule, shown under its own name.
function pickOf(value, rule = null) {
  if (rule && rule.value === undefined && !rule.off) return { ...EMPTY_PICK, method: 'rule' };
  if (!value || !['fixed', 'column', 'equation'].includes(value.method)) return { ...EMPTY_PICK };
  const lost = value.method === 'fixed' && Array.isArray(rule?.statuses) && rule.statuses.length > 0;
  return {
    ...EMPTY_PICK, method: lost ? 'lost' : value.method, amount: value.amount == null ? '' : String(value.amount), column: value.column || '', expression: value.expression || '',
    currencyBy: value.currency_column !== undefined ? 'column' : 'code', code: value.currency || 'USD', currencyColumn: value.currency_column || '',
  };
}

function effectiveOf(pick) {
  return pick.method === 'describe' ? (pick.used || { ...EMPTY_PICK }) : pick;
}

function valueOf(pick) {
  if (!pick.method || pick.method === 'rule') return { value: null, problems: [] };
  const problems = [];
  const currency = pick.currencyBy === 'column' ? { currency_column: pick.currencyColumn.trim() } : { currency: pick.code.trim().toUpperCase() };
  if (pick.currencyBy === 'column' && !COLUMN.test(pick.currencyColumn.trim())) problems.push('Pick the column that holds the currency of each record.');
  if (pick.currencyBy !== 'column' && !ISO.test(currency.currency)) problems.push('The value currency is a three-letter code such as USD.');
  if (pick.method === 'fixed' || pick.method === 'lost') {
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

const shownAmount = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

// A radio or checkbox sits to the left of its label, on the same row.
function Choice({ control, label, hint = '' }) {
  return (
    <label className="radio cursor-pointer text-[12px]" style={{ alignItems: "flex-start" }}>
      {control}
      <span><span className="font-medium text-text-primary">{label}</span>{hint && <span className="block text-text-secondary">{hint}</span>}</span>
    </label>
  );
}

// The left column holds the choices; the right column holds the calculation, a worked example and the inputs for the choice.
function Section({ left, right, className = '' }) {
  return (
    <div className={`grid gap-4 md:grid-cols-2 ${className}`}>
      <div className="space-y-3" data-money-choices>{left}</div>
      <div className="space-y-2 rounded-lg border border-border bg-bg-subtle/50 p-3 text-[12px]" data-money-details>{right}</div>
    </div>
  );
}

export function MoneyRuleEditor({ value, onChange, sample = null, table = '', columns = [], api = {}, part = null }) {
  const onlyPart = MONEY_PARTS.includes(part) ? part : null;
  const [draft, setDraft] = useState(() => ({ ...draftOf(value || {}), rateSource: 'typed' }));
  const [pick, setPick] = useState(() => ({ ...pickOf(value?.value, value) }));
  const [signPick, setSignPick] = useState(() => ({ kind: value?.sign?.kind || '', column: value?.sign?.column || '', value: value?.sign?.value || '', losses: (value?.sign?.losses || []).join(', ') }));
  const [problems, setProblems] = useState([]);
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState(null);
  const [proposalRows, setProposalRows] = useState(null);
  const hasCurrencyColumn = Boolean(sample?.currency);
  const effective = effectiveOf(pick);
  const multiCurrency = draft.rates.length > 1;

  const save = (nextDraft, nextPick) => {
    if (nextDraft.off) {
      setProblems([]);
      onChange(OFF_RULE);
      return;
    }
    const { rule, problems: found } = ruleOf(nextDraft);
    const picked = valueOf(effectiveOf(nextPick));
    const gone = picked.value && columns.length ? columnsOf(picked.value).filter((name) => !columns.includes(name)) : [];
    const lostNeedsStatuses = nextPick.method === 'lost' && !nextDraft.statuses.trim() ? ['Name the statuses that mean the opportunity was lost, such as lost.'] : [];
    const all = [...found, ...picked.problems, ...lostNeedsStatuses, ...gone.map((name) => `The column ${name} is not in this table, so the rule cannot use it.`)];
    setProblems(all);
    if (!all.length && rule) onChange(picked.value ? { ...rule, value: picked.value } : rule);
    else if (value?.off) onChange(null);
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

  // Reads the currencies of the table and their rates. It only fills the rates: the rule keeps its own currency mode.
  const loadRates = (asked) => {
    if (!table || !hasCurrencyColumn || !api.currencies) return;
    const request = ++ratesRequest.current;
    const tableAt = table;
    const currencyAt = sample.currency;
    api.currencies({ table: tableAt, currency_column: currencyAt, base: asked }).then((data) => {
      if (request !== ratesRequest.current || tableAt !== table || currencyAt !== sample?.currency) return;
      const current = latest.current;
      const merged = mergedRates(current.draft, data);
      const next = { ...current.draft, base: data.base, rates: merged.rows };
      shownBase.current = data.base;
      setDraft(next);
      const droppedText = merged.dropped.length ? `Your typed rate for ${merged.dropped.join(', ')} was for the previous reporting currency, so it was dropped; check the rate.` : '';
      setNotice([data.message, droppedText].filter(Boolean).join(' '));
      save(next, current.pick);
    }).catch((err) => { if (request === ratesRequest.current) setNotice(err?.message || 'The rates could not be read; type them in.'); });
  };

  useEffect(() => {
    // Asks for the rates in the base the rule already saved, so a remount keeps that base.
    loadRates(draft.base || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, sample?.currency]);

  const { value: picked, problems: pickProblems } = valueOf(effective);
  const gone = picked && columns.length ? columnsOf(picked).filter((name) => !columns.includes(name)) : [];
  // The lost-opportunity choice previews only the rows whose status means lost, the rows the rule counts.
  const lostFilter = pick.method === 'lost' ? { statuses: draft.statuses.split(',').map((s) => s.trim()).filter(Boolean), status_column: draft.statusColumn } : null;
  const lostUnnamed = lostFilter !== null && !(lostFilter.statuses.length && lostFilter.status_column);
  const previewKey = JSON.stringify(pickProblems.length || gone.length || lostUnnamed ? null : { picked, lostFilter });
  useEffect(() => {
    if (!picked || pickProblems.length || gone.length || lostUnnamed || !table || !api.preview) { setPreview(null); return undefined; }
    let live = true;
    api.preview({ table, value: picked, lost_filter: lostFilter }).then((data) => { if (live) setPreview({ rows: data.rows || [] }); })
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
  const columnList = <datalist id="money-columns">{columns.map((name) => <option key={name} value={name} />)}</datalist>;
  const exampleRows = preview?.rows && (
    <div className="space-y-1" data-money-value-preview>
      <p className="font-semibold text-text-primary">Worked example from your table</p>
      {preview.error && <PlainMessage text={preview.error} className="text-[12px] text-danger" />}
      <ol className="list-decimal ps-5" data-money-preview-rows>{preview.rows.map((row, i) => <li key={i}>{`${shownAmount(row.stake)} ${row.currency}`}</li>)}</ol>
    </div>
  );


  const valueCurrencyBlock = pick.method && pick.method !== 'describe' && pick.method !== 'rule' && (
    <fieldset className="space-y-2 text-[12px]" data-money-value-currency>
      <legend className="font-semibold text-text-primary">Currency of those values</legend>
      {hasCurrencyColumn && (
        <Choice label="Each record has its own currency column" control={<input type="radio" name="value-currency-by" className="mt-0.5 shrink-0" checked={pick.currencyBy === 'column'} onChange={() => setPickPart({ currencyBy: 'column', currencyColumn: pick.currencyColumn || sample.currency })} data-money-value-currency-by="column" />} />
      )}
      {hasCurrencyColumn && pick.currencyBy === 'column' && (
        <label className="block ps-6">Currency column (type or pick)
          <input dir="auto" className="ms-2 w-40" list="money-columns" value={pick.currencyColumn} onChange={(e) => setPickPart({ currencyColumn: e.target.value.trim() })} data-money-value-currency-column />
        </label>
      )}
      <Choice label="One currency for all records" control={<input type="radio" name="value-currency-by" className="mt-0.5 shrink-0" checked={pick.currencyBy !== 'column'} onChange={() => setPickPart({ currencyBy: 'code' })} data-money-value-currency-by="code" />} />
      {pick.currencyBy !== 'column' && (
        <label className="block ps-6">Currency code (USD is the default; type or pick)
          <input dir="auto" className="ms-2 w-24" list="money-currency-codes" value={pick.code} onChange={(e) => setPickPart({ code: e.target.value.toUpperCase() })} data-money-value-code />
        </label>
      )}
    </fieldset>
  );

  const methodPart = (
    <Section
      left={(
        <fieldset className="space-y-3" data-measure-value>
          <legend className="text-[13px] font-semibold text-text-primary">How does your business measure the value of each record?</legend>
          {METHODS.map((m) => (
            <Choice key={m.id} label={m.label} hint={m.hint}
              control={<input type="radio" name="measure-method" className="mt-0.5 shrink-0" checked={pick.method === m.id} onChange={() => setPickPart({ method: m.id })} data-money-method={m.id} data-measure-method={m.id} />} />
          ))}
        </fieldset>
      )}
      right={(
        <>
          <p className="font-semibold text-text-primary">Calculation</p>
          {pick.method === '' && <p className="text-text-secondary">Choose how the value is measured. The default is pre-filled from this use case’s table, so you can keep it.</p>}
          {pick.method === 'rule' && <p className="text-text-secondary" data-money-rule-own>Each flagged record counts the amount its own rule works out, so there is nothing to fill in. Pick a column, a fixed amount or an equation to use a value of your own instead.</p>}
          {pick.method === 'fixed' && (
            <>
              <label className="block">Amount for each record (positive, for example 120)
                <input dir="auto" inputMode="decimal" className="block mt-1 w-40" value={pick.amount} onChange={(e) => setPickPart({ amount: e.target.value })} data-money-fixed-amount />
              </label>
              <p className="text-text-secondary">Total = number of records × amount. Example: a lost booking worth 120 counts 120; three of them count 360.</p>
            </>
          )}
          {pick.method === 'lost' && (
            <div className="space-y-2 text-[12px]" data-money-lost>
              <label className="block">Amount for each lost record
                <input dir="auto" className="block mt-1 w-40" value={pick.amount} onChange={(e) => setPickPart({ amount: e.target.value })} data-money-lost-amount />
              </label>
              <label className="block">Column that holds the status of each record
                <select className="block mt-1" value={draft.statusColumn} onChange={(e) => setDraftPart({ statusColumn: e.target.value })} data-money-lost-status-column>
                  <option value="">Pick a column</option>
                  {[...new Set([...columns, draft.statusColumn].filter(Boolean))].map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
              <label className="block">Statuses that mean the opportunity was lost, comma-separated
                <input dir="auto" className="block mt-1 w-full" value={draft.statuses} onChange={(e) => setDraftPart({ statuses: e.target.value })} data-money-lost-statuses />
              </label>
            </div>
          )}
          {pick.method === 'column' && (
            <>
              <label className="block">Column with the amount of each record (type or pick)
                <input dir="auto" className="block mt-1 w-full" list="money-columns" value={pick.column} placeholder={sample?.amount || 'total_amount'}
                  onChange={(e) => setPickPart({ column: e.target.value.trim() })} data-money-value-column />
              </label>
              {columnList}
              <p className="text-text-secondary">Total = sum of this column over the records. Example: a row with 250 in {sample?.amount || 'this column'} adds 250.</p>
            </>
          )}
          {pick.method === 'equation' && (
            <>
              <label className="block">Equation over columns (type or pick a column)
                <input dir="auto" className="block mt-1 w-full" list="money-columns" value={pick.expression} placeholder="quantity * unit_price - discount"
                  onChange={(e) => setPickPart({ expression: e.target.value })} data-money-equation />
              </label>
              {columnList}
              <p className="text-text-secondary">Each record is worked out from its own row, then the values are summed. Example: quantity 3, unit_price 40, discount 10 gives 110.</p>
            </>
          )}
          {pick.method === 'describe' && (
            <div className="space-y-2" data-money-describe>
              <label className="block">How does the value of each record work?
                <textarea rows={4} dir="auto" className="block mt-1 w-full" value={pick.text} placeholder={DESCRIBE_EXAMPLE}
                  onChange={(e) => { proposalRequest.current += 1; setPickPart({ text: e.target.value, proposal: null }); }} data-money-describe-text />
              </label>
              <p className="text-text-secondary">{DESCRIBE_EXAMPLE}</p>
              <button type="button" className="lnk" disabled={!pick.text.trim()} onClick={propose} data-money-describe-propose>Turn into a rule</button>
              {pick.error && <PlainMessage text={pick.error} className="text-[12px] text-danger" data-money-describe-error />}
              {pick.proposal && (
                <div className="space-y-1" data-money-describe-proposal>
                  <p className="text-text-primary" data-money-describe-explanation>{pick.explanation}</p>
                  <p className="text-text-secondary" data-money-describe-rule>{`Proposed rule: ${valueTextOf(pick.proposal)}`}</p>
                  {proposalRows && <ol className="list-decimal ps-5" data-money-describe-rows>{proposalRows.map((row, i) => <li key={i}>{`${shownAmount(row.stake)} ${row.currency}`}</li>)}</ol>}
                  <button type="button" className="lnk" onClick={useProposal} data-money-describe-use data-draft-change="">Use this rule</button>
                </div>
              )}
            </div>
          )}
          {valueCurrencyBlock}
          {effective.method && !pickProblems.length && !gone.length && exampleRows}
          {gone.length > 0 && <PlainMessage text={gone.map((name) => `The column ${name} is not in this table, so the rule cannot use it.`).join(' ')} className="text-[12px] text-danger" />}
        </>
      )}
    />
  );

  const directionPart = (
    <Section
      left={(
        <fieldset className="space-y-3" data-measure-direction>
          <legend className="text-[13px] font-semibold text-text-primary">Which movement counts?</legend>
          {DIRECTIONS.map((d) => (
            <Choice key={d.id} label={d.label} hint={d.hint}
              control={<input type="radio" name="measure-direction" className="mt-0.5 shrink-0" disabled={d.id === 'gains' && !draft.sign} checked={(draft.rule || 'losses') === d.id} onChange={() => setDraftPart({ rule: d.id })} data-money-rule-kind={d.id} />} />
          ))}
        </fieldset>
      )}
      right={(
        <>
          <p className="font-semibold text-text-primary">Calculation</p>
          <p className="text-text-secondary">{{
            losses: 'Total = sum of the value of the records that are losses. Example: a loss worth 120 adds 120; a gain adds 0.',
            gains: 'Total = sum of the value of the records that are gains. Example: a row with channel "gain" and value 120 adds 120.',
            net: 'Total = gains and losses added together. Example: a gain of 120 and a loss of 120 net to 0.',
          }[draft.rule || 'losses']}</p>
          <fieldset className="space-y-2" data-measure-sign>
            <legend className="font-semibold text-text-primary">Which records are gains? (needed for Gains only)</legend>
            <Choice label="A column: its positive values are gains" control={<input type="radio" name="measure-sign" className="mt-0.5 shrink-0" checked={signPick.kind === 'column'} onChange={() => setSignPick({ ...signPick, kind: 'column' })} data-money-sign-kind="column" />} />
            {signPick.kind === 'column' && (
              <label className="block ps-6">Column (type or pick)
                <input dir="auto" className="ms-2 w-40" list="money-columns" value={signPick.column} onChange={(e) => pickSign({ column: e.target.value.trim() })} data-money-sign-column />
              </label>
            )}
            <Choice label="A status value marks a gain" control={<input type="radio" name="measure-sign" className="mt-0.5 shrink-0" checked={signPick.kind === 'status'} onChange={() => setSignPick({ ...signPick, kind: 'status' })} data-money-sign-kind="status" />} />
            {signPick.kind === 'status' && (
              <div className="space-y-1 ps-6">
                <label className="block">Status column (type or pick)
                  <input dir="auto" className="ms-2 w-40" list="money-columns" value={signPick.column} onChange={(e) => pickSign({ column: e.target.value.trim() })} data-money-sign-status-column />
                </label>
                <label className="block">Status value that marks a gain, for example gain
                  <input dir="auto" className="ms-2 w-40" value={signPick.value} onChange={(e) => pickSign({ value: e.target.value })} data-money-sign-value />
                </label>
                <label className="block">Statuses that mark a loss, comma-separated, for example refunded (any other status counts neither)
                  <input dir="auto" className="ms-2 w-56" value={signPick.losses} onChange={(e) => pickSign({ losses: e.target.value })} data-money-sign-losses />
                </label>
              </div>
            )}
            {!draft.sign && <p className="text-text-secondary" data-money-sign-needed>Gains only needs a sign: name the column whose positive values are gains, or the status value that marks a gain.</p>}
          </fieldset>
          {columnList}
        </>
      )}
    />
  );

  const currencyPart = (
    <Section
      left={(
        <>
          <fieldset className="space-y-2 text-[12px]" data-money-convert>
            <legend className="font-semibold text-text-primary">Report the amounts</legend>
            <Choice label="Keep each currency separate (default)" hint="Totals are shown per currency; different currencies are never added together."
              control={<input type="radio" name="money-report" className="mt-0.5 shrink-0" checked={draft.mode !== 'convert'} onChange={() => setDraftPart({ mode: 'per_currency' })} data-money-currency-mode="per_currency" />} />
            {multiCurrency && (
              <Choice label="Convert every amount to one reporting currency" hint="Only offered because the table holds more than one currency."
                control={<input type="radio" name="money-report" className="mt-0.5 shrink-0" checked={draft.mode === 'convert'} onChange={() => setDraftPart({ mode: 'convert' })} data-money-currency-mode="convert" />} />
            )}
            {draft.mode === 'convert' && (
              <label className="block ps-6">Reporting currency (USD is the default)
                <input dir="auto" className="block mt-1 w-28" list="money-currency-codes" value={draft.base} placeholder="USD"
                  onChange={(e) => setDraftPart({ base: e.target.value.toUpperCase() })} onBlur={(e) => { if (ISO.test(e.target.value.trim().toUpperCase())) loadRates(e.target.value.trim().toUpperCase()); }} data-money-base />
              </label>
            )}
            {draft.mode === 'convert' && (
              <fieldset className="space-y-2 ps-6 text-[12px]" data-money-rate-source-group>
                <legend className="font-semibold text-text-primary">Where each rate comes from</legend>
                <Choice label="Rates you type, one per currency" control={<input type="radio" name="money-rate-source" className="mt-0.5 shrink-0" checked={draft.rateSource !== 'column'} onChange={() => setDraftPart({ rateSource: 'typed' })} data-money-rate-source="typed" />} />
                <Choice label="Each record has its own rate, in a column" hint="Each row is converted with the rate on its own row."
                  control={<input type="radio" name="money-rate-source" className="mt-0.5 shrink-0" checked={draft.rateSource === 'column'} onChange={() => setDraftPart({ rateSource: 'column', currencyColumn: draft.currencyColumn || sample?.currency || '' })} data-money-rate-source="column" />} />
                {draft.rateSource === 'column' && (
                  <>
                    <label className="block">Rate column
                      <select className="block mt-1 w-40" value={draft.rateColumn} onChange={(e) => setDraftPart({ rateColumn: e.target.value })} data-money-rate-column>
                        <option value="">Pick a column</option>
                        {columns.map((name) => <option key={name} value={name}>{name}</option>)}
                      </select>
                    </label>
                    <label className="block">Currency column, the currency of each row
                      <select className="block mt-1 w-40" value={draft.currencyColumn} onChange={(e) => setDraftPart({ currencyColumn: e.target.value })} data-money-rate-currency-column>
                        <option value="">Pick a column</option>
                        {columns.map((name) => <option key={name} value={name}>{name}</option>)}
                      </select>
                    </label>
                  </>
                )}
              </fieldset>
            )}
          </fieldset>
          <datalist id="money-currency-codes">{MONEY_CURRENCY_CHOICES.map((code) => <option key={code} value={code} />)}</datalist>
        </>
      )}
      right={(
        <>
          <p className="font-semibold text-text-primary">What this means</p>
          <p className="text-text-secondary">A currency code is the three-letter money code, such as USD or AED. The value currency says what each value is written in; the reporting currency is the one every total is shown in when you convert.</p>
          {!hasCurrencyColumn && <p className="text-text-secondary">The table has no currency column, so every amount is taken in the currency code you pick.</p>}
          {notice && <p className="text-text-secondary" data-money-rates-notice>{notice}</p>}
          {draft.mode === 'convert' && draft.rateSource !== 'column' && (
            draft.rates.length > 0 ? (
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
            ) : <p className="text-text-secondary">Example: 1 EUR = 1.08 USD. The rates are read from the table, or type them in.</p>
          )}
        </>
      )}
    />
  );

  const windowPart = (
    <Section
      left={(
        <>
          <label className="block">Closed periods to total
            <input dir="auto" className="block mt-1 w-40" list="money-window-choices" value={draft.window} placeholder={ALL_PERIODS} onChange={(e) => setDraftPart({ window: e.target.value.trim() })} data-money-window />
          </label>
          <datalist id="money-window-choices">{WINDOW_CHOICES.map((n) => <option key={n} value={n} />)}</datalist>
          <label className="block">Statuses that count, comma-separated (empty for every status)
            <input dir="auto" className="block mt-1 w-full" placeholder="for example closed, paid" value={draft.statuses} onChange={(e) => setDraftPart({ statuses: e.target.value })} data-money-statuses />
          </label>
          {draft.statuses.trim() && (
            <label className="block">Status column (type or pick)
              <input dir="auto" className="block mt-1 w-40" list="money-columns" value={draft.statusColumn} onChange={(e) => setDraftPart({ statusColumn: e.target.value.trim() })} data-money-status-column />
            </label>
          )}
        </>
      )}
      right={(
        <>
          <p className="font-semibold text-text-primary">What this means</p>
          <p className="text-text-secondary">How many past periods to add up. All adds every closed period; 12 means the last 12 months.</p>
          <p className="text-text-secondary">Example: with 12, a closed month from 13 months ago is left out. Statuses keep only the rows whose status is listed.</p>
          <p className="text-text-secondary">Default: All closed periods, every status.</p>
        </>
      )}
    />
  );

  const offPart = (
    <Section
      left={<Choice label="Off: show no money total, chart or Genie money answer" control={<input type="checkbox" className="mt-0.5 shrink-0" checked={draft.off} onChange={(e) => setDraftPart({ off: e.target.checked })} data-money-off />} />}
      right={<p className="text-text-secondary">Use Off when money does not apply to this use case. Nothing else changes, and you can turn it back on at any time.</p>}
    />
  );

  const parts = { method: methodPart, direction: directionPart, currency: currencyPart, window: windowPart, off: offPart };
  return (
    <div className="money-rule space-y-4" data-money-rule-editor>
      {(onlyPart ? [onlyPart] : MONEY_PARTS).map((name) => <div key={name}>{parts[name]}</div>)}
      {!draft.off && !effective.method && <p className="text-[12px] text-text-secondary" data-money-genie-estimate>Until you choose how to measure value, the totals are Genie estimate, not your rule.</p>}
      {!draft.base && draft.mode === 'convert' && <p className="text-[12px] text-text-secondary" data-money-base-needed>Pick the reporting currency: every amount is reported in it.</p>}
      {sentence && <p className="sentence text-[12px] text-text-primary" data-money-sentence>{sentence}</p>}
      {problems.length > 0 && <PlainMessage text={problems.join(' ')} className="text-[12px] text-danger" data-money-error />}
    </div>
  );
}
