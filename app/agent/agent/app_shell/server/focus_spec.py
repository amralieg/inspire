"""REQ-539: validate a focus spec (the guided steps the agent writes for one use case) against the schema's x-rules.

validate(spec, columns, actions=None) returns {"ok": bool, "errors": [{"path", "rule", "message"}]}. columns maps a column
name to number, string or date; actions is the set of App action ids a decide choice may name (default: the record actions).
Pure rules, no workspace reads. web/src/focusSpec.js applies the same rules from the same schema file.
"""
import json
import os

_HERE = os.path.dirname(os.path.abspath(__file__))
_SCHEMA = os.path.join(_HERE, "focus_spec.schema.json")
if not os.path.exists(_SCHEMA):
    _SCHEMA = os.path.join(_HERE, "..", "focus_spec.schema.json")
with open(_SCHEMA, encoding="utf-8") as _f:
    RULES = json.load(_f)["x-rules"]

BLOCKS = tuple(RULES["blocks"])
MOTIONS = tuple(RULES["motions"])
COMPARES = tuple(RULES["compares"])
STEP_KINDS = tuple(RULES["step_kinds"])
DEFAULT_ACTIONS = tuple(RULES["default_actions"])
CAPS = RULES["caps"]
BLOCK_ROLES = RULES["block_roles"]
BLOCK_OPTIONAL_ROLES = RULES.get("block_optional_roles", {})


def _words(text) -> int:
    return len(str(text).split())


