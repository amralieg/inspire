import pytest

from _agentload import agent_source
from v120_artifacts_support import elite_assessment, make_inspire, make_uc
from v120_docs_design_test import captured_html, deck, docs, pdf_html, section, slide_texts, summary  # noqa: F401

STAR_FIELDS = {"best_of_best", "best_of_best_rank", "best_of_best_score", "best_of_best_reason"}
JUDGE_FIELDS = {"elite_assessment", "elite_score", "elite_status", "selection_drop_reason"}


class _Schemas:
    def load_schema_details(self, name):
        return []


def _uc(no, domain="Sales", bob=7.0, inspire=8.0, **extra):
    return make_uc(no, domain, bob_score=bob, **{"Inspire Score": inspire}, **extra)


def _fake_judge(obj, verdicts, calls):
    def judge(survivors, schema_details, context, rt, stage="elite"):
        calls.append((stage, [uc["No"] for uc in survivors], list(survivors)))
        elite, judged = [], []
        for uc in survivors:
            verdict = verdicts.get(uc["No"])
            if verdict is None:
                uc["selection_drop_reason"] = "elite judge returned no valid assessment after retries: timeout"
                continue
            passed, score = verdict
            assessment = elite_assessment()
            assessment["failed_gates"] = [] if passed else ["score:evidence_strength", "red_team"]
            assessment["verification"] = {"passed": passed, "failures": []}
            uc["elite_assessment"], uc["elite_score"] = assessment, score
            judged.append(uc)
            if passed:
                uc["elite_status"] = "ELITE"
                elite.append(uc)
        return elite, judged, []

    obj._judge_elite_candidates = judge


@pytest.mark.parametrize("value,expected", [(None, None), ("", None), ("  ", None), ("0", 0), (" 15 ", 15),
                                            ("100", 100), (7, 7)])
def test_the_count_parser_accepts_empty_and_whole_numbers_from_0_to_100(agent_ns, value, expected):
    assert agent_ns["parse_best_of_best_count"](value) == expected


@pytest.mark.parametrize("value", ["101", "-1", "abc", "1.5", "\uff11\uff12", "1e2", True])
def test_the_count_parser_rejects_everything_else(agent_ns, value):
    with pytest.raises(ValueError):
        agent_ns["parse_best_of_best_count"](value)


def test_the_count_comes_from_the_widget_then_the_generation_instructions_then_the_default(agent_ns):
    obj = make_inspire(agent_ns, best_of_best_widget_count=7, parsed_generation_instructions={"best_of_best_count": 12})
    assert obj._resolve_best_of_best_count() == (7, "widget")
    obj.best_of_best_widget_count = None
    assert obj._resolve_best_of_best_count() == (12, "generation instructions")
    obj.parsed_generation_instructions = {"best_of_best_count": 0}
    assert obj._resolve_best_of_best_count() == (0, "generation instructions")
    obj.parsed_generation_instructions = {"best_of_best_count": 15.0}
    assert obj._resolve_best_of_best_count() == (15, "generation instructions")
    for unusable in ("lots", 101, 2.5, True):
        obj.parsed_generation_instructions = {"best_of_best_count": unusable}
        assert obj._resolve_best_of_best_count() == (20, "default"), unusable
    assert sum("is not usable" in msg for _level, msg in obj.logger.records) == 4
    obj.parsed_generation_instructions = {}
    assert obj._resolve_best_of_best_count() == (20, "default")


def test_the_pick_ranks_by_elite_score_spreads_domains_and_serves_user_domains_first(agent_ns):
    obj = make_inspire(agent_ns, user_business_domains=[])
    a = [_uc(f"A{i}", "A") for i in range(6)]
    b, c = _uc("B1", "B"), _uc("C1", "C")
    scores = {id(uc): 9.9 - i * 0.1 for i, uc in enumerate(a)}
    scores.update({id(b): 8.0, id(c): 7.0})
    eligible = a + [b, c]

    def ids(picked):
        return [uc["No"] for uc in picked]

    assert ids(obj._pick_best_of_best(eligible, scores, 4)) == ["A0", "A1", "B1", "C1"]
    assert ids(obj._pick_best_of_best(eligible, scores, 6)) == ["A0", "A1", "A2", "A3", "B1", "C1"]
    assert ids(obj._pick_best_of_best(eligible, scores, 20)) == ["A0", "A1", "A2", "A3", "A4", "A5", "B1", "C1"]
    obj.user_business_domains = ["c"]
    assert ids(obj._pick_best_of_best(eligible, scores, 3)) == ["A0", "A1", "C1"]


