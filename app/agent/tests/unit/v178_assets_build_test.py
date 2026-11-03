import ast
import hashlib
import importlib.util
import json
import os
import sys
import tarfile

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
    pins = build.notebook_pins()
    assert pins["inspire_cli_release_file"]("genie-code-cli", "0.2.1", "x86_64") == "genie-package-x86_64-unknown-linux-musl.tar.gz"
    assert pins["inspire_cli_release_file"]("databricks-cli", "1.22.1", "x86_64") == "databricks_cli_1.22.1_linux_amd64.zip"
    assert build.release_sha256(pins, "genie-code-cli", "0.2.1", "genie-package-x86_64-unknown-linux-musl.tar.gz") == sha
    assert build.release_sha256(pins, "databricks-cli", "1.22.1", "databricks_cli_1.22.1_linux_amd64.zip") == sha
    assert all(url.startswith("https://github.com/databricks/") and "/releases/download/v" in url for url in asked)
    pins["INSPIRE_ASSET_CLI_SOURCES"]["genie-code-cli"]["sums"] = "broken_SHA256SUMS"
    with pytest.raises(SystemExit, match="names no single sha256 for a.zip"):
        build.release_sha256(pins, "genie-code-cli", "1", "a.zip")


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


FOUND = {"machine": "aarch64", "version": "3.12.3 (main) [GCC]"}
LICENSED_WHEEL = wheel(LICENSED)


