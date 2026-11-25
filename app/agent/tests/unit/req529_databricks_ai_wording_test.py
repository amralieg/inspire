"""REQ-529: every text a person reads says "Databricks AI", never "Genie Code" (any case, space or hyphen).
Code identifiers keep their names (genie_code, GENIE_CODE_*, genie-code-cli, genie-code-relay, [GENIE-CODE-MODEL ...])."""
import json
import os
import re
from pathlib import Path

AGENT = Path(__file__).resolve().parents[2]
APP = AGENT.parent
NOTEBOOK = AGENT / "agent" / "dbx_inspire_ai_agent.ipynb"
SELF = Path(__file__).resolve()
# Released notebooks kept as historical regression references; they are never shipped to users.
SKIP_DIRS = {"__pycache__", ".pytest_cache", "reference"}
VISIBLE = re.compile(r"genie[ -]code", re.I)
IDENTIFIER_HYPHEN = re.compile(r"genie-code-(?:cli|relay|model)", re.I)
# The step id the Implement progress events carry; the App matches it, people read its label instead.
STEP_ID = re.compile(r'_implement_emit\(uc_id, \\?"$')


def _files():
    for root, dirs, names in os.walk(AGENT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in names:
            path = Path(root) / name
            if path != SELF:
                yield path
    # app/dbx_inspire_ai_agent.ipynb is a generated copy (app/scripts/bundle-agent-notebook.mjs); the source above is swept.


def _visible_hits(text):
    hits = []
    for match in VISIBLE.finditer(text):
        tail = text[match.start():match.end() + 8]
        if IDENTIFIER_HYPHEN.match(tail) or STEP_ID.search(text[max(0, match.start() - 40):match.start()]):
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


def test_brand_name_is_kept_untranslated_in_every_language():
    translations = json.loads((AGENT / "agent" / "app_shell" / "translations.json").read_text(encoding="utf-8"))
    transliterations = ("جيني كود", "吉尼 科德", "ジーニー コード", "지니 코드", "जीनी कोड", "Джини Код", "Джіні Код")
    keys = ("main_title", "pdf_title", "pptx_main_title", "doc_method_5", "doc_gl_notebook", "doc_step_build", "doc_has_genie_code")
    assert len(translations) == 22
    for language, words in translations.items():
        for key in keys:
            assert "Databricks AI" in words[key], (language, key)
        for value in words.values():
            assert not any(name in value for name in transliterations), (language, value)
