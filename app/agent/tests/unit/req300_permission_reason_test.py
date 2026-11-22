"""REQ-300: a Permission Required entry reason says only WHY. The dialog adds its one instruction line, so no reason in the notebook
may carry its own "ask ... then click Try again" sentence (fail-pre: seven to ten reasons did)."""
import json
import os
import re

NOTEBOOK = os.path.join(os.path.dirname(__file__), "..", "..", "agent", "dbx_inspire_ai_agent.ipynb")
BANNED = re.compile(
    r"then (click|press) Try again|Then click Try again|Ask your (workspace )?admin to run|Ask the person who can grant"
    r"|Ask the Lakebase project owner to run|Ask your data owner to\s*\"?\s*$|run the commands in Permission Required, then"
    r"|Ask your data owner to run these commands|Ask your admin to run this command, then",
    re.I,
)


def _source_lines():
    with open(NOTEBOOK, encoding="utf-8") as handle:
        notebook = json.load(handle)
    for cell in notebook["cells"]:
        if cell.get("cell_type") == "code":
            yield from "".join(cell["source"]).split("\n")


def test_no_permission_reason_tells_the_person_to_ask_an_admin_or_click_try_again():
    offenders = [line.strip()[:150] for line in _source_lines() if BANNED.search(line)]
    assert offenders == [], "\n".join(offenders)


def test_the_audience_reason_is_one_why_sentence(agent_ns):
    why = agent_ns["implement_audience_grant_why"]("admins")
    assert "Try again" not in why and "admin runs" not in why, why
