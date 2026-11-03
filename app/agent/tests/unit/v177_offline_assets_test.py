import os
import socket
import subprocess
import sys
import types
import urllib.request

import pytest

from v120_artifacts_support import CapturingLogger, make_inspire
from v177_assets_support import MACHINE, cli_entries, make_assets, wheel
from v120_genie_support import build_inspire, make_uc

FONT = b"\x00\x01\x00\x00" + b"glyphs" * 40
ZQV = {"zqvmod/__init__.py": "VALUE = 41\n", "zqvmod/_speed.cpython-312-aarch64-linux-gnu.so": b"\x7fELF",
       "zqv_dist-1.0.dist-info/METADATA": "Name: zqv-dist\nVersion: 1.0\n"}


def _refuse_pip_and_network(monkeypatch) -> list:
    calls = []

    def refuse(name):
        def call(*args, **kwargs):
            calls.append(name)
            raise AssertionError(f"{name} was called")
        return call

    for module, name in ((subprocess, "run"), (subprocess, "Popen"), (urllib.request, "urlopen"), (socket, "create_connection")):
        monkeypatch.setattr(module, name, refuse(f"{module.__name__}.{name}"))
    return calls


def _install_step(ns, root) -> str:
    return (f"Install step: run the Inspire installer with the Inspire assets download for {ns['__AGENT_VERSION__']}; it puts every file "
            f"manifest.json lists into {root}.")


def _zqv(ns, monkeypatch):
    monkeypatch.setitem(ns["INSPIRE_ASSET_MODULES"], "zqvmod", ("zqv-dist",))
    monkeypatch.setitem(ns["INSPIRE_ASSET_WHEELS"], "zqv-dist", "1.0")
    monkeypatch.delitem(sys.modules, "zqvmod", raising=False)


def test_the_assets_live_in_one_shared_workspace_folder_per_inspire_version(fresh_ns):
    assets = fresh_ns["InspireAssets"]()
    assert assets.root == f"/Workspace/Shared/inspire-ai/assets/{fresh_ns['__AGENT_VERSION__']}"
    assert assets.local.startswith(os.path.join(fresh_ns["tempfile"].gettempdir(), "inspire_assets")), "native files run from local disk"
    assert fresh_ns["InspireAssets"].shared() is fresh_ns["InspireAssets"].shared(), "one loader per Python process"


def test_a_missing_assets_folder_names_the_manifest_and_the_install_step(fresh_ns, tmp_path, monkeypatch):
    calls = _refuse_pip_and_network(monkeypatch)
    root = str(tmp_path / "assets")
    with pytest.raises(fresh_ns["InspireAssetError"]) as raised:
        fresh_ns["InspireAssets"](root, local=str(tmp_path / "local"), machine=MACHINE).manifest()
    assert str(raised.value) == f"The Inspire assets file {root}/manifest.json is missing. " + _install_step(fresh_ns, root)
    assert calls == []


def test_a_manifest_for_another_inspire_version_is_refused(fresh_ns, tmp_path):
    assets = make_assets(fresh_ns, tmp_path / "assets", [], inspire_version="v0.9.9")
    with pytest.raises(fresh_ns["InspireAssetError"], match=r"manifest\.json is for Inspire v0\.9\.9, not v"):
        assets.manifest()


