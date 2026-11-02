import ast
import os
import re

import pytest

import _nbload

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SHELL_SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
COUNT_NAME = re.compile(r"^(?:n|k|count|counts|total|totals|num|n_\w+|num_\w+|\w+_count|\w+_counts|count_\w+|total_\w+|\w+_total|rows_written|"
                        r"rows|records|written|removed|deleted|inserted|updated|skipped|dropped_\w+|\w+_n|n\d?|kept_\w+|merged_\w+|"
                        r"attempts|rounds|max_attempts|max_\w+|min_\w+|batch_size|limit|cap|size|top_n|retries|tries|passed|failed_\w+|"
                        r"remaining|done|completed|matched|explained|flagged|missing_\w+|unassigned|unmapped|elapsed_\w+)$")
NOT_PLURAL = {"is", "was", "has", "does", "its", "this", "thus", "as", "us", "yes", "plus", "minus", "less", "unless", "across", "always",
              "perhaps", "whereas", "besides", "towards", "afterwards", "sometimes", "nevertheless", "series", "status", "analysis", "basis",
              "axis", "bias", "class", "pass", "process", "access", "success", "business", "address", "progress", "news", "focus", "bonus",
              "corpus", "alias", "canvas", "thesis", "crisis", "emphasis", "diagnosis", "synthesis", "species", "means", "aws", "ms", "vs", "os"}
STOP = {"of", "in", "to", "for", "on", "at", "by", "the", "a", "an", "and", "or", "with", "from", "into", "per", "than", "out", "is", "are",
        "was", "were", "has", "have", "not", "no", "over", "under", "after", "before", "more", "fewer", "less", "most", "all", "any", "each",
        "every", "if", "so", "as", "that", "which", "who", "it", "its", "their", "this", "these", "those", "be", "been", "being", "can",
        "could", "will", "would", "should", "may", "might", "must", "do", "did", "does", "then", "when", "while", "where", "how", "what"}
PHRASE = re.compile(r"^ ((?:[A-Za-z][\w/-]*[^\Ws] ){0,2})([A-Za-z][A-Za-z/-]*s)(?![\w=(])")
TEMPLATE_SLOT = re.compile(r"@@\w+@@")


def _count_expression(node):
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in ("len", "sum", "int"):
        return True
    if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub)):
        return _count_expression(node.left) or _count_expression(node.right)
    name = None
    if isinstance(node, ast.Name):
        name = node.id
    elif isinstance(node, ast.Attribute):
        name = node.attr
    elif isinstance(node, ast.Subscript) and isinstance(node.slice, ast.Constant) and isinstance(node.slice.value, str):
        name = node.slice.value
    elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "get" and node.args \
            and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str):
        name = node.args[0].value
    return bool(name and COUNT_NAME.match(name))


def _float_spec(value):
    if value.format_spec is None:
        return False
    return bool(re.search(r"[efg%]", "".join(v.value for v in value.format_spec.values if isinstance(v, ast.Constant))))


def _embedded(text):
    if "\n" not in text or not ("def " in text or "import " in text):
        return None
    try:
        return ast.parse(TEMPLATE_SLOT.sub("None", text))
    except SyntaxError:
        return None


def count_nouns(source, origin):
    found = []

    def walk(tree, where):
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                inner = _embedded(node.value)
                if inner is not None:
                    walk(inner, f"{where}, embedded source at line {node.lineno}")
                continue
            if not isinstance(node, ast.JoinedStr):
                continue
            for part, after in zip(node.values, node.values[1:]):
                if not (isinstance(part, ast.FormattedValue) and isinstance(after, ast.Constant) and isinstance(after.value, str)):
                    continue
                if _float_spec(part) or not _count_expression(part.value):
                    continue
                match = PHRASE.match(after.value)
                if not match:
                    continue
                lead, noun = match.group(1).split(), match.group(2)
                if noun.lower() in NOT_PLURAL or noun.lower().endswith(("ss", "us", "is")) or any(w.lower() in STOP for w in lead):
                    continue
                found.append(f"{where} line {node.lineno}: {{{ast.unparse(part.value)}}} {match.group(0).strip()!r}")

    walk(ast.parse(source), origin)
    return found


def test_no_count_the_notebook_writes_is_followed_by_a_plural_noun_it_does_not_choose():
    found = []
    for index, source in enumerate(_nbload.code_cells()):
        found += count_nouns(source, f"code cell {index}")
    assert found == [], "a count that can be 1 names its noun through inspire_plural or a sentence with no count noun:\n" + "\n".join(found)


def test_no_app_shell_server_count_is_followed_by_a_plural_noun_it_does_not_choose():
    found = []
    for name in sorted(os.listdir(SHELL_SERVER)):
        if name.endswith(".py"):
            found += count_nouns(open(os.path.join(SHELL_SERVER, name), encoding="utf-8").read(), name)
    assert found == [], "\n".join(found)


@pytest.mark.parametrize("planted", [
    'logger.info(f"Created {total_domains} domains")',
    'out(f"read {len(tables)} tables")',
    'x = f"{n} use cases"',
    'x = f"{counts[\'rows\']} rows were written"',
    'x = f"{row.get(\'records\')} records"',
    'x = f"{len(a) + len(b)} columns"',
    'SOURCE = r"""\nimport json\n\ndef f(rows):\n    return f"{rows} rows"\n"""',
])
def test_the_scan_catches_a_count_with_a_plural_noun_it_does_not_choose(planted):
    assert len(count_nouns(planted, "planted")) == 1, planted


@pytest.mark.parametrize("clean", [
    'x = f"{inspire_plural(len(tables), \'table\')} read"',
    'x = f"{elapsed:.1f} seconds"',
    'x = f"{ratio:.0%} rows"',
    'x = f"profiles={n} join_checks={m}"',
    'x = f"{n} is above the cap"',
    'x = f"{len(tables)} of the rows"',
    'x = f"{name} tables"',
    'x = f"tables: {len(tables):,}"',
])
def test_the_scan_leaves_chosen_nouns_floats_keys_and_non_counts_alone(clean):
    assert count_nouns(clean, "clean") == []
