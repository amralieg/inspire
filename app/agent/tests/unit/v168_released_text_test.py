import json
import os

import pytest

FIXTURE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures", "released_main_4407364_texts.json")
RELEASED = json.load(open(FIXTURE, encoding="utf-8"))


def test_the_fixture_is_main_s_run_controls_and_renders_the_outputs_it_holds():
    space = {}
    exec(RELEASED["run_controls_functions"], space)
    assert 'f"wrote {outcome.get(\'rows_written\')} row(s) for as_of_date {outcome.get(\'as_of_date\')} "' in RELEASED["run_controls_functions"]
    for item in RELEASED["outputs"]:
        assert space["inspire_exit_text"](space["inspire_outcome_text"](item["outcome"]), item["printed"]) == item["exit"]
    assert RELEASED["job_exit_line"].startswith('dbu.notebook.exit(f"Job run finished: {headline}. Results table: ')


@pytest.mark.parametrize("index", range(len(RELEASED["outputs"])))
@pytest.mark.parametrize("form", ["exit", "job_exit"])
def test_a_notebook_built_by_released_main_still_reports_its_outcome(agent_ns, index, form):
    item = RELEASED["outputs"][index]
    parsed = agent_ns["parse_use_case_outcome"](item[form])
    outcome = item["outcome"]
    if outcome["status"] == "written":
        assert parsed == {"status": "written", "rows_written": outcome["rows_written"], "as_of_date": outcome["as_of_date"],
                          "run_id": outcome["run_id"]}
    else:
        assert parsed["status"] == "stopped" and parsed["stop_reason"].startswith(outcome["stop_reason"])


def test_the_run_controls_this_build_writes_are_read_the_same_way(agent_ns):
    template = agent_ns["GENIE_RUN_CONTROLS_TEMPLATE"]
    space = {"inspire_plural": agent_ns["inspire_plural"]}
    exec(template[template.index("def inspire_outcome_text"):template.index("def inspire_main(")], space)
    parse = agent_ns["parse_use_case_outcome"]
    for rows in (1, 2, 812):
        outcome = {"status": "written", "rows_written": rows, "as_of_date": "2026-10-01", "run_id": "1b2c3d4e-0000"}
        text = space["inspire_outcome_text"](outcome)
        assert "(s)" not in text and parse(space["inspire_exit_text"](text, "Readiness passed")) == outcome


@pytest.mark.parametrize("text", ["wrote 3 rowz for as_of_date 2026-10-01 with run_id 1b2c3d4e-0000",
                                  "wrote 3 row(es) for as_of_date 2026-10-01 with run_id 1b2c3d4e-0000",
                                  "wrote three rows for as_of_date 2026-10-01 with run_id 1b2c3d4e-0000"])
def test_text_in_neither_form_is_not_read_as_a_written_run(agent_ns, text):
    assert agent_ns["parse_use_case_outcome"](text)["status"] == "unknown"
