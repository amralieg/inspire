import hashlib
import io
import importlib.util
import os
import urllib.error
import urllib.request

import pytest

from v120_artifacts_support import CapturingLogger
from v177_assets_support import cli_entries, databricks_cli, genie_package, make_assets

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
GENIE_URL = "https://github.com/databricks/genie-code-cli/releases/download/v{v}/genie-package-{t}-unknown-linux-musl.tar.gz"
CLI_URL = "https://github.com/databricks/cli/releases/download/v{v}/databricks_cli_{v}_linux_{t}.zip"


class Response:
    def __init__(self, url, data):
        self.url, self.body = url, io.BytesIO(data)

    def geturl(self):
        return self.url

    def read(self, size=-1):
        return self.body.read(size)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class Opener:
    def __init__(self, serve=None, fail=None, landed=None):
        self.serve, self.fail, self.landed, self.calls = dict(serve or {}), fail, landed, []

    def __call__(self, url, repo, timeout):
        self.calls.append((url, repo, timeout))
        if self.fail is not None:
            raise self.fail
        if url not in self.serve:
            raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)
        return Response(self.landed or url, self.serve[url])


def _urls(ns, machine="x86_64"):
    genie_target = {"x86_64": "x86_64", "aarch64": "aarch64"}[machine]
    cli_target = {"x86_64": "amd64", "aarch64": "arm64"}[machine]
    return (GENIE_URL.format(v=ns["GENIE_CODE_CLI_VERSION"], t=genie_target),
            CLI_URL.format(v=ns["GENIE_DATABRICKS_CLI_VERSION"], t=cli_target))


def _setup(ns, tmp_path, monkeypatch, opener, machine="x86_64"):
    monkeypatch.setattr(ns["os"], "symlink", os.symlink)
    root = tmp_path / "assets"
    assets = make_assets(ns, root, cli_entries(ns, "x86_64") + cli_entries(ns, "aarch64"), machine=machine)
    assets._open = opener
    runner = ns["GenieCodeRunner"]("https://h", "t", CapturingLogger(), root=str(tmp_path / "root"), assets=assets)
    return root, assets, runner


def _good(ns, machine="x86_64"):
    genie, cli = _urls(ns, machine)
    return {genie: genie_package(), cli: databricks_cli()}


def _stop(ns, root, name, version, file, installed, why):
    return (f"Genie Code needs {name} {version} built for the x86_64 CPU this run landed on. The installed copy {root}/{file} "
            f"{installed}, and {why}. Run the Inspire installer again so it installs the Inspire {ns['__AGENT_VERSION__']} assets "
            f"into {root}, then run this again.")


def _cli_lines(runner):
    return [m for level, m in runner.logger.records if level == "INFO" and m.startswith("[IMPLEMENT-CLI]")]


def test_a_cli_build_on_disk_is_used_with_no_download_and_the_log_says_installed(fresh_ns, tmp_path, monkeypatch):
    opener = Opener(_good(fresh_ns))
    _root, assets, runner = _setup(fresh_ns, tmp_path, monkeypatch, opener)
    paths = runner.install()
    assert os.path.exists(paths["genie"]) and os.path.exists(paths["cli"]) and opener.calls == []
    assert assets.cli_from == {"genie-code-cli": "installed", "databricks-cli": "installed"}
    assert _cli_lines(runner) == ["[IMPLEMENT-CLI] x86_64 CPU: genie-code-cli installed, databricks-cli installed"]


