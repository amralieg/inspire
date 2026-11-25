// REQ-539: validate a focus spec (the guided steps the agent writes for one use case). Same rules as server/focus_spec.py,
// both read ../../focus_spec.schema.json (x-rules). validateFocusSpec(spec, columns, actions) -> { ok, errors: [{ path, rule, message }] }.
// columns maps a column name to 'number', 'string' or 'date'; actions defaults to the App's record actions.
import SCHEMA from '../../focus_spec.schema.json' with { type: 'json' };

const RULES = SCHEMA['x-rules'];
export const BLOCKS = RULES.blocks;
export const MOTIONS = RULES.motions;
export const COMPARES = RULES.compares;
export const STEP_KINDS = RULES.step_kinds;
export const DEFAULT_ACTIONS = RULES.default_actions;
const CAPS = RULES.caps;
const ROLES = RULES.block_roles;

const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

export function validateFocusSpec(spec, columns, actions) {
  const errors = [];
  const allowed = actions == null ? DEFAULT_ACTIONS : [...actions];
  const cols = isObj(columns) ? columns : {};
  const bad = (path, rule, message) => errors.push({ path, rule, message: `${path}: ${message} (${rule})` });
  const text = (obj, key, path, capKey) => {
    const v = isObj(obj) ? obj[key] : undefined;
    if (typeof v !== 'string' || !v.trim()) { bad(path, 'required', 'must be a non-empty string'); return null; }
    if (capKey && words(v) > CAPS[capKey]) bad(path, 'words_max', `must be at most ${CAPS[capKey]} words, has ${words(v)}`);
    return v;
  };
  const count = (items, path, cap) => {
    if (!Array.isArray(items)) { bad(path, 'required', 'must be a list'); return false; }
    if (items.length < cap[0] || items.length > cap[1]) bad(path, 'count', `must have ${cap[0]} to ${cap[1]} items, has ${items.length}`);
    return true;
  };

  if (!isObj(spec)) { bad('$', 'required', 'the focus spec must be an object'); return { ok: false, errors }; }
  if (spec.version !== 1) bad('version', 'enum', 'must be 1');
  text(spec, 'technique_kind', 'technique_kind');

  if (count(spec.tour, 'tour', CAPS.tour_stops)) {
    spec.tour.forEach((stop, i) => {
      if (!isObj(stop)) { bad(`tour[${i}]`, 'required', 'must be an object'); return; }
      text(stop, 'target', `tour[${i}].target`);
      text(stop, 'line', `tour[${i}].line`, 'tour_line_words');
    });
  }

  let cohortColumn = null;
  if (!isObj(spec.queue)) bad('queue', 'required', 'must be an object');
  else {
    const q = spec.queue;
    text(q, 'filter', 'queue.filter');
    if (!isObj(q.order)) bad('queue.order', 'required', 'must be an object');
    else {
      const column = text(q.order, 'column', 'queue.order.column');
      if (column && !has(cols, column)) bad('queue.order.column', 'unknown_column', `column ${column} is not in the given columns`);
      if (!RULES.directions.includes(q.order.direction)) bad('queue.order.direction', 'enum', 'must be asc or desc');
    }
    cohortColumn = q.cohort_column ?? null;
    if (cohortColumn !== null && !has(cols, cohortColumn)) {
      bad('queue.cohort_column', 'unknown_column', `column ${cohortColumn} is not in the given columns`);
      cohortColumn = null;
    }
  }
  const hasDate = Object.values(cols).includes('date');

  if (count(spec.steps, 'steps', CAPS.steps) && spec.steps.length) {
    const seen = new Set();
    spec.steps.forEach((step, i) => {
      const p = `steps[${i}]`;
      if (!isObj(step)) { bad(p, 'required', 'must be an object'); return; }
      const sid = text(step, 'id', `${p}.id`);
      if (seen.has(sid)) bad(`${p}.id`, 'duplicate_id', `id ${sid} is used twice`);
      seen.add(sid);
      text(step, 'question', `${p}.question`, 'question_words');
      if (!STEP_KINDS.includes(step.kind)) bad(`${p}.kind`, 'enum', `must be one of ${STEP_KINDS.join(', ')}`);
      text(step, 'answer_template', `${p}.answer_template`, 'answer_template_words');
      if (!MOTIONS.includes(step.motion)) bad(`${p}.motion`, 'unknown_motion', `motion ${step.motion} is not one of the motions`);
      if (count(step.ask, `${p}.ask`, CAPS.ask)) {
        step.ask.forEach((q, j) => {
          if (typeof q !== 'string' || !q.trim()) bad(`${p}.ask[${j}]`, 'required', 'must be a non-empty string');
          else if (words(q) > CAPS.ask_words) bad(`${p}.ask[${j}]`, 'words_max', `must be at most ${CAPS.ask_words} words, has ${words(q)}`);
        });
      }
      if (count(step.terms, `${p}.terms`, CAPS.terms)) {
        step.terms.forEach((term, j) => {
          const tp = `${p}.terms[${j}]`;
          if (typeof term === 'string') { if (!term.trim()) bad(tp, 'required', 'must not be empty'); }
          else if (isObj(term)) {
            text(term, 'term', `${tp}.term`);
            text(term, 'plain', `${tp}.plain`, 'term_plain_words');
            text(term, 'template', `${tp}.template`);
          } else bad(tp, 'required', 'must be a term id or an object with term, plain and template');
        });
      }
      const visual = step.visual;
      if (!isObj(visual)) { bad(`${p}.visual`, 'required', 'must be an object'); return; }
      const bind = isObj(visual.bind) ? visual.bind : {};
      if (!has(ROLES, visual.block)) bad(`${p}.visual.block`, 'unknown_block', `block ${visual.block} is not one of the blocks`);
      else {
        const roles = ROLES[visual.block];
        for (const role of Object.keys(roles)) {
          if (!has(bind, role)) bad(`${p}.visual.bind.${role}`, 'missing_role', `block ${visual.block} needs a column for ${role}`);
        }
        for (const [role, column] of Object.entries(bind)) {
          const rp = `${p}.visual.bind.${role}`;
          if (!has(roles, role)) bad(rp, 'unknown_role', `block ${visual.block} has no role ${role}`);
          else if (!has(cols, column)) bad(rp, 'unknown_column', `column ${column} is not in the given columns`);
          else if (cols[column] !== roles[role]) bad(rp, 'column_type', `role ${role} needs a ${roles[role]} column, ${column} is ${cols[column]}`);
        }
      }
      if (visual.compare !== undefined && visual.compare !== null) {
        const cp = `${p}.visual.compare`;
        if (!COMPARES.includes(visual.compare)) bad(cp, 'enum', `must be one of ${COMPARES.join(', ')}`);
        else if (visual.compare === 'cohort' && !cohortColumn) bad(cp, 'cohort_column_required', 'compare cohort needs queue.cohort_column naming a given column');
        else if (visual.compare === 'history' && !hasDate) bad(cp, 'date_column_required', 'compare history needs a date column in the given columns');
      }
    });
    const last = spec.steps[spec.steps.length - 1];
    if (isObj(last) && last.kind !== 'decide') bad(`steps[${spec.steps.length - 1}].kind`, 'last_step_decide', 'the last step must be kind decide');
  }

  if (!isObj(spec.decide)) bad('decide', 'required', 'must be an object');
  else if (count(spec.decide.choices, 'decide.choices', CAPS.choices)) {
    spec.decide.choices.forEach((c, i) => {
      const p = `decide.choices[${i}]`;
      if (!isObj(c)) { bad(p, 'required', 'must be an object'); return; }
      text(c, 'label', `${p}.label`, 'choice_label_words');
      text(c, 'detail', `${p}.detail`, 'choice_detail_words');
      if (!allowed.includes(c.action)) bad(`${p}.action`, 'action_not_allowed', `action ${c.action} is not in the App action set`);
    });
  }
  return { ok: errors.length === 0, errors };
}
