"""rc13 strategy PDF (REQ-121). The strategy PDF is the PDF Catalog option. A run writes it unless the person unticked
every document: a job whose option was never set takes the widget default (PDF Catalog), and an explicit empty value
(every document unticked in the App) writes only the use cases."""
import pytest


def _pdf_requested(agent_ns, text, json_file_path=""):
    choices = [opt.strip() for opt in agent_ns["generation_choices_text"](text, json_file_path).split(",") if opt.strip()]
    run = object.__new__(agent_ns["DatabricksInspire"])
    run.generate_choices = choices
    return run._pdf_requested(), choices


def test_the_widget_default_is_the_pdf_catalog_option(agent_ns):
    assert agent_ns["DEFAULT_GENERATION_OPTIONS"] == "PDF Catalog"


def test_a_job_whose_option_was_never_set_still_writes_the_strategy_pdf(agent_ns):
    requested, choices = _pdf_requested(agent_ns, None)
    assert requested is True, "a missing option takes the widget default, so the PDF is written"
    assert choices == ["PDF Catalog", "use cases"]


def test_an_explicit_empty_option_writes_no_documents_because_the_person_unticked_them(agent_ns):
    requested, choices = _pdf_requested(agent_ns, "")
    assert requested is False, "every document unticked in the App means no documents, the App's own rule"
    assert choices == ["use cases"], "the use cases are always written"


@pytest.mark.parametrize("text, expected", [
    ("PDF Catalog", ["PDF Catalog", "use cases"]),
    ("Presentation", ["Presentation", "use cases"]),
    ("PDF Catalog, Excel", ["PDF Catalog", "Excel", "use cases"]),
    ("PDF Catalog, use cases", ["PDF Catalog", "use cases"]),
    ("   ", ["use cases"]),
])
def test_the_chosen_documents_are_kept_and_the_use_cases_are_always_added(agent_ns, text, expected):
    _, choices = _pdf_requested(agent_ns, text)
    assert choices == expected


def test_a_documents_only_run_keeps_exactly_the_options_it_was_given(agent_ns):
    assert agent_ns["generation_choices_text"]("PDF Catalog", "/Volumes/c/s/catalog.json") == "PDF Catalog"
    assert agent_ns["generation_choices_text"]("", "/Volumes/c/s/catalog.json") == ""
    assert agent_ns["generation_choices_text"](None, "/Volumes/c/s/catalog.json") == "PDF Catalog"
