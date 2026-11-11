import { useCallback, useEffect, useState } from 'react';
import { failureOf, getFields, getHistory, writeRecord } from './api.js';
import {
  addedValues, changedValues, columnLabel, editableFields, formProblems, formValues, inputOf, isStaleRecord, suggestions, whenText, whoText,
} from './records.js';
import { Icon } from './icons.jsx';
import { Failure, Skeleton, useDialog, useToast, PlainNote } from './ui.jsx';
import { SaveButton, runWrite, useWrite } from './saving.jsx';

function Field({ field, value, meta, problem, options, required, onChange }) {
  const spec = inputOf(field, value);
  const list = spec.tag === 'input' && spec.type === 'text' && options.length ? `dl-${field.name}` : undefined;
  const common = { name: field.name, value, required, 'aria-invalid': problem ? true : undefined, onChange: (e) => onChange(field.name, e.target.value) };
  return (
    <label className={`in ${spec.wide ? 'in--wide' : ''}`}>
      <span>{columnLabel(field.name, meta)}{required ? ' *' : ''}{spec.hint && <small> · {spec.hint}</small>}</span>
      {spec.tag === 'select' && <select {...common}><option value="">Not set</option><option value="true">Yes</option><option value="false">No</option></select>}
      {spec.tag === 'textarea' && <textarea dir="auto" {...common} rows={spec.rows} />}
      {spec.tag === 'input' && <input dir="auto" {...common} type={spec.type} step={spec.step} inputMode={spec.inputMode} list={list} autoComplete="off" />}
      {list && <datalist id={list}>{options.map((v) => <option key={v} value={v} />)}</datalist>}
      {problem && <PlainNote text={problem} as="small" className="in-err" />}
    </label>
  );
}

export default function RecordForm({ mode, target, meta, pageId, rows, onClose, onSaved }) {
  const ref = useDialog(true, onClose);
  const toast = useToast();
  const [load, setLoad] = useState({ busy: true, error: '', data: null });
  const [form, setForm] = useState({});
  const [problems, setProblems] = useState({});
  const [failure, setFailure] = useState(null);
  const saving = useWrite().busy;
  const adding = mode === 'add';
  const targetKey = JSON.stringify(target || {});

  const fetchRecord = useCallback(() => {
    setLoad({ busy: true, error: '', data: null });
    setFailure(null);
    setProblems({});
    return (adding ? getFields(pageId) : getHistory(pageId, JSON.parse(targetKey)))
      .then((data) => { setLoad({ busy: false, error: '', data }); setForm(formValues(data.fields, adding ? null : data.current, adding ? data.key_field : null)); })
      .catch((e) => setLoad({ busy: false, error: e.message, data: null }));
  }, [adding, pageId, targetKey]);
  useEffect(() => { fetchRecord(); }, [fetchRecord]);

  const { data } = load;
  const keyField = adding ? data?.key_field : null;
  const fields = data ? [...(data.fields || []).filter((f) => f.name === keyField), ...editableFields(data.fields)] : [];
  const gone = !adding && data && (!data.current || data.deleted);
  const set = (name, value) => { setForm((f) => ({ ...f, [name]: value })); setProblems((p) => ({ ...p, [name]: undefined })); };

  const submit = async (e) => {
    e.preventDefault();
    const found = formProblems(data.fields, form, keyField);
    setProblems(found);
    if (Object.values(found).some(Boolean)) return;
    const values = adding ? addedValues(data.fields, form, keyField) : changedValues(data.fields, data.current, form);
    if (!adding && !Object.keys(values).length) {
      toast('Nothing changed');
      onClose();
      return;
    }
    const body = adding ? { page: pageId, values } : { page: pageId, record_key: data.record_key, valid_from_us: data.current.valid_from_us, values };
    setFailure(null);
    await runWrite(`record:${mode}`, async () => {
      try {
        const saved = await writeRecord(mode, body);
        toast(adding ? 'Record added. Its history starts here.' : 'Saved as a new version. The earlier one stays in the history.');
        onSaved(saved);
      } catch (err) {
        setFailure({ ...failureOf(err), stale: isStaleRecord(err) && !adding });
      }
    });
  };

  const title = adding ? 'Add a record' : `Edit ${data?.current ? String(data.current[meta.label] ?? data.record_key) : 'record'}`;
  return (
    <dialog ref={ref} className="dialog" aria-label={title} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <form className="dlg dlg--form" onSubmit={submit} noValidate>
        <header>
          <h2>{title}</h2>
          <p>{adding ? 'The record joins the decision list as its first version, written by you.' : 'Your change is saved as a new version. The earlier version stays in the history.'}</p>
          {!adding && data?.current && <p className="dlg-meta"><Icon name="history" size={13} />Last change by {whoText(data.current)} on {whenText(data.current.valid_from)}</p>}
        </header>
        <div className="dlg-b">
          {load.busy && <div className="fgrid">{[1, 2, 3, 4].map((i) => <Skeleton key={i} height={52} />)}</div>}
          {load.error && <PlainNote text={load.error} icon={<Icon name="info" size={14} />} className="tile-err" role="alert" onRetry={fetchRecord} />}
          {gone && <p className="tile-err" role="alert"><Icon name="info" size={14} />{data.current ? `${whoText(data.current)} deleted this record on ${whenText(data.current.valid_from)}.` : 'This record is no longer current.'}</p>}
          {data && !gone && !fields.length && <p className="more">The result table has no column people can change here.</p>}
          {data && !gone && fields.length > 0 && (
            <div className="fgrid">
              {fields.map((f) => (
                <Field key={f.name} field={f} value={form[f.name] ?? ''} meta={meta} problem={problems[f.name]} required={f.name === keyField}
                  options={f.kind === 'text' ? suggestions(rows, f.name) : []} onChange={set} />
              ))}
            </div>
          )}
          <Failure failure={failure} as="div" className="hint hint--box">
            <Icon name="info" size={14} /><span>{failure?.text}</span>
            {failure?.stale && <button type="button" className="link" onClick={fetchRecord}><Icon name="undo" size={13} />Reload the record</button>}
          </Failure>
        </div>
        <footer>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <SaveButton write={`record:${mode}`} type="submit" className="btn btn--pri" disabled={load.busy || !data || gone || !fields.length}
            why={gone ? 'This record is no longer current, so it cannot change.' : data && !fields.length ? 'The result table has no column people can change here.' : ''}>
            {adding ? <><Icon name="plus" size={14} />Add record</> : <><Icon name="check" size={14} />Save</>}
          </SaveButton>
        </footer>
      </form>
    </dialog>
  );
}

