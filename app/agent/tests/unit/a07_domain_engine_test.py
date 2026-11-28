"""A07 G1 (REQ-587, T-587-A-01): one shared domain-name engine for the agent and the App.

Rule (Amr): a domain is 1 word and singular, a subdomain is exactly 2 words. A user-named domain or subdomain is kept verbatim
(user input wins); it is valid and carries the codes it breaks plus "user_kept" as warnings.

Fail-first acceptance tests; the builder never edits them.

Assets (app/shared, read by both runners):
- domain_rules.json: the limits. The lib exposes them as INSPIRE_DOMAIN_RULES, loaded at runtime through the pinned
  notebook-asset mechanism used for value_library: INSPIRE_NOTEBOOK_ASSETS["domain_rules"] = {"file":
  "notebook/domain_rules.json", "repo": "../shared/domain_rules.json", "sha256", "size"} and
  INSPIRE_DOMAIN_RULES = json.loads(inspire_notebook_asset("domain_rules")).
- domain_rules_fixtures.json: the cases both runners must pass. Format, for the App (JS) runner:
    {"problem_codes": [closed, ordered list of codes],
     "cases": [{"name": str, "kind": "domain" | "subdomain", "user_named": bool,
                "valid": bool, "repaired": str | null, "problems": [codes]}]}
  A runner calls check(name, kind, user_named) and compares the result {"valid", "repaired", "problems"} for equality.
  "problems" is ordered as in problem_codes. "repaired" is null when the name needs no change, when it cannot be repaired
  deterministically (wrong word count, empty), and always for a user-named name (kept verbatim).

Check semantics (agent: inspire_domain_name_check(name, kind, user_named=False) -> dict; unknown kind raises ValueError):
  empty       the name is empty or whitespace only (never kept, even when user-named).
  spacing     leading/trailing whitespace, a run of 2+ whitespace, or a non-space whitespace; repair strips and collapses.
  characters  a character that is not a letter or digit (str.isalnum) or a space; repair turns it into a space, collapses.
  case        a word that is neither w == w.capitalize() nor w.isupper(); repair is w.capitalize().
  word_count  after repair, word count != rules[kind]["words"]; not repairable (repaired is null).
  plural      domain only, 1 word, _singular_token(word) != word.lower(); repair is the singular, capitalized
              (upper-case kept). _singular_token (inspire_lib.py) is the only singulariser.
  user_kept   added last when user_named and any other code applies; the name stays verbatim and valid.
"""
import ast
import functools
import hashlib
import json
import os
import re
import types

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LIB = os.path.join(ROOT, "agent", "inspire_lib.py")
SHARED = os.path.join(os.path.dirname(ROOT), "shared")
RULES = os.path.join(SHARED, "domain_rules.json")
FIXTURES = os.path.join(SHARED, "domain_rules_fixtures.json")
CHECK = "inspire_domain_name_check"
WIRED_METHODS = ("_classify_domain_structure", "_detect_subdomains_for_domain", "_merge_duplicate_subdomains")


def _fixture_doc():
    with open(FIXTURES, encoding="utf-8") as handle:
        return json.load(handle)


def _cases():
    try:
        return _fixture_doc()["cases"]
    except OSError:
        return [{"name": "<missing app/shared/domain_rules_fixtures.json>", "kind": "domain"}]


@functools.lru_cache(maxsize=1)
def _lib_tree():
    with open(LIB, encoding="utf-8") as handle:
        return ast.parse(handle.read())


def _top_function(name):
    return next((n for n in _lib_tree().body if isinstance(n, ast.FunctionDef) and n.name == name), None)


def _method(name):
    cls = next(n for n in _lib_tree().body if isinstance(n, ast.ClassDef) and n.name == "DatabricksInspire")
    return next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == name)


def _calls(node, func_name):
    return [c for c in ast.walk(node) if isinstance(c, ast.Call)
            and isinstance(c.func, ast.Name) and c.func.id == func_name]


def _bare(agent_ns, protected=()):
    inst = object.__new__(agent_ns["DatabricksInspire"])
    inst._protected_domains = lambda: {p.lower() for p in protected}
    inst.logger = types.SimpleNamespace(info=lambda *a, **k: None, warning=lambda *a, **k: None,
                                        debug=lambda *a, **k: None, error=lambda *a, **k: None)
    return inst


