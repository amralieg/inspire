import { useRef, useState } from 'react';
import { addView, readViews, removeView, sameView, writeViews } from './links.js';
import { Icon } from './icons.jsx';
import { Popover, useDialog, useToast, PlainNote } from './ui.jsx';

function browserStorage() {
  try { return window.localStorage; } catch { return null; }
}

function SaveDialog({ onSave, onClose }) {
  const ref = useDialog(true, onClose);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState('');
  const submit = (e) => {
    e.preventDefault();
    setProblem(onSave(name));
  };
  return (
    <dialog ref={ref} className="dialog" aria-label="Save this view" onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <form className="dlg" onSubmit={submit} noValidate>
        <header>
          <h2>Save this view</h2>
          <p>Keeps the filters and the view of this page in this browser, so you can come back to them in one click.</p>
        </header>
        <label className="in">Name<input dir="auto" autoFocus value={name} onChange={(e) => { setName(e.target.value); setProblem(''); }} placeholder="For example, Weekly review" /></label>
        {problem && <PlainNote text={problem} className="hint" role="alert" />}
        <footer>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--pri"><Icon name="bookmark" size={14} />Save view</button>
        </footer>
      </form>
    </dialog>
  );
}

function DeleteViewDialog({ name, onConfirm, onClose }) {
  const ref = useDialog(true, onClose);
  return (
    <dialog ref={ref} className="dialog" aria-label={`Delete the view ${name}`} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <form className="dlg" onSubmit={(e) => { e.preventDefault(); onConfirm(); }}>
        <header>
          <h2>Delete the view "{name}"?</h2>
          <p>It leaves this browser. The data on the page does not change.</p>
        </header>
        <footer>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--danger"><Icon name="trash" size={14} />Delete</button>
        </footer>
      </form>
    </dialog>
  );
}

export default function ViewsMenu({ pageId, current, ready, onApply }) {
  const toast = useToast();
  const button = useRef(null);
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState({});
  const [saving, setSaving] = useState(false);
  const [doomed, setDoomed] = useState('');
  const list = all[pageId] || [];
  const toggle = () => {
    if (!open) setAll(readViews(browserStorage()));
    setOpen(!open);
  };
  const save = (name) => {
    const { all: next, problem } = addView(readViews(browserStorage()), pageId, { name, ...current });
    if (problem) return problem;
    if (!writeViews(browserStorage(), next)) return 'This browser did not let the App save the view.';
    setAll(next);
    setSaving(false);
    toast(`Saved the view "${name.trim()}"`);
    return '';
  };
  const remove = () => {
    const next = removeView(readViews(browserStorage()), pageId, doomed);
    if (writeViews(browserStorage(), next)) {
      setAll(next);
      toast(`Deleted the view "${doomed}"`);
    } else {
      toast('This browser did not let the App delete the view', 'error');
    }
    setDoomed('');
  };
  return (
    <>
      <button ref={button} className="btn top-ic" onClick={toggle} aria-haspopup="dialog" aria-expanded={open} aria-label="Views"><Icon name="bookmark" size={14} /><span>Views</span></button>
      {open && (
        <Popover anchor={button.current} onClose={() => setOpen(false)} label="Saved views" width={290}>
          <div className="vmenu">
            <button className="vmenu-save" autoFocus onClick={() => { setOpen(false); setSaving(true); }} disabled={!ready}><Icon name="plus" size={14} />Save this view</button>
            <div className="vmenu-h">Saved views</div>
            {!list.length && <p className="vmenu-none">No saved views yet. Save the filters you use often to come back to them in one click.</p>}
            {list.map((v) => {
              const on = sameView(v, current);
              return (
                <div key={v.name} className="vmenu-i">
                  <button className="vmenu-apply" onClick={() => { setOpen(false); button.current?.focus(); onApply(v); }} aria-current={on ? 'true' : undefined} disabled={!ready}>
                    <Icon name={on ? 'check' : 'bookmark'} size={14} /><span className="trunc">{v.name}</span>
                  </button>
                  <button className="ibtn ibtn--sm" onClick={() => { setOpen(false); setDoomed(v.name); }} aria-label={`Delete the view ${v.name}`}><Icon name="trash" size={14} /></button>
                </div>
              );
            })}
          </div>
        </Popover>
      )}
      {saving && <SaveDialog onSave={save} onClose={() => setSaving(false)} />}
      {doomed && <DeleteViewDialog name={doomed} onConfirm={remove} onClose={() => setDoomed('')} />}
    </>
  );
}
