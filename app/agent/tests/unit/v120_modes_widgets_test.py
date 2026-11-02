"""v1.2.0 MODES lane: the 06. Use Cases Quality widget and its stale-widget migration (H-19).

The fake below models the three Databricks widget behaviours the migration depends on: creating a
widget that already exists keeps the existing widget and value, reading a missing widget raises,
and (per the Databricks widgets documentation: "If you remove a widget, you cannot create one in
the same cell") a widget removed in a cell cannot be created again in that cell. create_widgets()
runs in cells[1] and main() runs in cells[2], so a migrated widget is removed in cells[1] and
recreated by main() before any widget is read.
"""
import ast
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import agent_notebook_path, agent_source, top_level_defs  # noqa: E402

QUALITY = "05_use_cases_quality"
OPTIONS = "09_generation_options"
NEW_CHOICES = ["Good", "High", "Ultra High"]
LEGACY = {
    "Coverage Mode (All)": "Good",
    "Balanced": "Good",
    "Good Quality": "Good",
    "High Quality": "Good",
    "Strict Quality": "High",
    "Very High Quality": "High",
}
LEGACY_CHOICES = {
    "Coverage Mode (All)": ["Coverage Mode (All)", "Balanced", "Strict Quality"],
    "Balanced": ["Coverage Mode (All)", "Balanced", "Strict Quality"],
    "Strict Quality": ["Coverage Mode (All)", "Balanced", "Strict Quality"],
    "Good Quality": ["Good Quality", "High Quality", "Very High Quality"],
    "High Quality": ["Good Quality", "High Quality", "Very High Quality"],
    "Very High Quality": ["Good Quality", "High Quality", "Very High Quality"],
}


class FakeWidgets:
    def __init__(self, existing=None, fail_create=()):
        self.state = {}
        self.removed_this_cell = set()
        self.calls = []
        self.fail_create = set(fail_create)
        for name, (kind, value, choices) in (existing or {}).items():
            self.state[name] = {"kind": kind, "value": value, "choices": list(choices or []), "label": name}

    def new_cell(self):
        self.removed_this_cell.clear()

    def _create(self, kind, name, default, choices, label):
        self.calls.append(("create", kind, name, default, tuple(choices or ()), label))
        if name in self.fail_create:
            raise RuntimeError(f"widget service unavailable for {name}")
        if name in self.removed_this_cell or name in self.state:
            return None
        self.state[name] = {"kind": kind, "value": default, "choices": list(choices or []), "label": label}
        return None

    def text(self, name, default, label=None):
        return self._create("text", name, default, None, label)

    def dropdown(self, name, default, choices, label=None):
        return self._create("dropdown", name, default, choices, label)

    def multiselect(self, name, default, choices, label=None):
        return self._create("multiselect", name, default, choices, label)

    def combobox(self, name, default, choices, label=None):
        return self._create("combobox", name, default, choices, label)

    def get(self, name):
        if name not in self.state:
            raise ValueError(f"InputWidgetNotDefined: {name}")
        return self.state[name]["value"]

    def remove(self, name):
        self.calls.append(("remove", name))
        if name not in self.state:
            raise ValueError(f"InputWidgetNotDefined: {name}")
        del self.state[name]
        self.removed_this_cell.add(name)

    def removeAll(self):
        for name in list(self.state):
            self.remove(name)


class FakeDbutils:
    def __init__(self, widgets):
        self.widgets = widgets


def run_cells(agent_ns, monkeypatch, widgets):
    monkeypatch.setitem(agent_ns, "dbutils", FakeDbutils(widgets))
    deferred = agent_ns["create_widgets"]()
    after_cell_1 = {name: dict(w) for name, w in widgets.state.items()}
    widgets.new_cell()
    agent_ns["recreate_deferred_widgets"](deferred)
    return deferred, after_cell_1


def quality_widget(value):
    return {QUALITY: ("dropdown", value, LEGACY_CHOICES.get(value, NEW_CHOICES))}


