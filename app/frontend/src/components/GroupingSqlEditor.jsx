import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { EditorView, basicSetup } from 'codemirror';
import { StandardSQL, sql as sqlLanguage } from '@codemirror/lang-sql';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { counted } from '../lib/plural';
import { profileBody } from '../lib/groupingProfile';
import DataGrid from './DataGrid';
import {
  GROUPING_PREVIEW_ROUTE, GROUPING_SAVE_ROUTE, checkGroupingSql, groupingKeysOf, groupingPreviewFits, groupingSqlRequest, groupingSqlSchema,
} from '../lib/groupingSql';

export const GROUPING_SQL_LABEL = 'Grouping SQL';
export const GROUPING_SQL_PREVIEW = 'Preview';
export const GROUPING_SQL_USE = 'Use this grouping';
export const GROUPING_SQL_NO_TABLE = 'Inspire needs to read the use case table before it can check a custom grouping; pick another grouping or come back once the table is read.';
export const FIRST_RUN_SQL_LABEL = 'First run SQL';
export const FIRST_RUN_SQL_USE = 'Use this first run';
const PURPOSES = {
  grouping: { label: GROUPING_SQL_LABEL, use: GROUPING_SQL_USE, setting: 'group_sql', none: GROUPING_SQL_NO_TABLE,
    asks: (table, keys) => `Write one SELECT that returns one row per record of ${table}: the key ${keys.length === 1 ? 'column' : 'columns'} ${keys.join(', ')} and group_name.`,
    saved: (table) => `Saved for ${table}; its runs group records with this SQL.`, kept: 'grouping' },
  first_run: { label: FIRST_RUN_SQL_LABEL, use: FIRST_RUN_SQL_USE, setting: 'scope_sql',
    none: 'Inspire needs to read the use case table before it can check a custom first run; pick another first run or come back once the table is read.',
    asks: (table, keys) => `Write one SELECT that returns the key ${keys.length === 1 ? 'column' : 'columns'} ${keys.join(', ')} of the records of ${table} the first run covers, and no other column.`,
    saved: (table) => `Saved for ${table}; its runs cover only the records this SQL returns.`, kept: 'first run' },
};

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

const SAMPLE_COLUMNS = (keys) => keys.map((k) => ({ key: k, label: k, value: (r) => r[k], className: 'py-0.5 break-all' }));

const PREVIEW_COLUMNS = [
  { key: 'group', label: 'Group', value: (g) => (g.group_name == null ? 'No group' : g.group_name), className: 'py-0.5 break-all' },
  { key: 'records', label: 'Records', kind: 'number', value: (g) => g.records, render: (g) => counted(g.records, 'record'),
    headClassName: 'font-medium py-0.5 text-right', className: 'py-0.5 text-right tabular-nums' },
];

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
        <DataGrid columns={PREVIEW_COLUMNS} rows={data.top} rowKey={(g, i) => `${g.group_name ?? ''}|${i}`} label="Records per group"
          grid="grouping:preview" tableClassName="w-full text-[12px]" headRowClassName="text-left text-text-secondary"
          headClassName="font-medium py-0.5" rowProps={() => ({ 'data-grouping-sql-group': '', className: 'border-t border-border-subtle text-text-primary' })} />
      )}
      {(data.sample || []).length > 0 && (
        <DataGrid columns={SAMPLE_COLUMNS(data.key_columns || [])} rows={data.sample} rowKey={(_r, i) => String(i)} label="Sample records"
          grid="first_run:preview" tableClassName="w-full text-[12px]" headRowClassName="text-left text-text-secondary"
          headClassName="font-medium py-0.5" rowProps={() => ({ 'data-first-run-sql-sample': '', className: 'border-t border-border-subtle text-text-primary' })} />
      )}
      {data.truncated && <p data-grouping-sql-truncated="" className={NOTE}>Databricks returned only part of the answer, so these numbers may be low.</p>}
    </div>
  );
}

export default function GroupingSqlEditor({
  apiPostJson, profileKey, profile, resultTable = '', saved = null, startSql = '', editable = true, onSaved = null, purpose = 'grouping',
}) {
  const words = PURPOSES[purpose] || PURPOSES.grouping;
  const keysSql = profile?.table && groupingKeysOf(profile).length ? `SELECT ${groupingKeysOf(profile).join(', ')}\nFROM ${profile.table}\nWHERE ` : '';
  const start = startSql || saved?.[words.setting] || (purpose === 'first_run' ? keysSql : profile?.prefill?.sql) || '';
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
        EditorView.contentAttributes.of({ 'aria-label': words.label }),
        EditorView.updateListener.of((u) => { if (u.docChanged) setSql(u.state.doc.toString()); }),
      ],
    });
    return () => view.destroy();
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) return <p data-grouping-sql-unready="" className={NOTE}>{words.none}</p>;

  const post = async (route, body) => {
    const stop = new AbortController();
    live.current.add(stop);
    try {
      return await apiPostJson(route, body, { signal: stop.signal });
    } finally {
      live.current.delete(stop);
    }
  };
  const base = { ...profileBody(profileKey), ...(purpose === 'first_run' ? { purpose } : {}) };
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
      setMessage(words.saved(got.result_table));
    } catch (e) {
      if (!aborted(e)) setMessage(e.message);
    } finally {
      setSaving(false);
    }
  };
  const keys = groupingKeysOf(profile);
  const fits = groupingPreviewFits(preview?.data, checked);
  const savedNow = Boolean(saved?.[words.setting]) && checked.ok && saved[words.setting] === checked.sql;
  return (
    <div data-grouping-sql={purpose} className="space-y-2">
      <p data-grouping-sql-hint="" className={NOTE}>
        {words.asks(profile.table, keys)} Inspire runs it only as a single SELECT, so it never changes data.
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
            {saving ? <Loader2 size={12} className="animate-spin" aria-hidden /> : null}{words.use}
          </button>
          {!fits && checked.ok && preview?.state === 'done' && preview.data?.sql !== checked.sql && (
            <span data-grouping-sql-stale="" className={NOTE}>The SQL changed since the preview; press Preview again.</span>
          )}
        </div>
      )}
      {preview?.state === 'error' && <p role="alert" data-grouping-sql-error="" className="text-[11px] text-error-fg">{preview.error}</p>}
      {preview?.state === 'done' && preview.data && <PreviewView data={preview.data} />}
      {saved?.[words.setting] && !savedNow && (
        <p data-grouping-sql-unsaved="" className={NOTE}>Runs keep the {words.kept} saved before until you press {words.use} again.</p>
      )}
      {message && <p role="status" data-grouping-sql-saved="" className="text-[12px] text-text-primary">{message}</p>}
    </div>
  );
}
