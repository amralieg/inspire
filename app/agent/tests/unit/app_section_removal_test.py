"""A removal vibe names an App nav item or a page section, and the App drops it before Genie builds the page. Names resolve against the
labels the user sees; a main part or a section the layout requires stays with a plain reason; an unknown name says so. A removed section
is passed to Genie as "do not include", and a page that still carries it fails its check."""
import re
from pathlib import Path

from _agentload import agent_source
from v120_genie_support import build_inspire, make_uc

MODES_JS = Path(__file__).resolve().parents[2] / "agent" / "app_shell" / "web" / "src" / "modes.js"
FORECAST = "forecast_cockpit"


def _resolve(agent_ns, text, layout=FORECAST):
    return agent_ns["implement_app_removals"](text, layout)


def test_remove_the_accuracy_page_turns_the_accuracy_screen_off(agent_ns):
    assert _resolve(agent_ns, "Remove the Accuracy page") == (["performance"], ["Accuracy"], [], [])


def test_the_generic_performance_name_is_refused_on_a_forecast_app_because_its_nav_says_accuracy(agent_ns):
    ids, labels, sections, notes = _resolve(agent_ns, "Remove the Performance page")
    assert (ids, labels, sections) == ([], [], [])
    assert len(notes) == 1 and "no nav item or section named Performance" in notes[0] and "Accuracy" in notes[0]


def test_the_main_part_of_the_app_is_kept_with_a_plain_reason(agent_ns):
    assert _resolve(agent_ns, "Remove the Review page")[3] == [
        "Review is the App's main part, so it stays in every App: remove a page, tab or Runs instead"]


def test_dashboard_and_settings_are_kept_as_main_parts(agent_ns):
    for name in ("Dashboard", "Settings"):
        ids, _labels, _sections, notes = _resolve(agent_ns, f"Remove the {name} page")
        assert ids == [] and notes and notes[0].startswith(f"{name} is the App's main part"), name


def test_remove_runs_drops_the_runs_screen(agent_ns):
    assert _resolve(agent_ns, "Remove Runs") == (["runs"], ["Runs"], [], [])


def test_an_unknown_name_says_which_nav_items_and_sections_the_app_has(agent_ns):
    ids, _labels, sections, notes = _resolve(agent_ns, "Remove the Quarterly Gizmo tile")
    assert (ids, sections) == ([], [])
    assert notes == ["the App has no nav item or section named Quarterly Gizmo tile: it has Review, Accuracy, Runs, Dashboard, Settings, "
                     "horizon selector, forecast vs capacity, accuracy by series, small multiples"]


def test_a_required_section_stays_with_a_plain_reason(agent_ns):
    ids, _labels, sections, notes = _resolve(agent_ns, "Remove the fan chart")
    assert (ids, sections) == ([], [])
    assert notes == ["fan chart is required by the Forecast cockpit layout, so it stays"]


def test_an_optional_chart_or_table_is_removed_from_the_page(agent_ns):
    assert _resolve(agent_ns, "Remove the small multiples") == ([], [], ["small_multiples"], [])
    assert _resolve(agent_ns, "Remove the forecast vs capacity chart") == ([], [], ["forecast_vs_capacity"], [])


def test_a_removal_does_not_act_on_other_asks(agent_ns):
    assert _resolve(agent_ns, "Add a fan chart of the forecast\nMake the KPI tiles bigger") == ([], [], [], [])


def test_the_same_name_on_a_queue_app_resolves_to_its_own_performance_label(agent_ns):
    assert _resolve(agent_ns, "Remove the Performance page", "decision_queue") == (["performance"], ["Performance"], [], [])


def test_the_nav_labels_match_the_labels_the_web_shell_shows(agent_ns):
    text = MODES_JS.read_text(encoding="utf-8")
    shown = {m.group(1): (m.group(2), m.group(3)) for m in re.finditer(
        r"(\w+): Object\.freeze\(\{ id: '\w+', work: '([^']+)', performance: '([^']+)'", text)}
    assert set(shown) == set(agent_ns["IMPLEMENT_NAV_LABELS"]), "every mode in modes.js has nav labels in the Python table"
    for mode, labels in shown.items():
        assert tuple(agent_ns["IMPLEMENT_NAV_LABELS"][mode]) == labels, mode


def test_the_removed_section_is_passed_to_genie_as_do_not_include(agent_ns):
    inst = build_inspire(agent_ns)
    uc = make_uc(**{"Analytics Technique": "Forecasting", "app_layout": FORECAST})
    context = {"uc_id": "N01-U01", "use_case": uc, "app_layout": FORECAST, "spec": {"outputs": {"app_vibes": "Remove the small multiples"}}}
    assert inst._implement_removed_sections(context) == ["small_multiples"]


def test_a_page_that_still_carries_a_removed_section_fails_the_check(agent_ns):
    page = {"charts": [{"id": "a", "section": "small_multiples"}, {"id": "b", "section": "fan_chart"}],
            "tables": [{"id": "c", "section": "at_risk_series"}]}
    assert agent_ns["implement_removed_section_uses"](page, ["small_multiples"]) == ["small_multiples"]
    assert agent_ns["implement_removed_section_uses"](page, ["accuracy_by_series"]) == []


def test_the_page_check_refuses_a_page_that_reappears_with_the_removed_section(agent_ns):
    src = agent_source()
    assert "still has {', '.join(reappeared)}, which the user removed" in src
    assert "Do not include these sections, which the user removed" in src


def test_the_app_settings_carry_the_screen_off_and_the_removed_label(agent_ns):
    inst = build_inspire(agent_ns)
    inst.business_name = "Acme"
    uc = make_uc(**{"Analytics Technique": "Forecasting", "app_layout": FORECAST})
    context = {"uc_id": "N01-U01", "use_case": uc, "job_id": 77, "spec": {"outputs": {"app_vibes": "Remove the Accuracy page"}},
               "urls": {}}
    core = type("Core", (), {"SETTINGS_VERSION": 1})
    outputs = {"app_access": "sp", "app_vibes": "Remove the Accuracy page", "app_options": {"alerts": False}}
    written = inst._implement_app_settings(context, {"shell_core": core}, {"id": "n01_u01"}, None, "off", outputs)
    assert written["screens"]["performance"] is False and written["screens"]["runs"] is True
    assert written["removed_nav"] == ["Accuracy"] and written["removed_sections"] == [] and written["removal_notes"] == []