def test_a_missing_build_with_internet_is_downloaded_from_its_pinned_release_and_checked(fresh_ns, tmp_path, monkeypatch):
    opener = Opener(_good(fresh_ns))
    root, assets, runner = _setup(fresh_ns, tmp_path, monkeypatch, opener)
    (root / "cli" / "genie-code-cli-x86_64.tar.gz").unlink()
    (root / "cli" / "databricks-cli-x86_64.zip").unlink()
    paths = runner.install()
    assert os.path.exists(paths["genie"]) and os.path.exists(paths["cli"])
    genie, cli = _urls(fresh_ns)
    assert opener.calls == [(genie, "databricks/genie-code-cli", 10), (genie, "databricks/genie-code-cli", 120),
                            (cli, "databricks/cli", 10), (cli, "databricks/cli", 120)]
    assert assets.cli_from == {"genie-code-cli": "downloaded", "databricks-cli": "downloaded"}
    assert _cli_lines(runner) == ["[IMPLEMENT-CLI] x86_64 CPU: genie-code-cli downloaded, databricks-cli downloaded"]
    for name, data in (("genie-code-cli-x86_64.tar.gz", genie_package()), ("databricks-cli-x86_64.zip", databricks_cli())):
        local = os.path.join(assets.local, f"{hashlib.sha256(data).hexdigest()[:16]}-{name}")
        assert open(local, "rb").read() == data, "the download lands under the same name an installed copy gets"
    assert not [f for f in os.listdir(assets.local) if f.endswith(".part")]
    assert not (root / "cli" / "genie-code-cli-x86_64.tar.gz").exists(), "the shared installed folder is never written"


@pytest.mark.parametrize("machine", ["aarch64", "arm64"])
def test_an_aarch64_run_downloads_the_aarch64_build(fresh_ns, tmp_path, monkeypatch, machine):
    opener = Opener(_good(fresh_ns, "aarch64"))
    root, assets, runner = _setup(fresh_ns, tmp_path, monkeypatch, opener, machine=machine)
    (root / "cli" / "databricks-cli-aarch64.zip").unlink()
    runner.install()
    assert [c[0] for c in opener.calls] == [_urls(fresh_ns, "aarch64")[1]] * 2
    assert _cli_lines(runner) == ["[IMPLEMENT-CLI] aarch64 CPU: genie-code-cli installed, databricks-cli downloaded"]


def test_a_changed_build_with_internet_is_downloaded_again(fresh_ns, tmp_path, monkeypatch):
    opener = Opener(_good(fresh_ns))
    root, assets, runner = _setup(fresh_ns, tmp_path, monkeypatch, opener)
    (root / "cli" / "genie-code-cli-x86_64.tar.gz").write_bytes(b"changed on disk")
    runner.install()
    assert [c[0] for c in opener.calls] == [_urls(fresh_ns)[0]] * 2
    assert assets.cli_from == {"genie-code-cli": "downloaded", "databricks-cli": "installed"}
    assert assets.cli("genie-code-cli").endswith("-genie-code-cli-x86_64.tar.gz")
    assert assets.cli_from["genie-code-cli"] == "downloaded", "a second ask keeps saying where the copy came from"
    assert len(opener.calls) == 2, "a second ask reuses the checked download"


@pytest.mark.parametrize("served", [b"x" * len(genie_package()), genie_package()[:-5], genie_package() + b"tail"])
def test_a_download_that_does_not_match_the_manifest_is_refused_and_never_used(fresh_ns, tmp_path, monkeypatch, served):
    genie, cli = _urls(fresh_ns)
    opener = Opener({genie: served, cli: databricks_cli()})
    root, assets, runner = _setup(fresh_ns, tmp_path, monkeypatch, opener)
    (root / "cli" / "genie-code-cli-x86_64.tar.gz").unlink()
    with pytest.raises(fresh_ns["InspireAssetError"]) as raised:
        runner.install()
    assert str(raised.value) == _stop(fresh_ns, root, "genie-code-cli", fresh_ns["GENIE_CODE_CLI_VERSION"], "cli/genie-code-cli-x86_64.tar.gz",
                                      "is missing", f"the download from {genie} does not match its size and sha256 in manifest.json, "
                                                    "so Inspire refuses it")
    assert not os.path.exists(assets.local) or os.listdir(assets.local) == [], "no partial or refused file is left to use"
    assert not (tmp_path / "root" / "bin" / "genie").exists() and "genie-code-cli" not in assets.cli_from


