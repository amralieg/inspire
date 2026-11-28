// REQ-577, REQ-578: the Start New Discovery wizard shell. A modal with step pills, Next and Back, and the steps of lib/startWizard.js stepsOf().
// One LaunchPage stays mounted for the whole wizard and draws the form part of each step (business, picker, goals, settings) into the
// step's slot, so what the person typed survives Back and Next. Lane B (Find, Plan) and lane C (Match) steps are separate components.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Play } from 'lucide-react';
import ModalDialog from '../ModalDialog';
import Button from '../ui/Button';
import LaunchPage from '../../pages/LaunchPage';
import DataStep from './DataStep';
import PlanStep from './PlanStep';
import MatchUseCasesStep from './MatchUseCasesStep';
import MatchReviewStep from './MatchReviewStep';
import WizardJoins, { joinText, keptJoins, joinsInScope } from './WizardJoins';
import { startPlan } from '../../lib/wizPlanClient';
import { parseApiErrorMessage } from '../../lib/ucPermissionErrors';
import { launchRelationshipsText } from '../../lib/tableRelationships';
import {
  DATA_CHOOSE, DATA_FIND, DATA_TEXT, PATH_DISCOVER, PATH_MATCH, PATH_TEXT, STEP, WIZ_TITLE, WIZ_TITLE_MATCH, stepsOf,
} from '../../lib/startWizard';
import { PlainMessage } from '../TechnicalDetails';

const EMPTY_DRAFT = { path: '', businessName: '', profileId: '', dataChoice: DATA_FIND, catalogs: [], plan: null, joins: [], useCases: [], useCaseSource: 'paste' };
const FORM_STEPS = ['business', 'goals', 'settings'];

function Pills({ steps, index }) {
  return (
    <ol aria-label="Steps" className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs">
      {steps.map((item, i) => (
        <li key={item.id} aria-current={i === index ? 'step' : undefined}
          className={`shrink-0 whitespace-nowrap rounded-full ${i === index ? 'bg-db-red-50 text-db-red-fg font-semibold' : i < index ? 'text-text-primary' : 'text-text-tertiary'}`}>
          <span className="inline-flex items-center gap-1 px-1 py-1">{i + 1}. {item.label}</span>
        </li>
      ))}
    </ol>
  );
}

function StartStep({ draft, setDraft, onNoData }) {
  return (
    <section data-wiz-step="start" className="space-y-4">
      <h3 className="text-base font-bold text-text-primary">What would you like to do?</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[PATH_DISCOVER, PATH_MATCH].map((id) => (
          <button key={id} type="button" data-wiz-path={id} aria-pressed={draft.path === id} onClick={() => setDraft({ path: id })}
            className={`rounded-lg border p-4 text-start transition-smooth glow-focus ${draft.path === id ? 'border-db-red/40 bg-db-red-50' : 'border-border bg-surface hover:border-border-strong'}`}>
            <span className="block text-sm font-semibold text-text-primary">{PATH_TEXT[id]}</span>
            <span className="mt-1 block text-xs text-text-secondary">
              {id === PATH_DISCOVER ? 'Inspire reads your data and proposes the use cases it supports.' : 'Bring the use cases you have and see how well your data supports each one.'}
            </span>
          </button>
        ))}
      </div>
      {onNoData && (
        <p className="text-xs text-text-secondary">
          No data to point at yet?{' '}
          <button type="button" data-wiz-no-data="" onClick={onNoData} className="font-semibold text-primary-fg hover:underline">Try it on sample tables</button>
        </p>
      )}
    </section>
  );
}

function SlotStep({ id, title, hint, setSlot }) {
  return (
    <section data-wiz-step={id} className="space-y-4">
      <h3 className="text-base font-bold text-text-primary">{title}</h3>
      {hint && <p className="text-sm text-text-secondary">{hint}</p>}
      <div ref={setSlot} />
    </section>
  );
}

// c33 integration (REQ-577): the review names the plan the Find step made, so the person sees how many runs Start launches.
const findText = (plan) => {
  const n = plan && Array.isArray(plan.runs) ? plan.runs.length : 0;
  return n ? `${DATA_TEXT[DATA_FIND]}: plan of ${n} run${n === 1 ? '' : 's'}` : DATA_TEXT[DATA_FIND];
};

// REQ-584: the joins kept, named, and how many were taken out.
const joinsText = (joins, tables) => {
  const kept = keptJoins(joins, tables);
  const out = joinsInScope(joins, tables).length - kept.length;
  if (!kept.length && !out) return 'No joins';
  return `${kept.length ? kept.map(joinText).join(', ') : 'No joins kept'}${out ? ` (${out} removed)` : ''}`;
};

