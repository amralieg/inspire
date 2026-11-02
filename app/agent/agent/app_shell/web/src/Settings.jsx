import { useEffect, useRef, useState } from 'react';
import { failureOf, getSettings, previewSetting, runSettingsNow, saveSetting, toneOf } from './api.js';
import { dayLabel } from './format.js';
import { Icon } from './icons.jsx';
import { Failure, useToast } from './ui.jsx';
import { groupsOf, historyLines, inputText, ownerSettings, settingProblem, storedText, valueText } from './settings.js';
import { MyViewGroup } from './MyView.jsx';

const NOTE_CHARS = 300;
const PREVIEW_MS = 400;

export function useSettings(pageId, nonce = 0) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    getSettings(pageId).then((d) => { if (live) setData(d); }).catch(() => { if (live) setData(null); });
    return () => { live = false; };
  }, [pageId, nonce]);
  return [data, setData];
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
  if (!setting.choices?.length) return <input name={`setting_${setting.name}`} value={text} onChange={(e) => onText(e.target.value)} />;
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
  const [saving, setSaving] = useState(false);
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
    setSaving(true);
    setFailure(null);
    try {
      onSaved(await saveSetting({ page: pageId, name: setting.name, value, was: setting.value, note: note.trim() }), value);
    } catch (err) {
      setFailure(failureOf(err));
    } finally {
      setSaving(false);
    }
  };
  const unit = setting.kind === 'percent' ? ' (%)' : setting.unit ? ` (${setting.unit})` : '';
  return (
    <form className="edit" onSubmit={save} noValidate>
      <label className="in"><span>{setting.label}{unit}</span>
        {setting.kind === 'choice'
          ? <Choice setting={setting} text={text} onText={setText} />
          : <input ref={input} name={`setting_${setting.name}`} inputMode={setting.whole ? 'numeric' : 'decimal'} value={text}
            onChange={(e) => setText(e.target.value)} aria-invalid={problem ? true : undefined} />}
      </label>
      <label className="in"><span>Why it changed</span>
        <input className="note" name="setting_note" maxLength={NOTE_CHARS} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <button type="submit" className="btn btn--pri" disabled={saving || !!problem}><Icon name="check" size={14} />{saving ? 'Saving…' : 'Save'}</button>
      <button type="button" className="btn" onClick={onCancel} disabled={saving}>Cancel</button>
      {problem && text.trim() !== '' && <p className="err" role="alert">{problem}</p>}
      {preview && <p className="preview" role="status" data-preview>{preview}</p>}
      <Failure failure={failure} className="err">{failure?.text}</Failure>
    </form>
  );
}

export function SettingsButton({ open, onOpen, owned }) {
  return (
    <button className={`btn ${open ? 'is-on' : ''}`} onClick={() => onOpen((o) => !o)} aria-expanded={open} data-settings-open
      title={owned ? 'Change how this use case works out its impact and flags its records, and what the lists show you' : 'Choose what the lists show you'}>
      <Icon name="sliders" size={15} />Settings
    </button>
  );
}

export default function SettingsPanel({ pageId, data, onData, onChanged, onRunStarted, onClose }) {
  const [editing, setEditing] = useState('');
  const [running, setRunning] = useState(false);
  const toast = useToast();
  const owned = ownerSettings(data);
  const saved = (next, value) => {
    const setting = data.settings.find((s) => s.name === editing);
    onData(next);
    setEditing('');
    toast(`${setting.label} is ${valueText(setting, value)} now. The next run uses it.`);
    onChanged?.();
  };
  const run = async () => {
    setRunning(true);
    try {
      const started = await runSettingsNow(pageId);
      toast(`The run is ${started.state || 'starting'}; the page shows its progress at the top.`);
      onRunStarted?.();
    } catch (err) {
      toast(err.message, toneOf(err));
    } finally {
      setRunning(false);
    }
  };
  const lines = owned ? historyLines(data.history, data.settings) : [];
  const last = Object.fromEntries([...(data?.history || [])].reverse().map((h) => [h.name, h]));
  return (
    <section className="money settings" aria-label="Settings" data-settings>
      <div className="set-head">
        <h2>Settings</h2>
        {owned && data.can_run && <button type="button" className="btn" onClick={run} disabled={running} data-run-now><Icon name="trend" size={14} />{running ? 'Starting…' : 'Run now'}</button>}
        <button type="button" className="btn" onClick={onClose} aria-label="Close the settings"><Icon name="x" size={14} /></button>
      </div>
      <MyViewGroup />
      {owned && <p className="why">A saved value applies at the next run of this use case. Every change keeps its note and who made it.</p>}
      {owned && groupsOf(data.settings).map(([group, title, list]) => (
        <div key={group} className="tbl-wrap" data-group={group}>
          <h3>{title}</h3>
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
      ))}
      {lines.length > 0 && <div className="hist"><b>Changes</b><ul>{lines.map((l, i) => <li key={i}>{l}</li>)}</ul></div>}
    </section>
  );
}