def test_no_internet_and_no_usable_build_stops_with_one_message_naming_the_cpu_and_the_fix(fresh_ns, tmp_path, monkeypatch):
    opener = Opener(fail=urllib.error.URLError(TimeoutError("timed out")))
    root, assets, runner = _setup(fresh_ns, tmp_path, monkeypatch, opener)
    (root / "cli" / "genie-code-cli-x86_64.tar.gz").write_bytes(b"damaged")
    with pytest.raises(fresh_ns["InspireAssetError"]) as raised:
        runner.install()
    assert str(raised.value) == _stop(fresh_ns, root, "genie-code-cli", fresh_ns["GENIE_CODE_CLI_VERSION"], "cli/genie-code-cli-x86_64.tar.gz",
                                      "does not match its size and sha256 in manifest.json or cannot be read",
                                      "this run cannot reach github.com within 10 seconds to download it (<urlopen error timed out>)")
    assert opener.calls == [(_urls(fresh_ns)[0], "databricks/genie-code-cli", 10)], "only the 10 second reachability check runs"
    assert not os.path.exists(assets.local) or os.listdir(assets.local) == []


def test_a_release_without_the_build_names_the_http_answer(fresh_ns, tmp_path, monkeypatch):
    opener = Opener({})
    root, _assets, runner = _setup(fresh_ns, tmp_path, monkeypatch, opener)
    (root / "cli" / "genie-code-cli-x86_64.tar.gz").unlink()
    with pytest.raises(fresh_ns["InspireAssetError"], match=r"x86_64 CPU .* answered HTTP 404\. Run the Inspire installer again"):
        runner.install()


def test_a_download_that_lands_on_another_host_is_refused(fresh_ns, tmp_path, monkeypatch):
    genie, _cli = _urls(fresh_ns)
    opener = Opener(_good(fresh_ns), landed="https://evil.example.com/genie.tar.gz")
    root, assets, runner = _setup(fresh_ns, tmp_path, monkeypatch, opener)
    (root / "cli" / "genie-code-cli-x86_64.tar.gz").unlink()
    with pytest.raises(fresh_ns["InspireAssetError"]) as raised:
        runner.install()
    assert ("https://evil.example.com/genie.tar.gz is not an HTTPS release file of databricks/genie-code-cli on github.com or its "
            "download host, so Inspire refuses it. Run the Inspire installer again") in str(raised.value)
    assert not os.path.exists(assets.local) or os.listdir(assets.local) == []


def test_a_cli_the_manifest_does_not_list_for_this_cpu_is_never_downloaded(fresh_ns, tmp_path, monkeypatch):
    monkeypatch.setattr(fresh_ns["os"], "symlink", os.symlink)
    opener = Opener(_good(fresh_ns))
    root = tmp_path / "assets"
    assets = make_assets(fresh_ns, root, cli_entries(fresh_ns, "aarch64"), machine="x86_64")
    assets._open = opener
    runner = fresh_ns["GenieCodeRunner"]("https://h", "t", CapturingLogger(), root=str(tmp_path / "root"), assets=assets)
    with pytest.raises(fresh_ns["InspireAssetError"], match=r"manifest\.json lists no genie-code-cli for x86_64\. Install step"):
        runner.install()
    assert opener.calls == [], "with no sha256 to check against, nothing is downloaded"


TRUST = [
    ("https://github.com/databricks/cli/releases/download/v1.22.1/databricks_cli_1.22.1_linux_amd64.zip", True),
    ("https://release-assets.githubusercontent.com/github-production-release-asset/1/x?sig=y", True),
    ("https://objects.githubusercontent.com/github-production-release-asset-2e65be/x", True),
    ("http://github.com/databricks/cli/releases/download/v1.22.1/x.zip", False),
    ("https://evil.example.com/databricks/cli/releases/download/v1.22.1/x.zip", False),
    ("https://github.com.evil.example.com/databricks/cli/releases/download/v1/x.zip", False),
    ("https://github.com/someone/else/releases/download/v1.22.1/x.zip", False),
    ("https://github.com/databricks/cli/archive/refs/heads/main.zip", False),
    ("https://user@github.com/databricks/cli/releases/download/v1/x.zip", False),
    ("https://github.com:8443/databricks/cli/releases/download/v1/x.zip", False),
    ("https://github.com:bad/databricks/cli/releases/download/v1/x.zip", False),
    ("ftp://github.com/databricks/cli/releases/download/v1/x.zip", False),
]


@pytest.mark.parametrize("url,trusted", TRUST)
def test_only_https_release_files_on_github_and_its_download_hosts_are_trusted(agent_ns, url, trusted):
    check = agent_ns["inspire_trusted_download_url"]
    if trusted:
        assert check(url, "databricks/cli") == url
    else:
        with pytest.raises(agent_ns["InspireAssetError"], match="so Inspire refuses it"):
            check(url, "databricks/cli")