def test_a_changed_a_missing_and_an_other_version_file_are_each_refused_by_name(fresh_ns, tmp_path):
    root = tmp_path / "assets"
    assets = make_assets(fresh_ns, root, [{"kind": "python", "name": "zqv-dist", "version": "1.0", "data": wheel(ZQV)}])
    entry = assets.entry("python", "zqv-dist", "1.0")
    assert entry["file"] == "python/zqv-dist.whl" and assets.path(entry) == f"{root}/python/zqv-dist.whl"
    with pytest.raises(fresh_ns["InspireAssetError"], match=r"zqv-dist\.whl holds zqv-dist 1\.0, and this Inspire needs zqv-dist 2\.0"):
        assets.entry("python", "zqv-dist", "2.0")
    fresh = make_assets(fresh_ns, root, [{"kind": "python", "name": "zqv-dist", "version": "1.0", "data": wheel(ZQV)}])
    (root / "python" / "zqv-dist.whl").write_bytes(b"changed")
    with pytest.raises(fresh_ns["InspireAssetError"]) as raised:
        fresh.path(fresh.entry("python", "zqv-dist", "1.0"))
    assert str(raised.value).startswith(f"The Inspire assets file {root}/python/zqv-dist.whl does not match its size and sha256 in "
                                        "manifest.json, so it is damaged or was changed. Install step:")
    (root / "python" / "zqv-dist.whl").unlink()
    with pytest.raises(fresh_ns["InspireAssetError"], match=r"zqv-dist\.whl is missing\. Install step:"):
        fresh.local_copy(fresh.entry("python", "zqv-dist", "1.0"))
    assert not os.path.exists(fresh.local) or os.listdir(fresh.local) == [], "a refused copy leaves no partial file behind"


def test_python_packages_load_from_a_checked_local_copy_and_never_from_pip(fresh_ns, tmp_path, monkeypatch):
    _zqv(fresh_ns, monkeypatch)
    root = tmp_path / "assets"
    assets = make_assets(fresh_ns, root, [{"kind": "python", "name": "zqv-dist", "version": "1.0", "data": wheel(ZQV)}])
    calls = _refuse_pip_and_network(monkeypatch)
    site = assets.python("zqvmod")
    import zqvmod
    assert zqvmod.VALUE == 41 and sys.path[0] == site and calls == []
    where = os.path.realpath(zqvmod.__file__)
    assert where.startswith(os.path.realpath(assets.local) + os.sep) and not where.startswith(os.path.realpath(str(root)) + os.sep)
    assert os.path.exists(os.path.join(site, "zqvmod", "_speed.cpython-312-aarch64-linux-gnu.so")), "native files are copied to local disk"
    (root / "python" / "zqv-dist.whl").write_bytes(b"changed after the check")
    assert assets.python("zqvmod") == site, "a package loads once per process"
    sys.modules.pop("zqvmod", None)


def test_a_package_already_loaded_from_elsewhere_is_refused_with_a_restart(fresh_ns, tmp_path, monkeypatch):
    _zqv(fresh_ns, monkeypatch)
    assets = make_assets(fresh_ns, tmp_path / "assets", [{"kind": "python", "name": "zqv-dist", "version": "1.0", "data": wheel(ZQV)}])
    monkeypatch.setitem(sys.modules, "zqvmod", types.SimpleNamespace(__file__="/usr/lib/python3/zqvmod/__init__.py"))
    with pytest.raises(fresh_ns["InspireAssetError"]) as raised:
        assets.python("zqvmod")
    assert str(raised.value) == ("zqvmod is already loaded in this Python process from /usr/lib/python3/zqvmod/__init__.py, so Inspire "
                                 "cannot load zqv-dist 1.0 from its assets; restart Python and run again")


def test_a_native_package_is_picked_for_this_machine_and_python_and_refused_for_another(fresh_ns, tmp_path):
    version = fresh_ns["INSPIRE_ASSET_WHEELS"]["lxml"]
    entries = [{"kind": "python", "name": "lxml", "version": version, "data": wheel({f"lxml/{m}.so": m}), "machine": m, "python": "3.12"}
               for m in ("aarch64", "x86_64")]
    root = tmp_path / "assets"
    make_assets(fresh_ns, root, entries)
    pick = lambda machine: fresh_ns["InspireAssets"](str(root), local=str(tmp_path / machine), machine=machine)
    assert pick("amd64").entry("python", "lxml", version, python="3.12")["file"] == "python/lxml-cp312-x86_64.whl"
    assert pick("arm64").entry("python", "lxml", version, python="3.12")["file"] == "python/lxml-cp312-aarch64.whl"
    with pytest.raises(fresh_ns["InspireAssetError"], match=r"manifest\.json lists no lxml for ppc64le and Python 3\.12"):
        pick("ppc64le").entry("python", "lxml", version, python="3.12")
    with pytest.raises(fresh_ns["InspireAssetError"], match=r"lists no lxml for aarch64 and Python 3\.11"):
        pick("aarch64").entry("python", "lxml", version, python="3.11")


