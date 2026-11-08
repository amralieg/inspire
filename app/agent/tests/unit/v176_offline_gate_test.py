import ast
import base64
import glob
import gzip
import json
import os
import re
import zlib

import _agentload
from _nbload import AGENT_NB, ROOT, notebook_assets, notebook_cells, packed_text

INSTALL = re.compile(r"%pip\b|\bpip3?\s+install\b|-m\s+pip\b|[\"']pip[\"']\s*,\s*[\"']install[\"']|\bnpm\s+(?:install|ci|i)\b|"
                     r"\bpostinstall\b|\b(?:yarn|pnpm)\s+(?:install|add)\b|\buv\s+pip\b|\bconda\s+install\b|\bapt(?:-get)?\s+install\b|"
                     r"\beasy_install\b|\binstallPyPI\b")
DOWNLOAD = re.compile(r"fonts\.(?:googleapis|gstatic)\.com|/releases/(?:download|latest)/|files\.pythonhosted\.org|pypi\.org/(?:simple|pypi)\b|"
                      r"registry\.npmjs\.org|raw\.githubusercontent\.com|objects\.githubusercontent\.com|\b(?:curl|wget)\s+-|\bgit\s+clone\b")
WEB_FETCH = re.compile(r"fetch\(\s*[\"'`]https?://|\bimport\b[^;\n]*[\"'`]https?://|<script[^>]+src=[\"']https?://|"
                       r"<link[^>]+href=[\"']https?://|url\(\s*[\"']?https?://|@import\s+(?:url\()?\s*[\"']?https?://")
FETCHERS = {"urlopen", "build_opener", "urlretrieve", "HTTPConnection", "HTTPSConnection", "create_connection"}
FETCH_MODULES = {"requests", "httpx", "aiohttp", "urllib3"}
WORKSPACE_ONLY = {
    "DatabricksInspire._implement_default_http_get": "calls the built App's own /health address on the workspace's Apps domain",
    "Workspace.__init__": "opens the App's session to its own workspace host",
    "GenieCodeRelay.forward": "passes Genie Code's model calls from its localhost relay on to the workspace's own Unity Gateway",
}
INSTALL_TEXT_ALLOWED = {
    "IMPLEMENT_INSTALL_LINE_RE": "the pattern the build check uses to refuse a built notebook that installs a package",
}
RELEASE_DOWNLOAD_ONLY = {
    "inspire_open_release_file": "downloads the pinned CLI build for the run's CPU from its GitHub release when the installed copy is "
                                 "missing or damaged, and InspireAssets checks it against manifest.json before use",
}
DOWNLOAD_TEXT_ALLOWED = {
    "INSPIRE_ASSET_CLI_RELEASE": "the pinned GitHub release address of each CLI build, the only download Inspire makes at run time",
    "INSPIRE_ASSET_RELEASE_PATH": "the release download path the run-time CLI download must stay under",
    "INSPIRE_ASSET_DOWNLOAD_HOSTS": "github.com and its release download hosts, the only hosts that download may reach",
}


def _code_cells():
    return [src for kind, src in notebook_cells(AGENT_NB) if kind == "code"]


def _without_allowed(src: str, allowed=INSTALL_TEXT_ALLOWED) -> str:
    tree = ast.parse(_parsable(src))
    lines = src.split("\n")
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) in allowed for t in node.targets):
            for i in range(node.lineno - 1, node.end_lineno):
                lines[i] = ""
    return "\n".join(lines)


def _parsable(src: str) -> str:
    return "\n".join("" if line.startswith(("%", "!")) and not line.startswith("!=") else line for line in src.split("\n"))


def _hits(pattern, text: str) -> list:
    out = []
    for number, line in enumerate(text.split("\n"), 1):
        if pattern.search(line):
            out.append(f"line {number}: {line.strip()[:160]}")
    return out


def _embedded_shell() -> dict:
    value = _agentload.load_agent_namespace()["inspire_notebook_asset"]("app_shell")
    return json.loads(zlib.decompress(base64.b64decode(value)).decode("utf-8"))


BASE64 = re.compile(r"^[A-Za-z0-9+/=\s]{400,}$")


def _unpacked(value: str, depth: int = 0) -> list:
    text = packed_text(value)
    if text is None:
        return []
    try:
        data = json.loads(text)
    except ValueError:
        return [text]
    out, stack = [], [data]
    while stack:
        item = stack.pop()
        if isinstance(item, dict):
            stack.extend(item.values())
            out.extend(str(key) for key in item)
        elif isinstance(item, list):
            stack.extend(item)
        elif isinstance(item, str):
            nested = _unpacked(item, depth + 1) if depth < 3 and BASE64.match(item) else []
            out.extend(nested or [item])
    return out


