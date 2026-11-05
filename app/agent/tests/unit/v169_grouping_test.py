import hashlib
import json
import os

import pytest

from v148_run_log_test import ORDERS, TABLE, _merge_values, _spark, _unquote

FIXTURE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures", "implement_grouping_cases.json")


def _cases():
    with open(FIXTURE, encoding="utf-8") as handle:
        text = handle.read()
    return text, json.loads(text)


def test_the_shared_grouping_fixture_is_stable_and_names_what_the_agent_uses(agent_ns):
    text, data = _cases()
    assert json.dumps(data, indent=2, ensure_ascii=False) + "\n" == text
    names, constants, labels = data["settings"]["group_by"], data["constants"], data["labels"]
    assert (names["name"], names["label"], names["all"], names["custom"]) == (
        agent_ns["INSPIRE_GROUP_BY"], agent_ns["INSPIRE_GROUP_LABEL"], agent_ns["INSPIRE_SETTING_ALL"], agent_ns["INSPIRE_GROUP_CUSTOM"])
    assert names["solo"] == [agent_ns["INSPIRE_SETTING_ALL"]]
    assert "custom" not in names["format"] and "custom" not in data, "no grouping SQL is described or tested as a choice"
    assert (constants["group_min_records"], constants["group_min_periods"], constants["group_max_groups"], constants["group_min_groups"]) == (
        agent_ns["INSPIRE_GROUP_MIN_RECORDS"], agent_ns["INSPIRE_GROUP_MIN_PERIODS"], agent_ns["INSPIRE_GROUP_MAX_GROUPS"],
        agent_ns["INSPIRE_GROUP_MIN_GROUPS"])
    assert "techniques" not in data and "INSPIRE_GROUP_TECHNIQUES" not in agent_ns and "INSPIRE_STANDALONE_TECHNIQUES" not in agent_ns, (
        "the kinds registry is the one list of which techniques group their records")
    assert (labels["global"], labels["other"], labels["no_group"], labels["separator"], labels["group_column"], labels["level_column"],
            labels["custom_level"], labels["all_level"]) == (
        agent_ns["INSPIRE_GROUP_GLOBAL"], agent_ns["INSPIRE_GROUP_OTHER"], agent_ns["INSPIRE_GROUP_NONE"], agent_ns["INSPIRE_GROUP_SEPARATOR"],
        agent_ns["INSPIRE_GROUP_COLUMN"], agent_ns["INSPIRE_GROUP_LEVEL_COLUMN"], agent_ns["INSPIRE_GROUP_CUSTOM"], agent_ns["INSPIRE_SETTING_ALL"])
    assert agent_ns["inspire_group_part"]("country", None) == labels["missing"].format(column="country")
    assert data["run_record"]["keys"] == list(agent_ns["INSPIRE_GROUP_RECORD_KEYS"])
    assert data["run_record"]["column"] in [name for name, _kind in agent_ns["INSPIRE_RUN_LOG_COLUMNS"]]


def test_the_technique_decides_where_grouping_applies(agent_ns):
    _text, data = _cases()
    for case in data["applies"]:
        assert agent_ns["inspire_grouping_applies"](case["technique"]) is case["applies"], case["technique"]
    assert any(c["applies"] for c in data["applies"]) and any(not c["applies"] for c in data["applies"])


def test_the_grouping_text_parses_coarse_to_fine_and_all_and_custom_stand_alone(agent_ns):
    _text, data = _cases()
    for case in data["parse"]:
        mode, picked = agent_ns["inspire_group_by_mode"](case["text"])
        assert mode == case["mode"], case["text"]
        assert agent_ns["inspire_group_by_columns"](case["text"]) == case["columns"], case["text"]


