import ast
import os
import re

import pytest

import _nbload

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SHELL = os.path.join(ROOT, "agent", "app_shell")
MAYBE_PLURAL = re.compile(r"[A-Za-z]\\?\((?:s|es|ies)\\?\)")
SLOT_PLURAL = re.compile(r"\((?:s|es|ies)\)(?![\w(])")
RELEASED_FORMS = {r"rows?|row\(s\)": "released main 4407364 text"}
WEB_MAYBE_PLURAL = re.compile(r"(?<![\w.$])[a-z]{2,}\((?:s|es|ies)\)(?= [a-z])")
TEMPLATE_SLOT = re.compile(r"@@\w+@@")


def _embedded_source(text):
    if "\n" not in text or not ("def " in text or "import " in text):
        return None
    try:
        return ast.parse(TEMPLATE_SLOT.sub("None", text))
    except SyntaxError:
        return None


def maybe_plurals(source, origin, used=None):
    found = []

    def walk(tree, where):
        for node in ast.walk(tree):
            if isinstance(node, ast.JoinedStr):
                for slot, part in zip(node.values, node.values[1:]):
                    if isinstance(slot, ast.FormattedValue) and isinstance(part, ast.Constant) and SLOT_PLURAL.match(str(part.value)):
                        found.append(f"{where} line {node.lineno}: {{{ast.unparse(slot.value)}}}{SLOT_PLURAL.match(part.value).group(0)}")
                continue
            if not (isinstance(node, ast.Constant) and isinstance(node.value, str)):
                continue
            inner = _embedded_source(node.value)
            if inner is not None:
                walk(inner, f"{where}, embedded source at line {node.lineno}")
                continue
            text = node.value
            for form in RELEASED_FORMS:
                if form in text and used is not None:
                    used[form] = used.get(form, 0) + text.count(form)
                    text = text.replace(form, "")
            if MAYBE_PLURAL.search(text):
                found.append(f"{where} line {node.lineno}: {MAYBE_PLURAL.search(text).group(0)} in {node.value[:120]!r}")

    walk(ast.parse(source), origin)
    return found


def web_maybe_plurals(text, origin):
    return [f"{origin}: {m.group(0)}" for m in WEB_MAYBE_PLURAL.finditer(text)]


def test_no_string_the_notebook_writes_hedges_a_plural_with_s_in_brackets():
    found, used = [], {}
    for index, source in enumerate(_nbload.code_cells()):
        found += maybe_plurals(source, f"code cell {index}", used)
    assert found == [], "every count names its noun through inspire_plural or a count-free sentence:\n" + "\n".join(found)
    assert used == {form: 1 for form in RELEASED_FORMS}, \
        "each released form is read in exactly one place, the outcome a notebook released main 4407364 built prints"
    assert set(RELEASED_FORMS.values()) == {"released main 4407364 text"}


def test_no_app_shell_server_string_hedges_a_plural_with_s_in_brackets():
    files = sorted(os.path.join(folder, name) for folder, _dirs, names in os.walk(SHELL) for name in names
                   if name.endswith(".py") and "node_modules" not in folder and "__pycache__" not in folder)
    assert len(files) >= 7, files
    found = []
    for path in files:
        found += maybe_plurals(open(path, encoding="utf-8").read(), os.path.relpath(path, ROOT))
    assert found == [], "\n".join(found)


def test_no_app_shell_web_text_hedges_a_plural_with_s_in_brackets():
    source = os.path.join(SHELL, "web", "src")
    files = sorted(os.path.join(folder, name) for folder, _dirs, names in os.walk(source) for name in names
                   if name.endswith((".js", ".jsx")))
    assert len(files) >= 20, files
    found = []
    for path in files:
        found += web_maybe_plurals(open(path, encoding="utf-8").read(), os.path.relpath(path, ROOT))
    assert found == [], "the App shell writes counts with plural() from hub.js:\n" + "\n".join(found)


@pytest.mark.parametrize("planted", [
    'logger.info(f"{n} table(s) could not be loaded")',
    'problems.append(f"{n} row(s) have no as_of_date")',
    'RULE = "History holds {observed} past example(s) of the outcome"',
    'BATCHES = f"{n} batch(es) done"',
    'SOURCE = r"""\nimport json\n\ndef f(n):\n    return f"{n} item(s)"\n"""',
    'TEMPLATE = """\n@@RUN@@\nimport json\nout(f"wrote {n} row(s)")\n"""',
    'PATTERN = re.compile(r"read (\\d+) item\\(s\\) from")',
    'PATTERN = re.compile(r"wrote (\\d+) row\\(s\\) for")',
    'TEXT = "wrote 3 row(s) for as_of_date"',
    'logger.error(f"{len(errors)} {task_name}(s) failed")',
    'TEXT = f"each of the {len(before)} {noun}(s) of the version before"',
])
def test_the_scan_catches_a_hedged_plural_wherever_it_is_written(planted):
    assert len(maybe_plurals(planted, "planted", {})) == 1, planted


def test_the_released_form_is_allowed_only_as_the_whole_released_pattern():
    used = {}
    assert maybe_plurals('PATTERN = re.compile(r"wrote (\\d+) (?:rows?|row\\(s\\)) for as_of_date")', "released", used) == []
    assert used == {r"rows?|row\(s\)": 1}
    assert len(maybe_plurals('PATTERN = re.compile(r"wrote (\\d+) (?:rows?|row\\(s\\)|item\\(s\\)) for")', "planted", {})) == 1


@pytest.mark.parametrize("clean", [
    'SOURCE = r"""\nimport json\n\ndef f(s):\n    return [g(s) for s in s]\n"""',
    'logger.info(f"{inspire_plural(n, \'table\')} could not be loaded")',
    'TEXT = "(see the rows above)"',
    'TEXT = f"{inspire_plural(len(before), noun)} of the version before"',
    'TEXT = f"{name}(sample) ran"',
])
def test_the_scan_leaves_code_and_real_plurals_alone(clean):
    assert maybe_plurals(clean, "clean") == []


def test_the_web_scan_catches_prose_and_leaves_calls_alone():
    assert web_maybe_plurals("<p>{listing.unread} alert(s) could not be read just now.</p>", "x") == ["x: alert(s)"]
    assert web_maybe_plurals("rows.map((s) => keyOf(s)).filter((s) => trim(s) && s); x.trim(s) is", "x") == []
