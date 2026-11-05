import ast
import os
import re

import pytest

import _nbload
from v142_genie_test import _grounding, _rich_space

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SHELL_SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
PLURAL_VERBS = {"are", "were", "have", "do", "need", "hold", "carry", "share", "lack", "name", "reference", "match", "go", "ship", "stay",
                "remain", "exist", "contain", "cite", "follow", "appear", "exceed", "use", "state", "word", "keep", "show", "get", "come",
                "read", "write", "say", "mean", "seem", "belong", "pass", "fail", "wait", "cover", "look", "take", "make", "give", "differ",
                "point", "start", "sit", "lie", "depend", "require", "include", "miss", "break", "win", "offer", "fit", "slice", "join",
                "land", "trigger", "reach", "sort", "count", "beat", "change", "own", "want", "ask", "describe", "move", "drop"}
SINGULAR_VERBS = {"is", "was", "has", "does", "needs", "holds", "carries", "shares", "lacks", "names", "references", "matches", "goes",
                  "ships", "stays", "remains", "exists", "contains", "cites", "follows", "appears", "exceeds", "uses", "states", "words",
                  "keeps", "shows", "gets", "comes", "reads", "writes", "says", "means", "seems", "belongs", "passes", "fails", "waits",
                  "covers", "looks", "takes", "makes", "gives", "differs", "points", "starts", "sits", "lies", "depends", "requires",
                  "includes", "misses", "breaks", "wins", "offers", "fits", "slices", "joins", "lands", "triggers", "reaches", "sorts",
                  "counts", "beats", "changes", "owns", "wants", "asks", "describes", "moves", "drops"}
PLURAL_PRONOUNS = {"they", "them", "their", "themselves"}
SINGULAR_PRONOUNS = {"it", "its", "itself"}
SUBJECT_AFTER = {"", "and", "but", "so", "because", "while", "then", "when", "since", "that", "which", "where", "if", "as", "only",
                 ";", ":", ",", "]", "[", "!", "?"}
PREPOSITION = {"of", "in", "under", "from", "for", "with", "at", "on", "across", "over", "into", "to", "by", "per", "among", "within"}
ADVERBS = {"still", "also", "now", "already", "never"}
PLURAL_CALLS = {"inspire_plural", "plural"}
TEMPLATE_SLOT = re.compile(r"@@\w+@@")
COUNTS = (0, 1, 2)


def _plural_call(node):
    if not isinstance(node, ast.Call) or len(node.args) < 2:
        return None
    name = node.func.id if isinstance(node.func, ast.Name) else node.func.attr if isinstance(node.func, ast.Attribute) else ""
    texts = [a.value for a in node.args[1:3] if isinstance(a, ast.Constant) and isinstance(a.value, str)]
    if name not in PLURAL_CALLS or len(texts) != len(node.args[1:3]):
        return None
    return texts[0], (texts[1] if len(texts) > 1 and texts[1] else texts[0] + "s")


def _render(node, target, count):
    out = []
    for part in node.values:
        if isinstance(part, ast.Constant):
            out.append(str(part.value))
        elif part is target:
            one, many = _plural_call(part.value)
            out.append("\x00" + f"{count} {one if count == 1 else many}" + "\x01")
        else:
            found = _plural_call(part.value) if isinstance(part, ast.FormattedValue) else None
            out.append(f"2 {found[1]}" if found else "X")
    return "".join(out)


def _words(text):
    return re.findall(r"[A-Za-z']+|[;:.,()\[\]!?]", text)


def _until(words, stops):
    out = []
    for word in words:
        if word in stops:
            break
        out.append(word.lower())
    return out


