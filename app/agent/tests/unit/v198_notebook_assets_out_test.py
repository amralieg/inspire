import base64
import hashlib
import importlib.util
import json
import os
import re

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
APP = os.path.dirname(ROOT)
NOTEBOOK = os.path.join(ROOT, "agent", "dbx_inspire_ai_agent.ipynb")
BUNDLED = os.path.join(APP, "dbx_inspire_ai_agent.ipynb")
BUNDLE_JS = os.path.join(APP, "backend", "notebook_bundle.js")
LEGACY = ("_INSPIRE_APP_SHELL", "_INSPIRE_KINDS")
NOTEBOOK_BYTES_CAP = 6_000_000
# rc.2 (REQ-165) regenerated the three count notices in every curated language, so the guard now covers the rest of the copy.
COUNT_NOTICE_KEYS = ("doc_fallback_notice", "doc_fallback_notice_one", "doc_bar_partial_notice")
# The frozen key set: the curated keys as they stood before the asset move (cb11ff5c0^). Only these keys are held, so a curated key added
# later by any lane never changes the digest. The count notices are in the pre-move set but were regenerated on purpose after the move
# (REQ-165), so they are left out of the frozen text.
FROZEN_KEYS_FIXTURE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures", "translation_frozen_keys.json")
FROZEN_KEYS = tuple(k for k in json.load(open(FROZEN_KEYS_FIXTURE, encoding="utf-8"))["keys"] if k not in COUNT_NOTICE_KEYS)
FROZEN_TRANSLATIONS_SHA256 = "83bdd3fe939fe6f86799e2120ce13ed212a1fd17aff3146a9f7b6e10d9b33787"
IMPORT_BYTES_CAP = 8_000_000


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _embed():
    return _load("inspire_embed_v198", os.path.join(ROOT, "agent", "app_shell", "embed.py"))


def _build():
    return _load("inspire_assets_build_v198", os.path.join(ROOT, "release", "build_assets.py"))


def _texts():
    with open(NOTEBOOK, encoding="utf-8") as handle:
        agent = handle.read()
    with open(BUNDLED, encoding="utf-8") as handle:
        bundled = handle.read()
    with open(BUNDLE_JS, encoding="utf-8") as handle:
        encoded = json.loads(handle.read().split("=", 1)[1].strip().rstrip(";"))
    return {"agent notebook": agent, "bundled notebook": bundled, "notebook_bundle.js": base64.b64decode(encoded).decode("utf-8")}


def _install(ns, root, name, data, pin=None, listed=True):
    pin = dict(pin or ns["INSPIRE_NOTEBOOK_ASSETS"][name])
    os.makedirs(os.path.join(root, os.path.dirname(pin["file"])), exist_ok=True)
    with open(os.path.join(root, pin["file"]), "wb") as handle:
        handle.write(data)
    entry = {"name": name, "version": ns["__AGENT_VERSION__"], "kind": "notebook", "file": pin["file"], "size": pin["size"],
             "sha256": pin["sha256"], "license": "licenses/inspire.txt"}
    manifest = {"format": ns["INSPIRE_ASSETS_FORMAT"], "inspire_version": ns["__AGENT_VERSION__"], "files": [entry] if listed else []}
    with open(os.path.join(root, ns["INSPIRE_ASSETS_MANIFEST"]), "w", encoding="utf-8") as handle:
        json.dump(manifest, handle)
    return ns["InspireAssets"](str(root), local=f"{root}_local")


def _repo_bytes(ns, name):
    with open(os.path.join(ROOT, ns["INSPIRE_NOTEBOOK_ASSETS"][name]["repo"]), "rb") as handle:
        return handle.read()


def test_no_notebook_copy_holds_the_app_shell_or_the_kind_registry_and_each_stays_under_its_size_cap():
    for label, text in _texts().items():
        for constant in LEGACY:
            assert f"{constant} = " not in text, f"{label} still embeds {constant}"
        assert not re.search(r"[A-Za-z0-9+/=]{100000,}", text), f"{label} still holds a large base64 asset"
        assert text.count("INSPIRE_NOTEBOOK_ASSETS = ") == 1, label
        size = len(text.encode("utf-8"))
        assert size < NOTEBOOK_BYTES_CAP, f"{label} is {size:,} bytes"
        assert len(base64.b64encode(text.encode("utf-8"))) < IMPORT_BYTES_CAP, f"{label} import request is over the cap"