function ReviewStep({ draft, lp, tables, findPath, onEditStep }) {
  const rows = [
    ['business', 'Business', draft.businessName || lp.business || 'Not set'],
    ['data', 'Data', draft.dataChoice === DATA_FIND ? findText(draft.plan) : (lp.summary.scope || 'Not set')],
    ...(tables.length > 1 ? [['joins', 'Joins', joinsText(draft.joins, tables)]] : []),
    ['goals', 'Goals', 'Instructions, priorities and domains'],
    ['settings', 'Settings', [lp.summary.discovery, lp.summary.quality].filter(Boolean).join(', ') || 'Default settings'],
  ];
  return (
    <section data-wiz-step="review" className="space-y-4">
      <h3 className="text-base font-bold text-text-primary">Check and start</h3>
      <dl className="divide-y divide-border rounded-lg border border-border">
        {rows.map(([id, label, value]) => (
          <div key={id} className="flex items-start gap-3 px-4 py-3">
            <dt className="w-24 shrink-0 text-xs font-semibold text-text-secondary">{label}</dt>
            <dd className="min-w-0 flex-1 break-words text-sm text-text-primary">{value}</dd>
            <button type="button" data-wiz-edit={id} onClick={() => onEditStep(id === 'joins' ? (findPath ? 'plan' : 'data') : id)} className="shrink-0 text-xs font-semibold text-primary-fg hover:underline">Edit</button>
          </div>
        ))}
      </dl>
    </section>
  );
}

function SideCard({ draft, lp }) {
  return (
    <aside data-wiz-side="" className="rounded-lg border border-border bg-bg-subtle/50 p-4 text-sm">
      <h4 className="text-xs font-bold text-text-secondary">Your discovery so far</h4>
      <p className="mt-2 break-words text-text-primary">{draft.businessName || lp.business || 'No business yet'}</p>
      <p className="mt-1 text-xs text-text-secondary">{PATH_TEXT[draft.path]}</p>
    </aside>
  );
}

