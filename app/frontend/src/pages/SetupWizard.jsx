import { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2, XCircle, Loader2, ArrowRight, ArrowLeft,
  Globe2, Key, Database, Server, FileCode, ClipboardCheck, RefreshCw,
} from 'lucide-react';
import { normalizeDatabricksHost } from '../lib/normalizeDatabricksHost';
import { BOOT_TIMEOUT_TEXT, bootRead, responseError } from '../lib/apiClient';
import PageHeader from '../components/ui/PageHeader';
import Button from '../components/ui/Button';
import CatalogPicker from '../components/CatalogPicker';
import { CopySendChoice, PlainMessage, RetryChoice } from '../components/TechnicalDetails';

const STEPS = [
  { id: 'connect', label: 'Connect', icon: Globe2, desc: 'Connect to your Databricks workspace' },
  { id: 'auth', label: 'Authenticate', icon: Key, desc: 'Provide authentication credentials' },
  { id: 'warehouse', label: 'Warehouse', icon: Server, desc: 'Select a SQL warehouse' },
  { id: 'database', label: 'Database', icon: Database, desc: 'Choose or create the Inspire database' },
  { id: 'verify', label: 'Verify', icon: FileCode, desc: 'Verify permissions and publish notebook' },
];

function StatusIcon({ status, size = 16 }) {
  if (status === 'ok') return <CheckCircle2 size={size} className="text-success-fg" />;
  if (status === 'error') return <XCircle size={size} className="text-error-fg" />;
  if (status === 'loading') return <Loader2 size={size} className="animate-spin text-info-fg" />;
  return <div className="w-4 h-4 rounded-full border-2 border-border" />;
}

function verifyFailureText(checks) {
  return Object.entries(checks || {}).filter(([, c]) => !c.ok).map(([key, c]) => `${key}: ${c.message || ''}`.trim()).join('\n');
}