def _decoded_bundles() -> list:
    bundles = []
    for index, src in enumerate(_code_cells()):
        for node in ast.walk(ast.parse(_parsable(src))):
            if isinstance(node, ast.Constant) and isinstance(node.value, str) and BASE64.match(node.value):
                texts = _unpacked(node.value)
                if texts:
                    bundles.append((f"agent cell {index} line {node.lineno}", texts))
    for repo, text in notebook_assets():
        texts = _unpacked(text) if BASE64.match(text) else [text]
        if texts:
            bundles.append((repo, texts))
    return bundles


def _demo_code_cells() -> list:
    out = []
    for path in sorted(glob.glob(os.path.join(ROOT, "demos", "**", "*.py"), recursive=True)):
        with open(path, encoding="utf-8") as handle:
            text = handle.read()
        for index, cell in enumerate(text.split("# COMMAND ----------")):
            body = "\n".join(line for line in cell.split("\n") if not line.startswith("# DBTITLE")).strip()
            if not _is_markdown(body):
                out.append((f"{os.path.relpath(path, ROOT)} cell {index}", body))
    return out


def _is_markdown(body: str) -> bool:
    return body.startswith("# MAGIC %md")


def _functions(tree) -> list:
    out = []

    def visit(node, stack):
        named = isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
        here = stack + [node.name] if named else stack
        if isinstance(node, ast.Call):
            func = node.func
            attr = func.attr if isinstance(func, ast.Attribute) else func.id if isinstance(func, ast.Name) else ""
            base = func.value.id if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name) else ""
            if attr in FETCHERS or (base in FETCH_MODULES and attr not in ("values", "items", "keys")):
                out.append((".".join(here) or "<module>", f"{base + '.' if base else ''}{attr}", node.lineno))
        for child in ast.iter_child_nodes(node):
            visit(child, here)

    visit(tree, [])
    return out


def _fetch_sites() -> list:
    sites = []
    for src in _code_cells():
        sites += _functions(ast.parse(_parsable(src)))
    for path in sorted(glob.glob(os.path.join(ROOT, "agent", "app_shell", "server", "*.py"))):
        with open(path, encoding="utf-8") as handle:
            sites += _functions(ast.parse(handle.read()))
    return sites


def test_no_shipped_agent_code_installs_a_package():
    found = []
    for index, src in enumerate(_code_cells()):
        found += [f"agent cell {index} {hit}" for hit in _hits(INSTALL, _without_allowed(src))]
    for name, body in sorted(_embedded_shell()["files"].items()):
        found += [f"embedded App shell {name} {hit}" for hit in _hits(INSTALL, body)]
    for label, body in _demo_code_cells():
        found += [f"{label} {hit}" for hit in _hits(INSTALL, body)]
    assert found == [], f"{len(found)} package install(s) in shipped code:\n" + "\n".join(found[:60])


def test_no_shipped_agent_code_names_a_download_host_or_a_download_url():
    found = []
    for index, src in enumerate(_code_cells()):
        found += [f"agent cell {index} {hit}" for hit in _hits(DOWNLOAD, _without_allowed(src, DOWNLOAD_TEXT_ALLOWED))]
        for node in ast.walk(ast.parse(_parsable(src))):
            if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str) \
                    and re.match(r"https?://", node.value.value.strip()) \
                    and not any(getattr(t, "id", None) in DOWNLOAD_TEXT_ALLOWED for t in node.targets):
                found.append(f"agent cell {index} line {node.lineno}: {[getattr(t, 'id', '?') for t in node.targets]} holds an address")
    for name, body in sorted(_embedded_shell()["files"].items()):
        found += [f"embedded App shell {name} {hit}" for hit in _hits(DOWNLOAD, body) + _hits(WEB_FETCH, body)]
    for label, body in _demo_code_cells():
        found += [f"{label} {hit}" for hit in _hits(DOWNLOAD, body)]
    assert found == [], f"{len(found)} download host(s) or address constant(s) in shipped code:\n" + "\n".join(found[:60])


def test_every_network_call_in_shipped_code_reaches_only_the_workspace():
    sites = _fetch_sites()
    names = {site[0] for site in sites}
    unknown = [site for site in sites if site[0] not in WORKSPACE_ONLY and site[0] not in RELEASE_DOWNLOAD_ONLY]
    assert unknown == [], f"network calls outside the workspace: {unknown}"
    assert set(WORKSPACE_ONLY) | set(RELEASE_DOWNLOAD_ONLY) <= names, "an exception names a function that no longer fetches"


