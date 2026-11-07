import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { counted } from '../lib/plural';
import { PROFILE_READING } from '../lib/groupingProfile';
import { SETTINGS_NEXT_RUN } from '../lib/useCaseSettings';
import {
  FIRST_RUN_GROUPS_FIND_FROM, FIRST_RUN_GROUPS_MAX_SHOWN, FIRST_RUN_GROUPS_READING, FIRST_RUN_KEEPS, FIRST_RUN_SAVE_LABEL, GROUP_ALL, GROUP_BY, GROUP_KIND_WORDS, GROUPING_COMBINE,
  GROUPING_COMBINE_NOTE, GROUPING_DEEP_MARK, GROUPING_DEEP_PICKED, GROUPING_PLAIN, GROUPING_SAVE_LABEL, RUN_SCOPE, RUN_SCOPE_UNRECORDED, RUN_SCOPES, SCOPE_DAYS,
  SCOPE_GROUPS, SCOPE_LABELS, SCOPE_RECORDS, deepGrouping, firstRunChoiceOf, firstRunChoices, firstRunCoversText, groupByColumns, groupingChoices, groupingExampleText,
  groupingGroupsOf, groupingMovesUpText, groupingProfiled, groupingReasonText, groupsPickedByRunText, isFirstRunSetting, isGroupingSetting, isScopeSetting,
  profileHeldText, sameGrouping, scopeChanges, scopeGroupKey, scopeGroupText, scopeGroupsColumn, scopeGroupsOf, scopeGroupsValue, scopeProblems, scopeValues,
  suggestedGroups, withScopeDefaults,
} from '../lib/runScope';

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

function combinable(profile) {
  return (Array.isArray(profile?.columns) ? profile.columns : []).filter((c) => c && String(c.name || '').trim())
    .sort((a, b) => (a.distinct ?? 0) - (b.distinct ?? 0) || String(a.name).localeCompare(String(b.name)));
}

