import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ClipboardPaste, Plus, Trash2 } from 'lucide-react';
import {
  KPI_DIRECTIONS,
  STRATEGY_MAX_DEPTH,
  STRATEGY_MAX_ENTRIES,
  countEntries,
  emptyEntry,
  emptyStrategy,
  isEmptyStrategy,
  levelName,
  parseStrategicContext,
  serializeStrategy,
  strategyLevels,
  treeDepth,
  validateStrategy,
} from '../lib/strategyContext';
import { parseStrategyPaste } from '../lib/strategyPaste';

const inputClass =
  'w-full px-2.5 py-1.5 text-xs border border-border rounded-md bg-surface text-text-primary placeholder:text-text-tertiary glow-focus transition-smooth';
const smallButton =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap px-2 py-1 rounded-md text-[11px] font-medium border border-border text-text-secondary hover:border-border-strong transition-smooth';

export const STRATEGY_PASTE_EXAMPLE = [
  'Customer',
  '  Win loyalty',
  '    KPI: Repeat purchase rate (%, increase)',
  '    Key result: Raise repeat purchase rate from 18% to 24%',
  '    Sponsor: Chief Customer Officer | reports to Chief Executive Officer',
  'Operations',
  '  Run lean',
  '    Cut stockouts',
].join('\n');
const samePath = (a, b) => Boolean(a && b) && a.length === b.length && a.every((v, i) => v === b[i]);

function replaceAt(list, index, item) {
  return list.map((current, i) => (i === index ? item : current));
}

function flatten(entries, path = []) {
  return (entries || []).flatMap((entry, index) => {
    const here = [...path, index];
    return [{ entry, path: here }, ...flatten(entry.children, here)];
  });
}

function entryAt(entries, path) {
  let node = null;
  let list = entries;
  for (const index of path || []) {
    node = (list || [])[index];
    if (!node) return null;
    list = node.children;
  }
  return node;
}

function updateAt(entries, path, change) {
  const [head, ...rest] = path;
  return entries.map((entry, i) => {
    if (i !== head) return entry;
    return rest.length ? { ...entry, children: updateAt(entry.children, rest, change) } : change(entry);
  });
}

function removeAt(entries, path) {
  const [head, ...rest] = path;
  if (!rest.length) return entries.filter((_, i) => i !== head);
  return entries.map((entry, i) => (i === head ? { ...entry, children: removeAt(entry.children, rest) } : entry));
}

function Column({ title, hint, footer, children }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 mb-2 min-w-0">
        <span className="text-[11px] font-semibold text-text-secondary shrink-0">{title}</span>
        {hint && <span className="text-[10px] text-text-tertiary truncate" title={hint}>{hint}</span>}
      </div>
      <div className="rounded-lg border border-border bg-bg overflow-hidden flex flex-col">
        <div className="max-h-[min(24rem,60vh)] min-h-[9rem] overflow-y-auto p-1.5 space-y-1.5">{children}</div>
        {footer && <div className="border-t border-border p-1.5 bg-bg-subtle/40 flex gap-1.5">{footer}</div>}
      </div>
    </div>
  );
}

function Placeholder({ children }) {
  return <p className="text-[10px] text-text-tertiary p-2 text-center">{children}</p>;
}

