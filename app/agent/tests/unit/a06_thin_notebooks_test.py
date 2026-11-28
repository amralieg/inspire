"""A06 (REQ-586, REQ-586a): one library plus two thin notebooks replace the single agent notebook.

inspire_discover offers Discover and Match, inspire_generate offers Implement; both load agent/inspire_lib.py, check its sha256
against a pin first, and keep today's widgets and tags exactly. Fail-first acceptance tests T1-T8; the builder never edits them.

Conventions the builder must follow (these tests read them):
- The lib is app/agent/agent/inspire_lib.py. The notebooks are app/agent/agent/inspire_discover.ipynb and inspire_generate.ipynb.
- Each thin notebook binds the pin once, as a plain literal in a code cell: INSPIRE_LIB_SHA256 = "<64 lowercase hex>".
- A notebook finds the lib next to itself without dbutils context calls: through os.getcwd() (on Databricks the notebook's
  folder) or __file__ when it is defined. The tests exec the notebook with both pointing at the notebook's folder, which for
  T7 is a tmp copy holding a tampered lib.
- Loading (exec with __name__ != "__main__") creates the widgets and runs no operation. The operation runs, or is refused,
  only under `if __name__ == "__main__":`, as cells[2] does today. The operation is read from the "15_operation" widget,
  whose dropdown choices are the operations the notebook owns.
- A refused operation raises an exception whose message names the operation.

The frozen fixtures were extracted from the single notebook at 07ef21840 (see _today_widgets and _today_tag_keys):
tests/fixtures/a06_widgets_base.json and tests/fixtures/a06_tag_keys_base.json.
"""
import ast
import builtins
import hashlib
import json
import os
import re
import shutil

import _nbload

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
AGENT_DIR = os.path.join(ROOT, "agent")
LIB = os.path.join(AGENT_DIR, "inspire_lib.py")
DISCOVER_NB = os.path.join(AGENT_DIR, "inspire_discover.ipynb")
GENERATE_NB = os.path.join(AGENT_DIR, "inspire_generate.ipynb")
NOTEBOOKS = {"inspire_discover": DISCOVER_NB, "inspire_generate": GENERATE_NB}
TODAY_NB = os.path.join(AGENT_DIR, "dbx_inspire_ai_agent.ipynb")
FIXTURES = os.path.join(ROOT, "tests", "fixtures")
WIDGETS_FIXTURE = os.path.join(FIXTURES, "a06_widgets_base.json")
TAGS_FIXTURE = os.path.join(FIXTURES, "a06_tag_keys_base.json")

PIN_NAME = "INSPIRE_LIB_SHA256"
OPERATION_WIDGET = "15_operation"
DISCOVER_OPS = {"Discover Use Cases", "Match Use Cases"}
GENERATE_OPS = {"Implement Use Cases"}
OWNED = {"inspire_discover": DISCOVER_OPS, "inspire_generate": GENERATE_OPS}
NOTEBOOK_MAX_B = 200_000
LIB_MAX_B = 6_000_000
TAG_LITERAL = re.compile(r"""["'](dbx_inspire_ai_\w+|inspire_version)["']""")
TAMPER_SENTINEL = "A06_TAMPERED_LIB_RAN"
INTEGRITY_WORDS = ("sha256", "sha-256", "pin", "hash", "checksum", "integrity", "mismatch", "tamper")
VALUE_ENGINE_TODAY = ("inspire_value_estimate", "inspire_value_library", "inspire_value_guards")


class RecordingWidgets:
    """dbutils.widgets that remembers every widget created: name -> {type, default, label, choices}.

    A read answers the preset value, else the created widget's default, else raises as the runtime does for an undefined widget.
    """

    def __init__(self, values=None):
        self.defs = {}
        self.values = dict(values or {})

    def _create(self, kind, name, defaultValue=None, *rest, **kw):
        choices = None
        if kind != "text":
            choices = list(rest[0]) if rest else list(kw.get("choices") or [])
            rest = rest[1:]
        label = rest[0] if rest else kw.get("label")
        self.defs[name] = {"type": kind, "default": defaultValue if defaultValue is not None else kw.get("defaultValue"),
                           "label": label, "choices": choices}

    def text(self, *a, **kw):
        self._create("text", *a, **kw)

    def dropdown(self, *a, **kw):
        self._create("dropdown", *a, **kw)

    def multiselect(self, *a, **kw):
        self._create("multiselect", *a, **kw)

    def combobox(self, *a, **kw):
        self._create("combobox", *a, **kw)

    def remove(self, name):
        self.defs.pop(name, None)

    def removeAll(self):
        self.defs.clear()

    def get(self, name):
        if name in self.values:
            return self.values[name]
        if name in self.defs:
            return self.defs[name]["default"]
        raise Exception(f"InputWidgetNotDefined: No input widget named {name} is defined")

    getArgument = get


class RecordingDbutils:
    def __init__(self, values=None):
        self.widgets = RecordingWidgets(values)

    def __getattr__(self, name):
        raise AssertionError("offline harness: notebook code reached dbutils.%s" % name)


