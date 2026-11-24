"""FX-116 (REQ-503): the PDF and presentation writers are gone, so their layout geometry has nothing left to measure.

The tier-share maths and the page and slide geometry checks lived with the writers; the guard here is that none of
them comes back in the run."""
import pytest


@pytest.fixture
def docs(agent_ns):
    return agent_ns


@pytest.mark.parametrize("name", ["_doc_shares", "_DOC_MIN_SHARE", "_DOC_PDF_PX_PER_PT", "_DOC_TYPE_SCALE", "_DOC_WIDE_CHARS"])
def test_the_document_geometry_helpers_are_gone(docs, name):
    assert not hasattr(docs["DatabricksInspire"], name), f"DatabricksInspire.{name} still sizes a PDF or deck"