function GroupingPart({ values, onChange, profile, settings, editable, chosenBy }) {
  const setting = settings.find((s) => s.name === GROUP_BY);
  const current = values[GROUP_BY] || GROUP_ALL;
  const listed = groupingChoices(profile, setting?.choices);
  const known = listed.some((c) => sameGrouping(c.value, current));
  const choices = known ? listed : [...listed, { value: current, label: groupByColumns(current).join(', then '), columns: groupByColumns(current) }];
  const pickedOf = (c) => sameGrouping(c.value, current);
  const profiled = groupingProfiled(values, profile);
  const example = profiled ? groupingExampleText(profile) : '';
  const moves = profiled ? groupingMovesUpText(profile) : '';
  const level = deepGrouping(profile).length ? String(profile.deep_suggestion.record_level || '').trim() : '';
  const reason = groupingReasonText(profile);
  const columns = combinable(profile);
  const ticked = groupByColumns(current).map((c) => c.toLowerCase());
  const tick = (name, on) => {
    const next = columns.map((c) => String(c.name)).filter((n) => (n === name ? on : ticked.includes(n.toLowerCase())));
    onChange(GROUP_BY, next.length ? next.join(', ') : GROUP_ALL);
  };
  return (
    <fieldset aria-label={SCOPE_LABELS[GROUP_BY]} data-scope-part="grouping" className="min-w-0 space-y-2">
      <legend className="text-[12px] font-semibold text-text-primary">{SCOPE_LABELS[GROUP_BY]}</legend>
      <p data-grouping-why="" className={NOTE}>{GROUPING_PLAIN}</p>
      {reason && <p data-grouping-reason="" className="text-[12px] text-text-primary">{reason}</p>}
      {example && <p data-grouping-example="" className={NOTE}>{example}</p>}
      {moves && <p data-grouping-moves="" className={NOTE}>{moves}</p>}
      {level && <p data-grouping-record-level="" className={NOTE}>Discovery found one record per {level} in {profile?.table || 'the main table'}.</p>}
      {chosenBy === 'deep' && <p data-grouping-chosen-by="deep" className={NOTE}>{GROUPING_DEEP_PICKED}</p>}
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {choices.map((c) => (
          <label key={c.value} data-grouping-choice={c.value} data-grouping-joined={c.note ? '' : undefined} className={`${ROW} ${editable ? 'cursor-pointer' : ''}`}>
            <input type="radio" name="inspire-grouping" className="mt-0.5" checked={pickedOf(c)} disabled={!editable}
              onChange={() => onChange(GROUP_BY, c.value)}
              onClick={() => { if (chosenBy === 'deep' && c.deep && pickedOf(c)) onChange(GROUP_BY, c.value); }} />
            <span className="min-w-0">
              <span className="font-medium">{c.label}</span>
              {c.deep && <span data-grouping-deep="" className="text-text-secondary"> · {GROUPING_DEEP_MARK}</span>}
              {c.recommended && <span data-grouping-recommended="" className="text-text-secondary"> · Recommended</span>}
              {c.note && <span data-grouping-join-note="" className="block text-[11px] text-text-secondary">{c.note}</span>}
            </span>
          </label>
        ))}
      </div>
      {columns.length > 1 && (
        <div role="group" aria-label={GROUPING_COMBINE} data-grouping-combine="" className="space-y-1">
          <p className="text-[12px] font-medium text-text-primary">{GROUPING_COMBINE}</p>
          <p className={NOTE}>{GROUPING_COMBINE_NOTE}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {columns.map((c) => (
              <label key={c.name} data-grouping-combine-column={c.name} className="flex items-center gap-1.5 text-[12px] text-text-primary">
                <input type="checkbox" disabled={!editable} checked={ticked.includes(String(c.name).toLowerCase())} onChange={(e) => tick(String(c.name), e.target.checked)} />
                <span>{c.name}{c.distinct != null ? ` · ${counted(c.distinct, 'group')}` : ''}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </fieldset>
  );
}

function GroupsPicker({ groups, picked, many, editable, onPick }) {
  const [find, setFind] = useState('');
  const isPicked = (g) => picked.some((p) => scopeGroupKey(p) === scopeGroupKey(g.parts));
  const needle = find.trim().toLowerCase();
  const matching = needle ? groups.filter((g) => g.value.toLowerCase().includes(needle)) : groups;
  const shown = [...groups.filter(isPicked), ...matching.filter((g) => !isPicked(g))].slice(0, Math.max(FIRST_RUN_GROUPS_MAX_SHOWN, picked.length));
  const hidden = matching.filter((g) => !shown.includes(g)).length;
  const toggle = (group, on) => {
    const kept = picked.filter((p) => !groups.some((g) => scopeGroupKey(g.parts) === scopeGroupKey(p)));
    const next = many ? groups.filter((g) => (g === group ? on : isPicked(g))).map((g) => g.parts) : [group.parts];
    onPick(scopeGroupsValue(many ? [...next, ...kept] : next));
  };
  return (
    <div role="group" aria-label={SCOPE_LABELS[SCOPE_GROUPS]} className="ms-6 space-y-1">
      {groups.length > FIRST_RUN_GROUPS_FIND_FROM && (
        <input dir="auto" type="search" aria-label="Find a group" placeholder={`Find one of ${counted(groups.length, 'group')}`} className={`${NUMBER} w-64`}
          value={find} onChange={(e) => setFind(e.target.value)} />
      )}
      <div className="max-h-64 space-y-1 overflow-y-auto">
        {shown.map((g) => (
          <label key={scopeGroupKey(g.parts)} data-scope-group={g.value} className="flex items-center gap-2">
            <input dir="auto" type={many ? 'checkbox' : 'radio'} name="inspire-first-run-group" disabled={!editable} checked={isPicked(g)} onChange={(e) => toggle(g, e.target.checked)} />
            <span>{g.parts.length > 1 ? scopeGroupText(g.parts) : g.value}{GROUP_KIND_WORDS[g.kind] ? `, ${GROUP_KIND_WORDS[g.kind]}` : ''}{g.records != null ? ` · ${counted(g.records, 'record')}` : ''}</span>
          </label>
        ))}
      </div>
      {hidden > 0 && (
        <p data-scope-groups-more="" className={NOTE}>Showing {shown.length} of {counted(groups.length, 'group')}, largest first; {hidden} more match, type to find one.</p>
      )}
    </div>
  );
}

function FirstRunPart({ values, onChange, profile, groupsState, settings, editable, unrecorded, everything }) {
  const setting = settings.find((s) => s.name === RUN_SCOPE);
  const allowed = Array.isArray(setting?.choices) && setting.choices.length ? setting.choices.map(String) : RUN_SCOPES;
  const saved = firstRunChoiceOf(values);
  const [mode, setMode] = useState(saved);
  const current = (mode === 'one' || mode === 'groups') && values[RUN_SCOPE] === 'groups' ? mode : saved;
  const choices = firstRunChoices(profile, values, everything)
    .filter((c) => allowed.includes(c.scope) && (c.id === current || (profile ? c.available : true)));
  const listed = groupingGroupsOf(profile, values[GROUP_BY]);
  const groups = listed || (groupingProfiled(values, profile) ? suggestedGroups(profile) : []);
  const picked = scopeGroupsOf(values[SCOPE_GROUPS], scopeGroupsColumn(profile, values));
  const pick = (c) => {
    setMode(c.id);
    onChange(RUN_SCOPE, c.scope);
    if (c.scope !== 'groups' || !groups.length) return;
    const suggested = suggestedGroups(profile).filter((s) => groups.some((g) => scopeGroupKey(g.parts) === scopeGroupKey(s.parts)));
    if (c.id === 'one' && picked.length !== 1) onChange(SCOPE_GROUPS, scopeGroupsValue([(picked.length ? { parts: picked[0] } : groups[0]).parts]));
    if (c.id === 'groups' && !picked.length) onChange(SCOPE_GROUPS, scopeGroupsValue((suggested.length ? suggested : groups.slice(0, 3)).map((g) => g.parts)));
  };
  const covers = firstRunCoversText(profile, values, everything);
  const held = profileHeldText(profile);
  return (
    <fieldset aria-label={SCOPE_LABELS[RUN_SCOPE]} data-scope-part="first_run" className="min-w-0 space-y-2">
      <legend className="text-[12px] font-semibold text-text-primary">{SCOPE_LABELS[RUN_SCOPE]}</legend>
      {held && <p data-first-run-held="" className={NOTE}>{held}</p>}
      {unrecorded && <p data-first-run-unrecorded="" className={NOTE}>{RUN_SCOPE_UNRECORDED}</p>}
      {setting?.locked && <p data-first-run-locked="" className={NOTE}>{setting.locked}</p>}
      {groupsState === 'loading' && (
        <p data-first-run-groups-reading="" className={`${NOTE} inline-flex items-center gap-1.5`}><Loader2 size={12} className="animate-spin" aria-hidden /> {FIRST_RUN_GROUPS_READING}</p>
      )}
      <div className="space-y-1.5">
        {choices.map((c) => (
          <div key={c.id} data-first-run-choice={c.id} className={`${ROW} flex-col`}>
            <label className={`flex items-start gap-2 ${editable ? 'cursor-pointer' : ''}`}>
              <input type="radio" name="inspire-first-run" className="mt-0.5" checked={current === c.id} disabled={!editable} onChange={() => pick(c)} />
              <span className="min-w-0">
                <span className="font-medium">{c.label}</span>
                {c.records != null && <span data-first-run-records="" className="text-text-secondary"> · {counted(c.records, 'record')}</span>}
                {c.estimate && <span data-first-run-estimate="" className="block text-[11px] text-text-secondary">{c.estimate}</span>}
              </span>
            </label>
            {current === c.id && c.scope === 'groups' && (groups.length ? (
              <GroupsPicker groups={groups} picked={picked} many={c.id === 'groups'} editable={editable} onPick={(v) => onChange(SCOPE_GROUPS, v)} />
            ) : (
              <div className="ms-6 space-y-1">
                <p data-first-run-run-picks="" className={NOTE}>{groupsPickedByRunText(values)}</p>
                <label className="flex flex-wrap items-center gap-2">
                  <span>{SCOPE_LABELS[SCOPE_GROUPS]}</span>
                  <input dir="auto" type="text" aria-label={SCOPE_LABELS[SCOPE_GROUPS]} disabled={!editable} className={`${NUMBER} w-56 max-w-full`} value={values[SCOPE_GROUPS]}
                    onChange={(e) => onChange(SCOPE_GROUPS, e.target.value)} />
                </label>
              </div>
            ))}
            {current === c.id && c.id === 'recent' && (
              <label className="ms-6 flex items-center gap-2">
                <span>{SCOPE_LABELS[SCOPE_DAYS]}</span>
                <input dir="auto" type="text" inputMode="numeric" aria-label={SCOPE_LABELS[SCOPE_DAYS]} disabled={!editable} className={NUMBER} value={values[SCOPE_DAYS]}
                  onChange={(e) => onChange(SCOPE_DAYS, e.target.value)} />
              </label>
            )}
            {current === c.id && c.id === 'records' && (
              <label className="ms-6 flex items-center gap-2">
                <span>{SCOPE_LABELS[SCOPE_RECORDS]}</span>
                <input dir="auto" type="text" inputMode="numeric" aria-label={SCOPE_LABELS[SCOPE_RECORDS]} disabled={!editable} className={NUMBER} value={values[SCOPE_RECORDS]}
                  onChange={(e) => onChange(SCOPE_RECORDS, e.target.value)} />
              </label>
            )}
          </div>
        ))}
      </div>
      {covers && <p data-first-run-covers="" className="text-[12px] font-medium text-text-primary">{covers}</p>}
      <p className={NOTE}>{FIRST_RUN_KEEPS}</p>
    </fieldset>
  );
}

export default function ScopeSettings({
  part = 'both', values, onChange, profile = null, profileState = 'off', profileError = '', groups = null, settings = [], editable = true, children = null,
  unrecorded = false, everything = '', groupingChosenBy = '',
}) {
  const problems = scopeProblems(values, part);
  const editableOf = (name) => editable && settings.find((s) => s.name === name)?.editable !== false;
  const listing = groups || { state: profileState, profile, error: profileError };
  return (
    <section aria-label={part === 'grouping' ? SCOPE_LABELS[GROUP_BY] : part === 'first_run' ? SCOPE_LABELS[RUN_SCOPE] : `${SCOPE_LABELS[GROUP_BY]} and ${SCOPE_LABELS[RUN_SCOPE]}`}
      data-scope-settings={part} className="space-y-3">
      <ProfileNote state={profileState} error={profileError} />
      {part !== 'first_run' && <GroupingPart values={values} onChange={onChange} profile={profile} settings={settings} editable={editableOf(GROUP_BY)} chosenBy={groupingChosenBy} />}
      {part !== 'grouping' && groups && groups.state === 'error' && (
        <p role="alert" data-first-run-groups-error="" className="text-[11px] text-error-fg">Inspire could not read the groups of the Data groups you chose: {groups.error}</p>
      )}
      {part !== 'grouping' && (
        <FirstRunPart values={values} onChange={onChange} profile={listing.state === 'ready' ? listing.profile : profile} groupsState={listing.state}
          settings={settings} editable={editableOf(RUN_SCOPE)} unrecorded={unrecorded} everything={everything} />
      )}
      {problems.length > 0 && <ul className="space-y-0.5">{problems.map((p) => <li key={p} data-scope-problem="" className="text-[11px] text-error-fg">{p}</li>)}</ul>}
      {children}
    </section>
  );
}

const SECTION_PARTS = {
  grouping: { title: SCOPE_LABELS[GROUP_BY], save: GROUPING_SAVE_LABEL, owns: isGroupingSetting },
  first_run: { title: SCOPE_LABELS[RUN_SCOPE], save: FIRST_RUN_SAVE_LABEL, owns: isFirstRunSetting },
};

export function ScopeSection({ settings, editable, scope = null, onSave, children = null, everything = '', part }) {
  const [draft, setDraft] = useState(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const every = (settings || []).filter(isScopeSetting);
  const meta = SECTION_PARTS[part];
  const list = meta ? every.filter(meta.owns) : [];
  if (!list.length) return null;
  const unrecorded = list.some((s) => s.name === RUN_SCOPE && s.unrecorded === true);
  const read = scopeValues((name) => every.find((s) => s.name === name)?.value);
  const saved = unrecorded ? withScopeDefaults(read, scope?.profile || null) : read;
  const shown = draft || saved;
  const changed = scopeChanges(saved, shown).filter((name) => list.some((s) => s.name === name && s.editable !== false));
  const canEdit = Boolean(editable) && list.some((s) => s.editable !== false);
  const blocked = scopeProblems(shown, part).length > 0;
  const save = async () => {
    setSaving(true);
    setMessage('');
    try {
      for (const name of changed) await onSave(name, shown[name], String(list.find((s) => s.name === name)?.value ?? ''), note.trim());
      setDraft(null);
      setNote('');
      setMessage(`Saved ${meta.title}. ${SETTINGS_NEXT_RUN}`);
    } catch (e) {
      setMessage(e.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div data-setting-group={part === 'grouping' ? 'data_groups' : 'run_scope'} className="space-y-2">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-secondary">{meta.title}</h4>
      <ScopeSettings part={part} values={shown} onChange={(name, value) => setDraft((was) => ({ ...(was || saved), [name]: value }))}
        profile={scope?.profile || null} profileState={scope?.state || 'off'} profileError={scope?.error || ''} groups={part === 'first_run' ? scope?.firstRun || null : null}
        settings={list} editable={canEdit} unrecorded={unrecorded} everything={everything}>
        {canEdit && changed.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <input dir="auto" aria-label={`Note for the ${meta.title} change`} placeholder="Why, for the history (optional)" maxLength={300}
              className={`${NUMBER} w-64`} value={note} onChange={(e) => setNote(e.target.value)} />
            <button type="button" disabled={saving || blocked} onClick={save}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-db-red-solid disabled:opacity-50">
              {saving ? <Loader2 size={12} className="animate-spin" /> : null}{meta.save}
            </button>
          </div>
        )}
        {message && <p role="status" data-scope-saved="" className="text-[12px] text-text-primary">{message}</p>}
        {children}
      </ScopeSettings>
    </div>
  );
}

export function ScopeSections(props) {
  return (
    <>
      <ScopeSection {...props} part="grouping" />
      <ScopeSection {...props} part="first_run" />
    </>
  );
}
