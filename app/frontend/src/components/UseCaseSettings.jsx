import { useEffect, useRef, useState } from 'react';
import { Loader2, Pencil, Play, SlidersHorizontal } from 'lucide-react';
import { PANEL_CLASS, SectionTitle } from './BuildUi';
import { ScopeSection } from './ScopeSettings';
import { SETTINGS_NEXT_RUN, SETTINGS_SAVED, SETTING_GROUPS, settingGroupTitle, settingHistoryLine, settingValueText } from '../lib/useCaseSettings';
import { isScopeSetting } from '../lib/runScope';

const BUTTON = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50';
const INPUT = 'px-2 py-1 text-[12px] border border-border rounded-md bg-surface text-text-primary w-28';
const PREVIEW_DELAY_MS = 400;

function SettingRow({ setting, editable, draft, onDraft }) {
  const value = String(setting.value ?? '');
  return (
    <div data-setting={setting.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2 first:border-t-0 first:pt-0">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-text-primary" title={setting.help || undefined}>{setting.label || setting.name}</p>
        <p className="text-[11px] text-text-secondary">
          <span data-setting-source="">{setting.saved ? SETTINGS_SAVED : setting.reason || 'Set when the use case was built'}</span>
          {setting.allowed && <> · Allowed: {setting.allowed}</>}
        </p>
      </div>
      <span className="font-mono text-[13px] text-text-primary"><span data-setting-value="">{settingValueText(setting, value)}</span></span>
      {editable && setting.editable !== false && (
        <input aria-label={setting.label || setting.name} className={INPUT} value={draft?.name === setting.name ? draft.value : value}
          onChange={(e) => onDraft({ name: setting.name, value: e.target.value, was: value, label: setting.label || setting.name })} />
      )}
    </div>
  );
}

export default function UseCaseSettings({ view, error = '', readOnly = false, impact = null, scope = null, apiPostJson = null, onPreview, onSave, onRun, onEdit, children = null }) {
  const [draft, setDraft] = useState(null);
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const asked = useRef(0);
  const editable = Boolean(view?.editable) && !readOnly;
  useEffect(() => {
    if (!draft || !editable || draft.value === draft.was) {
      setPreview(null);
      return undefined;
    }
    const ticket = asked.current + 1;
    asked.current = ticket;
    const timer = setTimeout(async () => {
      try {
        const got = await onPreview(draft.name, draft.value);
        if (asked.current === ticket) setPreview({ text: String(got?.text || ''), error: '' });
      } catch (e) {
        if (asked.current === ticket) setPreview({ text: '', error: e.message });
      }
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, editable, onPreview]);
  if (error) {
    if (readOnly) return null;
    return (
      <section role="region" aria-label="Settings" className={`${PANEL_CLASS} p-4 space-y-3 text-[12px]`}>
        <p className="text-error-fg">Inspire could not read the settings: {error}</p>
        {children}
      </section>
    );
  }
  if (!view) return null;
  const settings = Array.isArray(view.settings) ? view.settings : [];
  const plain = settings.filter((s) => !isScopeSetting(s));
  const groups = [...SETTING_GROUPS, ''].map((group) => [group, plain.filter((s) => (group ? s.group === group : !SETTING_GROUPS.includes(s.group)))])
    .filter(([, list]) => list.length);
  const history = Array.isArray(view.history) ? view.history.slice(0, 8) : [];
  const save = async () => {
    setBusy('save');
    setMessage('');
    try {
      await onSave(draft.name, draft.value, draft.was, note.trim());
      setDraft(null);
      setNote('');
      setMessage(`Saved ${draft.label}. ${SETTINGS_NEXT_RUN}`);
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy('');
    }
  };
  const run = async () => {
    setBusy('run');
    setMessage('');
    try {
      await onRun();
      setMessage('The run started; stored results follow when it ends.');
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy('');
    }
  };
  return (
    <section role="region" aria-label="Settings" className={PANEL_CLASS}>
      <SectionTitle icon={SlidersHorizontal} title="Settings" hint="How this use case counts what is at stake and flags records; owners change them" />
      <div className="p-4 space-y-3 text-[12px]">
        {view.why && <p data-settings-why="" className="text-text-secondary">{view.why}</p>}
        <ScopeSection settings={settings} editable={editable} scope={scope} onSave={onSave} apiPostJson={apiPostJson} />
        {groups.map(([group, list]) => (
          <div key={group || 'other'} data-setting-group={group || 'other'} className="space-y-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-secondary">{settingGroupTitle(group, impact)}</h4>
            {list.map((s) => <SettingRow key={s.name} setting={s} editable={editable} draft={draft} onDraft={setDraft} />)}
          </div>
        ))}
        {editable && draft && draft.value !== draft.was && (
          <div className="space-y-2 rounded-lg border border-border bg-bg-subtle/50 px-3 py-2.5">
            <p data-setting-preview="" className="text-text-primary">
              {preview?.error ? `Inspire could not preview it: ${preview.error}` : preview ? preview.text : 'Working out which records it moves'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input aria-label="Note for the change" placeholder="Why, for the history (optional)" maxLength={300} className={`${INPUT} w-64`} value={note}
                onChange={(e) => setNote(e.target.value)} />
              <button type="button" disabled={busy !== ''} onClick={save} className={`${BUTTON} text-white bg-db-red-solid`}>
                {busy === 'save' ? <Loader2 size={12} className="animate-spin" /> : null}Save {draft.label}
              </button>
            </div>
          </div>
        )}
        {settings.length > 0 && <p className="text-text-secondary">{SETTINGS_NEXT_RUN}</p>}
        {message && <p role="status" className="text-text-primary">{message}</p>}
        {!readOnly && view.can_run && (
          <button type="button" disabled={busy !== ''} onClick={run} className={`${BUTTON} border border-border bg-surface text-text-primary`}>
            {busy === 'run' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Run now
          </button>
        )}
        {!readOnly && view.source === 'recorded' && !view.app && onEdit && settings.length > 0 && (
          <button type="button" onClick={onEdit} className={`${BUTTON} border border-border bg-surface text-text-primary`}>
            <Pencil size={12} /> Change them in all settings
          </button>
        )}
        {history.length > 0 && (
          <ul aria-label="Setting changes" className="list-disc pl-5 text-text-secondary">
            {history.map((entry, i) => <li key={`${entry.name}-${entry.changed_at}-${i}`}>{settingHistoryLine(entry, settings)}</li>)}
          </ul>
        )}
        {children}
      </div>
    </section>
  );
}
