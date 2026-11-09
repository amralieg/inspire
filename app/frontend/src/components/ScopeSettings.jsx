import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { counted } from '../lib/plural';
import { PROFILE_READING } from '../lib/groupingProfile';
import { SETTINGS_NEXT_RUN } from '../lib/useCaseSettings';
import {
  FIRST_RUN_GROUPS_FIND_FROM, FIRST_RUN_GROUPS_MAX_SHOWN, FIRST_RUN_GROUPS_READING, FIRST_RUN_KEEPS, FIRST_RUN_SAVE_LABEL, GROUP_ALL, GROUP_BY, GROUP_KIND_WORDS, GROUPING_COMBINE,
  GROUPING_DEEP_MARK, GROUPING_DEEP_PICKED, GROUPING_PLAIN, GROUPING_SAVE_LABEL, RUN_SCOPE, RUN_SCOPE_UNRECORDED, RUN_SCOPES, SCOPE_DAYS,
  SCOPE_GROUPS, SCOPE_LABELS, SCOPE_RECORDS, deepGrouping, firstRunChoiceOf, firstRunGroupsPick, groupingCombineNote, firstRunChoices, firstRunCoversText, groupByColumns, groupingChoices, groupingExampleText,
  groupingGroupsOf, groupingMovesUpText, groupingNothingText, groupingOverLimitText, groupingProfiled, groupingReasonText, groupsPickedByRunText, isFirstRunSetting, isGroupingSetting, isScopeSetting,
  isolated, profileHeldText, sameGrouping, scopeChanges, scopeGroupKey, scopeGroupText, scopeGroupsColumn, scopeGroupsOf, scopeGroupsValue, scopeProblems, scopeValues,
  suggestedGroups, withScopeDefaults, FIRST_RUN_LABEL, GROUPING_FIND, GROUPING_MORE, groupingCount, groupingCountText, groupingLead, topShown,
} from '../lib/runScope';
import { bestFirstRun, bestGrouping, isBest } from '../lib/recommended';
import Recommended from './Recommended';
import { PlainMessage } from './TechnicalDetails';

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
  if (state === 'error') return <PlainMessage text={`Inspire could not read the table for its suggestions: ${error}`} role="alert" data-scope-profile="error" className="text-[11px] text-error-fg" />;
  return null;
}

function combinable(profile) {
  return (Array.isArray(profile?.columns) ? profile.columns : []).filter((c) => c && String(c.name || '').trim())
    .sort((a, b) => (a.distinct ?? 0) - (b.distinct ?? 0) || String(a.name).localeCompare(String(b.name)));
}

