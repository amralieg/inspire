"""REQ-531 / REQ-532 (server): the 'compared to the rest' line knows which way is better, and a money label follows the sign.
A rank column counts from 1 = best, so rank 2 of 6 is a good place and never 'sigma' of a rank; a variance is a gain when
positive and a loss (at risk) when negative, and only a saving is something a run 'could save'."""
import copy

from v141_app_shell_test import PAGE, shell  # noqa: F401  (loads the shell module path)
import shell_core

# 6 records with ranks 1..6: the record on rank 2 has 1 record better (1 below in value) and 4 worse (4 above in value).
RANK_STATS = {"n": 6, "mean": 3.5, "sd": 1.87, "above": 4, "below": 1, "flagged": 6}
SCORE_STATS = {"n": 212, "mean": 1.0, "sd": 0.9, "above": 0, "below": 211, "flagged": 212}


def test_a_lower_is_better_rank_2_of_6_reads_rank_2_above_normal_and_never_quotes_sigma():
    out = shell_core.population_summary(2, RANK_STATS, label="Rank", direction="lower")
    assert "sigma" not in out["text"] and "z-score" not in out["text"]
    assert "above normal" in out["text"] and "It ranks 2 of 6" in out["text"]
    c = out["compared"]
    assert (c["x"], c["rank"], c["n"], c["direction"], c["flagged"]) == (2, 2, 6, "lower", 6)
    assert c["mean"] == 3.5 and c["sd"] == 1.87 and c["band"] == [3.5 - 1.87, 3.5 + 1.87]
    assert c["status"] == "above normal" and isinstance(c["points"], list) and c["points"]


def test_a_lower_is_better_rank_6_of_6_reads_below_normal():
    stats = dict(RANK_STATS, above=0, below=5)
    out = shell_core.population_summary(6, stats, label="Rank", direction="lower")
    assert out["compared"]["rank"] == 6 and out["compared"]["status"] == "below normal" and "below normal" in out["text"]


def test_a_higher_is_better_score_keeps_its_sentence_and_gains_a_structured_compared():
    out = shell_core.population_summary(4.79, SCORE_STATS, label="Exception score")
    assert "4.21 sigma above the average of 1" in out["text"] and "It ranks 1 of 212" in out["text"]
    c = out["compared"]
    assert (c["x"], c["rank"], c["n"], c["direction"], c["status"]) == (4.79, 1, 212, "higher", "above normal")


def test_population_of_reads_a_rank_role_column_as_lower_is_better_and_a_score_as_higher():
    page = dict(copy.deepcopy(PAGE), result_table="cat.sch.tbl")
    page["records"] = dict(page.get("records") or {}, rank="rank", tier="priority_tier", reasons="", columns=[])

    class Rows:
        def __init__(self):
            self.n = 0

        def __call__(self, ws, sql, params, limit, delta=False, **_):
            self.n += 1
            return {"rows": [{"record_key": "R1", "rank": 2, "priority_tier": "Monitor"}] if self.n == 1 else [RANK_STATS]}

    s = shell_core.Shell.__new__(shell_core.Shell)
    s.execute = Rows()
    out = shell_core.Shell.population_of(s, object(), page, "R1")
    assert out["compared"]["direction"] == "lower" and out["compared"]["rank"] == 2 and "sigma" not in out["text"]


def test_a_positive_variance_is_a_gain_a_negative_one_a_loss_and_only_a_saving_could_be_saved():
    pearly = shell_core.money_words(1932, kind="variance")  # price 0, volume +1,932, mix 0
    assert (pearly["kind"], pearly["label"], pearly["could_save"]) == ("gain", "Gain", None)
    loss = shell_core.money_words(-250, kind="variance")
    assert (loss["kind"], loss["label"], loss["could_save"]) == ("loss", "Loss (at risk)", None)
    saving = shell_core.money_words(1932, kind="saving")
    assert (saving["kind"], saving["label"], saving["could_save"]) == ("saving", "Could save", 1932)
    assert shell_core.money_words(0, kind="variance")["label"] == ""
    assert shell_core.money_words(float("nan"), kind="saving")["could_save"] is None


def test_a_run_on_a_gains_money_rule_does_not_say_it_could_save_the_amount():
    page = dict(copy.deepcopy(PAGE), money={"rule": "gains"})
    view = shell_core.run_view(shell_core.blank_run("u1"), {"value_at_stake": 1932}, page)
    assert view["could_save"] is None
