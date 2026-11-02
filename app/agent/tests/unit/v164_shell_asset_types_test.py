import ast
import json
import mimetypes
import os

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from v141_app_shell_http_test import client  # noqa: E402
from v164_inside_inspire_fonts_test import _shell  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
APP = os.path.join(ROOT, "agent", "app_shell", "server", "app.py")
DIST = os.path.join(ROOT, "agent", "app_shell", "web", "dist")
FIXTURE = os.path.join(ROOT, "tests", "fixtures", "implement_change_classes.json")
EXPECTED = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
            ".json": "application/json", ".map": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2"}


def _asset_types():
    tree = ast.parse(open(APP, encoding="utf-8").read())
    node = next(n for n in tree.body if isinstance(n, ast.Assign) and getattr(n.targets[0], "id", "") == "ASSET_TYPES")
    return ast.literal_eval(node.value)


def _poisoned(monkeypatch):
    table = mimetypes.MimeTypes()
    for mapping in table.types_map:
        for ext in list(mapping):
            mapping[ext] = "text/plain"
    for ext in EXPECTED:
        table.add_type("text/plain", ext)
    monkeypatch.setattr(mimetypes, "_db", table)
    assert {mimetypes.guess_type(f"a{ext}")[0] for ext in EXPECTED} == {"text/plain"}, "the host's type table says text/plain for everything"


def _served(c, rel):
    r = c.get(f"/{rel}")
    return r.status_code, r.headers.get("content-type", ""), r.headers.get("x-content-type-options", "")


def test_the_shell_server_types_every_asset_class_by_its_own_table_and_the_app_holds_the_same_table():
    assert _asset_types() == EXPECTED
    with open(FIXTURE, encoding="utf-8") as handle:
        assert json.load(handle)["asset_types"] == EXPECTED, "the shared fixture carries the table the Inspire App serves the demo with"


def test_every_built_and_embedded_shell_file_is_served_with_its_own_type_and_nosniff_whatever_the_host_says(agent_ns, tmp_path, monkeypatch):
    _poisoned(monkeypatch)
    c = client(tmp_path, monkeypatch)
    static = tmp_path / "static"
    files = {name[len("static/"):]: body for name, body in _shell(agent_ns).items() if name.startswith("static/")}
    if os.path.isdir(DIST):
        for folder, _dirs, found in os.walk(DIST):
            for name in found:
                full = os.path.join(folder, name)
                with open(full, "rb") as handle:
                    files[os.path.relpath(full, DIST).replace(os.sep, "/")] = handle.read()
    samples = {f"assets/sample{ext}": b"x" for ext in EXPECTED}
    samples["block-1a2b3c.webp"] = b"RIFF\x00\x00\x00\x00WEBPVP8 "
    files.update(samples)
    for rel, body in files.items():
        target = static / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body if isinstance(body, bytes) else body.encode("utf-8"))
    typed = {rel: os.path.splitext(rel)[1].lower() for rel in files if os.path.splitext(rel)[1].lower() in EXPECTED}
    assert len(typed) >= len(EXPECTED) + 5 and "block-1a2b3c.webp" in typed
    for rel, ext in typed.items():
        status, kind, sniff = _served(c, rel)
        assert (status, kind, sniff) == (200, EXPECTED[ext], "nosniff"), rel
    assert _served(c, "") == (200, EXPECTED[".html"], "nosniff")
    for rel in [rel for rel in files if rel not in typed]:
        status, kind, sniff = _served(c, rel)
        assert (status, kind, sniff) == (404, "application/json", "nosniff"), f"{rel} has no type, so the App refuses it"


def test_a_file_of_an_unknown_type_is_refused_never_served_as_text_and_every_answer_says_nosniff(tmp_path, monkeypatch):
    _poisoned(monkeypatch)
    c = client(tmp_path, monkeypatch)
    for rel in ("notes.txt", "run.py", "LICENSE", "page.weird", "assets/app.js.bak", "x.HTML5"):
        (tmp_path / "static" / rel).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / "static" / rel).write_text("alert(1)")
        r = c.get(f"/{rel}")
        assert r.status_code == 404 and r.headers["content-type"] == "application/json" and r.json() == {"error": "the App serves no file of that type"}, rel
        assert r.headers["x-content-type-options"] == "nosniff"
        assert "alert(1)" not in r.text
    (tmp_path / "static" / "UPPER.PNG").write_bytes(b"\x89PNG")
    assert _served(c, "UPPER.PNG") == (200, "image/png", "nosniff")
    for path in ("/health", "/api/app", "/api/nope", "/missing.js"):
        assert c.get(path).headers["x-content-type-options"] == "nosniff", path
