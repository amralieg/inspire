"""REQ-103: the saved averages the notebook falls back to ship in the release assets, and the release manifest lists them.
add_notebook packages every pinned notebook asset, so fx_averages is there because it is pinned, and this test keeps it there."""
import hashlib
import importlib.util
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
APP = os.path.dirname(ROOT)
FX_FILE = "notebook/fx_averages.json"


def _build():
    spec = importlib.util.spec_from_file_location("inspire_assets_build_rc14", os.path.join(ROOT, "release", "build_assets.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_saved_averages_are_a_pinned_notebook_asset_read_from_the_one_backend_file():
    build = _build()
    pins = build.notebook_pins()
    pin = pins["INSPIRE_NOTEBOOK_ASSETS"]["fx_averages"]
    assert pin["file"] == FX_FILE
    with open(os.path.join(APP, "backend", "lib", "fxAverages.json"), "rb") as handle:
        data = handle.read()
    assert (hashlib.sha256(data).hexdigest(), len(data)) == (pin["sha256"], pin["size"]), "the pin is the backend file, not a copy"


def test_the_release_bundle_carries_the_saved_averages_and_the_manifest_lists_them():
    build = _build()
    pins = build.notebook_pins()
    bundle = build.Bundle(pins)
    build.add_notebook(bundle, pins)
    assert FX_FILE in bundle.files, "the release tar holds notebook/fx_averages.json"
    entries = [e for e in bundle.entries if e["file"] == FX_FILE]
    assert len(entries) == 1 and entries[0]["kind"] == "notebook" and entries[0]["name"] == "fx_averages"
    with open(os.path.join(APP, "backend", "lib", "fxAverages.json"), "rb") as handle:
        assert entries[0]["sha256"] == hashlib.sha256(handle.read()).hexdigest()
    assert json.loads(bundle.files[FX_FILE].decode("utf-8"))["base"] == "USD"