def test_fixture_corpus_shape_and_check(agent_ns):
    check = agent_ns[CHECK]
    doc = _fixture_doc()
    codes = doc["problem_codes"]
    assert {"empty", "word_count", "plural", "characters", "user_kept"} <= set(codes)
    cases = doc["cases"]
    assert len(cases) >= 20
    for case in cases:
        assert set(case) == {"name", "kind", "user_named", "valid", "repaired", "problems"}, case
        assert case["kind"] in ("domain", "subdomain"), case
        assert case["problems"] == sorted(case["problems"], key=codes.index), case
    assert any(c["user_named"] and c["valid"] and c["problems"] for c in cases), "a user-named rule-breaker stays valid"
    for case in cases:
        assert set(check(case["name"], case["kind"], user_named=case["user_named"])["problems"]) <= set(codes), case


@pytest.mark.parametrize("case", _cases(), ids=lambda c: f"{c['kind']}:{c['name']!r}:{c.get('user_named')}")
def test_check_matches_fixture(agent_ns, case):
    check = agent_ns[CHECK]
    got = check(case["name"], case["kind"], user_named=case["user_named"])
    assert got == {"valid": case["valid"], "repaired": case["repaired"], "problems": case["problems"]}


def test_check_rejects_unknown_kind(agent_ns):
    with pytest.raises(ValueError):
        agent_ns[CHECK]("Finance", "division")


def test_rules_loaded_at_runtime_from_shared_asset(agent_ns):
    with open(RULES, "rb") as handle:
        raw = handle.read()
    pin = agent_ns["INSPIRE_NOTEBOOK_ASSETS"]["domain_rules"]
    assert pin["repo"] == "../shared/domain_rules.json"
    assert pin["file"] == "notebook/domain_rules.json"
    assert (pin["sha256"], pin["size"]) == (hashlib.sha256(raw).hexdigest(), len(raw))
    assert agent_ns["INSPIRE_DOMAIN_RULES"] == json.loads(raw)
    src = ast.unparse(next(n for n in _lib_tree().body if isinstance(n, ast.Assign)
                           and any(getattr(t, "id", "") == "INSPIRE_DOMAIN_RULES" for t in n.targets)))
    assert 'inspire_notebook_asset("domain_rules")' in src.replace("'", '"'), "INSPIRE_DOMAIN_RULES is loaded, not inlined"


def test_check_reuses_the_one_singulariser():
    fn = _top_function(CHECK)
    assert fn is not None, f"{CHECK} is a top-level function in inspire_lib.py"
    assert _calls(fn, "_singular_token"), f"{CHECK} singularises through _singular_token"
    assert "INSPIRE_DOMAIN_RULES" in ast.unparse(fn), f"{CHECK} reads its limits from INSPIRE_DOMAIN_RULES"


def test_classify_flags_plural_domain_through_the_check(agent_ns):
    inst = _bare(agent_ns)
    ucs = [{"No": i} for i in range(5)]
    hard, _, _ = inst._classify_domain_structure({"Customers": ucs, "Finance": ucs, "Operation": ucs}, 15)
    assert any("Customers" in v and "plural" in v for v in hard), hard


def test_classify_keeps_user_named_domain(agent_ns):
    inst = _bare(agent_ns, protected=("Supply Chain",))
    ucs = [{"No": i} for i in range(5)]
    hard, _, _ = inst._classify_domain_structure({"Supply Chain": ucs, "Finance": ucs, "Operation": ucs}, 15)
    assert not any("Supply Chain" in v for v in hard), hard


@pytest.mark.parametrize("method", WIRED_METHODS)
def test_method_calls_the_check(method):
    node = _method(method)
    calls = _calls(node, CHECK)
    assert calls, f"{method} validates names through {CHECK}"
    kind = "domain" if method == "_classify_domain_structure" else "subdomain"
    assert any(kind in ast.unparse(c) for c in calls), f"{method} checks kind {kind!r}"


def test_check_decides_the_three_word_and_two_word_subdomain(agent_ns):
    check = agent_ns[CHECK]
    assert check("Demand Forecast Planning", "subdomain")["valid"] is False
    assert "word_count" in check("Demand Forecast Planning", "subdomain")["problems"]
    assert check("Order Returns", "subdomain") == {"valid": True, "repaired": None, "problems": []}


_WORD_LITERAL = re.compile(r"(split\(|word)")


@pytest.mark.parametrize("method", WIRED_METHODS)
def test_no_inline_word_count_literals(method):
    hits = []
    for cmp in (n for n in ast.walk(_method(method)) if isinstance(n, ast.Compare)):
        consts = [c.value for c in cmp.comparators + [cmp.left] if isinstance(c, ast.Constant)]
        if any(isinstance(op, (ast.Eq, ast.NotEq)) for op in cmp.ops) and {1, 2} & set(consts) \
                and _WORD_LITERAL.search(ast.unparse(cmp)):
            hits.append(ast.unparse(cmp))
    assert not hits, f"{method} still tests word counts inline: {hits}"
