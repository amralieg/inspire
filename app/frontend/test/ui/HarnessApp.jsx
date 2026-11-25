import { useMemo, useState } from 'react';
import ImplementWizard from '../../src/pages/ImplementWizard';
import ImplementPage from '../../src/pages/ImplementPage';
import ResultsPage from '../../src/pages/ResultsPage';
import ImplementCardActions from '../../src/components/ImplementCardActions';
import Header from '../../src/components/Header';
import ShowcaseBar from '../../src/components/ShowcaseBar';
import LandingPage from '../../src/pages/LandingPage';
import RunPage from '../../src/pages/RunPage';
import ChoosePage from '../../src/pages/ChoosePage';
import LaunchPage from '../../src/pages/LaunchPage';
import SetupWizard from '../../src/pages/SetupWizard';
import ConfigPage from '../../src/pages/ConfigPage';
import MonitorPage from '../../src/pages/MonitorPage';
import GenerateDataPage from '../../src/pages/GenerateDataPage';
import App from '../../src/App';
import DataGrid from '../../src/components/DataGrid';
import { RESULTS_FRAME } from '../../src/lib/layout';
import { ThemeProvider } from '../../src/ThemeContext';
import { ValueBulkRunProvider } from '../../src/lib/valueBulkRun';
import { makeApiFetch, makeApiPostJson } from '../../src/lib/apiClient';
import { caseIdOf, implementState, notebookStatus } from '../../src/lib/implementWizard';
import MvpValuePanel from '../../src/components/MvpValuePanel';
import { measureAnswersOf, measureRows, specWithMeasure } from '../../src/lib/measureSettings';
import { HARNESS_USE_CASE, HARNESS_SETTINGS, HARNESS_SESSION_ID } from './implementFixtures.js';

const AUTH = { token: 'tok', databricksHost: 'https://workspace.example.com' };
const SETTINGS = { ...HARNESS_SETTINGS, ...AUTH };

// run="bare": Monitor opened with no session and no run, as the App shows it on /#/monitor with nothing open (FW1 D5).
function MonitorHarness({ run }) {
  const bare = run === 'bare';
  const [runId, setRunId] = useState(run === 'none' || bare ? null : '777');
  return (
    <ThemeProvider>
      <MonitorPage key={runId ?? ''} settings={SETTINGS} update={() => {}} sessionId={bare ? null : HARNESS_SESSION_ID} runId={runId} onComplete={() => {}}
        onResultsSession={() => {}} onOpenImplement={() => {}} onRunAgain={(_sid, rid) => setRunId(String(rid))} />
    </ThemeProvider>
  );
}

export default function HarnessApp({ open, nest, discoveryType, step = '', run = '' }) {
  const content = <HarnessContent open={open} discoveryType={discoveryType} step={step} run={run} />;
  if (!nest) return content;
  return (
    <>
      <header data-harness-header="" className="sticky top-0 z-40 h-16 bg-surface border-b border-border">App header</header>
      <main className="page-enter">
        <div style={{ transform: 'translateZ(0)' }}>
          <div style={{ height: 2400 }}>A long results page</div>
          {content}
        </div>
      </main>
    </>
  );
}

// REQ-510 L1: the shared More menu on its own. The glob keeps the harness bundle building before the file exists (the test then fails on
// "MoreMenu missing", not on a bundle error).
const MORE_MENU = Object.values(import.meta.glob('../../src/components/ui/MoreMenu.jsx', { eager: true }))[0]?.default || null;
function MoreMenuHarness() {
  const [picked, setPicked] = useState([]);
  if (!MORE_MENU) return <p data-more-menu-missing="">MoreMenu missing</p>;
  const MoreMenu = MORE_MENU;
  const push = (what) => setPicked((prev) => [...prev, what]);
  return (
    <ThemeProvider>
      <div className="p-6 flex items-center gap-3">
        <button type="button">Main action</button>
        <MoreMenu items={[
          { label: 'Download profile', onSelect: () => push('download') },
          { label: 'Go to Build', onSelect: () => push('build') },
          { label: 'Not now', onSelect: () => push('off'), disabled: true },
          { label: 'Delete run', onSelect: () => push('delete'), danger: true },
        ]} />
        <MoreMenu label="More for Acme" items={[{ label: 'Quick view', onSelect: () => push('quick') }]} />
      </div>
      <output aria-label="More picks" className="sr-only">{picked.join(',')}</output>
    </ThemeProvider>
  );
}