def _code_cells(nb_path):
    with open(nb_path, encoding="utf-8") as fh:
        nb = json.load(fh)
    out = []
    for cell in nb.get("cells", []):
        if cell.get("cell_type") == "code":
            src = cell.get("source", [])
            out.append(_nbload.strip_magic_lines("".join(src) if isinstance(src, list) else str(src)))
    return out


def _exec_notebook(nb_path, name="inspire_offline", values=None):
    """Exec every code cell of a notebook offline, from its own folder; returns (namespace, widgets)."""
    _nbload.install_stubs()
    os.environ.setdefault("INSPIRE_REPO_ASSETS", ROOT)
    dbutils = RecordingDbutils(values)
    ns = {"__name__": name, "__file__": nb_path, "spark": _nbload.NullSpark(), "dbutils": dbutils}
    cwd = os.getcwd()
    os.chdir(os.path.dirname(nb_path))
    try:
        for src in _code_cells(nb_path):
            exec(compile(src, nb_path, "exec"), ns)
    finally:
        os.chdir(cwd)
    return ns, dbutils.widgets


_LOADED = {}


def _sha(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def _require_files():
    missing = [p for p in (LIB, DISCOVER_NB, GENERATE_NB) if not os.path.isfile(p)]
    assert not missing, "missing: " + ", ".join(os.path.relpath(p, ROOT) for p in missing)


def _loaded(key):
    """The (namespace, widgets) of one thin notebook loaded from the repo, once per revision of it and the lib."""
    _require_files()
    path = NOTEBOOKS[key]
    cache_key = (path, _sha(path), _sha(LIB))
    if cache_key not in _LOADED:
        _LOADED[cache_key] = _exec_notebook(path)
    return _LOADED[cache_key]


def _widget_rows(widgets):
    return {name: {"type": d["type"], "default": d["default"], "label": d["label"]} for name, d in widgets.defs.items()}


def _top_level_names(src):
    return {n.name for n in ast.parse(src).body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))}


def _all_defined_names(src):
    return {n.name for n in ast.walk(ast.parse(src)) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))}


def _pins(nb_path):
    pins = []
    for src in _code_cells(nb_path):
        for node in ast.walk(ast.parse(src)):
            if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == PIN_NAME for t in node.targets):
                pins.append(node.value.value if isinstance(node.value, ast.Constant) else ast.unparse(node.value))
    return pins


def _tag_literals(text):
    return set(TAG_LITERAL.findall(text))


# Fixture extraction from today's single notebook. Not called by the tests (the old notebook may become a shim); it is how the
# frozen fixtures were produced at 07ef21840 and can re-check them while that notebook still exists.
def _today_widgets():
    _ns, widgets = _exec_notebook(TODAY_NB)
    return [dict(name=name, **row) for name, row in _widget_rows(widgets).items()]


def _today_tag_keys():
    ns, _widgets = _exec_notebook(TODAY_NB)
    text = "\n".join(_code_cells(TODAY_NB))
    return {"tag_priority": list(ns["JobLauncher"].TAG_PRIORITY), "version_tag_keys": sorted(ns["INSPIRE_VERSION_TAGS"]),
            "literal_keys": sorted(_tag_literals(text))}


def test_t1_lib_exists_and_each_thin_notebook_pins_its_sha256():
    _require_files()
    lib_sha = _sha(LIB)
    for key, path in NOTEBOOKS.items():
        pins = _pins(path)
        assert len(pins) == 1, f"{key} must bind {PIN_NAME} exactly once, found {pins}"
        assert re.fullmatch(r"[0-9a-f]{64}", str(pins[0])), f"{key} pin is not a 64-hex literal: {pins[0]!r}"
        assert pins[0] == lib_sha, f"{key} pins {pins[0]}, inspire_lib.py is {lib_sha}"


def test_t2_thin_notebooks_under_200kb_and_lib_under_6mb():
    _require_files()
    for key, path in NOTEBOOKS.items():
        assert os.path.getsize(path) < NOTEBOOK_MAX_B, f"{key} is {os.path.getsize(path)} B"
    assert os.path.getsize(LIB) < LIB_MAX_B, f"inspire_lib.py is {os.path.getsize(LIB)} B"


def test_t3_each_notebook_offers_exactly_its_own_operations():
    for key, expected in OWNED.items():
        _ns, widgets = _loaded(key)
        op = widgets.defs.get(OPERATION_WIDGET)
        assert op is not None, f"{key} creates no {OPERATION_WIDGET} widget"
        assert op["type"] == "dropdown", f"{key} {OPERATION_WIDGET} is a {op['type']}"
        assert set(op["choices"]) == expected and len(op["choices"]) == len(expected), f"{key} offers {op['choices']}"
        assert op["default"] in expected, f"{key} defaults to {op['default']!r}"


