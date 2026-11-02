import json
import os
import sys

FIXTURE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures", "implement_action_once_cases.json")
ASKS = ("Put the top 10 first", "Show the region")


def _row(ns, ask):
    texts = ns["implement_checklist_texts"](f"{ns['IMPLEMENT_VIBES_UNCHECKED']}: the judge did not answer", True)
    return dict(texts, n=1, requirement=ask, part="dashboard", where="", status="not_met", rounds=0, tried=[], checks=[],
                published_anyway=None, unchecked=True)


def action_once_cases(ns) -> dict:
    unfixed = ns["implement_unfixed_text"]
    stop = {"status": "stopped", "stop_reason": "row_count 10 below 1000", "stopped_by": "genie",
            "not_a_stop": "the run stopped with no model that passed acceptance", "sent_back": False}
    return {
        "held_reason_two_unchecked_asks": ns["implement_held_reason"]([dict(_row(ns, ask), n=n) for n, ask in enumerate(ASKS, 1)], 3, 2),
        "held_reason_one_ask": ns["implement_held_reason"]([_row(ns, ASKS[0])], 3, 2),
        "checklist_row_could_not_check": {key: _row(ns, ASKS[0])[key] for key in ("evidence", "fact")},
        "problems_with_edit_mvp_action": unfixed("the run wrote no rows for the last week", 0),
        "run_controls_warning": ns["implement_run_controls_warning"]("/Workspace/Shared/inspire/churn_notebook",
                                                                     "its cell is not the instruction text"),
        "stop_message": ns["implement_stop_message"](stop, {}),
        "joined_status_line": ns["implement_compose"]([f"Notebook: {unfixed('the run wrote no rows for the last week', 0)}",
                                                       f"AI reasoning: {unfixed('the run wrote no AI summary', 0)}",
                                                       f"{ns['IMPLEMENT_OUTPUT_LABELS']['app']}: its settings no longer hold together "
                                                       f"(the page churn names no title); {ns['inspire_rebuild_action']('the App')}"]),
    }


def render(ns) -> str:
    return json.dumps(action_once_cases(ns), indent=1, sort_keys=True, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    import _agentload
    with open(FIXTURE, "w", encoding="utf-8") as handle:
        handle.write(render(_agentload.load_agent_namespace()))
    print(FIXTURE)