def test_both_clis_come_from_local_copies_of_the_assets_with_no_download(fresh_ns, tmp_path, monkeypatch):
    monkeypatch.setattr(fresh_ns["os"], "symlink", os.symlink)
    assets = make_assets(fresh_ns, tmp_path / "assets", cli_entries(fresh_ns))
    calls = _refuse_pip_and_network(monkeypatch)
    root = tmp_path / "root"
    runner = fresh_ns["GenieCodeRunner"]("https://h", "t", CapturingLogger(), root=str(root), assets=assets)
    paths = runner.install()
    assert os.path.exists(paths["genie"]) and os.path.exists(paths["cli"]) and calls == []
    assert os.path.realpath(paths["genie"]).startswith(os.path.realpath(str(root / "pkg")))
    copied = sorted(os.listdir(assets.local))
    assert sorted(name.split("-", 1)[1] for name in copied) == ["databricks-cli-aarch64.zip", "genie-code-cli-aarch64.tar.gz"]
    runner.install()
    assert sorted(os.listdir(assets.local)) == copied, "a second install reuses what the first one unpacked"


@pytest.mark.parametrize("machine,named", [("x86_64", "x86_64"), ("amd64", "x86_64"), ("aarch64", "aarch64"), ("arm64", "aarch64")])
def test_a_run_unpacks_the_cli_builds_of_the_cpu_it_landed_on(fresh_ns, tmp_path, monkeypatch, machine, named):
    monkeypatch.setattr(fresh_ns["os"], "symlink", os.symlink)
    assets = make_assets(fresh_ns, tmp_path / "assets", cli_entries(fresh_ns, "x86_64") + cli_entries(fresh_ns, "aarch64"), machine=machine)
    read = []
    original = assets.local_copy
    assets.local_copy = lambda entry: read.append(entry["file"]) or original(entry)
    runner = fresh_ns["GenieCodeRunner"]("https://h", "t", CapturingLogger(), root=str(tmp_path / "root"), assets=assets)
    paths = runner.install()
    assert os.path.exists(paths["genie"]) and os.path.exists(paths["cli"])
    assert read == [f"cli/genie-code-cli-{named}.tar.gz", f"cli/databricks-cli-{named}.zip"]
    assert assets.cli("genie-code-cli") == original(assets.entry("cli", "genie-code-cli", fresh_ns["GENIE_CODE_CLI_VERSION"]))


@pytest.mark.parametrize("machine,held", [("x86_64", "aarch64"), ("aarch64", "x86_64"), ("ppc64le", "x86_64")])
def test_a_run_on_a_cpu_the_assets_hold_no_cli_build_for_names_that_cpu_and_copies_nothing(fresh_ns, tmp_path, machine, held):
    root = tmp_path / "assets"
    assets = make_assets(fresh_ns, root, cli_entries(fresh_ns, held), machine=machine)
    runner = fresh_ns["GenieCodeRunner"]("https://h", "t", CapturingLogger(), root=str(tmp_path / "root"), assets=assets)
    with pytest.raises(fresh_ns["InspireAssetError"]) as raised:
        runner.install()
    assert str(raised.value) == (f"The Inspire assets file {root}/manifest.json lists no genie-code-cli for {machine}. "
                                 + _install_step(fresh_ns, str(root)))
    assert not os.path.exists(assets.local) or os.listdir(assets.local) == []
    assert not os.path.exists(tmp_path / "root" / "bin" / "genie")


