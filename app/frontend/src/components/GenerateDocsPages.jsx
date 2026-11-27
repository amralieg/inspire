import { useState } from 'react';
import { Check, FileSpreadsheet, FileText, Globe, Image as ImageIcon, Plus, Presentation, Sparkles, Upload, X } from 'lucide-react';
import { checkLogo, CONTENT_BLOCKS, EXCEL_COLUMNS, EXCEL_GROUPS, kindsForLayout, LOGO_TYPES, ORIENTATIONS, orderedColumns, VIBE_EXAMPLES } from '../lib/docgen/docOptions.js';
import { INFOGRAPHIC_STYLES } from '../lib/docgen/infographicApi.js';
import { DOC_PALETTES, DOC_STYLES, DOC_THEMES, resolveTheme } from '../lib/docgen/docStyles.js';
import { DOCUMENT_LANGUAGE_CHOICES } from '../constants/documentLanguages.js';
import { plural } from '../lib/plural.js';

// REQ-503: the wizard's pages. Each is one short screen; the dialog shows one at a time.
const KIND_INFO = {
  infographic: { label: 'Infographic', hint: 'One picture of a use case, as a PDF', Icon: ImageIcon },
  pptx: { label: 'PowerPoint', hint: 'A deck: cover, summary, a slide per use case', Icon: Presentation },
  pdf: { label: 'PDF brief', hint: 'A cover and a page per use case', Icon: FileText },
  xlsx: { label: 'Excel', hint: 'One sheet, a row per use case', Icon: FileSpreadsheet },
  docx: { label: 'Word', hint: 'The brief as a Word file you can edit', Icon: FileText },
};

const toggle = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
const card = (on) => `rounded-xl border p-3 text-start transition-colors motion-safe:duration-150 ${on ? 'border-db-red bg-db-red-50 shadow-sm' : 'border-border bg-surface hover:bg-bg-subtle'}`;
const tick = (on) => `mt-0.5 inline-block h-4 w-4 shrink-0 rounded border ${on ? 'border-primary-solid bg-primary-solid' : 'border-border-strong bg-surface'}`;

export const TITLES = { documents: 'Documents', layout: 'Layout and language', include: 'What to include', style: 'Style and color', columns: 'Excel columns', vibe: 'Vibe your docs', review: 'Review' };

