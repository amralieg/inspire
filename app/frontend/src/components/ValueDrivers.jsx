import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { ATTRIBUTION, DRIVERS, DRIVER_TAG, driverFilled } from '../lib/valueDrivers';
import { MONEY_CURRENCY_CHOICES } from '../lib/moneyDefaults.js';

// REQ-435: the five value parts that are not in the data. Each folds until opened; its boxes are labeled from valueDrivers.json.
const box = 'w-28 rounded-md border border-border bg-surface px-2 py-1 text-sm tabular-nums text-text-primary';
const tag = 'rounded-full border border-border px-2 py-0.5 text-[10px] text-text-secondary';

function Part({ driver, typed, setValue, currency }) {
  const [open, setOpen] = useState(false);
  const filled = driverFilled(typed, driver);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <li className="rounded-md border border-border">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-start">
        <Chevron size={14} aria-hidden="true" />
        <span className="flex-1 text-sm font-semibold text-text-primary">{driver.label}</span>
        {filled && <span className="text-[10px] font-semibold text-success-fg">Filled</span>}
        <span className={tag}>{DRIVER_TAG}</span>
      </button>
      {open && (
        <div className="grid gap-2 border-t border-border px-3 py-2">
          {driver.inputs.map((i) => {
            const id = `vd-${driver.id}-${i.id}`;
            return (
              <div key={i.id} className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor={id} className="min-w-0 flex-1 text-[12px] text-text-secondary">{i.label}</label>
                <span className="flex items-center gap-1">
                  <input id={id} type="number" min="0" max={i.kind === 'pct' ? 100 : undefined} step="any" inputMode="decimal" value={typed?.[driver.id]?.[i.id] ?? ''}
                    onChange={(e) => setValue(driver.id, i.id, e.target.value)} className={box} />
                  <span className="w-9 text-[11px] text-text-tertiary">{i.kind === 'money' ? currency : i.kind === 'pct' ? '%' : ''}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </li>
  );
}

export default function ValueDrivers({ typed, setTyped, currency, setCurrency, currencyLocked, attribution, setAttribution }) {
  const setValue = (driverId, inputId, v) => setTyped((prev) => ({ ...prev, [driverId]: { ...(prev[driverId] || {}), [inputId]: v } }));
  return (
    <section aria-label="Value that is not in your data" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-text-primary">Your assumptions</h3>
        <span className={tag}>{DRIVER_TAG}</span>
        <span className="flex-1" />
        <label htmlFor="vd-currency" className="text-[12px] text-text-secondary">Currency of the amounts</label>
        <select id="vd-currency" value={currency} disabled={currencyLocked} onChange={(e) => setCurrency(e.target.value)}
          className="rounded-md border border-border bg-surface px-2 py-1 text-sm disabled:opacity-60">
          {MONEY_CURRENCY_CHOICES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <ul className="space-y-1.5">
        {DRIVERS.map((d) => <Part key={d.id} driver={d} typed={typed} setValue={setValue} currency={currency} />)}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor="vd-attribution" className="min-w-0 flex-1 text-[12px] text-text-secondary">{ATTRIBUTION.label}</label>
        <span className="flex items-center gap-1">
          <input id="vd-attribution" type="number" min={ATTRIBUTION.min} max={ATTRIBUTION.max} step="any" value={attribution}
            onChange={(e) => setAttribution(e.target.value)} className={box} />
          <span className="w-9 text-[11px] text-text-tertiary">%</span>
        </span>
      </div>
    </section>
  );
}