def test_a_cli_missing_from_the_assets_names_the_manifest_and_the_install_step(fresh_ns, tmp_path):
    root = tmp_path / "assets"
    assets = make_assets(fresh_ns, root, cli_entries(fresh_ns)[1:])
    runner = fresh_ns["GenieCodeRunner"]("https://h", "t", CapturingLogger(), root=str(tmp_path / "root"), assets=assets)
    with pytest.raises(fresh_ns["InspireAssetError"]) as raised:
        runner.install()
    assert str(raised.value) == (f"The Inspire assets file {root}/manifest.json lists no genie-code-cli for aarch64. "
                                 + _install_step(fresh_ns, str(root)))


def test_pdf_fonts_are_read_in_place_from_the_assets_with_no_download(fresh_ns, tmp_path, monkeypatch):
    cls = fresh_ns["DatabricksInspire"]
    monkeypatch.setattr(cls, "_DOC_FONT_FILES", {})
    root = tmp_path / "assets"
    obj = make_inspire(fresh_ns)
    obj._assets = make_assets(fresh_ns, root, [{"kind": "font", "name": "Inter", "version": "v20", "weight": w, "data": FONT}
                                               for w in (400, 600, 700)])
    calls = _refuse_pip_and_network(monkeypatch)
    assert obj._doc_font_files("Inter", (400, 600, 700)) == {w: f"{root}/fonts/inter-{w}.ttf" for w in (400, 600, 700)}
    assert calls == [] and obj.logger.matching("[DOCS-FONTS] Inter: 3 weights ready for the PDF from the Inspire assets")


def test_a_font_missing_from_the_assets_falls_back_and_names_the_file_and_the_install_step(fresh_ns, tmp_path, monkeypatch):
    cls = fresh_ns["DatabricksInspire"]
    monkeypatch.setattr(cls, "_DOC_FONT_FILES", {})
    root = tmp_path / "assets"
    obj = make_inspire(fresh_ns)
    obj._assets = make_assets(fresh_ns, root, [{"kind": "font", "name": "Noto Sans Arabic", "version": "v33", "weight": 400, "data": FONT}])
    calls = _refuse_pip_and_network(monkeypatch)
    assert obj._doc_font_files("Noto Sans Arabic", (400, 700)) == {} and calls == []
    warned = obj.logger.matching("[DOCS-FONTS] Noto Sans Arabic:", level="WARNING")
    assert warned and f"{root}/manifest.json lists no Noto Sans Arabic 700" in warned[0][1] and "Install step:" in warned[0][1]
    assert warned[0][1].endswith("The PDF falls back to installed fonts for it and may show missing glyphs.")


class _Assets:
    def __init__(self, error=None):
        self.calls, self.error = [], error

    def python(self, module):
        self.calls.append(module)
        if self.error:
            raise self.error


def test_a_document_package_loads_once_per_run_and_a_missing_one_names_the_install_step(fresh_ns, monkeypatch):
    calls = _refuse_pip_and_network(monkeypatch)
    obj = make_inspire(fresh_ns)
    obj._assets = _Assets(fresh_ns["InspireAssetError"]("The Inspire assets file /W/a/manifest.json is missing. Install step: run it."))
    for _ in range(3):
        with pytest.raises(RuntimeError) as raised:
            obj._require_asset_package("weasyprint", "PDF Catalog (French)")
        assert str(raised.value) == "PDF Catalog (French) cannot be generated: The Inspire assets file /W/a/manifest.json is missing. " \
                                    "Install step: run it."
    assert obj._assets.calls == ["weasyprint"] and calls == []


