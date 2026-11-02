"""How Inspire organizes a business's Apps, one per business domain, one per use case or one for all its use cases: the wizard's
choice rides in the spec so the next use case can follow it, and choosing it alone never rebuilds an App, offline."""
import pytest

from v120_artifacts_support import FakeSpark  # noqa: F401
from v140_implement_test import VALID

PLACEMENT_ERROR = ("choose how Inspire organizes Apps: 'domain' (one App per business domain), 'use_case' (one App per use case), "
                   "'business' (one App for all use cases) or 'inspire' (Inside Inspire, each use case's page in Inspire's Run tab; not "
                   "recommended, only for testing), not {}")


def _outputs(**changes):
    return dict(VALID["outputs"], **changes)


@pytest.mark.parametrize("given,kept", [("domain", "domain"), ("use_case", "use_case"), ("business", "business"),
                                        (" Business ", "business"), ("", ""), (None, "")],
                         ids=["domain", "use_case", "business", "spaced_capital", "blank", "missing"])
def test_the_spec_keeps_how_inspire_organizes_apps(agent_ns, given, kept):
    outputs = _outputs(app_placement=given) if given is not None else dict(VALID["outputs"])
    spec, errors = agent_ns["validate_implement_spec"](dict(VALID, outputs=outputs))
    assert errors == [] and spec["outputs"]["app_placement"] == kept


@pytest.mark.parametrize("given,shown", [("per_domain", "'per_domain'"), (3, "3"), (["domain"], '["domain"]')],
                         ids=["unknown_word", "number", "list"])
def test_a_placement_inspire_does_not_offer_is_refused(agent_ns, given, shown):
    errors = agent_ns["validate_implement_spec"](dict(VALID, outputs=_outputs(app_placement=given)))[1]
    assert PLACEMENT_ERROR.format(shown) in errors, errors


def test_an_app_that_is_not_built_has_no_placement_to_check(agent_ns):
    spec, errors = agent_ns["validate_implement_spec"](dict(VALID, outputs={"dashboard": True, "app_placement": "nonsense",
                                                                              "inspire_url": VALID["outputs"]["inspire_url"]}))
    assert errors == [] and spec["outputs"]["app_placement"] == ""


def test_changing_only_the_placement_is_no_change_and_rebuilds_nothing(agent_ns):
    validate = agent_ns["validate_implement_spec"]
    before = validate(dict(VALID, outputs=_outputs(app_placement="business")))[0]
    after = validate(dict(VALID, outputs=_outputs(app_placement="domain")))[0]
    assert agent_ns["classify_implement_change"](before, after) == []
    assert "app_placement" not in agent_ns["IMPLEMENT_OUTPUT_OPTIONS"]["app"]


def test_a_new_app_named_for_the_domain_is_a_change_of_outputs(agent_ns):
    validate = agent_ns["validate_implement_spec"]
    before = validate(dict(VALID, outputs=_outputs(app_placement="business")))[0]
    after = validate(dict(VALID, outputs=_outputs(app_placement="domain", app_name="inspire-retail-pricing")))[0]
    assert agent_ns["classify_implement_change"](before, after) == ["outputs"]