def test_good_mode_stars_only_use_cases_that_pass_every_elite_test_and_keeps_only_their_verified_assessment(agent_ns):
    obj = make_inspire(agent_ns, storage_manager=_Schemas(), user_business_domains=[], best_of_best_widget_count=3)
    ucs = [_uc("U1", bob=7.0), _uc("U2", bob=6.0), _uc("U3", bob=4.0), _uc("U4", "Ops", bob=8.0), _uc("U5", bob=6.5)]
    before = [dict(uc) for uc in ucs]
    calls = []
    _fake_judge(obj, {"U1": (True, 8.1), "U2": (False, 7.0), "U4": (True, 8.9), "U5": (False, 9.9)}, calls)
    starred = obj._mark_best_of_best(ucs, {})
    assert [uc["No"] for uc in starred] == ["U4", "U1"]
    stage, judged_ids, judged = calls[0]
    assert stage == "best_of_best" and judged_ids == ["U1", "U2", "U4", "U5"]
    assert not any(copy is uc for copy in judged for uc in ucs), "the judge works on copies"
    copies = {copy["No"]: copy for copy in judged}
    for uc, original in zip(ucs, before):
        passed = uc["No"] in ("U1", "U4")
        assert set(uc) & JUDGE_FIELDS == ({"elite_assessment"} if passed else set()), uc["No"]
        if passed:
            assert uc["elite_assessment"] is copies[uc["No"]]["elite_assessment"] and uc["elite_assessment"]["decision"]
        assert {k: v for k, v in uc.items() if k not in STAR_FIELDS | {"elite_assessment"}} == original
        assert not obj._has_elite_fields(uc), "Good-mode exports keep their columns: no Elite status, score or columns"
    by_id = {uc["No"]: uc for uc in ucs}
    assert [by_id["U4"][k] for k in ("best_of_best", "best_of_best_rank", "best_of_best_score")] == ["Y", 1, 8.9]
    assert by_id["U1"]["best_of_best_rank"] == 2
    assert by_id["U1"]["best_of_best_reason"].startswith(
        "passed every elite test: value tier Material; business value 9/10, evidence strength 8/10")
    assert by_id["U5"]["best_of_best"] == "N" and "best_of_best_rank" not in by_id["U5"]
    assert by_id["U5"]["best_of_best_reason"].startswith("did not pass: evidence strength score, red team review")
    assert by_id["U3"]["best_of_best_reason"] == "Best-of-Best score 4 is below the elite prescreen minimum 5"
    assert [uc["No"] for uc in obj._best_of_best_near_miss] == ["U5", "U2"]
    assert obj._best_of_best_summary == {"target": 3, "source": "widget", "mode": "Good", "short_list": False,
                                         "judged": 4, "passed": 2}, "fewer pass than asked, so only 2 are starred"


def test_a_good_mode_star_notebook_shows_its_verified_decision_and_schedules_its_job_after_a_reload(agent_ns):
    from v120_genie_support import build_inspire
    obj = make_inspire(agent_ns, storage_manager=_Schemas(), user_business_domains=[], best_of_best_widget_count=1)
    star, other = _uc("U1", bob=7.0), _uc("U2", bob=6.0)
    _fake_judge(obj, {"U1": (True, 8.1), "U2": (False, 7.0)}, [])
    obj._mark_best_of_best([star, other], {})
    cls = agent_ns["DatabricksInspire"]
    reloaded = build_inspire(agent_ns)._row_to_uc({"id": "U1", "use_case": star["Name"],
                                                   "elite_assessment": cls._tracking_json(star["elite_assessment"])})
    assert reloaded["elite_assessment"]["decision"] == "Reorder stock for each store every Monday"
    inst = build_inspire(agent_ns)
    for uc in (star, dict(star, elite_assessment=reloaded["elite_assessment"])):
        spec = inst._genie_notebook_spec(uc)
        card = inst._genie_card_markdown(uc, spec)
        assert "| **Decision** | Reorder stock for each store every Monday \u00b7 Regional supply planner \u00b7 weekly |" in card
        assert spec["schedule_cron"] == "0 0 6 ? * MON", "the job gets a paused schedule at the decision cadence"
        assert card.count("| **Decision** |") == 1 and "Elite Status" not in card and "Value Driver" not in card, \
            "the short card keeps the decision; the instruction carries the rest"
    spec = inst._genie_notebook_spec(other)
    other_card = inst._genie_card_markdown(other, spec)
    assert not spec["schedule_cron"] and "| **Decision** |" not in other_card and "not assessed" not in other_card
    skeleton = "".join(inst._build_use_case_details_markdown_source(star))
    assert "| **Decision Changed** | Reorder stock for each store every Monday |" in skeleton, "a skeleton has no card, so it keeps every row"