function LandingHarness() {
  const [clicks, setClicks] = useState([]);
  const push = (what) => setClicks((prev) => [...prev, what]);
  return (
    <ThemeProvider>
      <LandingPage onStart={() => push('start')} onOpenSetup={() => push('setup')} />
      <output aria-label="Landing clicks" className="sr-only">{clicks.join(',')}</output>
    </ThemeProvider>
  );
}

function HarnessContent({ open, discoveryType, step, run }) {
  if (open === 'valuePanel') return <ValuePanelHarness step={step} />;
  if (open === 'app') return <App />;
  if (open === 'card') return <CardHarness />;
  if (open === 'run') return <RunHarness />;
  if (open === 'results') return <ResultsHarness />;
  if (open === 'landing') return <LandingHarness />;
  if (open === 'choose') return <ChooseHarness />;
  if (open === 'setup') return <SetupHarness blank={step === 'blank'} />;
  if (open === 'monitor') return <MonitorHarness run={run} />;
  if (open === 'config') return <ConfigHarness />;
  if (open === 'launch') return <LaunchHarness />;
  if (open === 'generate') {
    return (
      <ThemeProvider>
        <GenerateDataPage settings={{ ...SETTINGS, inspireDatabase: 'main._inspire' }} onBack={() => {}} />
      </ThemeProvider>
    );
  }
  if (open === 'moreMenu') return <MoreMenuHarness />;
  if (open === 'grid') return step === 'bidi' ? <BidiGridHarness /> : <GridHarness wide={step === 'wide'} />;
  if (open === 'header') {
    return (
      <ThemeProvider>
        <Header page="results" setPage={() => {}} canMonitor canResults canRun canImplement={false} />
      </ThemeProvider>
    );
  }
  if (open === 'showcaseBar') return <ShowcaseBar showcase={{ title: 'Demo title', summary: 'A summary.' }} onGetStarted={() => {}} onLeave={() => {}} />;
  return <PageHarness open={open} discoveryType={discoveryType} step={step} />;
}

function RunHarness() {
  const [focus, setFocus] = useState(null);
  const [full, setFull] = useState(false);
  const [build, setBuild] = useState('');
  return (
    <ThemeProvider>
      <RunPage settings={SETTINGS} focusId={focus} onFocus={setFocus} onFull={setFull} onOpenBuild={(sid, uc) => setBuild(`${sid}:${uc}`)} />
      <output aria-label="Run full window" className="sr-only">{full ? 'yes' : 'no'}</output>
      <output aria-label="Opened Build" className="sr-only">{build}</output>
    </ThemeProvider>
  );
}

function CardHarness() {
  const [clicks, setClicks] = useState([]);
  const push = (what) => setClicks((prev) => [...prev, what]);
  const cards = [
    ['not-started', implementState(null, null), true],
    ['running', implementState({ status: 'filling' }, null), true],
    ['notebook', implementState(null, notebookStatus({ has_genie_code: 'Y' }, null)), true],
    ['no-session', implementState({ status: 'ready' }, null), false],
    ['uninstalled', implementState({ status: 'uninstalled' }, null), true],
  ];
  return (
    <div className="p-6 space-y-3">
      {cards.map(([id, status, canStart]) => (
        <div key={id} data-card={id} onClick={() => push(`card:${id}`)} className="border border-border rounded-lg py-3">
          <ImplementCardActions status={status} onImplement={canStart ? () => push(`start:${id}`) : undefined}
            onOpen={canStart ? () => push(`open:${id}`) : undefined} notebookUrl={canStart ? `https://workspace.example.com/#workspace/nb/${id}` : ''} />
        </div>
      ))}
      <output aria-label="Clicks">{clicks.join(',')}</output>
    </div>
  );
}

const GRID_ROWS = [
  { id: 'N01-U01', name: 'Predict churn', domain: 'Retention', score: '4.5', due: '2026-10-01' },
  { id: 'N01-U02', name: 'Score upsell', domain: 'Growth', score: '2', due: '2026-09-01' },
  { id: 'N01-U03', name: 'Segment shoppers', domain: 'Growth', score: '10', due: '' },
  { id: 'N02-U01', name: 'Forecast stock', domain: 'Inventory', score: '', due: '2026-11-15' },
];