def _release():
    spec = importlib.util.spec_from_file_location("inspire_release_for_assets", os.path.join(os.path.dirname(ROOT), "installer", "release.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _bundle(build, pins, cli_byte=0):
    bundle = build.Bundle(pins)
    data = LICENSED_WHEEL
    bundle.add("python", "zqv-dist", "1.0", pins["inspire_asset_file"]("python", "zqv-dist"), data,
               bundle.license("zqv-dist", "1.0", build.wheel_license(data, "zqv-dist")), machine="any", python="any")
    big = bytes([cli_byte]) + bytes(range(256)) * 1200
    bundle.add("cli", "genie-code-cli", pins["GENIE_CODE_CLI_VERSION"], pins["inspire_asset_file"]("cli", "genie-code-cli", "aarch64"), big,
               bundle.license("genie-code-cli", pins["GENIE_CODE_CLI_VERSION"], "Databricks License\n\nNOTICE"), machine="aarch64")
    return bundle


def _sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_the_build_writes_one_tar_with_the_manifest_first_then_every_file_by_name_and_no_zip_or_parts(tmp_path):
    build = _build()
    pins = build.notebook_pins()
    sizes = build.write(_bundle(build, pins), pins, str(tmp_path), FOUND, ["aarch64"], ["x86_64", "aarch64"])
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["inspire_version"] == pins["__AGENT_VERSION__"] and manifest["probe"] == {"machine": "aarch64", "python": "3.12.3"}
    files = {entry["file"]: entry for entry in manifest["files"]}
    assert sorted(files) == ["cli/genie-code-cli-aarch64.tar.gz", "licenses/genie-code-cli.txt", "licenses/zqv-dist.txt", "python/zqv-dist.whl"]
    assert all({"name", "version", "size", "sha256", "license"} <= set(entry) and entry["license"] in files for entry in manifest["files"])
    assert sorted(os.listdir(tmp_path)) == ["inspire-assets.tar", "manifest.json"], "no zip, no parts and no parts.json"
    with tarfile.open(tmp_path / "inspire-assets.tar") as tar:
        members = tar.getmembers()
        assert [m.name for m in members] == ["manifest.json"] + sorted(files)
        assert all(m.isfile() and (m.mtime, m.mode, m.uid, m.gid, m.uname, m.gname) == (0, 0o644, 0, 0, "", "") for m in members)
        assert tar.extractfile("manifest.json").read() == (tmp_path / "manifest.json").read_bytes()
        assert all(hashlib.sha256(tar.extractfile(name).read()).hexdigest() == entry["sha256"] for name, entry in files.items())
    assert (sizes["archive"], sizes["sha256"], sizes["files"]) == ((tmp_path / "inspire-assets.tar").stat().st_size,
                                                                  _sha(tmp_path / "inspire-assets.tar"), 4)
    assert not hasattr(build, "PART_BYTES") and not hasattr(build, "PARTS")
    with pytest.raises(SystemExit):
        build.main(["--out", str(tmp_path / "x"), "--probe", "p.json", "--part-bytes", "0"])


def test_two_builds_of_the_same_inputs_are_byte_identical_whatever_the_clock_and_umask_and_one_changed_byte_is_not(tmp_path, monkeypatch):
    build = _build()
    pins = build.notebook_pins()
    clock = [1_700_000_000.0]
    monkeypatch.setattr(build.time, "time", lambda: clock[0])
    first = build.write(_bundle(build, pins), pins, str(tmp_path / "a"), FOUND, ["aarch64"], ["aarch64"])
    clock[0] += 3 * 86400 + 7
    old = os.umask(0o077)
    try:
        second = build.write(_bundle(build, pins), pins, str(tmp_path / "b"), FOUND, ["aarch64"], ["aarch64"])
    finally:
        os.umask(old)
    assert (first["archive"], first["sha256"]) == (second["archive"], second["sha256"])
    assert _sha(tmp_path / "a" / "inspire-assets.tar") == _sha(tmp_path / "b" / "inspire-assets.tar") == first["sha256"]
    assert (tmp_path / "a" / "inspire-assets.tar").read_bytes() == (tmp_path / "b" / "inspire-assets.tar").read_bytes()
    build.write(_bundle(build, pins), pins, str(tmp_path / "a"), FOUND, ["aarch64"], ["aarch64"])
    assert _sha(tmp_path / "a" / "inspire-assets.tar") == first["sha256"], "a rebuild into the same folder writes the same bytes"
    changed = build.write(_bundle(build, pins, cli_byte=1), pins, str(tmp_path / "c"), FOUND, ["aarch64"], ["aarch64"])
    assert changed["sha256"] != first["sha256"], "one changed input byte must change the archive"
    other = build.write(_bundle(build, pins), pins, str(tmp_path / "d"), dict(FOUND, machine="x86_64"), ["aarch64"], ["aarch64"])
    assert other["sha256"] != first["sha256"], "another probe result is another input"


def test_release_py_rebuilds_the_identical_tar_from_the_extracted_build(tmp_path):
    build, release = _build(), _release()
    pins = build.notebook_pins()
    built = build.write(_bundle(build, pins), pins, str(tmp_path / "out"), FOUND, ["aarch64"], ["aarch64"])
    folder = tmp_path / "extracted"
    with tarfile.open(tmp_path / "out" / "inspire-assets.tar") as tar:
        tar.extractall(folder, filter="data")
    for path in folder.rglob("*"):
        os.utime(path, (1_234_567_890, 1_234_567_890))
    (folder / "cli" / "genie-code-cli-aarch64.tar.gz").chmod(0o600)
    target = tmp_path / "release.tar"
    release.write_assets_tar(folder, pins["__AGENT_VERSION__"], target, release.load_starter())
    assert _sha(target) == built["sha256"], "release.py and the assets build write one archive the same way"


def test_the_notebook_the_build_release_py_and_the_installer_name_the_assets_alike(agent_ns):
    release = _release()
    with open(os.path.join(os.path.dirname(ROOT), "installer", "inspire_setup.py"), encoding="utf-8") as handle:
        setup = {node.targets[0].id: ast.literal_eval(node.value) for node in ast.parse(handle.read()).body
                 if isinstance(node, ast.Assign) and len(node.targets) == 1 and getattr(node.targets[0], "id", "").startswith("ASSETS_")}
    assert agent_ns["INSPIRE_ASSETS_MANIFEST"] == release.ASSETS_MANIFEST == setup["ASSETS_MANIFEST"] == "manifest.json"
    assert release.ASSETS_TAR == setup["ASSETS_TAR"] == "inspire-assets.tar"
    assert agent_ns["INSPIRE_ASSETS_FORMAT"] == setup["ASSETS_FORMAT"] == 1
    assert agent_ns["INSPIRE_ASSETS_FOLDER"] == setup["ASSETS_PARENT"]


def test_what_the_build_writes_is_what_the_agent_loader_reads(agent_ns, tmp_path, monkeypatch):
    build = _build()
    pins = build.notebook_pins()
    build.write(_bundle(build, pins), pins, str(tmp_path / "out"), {"machine": "aarch64", "version": "3.12.3"}, ["aarch64"], ["aarch64"])
    root = tmp_path / "assets" / pins["__AGENT_VERSION__"]
    with tarfile.open(tmp_path / "out" / "inspire-assets.tar") as archive:
        archive.extractall(root, filter="data")
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
    monkeypatch.setattr(build, "write", lambda *a, **k: {"path": "", "archive": 0, "sha256": "", "files": 0, "payload": 0})
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