def test_a_passing_use_case_removed_as_a_twin_after_judging_names_the_kept_twin_by_title(agent_ns):
    obj = make_inspire(agent_ns, storage_manager=_Schemas(), user_business_domains=[], best_of_best_widget_count=2)
    ucs = [_uc("U1", bob=7.0, inspire=9.0, Name="Reduce Customer Lapse", usecase="Reduce customer lapse",
               **{"Tables Involved": "c.s.orders"}),
           _uc("U2", bob=6.9, inspire=7.0, Name="Reduce Customer Lapse Across Channels", usecase="Reduce customer lapse",
               **{"Tables Involved": "c.s.web_orders"}),
           _uc("U3", "Ops", bob=6.8, inspire=8.0, Name="Forecast Return Volume", **{"Tables Involved": "c.s.returns"})]
    obj._deduplicate_use_cases = lambda elite, rank=None: list(elite)

    def judge(survivors, schema_details, context, rt, stage="elite"):
        for copy in survivors:
            assessment = elite_assessment()
            assessment["failed_gates"], assessment["verification"] = [], {"passed": True, "failures": []}
            copy["elite_assessment"], copy["elite_score"], copy["elite_status"] = assessment, 8.0, "ELITE"
        return obj._dedup_elite_overlap(list(survivors), stage=stage), list(survivors), []

    obj._judge_elite_candidates = judge
    starred = obj._mark_best_of_best(ucs, {})
    assert sorted(uc["No"] for uc in starred) == ["U1", "U3"]
    twin = ucs[1]
    assert twin["best_of_best"] == "N"
    assert twin["best_of_best_reason"] == ('same decision as the stronger elite use case "Reduce Customer Lapse" '
                                           '(the higher elite score is kept)'), "never the bare 'did not pass:'"
    obj._number_by_domain(sorted(ucs, key=lambda uc: uc["Name"]))
    assert "U1" not in twin["best_of_best_reason"], "the reason names the kept twin by title, so renumbering cannot break it"


def test_ultra_high_says_why_a_use_case_that_passed_was_not_kept(agent_ns):
    obj = make_inspire(agent_ns, use_cases_quality="Ultra High", storage_manager=_Schemas(), user_business_domains=[],
                       best_of_best_widget_count=1)
    passed = elite_assessment()
    passed["failed_gates"], passed["verification"] = [], {"passed": True, "failures": []}
    ucs = [_uc("E1", elite_status="ELITE", elite_score=8.4, elite_assessment=elite_assessment()),
           _uc("E2", "Ops", elite_status="ELITE", elite_score=8.8, elite_assessment=elite_assessment()),
           _uc("D1", "Ops", elite_score=8.1, elite_assessment=passed,
               selection_drop_reason="overlaps a stronger elite use case (the higher elite score is kept)")]
    obj._mark_best_of_best(ucs, {})
    assert ucs[2]["best_of_best_reason"] == "overlaps a stronger elite use case (the higher elite score is kept)"
    del ucs[2]["selection_drop_reason"]
    obj._mark_best_of_best(ucs, {})
    assert ucs[2]["best_of_best_reason"] == "passed every elite test but was not kept as an elite"


def test_ultra_high_reuses_the_elite_verdicts_and_never_judges_again(agent_ns):
    obj = make_inspire(agent_ns, use_cases_quality="Ultra High", storage_manager=_Schemas(), user_business_domains=[],
                       best_of_best_widget_count=2)

    def never(*args, **kwargs):
        raise AssertionError("Ultra High already judged every final use case")

    obj._judge_elite_candidates = never
    below = elite_assessment(verdict="NEAR_MISS", fatal_flaws=[])
    below["failed_gates"] = ["score:actionability"]
    below["verification"] = {"passed": True, "failures": []}
    ucs = [_uc("E1", elite_status="ELITE", elite_score=8.4, elite_assessment=elite_assessment()),
           _uc("E2", "Ops", elite_status="ELITE", elite_score=8.8, elite_assessment=elite_assessment()),
           _uc("C1", "Ops", elite_status="DOMAIN_COVERAGE_PICK", elite_score=7.1, elite_assessment=below)]
    starred = obj._mark_best_of_best(ucs, {})
    assert [uc["No"] for uc in starred] == ["E2", "E1"]
    assert ucs[2]["best_of_best"] == "N" and ucs[2]["best_of_best_reason"] == "did not pass: actionability score"
    assert (obj._best_of_best_summary["judged"], obj._best_of_best_summary["passed"]) == (3, 2)
    assert ucs[0]["elite_status"] == "ELITE", "Ultra High fields are read, never rewritten"