function GridHarness({ wide }) {
  const [picked, setPicked] = useState('');
  const columns = [
    { key: 'id', label: 'No', fixed: true },
    { key: 'name', label: 'Use case' },
    { key: 'domain', label: 'Domain' },
    { key: 'score', label: 'Score' },
    ...(wide ? [{ key: 'owner', label: 'Owner', value: (r) => (r.domain === 'Growth' ? 'Ana' : 'Ben') }] : []),
    { key: 'due', label: 'Due' },
    { key: 'pick', label: 'Pick', fixed: true, render: (r) => <button type="button" onClick={() => setPicked(r.id)}>Pick {r.id}</button> },
  ];
  return (
    <div className="p-6">
      <DataGrid label="Sample use cases" grid="harness:use_cases" columns={columns} rows={GRID_ROWS} rowKey={(r) => r.id} pageSize={3}
        headClassName="px-2 py-1 text-left text-[11px]" cellClassName="px-2 py-1 text-[12px]" />
      <output aria-label="Picked">{picked}</output>
    </div>
  );
}

const BIDI_ROWS = [
  { id: 'N01-U01', name: 'توقع تسرب العملاء', units: '1,250 قطعة', score: '4.5', sql: 'SELECT churn FROM main.s.customers WHERE tier = 1' },
  { id: 'N01-U02', name: 'Score upsell', units: '980 pcs', score: '12.25', sql: 'اختر العملاء ذوي الإنفاق المرتفع' },
  { id: 'N01-U03', name: 'تقسيم المتسوقين', units: '12,400 قطعة', score: '10', sql: 'SELECT basket FROM main.s.orders LIMIT 10' },
  { id: 'N02-U01', name: 'Forecast stock', units: '7 pcs', score: '2', sql: 'SELECT units FROM main.s.stock' },
];

function BidiGridHarness() {
  const columns = [
    { key: 'id', label: 'No', fixed: true },
    { key: 'name', label: 'Use case' },
    { key: 'units', label: 'Units' },
    { key: 'score', label: 'Score' },
    { key: 'sql', label: 'Query' },
  ];
  return (
    <div className="p-6">
      <DataGrid label="Mixed use cases" grid="harness:bidi" columns={columns} rows={BIDI_ROWS} rowKey={(r) => r.id}
        headClassName="px-2 py-1 text-start text-[11px]" cellClassName="px-2 py-1 text-start text-[12px]" />
    </div>
  );
}

function ChooseHarness() {
  const [opened, setOpened] = useState([]);
  return (
    <ThemeProvider>
      <ChoosePage settings={SETTINGS} onNewExperiment={() => {}} onNoData={() => {}} onViewResults={(sid) => setOpened((list) => [...list, String(sid)])} />
      <output aria-label="Opened runs">{opened.join(',')}</output>
    </ThemeProvider>
  );
}

function LaunchHarness() {
  const [launched, setLaunched] = useState('');
  const [notes, setNotes] = useState(null);
  const blankDb = new URLSearchParams(window.location.search).get('db') === 'blank';
  return (
    <ThemeProvider>
      <LaunchPage settings={{ ...SETTINGS, serverEnvHasPat: true, ...(blankDb ? { inspireDatabase: '' } : {}) }} update={() => {}} onOpenResults={() => {}}
        onLaunched={(sid, runId, warnings, details) => { setLaunched(`${sid}:${runId}`); setNotes({ warnings, details }); }} />
      <output aria-label="Launched">{launched}</output>
      {notes?.warnings?.length > 0 && <MonitorPage settings={SETTINGS} update={() => {}} sessionId={HARNESS_SESSION_ID} runId={null} launchNotes={notes.warnings}
        launchDetails={notes.details} onComplete={() => {}} onResultsSession={() => {}} onOpenImplement={() => {}} />}
    </ThemeProvider>
  );
}

function ConfigHarness() {
  const [settings, setSettings] = useState(SETTINGS);
  const update = (key, value) => setSettings((prev) => ({ ...prev, [key]: typeof value === 'function' ? value(prev[key]) : value }));
  return (
    <ThemeProvider>
      <ConfigPage settings={settings} update={update} onConfigured={() => {}} />
    </ThemeProvider>
  );
}