def test_a_package_whose_native_library_fails_to_load_says_so_without_pip(fresh_ns, monkeypatch):
    import importlib
    calls = _refuse_pip_and_network(monkeypatch)
    obj = make_inspire(fresh_ns)
    obj._assets = _Assets()
    monkeypatch.setattr(importlib, "import_module", lambda name, *a, **k: (_ for _ in ()).throw(OSError("cannot load library 'gobject-2.0-0'")))
    with pytest.raises(RuntimeError) as raised:
        obj._require_asset_package("weasyprint", "PDF Catalog")
    assert str(raised.value).startswith("PDF Catalog cannot be generated: 'weasyprint' from the Inspire assets cannot be loaded: cannot "
                                        "load library "), "the one redaction still masks the quoted value"
    assert calls == []


def test_a_pdf_with_no_assets_runs_no_pip_fetches_nothing_and_names_the_install_step(fresh_ns, tmp_path, monkeypatch):
    calls = _refuse_pip_and_network(monkeypatch)
    root = str(tmp_path / "assets")
    obj = make_inspire(fresh_ns)
    obj._assets = fresh_ns["InspireAssets"](root, local=str(tmp_path / "local"), machine=MACHINE)
    failed = []
    obj._record_failed_step = lambda step, language, error: failed.append((step, language, str(error)))
    monkeypatch.delitem(sys.modules, "weasyprint", raising=False)
    with pytest.raises(RuntimeError) as raised:
        obj.generate_catalog_pdf("French", "fr", {}, {}, {"Sales": [{"No": "N01-U01", "Name": "Forecast demand"}]}, "Acme")
    assert str(raised.value) == (f"PDF Catalog (French) cannot be generated: The Inspire assets file {root}/manifest.json is missing. "
                                 + _install_step(fresh_ns, root))
    assert calls == [], "no pip and no download even when the assets are missing"
    assert failed and failed[0][:2] == ("PDF Catalog", "French")


def test_a_lakebase_app_gets_the_python_3_11_packages_and_never_the_agent_ones(fresh_ns, tmp_path):
    ns = fresh_ns
    w = ns["INSPIRE_ASSET_WHEELS"]
    entries = [{"kind": "python", "name": "psycopg", "version": w["psycopg"], "data": wheel({"psycopg/__init__.py": "x"})},
               {"kind": "python", "name": "sqlglot", "version": w["sqlglot"], "data": wheel({"sqlglot/__init__.py": "y"})}]
    entries += [{"kind": "python", "name": "psycopg-binary", "version": w["psycopg-binary"], "machine": m, "python": p,
                 "data": wheel({f"psycopg_binary/_psycopg.cpython-{p.replace('.', '')}-{m}-linux-gnu.so": m,
                                "psycopg_binary.libs/libpq.so": f"{m}{p}"})}
                for m in ("aarch64", "x86_64") for p in ("3.11", "3.12")]
    files = make_assets(ns, tmp_path / "assets", entries).app_files()
    assert sorted(files) == ["psycopg/__init__.py", "psycopg_binary.libs/libpq.so", "psycopg_binary/_psycopg.cpython-311-aarch64-linux-gnu.so",
                             "psycopg_binary/_psycopg.cpython-311-x86_64-linux-gnu.so", "sqlglot/__init__.py"]
    assert files["psycopg_binary/_psycopg.cpython-311-x86_64-linux-gnu.so"] == b"x86_64"
    assert all(isinstance(body, bytes) for body in files.values()), "vendored files reach the App as bytes"


def test_an_app_asset_for_another_version_is_refused(fresh_ns, tmp_path):
    entries = [{"kind": "python", "name": name, "version": "0.0.1", "data": wheel({f"{name}/x.py": "x"})} for name in ("psycopg", "psycopg-binary", "sqlglot")]
    with pytest.raises(fresh_ns["InspireAssetError"], match=r"python/psycopg\.whl holds psycopg 0\.0\.1, and this Inspire needs psycopg 3\.3\.6"):
        make_assets(fresh_ns, tmp_path / "assets", entries).app_files()


