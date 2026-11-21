"""Shared helper for tests that stub the kinds registry with a small fixture.

REQ-414 (9ab397a1e) moved the technique gate-family and value-key tables out of the notebook
into kinds.json, so the notebook reads them through _inspire_kinds(). A hand-written fixture
registry therefore has to carry those two tables; they are copied from the real kinds.json so
the fixture never holds a second copy of them.
"""
import json
import os

_KINDS_JSON = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "agent", "app_shell", "kinds.json")
_TABLES = ("technique_gate_families", "technique_value_keys")


def with_technique_tables(registry):
    with open(_KINDS_JSON, encoding="utf-8") as handle:
        real = json.load(handle)
    return dict(registry, **{key: real[key] for key in _TABLES})