function GroupingPart({ values, onChange, profile, read = null, settings, editable, chosenBy }) {
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
  const best = choices.length > 1 ? bestGrouping(profile, choices) : null;
  const lead = groupingLead(profile, choices, current, read);
  const overLimit = groupingOverLimitText(lead, profile);
  const nothing = groupingNothingText(profile, choices);
  const [cards, setCards] = useState({ open: false, find: '' });
  const [combine, setCombine] = useState({ open: false, find: '' });
  const keepCard = (c) => !c.columns.length || pickedOf(c) || isBest(best, c.value) || Boolean(c.deep);
  const shownCards = topShown(choices, { keep: keepCard, open: cards.open, query: cards.find, textOf: (c) => c.label });
  const keepColumn = (c) => ticked.includes(String(c.name).toLowerCase());
  const shownColumns = topShown(columns, { keep: keepColumn, open: combine.open, query: combine.find, textOf: (c) => String(c.name) });
  return (
    <fieldset aria-label={SCOPE_LABELS[GROUP_BY]} data-scope-part="grouping" className="min-w-0 space-y-2">
      <legend className="text-[12px] font-semibold text-text-primary">{SCOPE_LABELS[GROUP_BY]}</legend>
      {nothing ? <p data-grouping-nothing="" className="text-[12px] text-text-primary">{nothing}</p> : lead ? (
        <p data-grouping-lead="" className="text-[12px] text-text-primary">
          <strong>{lead.label}</strong> splits the data into <strong>{groupingCountText(lead.groups)}</strong>. Inspire models each group on its own.
          {overLimit && <span role="alert" data-grouping-over-limit="" className="block text-warning-fg">{overLimit}</span>}
        </p>
      ) : reason && <p data-grouping-reason="" className="text-[12px] text-text-primary">{reason}</p>}
      <details data-grouping-more="" className={NOTE}>
        <summary className="cursor-pointer select-none font-medium text-text-secondary">{GROUPING_MORE}</summary>
        <div className="mt-1 space-y-1">
          <p data-grouping-why="">{GROUPING_PLAIN}</p>
          {lead && reason && <p data-grouping-reason="">{reason}</p>}
          {example && <p data-grouping-example="">{example}</p>}
          {moves && <p data-grouping-moves="">{moves}</p>}
          {level && <p data-grouping-record-level="">Discovery found one record per {level} in {profile?.table || 'the main table'}.</p>}
          {chosenBy === 'deep' && <p data-grouping-chosen-by="deep">{GROUPING_DEEP_PICKED}</p>}
        </div>
      </details>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2" data-grouping-cards="" data-choice="grouping">
        {shownCards.map((c) => (
          <label key={c.value} data-grouping-choice={c.value} data-grouping-joined={c.note ? '' : undefined}
            className={`${ROW} ${editable ? 'cursor-pointer' : ''} ${pickedOf(c) ? 'border-db-red bg-db-red-50' : ''}`}>
            <input type="radio" name="inspire-grouping" value={c.value} className="mt-0.5" checked={pickedOf(c)} disabled={!editable}
              onChange={() => onChange(GROUP_BY, c.value)}
              onClick={() => { if (chosenBy === 'deep' && c.deep && pickedOf(c)) onChange(GROUP_BY, c.value); }} />
            <span className="min-w-0 flex-1 space-y-0.5">
              <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="font-medium break-words">{c.label}</span>
                <span data-grouping-count="" className="shrink-0 text-[11px] text-text-secondary">{groupingCountText(groupingCount(c, profile))}</span>
              </span>
              {c.deep && <span data-grouping-deep="" className="block text-[11px] text-text-secondary">{GROUPING_DEEP_MARK}</span>}
              <Recommended best={best} id={c.value} />
              {c.note && <span data-grouping-join-note="" className="block text-[11px] text-text-secondary">{c.note}</span>}
            </span>
          </label>
        ))}
      </div>
      <ShowAll state={cards} total={choices.filter((c) => c.columns.length === 1).length} hidden={choices.length - topShown(choices, { keep: keepCard }).length}
        onChange={setCards} name="grouping" />
      {columns.length > 1 && (
        <div role="group" aria-label={GROUPING_COMBINE} data-grouping-combine="" className="space-y-1">
          <p className="text-[12px] font-medium text-text-primary">{GROUPING_COMBINE}</p>
          <p data-grouping-combine-note="" className={NOTE}>{groupingCombineNote(columns)}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {shownColumns.map((c) => (
              <label key={c.name} data-grouping-combine-column={c.name} className="flex items-center gap-1.5 text-[12px] text-text-primary">
                <input type="checkbox" disabled={!editable} checked={keepColumn(c)} onChange={(e) => tick(String(c.name), e.target.checked)} />
                <span>{c.name}{c.distinct != null ? ` · ${counted(c.distinct, 'group')}` : ''}</span>
              </label>
            ))}
          </div>
          <ShowAll state={combine} total={columns.length} hidden={columns.length - topShown(columns, { keep: keepColumn }).length} onChange={setCombine} name="combine" />
        </div>
      )}
    </fieldset>
  );
}

function ShowAll({ state, total, hidden, onChange, name }) {
  if (!state.open) {
    if (hidden <= 0) return null;
    return (
      <button type="button" data-show-all={name} className="text-[11px] font-medium text-db-red-fg glow-focus" onClick={() => onChange({ open: true, find: '' })}>
        Show all {counted(total, 'column')}
      </button>
    );
  }
  return (
    <div data-show-all-open={name} className="flex flex-wrap items-center gap-2">
      <input dir="auto" type="search" aria-label={name === 'combine' ? `${GROUPING_FIND} to combine` : GROUPING_FIND}
        placeholder={`${GROUPING_FIND} of ${counted(total, 'column')}`} className={`${NUMBER} w-64`} value={state.find}
        onChange={(e) => onChange({ open: true, find: e.target.value })} />
      <button type="button" className="text-[11px] font-medium text-db-red-fg glow-focus" onClick={() => onChange({ open: false, find: '' })}>Show fewer</button>
    </div>
  );
}