def test_every_notebook_copy_pins_the_repo_build_of_each_asset(agent_ns):
    embed = _embed()
    pins = agent_ns["INSPIRE_NOTEBOOK_ASSETS"]
    assert set(pins) == {"app_shell", "fx_averages", "kinds", "translations"}
    assert pins == embed.pins()
    for label, text in _texts().items():
        line = next(item for item in json.loads(text)["cells"][1]["source"] if item.startswith("INSPIRE_NOTEBOOK_ASSETS = "))
        assert json.loads(line.split(" = ", 1)[1]) == pins, label
    for name, pin in pins.items():
        data = _repo_bytes(agent_ns, name)
        assert (hashlib.sha256(data).hexdigest(), len(data)) == (pin["sha256"], pin["size"]), name
        assert pin["file"].startswith("notebook/") and not os.path.isabs(pin["repo"])


def test_the_release_build_lists_every_asset_the_notebook_reads_and_refuses_a_stale_repo_file(tmp_path):
    build = _build()
    pins = build.notebook_pins()
    bundle = build.Bundle(pins)
    build.add_notebook(bundle, pins)
    listed = {(e["kind"], e["name"]): e for e in bundle.entries}
    for name, pin in pins["INSPIRE_NOTEBOOK_ASSETS"].items():
        entry = listed[("notebook", name)]
        assert (entry["file"], entry["sha256"], entry["size"]) == (pin["file"], pin["sha256"], pin["size"])
        assert entry["version"] == pins["__AGENT_VERSION__"] and entry["license"] in bundle.files
    stale = json.loads(json.dumps(pins["INSPIRE_NOTEBOOK_ASSETS"]))
    # The repo layout: the agent root holds each asset at its pinned path, and a pin may climb out of it (fx lives in app/backend).
    root = tmp_path / "agent"
    (root / "app_shell").mkdir(parents=True)
    for pin in stale.values():
        target = os.path.normpath(os.path.join(str(root), pin["repo"]))
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "wb") as handle:
            handle.write(b"another build")
    with pytest.raises(SystemExit, match="is not the build the notebook pins"):
        build.add_notebook(build.Bundle(pins), dict(pins, INSPIRE_NOTEBOOK_ASSETS=stale), root=str(root))


def test_the_installed_copy_loads_only_when_it_is_the_build_the_notebook_pins(agent_ns, tmp_path):
    data = _repo_bytes(agent_ns, "kinds")
    assert _install(agent_ns, tmp_path / "good", "kinds", data).notebook_file("kinds") == data
    pin = agent_ns["INSPIRE_NOTEBOOK_ASSETS"]["kinds"]
    cases = (("damaged", dict(data=b"x" + data[1:]), "does not match its size and sha256"),
             ("other_build", dict(data=data, pin=dict(pin, sha256="0" * 64)), "is from another Inspire build than this notebook"),
             ("unlisted", dict(data=data, listed=False), f"lists no {pin['file']}"))
    for label, kwargs, words in cases:
        assets = _install(agent_ns, tmp_path / label, "kinds", **kwargs)
        with pytest.raises(agent_ns["InspireAssetError"]) as caught:
            assets.notebook_file("kinds")
        message = str(caught.value)
        assert words in message, label
        assert "Install step: run the Inspire installer" in message and str(tmp_path / label) in message, label
    missing = _install(agent_ns, tmp_path / "missing", "kinds", data)
    os.remove(os.path.join(missing.root, pin["file"]))
    with pytest.raises(agent_ns["InspireAssetError"], match="Install step: run the Inspire installer"):
        missing.notebook_file("kinds")
    with pytest.raises(agent_ns["InspireAssetError"], match="manifest.json is missing. Install step: run the Inspire installer"):
        agent_ns["InspireAssets"](str(tmp_path / "nothing"), local=str(tmp_path / "nothing_local")).notebook_file("kinds")


