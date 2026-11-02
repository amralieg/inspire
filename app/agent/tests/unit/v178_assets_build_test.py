import hashlib
import importlib.util
import json
import os
import sys
import zipfile

import pytest

from v177_assets_support import wheel

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _build():
    spec = importlib.util.spec_from_file_location("inspire_assets_build", os.path.join(ROOT, "release", "build_assets.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


LICENSED = {"zqvmod/__init__.py": "VALUE = 7\n", "zqv_dist-1.0.dist-info/METADATA": "Name: zqv-dist\n",
            "zqv_dist-1.0.dist-info/licenses/LICENSE": "MIT License\n"}


def test_the_build_reads_every_pin_and_the_file_names_from_the_notebook(agent_ns):
    pins = _build().notebook_pins()
    for name in ("__AGENT_VERSION__", "INSPIRE_ASSETS_PYTHON", "INSPIRE_ASSET_WHEELS", "INSPIRE_ASSET_MODULES", "INSPIRE_APP_ASSET_WHEELS",
                 "INSPIRE_ASSET_CLIS", "GENIE_NOTEBOOK_ENV_VERSION"):
        assert pins[name] == agent_ns[name], name
    for args in (("python", "lxml", "aarch64", "3.12"), ("python", "weasyprint"), ("cli", "genie-code-cli", "x86_64"), ("license", "Noto Sans JP")):
        assert pins["inspire_asset_file"](*args) == agent_ns["inspire_asset_file"](*args), "the build and the loader name files alike"
    assert pins["inspire_asset_file"]("font", "Noto Sans Arabic", weight=700) == "fonts/noto-sans-arabic-700.ttf"


def test_every_pdf_font_the_agent_uses_has_one_pinned_file_and_no_pin_is_left_over(agent_ns):
    build = _build()
    used = {(family, weight) for family, weights in agent_ns["DatabricksInspire"]._DOC_FONT_FAMILIES.values() for weight in weights}
    assert used == set(build.FONT_FILES) == set(build.FONT_SHA256) and len(used) == 19
    assert all(path.endswith(".ttf") and "/v" in path for path in build.FONT_FILES.values()), "each pin names a versioned file"
    assert all(len(sha) == 64 for sha in build.FONT_SHA256.values()), "each font file is pinned by its sha256 too"


def test_a_cli_sha256_comes_from_the_release_checksum_file_never_from_the_github_api(monkeypatch):
    build = _build()
    sha = "ab" * 32
    answers = {"genie-package-x86_64-unknown-linux-musl.tar.gz.sha256": f"{sha}\n",
               "databricks_cli_1.22.1_SHA256SUMS": f"{'cd' * 32}  databricks_cli_1.22.1_linux_arm64.zip\n{sha}  databricks_cli_1.22.1_linux_amd64.zip\n",
               "broken_SHA256SUMS": f"{sha}  a.zip\n{sha}  a.zip\n"}
    asked = []
    monkeypatch.setattr(build, "fetch", lambda url, accept="", sha="": asked.append(url) or answers[url.rsplit("/", 1)[1]].encode())
    genie = build.CLI_SOURCES["genie-code-cli"]
    assert build.release_sha256(genie, "0.2.1", "genie-package-x86_64-unknown-linux-musl.tar.gz") == sha
    assert build.release_sha256(build.CLI_SOURCES["databricks-cli"], "1.22.1", "databricks_cli_1.22.1_linux_amd64.zip") == sha
    assert all(url.startswith("https://github.com/databricks/") and "/releases/download/v" in url for url in asked)
    with pytest.raises(SystemExit, match="names no single sha256 for a.zip"):
        build.release_sha256(dict(genie, sums="broken_SHA256SUMS"), "1", "a.zip")


def test_a_pure_wheel_is_taken_as_is_and_a_native_one_is_the_oldest_glibc_build_for_the_machine(monkeypatch):
    build = _build()
    listings = {
        "pure": [{"filename": "pure-1.0-py3-none-any.whl", "url": "u0", "digests": {"sha256": "s0"}}],
        "native": [{"filename": f"native-1.0-cp312-cp312-{tag}.whl", "url": tag, "digests": {"sha256": tag}} for tag in (
            "manylinux_2_28_aarch64", "manylinux2014_aarch64.manylinux_2_17_aarch64", "musllinux_1_2_aarch64",
            "manylinux2014_x86_64.manylinux_2_17_x86_64", "macosx_11_0_arm64")],
    }
    monkeypatch.setattr(build, "fetch", lambda url, accept="": json.dumps({"urls": listings[url.split("/")[-3]]}).encode())
    assert build.wheel_for("pure", "1.0", "3.12", "aarch64")[1:] == ("any", "any")
    picked, machine, python = build.wheel_for("native", "1.0", "3.12", "aarch64")
    assert picked["url"] == "manylinux2014_aarch64.manylinux_2_17_aarch64" and (machine, python) == ("aarch64", "3.12")
    assert build.wheel_for("native", "1.0", "3.12", "x86_64")[0]["url"] == "manylinux2014_x86_64.manylinux_2_17_x86_64"
    with pytest.raises(SystemExit, match="native 1.0 has no manylinux wheel for cp311 on aarch64"):
        build.wheel_for("native", "1.0", "3.11", "aarch64")


def test_a_wheel_without_a_license_file_stops_the_build():
    build = _build()
    assert build.wheel_license(wheel(LICENSED), "zqv-dist").startswith("licenses/LICENSE\n\nMIT License")
    with pytest.raises(SystemExit, match="the zqv-dist wheel carries no license file"):
        build.wheel_license(wheel({"zqvmod/__init__.py": "x"}), "zqv-dist")


def _bundle(build, pins):
    bundle = build.Bundle(pins)
    data = wheel(LICENSED)
    bundle.add("python", "zqv-dist", "1.0", pins["inspire_asset_file"]("python", "zqv-dist"), data,
               bundle.license("zqv-dist", "1.0", build.wheel_license(data, "zqv-dist")), machine="any", python="any")
    big = os.urandom(300_000)
    bundle.add("cli", "genie-code-cli", pins["GENIE_CODE_CLI_VERSION"], pins["inspire_asset_file"]("cli", "genie-code-cli", "aarch64"), big,
               bundle.license("genie-code-cli", pins["GENIE_CODE_CLI_VERSION"], "Databricks License\n\nNOTICE"), machine="aarch64")
    return bundle


def test_the_build_writes_a_manifest_with_size_sha256_and_license_for_every_file_and_parts_that_rejoin(tmp_path):
    build = _build()
    pins = build.notebook_pins()
    found = {"machine": "aarch64", "version": "3.12.3 (main) [GCC]"}
    sizes = build.write(_bundle(build, pins), pins, str(tmp_path), 100_000, found, ["aarch64"], ["x86_64", "aarch64"])
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["inspire_version"] == pins["__AGENT_VERSION__"] and manifest["probe"] == {"machine": "aarch64", "python": "3.12.3"}
    files = {entry["file"]: entry for entry in manifest["files"]}
    assert sorted(files) == ["cli/genie-code-cli-aarch64.tar.gz", "licenses/genie-code-cli.txt", "licenses/zqv-dist.txt", "python/zqv-dist.whl"]
    assert all({"name", "version", "size", "sha256", "license"} <= set(entry) and entry["license"] in files for entry in manifest["files"])
    parts = json.loads((tmp_path / "parts.json").read_text())
    assert [p["file"] for p in parts["parts"]] == [f"inspire-assets.part{n:03d}" for n in range(1, len(parts["parts"]) + 1)]
    assert len(parts["parts"]) == sizes["parts"] >= 4 and max(p["size"] for p in parts["parts"]) <= 100_000
    joined = b"".join((tmp_path / p["file"]).read_bytes() for p in parts["parts"])
    assert joined == (tmp_path / "inspire-assets.zip").read_bytes() and hashlib.sha256(joined).hexdigest() == parts["sha256"]
    assert all(hashlib.sha256((tmp_path / p["file"]).read_bytes()).hexdigest() == p["sha256"] for p in parts["parts"])
    assert not any(name.endswith(".zip") and name != "inspire-assets.zip" for name in os.listdir(tmp_path)), "no part is named .zip"
    build.write(_bundle(build, pins), pins, str(tmp_path), 0, found, ["aarch64"], ["aarch64"])
    assert not [n for n in os.listdir(tmp_path) if n.startswith("inspire-assets.part") or n == "parts.json"], "a rebuild leaves no old part"


def test_what_the_build_writes_is_what_the_agent_loader_reads(agent_ns, tmp_path, monkeypatch):
    build = _build()
    pins = build.notebook_pins()
    build.write(_bundle(build, pins), pins, str(tmp_path / "out"), 0, {"machine": "aarch64", "version": "3.12.3"}, ["aarch64"], ["aarch64"])
    root = tmp_path / "assets" / pins["__AGENT_VERSION__"]
    with zipfile.ZipFile(tmp_path / "out" / "inspire-assets.zip") as archive:
        archive.extractall(root)
    monkeypatch.setitem(agent_ns["INSPIRE_ASSET_MODULES"], "zqvmod", ("zqv-dist",))
    monkeypatch.setitem(agent_ns["INSPIRE_ASSET_WHEELS"], "zqv-dist", "1.0")
    monkeypatch.delitem(sys.modules, "zqvmod", raising=False)
    assets = agent_ns["InspireAssets"](str(root), local=str(tmp_path / "local"), machine="arm64")
    assets.python("zqvmod")
    import zqvmod
    assert zqvmod.VALUE == 7
    assert open(assets.cli("genie-code-cli"), "rb").read()[:16] == (root / "cli" / "genie-code-cli-aarch64.tar.gz").read_bytes()[:16]
    sys.modules.pop("zqvmod", None)


def test_the_build_ships_both_serverless_machines_unless_told_otherwise(tmp_path, monkeypatch):
    build = _build()
    seen = {"python": []}
    monkeypatch.setattr(build, "add_python", lambda bundle, pins, python, machines, names: seen["python"].append((python, list(machines))))
    monkeypatch.setattr(build, "add_fonts", lambda bundle, pins: None)
    monkeypatch.setattr(build, "add_clis", lambda bundle, pins, machines: seen.__setitem__("cli", list(machines)))
    monkeypatch.setattr(build, "write", lambda *a, **k: {"archive": 0, "parts": 0, "largest_part": 0, "files": 0, "payload": 0})
    probe = tmp_path / "probe.json"
    probe.write_text(json.dumps({"machine": "aarch64", "version": "3.12.3 (main)"}))
    assert build.main(["--out", str(tmp_path / "out"), "--probe", str(probe)]) == 0
    assert seen["cli"] == ["x86_64", "aarch64"], "a run of 10 probes saw aarch64 and the next one ran on x86_64"
    assert seen["python"] == [("3.12", ["x86_64", "aarch64"]), ("3.11", ["x86_64", "aarch64"])]


def test_a_rebuild_takes_a_download_with_the_same_sha256_from_the_cache_and_fetches_a_changed_one_again(tmp_path, monkeypatch):
    build = _build()
    calls = []
    monkeypatch.setattr(build, "_download", lambda url, accept="": calls.append(url) or b"wheel bytes")
    monkeypatch.setattr(build, "CACHE", [str(tmp_path)])
    sha = hashlib.sha256(b"wheel bytes").hexdigest()
    assert build.fetch("u1", sha=sha) == build.fetch("u1", sha=sha) == b"wheel bytes" and calls == ["u1"]
    (tmp_path / sha).write_bytes(b"changed")
    assert build.fetch("u1", sha=sha) == b"wheel bytes" and calls == ["u1", "u1"]
    assert build.fetch("u2") == b"wheel bytes" and calls[-1] == "u2", "a download with no published sha256 is never cached"


def test_the_build_refuses_a_python_or_a_machine_the_probe_did_not_find(tmp_path):
    build = _build()
    probe = tmp_path / "probe.json"
    probe.write_text(json.dumps({"machine": "aarch64", "version": "3.13.1 (main)"}))
    with pytest.raises(SystemExit, match="runs Python 3.13, and the notebook pins INSPIRE_ASSETS_PYTHON 3.12"):
        build.main(["--out", str(tmp_path / "out"), "--probe", str(probe)])
    probe.write_text(json.dumps({"machine": "aarch64", "version": "3.12.3 (main)"}))
    with pytest.raises(SystemExit, match="the probe ran on aarch64, which --machines x86_64 leaves out"):
        build.main(["--out", str(tmp_path / "out"), "--probe", str(probe), "--machines", "x86_64"])
