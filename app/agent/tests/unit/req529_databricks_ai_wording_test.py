"""REQ-529: every text a person reads says "Databricks AI", never "Genie Code" (any case, space or hyphen).
Code identifiers keep their names (genie_code, GENIE_CODE_*, genie-code-cli, genie-code-relay, [GENIE-CODE-MODEL ...])."""
import json
import os
import re
from pathlib import Path

AGENT = Path(__file__).resolve().parents[2]
APP = AGENT.parent
NOTEBOOK = AGENT / "agent" / "dbx_inspire_ai_agent.ipynb"
APP_NOTEBOOK = APP / "dbx_inspire_ai_agent.ipynb"
SELF = Path(__file__).resolve()
# Released notebooks kept as historical regression references; they are never shipped to users.
SKIP_DIRS = {"__pycache__", ".pytest_cache", "reference"}
VISIBLE = re.compile(r"genie[ -]code", re.I)
IDENTIFIER_HYPHEN = re.compile(r"genie-code-(?:cli|relay|model)", re.I)


def _files():
    for root, dirs, names in os.walk(AGENT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in names:
            path = Path(root) / name
            if path != SELF:
                yield path
    yield APP_NOTEBOOK


def _visible_hits(text):
    hits = []
    for match in VISIBLE.finditer(text):
        tail = text[match.start():match.end() + 8]
        if IDENTIFIER_HYPHEN.match(tail):
            continue
        hits.append(text[max(0, match.start() - 30):match.end() + 30].replace("\n", " "))
    return hits


def test_no_visible_genie_code_wording_in_agent_files():
    found = {}
    for path in _files():
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        hits = _visible_hits(text)
        if hits:
            found[str(path.relative_to(APP))] = (len(hits), hits[0])
    assert not found, f"{len(found)} files still say Genie Code: " + "; ".join(f"{k} x{v[0]} ({v[1]!r})" for k, v in list(found.items())[:8])


def test_code_identifiers_keep_their_names():
    notebook = NOTEBOOK.read_text(encoding="utf-8")
    for identifier in ("GENIE_CODE_CLI_VERSION", "GENIE_CODE_ROUTE", "GENIE_CODE_CHECK_STEP", "generate_genie_code_instruction",
                       "genie-code-cli", "genie-code-relay", "GENIE-CODE-MODEL"):
        assert identifier in notebook, identifier
    translations = (AGENT / "agent" / "app_shell" / "translations.json").read_text(encoding="utf-8")
    assert "doc_has_genie_code" in translations
    assert NOTEBOOK.read_bytes() == APP_NOTEBOOK.read_bytes()


def test_brand_name_is_kept_in_every_translation():
    translations = json.loads((AGENT / "agent" / "app_shell" / "translations.json").read_text(encoding="utf-8"))
    assert "Databricks AI" in json.dumps(translations, ensure_ascii=False)
