"""A removal vibe names an App nav item, and the App drops that item before Genie builds it: "Remove the Accuracy page" on a
forecast App turns the Accuracy screen off, names it in the settings, and says plainly what stays. Names resolve against the labels
the user sees, and an unknown name or a main part says so instead of being ignored."""
import re
from pathlib import Path

import pytest

from v120_genie_support import build_inspire, make_uc

MODES_JS = Path(__file__).resolve().parents[2] / "agent" / "app_shell" / "web" / "src" / "modes.js"


def _resolve(agent_ns, text, layout):
    return agent_ns["implement_app_removals"](text, layout)


def test_remove_the_accuracy_page_turns_the_accuracy_screen_off(agent_ns):
    assert _resolve(agent_ns, "Remove the Accuracy page", "forecast_cockpit") == (["performance"], ["Accuracy"], [])


def test_the_generic_performance_name_is_refused_on_a_forecast_app_because_its_nav_says_accuracy(agent_ns):
    ids, labels, notes = _resolve(agent_ns, "Remove the Performance page", "forecast_cockpit")
    assert ids == [] and labels == []
    assert len(notes) == 1 and "no nav item named Performance" in notes[0] and "Accuracy" in notes[0]


def test_the_main_part_of_the_app_is_kept_with_a_plain_reason(agent_ns):
    ids, _labels, notes = _resolve(agent_ns, "Remove the Review page", "forecast_cockpit")
    assert ids == [] and notes == ["Review is the App's main part, so it stays in every App: remove a page, tab or Runs instead"]


def test_dashboard_and_settings_are_kept_as_main_parts(agent_ns):
    for name in ("Dashboard", "Settings"):
        ids, _labels, notes = _resolve(agent_ns, f"Remove the {name} page", "forecast_cockpit")
        assert ids == [] and notes and notes[0].startswith(f"{name} is the App's main part"), name


def test_remove_runs_drops_the_runs_screen(agent_ns):
    assert _resolve(agent_ns, "Remove Runs", "forecast_cockpit") == (["runs"], ["Runs"], [])


def test_an_unknown_name_says_which_nav_items_the_app_has(agent_ns):
    ids, _labels, notes = _resolve(agent_ns, "Remove the Quarterly Gizmo tile", "forecast_cockpit")
    assert ids == []
    assert notes == ["the App has no nav item named Quarterly Gizmo tile: its nav items are Review, Accuracy, Runs, Dashboard, Settings"]


def test_a_removal_does_not_act_on_other_asks(agent_ns):
    assert _resolve(agent_ns, "Add a fan chart of the forecast\nMake the KPI tiles bigger", "forecast_cockpit") == ([], [], [])


def test_the_same_name_on_a_queue_app_resolves_to_its_own_performance_label(agent_ns):
    assert _resolve(agent_ns, "Remove the Performance page", "decision_queue") == (["performance"], ["Performance"], [])


def test_the_nav_labels_match_the_labels_the_web_shell_shows(agent_ns):
    text = MODES_JS.read_text(encoding="utf-8")
    shown = {m.group(1): (m.group(2), m.group(3)) for m in re.finditer(
        r"(\w+): Object\.freeze\(\{ id: '\w+', work: '([^']+)', performance: '([^']+)'", text)}
    assert set(shown) == set(agent_ns["IMPLEMENT_NAV_LABELS"]), "every mode in modes.js has nav labels in the Python table"
    for mode, labels in shown.items():
        assert tuple(agent_ns["IMPLEMENT_NAV_LABELS"][mode]) == labels, mode


def test_the_app_settings_carry_the_screen_off_and_the_removed_label(agent_ns):
    inst = build_inspire(agent_ns)
    inst.business_name = "Acme"
    uc = make_uc(**{"Analytics Technique": "Forecasting", "app_layout": "forecast_cockpit"})
    context = {"uc_id": "N01-U01", "use_case": uc, "job_id": 77, "spec": {"outputs": {"app_vibes": "Remove the Accuracy page"}},
               "urls": {}}
    core = type("Core", (), {"SETTINGS_VERSION": 1})
    outputs = {"app_access": "sp", "app_vibes": "Remove the Accuracy page", "app_options": {"alerts": False}}
    written = inst._implement_app_settings(context, {"shell_core": core}, {"id": "n01_u01"}, None, "off", outputs)
    assert written["screens"]["performance"] is False and written["screens"]["runs"] is True
    assert written["removed_nav"] == ["Accuracy"] and written["removal_notes"] == []
