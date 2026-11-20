"""REQ-423: the notebook's roster and startup probe, run against every model-access setup in
app/backend/test/support/modelAccessWorlds.json. The fixture states whether the run is blocked and which name it calls; the
backend and installer consumers check the same file."""
import json
import os
import types
from unittest.mock import patch

import pytest

from _nbload import ROOT
from v120_runtime_reliability_test import FakeConnectSpark, RecordingLogger

FIXTURE = json.load(open(os.path.join(ROOT, "..", "backend", "test", "support", "modelAccessWorlds.json"), encoding="utf-8"))
TEXTS = FIXTURE["texts"]


class WorldWorkspace:
    """The workspace a world describes: serving endpoints, and the Unity Gateway Codex route."""

    def __init__(self, world):
        self.world = world
        self.serving_endpoints = types.SimpleNamespace(list=self._list)
        self.api_client = types.SimpleNamespace(do=self._do)

    def _list(self):
        if self.world["listing"] != "answer":
            raise RuntimeError(TEXTS[self.world["listing"]].format(name="the serving endpoints"))
        return [types.SimpleNamespace(name=e["name"], id=e["id"], task=e["task"], state=None, config=None)
                for e in self.world["endpoints"]]

    def _do(self, method, path, **kwargs):
        if self.world["gateway"] != "answer":
            raise RuntimeError(TEXTS[self.world["gateway"]].format(name="the gateway"))
        return {"models": [{"slug": slug} for slug in self.world["gateway_models"]]}


def world_spark(world):
    """ai_query under a world: a confirmed name answers, every other name is refused with the world's text for its outcome."""
    def responder(op):
        name = op["endpoint"]
        outcome = world["outcomes"].get(name, "missing")
        if outcome == "answer":
            return "OK"
        raise RuntimeError(TEXTS[outcome].format(name=name))
    return FakeConnectSpark(responder)


WORLDS = FIXTURE["worlds"]


@pytest.mark.parametrize("world", WORLDS, ids=[w["id"] for w in WORLDS])
def test_the_notebook_roster_blocks_or_calls_the_name_the_fixture_expects(fresh_ns, world):
    spark, log = world_spark(world), RecordingLogger()
    client = WorldWorkspace(world)
    with patch("databricks.sdk.WorkspaceClient", lambda *a, **k: client):
        fresh_ns["_apply_auto_detected_endpoints"](log, spark_session=spark)
    blocked = bool(fresh_ns["no_usable_model_message"]())
    assert blocked == world["expected"]["blocked"], (world["id"], fresh_ns["no_usable_model_message"]())
    assert fresh_ns["confirmed_roster_callable"]() == world["expected"]["callable"], world["id"]
    assert log.matching("[LLM_ENDPOINT_CALLABLE] the run calls", "INFO"), world["id"]
