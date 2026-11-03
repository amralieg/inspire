import base64
import importlib.util
import json
import mimetypes
import os
import re
import zlib

import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import _inspire

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WEB = os.path.join(ROOT, "agent", "app_shell", "web")
GOOGLE = re.compile(r"fonts\.(googleapis|gstatic)\.com")
SUBSETS = {"inter": ("@fontsource-variable/inter", "wght", ("cyrillic-ext", "cyrillic", "greek-ext", "greek", "vietnamese", "latin-ext", "latin")),
           "newsreader": ("@fontsource-variable/newsreader", "opsz", ("vietnamese", "latin-ext", "latin"))}
FONTS = {f"static/assets/fonts/{family}-{subset}-{axis}-normal.woff2": (package, f"files/{family}-{subset}-{axis}-normal.woff2")
         for family, (package, axis, subsets) in SUBSETS.items() for subset in subsets}
IMPORT_LIMIT = 10_000_000
LICENSES = ("static/assets/fonts/inter-LICENSE", "static/assets/fonts/newsreader-LICENSE")


def _embed():
    spec = importlib.util.spec_from_file_location("inspire_app_shell_embed_fonts", os.path.join(ROOT, "agent", "app_shell", "embed.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _shell(ns):
    return ns["implement_app_shell_payload"](ns["inspire_notebook_asset"]("app_shell"))["files"]


def _shell_text(ns, **data):
    files = {f"{name}.py": "" for name in ns["IMPLEMENT_APP_SHELL_MODULES"]}
    body = dict({"version": 1, "example": {}, "files": dict(files, **{"static/index.html": ""})}, **data)
    return base64.b64encode(zlib.compress(json.dumps(body).encode())).decode()


def test_the_embedded_shell_loads_only_its_own_fonts_in_every_subset_google_served_with_their_licenses(agent_ns):
    files = _shell(agent_ns)
    assert [name for name, body in files.items() if isinstance(body, str) and GOOGLE.search(body)] == []
    css = files["static/assets/index.css"]
    assert len(FONTS) == 10
    assert sorted(re.findall(r"url\(([^)]*)\)", css)) == sorted(f"./fonts/{name.rsplit('/', 1)[1]}" for name in FONTS)
    assert len(re.findall(r"unicode-range:", css)) == 10, "each subset downloads only for the characters a page shows"
    assert "@font-face{font-family:Inter;font-style:normal;font-display:swap;font-weight:100 900;" in css
    assert "@font-face{font-family:Newsreader;font-style:normal;font-display:swap;font-weight:200 800;" in css
    assert {name for name, body in files.items() if isinstance(body, bytes)} == set(FONTS)
    assert all(files[name][:4] == b"wOF2" for name in FONTS)
    assert all("SIL Open Font License, Version 1.1" in files[name] for name in LICENSES)
    assert re.findall(r'(?:href|src)="([^"]+)"', files["static/index.html"]) == ["./assets/app.js", "./assets/index.css"]


def test_the_shell_source_names_no_google_fonts_and_pins_the_font_packages():
    names = ["index.html", "vite.config.js"]
    for folder, _dirs, found in os.walk(os.path.join(WEB, "src")):
        names += [os.path.relpath(os.path.join(folder, name), WEB) for name in found]
    hits = []
    for name in names:
        with open(os.path.join(WEB, name), "rb") as handle:
            if GOOGLE.search(handle.read().decode("utf-8", "replace")):
                hits.append(name)
    assert len(names) > 40 and hits == []
    with open(os.path.join(WEB, "package.json"), encoding="utf-8") as handle:
        dependencies = json.load(handle)["dependencies"]
    assert {dependencies["@fontsource-variable/inter"], dependencies["@fontsource-variable/newsreader"]} == {"5.3.0"}


def test_the_embedded_fonts_are_the_pinned_npm_files_byte_for_byte(agent_ns):
    modules = os.path.join(WEB, "node_modules")
    if not os.path.isdir(os.path.join(modules, "@fontsource-variable")):
        pytest.skip("the shell's node_modules is not installed here; run npm ci in agent/app_shell/web")
    files = _shell(agent_ns)
    for name, (package, relative) in FONTS.items():
        with open(os.path.join(modules, package, relative), "rb") as handle:
            assert files[name] == handle.read(), name
    css = files["static/assets/index.css"]
    for family, (package, axis, subsets) in SUBSETS.items():
        with open(os.path.join(modules, package, f"{axis}.css"), encoding="utf-8") as handle:
            sheet = handle.read()
        for subset in subsets:
            want = re.search(rf"files/{family}-{subset}-{axis}-normal\.woff2\).*?unicode-range:\s*([^;]+);", sheet, re.S).group(1).strip()
            got = re.search(rf"fonts/{family}-{subset}-{axis}-normal\.woff2\)[^}}]*?unicode-range:([^;}}]+)", css).group(1)
            assert got == want, f"{family} {subset}"
    for name, package in zip(LICENSES, ("@fontsource-variable/inter", "@fontsource-variable/newsreader")):
        with open(os.path.join(modules, package, "LICENSE"), encoding="utf-8") as handle:
            assert files[name] == handle.read(), name


def test_a_binary_file_in_the_shell_decodes_to_bytes_and_a_broken_one_stops_the_app_with_the_fix(agent_ns):
    decode = agent_ns["implement_app_shell_payload"]
    font = b"wOF2\x00\x01\xff"
    shell = decode(_shell_text(agent_ns, binary={"static/assets/fonts/a.woff2": base64.b64encode(font).decode()}))
    assert shell["files"]["static/assets/fonts/a.woff2"] == font and "binary" not in shell
    assert decode(_shell_text(agent_ns))["files"]["static/index.html"] == "", "a shell with no binary files still loads"
    with pytest.raises(RuntimeError, match="does not decode"):
        decode(_shell_text(agent_ns, binary={"static/assets/fonts/a.woff2": "not base64!"}))
    for broken in ([], {"static/assets/fonts/a.woff2": 5}, None):
        with pytest.raises(RuntimeError, match="carries no usable App shell"):
            decode(_shell_text(agent_ns, binary=broken))


def test_embed_carries_a_font_as_base64_and_names_a_changed_or_missing_font_as_drift(tmp_path):
    embed = _embed()
    dist = tmp_path / "dist"
    (dist / "assets" / "fonts").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html>")
    (dist / "assets" / "app.js").write_text("app")
    (dist / "assets" / "fonts" / "a.woff2").write_bytes(b"wOF2\xff\xfe")
    (dist / "assets" / "fonts" / "a-LICENSE").write_text("SIL Open Font License, Version 1.1")
    data = embed.payload(dist=str(dist))
    assert data["binary"] == {"static/assets/fonts/a.woff2": base64.b64encode(b"wOF2\xff\xfe").decode()}
    assert data["files"]["static/assets/fonts/a-LICENSE"] == "SIL Open Font License, Version 1.1"
    assert "static/assets/fonts/a.woff2" not in data["files"]
    assert embed.decode(embed.encode(data)) == data
    changed = dict(data, binary={"static/assets/fonts/a.woff2": base64.b64encode(b"wOF2").decode()})
    assert embed.differences(data, changed) == ["static/assets/fonts/a.woff2 differs"]
    assert embed.differences(data, dict(data, binary={})) == ["static/assets/fonts/a.woff2 is missing"]
    assert embed.differences(embed.payload(static=False), changed, static=False) == [], "a check without the build ignores built files, fonts included"
    assert "binary" not in embed.payload(static=False)


def test_the_shell_server_answers_a_font_as_font_woff2_even_where_python_knows_no_font_types(tmp_path, monkeypatch):
    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")
    from v141_app_shell_http_test import client
    table = mimetypes.MimeTypes()
    for mapping in table.types_map:
        mapping.pop(".woff2", None)
    monkeypatch.setattr(mimetypes, "_db", table)
    assert mimetypes.guess_type("a.woff2")[0] is None, "this stands for Python 3.11 in a container with no system MIME table"
    c = client(tmp_path, monkeypatch)
    (tmp_path / "static" / "assets" / "fonts").mkdir()
    (tmp_path / "static" / "assets" / "fonts" / "a.woff2").write_bytes(b"wOF2\xff")
    r = c.get("/assets/fonts/a.woff2")
    assert r.status_code == 200 and r.headers["content-type"] == "font/woff2" and r.content == b"wOF2\xff"


def test_an_app_that_already_holds_the_fonts_is_read_back_as_bytes_before_inspire_changes_it_and_put_back_as_bytes(fresh_ns, monkeypatch):
    inst = _inspire(fresh_ns, FakeSpark())
    source = "/Workspace/Users/someone/apps/my-app"
    font = "static/assets/fonts/inter-latin-wght-normal.woff2"
    reads = []

    def text(path, _client=None):
        reads.append(("text", path))
        if path.endswith(".woff2"):
            raise UnicodeDecodeError("utf-8", b"\xff", 0, 1, "invalid start byte")
        if path.endswith("app.yaml"):
            raise FileNotFoundError(f"{path} does not exist")
        return "the App file before"

    def raw(path):
        reads.append(("bytes", path))
        if path.endswith("newsreader-latin-opsz-normal.woff2"):
            raise RuntimeError(f"RESOURCE_DOES_NOT_EXIST: {path} does not exist")
        return b"wOF2 before"

    monkeypatch.setitem(fresh_ns, "read_user_text_file", text)
    inst._implement_workspace_bytes = raw
    files = {"app.py": "new", "app.yaml": "new", font: b"wOF2 new", "static/assets/fonts/newsreader-latin-opsz-normal.woff2": b"wOF2 new"}
    before = inst._implement_app_before("my-app", {"user_api_scopes": ["sql"], "resources": [], "active_deployment": {"deployment_id": "d1"}},
                                        source, files)
    assert before["files"] == {"app.py": "the App file before", "app.yaml": None, font: b"wOF2 before",
                               "static/assets/fonts/newsreader-latin-opsz-normal.woff2": None}
    assert ("text", f"{source}/{font}") not in reads, "a font is never read as text"
    calls = []
    inst.w_client = type("Client", (), {"workspace": type("Ws", (), {"mkdirs": staticmethod(lambda path: None)})()})()
    inst._implement_api = lambda method, path, body=None, **_kw: calls.append((method, path, body)) or {}
    inst._implement_write_app_files(source, {k: v for k, v in before["files"].items() if v is not None})
    written = {body["path"]: base64.b64decode(body["content"]) for method, path, body in calls if path == "/api/2.0/workspace/import"}
    assert written == {f"{source}/app.py": b"the App file before", f"{source}/{font}": b"wOF2 before"}


def test_the_notebook_with_its_fonts_stays_under_the_workspace_import_limit():
    with open(os.path.join(ROOT, "agent", "dbx_inspire_ai_agent.ipynb"), "rb") as handle:
        notebook = handle.read()
    body = json.dumps({"path": "/Workspace/Shared/inspire_ai/dbx_inspire_ai_agent", "format": "JUPYTER", "content": base64.b64encode(notebook).decode(),
                       "language": "PYTHON", "overwrite": True})
    assert len(body.encode()) < IMPORT_LIMIT, f"the import request is {len(body.encode())} bytes, over the 10 MB workspace import limit"