def _problems(text, count):
    before, rest = text.split("\x00", 1)
    phrase, after = rest.split("\x01", 1)
    lead = _words(before)
    subject = (lead[-1].lower() if lead else "") in SUBJECT_AFTER
    clause = _until(_words(after), {";", ":", ".", "(", ")", "!", "?"})
    while clause and clause[0] in ADVERBS:
        clause = clause[1:]
    found = []
    if subject and not {w.lower() for w in _words(phrase)} & (PLURAL_VERBS | SINGULAR_VERBS):
        index = 0
        if clause and clause[0] in PREPOSITION:
            index = 1
            while index < len(clause) and index < 5 and clause[index] not in PLURAL_VERBS | SINGULAR_VERBS:
                index += 1
        verb = clause[index] if index < len(clause) else ""
        if verb == "use" and index + 1 < len(clause) and clause[index + 1] in ("case", "cases"):
            verb = ""
        if (count == 1 and verb in PLURAL_VERBS) or (count != 1 and verb in SINGULAR_VERBS):
            found.append(f"verb '{verb}'")
    sentence = set(_until(_words(after), {".", "!", "?"}))
    near = set(_until(_words(after), {";", ":", ".", "(", ")", ",", "!", "?"}))
    if count == 1 and sentence & PLURAL_PRONOUNS:
        found.append(f"pronoun {sorted(sentence & PLURAL_PRONOUNS)}")
    if count != 1 and subject and near & SINGULAR_PRONOUNS:
        found.append(f"pronoun {sorted(near & SINGULAR_PRONOUNS)}")
    return found


def disagreements(source, origin):
    found = []

    def walk(tree, where):
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and isinstance(node.value, str) and "\n" in node.value \
                    and ("def " in node.value or "import " in node.value):
                try:
                    walk(ast.parse(TEMPLATE_SLOT.sub("None", node.value)), f"{where}, embedded source at line {node.lineno}")
                except SyntaxError:
                    pass
                continue
            if not isinstance(node, ast.JoinedStr):
                continue
            for part in node.values:
                if isinstance(part, ast.FormattedValue) and _plural_call(part.value):
                    for count in COUNTS:
                        text = _render(node, part, count)
                        found.extend(f"{where} line {node.lineno} n={count} {problem}: "
                                     f"{text.replace(chr(0), '[').replace(chr(1), ']')[:200]}" for problem in _problems(text, count))

    walk(ast.parse(source), origin)
    return found


def test_every_plural_sentence_the_notebook_writes_agrees_at_zero_one_and_two():
    found = []
    for index, source in enumerate(_nbload.code_cells()):
        found += disagreements(source, f"code cell {index}")
    assert found == [], "\n".join(found)


def test_every_plural_sentence_the_app_shell_server_writes_agrees_at_zero_one_and_two():
    found = []
    for name in sorted(os.listdir(SHELL_SERVER)):
        if name.endswith(".py"):
            found += disagreements(open(os.path.join(SHELL_SERVER, name), encoding="utf-8").read(), name)
    assert found == [], "\n".join(found)


@pytest.mark.parametrize("planted,count", [
    ('x = f"{inspire_plural(n, \'row\')} have no as_of_date"', 1),
    ('x = f"{inspire_plural(n, \'row\')} has no as_of_date"', 2),
    ('x = f"Inspire paused {inspire_plural(n, \'alert\')} people set up; turn alerts on again to resume them"', 1),
    ('x = f"{flagged} of the {inspire_plural(n, \'record\')} failed, so they are flagged"', 1),
    ('x = f"{inspire_plural(n, \'UC\')} reference unknown tables"', 1),
    ('x = f"{inspire_plural(n, \'table\')} exceeds the cap so it is skipped"', 2),
    ('x = f"[TAG] {inspire_plural(n, \'row\')} of run {r} carry a foreign id"', 1),
])
def test_the_agreement_check_catches_a_sentence_that_reads_wrong_at_some_count(planted, count):
    found = disagreements(planted, "planted")
    assert any(f"n={count}" in line for line in found), found


@pytest.mark.parametrize("clean", [
    'x = f"{inspire_plural(n, \'row has\', \'rows have\')} no as_of_date"',
    'x = f"of the {inspire_plural(n, \'row\')} of run {r}, {inspire_plural(m, \'has\', \'have\')} no as_of_date"',
    'x = f"turn alerts on again to resume {\'it\' if n == 1 else \'them\'} after pausing {inspire_plural(n, \'alert\')}"',
    'x = f"Genie {g} gained {inspire_plural(n, \'sample question\')}; it holds 3 tables"',
    'x = f"the table ({inspire_plural(n, \'column\')}) exceeds the budget on its own"',
    'x = f"read {inspire_plural(n, \'table\')} in the latest run"',
])
def test_the_agreement_check_leaves_sentences_that_read_right_at_every_count(clean):
    assert disagreements(clean, "clean") == []


@pytest.mark.parametrize("n,one,many,expected", [(0, "row", None, "0 rows"), (1, "row", None, "1 row"), (2, "row", None, "2 rows"),
                                                 (0, "row has", "rows have", "0 rows have"), (1, "row has", "rows have", "1 row has"),
                                                 (2, "row has", "rows have", "2 rows have"), (None, "row", None, "an unknown number of rows")])