def test_the_recommended_columns_are_usable_and_nest_coarse_to_fine(agent_ns):
    _text, data = _cases()
    for case in data["recommend"]:
        assert agent_ns["inspire_group_recommendation"](case["columns"], [tuple(n) for n in case["nests"]]) == case["recommended"], case["name"]
    assert agent_ns["inspire_group_column_usable"]({"groups": 2, "records": 60})
    assert not agent_ns["inspire_group_column_usable"]({"groups": 2, "records": 59}), "an average group under 30 records is refused"
    assert not agent_ns["inspire_group_column_usable"]({"groups": 501, "records": 10 ** 6}), "more than 500 groups is refused"


def test_small_groups_move_up_a_level_exactly_as_the_shared_cases_say(agent_ns):
    _text, data = _cases()
    for case in data["effective"]:
        got = agent_ns["inspire_effective_groups"](case["group_by"], case["groups"], case["time_series"])
        assert got == case["expected"], case["name"]


def _frame(case):
    pd = pytest.importorskip("pandas")
    columns = _columns(case)
    rows = []
    for item in case["groups"]:
        lo, hi = item.get("periods") or (1, 1)
        span = list(range(lo, hi + 1))
        for at in range(item["records"]):
            rows.append(dict(zip(columns, item["path"]), day=span[at % len(span)], path=json.dumps(item["path"])))
    return pd.DataFrame(rows)


def _columns(case):
    return [part.strip() for part in case["group_by"].split(",")] if case["group_by"] != "all" else ["region", "country"]


def test_the_pandas_run_helper_gives_each_record_the_shared_cases_group_and_records_the_run(fresh_ns):
    _text, data = _cases()
    for case in data["effective"]:
        frame = _frame(case)
        printed = []
        out = fresh_ns["inspire_group_records"](frame, group_by=case["group_by"], time_column="day" if case["time_series"] else None,
                                                out=printed.append)
        assert len(out) == len(frame), "every record keeps its row"
        for expected in case["expected"]:
            picked = out[out["path"] == json.dumps(expected["path"])]
            got = picked[["inspire_group", "inspire_group_level"]].drop_duplicates().values.tolist()
            assert got == [[expected["group"], expected["level"]]], (case["name"], expected)
        record = fresh_ns["INSPIRE_RUN_GROUPING"]
        assert set(record) <= set(fresh_ns["INSPIRE_GROUP_RECORD_KEYS"]) and record["groups"] == len({x["group"] for x in case["expected"]})
        assert printed and printed[0].startswith("Data groups: ")


def test_the_run_record_of_all_is_one_global_group_and_a_grouping_hash_tells_groupings_apart(fresh_ns):
    pd = pytest.importorskip("pandas")
    frame = pd.DataFrame({"region": ["EMEA"] * 40 + ["AMER"] * 40, "sales": range(80)})
    printed = []
    out = fresh_ns["inspire_group_records"](frame, group_by="all", out=printed.append)
    record = fresh_ns["INSPIRE_RUN_GROUPING"]
    assert set(out["inspire_group"]) == {"Global"} and set(out["inspire_group_level"]) == {"all"}
    assert (record["mode"], record["group_by"], record["groups"]) == ("all", "all", 1)
    assert printed == ["Data groups: 1 group, Global, since Data groups is all"]
    fresh_ns["inspire_group_records"](frame, group_by="region", out=printed.append)
    by_region = fresh_ns["INSPIRE_RUN_GROUPING"]
    assert (by_region["mode"], by_region["group_by"], by_region["groups"]) == ("columns", ["region"], 2)
    assert by_region["hash"] != record["hash"] and len(by_region["hash"]) == 64
    fresh_ns["inspire_group_records"](frame, group_by=" REGION ", out=printed.append)
    assert fresh_ns["INSPIRE_RUN_GROUPING"]["hash"] == by_region["hash"], "the same grouping in other spelling has the same hash"
    assert fresh_ns["INSPIRE_RUN_GROUPING"]["group_by"] == ["region"], "the record names the records' own column"