function SetupHarness({ blank }) {
  const [settings, setSettings] = useState(blank ? { ...SETTINGS, databricksHost: '', warehouseId: '', inspireDatabase: '', notebookPath: '' } : { ...SETTINGS, notebookPath: '' });
  const [done, setDone] = useState(false);
  const update = (key, value) => setSettings((prev) => ({ ...prev, [key]: typeof value === 'function' ? value(prev[key]) : value }));
  return (
    <ThemeProvider>
      <SetupWizard settings={settings} update={update} onComplete={() => setDone(true)} />
      <output aria-label="Setup settings" className="sr-only">{JSON.stringify(settings)}</output>
      <output aria-label="Setup done" className="sr-only">{done ? 'yes' : 'no'}</output>
    </ThemeProvider>
  );
}

function ResultsHarness() {
  const [opened, setOpened] = useState('');
  return (
    <ValueBulkRunProvider>
      <div className={RESULTS_FRAME}>
        <ResultsPage
          settings={SETTINGS}
          update={() => {}}
          sessionId={HARNESS_SESSION_ID}
          onOpenImplement={(sid, id) => setOpened(`${sid}:${id}`)}
        />
        <output aria-label="Opened in Implement">{opened}</output>
      </div>
    </ValueBulkRunProvider>
  );
}

function PageHarness({ open, discoveryType, step }) {
  const [implemented, setImplemented] = useState(open === 'implement' ? caseIdOf(HARNESS_USE_CASE) : null);
  if (implemented) return <ImplementPage settings={SETTINGS} sessionId={HARNESS_SESSION_ID} focusId={implemented} />;
  return <WizardOnly discoveryType={discoveryType} step={step} onImplemented={(data) => setImplemented(data.use_case_id)} />;
}

function WizardOnly({ discoveryType, step, onImplemented }) {
  const apiFetch = useMemo(() => makeApiFetch(AUTH), []);
  const apiPostJson = useMemo(() => makeApiPostJson(AUTH), []);
  const [closed, setClosed] = useState(false);
  if (closed) return <p>The wizard is closed.</p>;
  return (
    <ImplementWizard
      uc={new URLSearchParams(window.location.search).get('noTable') ? { ...HARNESS_USE_CASE, primary_table: '', tables_involved: '' } : HARNESS_USE_CASE}
      sessionId={HARNESS_SESSION_ID}
      settings={SETTINGS}
      discoveryType={discoveryType}
      apiFetch={apiFetch}
      apiPostJson={apiPostJson}
      focus={step ? { step } : null}
      onClose={() => setClosed(true)}
      onImplemented={onImplemented}
      onOpenBuild={(useCaseId) => onImplemented({ use_case_id: useCaseId })}
    />
  );
}

// REQ-457: the MVP value panel on its own, with a measure prop driven by local state and a stand-in editor (one "Hold back" checkbox).
// step 'nomeasure' mounts it with measure undefined; step 'open-holdout' sets measure.open. The live spec is on window.__measureSpec.
const PANEL_SPEC = { money: { rule: 'gains', sign: { column: 'delta' }, currency: 'per_currency', value: { method: 'column', column: 'amount', currency: 'USD' } },
  kpi: { target: 'Churn rate' }, holdout: { enabled: false, share: 0.1 } };
function ValuePanelHarness({ step }) {
  const apiFetch = useMemo(() => makeApiFetch(AUTH), []);
  const apiPostJson = useMemo(() => makeApiPostJson(AUTH), []);
  const [spec, setSpec] = useState(PANEL_SPEC);
  window.__measureSpec = spec;
  const editor = (
    <label>
      <input type="checkbox" checked={Boolean(spec.holdout?.enabled)} onChange={(e) => setSpec((s) => ({ ...s, holdout: { ...s.holdout, enabled: e.target.checked } }))} />
      Hold back
    </label>
  );
  const measure = step === 'nomeasure' ? undefined : {
    rows: measureRows(spec), values: measureAnswersOf(spec), editor, open: step === 'open-holdout' ? 'holdout' : '',
    onKeep: (snapshot) => setSpec((s) => specWithMeasure(s, snapshot)),
  };
  return (
    <ThemeProvider>
      <MvpValuePanel uc={HARNESS_USE_CASE} sessionId={HARNESS_SESSION_ID} settings={SETTINGS} apiFetch={apiFetch} apiPostJson={apiPostJson} measure={measure} />
    </ThemeProvider>
  );
}