def test_a_zero_count_stars_nothing_and_never_calls_the_judge(agent_ns):
    obj = make_inspire(agent_ns, storage_manager=_Schemas(), best_of_best_widget_count=0)

    def never(*args, **kwargs):
        raise AssertionError("no judging when the count is 0")

    obj._judge_elite_candidates = never
    ucs = [_uc("U1"), _uc("U2")]
    assert obj._mark_best_of_best(ucs, {}) == []
    assert {uc["best_of_best"] for uc in ucs} == {"N"}
    assert ucs[0]["best_of_best_reason"] == "the Best of Best count is 0"
    assert (obj._best_of_best_summary["target"], obj._best_of_best_summary["source"]) == (0, "widget")


def test_a_catalog_no_bigger_than_the_count_is_already_the_short_list_and_is_never_judged(agent_ns):
    obj = make_inspire(agent_ns, storage_manager=_Schemas(), user_business_domains=[])

    def never(*args, **kwargs):
        raise AssertionError("a short list is not judged")

    obj._judge_elite_candidates = never
    ucs = [_uc(f"U{i}", bob=9.0) for i in range(3)]
    assert obj._mark_best_of_best(ucs, {}) == []
    assert {uc["best_of_best"] for uc in ucs} == {"N"}
    assert ucs[0]["best_of_best_reason"] == "the catalog holds 3 use cases, not more than 20, so it is already the short list"
    outcome = obj._publish_best_of_best(ucs)
    assert (outcome["short_list"], outcome["judged"], outcome["starred"]) == (True, 0, 0)


def test_a_rerun_clears_stars_left_from_a_cached_catalog(agent_ns):
    obj = make_inspire(agent_ns, storage_manager=_Schemas(), user_business_domains=[], best_of_best_widget_count=1)
    _fake_judge(obj, {"U1": (False, 6.0), "U2": (False, 5.5)}, [])
    ucs = [_uc("U1", best_of_best="Y", best_of_best_rank=1, best_of_best_score=9.0, best_of_best_reason="old"), _uc("U2")]
    assert obj._mark_best_of_best(ucs, {}) == []
    assert ucs[0]["best_of_best"] == "N" and "best_of_best_rank" not in ucs[0]
    assert ucs[0]["best_of_best_reason"].startswith("did not pass:")


def test_the_outcome_names_final_ids_and_reaches_the_results_and_the_catalog(agent_ns):
    obj = make_inspire(agent_ns, storage_manager=_Schemas(), user_business_domains=[], best_of_best_widget_count=1)
    _fake_judge(obj, {"U1": (True, 8.1), "U2": (False, 7.0)}, [])
    ucs = [_uc("U1"), _uc("U2")]
    obj._mark_best_of_best(ucs, {})
    ucs[0]["No"], ucs[1]["No"] = "N01-U02", "N01-U01"
    outcome = obj._publish_best_of_best(ucs)
    assert outcome["ids"] == ["N01-U02"] and outcome["starred"] == 1
    assert outcome["near_miss"] == [{"No": "N01-U01", "Name": ucs[1]["Name"], "Business Domain": "Sales",
                                     "best_of_best_score": 7.0, "reason": ucs[1]["best_of_best_reason"]}]
    assert obj._v130_results_keys()["best_of_best"] is outcome
    assert "best_of_best" in agent_ns["DatabricksInspire"]._V130_CATALOG_KEYS
    assert make_inspire(agent_ns)._publish_best_of_best(ucs) is None, "nothing is published when no marking ran"


