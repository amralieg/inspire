import os
import re

from _agentload import agent_source
from v140_implement_test import ALERT, _output_context
from v148_app_hub_test import PERSON
from v149_app_alerts_test import ME, WATCH, alerts_shell, save
from v169_use_case_alerts_test import manifest, ok, save_args

import shell_alerts

SERVER = os.path.dirname(shell_alerts.__file__)
AGENT = os.path.dirname(os.path.dirname(SERVER))
LONG = "score every account each week from its orders, returns, support tickets, contract terms and product usage " * 7
GUIDE = {"decision": "Call at-risk customers before renewal", "decision_owner": "Retention lead", "kpi": "monthly churn rate"}
OVERFLOW = {"Name": "Predict churn " + "and keep the accounts " * 12, "Statement": LONG * 6, "Solution": LONG * 6,
            "elite_assessment": {"decision": LONG * 5, "decision_owner": "Head of Retention for every region and channel " * 9, "kpi": LONG * 4}}


def _outputs_of(agent_ns, **changes):
    return dict(_output_context(agent_ns, **ALERT)["spec"]["outputs"], **changes)


def _texts(agent_ns, use_case, outputs, **links):
    return agent_ns["implement_alert_texts"](shell_alerts, "N01-U01", use_case, outputs, links.get("dashboard", ""), links.get("genie", ""),
                                             links.get("cadence"), links.get("from_settings", False), links.get("app", ""))


def test_the_build_time_alert_and_the_app_alert_both_carry_the_runbook_from_the_one_writer(agent_ns, tmp_path, monkeypatch):
    outputs = _outputs_of(agent_ns)
    use_case = {"Name": "Predict churn", "Statement": "Customers leave", "Solution": "Score every account weekly", "elite_assessment": GUIDE}
    _summary, built = _texts(agent_ns, use_case, outputs, dashboard="https://h/d", genie="https://h/genie/rooms/g1", app="https://a.example.com")
    for section in ("What fired: ", "Why this threshold: ", "How often it checks: ", "What to do first:", "Where to look:", "When it clears: "):
        assert section in built, section
    assert "Retention lead decides: Call at-risk customers before renewal." in built and "How the use case acts on it: Score every account weekly." \
        in built
    assert built.splitlines()[built.splitlines().index("Where to look:") + 1:][:3] == [
        "Dashboard: https://h/d", "Genie Agent: https://h/genie/rooms/g1", "App: https://a.example.com"]
    s, ws = alerts_shell(tmp_path)
    s.by_id["n01_u05"]["runbook"] = shell_alerts.use_case_guide(use_case, "https://h/d", "https://h/genie/rooms/g1")
    assert save(s)[0] == 200
    app = ws.posted()[0]["custom_description"]
    for section in ("What fired: ", "Why this threshold: ", "How often it checks: ", "What to do first:", "Where to look:", "When it clears: "):
        assert section in app, section
    assert "Retention lead decides: Call at-risk customers before renewal." in app and "Dashboard: https://h/d" in app
    seen = []
    real = shell_alerts.runbook
    monkeypatch.setattr(shell_alerts, "runbook", lambda *a, **k: seen.append(a[0]) or real(*a, **k))
    _texts(agent_ns, use_case, outputs)
    assert save(s, name="Second")[0] == 200
    assert len(seen) == 2, "both the notebook and the App shell write the runbook through shell_alerts.runbook"


def test_there_is_one_runbook_writer_in_the_whole_tree():
    hits = []
    for folder, _dirs, names in os.walk(AGENT):
        if "node_modules" in folder or "dist" in folder or "static" in folder:
            continue
        for name in names:
            if name.endswith((".py", ".ipynb", ".js", ".jsx")):
                text = open(os.path.join(folder, name), encoding="utf-8").read()
                hits += [(name, m.group(0)) for m in re.finditer(r"What fired: |When it clears: |What it means: it fires", text)]
    assert sorted(set(hits)) == [("shell_alerts.py", "What fired: "), ("shell_alerts.py", "When it clears: ")], hits
    assert "def runbook(" not in agent_source() and "When it clears" not in agent_source()


