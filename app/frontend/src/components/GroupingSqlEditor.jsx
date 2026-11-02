import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { EditorView, basicSetup } from 'codemirror';
import { StandardSQL, sql as sqlLanguage } from '@codemirror/lang-sql';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { counted } from '../lib/plural';
import { profileBody } from '../lib/groupingProfile';
import {
  GROUPING_PREVIEW_ROUTE, GROUPING_SAVE_ROUTE, checkGroupingSql, groupingKeysOf, groupingPreviewFits, groupingSqlRequest, groupingSqlSchema,
} from '../lib/groupingSql';

export const GROUPING_SQL_LABEL = 'Grouping SQL';
export const GROUPING_SQL_PREVIEW = 'Preview';
export const GROUPING_SQL_USE = 'Use this grouping';
export const GROUPING_SQL_NO_TABLE = 'Inspire needs to read the use case table before it can check a custom grouping; pick another grouping or come back once the table is read.';

const NOTE = 'text-[11px] text-text-secondary';
const BUTTON = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50';

const SQL_COLORS = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: 'var(--t-info-fg)', fontWeight: '600' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--t-success-fg)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--t-warning-fg)' },
  { tag: [tags.lineComment, tags.blockComment, tags.comment], color: 'var(--t-text-secondary)', fontStyle: 'italic' },
  { tag: [tags.typeName, tags.standard(tags.name)], color: 'var(--t-db-red-fg)' },
]);

const SQL_LOOK = EditorView.theme({
  '&': { backgroundColor: 'var(--t-input-bg)', color: 'var(--t-input-color)', fontSize: '12px' },
  '.cm-content': { caretColor: 'var(--t-input-color)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', minHeight: '7rem' },
  '.cm-gutters': { backgroundColor: 'var(--t-bg-subtle)', color: 'var(--t-text-secondary)', borderRight: '1px solid var(--t-border)' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--t-bg-subtle)' },
  '&.cm-focused': { outline: '2px solid var(--t-info-fg)' },
  '.cm-tooltip': { backgroundColor: 'var(--t-surface)', color: 'var(--t-text-primary)', border: '1px solid var(--t-border-strong)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--t-info-bg)', color: 'var(--t-text-primary)' },
});

function aborted(e) {
  return e?.name === 'AbortError';
}