def test_the_repo_copy_is_read_only_off_databricks_with_the_repo_folder_named(fresh_ns, monkeypatch, tmp_path):
    root_of = fresh_ns["inspire_repo_assets_root"]
    monkeypatch.delenv("DATABRICKS_RUNTIME_VERSION", raising=False)
    monkeypatch.setenv("INSPIRE_REPO_ASSETS", ROOT)
    assert root_of() == ROOT
    monkeypatch.setenv("DATABRICKS_RUNTIME_VERSION", "client.4.0")
    assert root_of() == ""
    monkeypatch.delenv("DATABRICKS_RUNTIME_VERSION")
    monkeypatch.delenv("INSPIRE_REPO_ASSETS")
    assert root_of() == ""
    assert fresh_ns["inspire_repo_asset"](ROOT, "kinds") == _repo_bytes(fresh_ns, "kinds")
    stale = tmp_path / fresh_ns["INSPIRE_NOTEBOOK_ASSETS"]["kinds"]["repo"]
    stale.parent.mkdir(parents=True)
    stale.write_bytes(b"{}")
    with pytest.raises(fresh_ns["InspireAssetError"], match="is not the build this notebook pins; run `python3 agent/app_shell/embed.py write`"):
        fresh_ns["inspire_repo_asset"](str(tmp_path), "kinds")
    with pytest.raises(fresh_ns["InspireAssetError"], match="cannot be read"):
        fresh_ns["inspire_repo_asset"](str(tmp_path / "absent"), "kinds")


def test_on_databricks_the_notebook_reads_the_installed_copy_once_and_never_the_repo(fresh_ns, monkeypatch, tmp_path):
    data = _repo_bytes(fresh_ns, "kinds")
    installed = _install(fresh_ns, tmp_path / "installed", "kinds", data)
    calls = []
    monkeypatch.setattr(fresh_ns["InspireAssets"], "shared", classmethod(lambda cls, root="": calls.append(root) or installed))
    monkeypatch.setenv("INSPIRE_REPO_ASSETS", str(tmp_path / "absent"))
    monkeypatch.setenv("DATABRICKS_RUNTIME_VERSION", "client.4.0")
    fresh_ns["_INSPIRE_NOTEBOOK_ASSET_TEXT"].clear()
    assert fresh_ns["inspire_notebook_asset"]("kinds") == data.decode("utf-8")
    assert fresh_ns["inspire_notebook_asset"]("kinds") == data.decode("utf-8")
    assert calls == [""]
    fresh_ns["_INSPIRE_NOTEBOOK_ASSET_TEXT"].clear()
    os.remove(os.path.join(installed.root, "manifest.json"))
    installed._manifest = None
    with pytest.raises(fresh_ns["InspireAssetError"], match="Install step: run the Inspire installer"):
        fresh_ns["inspire_notebook_asset"]("kinds")
    assert "kinds" not in fresh_ns["_INSPIRE_NOTEBOOK_ASSET_TEXT"]


def test_the_kind_registry_reads_in_sorted_key_order_whatever_order_kinds_json_is_written_in(fresh_ns):
    raw = json.loads(_repo_bytes(fresh_ns, "kinds"))
    assert json.dumps(raw) != json.dumps(raw, sort_keys=True), "kinds.json is not written in sorted order, so the check bites"
    registry = fresh_ns["_inspire_kinds"]()
    assert registry == raw
    assert json.dumps(registry) == json.dumps(raw, sort_keys=True)


def test_embed_check_finds_an_asset_still_embedded_or_pinned_at_another_build_and_passes_the_repo_notebook(tmp_path):
    embed = _embed()
    with open(NOTEBOOK, encoding="utf-8") as handle:
        nb = json.load(handle)
    source = nb["cells"][1]["source"]
    index = next(i for i, line in enumerate(source) if line.startswith("INSPIRE_NOTEBOOK_ASSETS = "))
    good = embed.pin_line(embed.pins())
    assert source[index] == good
    path = tmp_path / "good.ipynb"
    path.write_text(json.dumps(nb), encoding="utf-8")
    assert embed.legacy_lines(str(path)) == [] and embed.notebook_pins(str(path)) == embed.pins()
    legacy = json.loads(json.dumps(nb))
    legacy["cells"][1]["source"].insert(index, '_INSPIRE_KINDS = "{}"\n')
    path = tmp_path / "legacy.ipynb"
    path.write_text(json.dumps(legacy), encoding="utf-8")
    assert embed.legacy_lines(str(path)) == ["_INSPIRE_KINDS"]
    stale = json.loads(json.dumps(nb))
    stale["cells"][1]["source"][index] = good.replace(embed.pins()["kinds"]["sha256"], "0" * 64)
    path = tmp_path / "stale.ipynb"
    path.write_text(json.dumps(stale), encoding="utf-8")
    held = embed.notebook_pins(str(path))
    assert held["kinds"] != embed.pins()["kinds"] and held["app_shell"] == embed.pins()["app_shell"]


