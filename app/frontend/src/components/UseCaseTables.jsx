import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import DemoNote from './DemoNote';
import SourceTables from './SourceTables';
import { nextSpecFrom, pickedTable, primaryTableOf, removalBlocker, restoreTable, tablesOf } from '../lib/implementWizard';
import { PlainMessage } from './TechnicalDetails';

const SELECT = 'w-full px-2.5 py-1.5 text-[12px] border border-border rounded-md bg-surface text-text-primary';
const BUTTON = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50';

export default function UseCaseTables({ uc, latest, view, readOnly = false, locked = false, onSwaps, onClassify, onSave }) {
  const base = useMemo(() => {
    const spec = nextSpecFrom(latest);
    return { ...spec, data: { tables: {}, removed_tables: [], ...(spec.data || {}) } };
  }, [latest]);
  const [draft, setDraft] = useState(base);
  const [swaps, setSwaps] = useState({});
  const [swapsWhy, setSwapsWhy] = useState({});
  const [changing, setChanging] = useState({});
  const [notice, setNotice] = useState('');
  const [change, setChange] = useState(null);
  const [busy, setBusy] = useState(false);
  const asked = useRef(0);
  const editable = Boolean(view?.editable) && !readOnly;
  const changed = JSON.stringify(draft?.data || {}) !== JSON.stringify(base?.data || {});
  useEffect(() => {
    if (!editable || !changed) {
      setChange(null);
      return undefined;
    }
    const ticket = asked.current + 1;
    asked.current = ticket;
    let live = true;
    onClassify(draft).then(
      (got) => { if (live && asked.current === ticket) setChange({ class: got?.class ?? null, text: String(got?.text || ''), save: String(got?.save || ''), error: '' }); },
      (e) => { if (live && asked.current === ticket) setChange({ class: null, text: '', save: '', error: e.message }); },
    );
    return () => { live = false; };
  }, [draft, editable, changed, onClassify]);
  const tables = tablesOf(uc);
  if (!latest?.spec_json || !tables.length) return null;
  const toggle = (original) => {
    const open = !changing[original];
    setChanging((prev) => ({ ...prev, [original]: open }));
    if (!open || swaps[original] !== undefined) return;
    onSwaps(original).then(
      (got) => {
        setSwaps((prev) => ({ ...prev, [original]: got.swaps }));
        setSwapsWhy((prev) => ({ ...prev, [original]: got.why }));
      },
      (e) => { setSwaps((prev) => ({ ...prev, [original]: [] })); setNotice(e.message); },
    );
  };
  const pick = (original, value) => {
    const picked = pickedTable(draft, original, value);
    setDraft(picked.spec);
    if (picked.notice !== null) setNotice(picked.notice);
    setChanging((prev) => ({ ...prev, [original]: false }));
  };
  const save = async () => {
    setBusy(true);
    try {
      await onSave(draft);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-settings-tables="" className="space-y-2 border-t border-border pt-3">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-secondary">Tables</h4>
      {readOnly && <DemoNote />}
      {!readOnly && !editable && view?.why && <PlainMessage text={view.why} data-tables-why="" className="text-text-secondary" />}
      {notice && <p className="text-text-secondary">{notice}</p>}
      <SourceTables
        tables={tables}
        spec={draft}
        primary={primaryTableOf(uc)}
        swaps={swaps}
        swapsWhy={swapsWhy}
        changing={changing}
        blockerOf={(original) => removalBlocker(uc, draft, original)}
        readOnly={!editable}
        locked={locked || busy}
        selectClass={SELECT}
        onToggle={toggle}
        onPick={pick}
        onRestore={(original) => { setDraft((prev) => restoreTable(prev, original)); setNotice(''); }}
      />
      {editable && change && (change.text || change.error) && (
        <p data-table-change="" className={change.error ? 'text-error-fg' : 'text-text-primary'}>
          {change.error ? `Inspire could not compare the tables: ${change.error}` : change.text}
        </p>
      )}
      {editable && change && change.save && (
        <button type="button" disabled={locked || busy} onClick={save} className={`${BUTTON} text-white bg-db-red-solid`}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : null}{change.save}
        </button>
      )}
    </div>
  );
}