def test_every_starred_use_case_gets_its_own_deck_page_and_the_top_ten_keep_theirs(docs):
    ranked = [make_uc(f"N01-U{i:02d}", "Sales", **{"Inspire Score": round(9.5 - i * 0.1, 2)}) for i in range(1, 17)]
    ranked[13].update(best_of_best="Y", best_of_best_rank=1, best_of_best_score=8.6,
                      best_of_best_reason="passed every elite test")
    _, prs = deck(docs, {"Sales": ranked}, summary())
    texts = slide_texts(prs)
    page = lambda no: any(f"Statement for {no}" in text for text in texts)
    assert sum("\u2605 Best of Best #1 \u00b7 Elite Score 8.6 / 10" in text for text in texts) == 1
    assert page("N01-U14"), "the starred use case outside the top 10 gets its own page"
    assert all(page(f"N01-U{i:02d}") for i in range(1, 11)), "the top 10 keep their pages"
    assert not any(page(no) for no in ("N01-U11", "N01-U12", "N01-U13", "N01-U15", "N01-U16"))


def test_the_tracking_row_carries_four_star_columns_and_older_rows_read_null(agent_ns):
    cls = agent_ns["DatabricksInspire"]
    fields = [field for field in cls._V130_TRACKING_FIELDS if field[0].startswith("best_of_best")]
    assert [column for column, _key, _kind in fields] == ["best_of_best", "best_of_best_rank", "best_of_best_score",
                                                          "best_of_best_reason"]
    uc = {"best_of_best": "Y", "best_of_best_rank": 3, "best_of_best_score": 8.75, "best_of_best_reason": "passed"}
    assert [cls._v130_tracking_value(uc, key, kind) for _column, key, kind in fields] == ["Y", "3", "8.75", "passed"]
    assert all(cls._v130_tracking_value({}, key, kind) is None for _column, key, kind in fields)


def test_a_starred_use_case_shows_its_star_on_every_surface_and_an_unstarred_one_shows_none(docs, captured_html):
    star = make_uc("N01-U01", "Sales", Name="Starred idea", best_of_best="Y", best_of_best_rank=1,
                   best_of_best_score=8.6, best_of_best_reason="passed every elite test", **{"Inspire Score": 9.0})
    plain = make_uc("N01-U02", "Sales", Name="Plain idea", best_of_best="N", best_of_best_reason="did not pass: red_team",
                    **{"Inspire Score": 8.0})
    grouped = {"Sales": [star, plain]}
    expected = "\u2605 Best of Best #1 \u00b7 Elite Score 8.6 / 10"
    _, page = pdf_html(docs, captured_html, grouped, summary())
    assert expected in section(page, 'id="uc-N01-U01"', "</article>") and 'class="ribbon star"' in page
    assert "\u2605" not in section(page, 'id="uc-N01-U02"', "</article>")
    assert "did not pass" not in page and "passed every elite test" not in page
    _, prs = deck(docs, grouped, summary())
    assert sum(expected in text for text in slide_texts(prs)) == 1
    _, romanian = deck(docs, grouped, summary(), language="Romanian")
    assert sum("\u2605 Cel mai bun dintre cei mai buni #1 \u00b7 Scor de elit\u0103 8.6 / 10" in text
               for text in slide_texts(romanian)) == 1, "the longest translation is never cut"
    md_obj = make_inspire(docs)
    md_obj._generate_markdown_catalog("English", "en", grouped, summary(), "Acme")
    md = next(iter(md_obj.w_client.workspace.files.values())).decode("utf-8")
    assert f"> **{expected}**" in md and md.count("\u2605") == 1
    columns = {header: (getter, numeric) for header, getter, numeric in make_inspire(docs)._export_columns(False)}
    getter, numeric = columns["Best of Best"]
    assert (getter(star, 1), getter(plain, 2), numeric) == (1, "", True)
    assert columns["Best of Best Reason"][0](plain, 2) == "did not pass: red_team"


def test_every_document_language_names_the_star_in_its_own_words(agent_ns):
    ts = agent_ns["TranslationService"]
    assert ts.ENGLISH_TRANSLATIONS["doc_best_of_best"] == "Best of Best"
    assert len(ts.TRANSLATION_FALLBACKS) == 22
    for language, table in ts.TRANSLATION_FALLBACKS.items():
        assert table.get("doc_best_of_best") not in (None, "", "Best of Best"), language


def test_the_widget_reaches_the_inner_job_and_a_bad_value_stops_the_run(agent_ns):
    src = agent_source()
    assert "16_best_of_best_count" in agent_ns["_NOTEBOOK_WIDGET_NAMES"]
    assert 'dbutils.widgets.text("16_best_of_best_count", "", "16. Best of Best Count")' in src
    assert "validation_errors.append(f\"\u274c Best of Best Count: {redact_error(_best_of_best_err)}\")" in src
    assert '"best_of_best_count": best_of_best_count_str,' in src
    assert 'parse_best_of_best_count(kwargs.get("best_of_best_count"))' in src


