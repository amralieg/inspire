import { Suspense, lazy, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { counted } from '../lib/plural';
import { PROFILE_READING } from '../lib/groupingProfile';
import { SETTINGS_NEXT_RUN } from '../lib/useCaseSettings';
import {
  FIRST_RUN_KEEPS, GROUP_ALL, GROUP_BY, GROUP_CUSTOM, GROUP_KIND_WORDS, GROUPING_PLAIN, RUN_SCOPE, RUN_SCOPE_UNRECORDED, RUN_SCOPES, SCOPE_DAYS, SCOPE_GROUPS,
  SCOPE_LABELS, SCOPE_RECORDS, SCOPE_SAVE_LABEL, firstRunChoices, groupByColumns, groupingChoices, groupingExampleText, groupingMovesUpText, profileHeldText,
  sameGrouping, isScopeSetting, scopeChanges, scopeProblems, scopeValues, suggestedGroups, withUnrecordedScope,
} from '../lib/runScope';

const GroupingSqlEditor = lazy(() => import('./GroupingSqlEditor'));

const ROW = 'flex items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] text-text-primary';
const NUMBER = 'w-24 px-2 py-1 text-[12px] border border-border rounded-md bg-surface text-text-primary';
const NOTE = 'text-[11px] text-text-secondary';

function ProfileNote({ state, error }) {
  if (state === 'loading') {
    return (
      <p data-scope-profile="loading" className={`${NOTE} inline-flex items-center gap-1.5`}>
        <Loader2 size={12} className="animate-spin" aria-hidden /> {PROFILE_READING}
      </p>
    );
  }
  if (state === 'error') return <p role="alert" data-scope-profile="error" className="text-[11px] text-error-fg">Inspire could not read the table for its suggestions: {error}</p>;
  return null;
}

function GroupingPart({ values, onChange, profile, settings, editable, custom }) {
  const setting = settings.find((s) => s.name === GROUP_BY);
  const current = values[GROUP_BY] || GROUP_ALL;
  const isCustom = String(current).toLowerCase() === GROUP_CUSTOM;
  const listed = groupingChoices(profile, setting?.choices);
  const known = isCustom || listed.some((c) => c.value !== GROUP_CUSTOM && sameGrouping(c.value, current));
  const choices = known ? listed : [...listed.slice(0, -1), { value: current, label: groupByColumns(current).join(', then '), columns: groupByColumns(current) }, listed[listed.length - 1]];
  const pickedOf = (c) => (c.value === GROUP_CUSTOM ? isCustom : !isCustom && sameGrouping(c.value, current));
  const example = groupingExampleText(profile);
  const moves = groupingMovesUpText(profile);
  return (
    <fieldset aria-label={SCOPE_LABELS[GROUP_BY]} data-scope-part="grouping" className="space-y-2">
      <legend className="text-[12px] font-semibold text-text-primary">{SCOPE_LABELS[GROUP_BY]}</legend>
      <p data-grouping-why="" className={NOTE}>{GROUPING_PLAIN}{example ? ` ${example}` : ''}</p>
      {moves && <p data-grouping-moves="" className={NOTE}>{moves}</p>}
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {choices.map((c) => (
          <label key={c.value} data-grouping-choice={c.value} className={`${ROW} ${editable ? 'cursor-pointer' : ''}`}>
            <input type="radio" name="inspire-grouping" className="mt-0.5" checked={pickedOf(c)} disabled={!editable}
              onChange={() => { onChange(GROUP_BY, c.value); if (c.value === GROUP_CUSTOM) custom?.onPicked?.(); }} />
            <span className="min-w-0">
              <span className="font-medium">{c.label}</span>
              {c.recommended && <span data-grouping-recommended="" className="text-text-secondary"> · Recommended</span>}
            </span>
          </label>
        ))}
      </div>
      {isCustom && custom && (
        <Suspense fallback={<p data-grouping-sql-loading="" className={`${NOTE} inline-flex items-center gap-1.5`}><Loader2 size={12} className="animate-spin" aria-hidden /> Opening the SQL editor</p>}>
          <GroupingSqlEditor apiPostJson={custom.apiPostJson} profileKey={custom.profileKey} profile={profile} resultTable={custom.resultTable || ''}
            saved={custom.saved || null} editable={editable} onSaved={custom.onSaved} />
        </Suspense>
      )}
    </fieldset>
  );
}

function FirstRunPart({ values, onChange, profile, settings, editable, unrecorded }) {
  const setting = settings.find((s) => s.name === RUN_SCOPE);
  const allowed = Array.isArray(setting?.choices) && setting.choices.length ? setting.choices.map(String) : RUN_SCOPES;
  const current = values[RUN_SCOPE] || GROUP_ALL;
  const choices = firstRunChoices(profile, values)
    .filter((c) => allowed.includes(c.id) && (c.id === current || (profile ? c.available : true)));
  const groups = suggestedGroups(profile);
  const picked = groupByColumns(values[SCOPE_GROUPS]);
  const toggle = (value, on) => {
    const next = groups.map((g) => g.value).filter((v) => (v === value ? on : picked.some((p) => p.toLowerCase() === v.toLowerCase())));
    const kept = picked.filter((p) => !groups.some((g) => g.value.toLowerCase() === p.toLowerCase()));
    onChange(SCOPE_GROUPS, [...next, ...kept].join(', '));
  };
  const held = profileHeldText(profile);
  return (
    <fieldset aria-label={SCOPE_LABELS[RUN_SCOPE]} data-scope-part="first_run" className="space-y-2">
      <legend className="text-[12px] font-semibold text-text-primary">{SCOPE_LABELS[RUN_SCOPE]}</legend>
      {held && <p data-first-run-held="" className={NOTE}>{held}</p>}
      {unrecorded && <p data-first-run-unrecorded="" className={NOTE}>{RUN_SCOPE_UNRECORDED}</p>}
      {setting?.locked && <p data-first-run-locked="" className={NOTE}>{setting.locked}</p>}
      <div className="space-y-1.5">
        {choices.map((c) => (
          <div key={c.id} data-first-run-choice={c.id} className={`${ROW} flex-col`}>
            <label className={`flex items-start gap-2 ${editable ? 'cursor-pointer' : ''}`}>
              <input type="radio" name="inspire-first-run" className="mt-0.5" checked={current === c.id} disabled={!editable} onChange={() => onChange(RUN_SCOPE, c.id)} />
              <span className="min-w-0">
                <span className="font-medium">{c.label}</span>
                {c.records != null && <span data-first-run-records="" className="text-text-secondary"> · {counted(c.records, 'record')}</span>}
              </span>
            </label>
            {current === c.id && c.id === 'groups' && (groups.length ? (
              <div role="group" aria-label={SCOPE_LABELS[SCOPE_GROUPS]} className="ml-6 space-y-1">
                {groups.map((g) => (
                  <label key={g.value} data-scope-group={g.value} className="flex items-center gap-2">
                    <input type="checkbox" disabled={!editable} checked={picked.some((p) => p.toLowerCase() === g.value.toLowerCase())}
                      onChange={(e) => toggle(g.value, e.target.checked)} />
                    <span>{g.value}{GROUP_KIND_WORDS[g.kind] ? `, ${GROUP_KIND_WORDS[g.kind]}` : ''}{g.records != null ? ` · ${counted(g.records, 'record')}` : ''}</span>
                  </label>
                ))}
              </div>
            ) : (
              <label className="ml-6 flex items-center gap-2">
                <span>{SCOPE_LABELS[SCOPE_GROUPS]}</span>
                <input type="text" aria-label={SCOPE_LABELS[SCOPE_GROUPS]} disabled={!editable} className={`${NUMBER} w-56`} value={values[SCOPE_GROUPS]}
                  onChange={(e) => onChange(SCOPE_GROUPS, e.target.value)} />
              </label>
            ))}
            {current === c.id && c.id === 'recent' && (
              <label className="ml-6 flex items-center gap-2">
                <span>{SCOPE_LABELS[SCOPE_DAYS]}</span>
                <input type="text" inputMode="numeric" aria-label={SCOPE_LABELS[SCOPE_DAYS]} disabled={!editable} className={NUMBER} value={values[SCOPE_DAYS]}
                  onChange={(e) => onChange(SCOPE_DAYS, e.target.value)} />
              </label>
            )}
            {current === c.id && c.id === 'records' && (
              <label className="ml-6 flex items-center gap-2">
                <span>{SCOPE_LABELS[SCOPE_RECORDS]}</span>
                <input type="text" inputMode="numeric" aria-label={SCOPE_LABELS[SCOPE_RECORDS]} disabled={!editable} className={NUMBER} value={values[SCOPE_RECORDS]}
                  onChange={(e) => onChange(SCOPE_RECORDS, e.target.value)} />
              </label>
            )}
          </div>
        ))}
      </div>
      <p className={NOTE}>{FIRST_RUN_KEEPS}</p>
    </fieldset>
  );
}

export default function ScopeSettings({
  part = 'both', values, onChange, profile = null, profileState = 'off', profileError = '', settings = [], editable = true, custom = null, children = null,
  unrecorded = false,
}) {
  const problems = scopeProblems(values, profile, part, custom);
  const editableOf = (name) => editable && settings.find((s) => s.name === name)?.editable !== false;
  return (
    <section aria-label="Grouping and First run" data-scope-settings={part} className="space-y-3">
      <ProfileNote state={profileState} error={profileError} />
      {part !== 'first_run' && <GroupingPart values={values} onChange={onChange} profile={profile} settings={settings} editable={editableOf(GROUP_BY)} custom={custom} />}
      {part !== 'grouping' && (
        <FirstRunPart values={values} onChange={onChange} profile={profile} settings={settings} editable={editableOf(RUN_SCOPE)} unrecorded={unrecorded} />
      )}
      {problems.length > 0 && <ul className="space-y-0.5">{problems.map((p) => <li key={p} data-scope-problem="" className="text-[11px] text-error-fg">{p}</li>)}</ul>}
      {children}
    </section>
  );
}

export function ScopeSection({ settings, editable, scope = null, onSave, apiPostJson = null, children = null }) {
  const [draft, setDraft] = useState(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [customSaved, setCustomSaved] = useState(undefined);
  const custom = apiPostJson && scope?.key ? {
    apiPostJson, profileKey: scope.key, saved: customSaved, onSaved: setCustomSaved, onPicked: () => setCustomSaved((was) => was || null),
  } : null;
  const list = (settings || []).filter(isScopeSetting);
  if (!list.length) return null;
  const has = (name) => list.some((s) => s.name === name);
  const part = has(GROUP_BY) && has(RUN_SCOPE) ? 'both' : has(GROUP_BY) ? 'grouping' : 'first_run';
  const unrecorded = list.some((s) => s.name === RUN_SCOPE && s.unrecorded === true);
  const read = scopeValues((name) => list.find((s) => s.name === name)?.value);
  const saved = unrecorded ? withUnrecordedScope(read, scope?.profile || null) : read;
  const shown = draft || saved;
  const changed = scopeChanges(saved, shown).filter((name) => list.some((s) => s.name === name && s.editable !== false));
  const canEdit = Boolean(editable) && list.some((s) => s.editable !== false);
  const blocked = scopeProblems(shown, scope?.profile || null, part, custom).length > 0;
  const save = async () => {
    setSaving(true);
    setMessage('');
    try {
      for (const name of changed) await onSave(name, shown[name], String(list.find((s) => s.name === name)?.value ?? ''), note.trim());
      setDraft(null);
      setNote('');
      setMessage(`Saved Grouping and First run. ${SETTINGS_NEXT_RUN}`);
    } catch (e) {
      setMessage(e.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div data-setting-group="run_scope" className="space-y-2">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-secondary">Grouping and First run</h4>
      <ScopeSettings part={part} values={shown} onChange={(name, value) => setDraft({ ...shown, [name]: value })}
        profile={scope?.profile || null} profileState={scope?.state || 'off'} profileError={scope?.error || ''} settings={list} editable={canEdit} custom={custom}
        unrecorded={unrecorded}>
        {canEdit && changed.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <input aria-label="Note for the Grouping and First run change" placeholder="Why, for the history (optional)" maxLength={300}
              className={`${NUMBER} w-64`} value={note} onChange={(e) => setNote(e.target.value)} />
            <button type="button" disabled={saving || blocked} onClick={save}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-db-red-solid disabled:opacity-50">
              {saving ? <Loader2 size={12} className="animate-spin" /> : null}{SCOPE_SAVE_LABEL}
            </button>
          </div>
        )}
        {message && <p role="status" data-scope-saved="" className="text-[12px] text-text-primary">{message}</p>}
        {children}
      </ScopeSettings>
    </div>
  );
}