def test_fake_honours_the_documented_same_cell_rule():
    widgets = FakeWidgets(quality_widget("Balanced"))
    widgets.remove(QUALITY)
    widgets.dropdown(QUALITY, "Good", NEW_CHOICES, "06. Use Cases Quality")
    assert QUALITY not in widgets.state
    widgets.new_cell()
    widgets.dropdown(QUALITY, "Good", NEW_CHOICES, "06. Use Cases Quality")
    assert widgets.get(QUALITY) == "Good"


def test_new_notebook_gets_good_high_ultra_high_with_good_default(agent_ns, monkeypatch):
    widgets = FakeWidgets()
    deferred, _ = run_cells(agent_ns, monkeypatch, widgets)
    assert widgets.state[QUALITY]["choices"] == NEW_CHOICES
    assert widgets.get(QUALITY) == "Good"
    assert widgets.state[QUALITY]["label"] == "06. Use Cases Quality"
    assert not [c for c in widgets.calls if c[0] == "remove"]
    assert deferred == []


def test_new_notebook_writes_no_genie_instruction_by_default(agent_ns, monkeypatch):
    widgets = FakeWidgets()
    run_cells(agent_ns, monkeypatch, widgets)
    assert widgets.get("13_generate_genie_code_for") == "0"
    assert widgets.state["13_generate_genie_code_for"]["label"] == "15. Generate Genie Code Instruction For"


@pytest.mark.parametrize("legacy,mapped", sorted(LEGACY.items()))
def test_legacy_widget_is_removed_then_recreated_with_mapped_value(agent_ns, monkeypatch, legacy, mapped):
    widgets = FakeWidgets(quality_widget(legacy))
    _, after_cell_1 = run_cells(agent_ns, monkeypatch, widgets)
    assert QUALITY not in after_cell_1, "the stale widget is removed in cells[1]"
    assert widgets.get(QUALITY) == mapped
    assert widgets.state[QUALITY]["choices"] == NEW_CHOICES
    assert widgets.state[QUALITY]["kind"] == "dropdown"


@pytest.mark.parametrize("raw,mapped", [(" strict quality ", "High"), ("BALANCED", "Good"), ("very high quality", "High")])
def test_legacy_value_in_any_case_or_spacing_migrates(agent_ns, monkeypatch, raw, mapped):
    widgets = FakeWidgets({QUALITY: ("dropdown", raw, ["x"])})
    run_cells(agent_ns, monkeypatch, widgets)
    assert widgets.get(QUALITY) == mapped and widgets.state[QUALITY]["choices"] == NEW_CHOICES


@pytest.mark.parametrize("value", ["High", "Ultra High", "Good"])
def test_current_value_is_never_touched(agent_ns, monkeypatch, value):
    widgets = FakeWidgets({QUALITY: ("dropdown", value, NEW_CHOICES)})
    deferred, _ = run_cells(agent_ns, monkeypatch, widgets)
    assert widgets.get(QUALITY) == value
    assert ("remove", QUALITY) not in widgets.calls and deferred == []


def test_unknown_value_is_left_for_main_to_reject(agent_ns, monkeypatch):
    widgets = FakeWidgets({QUALITY: ("dropdown", "Premium", ["Premium"])})
    deferred, _ = run_cells(agent_ns, monkeypatch, widgets)
    assert widgets.get(QUALITY) == "Premium", "an unknown value must never be silently replaced by a default"
    assert ("remove", QUALITY) not in widgets.calls and deferred == []
    with pytest.raises(ValueError):
        agent_ns["canonical_use_cases_quality"](widgets.get(QUALITY))