def test_the_plural_helper_at_zero_one_and_two(agent_ns, n, one, many, expected):
    assert agent_ns["inspire_plural"](n, one, many) == expected


@pytest.mark.parametrize("n,expected", [(0, "0 rows"), (1, "1 row"), (2, "2 rows"), (100001, "100,001 rows")])
def test_the_app_shell_plural_helper_at_zero_one_and_two(n, expected, monkeypatch):
    import importlib.util
    monkeypatch.syspath_prepend(SHELL_SERVER)
    spec = importlib.util.spec_from_file_location("v168_shell_sql", os.path.join(SHELL_SERVER, "shell_sql.py"))
    shell_sql = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(shell_sql)
    assert shell_sql.plural(n, "row") == expected and shell_sql.plural(n, "record shares", "records share").endswith(
        "record shares" if n == 1 else "records share")


@pytest.mark.parametrize("flagged,missing,expected", [
    (1, 0, "1 of the 12 records flagged 'Act now' or 'Review' with facts failed Inspire's AI checks after one repair round, so it is flagged "
           "in ai_check and shows no AI reasoning"),
    (2, 0, "2 of the 12 records flagged 'Act now' or 'Review' with facts failed Inspire's AI checks after one repair round, so they are "
           "flagged in ai_check and show no AI reasoning"),
    (0, 1, "1 record flagged 'Act now' or 'Review' with facts holds neither AI reasoning nor a flag"),
    (0, 2, "2 records flagged 'Act now' or 'Review' with facts hold neither AI reasoning nor a flag")])
def test_the_ai_check_problems_agree_with_one_and_two_records(agent_ns, flagged, missing, expected):
    checks = {"records": 12, "flagged": flagged, "missing": missing, "kinds": {}}
    assert agent_ns["implement_ai_check_problems"](checks, "Six records need action.")[0] == expected


@pytest.mark.parametrize("dated,expected", [
    (11, "of the 12 rows of run r-1, 1 has no as_of_date, so the change history cannot say which run date such a row belongs to"),
    (10, "of the 12 rows of run r-1, 2 have no as_of_date, so the change history cannot say which run date such a row belongs to")])
def test_the_written_key_problems_agree_with_one_and_two_rows(agent_ns, dated, expected):
    problems = agent_ns["implement_written_key_problems"]({"rows_written": 12, "as_of_date": "2026-10-01", "run_id": "r-1"}, "N01-U01",
                                                          {"row_count": 12, "dated_rows": dated, "own_rows": 12, "current_rows": 12},
                                                          "main.inspire.churn_out")
    assert [p for p in problems if p.startswith(expected)], problems


@pytest.mark.parametrize("names,expected", [
    (["Region"], "the one filter of the version before is still on the built App page p: Region"),
    (["Region", "Channel"], "each of the 2 filters of the version before is still on the built App page p: Channel; Region")])
def test_keeping_every_part_names_one_part_and_two_parts_the_way_each_reads(agent_ns, names, expected):
    seen = {"f": {"kind": "filter", "lines": names}}
    assert agent_ns["implement_vibes_every_kept"]("filter", seen, seen, "App page p") == ("done", expected)


@pytest.mark.parametrize("count,expected", [(1, "1 row has a value_at_stake below 0"), (2, "2 rows have a value_at_stake below 0")])
def test_the_run_problems_agree_with_one_and_two_rows(agent_ns, count, expected):
    assert any(p.startswith(expected) for p in agent_ns["inspire_run_problems"]({"negative_stake": count, "use_cases": 1, "runs": 1}))


@pytest.mark.parametrize("questions,expected", [
    (["Who left last month?"], "the sample question 'Who left last month?' has no example SQL"),
    (["Who left last month?", "Who joined last month?"], "the sample questions 'Who left last month?', 'Who joined last month?' have no example SQL")])
def test_the_genie_sample_question_problem_agrees_with_one_and_two_questions(agent_ns, questions, expected):
    raw = _rich_space()
    for index, question in enumerate(questions):
        raw["config"]["sample_questions"].append({"id": str(index) * 32, "question": [question]})
    _space, problems = _grounding(agent_ns, raw)
    assert any(p.startswith(expected) for p in problems), problems