def test_a_use_case_whose_texts_overflow_is_cut_at_a_sentence_end_never_mid_word(agent_ns, monkeypatch):
    outputs = _outputs_of(agent_ns, alert_condition_text="refunds double in a week " * 18, alert_threshold_basis="baseline",
                   alert_operator=">")
    summary, text = _texts(agent_ns, OVERFLOW, outputs, dashboard="https://h/d", genie="https://h/genie/rooms/g1", app="https://a.example.com",
                           from_settings=True)
    monkeypatch.setattr(shell_alerts, "RUNBOOK_LIMIT", 10 ** 6)
    monkeypatch.setattr(shell_alerts, "SUMMARY_LIMIT", 10 ** 6)
    full_summary, full = _texts(agent_ns, OVERFLOW, outputs, dashboard="https://h/d", genie="https://h/genie/rooms/g1",
                                app="https://a.example.com", from_settings=True)
    assert len(full) > 4000 and len(full_summary) > 250, "the use case really overflows both limits"
    assert len(text) <= 4000 and len(summary) <= 250 and full.startswith(text) and full_summary.startswith(summary)
    assert text[-1] in ".!?" and full[len(text)] in " \n", "cut right after a sentence end"
    assert full_summary[len(summary)] == " ", "the summary is cut between two words"
    guide = shell_alerts.use_case_guide(OVERFLOW, "https://h/d")
    sources = {"decision": OVERFLOW["elite_assessment"]["decision"], "owner": OVERFLOW["elite_assessment"]["decision_owner"],
               "solution": OVERFLOW["Solution"], "kpi": OVERFLOW["elite_assessment"]["kpi"]}
    for key, source in sources.items():
        plain = " ".join(source.split())
        assert len(guide[key]) <= 400 and plain.startswith(guide[key]) and plain[len(guide[key])] == " ", key
    assert not re.search("[\u2013\u2014]", text + summary)
    long = "Word " * 300 + "end."
    cut = shell_alerts.cut_text(long, 100)
    assert len(cut) <= 100 and cut.endswith("Word") and " " not in long[len(cut):len(cut) + 1].strip()
    assert shell_alerts.cut_text("First one. Second one is long", 20) == "First one."
    assert shell_alerts.cut_text("Line one\nLine two is long", 12) == "Line one"
    assert shell_alerts.cut_text("x" * 50, 10) == "x" * 10
    assert shell_alerts.cut_text("e.g. this", 4) == "e.g."
    assert shell_alerts.cut_text("short", 10) == "short"


def test_a_cut_never_ends_on_a_bare_list_number_or_a_heading(agent_ns, monkeypatch):
    steps = "What fired: rows passed the line.\nWhat to do first:\n1. Open the list.\n2. " + "word " * 900
    assert shell_alerts.cut_text(steps, 200) == "What fired: rows passed the line.\nWhat to do first:\n1. Open the list."
    heading = "What fired: rows passed the line.\nWhere to look:\n" + "x" * 500
    assert shell_alerts.cut_text(heading, 100) == "What fired: rows passed the line."
    assert shell_alerts.cut_text("It is at or above 5. " + "word " * 100, 30) == "It is at or above 5."
    monkeypatch.setattr(shell_alerts, "RUNBOOK_PART_LIMIT", 10 ** 6)
    words = "act on the accounts with the highest value at stake first and record what was done " * 80
    use_case = {"Name": "Predict churn", "Statement": "Customers leave.", "Solution": words,
                "elite_assessment": {"decision": "Call them", "decision_owner": "Retention lead", "kpi": "churn"}}
    _summary, text = _texts(agent_ns, use_case, _outputs_of(agent_ns), dashboard="https://h/d")
    last = text.splitlines()[-1]
    assert len(text) <= 4000 and not re.fullmatch(r"\s*\d+\.", last) and not last.endswith(":"), last
    assert last == "4. Retention lead decides: Call them.", "a step with no sentence end inside the limit is left out whole"
    use_case["Solution"] = "Call the riskiest accounts first. " + words
    _summary, text = _texts(agent_ns, use_case, _outputs_of(agent_ns), dashboard="https://h/d")
    assert len(text) <= 4000 and text.splitlines()[-1] == "5. How the use case acts on it: Call the riskiest accounts first.", text[-300:]


