import { useEffect, useRef, useState } from 'react';
import { draftOf, ruleOf, ruleSentence } from '../../../agent/agent/app_shell/web/src/moneyRule.js';
import '../../../agent/agent/app_shell/web/src/styles/moneyRule.css';
import { compileExpression } from '../../../agent/agent/app_shell/web/src/moneyValue.js';
import { moneyPartsOf } from '../lib/moneyParts.js';
import { ALL_PERIODS, DEFAULT_CURRENCY, MONEY_CURRENCY_CHOICES, WINDOW_CHOICES } from '../lib/moneyDefaults.js';
import AVERAGES from '../../../backend/lib/fxAverages.json';
import { PlainMessage } from './TechnicalDetails.jsx';
import { joinSentences } from '../lib/sentences';

const ISO = /^[A-Z]{3}$/;
const COLUMN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const EMPTY_PICK = { method: '', amount: '', column: '', expression: '', currencyBy: 'code', code: 'USD', currencyColumn: '', text: '', proposal: null, explanation: '', error: '', used: null };
const OFF_RULE = { currency: 'per_currency', off: true };
const SOURCE_TEXT = { today: 'today’s rate', average: `ECB average, ${AVERAGES.period.from.slice(0, 4)}`, typed: 'typed in', base: 'reporting currency', missing: 'no rate yet, type it in' };

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
  const onlyPart = moneyPartsOf('gains').includes(part) ? part : null;
  const [draft, setDraft] = useState(() => ({ ...draftOf(value || {}), rateSource: 'typed' }));
  const [pick] = useState(() => ({ ...pickOf(value?.value, value) }));
  const [problems, setProblems] = useState([]);
  const [notice, setNotice] = useState('');
  const hasCurrencyColumn = Boolean(sample?.currency);
  const effective = effectiveOf(pick);
  // The currency the rates are read for: the table's currency column, else the code the value is written in (REQ-103). A value the rule
  // computes names no code here, so its amounts are taken in the wizard's default currency, as the rest of Measure already says.
  const rateKey = hasCurrencyColumn ? sample.currency : (valueOf(effective).value?.currency || DEFAULT_CURRENCY);

  const save = (nextDraft, nextPick) => {
    if (nextDraft.off) {
      setProblems([]);
      onChange(OFF_RULE);
      return;
    }
    const { rule, problems: found } = ruleOf(nextDraft);
    // REQ-473: the value is no longer asked here; the saved one rides along unchecked, so only the questions on screen can block a save.
    const picked = valueOf(effectiveOf(nextPick));
    setProblems(found);
    if (!found.length && rule) onChange(picked.value ? { ...rule, value: picked.value } : rule);
    else if (value?.off) onChange(null);
  };
  const setDraftPart = (patch) => { const next = { ...draft, ...patch }; setDraft(next); save(next, pick); };
  const setRate = (i, patch) => setDraftPart({ rates: draft.rates.map((row, at) => (at === i ? { ...row, ...patch, source: 'typed' } : row)) });

  const latest = useRef({ draft, pick, rateKey });
  latest.current = { draft, pick, rateKey };
  const ratesRequest = useRef(0);

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
  // A table with no currency column reads the rate of the one code the value is written in.
  const loadRates = (asked) => {
    if (!table || !rateKey || !api.currencies) return;
    const request = ++ratesRequest.current;
    const tableAt = table;
    const keyAt = rateKey;
    const byColumn = hasCurrencyColumn ? { currency_column: keyAt } : { codes: [keyAt] };
    api.currencies({ table: tableAt, ...byColumn, base: asked }).then((data) => {
      if (request !== ratesRequest.current || tableAt !== table || keyAt !== latest.current.rateKey) return;
      const current = latest.current;
      const merged = mergedRates(current.draft, data);
      const next = { ...current.draft, base: data.base, rates: merged.rows };
      shownBase.current = data.base;
      setDraft(next);
      const droppedText = merged.dropped.length ? `Your typed rate for ${merged.dropped.join(', ')} was for the previous reporting currency, so it was dropped; check the rate.` : '';
      setNotice(joinSentences(data.message, droppedText));
      save(next, current.pick);
    }).catch((err) => { if (request === ratesRequest.current) setNotice(err?.message || 'The rates could not be read; type them in.'); });
  };

  useEffect(() => {
    // Asks for the rates in the base the rule already saved, so a remount keeps that base.
    loadRates(draft.base || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, rateKey]);

  const shown = ruleOf(draft).rule;
  const sentence = shown && draft.base ? ruleSentence(shown) : '';
  const currencyPart = (
    <Section
      left={(
        <>
          <fieldset className="space-y-2 text-[12px]" data-money-convert>
            <legend className="font-semibold text-text-primary">Report the amounts</legend>
            <Choice label="Keep each currency separate (default)" hint="Totals are shown per currency; different currencies are never added together."
              control={<input type="radio" name="money-report" className="mt-0.5 shrink-0" checked={draft.mode !== 'convert'} onChange={() => setDraftPart({ mode: 'per_currency' })} data-money-currency-mode="per_currency" />} />
            {Boolean(rateKey) && (
              <Choice label="Convert every amount to one reporting currency" hint="Each amount is converted with its rate, today's rate by default."
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
                {hasCurrencyColumn && (<Choice label="Each record has its own rate, in a column" hint="Each row is converted with the rate on its own row."
                  control={<input type="radio" name="money-rate-source" className="mt-0.5 shrink-0" checked={draft.rateSource === 'column'} onChange={() => setDraftPart({ rateSource: 'column', currencyColumn: draft.currencyColumn || sample?.currency || '' })} data-money-rate-source="column" />} />)}
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

  const parts = { currency: currencyPart, window: windowPart, off: offPart };
  return (
    <div className="money-rule space-y-4" data-money-rule-editor>
      {(onlyPart ? [onlyPart] : moneyPartsOf(draft.rule)).map((name) => <div key={name}>{parts[name]}</div>)}
      {!draft.off && !effective.method && <p className="text-[12px] text-text-secondary" data-money-genie-estimate>Until you choose how to measure value, the totals are Genie estimate, not your rule.</p>}
      {!draft.base && draft.mode === 'convert' && <p className="text-[12px] text-text-secondary" data-money-base-needed>Pick the reporting currency: every amount is reported in it.</p>}
      {sentence && <p className="sentence text-[12px] text-text-primary" data-money-sentence>{sentence}</p>}
      {problems.length > 0 && <PlainMessage text={joinSentences(...problems)} className="text-[12px] text-danger" data-money-error />}
    </div>
  );
}