export default function StartWizard({ settings, update, apiFetch, onClose, onNoData, onLaunched }) {
  const [draft, setDraftState] = useState(EMPTY_DRAFT);
  const setDraft = useCallback((patch) => setDraftState((d) => ({ ...d, ...(typeof patch === 'function' ? patch(d) : patch) })), []);
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState({});
  const [lp, setLp] = useState({ business: '', hasData: false, profileId: '', launching: false, launchError: '', summary: {} });
  const [slot, setSlot] = useState(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const api = useRef({});
  const startFn = useRef(null);
  const lpBusiness = useRef('');
  const readyFns = useRef({});

  const steps = stepsOf(draft.path, draft.dataChoice);
  const step = steps[Math.min(index, steps.length - 1)];
  const findPath = draft.path === PATH_DISCOVER && draft.dataChoice === DATA_FIND;

  // REQ-584: the tables the joins are about. The find path reads them from the plan (a join counts inside one run), the choose path from the picker.
  const planGroups = useMemo(() => (draft.plan && Array.isArray(draft.plan.runs) ? draft.plan.runs.map((r) => (r.tables || []).map((t) => t.table)) : []), [draft.plan]);
  const joinTables = useMemo(() => (draft.path !== PATH_DISCOVER ? [] : findPath ? [...new Set(planGroups.flat())] : (lp.tables || [])), [draft.path, findPath, planGroups, lp.tables]);
  useEffect(() => { if (!findPath) api.current.setRelationships?.(draft.joins || []); }, [draft.joins, findPath, lp.tables]);

  const readyFor = useCallback((id) => {
    if (!readyFns.current[id]) {
      readyFns.current[id] = (value) => setReady((m) => (m[id] === Boolean(value) ? m : { ...m, [id]: Boolean(value) }));
    }
    return readyFns.current[id];
  }, []);
  const registerStart = useCallback((fn) => { startFn.current = fn; }, []);
  const onEditStep = useCallback((id) => {
    const at = stepsOf(draft.path, draft.dataChoice).findIndex((s) => s.id === id);
    if (at >= 0) setIndex(at);
  }, [draft.path, draft.dataChoice]);

  const onState = useCallback((s) => {
    setLp((prev) => (JSON.stringify(prev) === JSON.stringify(s) ? prev : s));
    if (s.business !== lpBusiness.current) {
      lpBusiness.current = s.business;
      setDraft({ businessName: s.business });
    }
    setDraft((d) => (d.profileId === s.profileId ? {} : { profileId: s.profileId }));
  }, [setDraft]);
  useEffect(() => {
    if (draft.businessName !== lpBusiness.current) api.current.setBusinessName?.(draft.businessName);
  }, [draft.businessName]);

  const launchParams = useCallback(() => (api.current.launchParams ? api.current.launchParams() : {}), []);
  const wiz = { slot, findPath, api: api.current, onState };
  const lpStep = FORM_STEPS.includes(step.id) || (step.id === 'data' && !findPath) ? step.id : 'hold';

  const canNext = (() => {
    switch (step.id) {
      case 'start': return Boolean(draft.path);
      case 'business': return Boolean((draft.businessName || '').trim());
      case 'data': return findPath ? ready.find === true : lp.hasData;
      case 'plan': return ready.plan === true;
      case 'usecases': return ready.usecases === true;
      case 'goals': case 'settings': return true;
      default: return false;
    }
  })();
  const last = index === steps.length - 1 && steps.length > 1;

  const start = async () => {
    setStarting(true);
    setStartError('');
    try {
      if (draft.path === PATH_MATCH) {
        if (!startFn.current) throw new Error('The review step is not ready yet.');
        const r = await startFn.current();
        api.current.finish?.();
        onLaunched?.(r.sessionId, r.runId, r.warnings || [], []);
      } else if (findPath) {
        const p = launchParams();
        const joinsText = launchRelationshipsText(joinsInScope(draft.joins, joinTables), joinTables);
        if (joinsText) p['18_table_relationships'] = joinsText;
        const r = await startPlan(apiFetch, {
          inspireDatabase: p['02_inspire_database'], warehouseId: settings.warehouseId, businessName: draft.businessName, plan: draft.plan, params: p, profileId: api.current.profileId || draft.profileId,
        });
        const first = (r.runs || [])[0] || {};
        api.current.finish?.();
        onLaunched?.(first.session_id, first.run_id, [], []);
      } else {
        await api.current.start();
      }
    } catch (err) {
      setStartError(parseApiErrorMessage(err.message));
    } finally {
      setStarting(false);
    }
  };

  const stepProps = { draft, setDraft, settings, apiFetch, registerStart, launchParams, onEditStep };
  const body = (() => {
    switch (step.id) {
      case 'start': return <StartStep draft={draft} setDraft={setDraft} onNoData={onNoData} />;
      case 'business': return <SlotStep id="business" title="Which business is this for?" hint="Name the company or business unit. Load a saved profile to reuse earlier settings." setSlot={setSlot} />;
      case 'data': return (
        <>
          <DataStep {...stepProps} onReady={readyFor('find')} setSlot={setSlot} />
          {draft.path === PATH_DISCOVER && !findPath && <div className="mt-5"><WizardJoins tables={joinTables} joins={draft.joins} setJoins={setDraft} settings={settings} inspireDatabase={launchParams()['02_inspire_database']} /></div>}
        </>
      );
      case 'plan': return (
        <>
          <PlanStep {...stepProps} onReady={readyFor('plan')} />
          {draft.plan && <div className="mt-5"><WizardJoins tables={joinTables} groups={planGroups} joins={draft.joins} setJoins={setDraft} settings={settings} inspireDatabase={launchParams()['02_inspire_database']} /></div>}
        </>
      );
      case 'goals': return <SlotStep id="goals" title="What should the use cases aim for?" setSlot={setSlot} />;
      case 'settings': return <SlotStep id="settings" title="How should Inspire run?" setSlot={setSlot} />;
      case 'review': return <ReviewStep draft={draft} lp={lp} tables={joinTables} findPath={findPath} onEditStep={onEditStep} />;
      case 'usecases': return <MatchUseCasesStep {...stepProps} onReady={readyFor('usecases')} />;
      case 'matchReview': return <MatchReviewStep {...stepProps} onReady={readyFor('matchReview')} />;
      default: return null;
    }
  })();
  const error = startError || lp.launchError;
  const busy = starting || lp.launching;
  const startable = step.id === STEP.matchReview.id ? ready.matchReview !== false : Boolean(draft.businessName) && (findPath ? true : lp.hasData);

  const footer = (
    <>
      {error && <PlainMessage text={error} role="alert" data-wiz-error="" className="me-auto text-xs text-error-fg" />}
      {busy && lp.labelProgress?.total > 0 && (
        <span data-wiz-label-progress="" role="status" className="text-xs text-text-secondary">Labelling tables: {lp.labelProgress.done} of {lp.labelProgress.total} tables</span>
      )}
      <Button variant="secondary" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0 || busy}>Back</Button>
      {last ? (
        <Button data-wiz-start="" onClick={start} disabled={busy || !startable}>
          {busy ? <><Loader2 size={14} className="animate-spin" aria-hidden /> Starting the run...</> : <><Play size={14} aria-hidden /> {draft.path === PATH_MATCH ? 'Start matching' : 'Start discovery'}</>}
        </Button>
      ) : (
        <Button onClick={() => setIndex((i) => Math.min(steps.length - 1, i + 1))} disabled={!canNext}>Next</Button>
      )}
    </>
  );

  const showSide = draft.path === PATH_DISCOVER && step.id !== 'start';
  return (
    <>
      <ModalDialog titleId="start-wizard-title" title={draft.path === PATH_MATCH ? WIZ_TITLE_MATCH : WIZ_TITLE} onClose={onClose} widthClass="max-w-4xl" footer={footer}
        dialogAttrs={{ 'data-start-wizard': '' }}>
        <Pills steps={steps} index={index} />
        <div className={showSide ? 'grid grid-cols-1 gap-5 md:grid-cols-[1fr_14rem]' : ''}>
          <div className="min-w-0">{body}</div>
          {showSide && <SideCard draft={draft} lp={lp} />}
        </div>
      </ModalDialog>
      <div hidden>
        <LaunchPage settings={settings} update={update} onLaunched={onLaunched} step={lpStep} wiz={wiz} />
      </div>
    </>
  );
}