def test_the_overflow_check_sees_a_text_that_really_overflows(agent_ns):
    outputs = _outputs_of(agent_ns, alert_condition_text="refunds double in a week " * 18)
    parts = OVERFLOW["Statement"] + OVERFLOW["Solution"] + OVERFLOW["elite_assessment"]["decision"] + OVERFLOW["elite_assessment"]["kpi"]
    assert len(parts) > 4000
    _summary, text = _texts(agent_ns, OVERFLOW, outputs, dashboard="https://h/d")
    assert len(text) > 3000, "the runbook is long enough that the 4000 limit is the one that cuts it"


def test_the_app_page_carries_the_runbook_guide_the_build_wrote_and_an_app_alert_reads_it(agent_ns, tmp_path):
    use_case = {"Name": "Predict churn", "Solution": "Score every account weekly", "elite_assessment": GUIDE}
    page = agent_ns["implement_app_page"]({"title": "Churn desk", "runbook": {"decision": "made up by Genie"}}, "N01-U01", use_case, "main.s.t",
                                          None, shell_alerts.use_case_guide(use_case, "https://h/d"))
    assert page["runbook"] == {"decision": "Call at-risk customers before renewal", "owner": "Retention lead",
                               "solution": "Score every account weekly", "kpi": "monthly churn rate", "dashboard": "https://h/d"}
    assert "runbook" not in agent_ns["implement_app_page"]({"title": "x", "runbook": {"decision": "made up"}}, "N01-U01", use_case), \
        "only Inspire writes the guide, never the page Genie wrote"
    assert "self._implement_runbook_guide(context)," in agent_source()
    assert 'implement_alert_texts(shell_alerts, uc_id, context["use_case"], outputs' in agent_source()


def test_the_inspire_app_alert_on_a_use_case_with_no_app_takes_its_steps_from_the_use_case_row():
    row = {"solution": "Call the riskiest accounts first", "elite_assessment": '{"decision": "Call at-risk customers", "decision_owner": "Retention lead"}'}
    page = ok("page", {"table": "main.pricing.loss_desk_out", "manifest": manifest(), "page_id": "n01_u05", "title": "Desk", "use_case": row,
                       "dashboard": "https://h/d", "genie": "not a link"})
    assert page["runbook"] == {"decision": "Call at-risk customers", "owner": "Retention lead", "solution": "Call the riskiest accounts first",
                               "dashboard": "https://h/d"}
    planned = ok("save", dict(save_args(page, watch=dict(WATCH, filters={"tier": ["Act now"]})), link="https://inspire.example.com/"))
    lines = planned["body"]["custom_description"].splitlines()
    assert lines[:4] == ["What fired: Records on the list on Desk are at least 2, counting only Tier: Act now.",
                         f"Why this threshold: 2 is the number {PERSON} set for this alert in the App.", "How often it checks: every day at 08:00 UTC.",
                         "What to do first:"]
    assert lines[4].startswith("1. Open the decision list (https://inspire.example.com/) and work the Act now rows by rank")
    assert "2. Retention lead decides: Call at-risk customers." in lines and "3. How the use case acts on it: Call the riskiest accounts first." in lines
    assert lines[lines.index("Where to look:") + 1:][:2] == ["Dashboard: https://h/d", "App: https://inspire.example.com/"]
    bare = ok("save", save_args(ok("page", {"table": "main.pricing.loss_desk_out", "manifest": manifest(), "page_id": "p"}),
                                watch=dict(WATCH, filters={})))
    assert "decides" not in bare["body"]["custom_description"] and "How the use case acts" not in bare["body"]["custom_description"]


def test_the_assignment_email_carries_the_runbook_too(tmp_path):
    s, ws = alerts_shell(tmp_path)
    s.write_versions = lambda *args, **kwargs: {"num_inserted_rows": 1}
    from v149_app_alerts_test import SAM, act
    assert act(s, ME, SAM)[1]["notice"].startswith(SAM)
    [body] = ws.posted()
    lines = body["custom_description"].splitlines()
    assert lines[:3] == ["What fired: someone assigned you records on Desk n01_u05 in the last full hour.",
                         "Why this threshold: it emails you for any hour in which someone else gives you at least one record.",
                         "How often it checks: every hour, five minutes past the hour."]
    assert "1. Open the App (https://loss-desk-1.example.com/?open=n01_u05) and pick Mine on the list to see them." in lines
    assert "When it clears: it sends no email, and you hear from it again only the next time it fires." in lines
    assert body["evaluation"]["notification"]["notify_on_ok"] is False