// The strip above every page and above the progress: the use cases it is for and the steps. `made` ticks every step (the files are being made).
export function DocsHeader({ names, pages, pageId, made = false }) {
  const at = Math.max(0, pages.indexOf(pageId));
  const shownNames = names.slice(0, 5);
  return (
    <div className="-mx-5 -mt-4 mb-1 bg-linear-to-r from-db-red-50 to-transparent px-5 py-3">
      <p className="flex items-center gap-2 text-xs text-text-secondary">
        <Sparkles size={14} className="shrink-0 text-db-red-fg" aria-hidden />
        <span className="min-w-0 truncate" title={names.join(', ')}>{shownNames.join(', ')}{names.length > shownNames.length ? ` and ${names.length - shownNames.length} more` : ''}</span>
      </p>
      <ol className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Steps">
        {pages.map((p, i) => (
          <li key={p} data-docs-step={p} aria-current={p === pageId ? 'step' : undefined}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${p === pageId ? 'bg-primary-solid text-white' : i < at || made ? 'bg-db-red-100 text-db-red-fg' : 'bg-bg-subtle text-text-secondary'}`}>
            {(i < at || made) ? <Check size={14} aria-hidden /> : <span aria-hidden>{i + 1}</span>}{TITLES[p]}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function DocumentsPage({ options, set }) {
  const each = options.layout === 'each';
  const offered = kindsForLayout(options.layout);
  // C28 (REQ-570): overall documents are Excel, PDF and PowerPoint; one document per use case also offers the infographic and Word.
  const pickScope = (layout) => set({ layout, kinds: options.kinds.filter((k) => kindsForLayout(layout).includes(k)) });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Documents for">
        <span className="text-sm font-semibold text-text-primary" aria-hidden>Documents for</span>
        {[['one', 'Overall', 'All selected use cases together'], ['each', 'Each use case', 'One document per use case, with the infographic']].map(([v, label, hint]) => (
          <button key={v} type="button" role="radio" aria-checked={options.layout === v} data-doc-scope={v} title={hint} onClick={() => pickScope(v)}
            className={`${card(options.layout === v)} px-4 py-1.5 text-sm font-semibold text-text-primary`}>{label}</button>
        ))}
      </div>
      <p className="text-xs text-text-secondary">{each ? 'Each use case gets its own files, and the infographic is made one per use case.' : 'The overall documents are Excel, PDF and PowerPoint. Pick "Each use case" for the infographic.'}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Object.entries(KIND_INFO).filter(([id]) => offered.includes(id)).map(([id, info]) => {
          const { label, hint, Icon } = info;
          const on = options.kinds.includes(id);
          return (
            <button key={id} type="button" role="checkbox" aria-checked={on} data-doc-kind={id} onClick={() => set({ kinds: toggle(options.kinds, id) })} className={`${card(on)} flex items-start gap-3`}>
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${on ? 'bg-primary-solid text-white' : 'bg-bg-subtle text-text-secondary'}`}><Icon size={20} aria-hidden /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-text-primary">{label}</span>
                <span className="block text-xs text-text-secondary">{hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function LayoutPage({ options, set, eachApplies, count }) {
  const { languages } = options;
  const setLang = (i, v) => set({ languages: languages.map((l, j) => (j === i ? v : l)) });
  const free = DOCUMENT_LANGUAGE_CHOICES.find((l) => !languages.includes(l));
  return (
    <div className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="text-sm font-bold text-text-primary">How many files</legend>
        {[['one', 'One file for all selected', `All ${plural(count, 'use case')} together`], ['each', 'One file for each use case', `${plural(count, 'file')} for each document type`]].map(([v, label, hint]) => (
          <label key={v} className={`${card(options.layout === v)} flex cursor-pointer items-start gap-3`}>
            <input type="radio" name="docs-layout" value={v} checked={options.layout === v} onChange={() => set({ layout: v, kinds: options.kinds.filter((k) => kindsForLayout(v).includes(k)) })} className="mt-1" />
            <span><span className="block text-sm font-bold text-text-primary">{label}</span><span className="block text-xs text-text-secondary">{hint}</span></span>
          </label>
        ))}
        {!eachApplies && <p className="text-xs text-text-secondary">This applies to PowerPoint, the PDF brief and Word. Excel is always one file.</p>}
      </fieldset>
      <div className="space-y-2">
        <p className="flex items-center gap-2 text-sm font-bold text-text-primary"><Globe size={14} aria-hidden /> Languages</p>
        {languages.map((l, i) => (
          <div key={i} className="flex items-center gap-2">
            <select data-docs-language="" aria-label={i === 0 ? 'Language' : `Language ${i + 1}`} value={l} onChange={(e) => setLang(i, e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text-primary">
              {DOCUMENT_LANGUAGE_CHOICES.filter((c) => c === l || !languages.includes(c)).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {languages.length > 1 && (
              <button type="button" aria-label={`Remove ${l}`} onClick={() => set({ languages: languages.filter((_, j) => j !== i) })} className="rounded-md p-1.5 text-text-secondary hover:bg-bg-subtle"><X size={14} aria-hidden /></button>
            )}
          </div>
        ))}
        {free && (
          <button type="button" onClick={() => set({ languages: [...languages, free] })} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-subtle">
            <Plus size={14} aria-hidden /> Add a language
          </button>
        )}
        <p className="text-xs text-text-secondary">Each language adds its own set of files. Other languages than English are translated for you.</p>
      </div>
    </div>
  );
}

export function IncludePage({ options, set }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {CONTENT_BLOCKS.map((b) => {
        const on = options.blocks.includes(b.id);
        return (
          <button key={b.id} type="button" role="checkbox" aria-checked={on} data-doc-block={b.id} onClick={() => set({ blocks: toggle(options.blocks, b.id) })} className={`${card(on)} flex items-start gap-2 py-2`}>
            <span className={tick(on)} aria-hidden />
            <span className="min-w-0"><span className="block text-sm font-semibold text-text-primary">{b.label}</span><span className="block text-xs text-text-secondary">{b.hint}</span></span>
          </button>
        );
      })}
    </div>
  );
}

// REQ-526: a small picture of each design's own infographic (an inline data image, no network).
const thumbOf = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export function StylePage({ options, set, svg, thumbs = {}, infographic = false }) {
  const theme = resolveTheme(options.style, options.palette, options.customColor, options.theme);
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-3">
        <div>
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Theme">
            <span className="text-sm font-semibold text-text-primary" aria-hidden>Theme</span>
            {DOC_THEMES.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={(options.theme || 'light') === t.id} data-doc-theme={t.id} onClick={() => set({ theme: t.id })} className={`${card((options.theme || 'light') === t.id)} px-4 py-1.5 text-sm font-semibold text-text-primary`}>{t.label}</button>
            ))}
          </div>
          <p className="mt-1 text-xs text-text-secondary">Applies to PDF and PowerPoint files; Word is always white. Excel sheets stay light.</p>
        </div>
        {infographic && (
          <div className="space-y-2" data-docs-infographic-options="">
            <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Infographic orientation">
              <span className="text-sm font-semibold text-text-primary" aria-hidden>Infographic</span>
              {ORIENTATIONS.map((o) => (
                <button key={o.id} type="button" role="radio" aria-checked={(options.orientation || 'landscape') === o.id} data-doc-orientation={o.id} onClick={() => set({ orientation: o.id })} className={`${card((options.orientation || 'landscape') === o.id)} px-4 py-1.5 text-sm font-semibold text-text-primary`}>{o.label}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Infographic style">
              {INFOGRAPHIC_STYLES.map((s) => {
                const on = (options.infographicStyle || INFOGRAPHIC_STYLES[0].id) === s.id;
                const pic = s.thumbnail || (thumbs[s.id] ? thumbOf(thumbs[s.id]) : '');
                return (
                  <button key={s.id} type="button" role="radio" aria-checked={on} data-doc-infographic-style={s.id} onClick={() => set({ infographicStyle: s.id })} className={`${card(on)} py-2`}>
                    {pic && <img data-doc-infographic-thumb="" src={pic.startsWith('data:') || pic.startsWith('http') || pic.startsWith('/') ? pic : thumbOf(pic)} alt="" className="mb-1 max-h-28 w-auto rounded border border-border" />}
                    <span className="block text-xs font-bold text-text-primary">{s.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Style">
          {DOC_STYLES.map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={options.style === s.id} data-doc-style={s.id} onClick={() => set({ style: s.id })} className={`${card(options.style === s.id)} py-2`}>
              {thumbs[s.id] && <img data-doc-style-thumb="" src={thumbOf(thumbs[s.id])} alt="" className="mb-1 aspect-[794/1123] max-h-28 w-auto rounded border border-border" />}
              <span className="flex gap-1" aria-hidden>{s.accents.map((c, i) => <span key={i} className="h-2.5 w-5 rounded-full" style={{ background: c }} />)}</span>
              <span className="mt-1 block text-xs font-bold text-text-primary">{s.label}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Color palette">
          {DOC_PALETTES.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={options.palette === p.id} data-doc-palette={p.id} onClick={() => set({ palette: p.id })} className={`${card(options.palette === p.id)} flex items-center gap-2 px-2 py-1.5`}>
              <span className="flex" aria-hidden>{p.colors.map((c, i) => <span key={i} className="-me-1 h-4 w-4 rounded-full border border-surface" style={{ background: c }} />)}</span>
              <span className="text-xs font-semibold text-text-primary">{p.label}</span>
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-text-primary">
          <span className="font-semibold">Brand color</span>
          <input type="text" dir="ltr" aria-label="Brand color" placeholder="#RRGGBB" value={options.customColor} onChange={(e) => set({ customColor: e.target.value })} className="w-28 rounded-md border border-border bg-surface px-2 py-1 text-sm" />
          <input type="color" aria-label="Pick a brand color" value={/^#[0-9a-f]{6}$/i.test(options.customColor) ? options.customColor : theme.accents[0]} onChange={(e) => set({ customColor: e.target.value })} className="h-7 w-9 cursor-pointer rounded border border-border bg-surface" />
        </label>
      </div>
      <div data-docs-preview="" aria-label="Preview" className="max-h-[48vh] min-w-0 overflow-hidden rounded-xl border border-border bg-bg-subtle p-2 shadow-inner [&>svg]:h-auto [&>svg]:max-h-[44vh] [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}

// C28 (REQ-572): the last step. A text that guides the documents' wording (passed to the AI calls), clickable examples, and the person's logo.
export function VibePage({ options, set }) {
  const [problem, setProblem] = useState('');
  const logo = options.logo;
  const pickFile = (file) => {
    if (!file) return;
    const bad = checkLogo({ type: file.type, size: file.size });
    setProblem(bad);
    if (bad) return;
    const reader = new FileReader();
    reader.onload = () => set({ logo: { name: file.name, type: file.type, size: file.size, dataUrl: String(reader.result) } });
    reader.onerror = () => setProblem('The logo could not be read.');
    reader.readAsDataURL(file);
  };
  return (
    <div className="space-y-4" data-docs-vibe="">
      <div className="space-y-2">
        <label htmlFor="docs-vibe-text" className="block text-sm font-bold text-text-primary">Tell the documents how to sound</label>
        <textarea id="docs-vibe-text" data-docs-vibe-text="" rows={4} maxLength={1000} value={options.vibe || ''} onChange={(e) => set({ vibe: e.target.value })}
          placeholder="For example: board-level tone, lead with value, keep each page to one idea." className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary" />
        <p className="text-xs text-text-secondary">Optional. Your words guide the wording of the documents. Click an example to use it.</p>
        <div className="flex flex-wrap gap-2">
          {VIBE_EXAMPLES.map((ex, i) => (
            <button key={i} type="button" data-docs-vibe-example={i} onClick={() => set({ vibe: ex })} className="rounded-full border border-border px-3 py-1 text-start text-xs text-text-secondary hover:bg-bg-subtle">{ex}</button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-bold text-text-primary">Your logo</p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-subtle">
            <Upload size={14} aria-hidden /> {logo ? 'Replace logo' : 'Upload a logo'}
            <input type="file" data-docs-logo-input="" accept={LOGO_TYPES.join(',')} className="sr-only" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {logo && (
            <>
              <img data-docs-logo-preview="" src={logo.dataUrl} alt={`Logo ${logo.name}`} className="max-h-12 max-w-32 rounded border border-border bg-surface p-1" />
              <span className="text-xs text-text-secondary">{logo.name}</span>
              <button type="button" onClick={() => set({ logo: null })} className="rounded-md p-1.5 text-text-secondary hover:bg-bg-subtle" aria-label="Remove logo"><X size={14} aria-hidden /></button>
            </>
          )}
        </div>
        {problem && <p role="alert" data-docs-logo-problem="" className="text-xs text-error-fg">{problem}</p>}
        <p className="text-xs text-text-secondary">PNG, SVG or JPEG, up to 512 KB. It goes on the cover of the PDF, PowerPoint and Word files and on the infographic.</p>
      </div>
    </div>
  );
}

// C24 (REQ-503): the columns by group. A group tick is all / some (mixed) / none; a column tick sits under it.
export function ColumnsPage({ options, set }) {
  const label = Object.fromEntries(EXCEL_COLUMNS.map((c) => [c.id, c.label]));
  const pick = (columns) => set({ columns: orderedColumns(columns) });
  return (
    <div className="space-y-3">
      {EXCEL_GROUPS.map((g) => {
        const n = g.columns.filter((id) => options.columns.includes(id)).length;
        const state = n === 0 ? 'false' : n === g.columns.length ? 'true' : 'mixed';
        const rest = options.columns.filter((id) => !g.columns.includes(id));
        return (
          <div key={g.id} data-doc-group-box={g.id} className="space-y-1.5">
            <button type="button" role="checkbox" aria-checked={state} data-doc-group={g.id} onClick={() => pick(state === 'true' ? rest : [...rest, ...g.columns])} className="flex items-center gap-2 text-start">
              <span className={tick(state !== 'false')} aria-hidden>{state === 'mixed' && <span className="block h-0.5 w-2.5 translate-y-[6px] bg-white mx-auto" />}</span>
              <span className="text-sm font-bold text-text-primary">{g.label}</span>
              <span className="text-xs text-text-secondary">{n} of {g.columns.length}</span>
            </button>
            <div className="grid grid-cols-2 gap-2 ps-6 sm:grid-cols-3">
              {g.columns.map((id) => {
                const on = options.columns.includes(id);
                return (
                  <button key={id} type="button" role="checkbox" aria-checked={on} data-doc-column={id} onClick={() => pick(toggle(options.columns, id))} className={`${card(on)} flex items-center gap-2 py-2`}>
                    <span className={tick(on)} aria-hidden /><span className="text-sm font-semibold text-text-primary">{label[id]}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ReviewPage({ plan, count, options }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-text-secondary">{plan.length} {plan.length === 1 ? 'file' : 'files'} from {count} use {count === 1 ? 'case' : 'cases'}, saved to this run's Assets.</p>
      {options && <p data-doc-review-style="" className="text-xs text-text-secondary">Style: {(DOC_STYLES.find((s) => s.id === options.style) || DOC_STYLES[0]).label}</p>}
      {options?.vibe?.trim() && <p data-doc-review-vibe="" className="text-xs text-text-secondary">Vibe: {options.vibe.trim()}</p>}
      {options?.logo && <p data-doc-review-logo="" className="text-xs text-text-secondary">Logo: {options.logo.name}</p>}
      {options && <p data-doc-review-theme="" className="text-xs text-text-secondary">Theme: {(options.theme || 'light') === 'dark' ? 'Dark' : 'Light'}</p>}
      <ul className="max-h-[42vh] divide-y divide-border overflow-y-auto rounded-xl border border-border">
        {plan.map((f) => (
          <li key={f.name} data-doc-plan-file={f.name} className="flex items-center gap-2 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate font-semibold text-text-primary" title={f.name}>{f.name}</span>
            <span className="shrink-0 text-xs text-text-secondary">{f.language}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
