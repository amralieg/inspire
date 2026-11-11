"""Every catalogue writer (PDF, presentation, Excel, CSV, Markdown) puts a renamed use case's name into the file it uploads.

Each test runs the real writer on a fixture whose first Sales use case carries a user name, then reads the uploaded
file bytes from the workspace and checks the user name is there and the catalogue name is not."""
import io
import sys
import types

import pytest

from v120_artifacts_support import make_inspire
from v120_docs_design_test import captured_html, docs, labels, portfolio, summary

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


def test_pdf_catalog_file_carries_the_user_name(docs, captured_html, renamed_grouped, monkeypatch):
    html_sources = captured_html

    class HTML:
        def __init__(self, string=None, **kwargs):
            html_sources.append(string)

        def write_pdf(self, path, font_config=None):
            with open(path, "wb") as handle:
                handle.write(html_sources[-1].encode("utf-8"))
    monkeypatch.setitem(sys.modules, "weasyprint", types.SimpleNamespace(HTML=HTML))
    obj = make_inspire(docs)
    obj.generate_catalog_pdf("English", "xx", labels(docs), summary(), renamed_grouped, "Acme")
    data = _uploaded(obj, ".pdf").decode("utf-8")
    assert RENAMED in data
    assert CATALOGUE not in data


def test_presentation_file_carries_the_user_name(docs, renamed_grouped):
    from pptx import Presentation
    obj = make_inspire(docs)
    obj.generate_presentation_pptx("English", "xx", labels(docs), summary(), renamed_grouped, "Acme")
    prs = Presentation(io.BytesIO(_uploaded(obj, ".pptx")))
    text = "\n".join(shape.text_frame.text for slide in prs.slides for shape in slide.shapes if shape.has_text_frame)
    assert RENAMED in text
    assert CATALOGUE not in text


def test_excel_file_carries_the_user_name(docs, renamed_grouped):
    import openpyxl
    obj = make_inspire(docs)
    obj._generate_use_case_excel("English", "xx", renamed_grouped, labels(docs))
    book = openpyxl.load_workbook(io.BytesIO(_uploaded(obj, ".xlsx")))
    values = [str(cell) for sheet in book.worksheets for row in sheet.iter_rows(values_only=True) for cell in row if cell is not None]
    assert any(RENAMED in value for value in values)
    assert not any(value == CATALOGUE for value in values)


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