function LevelEditor({ model, setModel }) {
  const levels = strategyLevels(model);
  const depth = treeDepth(model.strategy);
  const setLevels = (next, priorityLevel = model.priorityLevel) => setModel((m) => ({ ...m, levels: next, priorityLevel }));
  const rename = (index, name) => {
    const was = levels[index];
    const priority = String(model.priorityLevel || '').trim().toLowerCase() === String(was).trim().toLowerCase() ? name : model.priorityLevel;
    setLevels(replaceAt(levels, index, name), priority);
  };
  const remove = (index) => {
    const priority = String(model.priorityLevel || '').trim().toLowerCase() === String(levels[index]).trim().toLowerCase() ? '' : model.priorityLevel;
    setLevels(levels.filter((_, i) => i !== index), priority);
  };
  return (
    <div className="rounded-lg border border-border bg-bg p-2.5 space-y-2" data-testid="strategy-levels">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[11px] font-semibold text-text-secondary">Your levels</span>
        <span className="text-[10px] text-text-tertiary">
          Top to bottom, in your own words. Every use case names the entry it serves at each level.
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {levels.map((level, index) => (
          <div key={`level-${index}`} className="flex items-center gap-1">
            {index > 0 && <span className="text-[11px] text-text-tertiary">›</span>}
            <input
              value={level}
              onChange={(e) => rename(index, e.target.value)}
              aria-label={`Level ${index + 1} name`}
              className={`${inputClass} w-32`}
            />
            {levels.length > 1 && (
              <button
                type="button"
                onClick={() => remove(index)}
                disabled={index < depth}
                className={`${smallButton} disabled:opacity-40 disabled:cursor-not-allowed`}
                title={index < depth ? 'Entries use this level; remove them first' : `Remove the level ${level}`}
                aria-label={`Remove level ${index + 1}`}
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
        ))}
        {levels.length < STRATEGY_MAX_DEPTH && (
          <button type="button" onClick={() => setLevels([...levels, ''])} className={smallButton}>
            <Plus size={11} /> Level
          </button>
        )}
      </div>
      <label className="flex flex-wrap items-center gap-2 text-[11px] text-text-secondary">
        Priority level
        <select
          value={levels.some((l) => l.trim().toLowerCase() === String(model.priorityLevel || '').trim().toLowerCase()) ? model.priorityLevel : ''}
          onChange={(e) => setModel((m) => ({ ...m, priorityLevel: e.target.value }))}
          className={`${inputClass} w-auto`}
          aria-label="Priority level"
        >
          <option value="">None</option>
          {levels.filter((l) => l.trim()).map((level) => (
            <option key={level} value={level}>{level}</option>
          ))}
        </select>
        <span className="text-[10px] text-text-tertiary">Its entries count as business priorities, next to the ones picked above.</span>
      </label>
    </div>
  );
}

function PasteImport({ model, setModel, onDone }) {
  const [pasted, setPasted] = useState('');
  const levels = strategyLevels(model);
  const preview = useMemo(() => parseStrategyPaste(pasted, levels), [pasted, levels]);
  const rows = flatten(preview.strategy);
  const deepest = treeDepth(preview.strategy);
  const apply = () => {
    setModel((m) => ({
      ...m,
      strategy: preview.strategy,
      sponsors: preview.sponsors.length ? preview.sponsors : m.sponsors,
      levels: deepest > strategyLevels(m).length
        ? [...strategyLevels(m), ...Array.from({ length: deepest - strategyLevels(m).length }, (_, i) => `Level ${strategyLevels(m).length + i + 1}`)]
        : strategyLevels(m),
    }));
    onDone();
  };
  return (
    <div className="rounded-lg border border-border bg-bg p-2.5 space-y-2" data-testid="strategy-paste">
      <p className="text-[11px] text-text-secondary leading-relaxed">
        Paste an indented list (one entry per line, deeper lines indented) or a table copied from a spreadsheet with one
        column per level. Lines that start with KPI:, Key result: or Sponsor: attach to the entry above them; a line such as
        {' '}<span className="font-mono">{levels[0]}: Customer</span> sets the level by name.
      </p>
      <textarea
        value={pasted}
        onChange={(e) => setPasted(e.target.value)}
        rows={7}
        placeholder={STRATEGY_PASTE_EXAMPLE}
        aria-label="Paste your strategy"
        className={`${inputClass} font-mono`}
      />
      {rows.length > 0 && (
        <div className="rounded-md border border-border bg-surface p-2 space-y-1" data-testid="strategy-paste-preview">
          <p className="text-[11px] font-semibold text-text-primary">
            Preview: {preview.entries} entr{preview.entries === 1 ? 'y' : 'ies'}, {preview.kpis} KPI{preview.kpis === 1 ? '' : 's'},
            {' '}{preview.keyResults} key result{preview.keyResults === 1 ? '' : 's'}, {preview.sponsors.length} sponsor{preview.sponsors.length === 1 ? '' : 's'}
          </p>
          <div className="max-h-48 overflow-y-auto space-y-0.5">
            {rows.map(({ entry, path }) => (
              <p key={path.join('.')} className="text-[11px] text-text-secondary" style={{ marginLeft: `${(path.length - 1) * 0.875}rem` }}>
                <span className="text-[9px] uppercase tracking-wider text-text-tertiary mr-1.5">{levelName(levels, path.length)}</span>
                {entry.name}
                {entry.kpis.length > 0 && <span className="text-text-tertiary"> · KPI {entry.kpis.map((k) => k.name).join(', ')}</span>}
                {entry.key_results.length > 0 && <span className="text-text-tertiary"> · {entry.key_results.length} key result{entry.key_results.length === 1 ? '' : 's'}</span>}
              </p>
            ))}
            {preview.sponsors.map((sponsor, index) => (
              <p key={`sponsor-${index}`} className="text-[11px] text-text-secondary">
                <span className="text-[9px] uppercase tracking-wider text-text-tertiary mr-1.5">Sponsor</span>
                {sponsor.role}
                {sponsor.reports_to && <span className="text-text-tertiary"> · reports to {sponsor.reports_to}</span>}
                {sponsor.owns.length > 0 && <span className="text-text-tertiary"> · owns {sponsor.owns.join(', ')}</span>}
              </p>
            ))}
          </div>
          {[...preview.notes, ...(preview.ignored.length ? [`Not used: ${preview.ignored.slice(0, 5).join(', ')}`] : []),
            ...(deepest > levels.length ? [`The list is ${deepest} levels deep; level names are added for the extra levels. Rename them above.`] : [])]
            .map((note) => <p key={note} className="text-[10px] text-text-tertiary">{note}</p>)}
        </div>
      )}
      <div className="flex gap-1.5">
        <button type="button" onClick={apply} disabled={!rows.length} className={`${smallButton} disabled:opacity-40`}>
          Use this
        </button>
        <button type="button" onClick={onDone} className={smallButton}>Cancel</button>
        {rows.length > 0 && !isEmptyStrategy(model) && (
          <span className="text-[10px] text-text-tertiary self-center">Replaces the entries{preview.sponsors.length ? ' and sponsors' : ''} below.</span>
        )}
      </div>
    </div>
  );
}

export default function StrategyEditor({ value, onChange, onProblems, domains = [] }) {
  const [initial] = useState(() => parseStrategicContext(value));
  const [model, setModel] = useState(() => (initial.mode === 'tree' ? { ...initial.model, priorities: [] } : emptyStrategy()));
  const [loadError, setLoadError] = useState(initial.error);
  const [selected, setSelected] = useState(() => (initial.mode === 'tree' && initial.model.strategy.length ? [0] : null));
  const [pasting, setPasting] = useState(false);

  const problems = useMemo(() => validateStrategy(model), [model]);
  const loadedModel = useRef(model);

  useEffect(() => {
    if (model !== loadedModel.current) onChange(serializeStrategy(model));
    if (onProblems) onProblems(problems);
  }, [model, problems]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = flatten(model.strategy);
  const current = selected ? entryAt(model.strategy, selected) : null;
  const levels = strategyLevels(model);
  const maxDepth = Math.min(STRATEGY_MAX_DEPTH, levels.length);
  const layerName = (depth) => levelName(levels, depth);
  const currentLabel = current ? `${layerName(selected.length)}: ${current.name.trim() || 'unnamed'}` : '';
  const roles = [...new Set(model.sponsors.map((s) => s.role.trim()).filter(Boolean))];
  const ownable = [...new Set([...rows.map((r) => r.entry.name.trim()), ...domains.map((d) => String(d).trim())].filter(Boolean))];

  const editEntry = (path, change) => setModel((m) => ({ ...m, strategy: updateAt(m.strategy, path, change) }));
  const editCurrent = (patch) => editEntry(selected, (entry) => ({ ...entry, ...patch }));

  const addTopLevel = () => {
    setModel((m) => ({ ...m, strategy: [...m.strategy, emptyEntry()] }));
    setSelected([model.strategy.length]);
  };
  const addChild = (path, entry) => {
    editEntry(path, (e) => ({ ...e, children: [...e.children, emptyEntry()] }));
    setSelected([...path, entry.children.length]);
  };
  const removeEntry = (path) => {
    setModel((m) => ({ ...m, strategy: removeAt(m.strategy, path) }));
    setSelected(path.length > 1 ? path.slice(0, -1) : null);
  };

  const kpiNames = current ? current.kpis.map((k) => k.name.trim()).filter(Boolean) : [];

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-text-secondary leading-relaxed">
        Applied after discovery: Inspire aligns each final use case to this strategy with evidence from its own data, adds
        KPIs, key results and benefits, and orders the results. The strategy is never used to find, keep or remove a use case.
      </p>
      <LevelEditor model={model} setModel={setModel} />
      {pasting ? (
        <PasteImport model={model} setModel={(change) => { setModel(change); setSelected(null); }} onDone={() => setPasting(false)} />
      ) : (
        <button type="button" onClick={() => setPasting(true)} className={smallButton}>
          <ClipboardPaste size={12} /> Paste a list or table
        </button>
      )}
      {initial.mode === 'path' && (
        <p className="text-[11px] text-text-secondary leading-relaxed">
          This strategy comes from the file <span className="font-mono text-text-primary">{initial.path}</span>. Entries you add here replace it.
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Column
          title="Strategy entries"
          hint={`${countEntries(model.strategy)} of ${STRATEGY_MAX_ENTRIES} · ${levels.map((l, i) => l.trim() || `Level ${i + 1}`).join(' › ')}`}
          footer={
            <button type="button" onClick={addTopLevel} className={smallButton}>
              <Plus size={12} /> {layerName(1)}
            </button>
          }
        >
          {rows.length === 0 ? (
            <Placeholder>Add a {layerName(1).toLowerCase()} to start, or paste a list</Placeholder>
          ) : (
            rows.map(({ entry, path }) => {
              const active = samePath(path, selected);
              const depth = path.length;
              return (
                <div
                  key={path.join('.')}
                  onClick={() => setSelected(path)}
                  className={`rounded-md px-1.5 py-1.5 border cursor-pointer transition-smooth space-y-1 ${
                    active ? 'bg-db-red-50 border-db-red/20' : 'border-transparent hover:bg-bg-subtle'
                  }`}
                  style={{ marginLeft: `${(depth - 1) * 0.875}rem` }}
                >
                  <div className="flex items-center gap-1">
                    <span className={`text-[9px] uppercase tracking-wider ${active ? 'text-db-red-fg' : 'text-text-tertiary'}`}>
                      {layerName(depth)}
                    </span>
                    <span className="ml-auto flex items-center gap-1">
                      {depth < maxDepth && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            addChild(path, entry);
                          }}
                          className={smallButton}
                          title={`Add a ${layerName(depth + 1).toLowerCase()} under this ${layerName(depth).toLowerCase()}`}
                        >
                          <Plus size={11} /> {layerName(depth + 1)}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeEntry(path);
                        }}
                        className={smallButton}
                        title="Remove this entry and everything under it"
                      >
                        <Trash2 size={11} />
                      </button>
                    </span>
                  </div>
                  <input
                    value={entry.name}
                    onFocus={() => setSelected(path)}
                    onChange={(e) => editEntry(path, (en) => ({ ...en, name: e.target.value }))}
                    placeholder="Name, in your own words"
                    className={inputClass}
                  />
                </div>
              );
            })
          )}
        </Column>

        <Column
          title="KPIs"
          hint={currentLabel}
          footer={
            current && (
              <button
                type="button"
                onClick={() => editCurrent({ kpis: [...current.kpis, { name: '', unit: '', direction: '', definition: '' }] })}
                className={smallButton}
              >
                <Plus size={12} /> KPI
              </button>
            )
          }
        >
          {!current ? (
            <Placeholder>Select an entry first</Placeholder>
          ) : current.kpis.length === 0 ? (
            <Placeholder>No KPIs yet</Placeholder>
          ) : (
            current.kpis.map((kpi, k) => (
              <div key={`kpi-${k}`} className="rounded-md border border-border bg-surface p-1.5 space-y-1.5">
                <div className="flex gap-1.5">
                  <input
                    value={kpi.name}
                    onChange={(e) => editCurrent({ kpis: replaceAt(current.kpis, k, { ...kpi, name: e.target.value }) })}
                    placeholder="KPI name, e.g. Repeat purchase rate"
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => editCurrent({ kpis: current.kpis.filter((_, i) => i !== k) })}
                    className={smallButton}
                    title="Remove this KPI"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <input
                    value={kpi.unit}
                    onChange={(e) => editCurrent({ kpis: replaceAt(current.kpis, k, { ...kpi, unit: e.target.value }) })}
                    placeholder="Unit, e.g. %"
                    className={inputClass}
                  />
                  <select
                    value={kpi.direction}
                    onChange={(e) => editCurrent({ kpis: replaceAt(current.kpis, k, { ...kpi, direction: e.target.value }) })}
                    className={inputClass}
                  >
                    <option value="">Direction</option>
                    {KPI_DIRECTIONS.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
                <input
                  value={kpi.definition}
                  onChange={(e) => editCurrent({ kpis: replaceAt(current.kpis, k, { ...kpi, definition: e.target.value }) })}
                  placeholder="Definition (optional)"
                  className={inputClass}
                />
              </div>
            ))
          )}
        </Column>

        <Column
          title="Key results"
          hint={currentLabel}
          footer={
            current && (
              <button
                type="button"
                onClick={() => editCurrent({ key_results: [...current.key_results, { statement: '', kpi: '' }] })}
                className={smallButton}
              >
                <Plus size={12} /> Key result
              </button>
            )
          }
        >
          {!current ? (
            <Placeholder>Select an entry first</Placeholder>
          ) : current.key_results.length === 0 ? (
            <Placeholder>No key results yet</Placeholder>
          ) : (
            current.key_results.map((result, r) => (
              <div key={`kr-${r}`} className="rounded-md border border-border bg-surface p-1.5 space-y-1.5">
                <div className="flex gap-1.5">
                  <input
                    value={result.statement}
                    onChange={(e) =>
                      editCurrent({ key_results: replaceAt(current.key_results, r, { ...result, statement: e.target.value }) })
                    }
                    placeholder="e.g. Raise repeat purchase rate from 18% to 24%"
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => editCurrent({ key_results: current.key_results.filter((_, i) => i !== r) })}
                    className={smallButton}
                    title="Remove this key result"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
                <select
                  value={result.kpi}
                  onChange={(e) => editCurrent({ key_results: replaceAt(current.key_results, r, { ...result, kpi: e.target.value }) })}
                  className={inputClass}
                >
                  <option value="">Measured by KPI (optional)</option>
                  {kpiNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
            ))
          )}
        </Column>
      </div>

      <div>
        <p className="text-xs font-semibold text-text-primary mb-0.5">Sponsor roster</p>
        <p className="text-[10px] text-text-tertiary mb-1.5">
          When you list roles here, every use case gets its sponsor from this list, never a role Inspire makes up. Reports to builds
          your leadership structure; owns ties a role to strategy entries or business domains.
        </p>
        <datalist id="strategy-sponsor-roles">
          {roles.map((role) => <option key={role} value={role} />)}
        </datalist>
        <div className="space-y-1.5">
          {model.sponsors.map((sponsor, index) => (
            <div key={`sponsor-${index}`} className="grid grid-cols-12 gap-1.5">
              <input
                value={sponsor.role}
                onChange={(e) => setModel((m) => ({ ...m, sponsors: replaceAt(m.sponsors, index, { ...sponsor, role: e.target.value }) }))}
                placeholder="Role, e.g. Chief Customer Officer"
                className={`${inputClass} col-span-3`}
              />
              <input
                value={sponsor.name}
                onChange={(e) => setModel((m) => ({ ...m, sponsors: replaceAt(m.sponsors, index, { ...sponsor, name: e.target.value }) }))}
                placeholder="Name (optional)"
                className={`${inputClass} col-span-2`}
              />
              <input
                value={sponsor.reports_to}
                onChange={(e) =>
                  setModel((m) => ({ ...m, sponsors: replaceAt(m.sponsors, index, { ...sponsor, reports_to: e.target.value }) }))
                }
                list="strategy-sponsor-roles"
                placeholder="Reports to (role)"
                className={`${inputClass} col-span-3`}
              />
              <div className="col-span-3 flex gap-1">
                <input
                  value={sponsor.owns.join(', ')}
                  onChange={(e) =>
                    setModel((m) => ({
                      ...m,
                      sponsors: replaceAt(m.sponsors, index, { ...sponsor, owns: e.target.value.split(',').map((s) => s.trimStart()) }),
                    }))
                  }
                  placeholder="Owns: entries or domains, comma-separated"
                  className={inputClass}
                />
                {ownable.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => {
                      const pick = e.target.value;
                      if (!pick) return;
                      setModel((m) => ({
                        ...m,
                        sponsors: replaceAt(m.sponsors, index, {
                          ...sponsor,
                          owns: [...sponsor.owns.map((o) => o.trim()).filter(Boolean).filter((o) => o.toLowerCase() !== pick.toLowerCase()), pick],
                        }),
                      }));
                    }}
                    aria-label={`Add what sponsor ${index + 1} owns`}
                    className={`${inputClass} w-20 shrink-0`}
                  >
                    <option value="">Add</option>
                    {ownable.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                )}
              </div>
              <button
                type="button"
                onClick={() => setModel((m) => ({ ...m, sponsors: m.sponsors.filter((_, i) => i !== index) }))}
                className={`${smallButton} col-span-1 justify-center`}
                title="Remove this sponsor"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setModel((m) => ({ ...m, sponsors: [...m.sponsors, { role: '', name: '', reports_to: '', owns: [] }] }))}
            className={smallButton}
          >
            <Plus size={12} /> Sponsor
          </button>
        </div>
      </div>

      {!isEmptyStrategy(model) && (
        <button
          type="button"
          onClick={() => {
            setModel(emptyStrategy());
            setSelected(null);
            setLoadError(null);
          }}
          className={smallButton}
        >
          <Trash2 size={12} /> Clear strategy
        </button>
      )}

      {(loadError || problems.length > 0) && (
        <div className="rounded-lg border border-db-red/30 bg-db-red-50 px-3 py-2 space-y-1">
          {[loadError, ...problems].filter(Boolean).slice(0, 8).map((problem) => (
            <p key={problem} className="text-[11px] text-db-red-fg flex items-start gap-1.5">
              <AlertCircle size={12} className="mt-0.5 shrink-0" />
              {problem}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
