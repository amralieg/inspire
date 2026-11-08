import { useState, useCallback } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Database,
  Loader2,
  Sparkles,
  Building2,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { responseError } from '../lib/apiClient';
import { plural } from '../lib/plural';
import { DEMO_GENERATED_TABLES, DEMO_KIND_SIGNAL_TABLES, demoSchemaError, demoTablesTotal } from '../lib/demoData';
import { DISCOVERY_MODE_TEXT, DISCOVERY_RECOMMENDED, DISCOVERY_TYPE_VALID } from '../lib/discoveryType';

function demoTablesLine(tables) {
  if (!tables) return 'Write the demo Delta tables with UC table and column comments';
  const signal = tables.kind_signal ? ` and ${plural(tables.kind_signal, 'table')} that carry the data of every use-case kind` : '';
  return `Write ${plural(tables.generated, 'Delta table')} from your description${signal}, all with UC table and column comments`;
}

export default function GenerateDataPage({ settings, onBack, onLaunched }) {
  const { databricksHost, token, inspireDatabase, serverEnvHasPat } = settings;
  const canCallApi = !!(databricksHost && (token || serverEnvHasPat));

  const [description, setDescription] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [discoveryType, setDiscoveryType] = useState(DISCOVERY_RECOMMENDED);
  const [demoSchema, setDemoSchema] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [lastResult, setLastResult] = useState(null);

  const apiFetch = useCallback(
    async (url, opts = {}) => {
      const headers = { 'Content-Type': 'application/json', ...opts.headers };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
        headers['X-DB-PAT-Token'] = token;
      }
      if (databricksHost) headers['X-Databricks-Host'] = databricksHost;
      const resp = await fetch(url, { ...opts, headers });
      if (!resp.ok) throw await responseError(resp);
      return resp.json();
    },
    [token, databricksHost],
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!businessName.trim()) return setError('Business name is required.');
    if (!description.trim()) return setError('Describe the data you want to create.');
    if (!inspireDatabase) return setError('The Inspire database is not set yet. Set it in Workspace setup.');
    if (demoSchemaError(demoSchema)) return setError(demoSchemaError(demoSchema));

    setSubmitting(true);
    setError('');
    setLastResult(null);

    try {
      const data = await apiFetch('/api/demo-data/start', {
        method: 'POST',
        body: JSON.stringify({
          description: description.trim(),
          business_name: businessName.trim(),
          inspire_database: inspireDatabase,
          discovery_type: discoveryType,
          demo_schema: demoSchema.trim(),
        }),
      });
      setLastResult(data);
      onLaunched?.(data.session_id, data.inspire_run_id);
    } catch (err) {
      setError(err.message || 'Failed to generate data and start Inspire');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary mb-6 transition-smooth"
      >
        <ArrowLeft size={16} />
        Back
      </button>

      <div className="flex items-start gap-4 mb-8">
        <div className="w-12 h-12 rounded-xl bg-db-red/10 flex items-center justify-center shrink-0">
          <Sparkles size={24} className="text-db-red-fg" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">I don&apos;t have data</h1>
          <p className="text-sm text-text-secondary mt-1 leading-relaxed">
            Describe the demo you need. Inspire writes and runs the code that builds <strong>{plural(demoTablesTotal(), 'table')}</strong> of
            made-up data, each with a description, in the catalog of your Inspire database{inspireDatabase ? <> (<code className="font-mono text-xs">{inspireDatabase.split('.')[0]}</code>)</> : ''}.
            Inspire then finds use cases in those tables.
          </p>
        </div>
      </div>

      {!canCallApi && (
        <div className="mb-6 p-4 rounded-lg border border-warning/30 bg-warning-bg flex gap-3">
          <AlertCircle size={18} className="text-warning-fg shrink-0 mt-0.5" />
          <p className="text-sm text-text-secondary">
            Connect your workspace first in Workspace setup.
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6 bg-surface border border-border rounded-xl p-6 shadow-sm">
        <div>
          <label className="flex items-center gap-2 text-xs font-bold text-text-primary mb-2">
            <Building2 size={14} className="text-text-tertiary" />
            Business name
            <span className="text-db-red-fg">*</span>
          </label>
          <input dir="auto"
            type="text"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="e.g. Regional Airline"
            className="w-full px-4 py-2.5 text-sm border border-border rounded-lg bg-surface text-text-primary glow-focus transition-smooth"
            required
          />
        </div>

        <div>
          <label className="flex items-center gap-2 text-xs font-bold text-text-primary mb-2">
            <Sparkles size={14} className="text-text-tertiary" />
            Describe your data
            <span className="text-db-red-fg">*</span>
          </label>
          <textarea dir="auto"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            placeholder="e.g. I want to build a demo for an airline: bookings, routes and daily operational KPIs."
            className="w-full px-4 py-3 text-sm border border-border rounded-lg bg-surface text-text-primary placeholder:text-text-tertiary glow-focus transition-smooth resize-y min-h-[120px]"
            required
          />
          <p className="text-[11px] text-text-tertiary mt-1.5">
            Your prompt becomes the code for {plural(DEMO_GENERATED_TABLES, 'table')} and their column descriptions, which then run on Spark; Inspire
            adds {plural(DEMO_KIND_SIGNAL_TABLES, 'table')} that carry the data of every use-case kind. Tables land in{' '}
            <code className="font-mono">{inspireDatabase?.split('.')[0] || 'catalog'}.{demoSchema.trim() || 'inspire_demo_*'}</code>;
            tracking in <code className="font-mono">{inspireDatabase || 'catalog._inspire'}</code>.
          </p>
        </div>

        <div>
          <label htmlFor="demo-schema" className="flex items-center gap-2 text-xs font-bold text-text-primary mb-2">
            <Database size={14} className="text-text-tertiary" />
            Schema name
          </label>
          <input dir="auto" id="demo-schema"
            type="text"
            value={demoSchema}
            onChange={(e) => setDemoSchema(e.target.value)}
            placeholder="inspire_demo_<business>_<run>"
            aria-invalid={Boolean(demoSchemaError(demoSchema))}
            className="w-full px-4 py-2.5 text-sm font-mono border border-border rounded-lg bg-surface text-text-primary glow-focus transition-smooth"
          />
          <p className={`text-[11px] mt-1.5 ${demoSchemaError(demoSchema) ? 'text-error-fg' : 'text-text-tertiary'}`}>
            {demoSchemaError(demoSchema) || 'Leave it empty and Inspire names a new schema after the business and the run.'}
          </p>
        </div>

        <fieldset>
          <legend className="text-xs font-bold text-text-primary mb-2">Discovery Type</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {DISCOVERY_TYPE_VALID.map((mode) => (
              <label key={mode} data-demo-discovery={mode}
                className={`p-3 rounded-xl border cursor-pointer transition-smooth ${discoveryType === mode ? 'border-db-red/30 bg-db-red-50' : 'border-border hover:border-border-strong'}`}>
                <span className="flex items-center gap-2 text-xs font-semibold text-text-primary">
                  <input type="radio" name="demo-discovery" value={mode} checked={discoveryType === mode} onChange={() => setDiscoveryType(mode)} />
                  {mode}
                  {mode === DISCOVERY_RECOMMENDED && <span className="text-[10px] font-normal text-text-tertiary">(recommended)</span>}
                </span>
                <span className="block text-[10px] text-text-tertiary leading-snug mt-1">{DISCOVERY_MODE_TEXT[mode]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap gap-2 text-[11px] text-text-tertiary">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-bg-subtle border border-border">
            <Database size={12} />
            {inspireDatabase || 'Inspire DB not set'}
          </span>
        </div>

        {error && (
          <div className="p-3 rounded-lg border border-error/30 bg-error-bg text-sm text-error-fg flex gap-2">
            <AlertCircle size={16} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {lastResult?.ok && (
          <div className="p-3 rounded-lg border border-success/30 bg-success-bg text-sm text-success-fg">
            <div className="flex items-center gap-2 font-medium mb-1">
              <CheckCircle2 size={16} />
              Pipeline started
            </div>
            <ol className="text-xs list-decimal list-inside space-y-0.5 mt-1">
              <li>{demoTablesLine(lastResult.pipeline?.demo_tables)}</li>
              <li>
                Run Inspire discovery →{' '}
                {lastResult.pipeline?.discovery_type || discoveryType} with {lastResult.pipeline?.inspire_agent_notebook || '/Shared/inspire-ai/dbx_inspire_ai_agent'}
              </li>
            </ol>
            {(lastResult.warnings || []).map((w) => <p key={w} className="text-xs mt-1">{w}</p>)}
            {lastResult.job_run_url && (
              <a
                href={lastResult.job_run_url}
                target="_blank"
                rel="noreferrer"
                className="text-xs underline mt-2 inline-block"
              >
                Open job run in Databricks
              </a>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !canCallApi}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-db-red-solid text-white font-semibold text-sm hover:bg-db-red-solid-hover disabled:opacity-50 disabled:cursor-not-allowed transition-smooth"
        >
          {submitting ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Starting pipeline…
            </>
          ) : (
            <>
              Generate data &amp; run Inspire
              <ArrowRight size={18} />
            </>
          )}
        </button>
      </form>
    </div>
  );
}