export function DeleteDialog({ target, pageId, label, onClose, onSaved }) {
  const ref = useDialog(true, onClose);
  const toast = useToast();
  const [load, setLoad] = useState({ busy: true, error: '', data: null });
  const [failure, setFailure] = useState(null);
  const saving = useWrite().busy;
  const targetKey = JSON.stringify(target);
  const fetchRecord = useCallback(() => {
    setLoad({ busy: true, error: '', data: null });
    setFailure(null);
    getHistory(pageId, JSON.parse(targetKey)).then((data) => setLoad({ busy: false, error: '', data })).catch((e) => setLoad({ busy: false, error: e.message, data: null }));
  }, [pageId, targetKey]);
  useEffect(() => { fetchRecord(); }, [fetchRecord]);
  const { data } = load;
  const confirm = async (e) => {
    e.preventDefault();
    await runWrite('record:delete', async () => {
      try {
        const saved = await writeRecord('delete', { page: pageId, record_key: data.record_key, valid_from_us: data.current.valid_from_us });
        toast('Record deleted. Its history is kept.');
        onSaved(saved);
      } catch (err) {
        setFailure(failureOf(err));
      }
    });
  };
  const gone = data && (!data.current || data.deleted);
  return (
    <dialog ref={ref} className="dialog" aria-label={`Delete ${label}`} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <form className="dlg" onSubmit={confirm}>
        <header>
          <h2>Delete {label}?</h2>
          <p>The record leaves the decision list. Its history keeps every version, with your name on the deletion.</p>
          {data?.current && !gone && <p className="dlg-meta"><Icon name="history" size={13} />Last change by {whoText(data.current)} on {whenText(data.current.valid_from)}</p>}
        </header>
        {load.error && <PlainNote text={load.error} icon={<Icon name="info" size={14} />} className="tile-err" role="alert" onRetry={fetchRecord} />}
        {gone && <p className="tile-err" role="alert"><Icon name="info" size={14} />This record is already deleted.</p>}
        <Failure failure={failure} as="div" className="hint hint--box">
          <Icon name="info" size={14} /><span>{failure?.text}</span>
          {!failure?.calm && <button type="button" className="link" onClick={fetchRecord}><Icon name="undo" size={13} />Reload</button>}
        </Failure>
        <footer>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <SaveButton write="record:delete" type="submit" className="btn btn--danger" disabled={load.busy || !data || gone}
            why={gone ? 'This record is no longer current, so it cannot be deleted.' : ''}><Icon name="trash" size={14} />Delete</SaveButton>
        </footer>
      </form>
    </dialog>
  );
}
