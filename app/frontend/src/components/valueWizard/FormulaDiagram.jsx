import { factorsOf } from '../../lib/valueFormula.js';

// REQ-492: the formula as boxes: one per input, joined by signs into the result box. The numbers are the same ones the sentence under it shows; the result is the server's amount.
export default function FormulaDiagram({ driver, inputs, part, currency, amount }) {
  const { parts, longer } = factorsOf(driver, inputs, part, currency);
  if (longer || !parts.length || parts.includes(null)) return null;
  return (
    <div data-formula-diagram="" aria-hidden="true" className="flex min-w-0 flex-wrap items-center gap-1.5">
      {parts.map((p, k) => (
        <span key={k} className="contents">
          {k > 0 && <span data-diagram-op="" className="text-base font-bold text-text-secondary">×</span>}
          <span data-diagram-input={k} className="min-w-0 max-w-full rounded-md border border-border bg-bg px-2 py-1 text-[12px] font-semibold tabular-nums text-text-primary">{p}</span>
        </span>
      ))}
      <span data-diagram-op="" className="text-base font-bold text-text-secondary">=</span>
      <span data-diagram-result="" className="rounded-md border border-primary-solid bg-bg-subtle px-2.5 py-1 text-[13px] font-extrabold tabular-nums text-text-primary">{amount}</span>
    </div>
  );
}