def test_the_curated_translations_load_from_the_assets_exactly_as_the_notebook_held_them_before_the_move(agent_ns):
    fallbacks = agent_ns["TranslationService"].TRANSLATION_FALLBACKS
    assert isinstance(fallbacks, agent_ns["InspireTranslationFallbacks"])
    held = {language: {k: table.get(k) for k in FROZEN_KEYS} for language, table in dict(fallbacks).items()}
    assert hashlib.sha256(json.dumps(held, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest() == FROZEN_TRANSLATIONS_SHA256
    assert dict(fallbacks) == json.loads(_repo_bytes(agent_ns, "translations"))
    assert len(fallbacks) == 22 and fallbacks["Arabic"]["domain"] and "English" not in fallbacks
    assert fallbacks.get("Klingon", {}) == {} and {**fallbacks}.keys() == set(fallbacks)
    for label, text in _texts().items():
        assert "TRANSLATION_FALLBACKS = {" not in text and "TRANSLATION_FALLBACKS = InspireTranslationFallbacks()" in text, label


def test_the_curated_translations_read_the_asset_once_and_refuse_one_that_does_not_decode_or_has_the_wrong_shape(fresh_ns, monkeypatch):
    calls = []
    good = _repo_bytes(fresh_ns, "translations").decode("utf-8")
    monkeypatch.setitem(fresh_ns, "inspire_notebook_asset", lambda name: calls.append(name) or good)
    fallbacks = fresh_ns["InspireTranslationFallbacks"]()
    assert fallbacks["German"] == json.loads(good)["German"] and len(fallbacks) == 22 and sorted(fallbacks) == sorted(json.loads(good))
    assert calls == ["translations"]
    cases = (("{not json", "do not decode"), ("{}", "no usable curated translations"), ("[]", "no usable curated translations"),
             ('{"Arabic": ["a"]}', "no usable curated translations"), ('{"Arabic": {"domain": 1}}', "no usable curated translations"),
             ('{"Arabic": {"domain": "x"}, "German": null}', "no usable curated translations"))
    for text, words in cases:
        monkeypatch.setitem(fresh_ns, "inspire_notebook_asset", lambda name, text=text: text)
        broken = fresh_ns["InspireTranslationFallbacks"]()
        with pytest.raises(RuntimeError, match=words):
            broken["Arabic"]
        assert broken._labels is None, text


def test_on_databricks_the_curated_translations_come_only_from_the_installed_copy_and_a_missing_one_names_the_installer(fresh_ns, monkeypatch, tmp_path):
    data = _repo_bytes(fresh_ns, "translations")
    installed = _install(fresh_ns, tmp_path / "installed", "translations", data)
    monkeypatch.setattr(fresh_ns["InspireAssets"], "shared", classmethod(lambda cls, root="": installed))
    monkeypatch.setenv("DATABRICKS_RUNTIME_VERSION", "client.4.0")
    fresh_ns["_INSPIRE_NOTEBOOK_ASSET_TEXT"].clear()
    assert dict(fresh_ns["InspireTranslationFallbacks"]()) == json.loads(data)
    fresh_ns["_INSPIRE_NOTEBOOK_ASSET_TEXT"].clear()
    unlisted = _install(fresh_ns, tmp_path / "unlisted", "translations", data, listed=False)
    monkeypatch.setattr(fresh_ns["InspireAssets"], "shared", classmethod(lambda cls, root="": unlisted))
    with pytest.raises(fresh_ns["InspireAssetError"], match="lists no notebook/translations.json"):
        fresh_ns["InspireTranslationFallbacks"]()["Arabic"]