def test_the_one_run_time_download_is_opened_only_by_the_assets_loader():
    users = []
    for src in _code_cells():
        tree = ast.parse(_parsable(src))
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
                for inner in ast.walk(node):
                    if isinstance(inner, ast.Name) and inner.id in RELEASE_DOWNLOAD_ONLY:
                        users.append((node.name, inner.id))
    assert sorted(set(users)) == [("InspireAssets", "inspire_open_release_file"), ("__init__", "inspire_open_release_file")]
    for name in DOWNLOAD_TEXT_ALLOWED:
        assert any(re.search(rf"^{name} = ", src, re.M) for src in _code_cells()), f"{name} is allowed but no longer defined"


def test_a_built_app_never_asks_the_platform_to_install_packages():
    found = []
    for index, src in enumerate(_code_cells()):
        for node in ast.walk(ast.parse(_parsable(src))):
            if isinstance(node, ast.Dict):
                for key, value in zip(node.keys, node.values):
                    if isinstance(key, ast.Constant) and key.value == "requirements.txt" and \
                            not (isinstance(value, ast.Constant) and value.value == ""):
                        found.append(f"agent cell {index} line {node.lineno}: requirements.txt gets {ast.unparse(value)[:120]}")
    assert found == [], "a built App's requirements.txt must stay empty so the Apps platform installs nothing:\n" + "\n".join(found)


def test_every_embedded_bundle_is_decoded_and_holds_no_install_or_download():
    bundles = _decoded_bundles()
    assert bundles and max(len(texts) for _label, texts in bundles) > 50, "the embedded App shell decodes into its files"
    found = []
    for label, texts in bundles:
        for text in texts:
            found += [f"{label} {hit}" for pattern in (INSTALL, DOWNLOAD, WEB_FETCH) for hit in _hits(pattern, text)]
    assert found == [], f"{len(found)} install or download line(s) inside an embedded bundle:\n" + "\n".join(found[:40])


def test_the_bundle_decoder_finds_an_install_and_a_font_host_hidden_two_levels_down():
    inner = base64.b64encode(gzip.compress(json.dumps({"page.js": "load('https://fonts.gstatic.com/s/x.ttf')"}).encode())).decode()
    inner += " " * max(0, 400 - len(inner))
    outer = base64.b64encode(zlib.compress(json.dumps({"files": {"package.json": '{"scripts": {"postinstall": "npm ci"}}',
                                                                  "nested": inner}}).encode())).decode()
    texts = _unpacked(outer + " " * max(0, 400 - len(outer)))
    assert any(INSTALL.search(t) for t in texts) and any(DOWNLOAD.search(t) for t in texts)
    assert _unpacked(base64.b64encode(b"\x00\xffbinary font bytes" * 40).decode()) == [], "binary payloads such as fonts are skipped"


def test_the_gate_catches_each_kind_it_names():
    assert INSTALL.search("%pip install scikit-learn==1.6.1") and INSTALL.search('[sys.executable, "-m", "pip", "install", spec]')
    assert INSTALL.search("npm ci") and INSTALL.search('"postinstall": "node x"') and INSTALL.search("run 'pip install \"weasyprint\"'")
    assert not INSTALL.search("the pipeline installs nothing") and not INSTALL.search("pipeline_id")
    assert DOWNLOAD.search("https://fonts.googleapis.com/css2?family=Inter") and DOWNLOAD.search("/releases/download/v1/x.tar.gz")
    assert not DOWNLOAD.search("https://example.com/release-notes/serverless/environment-version/four")
    assert WEB_FETCH.search("fetch('https://example.com/x')") and not WEB_FETCH.search('<a href="https://example.com/docs">docs</a>')
    tree = ast.parse("def f(u):\n    import urllib.request\n    return urllib.request.urlopen(u)\n")
    assert _functions(tree) == [("f", "urlopen", 3)]
    assert _functions(ast.parse("class A:\n    def g(self):\n        return requests.get('x')\n")) == [("A.g", "requests.get", 3)]
    assert _functions(ast.parse("def s():\n    return requests.Session()\n")) == [("s", "requests.Session", 2)]
    assert _functions(ast.parse("def r(path):\n    return read_user_file_bytes(path)\n")) == []
    assert _functions(ast.parse("def h(requests):\n    return requests.values()\n")) == []
    cells = [("c", "# MAGIC %md\n# MAGIC %pip install is described here"), ("d", "# MAGIC %pip install x==1")]
    assert [label for label, body in cells if _hits(INSTALL, body) and not _is_markdown(body)] == ["d"]