def test_t4_the_two_notebooks_together_keep_todays_widgets():
    with open(WIDGETS_FIXTURE, encoding="utf-8") as fh:
        today = {w["name"]: {k: w[k] for k in ("type", "default", "label")} for w in json.load(fh)}
    rows = {key: _widget_rows(_loaded(key)[1]) for key in NOTEBOOKS}
    union = set().union(*rows.values())
    assert union == set(today), f"added {sorted(union - set(today))}, lost {sorted(set(today) - union)}"
    for key, mine in rows.items():
        for name, row in mine.items():
            want = dict(today[name])
            if name == OPERATION_WIDGET and key == "inspire_generate":
                want["default"] = "Implement Use Cases"  # the only operation it owns; label and type stay
            assert row == want, f"{key} widget {name}: {row} != today's {want}"


def test_t5_translation_and_value_engine_live_in_the_lib_only():
    _require_files()
    with open(LIB, encoding="utf-8") as fh:
        lib_top = _top_level_names(fh.read())
    assert "TranslationService" in lib_top, "inspire_lib.py defines no top-level TranslationService"
    missing = [n for n in VALUE_ENGINE_TODAY if n not in lib_top]
    assert not missing, f"inspire_lib.py lacks the value engine: {missing}"
    for key, path in NOTEBOOKS.items():
        defined = set().union(*(_all_defined_names(src) for src in _code_cells(path)))
        owned_by_lib = {n for n in defined if n == "TranslationService" or n.startswith("inspire_value_")}
        assert not owned_by_lib, f"{key} defines {sorted(owned_by_lib)}; they belong to inspire_lib.py only"
    ns, _widgets = _loaded("inspire_discover")
    assert isinstance(ns.get("TranslationService"), type), "inspire_discover does not reach TranslationService"


def test_t6_tag_keys_are_todays_and_none_added():
    _require_files()
    with open(TAGS_FIXTURE, encoding="utf-8") as fh:
        today = json.load(fh)
    texts = [open(LIB, encoding="utf-8").read()] + ["\n".join(_code_cells(p)) for p in NOTEBOOKS.values()]
    after = set().union(*(_tag_literals(t) for t in texts))
    assert after == set(today["literal_keys"]), \
        f"tag keys added {sorted(after - set(today['literal_keys']))}, lost {sorted(set(today['literal_keys']) - after)}"
    for key in NOTEBOOKS:
        ns, _widgets = _loaded(key)
        assert list(ns["JobLauncher"].TAG_PRIORITY) == today["tag_priority"], f"{key} JobLauncher.TAG_PRIORITY changed"
        assert sorted(ns["INSPIRE_VERSION_TAGS"]) == today["version_tag_keys"], f"{key} INSPIRE_VERSION_TAGS keys changed"


def test_t7_a_lib_that_does_not_match_the_pin_raises_before_any_work(tmp_path):
    _require_files()
    with open(LIB, "rb") as fh:
        good = fh.read()
    tampered = good + b"\nimport builtins as _a06_builtins\n_a06_builtins." + TAMPER_SENTINEL.encode() + b" = True\n"
    for key, path in NOTEBOOKS.items():
        control = tmp_path / key / "control"
        bad = tmp_path / key / "tampered"
        for folder, body in ((control, good), (bad, tampered)):
            folder.mkdir(parents=True)
            shutil.copy(path, folder / os.path.basename(path))
            (folder / "inspire_lib.py").write_bytes(body)
        _exec_notebook(str(control / os.path.basename(path)))  # the untouched lib copied next to the notebook loads
        assert not hasattr(builtins, TAMPER_SENTINEL)
        try:
            _exec_notebook(str(bad / os.path.basename(path)), name="__main__", values={OPERATION_WIDGET: sorted(OWNED[key])[0]})
        except Exception as e:  # noqa: BLE001 - any loud failure, checked below
            raised = e
        else:
            raised = None
        ran = getattr(builtins, TAMPER_SENTINEL, False)
        if hasattr(builtins, TAMPER_SENTINEL):
            delattr(builtins, TAMPER_SENTINEL)
        assert raised is not None, f"{key} loaded a lib whose sha256 does not match its pin"
        assert not ran, f"{key} executed the tampered lib before checking its sha256"
        assert not isinstance(raised, SyntaxError) and "offline harness" not in str(raised), f"{key} raised {raised!r}"
        assert any(w in str(raised).lower() for w in INTEGRITY_WORDS), f"{key} raised without naming the pin: {raised!r}"


def test_t8_each_notebook_refuses_an_operation_it_does_not_own():
    _require_files()
    every = DISCOVER_OPS | GENERATE_OPS
    for key, path in NOTEBOOKS.items():
        for op in sorted(every - OWNED[key]):
            try:
                _exec_notebook(path, name="__main__", values={OPERATION_WIDGET: op})
            except Exception as e:  # noqa: BLE001 - any loud failure, checked below
                raised = e
            else:
                raised = None
            assert raised is not None, f"{key} accepted {op!r}"
            assert "offline harness" not in str(raised), f"{key} started work for {op!r} before refusing it: {raised!r}"
            assert op in str(raised), f"{key} refused {op!r} without naming it: {raised!r}"