def test_stale_generation_options_widget_also_survives_the_cell_boundary(agent_ns, monkeypatch):
    widgets = FakeWidgets({OPTIONS: ("multiselect", "PDF Catalog,Genie Code Instructions",
                                     ["PDF Catalog", "Presentation", "Genie Code Instructions"])})
    _, after_cell_1 = run_cells(agent_ns, monkeypatch, widgets)
    assert OPTIONS not in after_cell_1
    assert widgets.get(OPTIONS) == "PDF Catalog"
    assert widgets.state[OPTIONS]["choices"] == ["PDF Catalog", "Presentation"]
    assert widgets.state[OPTIONS]["kind"] == "multiselect"


def test_create_widgets_never_recreates_a_widget_it_removed(agent_ns, monkeypatch):
    widgets = FakeWidgets({**quality_widget("Strict Quality"),
                           OPTIONS: ("multiselect", "Genie Code Instructions", ["Genie Code Instructions"])})
    monkeypatch.setitem(agent_ns, "dbutils", FakeDbutils(widgets))
    agent_ns["create_widgets"]()
    removed = {c[1] for c in widgets.calls if c[0] == "remove"}
    assert removed == {QUALITY, OPTIONS}
    for call in widgets.calls:
        if call[0] == "create":
            assert call[2] not in removed, call


def test_recreation_failure_is_reported_and_the_queue_is_consumed(agent_ns, monkeypatch, capsys):
    widgets = FakeWidgets(quality_widget("Balanced"))
    monkeypatch.setitem(agent_ns, "dbutils", FakeDbutils(widgets))
    deferred = agent_ns["create_widgets"]()
    widgets.new_cell()
    widgets.fail_create.add(QUALITY)
    agent_ns["recreate_deferred_widgets"](deferred)
    assert deferred == []
    assert "could not be recreated" in capsys.readouterr().out
    agent_ns["recreate_deferred_widgets"](deferred)


def test_every_created_widget_is_forwarded_by_the_job_launcher(agent_ns, monkeypatch):
    widgets = FakeWidgets()
    run_cells(agent_ns, monkeypatch, widgets)
    assert set(widgets.state) == set(agent_ns["_NOTEBOOK_WIDGET_NAMES"])


def test_main_recreates_deferred_widgets_before_reading_any_widget():
    main = top_level_defs()["main"]
    order = []
    for node in ast.walk(main):
        if isinstance(node, ast.Call):
            text = ast.unparse(node.func)
            if text in ("recreate_deferred_widgets", "dbutils.widgets.get"):
                order.append((node.lineno, node.col_offset, text))
    order.sort()
    assert order and order[0][2] == "recreate_deferred_widgets", order[:3]
    assert ast.unparse(next(n for n in ast.walk(main) if isinstance(n, ast.Call)
                            and ast.unparse(n.func) == "recreate_deferred_widgets").args[0]) == "_DEFERRED_WIDGETS"


def test_module_keeps_the_deferred_queue_from_create_widgets():
    module = ast.parse(agent_source())
    assigns = [n for n in module.body if isinstance(n, ast.Assign) and isinstance(n.value, ast.Call)
               and getattr(n.value.func, "id", None) == "create_widgets"]
    assert len(assigns) == 1 and assigns[0].targets[0].id == "_DEFERRED_WIDGETS"
    bare = [n for n in module.body if isinstance(n, ast.Expr) and isinstance(n.value, ast.Call)
            and getattr(n.value.func, "id", None) == "create_widgets"]
    assert bare == []


def test_notebook_metadata_widget_matches_the_new_modes():
    with open(agent_notebook_path(), encoding="utf-8") as fh:
        nb = json.load(fh)
    widget = nb["metadata"]["application/vnd.databricks.v1+notebook"]["widgets"][QUALITY]
    assert widget["currentValue"] == "Good"
    assert widget["typedWidgetInfo"]["defaultValue"] == "Good"
    assert widget["typedWidgetInfo"]["options"]["choices"] == NEW_CHOICES
    assert widget["widgetInfo"]["defaultValue"] == "Good"
    assert widget["widgetInfo"]["options"]["choices"] == NEW_CHOICES
    assert widget["typedWidgetInfo"]["label"] == widget["widgetInfo"]["label"] == "06. Use Cases Quality"