export default function SetupWizard({ settings, update, onComplete }) {
  const [step, setStep] = useState(0);
  const [warehouses, setWarehouses] = useState([]);
  const [catalogs, setCatalogs] = useState([]);
  const [catalogsCut, setCatalogsCut] = useState(false);
  const [catalogsWhy, setCatalogsWhy] = useState('');
  const [catalogsRound, setCatalogsRound] = useState(0);
  // The key of the catalog read that has settled. Busy is derived from it, so the render that enters the Database step is already busy.
  const [catalogsSettled, setCatalogsSettled] = useState('');
  const [schemas, setSchemas] = useState([]);
  const [verification, setVerification] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState(null);
  const [creatingDb, setCreatingDb] = useState(false);
  const [isDatabricksApp, setIsDatabricksApp] = useState(false);
  // The step list depends on /api/health (inside an App the token is supplied), so the count waits for that answer.
  const [healthKnown, setHealthKnown] = useState(false);
  // The one alert for a page read that never answered: its text, and the action Try again runs.
  const [readError, setReadError] = useState({ text: '', retry: null });
  const [detectRound, setDetectRound] = useState(0);
  const [warehouseRound, setWarehouseRound] = useState(0);
  const failRead = (err, retry) => { if (err?.deadline) setReadError({ text: BOOT_TIMEOUT_TEXT, retry }); };
  const retryDetect = () => setDetectRound((n) => n + 1);

  const { databricksHost, token, warehouseId, inspireDatabase, authMode } = settings;

  const headers = useCallback(() => {
    const h = { 'Content-Type': 'application/json' };
    if (token) { h['Authorization'] = `Bearer ${token}`; h['X-DB-PAT-Token'] = token; }
    if (databricksHost) h['X-Databricks-Host'] = databricksHost;
    return h;
  }, [token, databricksHost]);

  // Auto-detect host and Databricks App mode from environment
  // When all defaults are available, auto-complete the entire wizard
  useEffect(() => {
    (async () => {
      try {
        const defaults0 = (await bootRead('/api/defaults')) || {};
        if (defaults0.envSkipsSetupWizard) {
          onComplete();
          return;
        }

        const health = (await bootRead('/api/health')) || {};
        setHealthKnown(true);

        if (health.isDatabricksApp) {
          setIsDatabricksApp(true);

          const defaults = (await bootRead('/api/defaults')) || {};

          if (defaults.databricksHost) update('databricksHost', (chosen) => chosen || defaults.databricksHost);
          if (defaults.warehouseId) update('warehouseId', (chosen) => chosen || defaults.warehouseId);
          if (defaults.inspireDatabase) update('inspireDatabase', (chosen) => chosen || defaults.inspireDatabase);

          // If workspace installer provided all required config, auto-complete setup
          const host = defaults.databricksHost || databricksHost;
          const wh = defaults.warehouseId || warehouseId;
          const db = defaults.inspireDatabase || inspireDatabase;

          if (host && wh && db) {
            const autoHeaders = { 'Content-Type': 'application/json' };
            if (host) autoHeaders['X-Databricks-Host'] = host;

            // Auto-create database
            try {
              const created = await fetch('/api/setup/create-database', {
                method: 'POST',
                headers: autoHeaders,
                body: JSON.stringify({ inspire_database: db, warehouse_id: wh }),
              });
              if (!created.ok) await responseError(created.clone());
            } catch {}

            // Auto-publish notebook. A read that never answers stops here: the page says so, and Try again runs the detect again.
            try {
              const nbData = await bootRead('/api/notebook', { headers: autoHeaders });
              if (nbData?.path) update('notebookPath', nbData.path);
            } catch (err) {
              failRead(err, retryDetect);
              return;
            }

            // Complete setup immediately
            onComplete();
            return;
          }
        }
      } catch (err) {
        // Other failures keep the form as it is, with every step counted.
        setHealthKnown(true);
        failRead(err, retryDetect);
      }
    })();
  }, [detectRound]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load warehouses when auth is ready (or in Databricks App mode where token is auto-injected)
  useEffect(() => {
    if ((!token && !isDatabricksApp) || step < 2) return;
    bootRead('/api/warehouses', { headers: headers() })
      .then(data => {
        const whs = data?.warehouses || [];
        setWarehouses(whs);
        // Auto-select first running serverless warehouse
        if (whs.length > 0) {
          const running = whs.find(w => w.state === 'RUNNING' && w.enable_serverless_compute);
          const first = running || whs.find(w => w.state === 'RUNNING') || whs[0];
          if (first) update('warehouseId', (chosen) => chosen || first.id);
        }
      })
      .catch((err) => failRead(err, () => setWarehouseRound((n) => n + 1)));
  }, [token, databricksHost, step, warehouseRound]);

  // Load catalogs when warehouse is ready (warehouse_id enables SQL fallback for SP / UC REST gaps)
  // The read is busy from the render that enters the Database step until its own key settles (step is in the key, so a re-entry is busy too).
  const catalogKey = [step, token, databricksHost, warehouseId, isDatabricksApp, catalogsRound].join('|');
  const catalogsBusy = step >= 3 && (Boolean(token) || isDatabricksApp) && catalogsSettled !== catalogKey;
  useEffect(() => {
    if ((!token && !isDatabricksApp) || step < 3) return undefined;
    let current = true;
    const q = warehouseId ? `?warehouse_id=${encodeURIComponent(warehouseId)}` : '';
    fetch(`/api/catalogs${q}`, { headers: headers() })
      .then(async (r) => {
        if (!r.ok) throw await responseError(r);
        return r.json();
      })
      .then(data => {
        if (!current) return;
        setCatalogs(data.catalogs || []);
        setCatalogsCut(Boolean(data.truncated));
        setCatalogsWhy('');
        setCatalogsSettled(catalogKey);
      })
      .catch((e) => {
        if (!current) return;
        setCatalogs([]);
        setCatalogsWhy(e.message);
        setCatalogsSettled(catalogKey);
      });
    // A read the step has left answers into nothing: a newer read owns the busy flag.
    return () => { current = false; };
  }, [token, databricksHost, step, warehouseId, isDatabricksApp, headers, catalogsRound]);

  // Load schemas when catalog selected
  const selectedCatalog = inspireDatabase?.split('.')[0] || '';
  useEffect(() => {
    if (!selectedCatalog || (!token && !isDatabricksApp)) return;
    const q = warehouseId ? `?warehouse_id=${encodeURIComponent(warehouseId)}` : '';
    fetch(`/api/catalogs/${encodeURIComponent(selectedCatalog)}/schemas${q}`, { headers: headers() })
      .then(async (r) => { if (!r.ok) await responseError(r.clone()); return r.json(); })
      .then(data => setSchemas(data.schemas || []))
      .catch(() => {});
  }, [selectedCatalog, token, databricksHost, warehouseId, isDatabricksApp, headers]);

  // Run verification
  const runVerification = async () => {
    setVerifying(true);
    setVerification(null);
    try {
      const resp = await fetch('/api/setup/verify', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ warehouse_id: warehouseId, inspire_database: inspireDatabase }),
      });
      const refused = resp.ok ? null : await responseError(resp.clone());
      const data = await resp.json();
      if (!refused?.dialog) setVerification(data);
    } catch (err) {
      setVerification({ ok: false, checks: { error: { ok: false, message: err.message } } });
    }
    setVerifying(false);
  };

  // Publish notebook
  const publishNotebook = async () => {
    setPublishing(true);
    try {
      const resp = await fetch('/api/notebook/republish', { method: 'POST', headers: headers() });
      const refused = resp.ok ? null : await responseError(resp.clone());
      const data = await resp.json();
      if (data.path) {
        update('notebookPath', data.path);
        setPublishResult({ ok: true, path: data.path });
      } else if (!refused?.dialog) {
        setPublishResult({ ok: false, message: data.error || 'Failed to publish' });
      }
    } catch (err) {
      setPublishResult({ ok: false, message: err.message });
    }
    setPublishing(false);
  };

  // Create database
  const createDatabase = async () => {
    setCreatingDb(true);
    try {
      const resp = await fetch('/api/setup/create-database', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ inspire_database: inspireDatabase, warehouse_id: warehouseId }),
      });
      if (!resp.ok) await responseError(resp.clone());
      const data = await resp.json();
      if (data.ok) {
        setCreatingDb(false);
        return true;
      }
    } catch {}
    setCreatingDb(false);
    return false;
  };

  const canProceed = () => {
    switch (step) {
      case 0: return !!databricksHost || isDatabricksApp;
      case 1: return !!token || isDatabricksApp;
      case 2: return !!warehouseId;
      case 3: return !catalogsBusy && !!inspireDatabase && inspireDatabase.includes('.');
      case 4: return verification?.ok;
      default: return false;
    }
  };

  // Inside a Databricks App the token is supplied, so the Authenticate step (index 1) is skipped both ways.
  const skipAuth = isDatabricksApp;
  const nextStep = (s) => { const n = Math.min(s + 1, STEPS.length - 1); return skipAuth && n === 1 ? 2 : n; };
  const prevStep = (s) => { const n = Math.max(0, s - 1); return skipAuth && n === 1 ? 0 : n; };
  const shown = STEPS.map((st, index) => ({ ...st, index })).filter((st) => !(skipAuth && st.id === 'auth'));
  const position = shown.findIndex((st) => st.index === step);

  const handleNext = async () => {
    if (step === 3 && inspireDatabase) {
      await createDatabase();
    }
    if (step === 4 && verification?.ok) {
      // Publish notebook if not done
      if (!publishResult?.ok) await publishNotebook();
      onComplete();
      return;
    }
    if (step === 4 && !verification) {
      await runVerification();
      return;
    }
    setStep(s => nextStep(s));
  };

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-6 py-12">
      <div className="w-full">
        {readError.text && (
          <PlainMessage text={readError.text} role="alert" data-setup-error="" className="mb-4 px-4 py-3 rounded-xl border border-error/20 bg-error-bg text-xs text-error-fg"
            onRetry={() => { const { retry } = readError; setReadError({ text: '', retry: null }); retry(); }} />
        )}
        {/* Header */}
        <PageHeader className="mb-10" title="Inspire AI Setup" subtitle="Let's get your workspace connected in under 2 minutes." />

        {/* Step indicators */}
        <div className="flex items-center justify-center gap-1 mb-8">
          {healthKnown && shown.map((s, i) => (
            <div key={s.id} className="flex items-center">
              <button
                onClick={() => s.index < step && setStep(s.index)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-transparent text-xs font-medium transition-colors ${
                  s.index === step ? 'border-primary bg-primary-subtle text-primary' :
                  s.index < step ? 'bg-success/10 text-success-fg cursor-pointer hover:bg-success/20' :
                  'bg-bg-subtle text-text-tertiary'
                }`}
              >
                {s.index < step ? <CheckCircle2 size={14} /> : <s.icon size={14} />}
                <span className="hidden sm:inline">{s.label}</span>
              </button>
              {i < shown.length - 1 && <div className={`w-6 h-px mx-1 ${s.index < step ? 'bg-success' : 'bg-border'}`} />}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="glass rounded-2xl p-8 shadow-xl page-enter" key={step}>
          <h2 className="text-lg font-bold text-text-primary mb-1">{STEPS[step].desc}</h2>
          {healthKnown && <p className="text-xs text-text-tertiary mb-6">Step {position + 1} of {shown.length}</p>}

          {/* Step 0: Connect */}
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-text-secondary mb-1.5 block">Databricks Workspace URL</label>
                <input dir="auto"
                  type="text"
                  value={databricksHost}
                  onChange={(e) => update('databricksHost', normalizeDatabricksHost(e.target.value))}
                  placeholder="https://adb-xxxx.xx.azuredatabricks.net"
                  className="w-full px-4 py-3 rounded-xl border border-border bg-surface text-text-primary text-sm focus:border-db-red transition-colors"
                />
                <p className="text-xs text-text-tertiary mt-1.5">
                  Find this in your browser address bar when logged into Databricks, or in Workspace Settings.
                </p>
              </div>
              {databricksHost && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-success-bg text-success-fg text-xs">
                  <CheckCircle2 size={14} /> Workspace URL configured
                </div>
              )}
            </div>
          )}

          {/* Step 1: Authenticate */}
          {step === 1 && (
            <div className="space-y-4">
              {isDatabricksApp ? (
                <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-success-bg text-success-fg text-sm">
                  <CheckCircle2 size={16} /> Authenticated automatically via Databricks App. No PAT needed.
                </div>
              ) : (
                <>
                  <div className="flex gap-2 mb-4">
                    {['pat', 'sp'].map(mode => (
                      <button
                        key={mode}
                        onClick={() => update('authMode', mode)}
                        className={`flex-1 px-4 py-2.5 rounded-xl text-xs font-medium border transition-colors ${
                          authMode === mode ? 'border-db-red bg-db-red-50 text-db-red-fg' : 'border-border text-text-secondary hover:border-border-strong'
                        }`}
                      >
                        {mode === 'pat' ? 'Personal Access Token' : 'Service Principal'}
                      </button>
                    ))}
                  </div>

                  {authMode === 'pat' ? (
                    <div>
                      <label className="text-xs font-medium text-text-secondary mb-1.5 block">Personal Access Token (PAT)</label>
                      <input dir="auto"
                        type="password"
                        value={token}
                        onChange={(e) => update('token', e.target.value)}
                        placeholder="dapi..."
                        className="w-full px-4 py-3 rounded-xl border border-border bg-surface text-text-primary text-sm font-mono focus:border-db-red transition-colors"
                      />
                      <p className="text-xs text-text-tertiary mt-1.5">
                        Generate at: Databricks &rarr; User Settings &rarr; Developer &rarr; Access Tokens &rarr; Generate New Token
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-medium text-text-secondary mb-1 block">Client ID</label>
                        <input dir="auto" type="text" value={settings.spClientId} onChange={(e) => update('spClientId', e.target.value)}
                          className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface text-text-primary text-sm font-mono focus:border-db-red" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-text-secondary mb-1 block">Client Secret</label>
                        <input dir="auto" type="password" value={settings.spClientSecret} onChange={(e) => update('spClientSecret', e.target.value)}
                          className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface text-text-primary text-sm font-mono focus:border-db-red" placeholder="dose..." />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-text-secondary mb-1 block">Tenant ID (Azure)</label>
                        <input dir="auto" type="text" value={settings.spTenantId} onChange={(e) => update('spTenantId', e.target.value)}
                          className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface text-text-primary text-sm font-mono focus:border-db-red" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
                      </div>
                    </div>
                  )}

                  {token && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-success-bg text-success-fg text-xs">
                      <CheckCircle2 size={14} /> Token configured ({token.slice(0, 6)}...{token.slice(-4)})
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Step 2: Warehouse */}
          {step === 2 && (
            <div className="space-y-3">
              {warehouses.length === 0 ? (
                <div className="flex items-center gap-2 py-8 justify-center text-text-tertiary text-sm">
                  <Loader2 size={16} className="animate-spin" /> Loading warehouses...
                </div>
              ) : (
                <>
                  <p className="text-xs text-text-secondary mb-2">Select a SQL warehouse for executing queries:</p>
                  {warehouses.map(wh => (
                    <button
                      key={wh.id}
                      onClick={() => update('warehouseId', wh.id)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-start transition-colors ${
                        warehouseId === wh.id ? 'border-db-red bg-db-red-50' : 'border-border hover:border-border-strong bg-surface'
                      }`}
                    >
                      <div className={`w-2.5 h-2.5 rounded-full ${wh.state === 'RUNNING' ? 'bg-success' : wh.state === 'STOPPED' ? 'bg-text-disabled' : 'bg-warning'}`} />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-text-primary">{wh.name}</p>
                        <p className="text-xs text-text-tertiary">{wh.id} · {wh.state}{wh.enable_serverless_compute ? ' · Serverless' : ''}</p>
                      </div>
                      {warehouseId === wh.id && <CheckCircle2 size={16} className="text-db-red-fg" />}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}

          {/* Step 3: Database */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-xs text-text-secondary">Inspire AI stores session data and results in a Unity Catalog schema.</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-text-secondary mb-1 block">Catalog</label>
                  <CatalogPicker
                    id="setup-inspire-database"
                    value={selectedCatalog}
                    onChange={(name) => {
                      const schema = inspireDatabase?.split('.')[1] || 'inspire';
                      update('inspireDatabase', `${name}.${schema}`);
                    }}
                    catalogs={catalogs}
                    truncated={catalogsCut}
                    placeholder="Select catalog..."
                    className="w-full px-3 py-2.5 rounded-xl border border-border bg-surface text-text-primary text-sm focus:border-db-red"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-text-secondary mb-1 block">Schema</label>
                  <input dir="auto"
                    type="text"
                    value={inspireDatabase?.split('.')[1] || ''}
                    onChange={(e) => update('inspireDatabase', `${selectedCatalog}.${e.target.value}`)}
                    placeholder="inspire"
                    className="w-full px-3 py-2.5 rounded-xl border border-border bg-surface text-text-primary text-sm focus:border-db-red"
                    list="schema-options"
                  />
                  <datalist id="schema-options">
                    {schemas.map(s => <option key={s.name} value={s.name} />)}
                  </datalist>
                </div>
              </div>
              {catalogsBusy && (
                <p role="status" className="text-xs text-text-secondary flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading catalogs...</p>
              )}
              {catalogsWhy && <PlainMessage as="p" text={catalogsWhy} onRetry={() => setCatalogsRound((n) => n + 1)} copy role="note" data-uc-why="" className="text-xs text-text-secondary" />}
              {inspireDatabase && inspireDatabase.includes('.') && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-info-bg text-info-fg text-xs">
                  <Database size={14} /> Will use <span className="font-mono font-bold">{inspireDatabase}</span>
                  {creatingDb && <Loader2 size={14} className="animate-spin ms-1" />}
                </div>
              )}
            </div>
          )}

          {/* Step 4: Verify */}
          {step === 4 && (
            <div className="space-y-4">
              {!verification && !verifying && (
                <div className="text-center py-6">
                  <p className="text-sm text-text-secondary mb-4">Ready to verify your configuration.</p>
                  <Button onClick={runVerification} className="px-6 py-3">
                    <ClipboardCheck size={16} /> Run Verification
                  </Button>
                </div>
              )}

              {verifying && (
                <div className="flex items-center gap-3 py-8 justify-center">
                  <Loader2 size={20} className="animate-spin text-db-red-fg" />
                  <span className="text-sm text-text-secondary">Checking all prerequisites...</span>
                </div>
              )}

              {verification && (
                <div className="space-y-2">
                  {Object.entries(verification.checks).map(([key, check]) => (
                    <div key={key} className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${check.ok ? 'border-success/20 bg-success-bg' : 'border-error/20 bg-error-bg'}`}>
                      <StatusIcon status={check.ok ? 'ok' : 'error'} />
                      <div className="flex-1">
                        <p className="text-xs font-semibold text-text-primary capitalize">{key}</p>
                        <PlainMessage as="p" text={check.message} className="text-xs text-text-secondary" />
                      </div>
                    </div>
                  ))}

                  {!verification.ok && (
                    <div data-verify-again="" className="flex flex-wrap items-center gap-1.5">
                      <RetryChoice onRetry={runVerification} label="Check again" />
                      <CopySendChoice text={verifyFailureText(verification.checks)} />
                    </div>
                  )}

                  {verification.ok && !publishResult?.ok && (
                    <Button onClick={publishNotebook} disabled={publishing} className="w-full mt-4 py-3">
                      {publishing ? <><Loader2 size={14} className="animate-spin" /> Publishing notebook...</> : <><FileCode size={14} /> Publish Notebook to Workspace</>}
                    </Button>
                  )}

                  {publishResult && !publishResult.ok && (
                    <PlainMessage text={`Inspire could not publish the notebook: ${publishResult.message}`} securable="workspace" copy role="alert" data-publish-error=""
                      className="px-4 py-3 rounded-xl border border-error/20 bg-error-bg text-xs text-error-fg" />
                  )}

                  {publishResult?.ok && (
                    <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-success/20 bg-success-bg">
                      <CheckCircle2 size={16} className="text-success-fg" />
                      <div>
                        <p className="text-xs font-semibold text-success-fg">Notebook published!</p>
                        <p className="text-xs text-text-secondary font-mono">{publishResult.path}</p>
                      </div>
                    </div>
                  )}

                  {!verification.ok && (
                    <button onClick={runVerification} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 mt-2 border border-border text-text-secondary text-xs rounded-xl hover:bg-bg-subtle transition-colors">
                      <RefreshCw size={14} /> Re-check after fixing
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between mt-8 pt-6 border-t border-border">
            <button
              onClick={() => setStep(s => prevStep(s))}
              disabled={step === 0}
              className="flex items-center gap-1.5 px-4 py-2 text-sm text-text-secondary hover:text-text-primary disabled:opacity-30 transition-colors"
            >
              <ArrowLeft size={14} /> Back
            </button>

            <div className="flex items-center gap-3">
              <button
                onClick={onComplete}
                className="text-xs text-text-tertiary hover:text-text-secondary transition-colors"
              >
                Skip setup
              </button>
              <Button data-variant="primary" onClick={handleNext} disabled={!canProceed() && step < 4} className="px-6 py-2.5">
                {step === 4 ? (verification?.ok ? 'Get Started' : 'Verify') : 'Continue'} <ArrowRight size={14} />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
