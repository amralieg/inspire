import { useMemo, useState } from 'react';
import ImplementWizard from '../../src/pages/ImplementWizard';
import ImplementPage from '../../src/pages/ImplementPage';
import ResultsPage from '../../src/pages/ResultsPage';
import ImplementCardActions from '../../src/components/ImplementCardActions';
import Header from '../../src/components/Header';
import LandingPage from '../../src/pages/LandingPage';
import RunPage from '../../src/pages/RunPage';
import ChoosePage from '../../src/pages/ChoosePage';
import LaunchPage from '../../src/pages/LaunchPage';
import SetupWizard from '../../src/pages/SetupWizard';
import MonitorPage from '../../src/pages/MonitorPage';
import GenerateDataPage from '../../src/pages/GenerateDataPage';
import App from '../../src/App';
import DataGrid from '../../src/components/DataGrid';
import { RESULTS_FRAME } from '../../src/lib/layout';
import { ThemeProvider } from '../../src/ThemeContext';
import { makeApiFetch, makeApiPostJson } from '../../src/lib/apiClient';
import { caseIdOf, implementState, notebookStatus } from '../../src/lib/implementWizard';
import { HARNESS_USE_CASE, HARNESS_SETTINGS, HARNESS_SESSION_ID } from './implementFixtures.js';

const AUTH = { token: 'tok', databricksHost: 'https://workspace.example.com' };
const SETTINGS = { ...HARNESS_SETTINGS, ...AUTH };

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
  if (open === 'app') return <App />;
  if (open === 'card') return <CardHarness />;
  if (open === 'run') return <RunHarness />;
  if (open === 'results') return <ResultsHarness />;
  if (open === 'landing') return <LandingHarness />;
  if (open === 'choose') return <ChooseHarness />;
  if (open === 'setup') return <SetupHarness blank={step === 'blank'} />;
  if (open === 'monitor') {
    return (
      <ThemeProvider>
        <MonitorPage settings={SETTINGS} update={() => {}} sessionId={HARNESS_SESSION_ID} runId={run === 'none' ? null : '777'} onComplete={() => {}}
          onResultsSession={() => {}} onOpenImplement={() => {}} />
      </ThemeProvider>
    );
  }
  if (open === 'launch') return <LaunchHarness />;
  if (open === 'generate') {
    return (
      <ThemeProvider>
        <GenerateDataPage settings={{ ...SETTINGS, inspireDatabase: 'main._inspire' }} onBack={() => {}} />
      </ThemeProvider>
    );
  }
  if (open === 'grid') return step === 'bidi' ? <BidiGridHarness /> : <GridHarness wide={step === 'wide'} />;
  if (open === 'header') {
    return (
      <ThemeProvider>
        <Header page="results" setPage={() => {}} canMonitor canResults canImplement={false} />
      </ThemeProvider>
    );
  }
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
  return (
    <ThemeProvider>
      <LaunchPage settings={{ ...SETTINGS, serverEnvHasPat: true }} update={() => {}} onLaunched={(sid, runId) => setLaunched(`${sid}:${runId}`)} onOpenResults={() => {}}
        onNoData={() => {}} />
      <output aria-label="Launched">{launched}</output>
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
      <output aria-label="Setup done">{done ? 'yes' : 'no'}</output>
    </ThemeProvider>
  );
}

function ResultsHarness() {
  const [opened, setOpened] = useState('');
  return (
    <div className={RESULTS_FRAME}>
      <ResultsPage
        settings={SETTINGS}
        update={() => {}}
        sessionId={HARNESS_SESSION_ID}
        onOpenImplement={(sid, id) => setOpened(`${sid}:${id}`)}
      />
      <output aria-label="Opened in Implement">{opened}</output>
    </div>
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
      uc={HARNESS_USE_CASE}
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