def test_the_run_helper_reads_the_grouping_widget_when_it_is_not_passed(fresh_ns):
    pd = pytest.importorskip("pandas")
    frame = pd.DataFrame({"region": ["EMEA"] * 30 + ["AMER"] * 30})
    fresh_ns["INSPIRE_SETTINGS_APPLIED"] = {"group_by": "region"}
    out = fresh_ns["inspire_group_records"](frame, out=lambda *_a: None)
    assert sorted(set(out["inspire_group"])) == ["AMER", "EMEA"]
    fresh_ns["INSPIRE_SETTINGS_APPLIED"] = {"group_by": "all"}
    assert set(fresh_ns["inspire_group_records"](frame, out=lambda *_a: None)["inspire_group"]) == {"Global"}


def test_the_run_helper_refuses_a_column_the_records_lack_and_a_mixed_grouping(fresh_ns):
    pd = pytest.importorskip("pandas")
    frame = pd.DataFrame({"region": ["EMEA"] * 30})
    with pytest.raises(ValueError, match="have no column country"):
        fresh_ns["inspire_group_records"](frame, group_by="region, country", out=lambda *_a: None)
    with pytest.raises(fresh_ns["InspireRunStop"], match="all stands alone"):
        fresh_ns["inspire_group_records"](frame, group_by="region, all", out=lambda *_a: None)
    for asked, plain, groups in (("custom", "the Grouping all", {"Global"}), ("region, Custom", "the Grouping region", {"EMEA"})):
        said = []
        got = fresh_ns["inspire_group_records"](frame, group_by=asked, out=said.append)
        assert set(got["inspire_group"]) == groups
        assert fresh_ns["INSPIRE_CUSTOM_SQL_PLAIN"].format(part="Grouping", plain=plain) in said, said
        assert "build the MVP again" in said[0]
    with pytest.raises(TypeError):
        fresh_ns["inspire_group_records"]([1, 2], group_by="all", out=lambda *_a: None)
    assert not issubclass(fresh_ns["InspireRunStop"], Exception), "a broad except Exception in Genie's code cannot swallow the stop"


def test_each_run_records_its_grouping_and_a_new_run_starts_without_the_last_one(fresh_ns):
    pd = pytest.importorskip("pandas")
    fresh_ns["INSPIRE_RUN"] = {"source_tables": [ORDERS], "segments": []}
    fresh_ns["inspire_run_log_start"]("here", TABLE)
    assert "INSPIRE_RUN_GROUPING" not in fresh_ns
    frame = pd.DataFrame({"region": ["EMEA"] * 40 + ["AMER"] * 40 + ["APAC"] * 5})
    fresh_ns["inspire_group_records"](frame, group_by="region", out=lambda *_a: None)
    spark = _spark()
    fresh_ns["inspire_save_run_log"](spark, TABLE, "N01-U01", "r-9", lambda *_a: None)
    record = json.loads(_unquote(_merge_values(spark.statements[-1])["run_grouping"]))
    assert record == fresh_ns["INSPIRE_RUN_GROUPING"]
    assert (record["mode"], record["group_by"], record["groups"], record["minimum"]) == ("columns", ["region"], 3, 30)
    assert record["levels"] == [{"level": "region", "groups": 2, "records": 80}, {"level": "all", "groups": 1, "records": 5}]
    fresh_ns["inspire_run_log_start"]("here", TABLE)
    assert "INSPIRE_RUN_GROUPING" not in fresh_ns, "a later run in the same session never carries this run's grouping"


class _ServerlessSparkContext:
    def __getattr__(self, name):
        raise NotImplementedError("sc is not supported on serverless compute, consider using `spark` instead.")


def test_the_settings_read_check_never_touches_attributes_of_serverless_proxies_in_the_notebook(fresh_ns):
    scope = {"__name__": "__main__", "sc": _ServerlessSparkContext(), "group_by": "region"}
    exec(compile("def run_use_case():\n    return group_by\n", "cell", "exec"), scope)
    assert "group_by" in fresh_ns["inspire_read_names"](scope)
    run = {"settings_read": True, "settings": [{"name": "group_by", "kind": "choice", "many": True, "choices": ["region"]}]}
    assert fresh_ns["inspire_check_settings_read"](run, "build", scope=scope) == []
