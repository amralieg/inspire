import { useEffect, useRef, useState } from 'react';
import { failureOf, getSettings, previewSetting, saveSetting } from './api.js';
import { dayLabel } from './format.js';
import { Icon } from './icons.jsx';
import { Failure, useToast, PlainNote, useRetry } from './ui.jsx';
import { SaveButton, runWrite, useWrite } from './saving.jsx';
import { groupsOf, historyLines, inputText, ownerSettings, savedText, settingProblem, storedText, valueText } from './settings.js';
import { MyViewGroup } from './MyView.jsx';
import { SectionHelp } from './SectionHelp.jsx';

const NOTE_CHARS = 300;
const PREVIEW_MS = 400;

export function useSettings(pageId, nonce = 0) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    getSettings(pageId).then((d) => { if (live) { setData(d); setError(''); } }).catch((e) => { if (live) { setData(null); setError(e.message); } });
    return () => { live = false; };
  }, [pageId, nonce]);
  return [data, setData, error];
}


function Choice({ setting, text, onText }) {
  if (!setting.many) {
    return (
      <select name={`setting_${setting.name}`} value={text} onChange={(e) => onText(e.target.value)}>
        {[...new Set([text, ...(setting.choices || [])])].filter((c) => c !== '').map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    );
  }
  const picked = text === 'all' ? [] : text.split(',').map((p) => p.trim()).filter(Boolean);
  const pick = (choice, on) => {
    const next = on ? [...picked, choice] : picked.filter((p) => p !== choice);
    onText(next.length ? next.join(', ') : 'all');
  };
  if (!setting.choices?.length) return <input dir="auto" name={`setting_${setting.name}`} value={text} onChange={(e) => onText(e.target.value)} />;
  return (
    <span className="set-many">
      <label><input type="checkbox" checked={text === 'all'} onChange={(e) => onText(e.target.checked ? 'all' : picked.join(', '))} />Every segment</label>
      {setting.choices.map((c) => (
        <label key={c}><input type="checkbox" checked={picked.includes(c)} disabled={text === 'all'} onChange={(e) => pick(c, e.target.checked)} />{c}</label>
      ))}
    </span>
  );
}

function Editor({ pageId, setting, onSaved, onCancel }) {
  const [text, setText] = useState(inputText(setting, setting.value));
  const [note, setNote] = useState('');
  const [failure, setFailure] = useState(null);
  const saving = useWrite().busy;
  const [preview, setPreview] = useState('');
  const input = useRef(null);
  useEffect(() => { input.current?.focus(); }, []);
  const value = storedText(setting, text);
  const problem = settingProblem(setting, value);
  useEffect(() => {
    setPreview('');
    if (problem || value === String(setting.value ?? '')) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      previewSetting({ page: pageId, name: setting.name, value }).then((p) => { if (live) setPreview(p.text); })
        .catch((e) => { if (live) setPreview(e.message); });
    }, PREVIEW_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [value, problem]);
  const save = async (e) => {
    e.preventDefault();
    if (problem) return;
    setFailure(null);
    await runWrite(`setting:${setting.name}`, async () => {
      try {
        onSaved(await saveSetting({ page: pageId, name: setting.name, value, was: setting.value, note: note.trim() }), value);
      } catch (err) {
        setFailure(failureOf(err));
      }
    });
  };
  const unit = setting.kind === 'percent' ? ' (%)' : setting.unit ? ` (${setting.unit})` : '';
  return (
    <form className="edit" onSubmit={save} noValidate>
      <label className="in"><span>{setting.label}{unit}</span>
        {setting.kind === 'choice'
          ? <Choice setting={setting} text={text} onText={setText} />
          : <input dir="auto" ref={input} name={`setting_${setting.name}`} inputMode={setting.whole ? 'numeric' : 'decimal'} value={text}
            onChange={(e) => setText(e.target.value)} aria-invalid={problem ? true : undefined} />}
      </label>
      <label className="in"><span>Why it changed</span>
        <input dir="auto" className="note" name="setting_note" maxLength={NOTE_CHARS} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <SaveButton write={`setting:${setting.name}`} type="submit" className="btn btn--pri" disabled={!!problem}><Icon name="check" size={14} />Save</SaveButton>
      <button type="button" className="btn" onClick={onCancel} disabled={saving}>Cancel</button>
      {problem && text.trim() !== '' && <PlainNote text={problem} className="err" role="alert" />}
      {preview && <p className="preview" role="status" data-preview>{preview}</p>}
      <Failure failure={failure} className="err">{failure?.text}</Failure>
    </form>
  );
}

export function SettingsGroupTable({ id, title, list, pageId, last, editing, setEditing, saved }) {
  return (
    <div className="tbl-wrap" data-group={id}>
      {title && <h3>{title}</h3>}
      <table>
        <thead><tr><th>Setting</th><th>Value</th><th>Last change</th><th><span className="sr">Change</span></th></tr></thead>
        <tbody>
          {list.map((s) => (
            <tr key={s.name} data-setting={s.name}>
              <td><b>{s.label}</b><br /><small>{s.help}{s.allowed ? ` Allowed: ${s.allowed}.` : ''}</small></td>
              <td className="num">{editing === s.name
                ? <Editor pageId={pageId} setting={s} onSaved={saved} onCancel={() => setEditing('')} />
                : valueText(s, s.value)}</td>
              <td>{last[s.name] ? `${last[s.name].changed_by || 'someone'}${last[s.name].changed_at ? `, ${dayLabel(String(last[s.name].changed_at).slice(0, 10))}` : ''}` : s.reason}</td>
              <td>{s.editable
                ? editing !== s.name && <button type="button" className="btn" onClick={() => setEditing(s.name)} aria-label={`Change ${s.label}`}><Icon name="edit" size={14} />Change</button>
                : <small>Change it on the Build page of the Inspire App</small>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SettingsPanel({ pageId, data, error = '', onData, onChanged, onRun, running, onClose, children, footer = null }) {
  const [editing, setEditing] = useState('');
  const toast = useToast();
  const retry = useRetry();
  const writing = useWrite().busy;
  const owned = ownerSettings(data);
  const saved = (next, value) => {
    const setting = data.settings.find((s) => s.name === editing);
    onData(next);
    setEditing('');
    toast(savedText(setting, value));
    onChanged?.();
  };
  const lines = owned ? historyLines(data.history, data.settings) : [];
  const last = Object.fromEntries([...(data?.history || [])].reverse().map((h) => [h.name, h]));
  const targetRows = (data?.settings || []).filter((s) => s.group === 'measurement');
  return (
    <section className="money settings" aria-label="Settings" data-settings>
      <div className="set-head">
        <h2>Settings</h2>
        {owned && data.can_run && onRun && <button type="button" className="btn" onClick={() => onRun()} disabled={running || writing} aria-busy={running} data-run-now><Icon name="trend" size={14} />{running ? 'Starting…' : 'Run now'}</button>}
        {onClose && <button type="button" className="btn" onClick={onClose} aria-label="Close the settings"><Icon name="x" size={14} /></button>}
      </div>
      <MyViewGroup />
      {error && <PlainNote text={error} prefix="The settings of this use case could not load: " icon={<Icon name="info" size={14} />} className="tile-err" role="alert" onRetry={retry} />}
      {children}
      {owned && targetRows.length > 0 && <SettingsGroupTable title={null} list={targetRows} pageId={pageId} last={last} editing={editing} setEditing={setEditing} saved={saved} />}
      {owned && <p className="why">A saved value applies at the next run of this use case. Every change keeps its note and who made it.</p>}
      {owned && groupsOf(data.settings).map(([group, title, list]) => (
        <SettingsGroupTable key={group} id={group} title={title} list={list} pageId={pageId} last={last} editing={editing} setEditing={setEditing} saved={saved} />
      ))}
      {lines.length > 0 && <div className="hist"><b>Changes</b><ul>{lines.map((l, i) => <li key={i}>{l}</li>)}</ul></div>}
      {footer}
    </section>
  );
}

export function SettingGroup({ id, title, why, children }) {
  return (
    <div className="tbl-wrap set-group" data-group={id}>
      <h3>{title}</h3>
      {why && <SectionHelp title={title} steps={[{ title, text: why }]} />}
      {why && <p className="why">{why}</p>}
      <div className="set-items">{children}</div>
    </div>
  );
}