def test_a_path_that_climbs_out_of_the_release_is_refused(agent_ns):
    with pytest.raises(agent_ns["InspireAssetError"]):
        agent_ns["inspire_trusted_download_url"]("https://github.com/databricks/cli/releases/download/../../../evil/x.zip",
                                                 "databricks/cli")


def _installer() -> dict:
    spec = importlib.util.spec_from_file_location("inspire_release_dl", os.path.join(ROOT, "app", "installer", "release.py"))
    release = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(release)
    return release.load_starter(os.path.join(ROOT, "inspire_installer.py"))


def test_the_agent_trusts_the_same_hosts_as_the_installer_and_refuses_everything_it_refuses(agent_ns):
    installer = _installer()
    assert tuple(agent_ns["INSPIRE_ASSET_DOWNLOAD_HOSTS"]) == tuple(installer["DOWNLOAD_HOSTS"])
    for url, trusted in TRUST:
        try:
            installer["trusted_url"](url, "databricks/cli")
            installer_ok = True
        except installer["InspireTrustError"]:
            installer_ok = False
        assert installer_ok or not trusted, f"the agent trusts {url}, which the installer refuses"


def test_the_opener_refuses_a_redirect_to_another_host_and_checks_the_first_address(agent_ns, monkeypatch):
    seen = {}

    class Fake:
        def open(self, request, timeout):
            seen["request"], seen["timeout"] = request, timeout
            return "opened"

    def build_opener(*handlers):
        seen["handlers"] = handlers
        return Fake()

    monkeypatch.setattr(urllib.request, "build_opener", build_opener)
    url = "https://github.com/databricks/cli/releases/download/v1.22.1/databricks_cli_1.22.1_linux_amd64.zip"
    assert agent_ns["inspire_open_release_file"](url, "databricks/cli", 10) == "opened"
    assert seen["request"].full_url == url and seen["timeout"] == 10
    redirects = [h for h in seen["handlers"] if isinstance(h, urllib.request.HTTPRedirectHandler)][0]
    request = urllib.request.Request(url)
    with pytest.raises(agent_ns["InspireAssetError"], match="evil.example.com"):
        redirects.redirect_request(request, None, 302, "Found", {}, "https://evil.example.com/x.zip")
    with pytest.raises(agent_ns["InspireAssetError"], match="is not an HTTPS release file"):
        redirects.redirect_request(request, None, 302, "Found", {}, "http://release-assets.githubusercontent.com/x")
    moved = redirects.redirect_request(request, None, 302, "Found", {}, "https://release-assets.githubusercontent.com/a?sig=b")
    assert moved.full_url == "https://release-assets.githubusercontent.com/a?sig=b"
    with pytest.raises(agent_ns["InspireAssetError"]):
        agent_ns["inspire_open_release_file"]("https://evil.example.com/x.zip", "databricks/cli", 10)


def test_assets_download_through_the_trusted_opener_by_default(agent_ns, tmp_path):
    assets = agent_ns["InspireAssets"](str(tmp_path / "a"), local=str(tmp_path / "l"), machine="x86_64")
    assert assets._open is agent_ns["inspire_open_release_file"]


def test_the_runtime_and_the_assets_build_name_the_same_cli_download(agent_ns):
    spec = importlib.util.spec_from_file_location("inspire_assets_build_dl", os.path.join(ROOT, "app", "agent", "release", "build_assets.py"))
    build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(build)
    pins = build.notebook_pins()
    for name, (version, _suffix) in agent_ns["INSPIRE_ASSET_CLIS"].items():
        for machine in ("x86_64", "aarch64"):
            file = agent_ns["inspire_cli_release_file"](name, version, machine)
            assert pins["inspire_cli_release_file"](name, version, machine) == file
            assert pins["inspire_cli_release_url"](name, file, version) == agent_ns["inspire_cli_release_url"](name, file, version)
    assert not hasattr(build, "CLI_SOURCES") and not hasattr(build, "CLI_RELEASE"), "the CLI sources live only in the notebook"
