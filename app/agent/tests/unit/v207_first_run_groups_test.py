SIZES = [{"value": v, "records": n} for v, n in (("Ginger", 586), ("Oatmeal", 571), ("Pecan", 560), ("Mint", 549), ("Lemon", 540), ("Cocoa", 527))]


def test_a_small_table_with_groups_of_about_550_runs_first_on_three_whole_groups_never_one(agent_ns):
    picked = agent_ns["inspire_whole_groups"](SIZES, "1000")
    assert [g["value"] for g in picked] == ["Ginger", "Pecan", "Cocoa"]
    assert len(picked) != 1, "one product is never the whole first run when three fit (must-exclude)"
    assert agent_ns["INSPIRE_WHOLE_GROUPS_MIN"] == 3
    assert [g["value"] for g in agent_ns["inspire_whole_groups"]([{"value": "A", "records": 900}, {"value": "B", "records": 5000}], "1000")] == ["A"]


def test_the_scope_text_names_the_real_count_of_several_groups_and_never_calls_them_the_smallest_group(agent_ns):
    chosen = {"scope": "records", "table": "main.sales.tx", "records": 1000, "column": "product", "whole_groups": True,
              "values": ["Ginger", "Pecan", "Cocoa"], "group_records": {"Ginger": 586, "Pecan": 560, "Cocoa": 527}}
    said = agent_ns["inspire_scope_text"](chosen)
    assert said == ("1,673 records of main.sales.tx, in 3 whole groups, so the first run sees more than one group and no group is cut: "
                    "product = Ginger, 586 records; product = Pecan, 560 records; product = Cocoa, 527 records")
    assert "smallest whole group" not in said
    one = dict(chosen, values=["Big"], group_records={"Big": 4000})
    assert "in the smallest whole group" in agent_ns["inspire_scope_text"](one)
