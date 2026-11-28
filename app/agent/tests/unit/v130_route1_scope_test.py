"""v1.3.0 Route 1 scope: a Generate run regenerates only the flagged use cases of its own session, or of its own
business when the caller gave no session; flagged rows of other sessions and businesses are never read. A Generate
run that finds nothing to regenerate, or cannot read where it looks, fails and names why instead of reporting SUCCESS."""
import os
import sys
import types
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_genie_support import build_inspire

FLAGGED = [{"session_id": 1001, "id": "N03-U06"}, {"session_id": 2002, "id": "N01-U04"}, {"session_id": 3003, "id": "N02-U01"}]
BUSINESS_OF = {1001: "Acme", 2002: "Acme", 3003: "Other Corp"}


class ScopedSpark:
    def __init__(self):
        self.calls = []

    def sql(self, statement, args=None):
        self.calls.append((statement, dict(args or {})))
        rows = list(FLAGGED)
        if "session_id = :sid" in statement:
            rows = [r for r in rows if r["session_id"] == args["sid"]]
        elif "business_name = :biz" in statement:
            rows = [r for r in rows if BUSINESS_OF[r["session_id"]] == args["biz"]]
        return types.SimpleNamespace(collect=lambda: rows)


def scoped(agent_ns, **attrs):
    inst = build_inspire(agent_ns, **attrs)
    inst.logger = MagicMock()
    inst.spark = ScopedSpark()
    inst._tracking_table_name = "`main`.`inspire`.`__inspire_usecases`"
    return inst


def generate_run(agent_ns, marked=(), route2_rows=(), tracking=True, **attrs):
    inst = scoped(agent_ns, operation="Generate Use Cases", session_id=1001, _user_provided_session_id=True, **attrs)
    if not tracking:
        inst._tracking_table_name = None
    inst._phaseE0_catalog_drift_check = lambda sid: []
    inst._scan_notebooks_for_generation_flag = lambda: list(marked)
    inst.regenerated, inst.merged = [], []
    inst._regenerate_genie_for_flagged_rows = lambda rows, label: inst.regenerated.extend(rows) or list(rows)
    inst._merge_regenerated_ucs_into_tracking = lambda regen: inst.merged.extend(regen)
    if route2_rows:
        inst._fetch_flagged_use_cases_route2 = lambda: (setattr(inst, "_route2_marked_count", len(marked)), list(route2_rows))[1]
    return inst