def validate(spec, columns, actions=None) -> dict:
    errors = []
    allowed = tuple(actions) if actions is not None else DEFAULT_ACTIONS
    cols = columns if isinstance(columns, dict) else {}

    def bad(path, rule, message):
        errors.append({"path": path, "rule": rule, "message": f"{path}: {message} ({rule})"})

    def text(obj, key, path, cap_key=None):
        value = obj.get(key) if isinstance(obj, dict) else None
        if not isinstance(value, str) or not value.strip():
            bad(path, "required", "must be a non-empty string")
            return None
        if cap_key and _words(value) > CAPS[cap_key]:
            bad(path, "words_max", f"must be at most {CAPS[cap_key]} words, has {_words(value)}")
        return value

    def count(items, path, cap):
        if not isinstance(items, list):
            bad(path, "required", "must be a list")
            return False
        if not cap[0] <= len(items) <= cap[1]:
            bad(path, "count", f"must have {cap[0]} to {cap[1]} items, has {len(items)}")
        return True

    if not isinstance(spec, dict):
        bad("$", "required", "the focus spec must be an object")
        return {"ok": False, "errors": errors}
    if spec.get("version") != 1:
        bad("version", "enum", "must be 1")
    text(spec, "technique_kind", "technique_kind")

    tour = spec.get("tour")
    if count(tour, "tour", CAPS["tour_stops"]):
        for i, stop in enumerate(tour):
            if not isinstance(stop, dict):
                bad(f"tour[{i}]", "required", "must be an object")
                continue
            text(stop, "target", f"tour[{i}].target")
            text(stop, "line", f"tour[{i}].line", "tour_line_words")

    queue = spec.get("queue")
    cohort_column = None
    if not isinstance(queue, dict):
        bad("queue", "required", "must be an object")
    else:
        text(queue, "filter", "queue.filter")
        order = queue.get("order")
        if not isinstance(order, dict):
            bad("queue.order", "required", "must be an object")
        else:
            column = text(order, "column", "queue.order.column")
            if column and column not in cols:
                bad("queue.order.column", "unknown_column", f"column {column} is not in the given columns")
            if order.get("direction") not in RULES["directions"]:
                bad("queue.order.direction", "enum", "must be asc or desc")
        cohort_column = queue.get("cohort_column")
        if cohort_column is not None and cohort_column not in cols:
            bad("queue.cohort_column", "unknown_column", f"column {cohort_column} is not in the given columns")
            cohort_column = None
    has_date = any(t == "date" for t in cols.values())

    steps = spec.get("steps")
    if count(steps, "steps", CAPS["steps"]) and steps:
        seen = set()
        for i, step in enumerate(steps):
            p = f"steps[{i}]"
            if not isinstance(step, dict):
                bad(p, "required", "must be an object")
                continue
            sid = text(step, "id", f"{p}.id")
            if sid in seen:
                bad(f"{p}.id", "duplicate_id", f"id {sid} is used twice")
            seen.add(sid)
            text(step, "question", f"{p}.question", "question_words")
            if step.get("kind") not in STEP_KINDS:
                bad(f"{p}.kind", "enum", f"must be one of {', '.join(STEP_KINDS)}")
            text(step, "answer_template", f"{p}.answer_template", "answer_template_words")
            if step.get("motion") not in MOTIONS:
                bad(f"{p}.motion", "unknown_motion", f"motion {step.get('motion')} is not one of the motions")
            if count(step.get("ask"), f"{p}.ask", CAPS["ask"]):
                for j, q in enumerate(step["ask"]):
                    if not isinstance(q, str) or not q.strip():
                        bad(f"{p}.ask[{j}]", "required", "must be a non-empty string")
                    elif _words(q) > CAPS["ask_words"]:
                        bad(f"{p}.ask[{j}]", "words_max", f"must be at most {CAPS['ask_words']} words, has {_words(q)}")
            terms = step.get("terms")
            if count(terms, f"{p}.terms", CAPS["terms"]):
                for j, term in enumerate(terms):
                    tp = f"{p}.terms[{j}]"
                    if isinstance(term, str):
                        if not term.strip():
                            bad(tp, "required", "must not be empty")
                    elif isinstance(term, dict):
                        text(term, "term", f"{tp}.term")
                        text(term, "plain", f"{tp}.plain", "term_plain_words")
                        text(term, "template", f"{tp}.template")
                    else:
                        bad(tp, "required", "must be a term id or an object with term, plain and template")
            visual = step.get("visual")
            if not isinstance(visual, dict):
                bad(f"{p}.visual", "required", "must be an object")
                continue
            block = visual.get("block")
            bind = visual.get("bind") if isinstance(visual.get("bind"), dict) else {}
            if block not in BLOCK_ROLES:
                bad(f"{p}.visual.block", "unknown_block", f"block {block} is not one of the blocks")
            else:
                required = BLOCK_ROLES[block]
                roles = {**BLOCK_OPTIONAL_ROLES.get(block, {}), **required}
                for role in required:
                    if role not in bind:
                        bad(f"{p}.visual.bind.{role}", "missing_role", f"block {block} needs a column for {role}")
                for role, column in bind.items():
                    rp = f"{p}.visual.bind.{role}"
                    if role not in roles:
                        bad(rp, "unknown_role", f"block {block} has no role {role}")
                    elif column not in cols:
                        bad(rp, "unknown_column", f"column {column} is not in the given columns")
                    elif cols[column] != roles[role]:
                        bad(rp, "column_type", f"role {role} needs a {roles[role]} column, {column} is {cols[column]}")
            compare = visual.get("compare")
            if compare is not None:
                cp = f"{p}.visual.compare"
                if compare not in COMPARES:
                    bad(cp, "enum", f"must be one of {', '.join(COMPARES)}")
                elif compare == "cohort" and not cohort_column:
                    bad(cp, "cohort_column_required", "compare cohort needs queue.cohort_column naming a given column")
                elif compare == "history" and not has_date:
                    bad(cp, "date_column_required", "compare history needs a date column in the given columns")
        last = steps[-1]
        if isinstance(last, dict) and last.get("kind") != "decide":
            bad(f"steps[{len(steps) - 1}].kind", "last_step_decide", "the last step must be kind decide")

    decide = spec.get("decide")
    if not isinstance(decide, dict) or not count(decide.get("choices"), "decide.choices", CAPS["choices"]):
        if not isinstance(decide, dict):
            bad("decide", "required", "must be an object")
    else:
        for i, choice in enumerate(decide["choices"]):
            p = f"decide.choices[{i}]"
            if not isinstance(choice, dict):
                bad(p, "required", "must be an object")
                continue
            text(choice, "label", f"{p}.label", "choice_label_words")
            text(choice, "detail", f"{p}.detail", "choice_detail_words")
            if choice.get("action") not in allowed:
                bad(f"{p}.action", "action_not_allowed", f"action {choice.get('action')} is not in the App action set")
    return {"ok": not errors, "errors": errors}
