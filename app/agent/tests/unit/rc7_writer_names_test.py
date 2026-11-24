"""Every catalogue writer (CSV, Markdown) puts a renamed use case's name into the file it uploads.

Each test runs the real writer on a fixture whose first Sales use case carries a user name, then reads the uploaded
file bytes from the workspace and checks the user name is there and the catalogue name is not."""
import pytest

from v120_artifacts_support import make_inspire
from v120_docs_design_test import docs, labels, portfolio, summary

RENAMED = "Churn early warning"
CATALOGUE = "Sales idea 1"


@pytest.fixture
def renamed_grouped():
    grouped = portfolio()
    uc = grouped["Sales"][0]
    assert uc["Name"] == CATALOGUE
    uc["user_use_case_name"] = RENAMED
    return grouped


def _uploaded(obj, suffix):
    matches = [data for path, data in obj.w_client.workspace.files.items() if path.endswith(suffix)]
    assert len(matches) == 1, f"expected one uploaded {suffix} file, got {sorted(obj.w_client.workspace.files)}"
    return matches[0]


def test_csv_file_carries_the_user_name(docs, renamed_grouped):
    obj = make_inspire(docs)
    obj._generate_csv_catalog("English", "xx", renamed_grouped, labels(docs))
    text = _uploaded(obj, ".csv").decode("utf-8-sig")
    assert RENAMED in text
    assert CATALOGUE not in text


def test_markdown_file_carries_the_user_name(docs, renamed_grouped):
    obj = make_inspire(docs)
    obj._generate_markdown_catalog("English", "xx", renamed_grouped, summary(), "Acme", labels(docs))
    text = _uploaded(obj, ".md").decode("utf-8")
    assert RENAMED in text
    assert CATALOGUE not in text