export function GroupingChosen({ values, profile }) {
  const current = values?.[GROUP_BY] || GROUP_ALL;
  const columns = groupByColumns(current).filter((c) => c.toLowerCase() !== GROUP_ALL);
  const choice = groupingChoices(profile).find((c) => sameGrouping(c.value, current)) || { value: current, label: columns.join(', then '), columns };
  return (
    <p role="note" data-grouping-chosen="" className="rounded-lg border border-info/20 bg-info-bg px-3 py-2 text-[12px] text-text-primary">
      Data groups: <strong>{choice.label}</strong> · {groupingCountText(groupingCount(choice, profile))}. The {FIRST_RUN_LABEL} runs inside these groups.
    </p>
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
            <span>{g.parts.length > 1 ? scopeGroupText(g.parts) : isolated(g.value)}{GROUP_KIND_WORDS[g.kind] ? `, ${GROUP_KIND_WORDS[g.kind]}` : ''}{g.records != null ? ` · ${counted(g.records, 'record')}` : ''}</span>
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
  const waiting = (c) => Boolean(profile) && !c.available && c.id !== current && c.scope === 'groups' && groupsState === 'loading';
  const choices = firstRunChoices(profile, values, everything)
    .filter((c) => allowed.includes(c.scope) && (c.id === current || (profile ? c.available : true) || waiting(c)));
  const listed = groupingGroupsOf(profile, values[GROUP_BY]);
  const groups = listed || (groupingProfiled(values, profile) ? suggestedGroups(profile) : []);
  const picked = scopeGroupsOf(values[SCOPE_GROUPS], scopeGroupsColumn(profile, values));
  const pick = (c) => {
    setMode(c.id);
    onChange(RUN_SCOPE, c.scope);
    if (c.scope !== 'groups' || !groups.length || (c.id === 'one' ? picked.length === 1 : picked.length > 0)) return;
    onChange(SCOPE_GROUPS, scopeGroupsValue(firstRunGroupsPick(profile, groups, picked, c.id)));
  };
  const best = bestFirstRun(profile, choices);
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
      <div className="space-y-1.5" data-choice="first-run">
        {choices.map((c) => (
          <div key={c.id} data-first-run-choice={c.id} data-first-run-waiting={waiting(c) ? '' : undefined} className={`${ROW} flex-col`}>
            <label className={`flex items-start gap-2 ${editable && !waiting(c) ? 'cursor-pointer' : ''}`}>
              <input type="radio" name="inspire-first-run" value={c.id} className="mt-0.5" checked={current === c.id} disabled={!editable || waiting(c)} onChange={() => pick(c)} />
              <span className="min-w-0">
                <span className="font-medium">{c.label}</span>
                {c.records != null && !c.label.includes(counted(c.records, 'record')) && <span data-first-run-records="" className="text-text-secondary"> · {counted(c.records, 'record')}</span>}
                {c.estimate && <span data-first-run-estimate="" className="block text-[11px] text-text-secondary">{c.estimate}</span>}
                <span className="block"><Recommended best={best} id={c.id} /></span>
              </span>
            </label>
            {c.detail && (
              <details data-first-run-details={c.id} className={`ms-6 ${NOTE}`}>
                <summary className="cursor-pointer select-none font-medium text-text-secondary">Details</summary>
                <p className="mt-1">{c.detail}</p>
                {c.shown?.length > 0 && <ul className="mt-1 space-y-0.5">{c.shown.map((g) => <li key={g} data-first-run-group="">{g}</li>)}</ul>}
              </details>
            )}
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
      {part !== 'first_run' && <GroupingPart values={values} onChange={onChange} profile={profile} read={groups?.state === 'ready' ? groups.profile : null} settings={settings} editable={editableOf(GROUP_BY)} chosenBy={groupingChosenBy} />}
      {part !== 'grouping' && groups && groups.state === 'error' && !(profileState === 'error' && groups.error === profileError) && (
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
        profile={scope?.profile || null} profileState={scope?.state || 'off'} profileError={scope?.error || ''} groups={scope?.firstRun || null}
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
