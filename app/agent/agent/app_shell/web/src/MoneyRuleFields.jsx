export const BUILD_FIELDS = ['statuses', 'rule', 'per', 'groupColumn', 'rateTable'];
const REBUILD = 'Changing this needs a rebuild';

export function MoneyRuleFields({ draft, set, setRate, locked = [] }) {
  const lock = (field) => locked.includes(field);
  const note = (field) => (lock(field) ? <span className="rebuild-note" data-money-rebuild={field}>{REBUILD}</span> : null);
  const input = (field, props) => <input dir="auto" disabled={lock(field)} {...props} />;
  return (
    <div data-money-fields>
      <label className="check"><input type="checkbox" checked={draft.off} onChange={(e) => set({ off: e.target.checked })} data-money-off /> Off: show no money total, chart or Genie money answer</label>
      <fieldset>
        <label className="radio"><input type="radio" name="money-mode" checked={draft.mode === 'per_currency'} onChange={() => set({ mode: 'per_currency' })} data-money-mode="per_currency" /> Per currency: one total for each currency</label>
        <label className="radio"><input type="radio" name="money-mode" checked={draft.mode === 'convert'} onChange={() => set({ mode: 'convert', rates: draft.rates.length ? draft.rates : [{ code: '', rate: '' }] })} data-money-mode="convert" /> Convert to one currency</label>
      </fieldset>
      <label>Closed periods to total (empty for every closed period)
        {input('window', { value: draft.window, onChange: (e) => set({ window: e.target.value }), 'data-money-window': true })}</label>
      <label>Statuses that count (comma-separated, empty for all)
        {input('statuses', { value: draft.statuses, onChange: (e) => set({ statuses: e.target.value }), 'data-money-statuses': true })}{note('statuses')}</label>
      <fieldset disabled={lock('rule')}>
        <label className="radio"><input type="radio" name="money-rule" checked={draft.rule === 'losses'} onChange={() => set({ rule: 'losses' })} data-money-rule-kind="losses" /> Losses only: each loss counts, gains count zero</label>
        <label className="radio"><input type="radio" name="money-rule" checked={draft.rule === 'net'} onChange={() => set({ rule: 'net' })} data-money-rule-kind="net" /> Net: gains and losses netted</label>
        {note('rule')}
      </fieldset>
      <fieldset disabled={lock('per')}>
        <label className="radio"><input type="radio" name="money-per" checked={draft.per === 'row'} onChange={() => set({ per: 'row' })} data-money-per="row" /> Per row: every row counts</label>
        <label className="radio"><input type="radio" name="money-per" checked={draft.per === 'group'} onChange={() => set({ per: 'group' })} data-money-per="group" /> Per group: each group counts once, with its largest row</label>
        {draft.per === 'group' && <label>Group column {input('groupColumn', { value: draft.groupColumn, onChange: (e) => set({ groupColumn: e.target.value }), 'data-money-group-column': true })}</label>}
        {note('per')}
      </fieldset>
      {draft.mode === 'convert' && (
        <div data-money-convert>
          <label>Base currency {input('base', { value: draft.base, onChange: (e) => set({ base: e.target.value }), 'data-money-base': true })}</label>
          <fieldset disabled={lock('rateTable')}>
            <label className="radio"><input type="radio" name="money-rate-source" checked={draft.rateSource === 'typed'} onChange={() => set({ rateSource: 'typed' })} data-money-rate-source="typed" /> Rates I type in</label>
            <label className="radio"><input type="radio" name="money-rate-source" checked={draft.rateSource === 'column'} onChange={() => set({ rateSource: 'column' })} data-money-rate-source="column" /> A column with one rate per row</label>
            <label className="radio"><input type="radio" name="money-rate-source" checked={draft.rateSource === 'table'} onChange={() => set({ rateSource: 'table' })} data-money-rate-source="table" /> A rate table, joined on currency, base and date</label>
            {note('rateTable')}
          </fieldset>
          {draft.rateSource === 'column' && <label>Rate column {input('rateColumn', { value: draft.rateColumn, onChange: (e) => set({ rateColumn: e.target.value }), 'data-money-rate-column': true })}</label>}
          {draft.rateSource === 'table' && (
            <div data-money-rate-table>
              {['table', 'currency_column', 'base_column', 'date_column', 'rate_column'].map((key) => (
                <label key={key} className="block">{key.replace('_', ' ')} {input('rateTable', { value: draft.rateTable[key], onChange: (e) => set({ rateTable: { ...draft.rateTable, [key]: e.target.value } }), [`data-money-table-${key}`]: true })}</label>
              ))}
            </div>
          )}
          {draft.rateSource === 'typed' && draft.rates.map((row, i) => (
            <div key={i} className="money-rate-row">
              <input dir="auto" aria-label="Currency code"  value={row.code} onChange={(e) => setRate(i, { code: e.target.value })} data-money-rate-code />
              <input dir="auto" aria-label="Rate in base currency"  value={row.rate} onChange={(e) => setRate(i, { rate: e.target.value })} data-money-rate />
              <button type="button" className="lnk" onClick={() => set({ rates: draft.rates.filter((_, at) => at !== i) })}>Remove</button>
            </div>
          ))}
          {draft.rateSource === 'typed' && <button type="button" className="lnk" onClick={() => set({ rates: [...draft.rates, { code: '', rate: '' }] })} data-money-add-rate>Add a rate</button>}
        </div>
      )}
    </div>
  );
}