def test_stars_are_marked_after_selection_before_alignment_and_published_after_the_final_order(agent_ns):
    src = agent_source()
    steps = ["self._select_scored_use_cases(", "self._mark_best_of_best(final_consolidated_use_cases, scoring_context)",
             "self._run_strategy_alignment(final_consolidated_use_cases)",
             "self._finalize_portfolio_order(final_consolidated_use_cases)",
             "self._publish_best_of_best(final_consolidated_use_cases)"]
    positions = [src.index(step) for step in steps]
    assert all(src.count(step) == 1 for step in steps[1:])
    assert positions == sorted(positions)


def test_the_judging_workers_carry_their_stage_so_good_mode_progress_never_says_ultra_high(agent_ns, monkeypatch):
    import threading
    import types
    rt = agent_ns["TECHNICAL_CONTEXT"]["runtime"]
    cls = agent_ns["DatabricksInspire"]
    for stage, prefix in (("best_of_best", "BestOfBest"), ("elite", "Elite")):
        labels = []

        def fake_judge(self, ucs, schema, evidence, context, rt_, label, **kw):
            labels.append(label)
            return {}, {str(uc.get("No")): "not judged" for uc in ucs}
        monkeypatch.setattr(cls, "_run_elite_judge", fake_judge)
        monkeypatch.setattr(cls, "_elite_decision", lambda self, a, v, rt_: ("NEAR_MISS", []))
        monkeypatch.setattr(cls, "_elite_second_opinion_model", lambda self: "databricks-second")
        obj = make_inspire(agent_ns)
        obj.funnel_ledger = []
        obj._load_elite_evidence = lambda ucs: {}
        obj._judge_elite_candidates([{"No": "U1"}], [], {}, rt, stage=stage)
        failing = {"No": "U2", "elite_assessment": {"verification": {"passed": False, "repairable": True, "failures": ["x"]}}}
        obj._repair_elite_evidence([failing], [], {}, {}, rt, stage=stage)
        near = {"No": "U3", "elite_assessment": {"failed_gates": ["score:business_value"], "verification": {"passed": True}}}
        obj._run_elite_second_opinion([near], [], {}, {}, rt, stage=stage)
        assert labels == [f"{prefix}Judge", f"{prefix}EvidenceRepair", f"{prefix}SecondOpinion"], labels

    obj = make_inspire(agent_ns)
    recorded = []
    obj.atomic_writer = types.SimpleNamespace(emit_step=lambda **kw: recorded.append(kw) or len(recorded))
    obj._prompt_progress_lock = threading.Lock()
    obj._prompt_entities_seen, obj._prompt_progress_emitted = {}, {}
    judge = "ULTRA_HIGH_ELITE_JUDGE_PROMPT"
    for label in ("BestOfBestJudge_R0B1", "BestOfBestEvidenceRepair_R0B1", "BestOfBestSecondOpinion_R0B1"):
        obj._emit_prompt_status(judge, label, "started")
    obj._emit_prompt_status(judge, "BestOfBestJudge_R0B1", "ended_success")
    obj._emit_prompt_status(judge, "EliteJudge_R0B1", "started")
    assert [r["step_name"] for r in recorded] == ["Best of Best"] * 4 + ["Elite Selection"]
    assert not [r["message"] for r in recorded[:4] if "Ultra High" in r["message"] or "elite" in r["message"].lower()]
    assert recorded[0]["message"] == "Inspire has started checking which use cases pass every Best of Best test"
    assert recorded[3]["message"] == "Inspire has completed best of best"
    assert recorded[4]["message"] == "Inspire has started the Ultra High elite selection"


def test_good_mode_judging_logs_its_own_funnel_stages_and_ultra_high_keeps_the_elite_names(agent_ns):
    rt = agent_ns["TECHNICAL_CONTEXT"]["runtime"]
    for stage, expected in (("best_of_best", "best_of_best"), ("elite", "elite")):
        obj = make_inspire(agent_ns)
        obj.funnel_ledger = []
        assert obj._judge_elite_candidates([], [], {}, rt, stage=stage) == ([], [], [])
        assert [entry["stage"] for entry in obj.funnel_ledger] == [
            f"{expected}_judge", f"{expected}_evidence_repair", f"{expected}_verification",
            f"{expected}_second_opinion", f"{expected}_overlap"]
