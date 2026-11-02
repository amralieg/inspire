"""The App shell's FastAPI adapter, run against the FastAPI the Databricks Apps runtime preinstalls."""
import importlib.util
import json
import os
import shutil
import sys

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")
from fastapi.testclient import TestClient  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

from v141_app_shell_test import PAGE, SETTINGS, FakeWorkspace  # noqa: E402


def client(tmp_path, monkeypatch, **settings):
    for name in ("app.py", "app.yaml", "shell_core.py", "shell_db.py", "shell_sql.py"):
        shutil.copy(os.path.join(SERVER, name), tmp_path / name)
    (tmp_path / "pages").mkdir()
    (tmp_path / "pages" / "n01_u05.json").write_text(json.dumps(PAGE))
    (tmp_path / "inspire_app.json").write_text(json.dumps(dict(SETTINGS, **settings)))
    (tmp_path / "static" / "assets").mkdir(parents=True)
    (tmp_path / "static" / "index.html").write_text("<!doctype html><div id=root></div>")
    (tmp_path / "static" / "assets" / "app.js").write_text("console.log(1)")
    monkeypatch.setenv("DATABRICKS_WAREHOUSE_ID", "wh1")
    monkeypatch.setenv("DATABRICKS_HOST", "dbc-1.example.com")
    spec = importlib.util.spec_from_file_location(f"inspire_shell_app_{id(tmp_path)}", tmp_path / "app.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.shell.sp_factory = FakeWorkspace
    return TestClient(module.app)


def test_health_index_assets_and_api(tmp_path, monkeypatch):
    c = client(tmp_path, monkeypatch)
    assert c.get("/health").json() == {"ok": True, "pages": 1}
    assert "id=root" in c.get("/").text
    assert c.get("/assets/app.js").status_code == 200
    r = c.get("/api/app")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store" and r.json()["title"] == "Pricing desk"
    r = c.post("/api/page", json={"page": "n01_u05", "filters": {"category": ["Books"]}})
    assert r.status_code == 200 and r.json()["kpis"]["total_loss"]["now"] == 120.0


def test_errors_are_json_and_specs_are_never_served(tmp_path, monkeypatch):
    c = client(tmp_path, monkeypatch)
    r = c.get("/api/nope")
    assert r.status_code == 404 and "no API route" in r.json()["error"]
    assert c.post("/api/page", content=b"{bad", headers={"content-type": "application/json"}).status_code == 400
    for path in ("/inspire_app.json", "/pages/n01_u05.json", "/shell_sql.py", "/app.yaml", "/static/../inspire_app.json"):
        r = c.get(path)
        assert r.status_code == 404, path
        assert "SELECT" not in r.text


def test_the_adapter_serves_no_data_download(tmp_path, monkeypatch):
    c = client(tmp_path, monkeypatch)
    for body in ({"page": "n01_u05", "kind": "chart", "id": "by_category"}, {"page": "n01_u05", "kind": "records"}):
        r = c.post("/api/download", json=body)
        assert r.status_code == 404 and r.headers["content-type"].startswith("application/json")
        assert "content-disposition" not in r.headers and r.json() == {"error": "no API route POST /api/download"}