def test_a_built_notebook_cell_that_installs_a_package_is_refused(agent_ns):
    problems = agent_ns["implement_install_problems"]([
        ("cell 3", "%pip install scikit-learn==1.7.0\ndbutils.library.restartPython()"),
        ("cell 4", "import subprocess, sys\nsubprocess.run([sys.executable, '-m', 'pip', 'install', 'lightgbm'])"),
        ("cell 5", "x = 1\n!pip install prophet"),
        ("cell 6", "dbutils.library.installPyPI('xgboost')"),
        ("cell 7", "pipeline_id = 'p1'\nprint('the pipeline installs nothing')"),
        ("cell 8", "import sklearn\nfrom scipy import stats"),
    ])
    assert [p.split(" installs a package")[0] for p in problems] == ["cell 3 line 1", "cell 4 line 2", "cell 5 line 2", "cell 6 line 1"]
    assert problems[0] == ("cell 3 line 1 installs a package; the notebook runs on what serverless environment 4 ships (scikit-learn 1.6.1, "
                           "statsmodels 0.14.4, scipy 1.15.1) and installs nothing, so remove that line")


def test_genie_is_told_environment_4_ships_its_libraries_and_the_notebook_installs_nothing(agent_ns):
    assert agent_ns["GENIE_NOTEBOOK_ENV_VERSION"] == "4"
    assert agent_ns["GENIE_ENV_PACKAGE_VERSIONS"] == {"scikit-learn": "1.6.1", "statsmodels": "0.14.4", "scipy": "1.15.1"}, \
        "the versions the Databricks serverless environment version 4 release notes list"
    rule = agent_ns["GENIE_PINNED_API_RULE"].format(pins="scikit-learn==1.6.1")
    assert rule.startswith("Serverless environment 4 ships scikit-learn==1.6.1, the versions its release notes list, and the notebook "
                           "installs nothing: call each library as that version defines it")
    install = agent_ns["GENIE_NO_INSTALL_RULE"]
    assert install.startswith("Install nothing: no pip line, no library install and no download from the internet")
    assert install.endswith("serverless environment 4 ships.")
    assert install in agent_ns["GENIE_AGENTS_FILE_TEMPLATE"], "Genie Code reads its agents file while it builds"
    inst = build_inspire(agent_ns)
    for technique in ("Classification", "Forecasting", "Sentiment Analysis"):
        rules = inst._genie_platform_rules(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique})))
        assert rules.count(install) == 1, technique
    assert install not in agent_ns["PROMPT_TEMPLATES"]["USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT"], \
        "the writer gets it once, in each use case's Platform Rules, so its template keeps its word budget"
    for name in ("GENIE_PINNED_API_RULE", "GENIE_SERVERLESS_RULE", "GENIE_NO_INSTALL_RULE", "GENIE_RUN_CONTROLS_RULE"):
        assert "%pip" not in agent_ns[name], name


def test_the_weasyprint_pin_keeps_the_70_floor_that_stops_the_double_free(agent_ns):
    pinned = tuple(int(p) for p in agent_ns["INSPIRE_ASSET_WHEELS"]["weasyprint"].split(".")[:2])
    assert pinned >= (70, 0), "WeasyPrint before 70.0 frees its font configuration twice and can crash the Python process"
    assert set(agent_ns["INSPIRE_ASSET_MODULES"]["weasyprint"]) >= {"tinycss2", "fonttools"}, \
        "WeasyPrint 70.0 needs tinycss2 1.5.0 and fonttools 4.59.2, newer than environment 4 ships"
    assert tuple(int(p) for p in agent_ns["INSPIRE_ASSET_WHEELS"]["fonttools"].split(".")[:2]) >= (4, 59)
    assert tuple(int(p) for p in agent_ns["INSPIRE_ASSET_WHEELS"]["tinycss2"].split(".")[:2]) >= (1, 5)
