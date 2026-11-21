import { useRef, useState } from 'react';

// REQ-457: "How the MVP measures it". One read-only row per measure setting, then Keep (default) or Edit. Edit shows the editor the wizard passes
// (so this file never imports the wizard); Keep hides it and hands back the values the section had when it mounted, so the wizard restores them.
const choice = (on) => `rounded-md border px-3 py-1 text-sm ${on ? 'border-db-red-solid bg-db-red-solid text-white' : 'border-border text-text-secondary hover:bg-bg-subtle'}`;

export default function MeasureSettings({ measure }) {
  const snapshot = useRef(measure?.values);
  const [editing, setEditing] = useState(Boolean(measure?.open));
  if (!measure) return null;
  const keep = () => { setEditing(false); measure.onKeep?.(snapshot.current); };
  return (
    <section data-measure-settings="" aria-label="How the MVP measures it" className="max-w-full space-y-2 rounded-lg border border-border bg-bg-subtle px-3 py-2">
      <h4 className="text-[13px] font-semibold text-text-primary">How the MVP measures it</h4>
      <dl className="grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px]">
        {measure.rows.map((r) => (
          <div key={r.id} data-measure-row={r.id} className="contents">
            <dt className="text-text-secondary">{r.label}</dt>
            <dd className="min-w-0 break-words text-text-primary">{r.summary}</dd>
          </div>
        ))}
      </dl>
      <div role="radiogroup" aria-label="Keep or edit the measure settings" className="flex gap-2">
        <button type="button" role="radio" aria-checked={!editing} data-measure-keep="" className={choice(!editing)} onClick={keep}>Keep</button>
        <button type="button" role="radio" aria-checked={editing} data-measure-edit="" className={choice(editing)} onClick={() => setEditing(true)}>Edit</button>
      </div>
      {editing && <div data-measure-editor="" className="border-t border-border pt-2">{measure.editor}</div>}
    </section>
  );
}