function PreviewView({ data }) {
  return (
    <div data-grouping-sql-preview="" className="space-y-2 rounded-lg border border-border bg-surface px-3 py-2">
      <ul className="space-y-0.5">
        {(data.rules || []).map((r) => (
          <li key={r.id} data-grouping-sql-rule={r.id} data-ok={r.ok ? 'yes' : 'no'} className={`text-[12px] ${r.ok ? 'text-text-primary' : 'text-error-fg'}`}>{r.text}</li>
        ))}
      </ul>
      {data.text && <p data-grouping-sql-shown="" className={NOTE}>{data.text}</p>}
      {(data.top || []).length > 0 && (
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-text-secondary"><th className="font-medium py-0.5">Group</th><th className="font-medium py-0.5 text-right">Records</th></tr>
          </thead>
          <tbody>
            {data.top.map((g, i) => (
              <tr key={`${g.group_name ?? ''}|${i}`} data-grouping-sql-group="" className="border-t border-border-subtle text-text-primary">
                <td className="py-0.5 break-all">{g.group_name == null ? 'No group' : g.group_name}</td>
                <td className="py-0.5 text-right tabular-nums">{counted(g.records, 'record')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data.truncated && <p data-grouping-sql-truncated="" className={NOTE}>Databricks returned only part of the answer, so these numbers may be low.</p>}
    </div>
  );
}

export default function GroupingSqlEditor({ apiPostJson, profileKey, profile, resultTable = '', saved = null, editable = true, onSaved = null }) {
  const start = saved?.group_sql || profile?.prefill?.sql || '';
  const [sql, setSql] = useState(start);
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const checked = useMemo(() => checkGroupingSql(sql), [sql]);
  const host = useRef(null);
  const live = useRef(new Set());
  const ready = Boolean(profile?.table) && groupingKeysOf(profile).length > 0;

  useEffect(() => {
    const stops = live.current;
    return () => { stops.forEach((stop) => stop.abort()); };
  }, []);

  useEffect(() => {
    if (!ready || !host.current) return undefined;
    const view = new EditorView({
      parent: host.current,
      doc: start,
      extensions: [
        basicSetup,
        sqlLanguage({ dialect: StandardSQL, schema: groupingSqlSchema(profile), upperCaseKeywords: true }),
        syntaxHighlighting(SQL_COLORS),
        SQL_LOOK,
        EditorView.lineWrapping,
        EditorView.editable.of(Boolean(editable)),
        EditorView.contentAttributes.of({ 'aria-label': GROUPING_SQL_LABEL }),
        EditorView.updateListener.of((u) => { if (u.docChanged) setSql(u.state.doc.toString()); }),
      ],
    });
    return () => view.destroy();
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) return <p data-grouping-sql-unready="" className={NOTE}>{GROUPING_SQL_NO_TABLE}</p>;

  const post = async (route, body) => {
    const stop = new AbortController();
    live.current.add(stop);
    try {
      return await apiPostJson(route, body, { signal: stop.signal });
    } finally {
      live.current.delete(stop);
    }
  };
  const base = profileBody(profileKey);
  const runPreview = async () => {
    setMessage('');
    setPreview({ state: 'busy' });
    try {
      setPreview({ state: 'done', data: await post(GROUPING_PREVIEW_ROUTE, groupingSqlRequest(base, profile, sql)) });
    } catch (e) {
      if (!aborted(e)) setPreview({ state: 'error', error: e.message });
    }
  };
  const use = async () => {
    setSaving(true);
    setMessage('');
    try {
      const got = await post(GROUPING_SAVE_ROUTE, groupingSqlRequest(base, profile, sql, resultTable));
      onSaved?.({ ...got.setting, result_table: got.result_table });
      setMessage(`Saved for ${got.result_table}; its runs group records with this SQL.`);
    } catch (e) {
      if (!aborted(e)) setMessage(e.message);
    } finally {
      setSaving(false);
    }
  };
  const keys = groupingKeysOf(profile);
  const fits = groupingPreviewFits(preview?.data, checked);
  const savedNow = Boolean(saved?.group_sql) && checked.ok && saved.group_sql === checked.sql;
  return (
    <div data-grouping-sql="" className="space-y-2">
      <p data-grouping-sql-hint="" className={NOTE}>
        Write one SELECT that returns one row per record of {profile.table}: the key {keys.length === 1 ? 'column' : 'columns'} {keys.join(', ')} and group_name.
        Inspire runs it only as a single SELECT, so it never changes data.
      </p>
      <div ref={host} data-grouping-sql-editor="" className="rounded-lg border border-border overflow-hidden" />
      <p data-grouping-sql-check={checked.ok ? 'ok' : checked.rule} className={`text-[11px] ${checked.ok ? 'text-text-secondary' : 'text-error-fg'}`}>
        {checked.ok ? `A single SELECT that reads ${checked.tables.join(', ')}.` : checked.text}
      </p>
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={!checked.ok || preview?.state === 'busy'} onClick={runPreview}
            className={`${BUTTON} border border-border-strong text-text-primary bg-surface`}>
            {preview?.state === 'busy' ? <Loader2 size={12} className="animate-spin" aria-hidden /> : null}{GROUPING_SQL_PREVIEW}
          </button>
          <button type="button" disabled={!fits || saving} onClick={use} className={`${BUTTON} text-white bg-db-red-solid`}>
            {saving ? <Loader2 size={12} className="animate-spin" aria-hidden /> : null}{GROUPING_SQL_USE}
          </button>
          {!fits && checked.ok && preview?.state === 'done' && preview.data?.sql !== checked.sql && (
            <span data-grouping-sql-stale="" className={NOTE}>The SQL changed since the preview; press Preview again.</span>
          )}
        </div>
      )}
      {preview?.state === 'error' && <p role="alert" data-grouping-sql-error="" className="text-[11px] text-error-fg">{preview.error}</p>}
      {preview?.state === 'done' && preview.data && <PreviewView data={preview.data} />}
      {saved?.group_sql && !savedNow && (
        <p data-grouping-sql-unsaved="" className={NOTE}>Runs keep the grouping saved before until you press {GROUPING_SQL_USE} again.</p>
      )}
      {message && <p role="status" data-grouping-sql-saved="" className="text-[12px] text-text-primary">{message}</p>}
    </div>
  );
}
