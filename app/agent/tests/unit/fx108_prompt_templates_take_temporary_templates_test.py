"""D-aws-02: since v1.5.3 the prompt templates are a read-only Mapping, so the 4 places that add a temporary prompt (merge small domains,
split large domains, and two more) raise "'InspirePromptTemplates' object does not support item assignment" and silently skip the step.
Seen live on v1.6.0 Discover: "Failed to merge domains"."""


def _templates(agent_ns):
    templates = agent_ns["InspirePromptTemplates"]()
    templates._prompts = {"BASE_PROMPT": "base"}
    return templates


def test_a_temporary_template_can_be_added_read_and_deleted(agent_ns):
    templates = _templates(agent_ns)
    templates["MERGE_TMP"] = "merge {x}"
    assert templates["MERGE_TMP"] == "merge {x}"
    assert "MERGE_TMP" in templates and "BASE_PROMPT" in templates
    del templates["MERGE_TMP"]
    assert "MERGE_TMP" not in templates
    assert templates["BASE_PROMPT"] == "base"


def test_pop_with_a_default_removes_a_temporary_template_and_tolerates_a_missing_one(agent_ns):
    templates = _templates(agent_ns)
    templates["SPLIT_TMP"] = "split"
    assert templates.pop("SPLIT_TMP", None) == "split"
    assert templates.pop("SPLIT_TMP", None) is None
    assert dict(templates) == {"BASE_PROMPT": "base"}


def test_a_temporary_template_never_changes_the_shipped_prompts(agent_ns):
    templates = _templates(agent_ns)
    shipped = templates._prompts
    templates["BASE_PROMPT"] = "override for one call"
    assert templates["BASE_PROMPT"] == "override for one call"
    del templates["BASE_PROMPT"]
    assert templates["BASE_PROMPT"] == "base"
    assert shipped == {"BASE_PROMPT": "base"}
