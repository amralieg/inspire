"""REQ-150: the build grants the MVP App's principal USE CATALOG, USE SCHEMA and SELECT on each scope view it reads, in that order."""
import json
from pathlib import Path

NOTEBOOK = Path(__file__).resolve().parents[2] / "agent" / "dbx_inspire_ai_agent.ipynb"
LOOP = 'for scope_view in create_scope_views(self.spark, self._genie_scopes(context["use_case"])):'


def _loop_source():
    cells = json.loads(NOTEBOOK.read_text(encoding="utf-8"))["cells"]
    sources = [("".join(c["source"])) for c in cells if c["cell_type"] == "code"]
    hits = [s for s in sources if LOOP in s]
    assert len(hits) == 1, f"expected one scope-view grant loop, found {len(hits)}"
    text = hits[0]
    start = text.index(LOOP)
    return text[start:text.index('if context.get("reasons_view")', start)]


def test_scope_view_grant_gives_use_catalog_then_use_schema_then_select_on_the_view_only():
    body = _loop_source()
    use_catalog = body.index('GRANT USE CATALOG ON CATALOG {parts[0]} TO {principal}')
    use_schema = body.index('GRANT USE SCHEMA ON SCHEMA {parts[0]}.{parts[1]} TO {principal}')
    select = body.index("GRANT SELECT ON TABLE {'.'.join(parts)} TO {principal}")
    assert use_catalog < use_schema < select, "USE CATALOG, then USE SCHEMA, then SELECT on the scope view"
    assert "scope_view" in body and "GRANT SELECT ON TABLE" in body
    assert "base" not in body.lower(), "the scope loop never grants on the unfiltered base table"


def test_a_denied_scope_view_select_is_reported_once_with_its_exact_statement_and_a_held_use_grant_is_not_a_failure():
    body = _loop_source()
    assert "denied_scope.append(select)" in body, "the failed SELECT is collected"
    assert body.count("denied_scope.append(select)") == 1
    assert "warnings.append(" in body and '"; ".join(dict.fromkeys(denied_scope))' in body, "one warning lists each denied statement once"
    use_catalog_block = body[body.index("for statement in (use_catalog, use_schema):"):body.index("try:\n                        self.spark.sql(select)")]
    assert "denied_scope.append" not in use_catalog_block, "a USE grant that fails is never a failure: the SELECT decides"
