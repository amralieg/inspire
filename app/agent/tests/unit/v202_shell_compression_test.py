import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from v141_app_shell_http_test import client  # noqa: E402

BIG_JS = "console.log('the shell bundle');\n" * 400


def _bundle(tmp_path):
    (tmp_path / "static" / "assets" / "app.js").write_text(BIG_JS)


def test_the_shell_server_gzips_its_bundle_and_says_revalidate_so_a_reload_does_not_download_it_again(tmp_path, monkeypatch):
    c = client(tmp_path, monkeypatch)
    _bundle(tmp_path)
    r = c.get("/assets/app.js", headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200 and r.headers["content-encoding"] == "gzip"
    assert r.text == BIG_JS
    assert int(r.headers["content-length"]) < len(BIG_JS.encode()) // 4
    assert r.headers["cache-control"] == "no-cache" and r.headers["content-type"] == "text/javascript; charset=utf-8"
    assert r.headers["x-content-type-options"] == "nosniff" and "accept-encoding" in r.headers["vary"].lower()
    again = c.get("/assets/app.js", headers={"Accept-Encoding": "gzip", "If-None-Match": r.headers["etag"]})
    assert again.status_code == 304 and again.content == b""


def test_a_client_that_takes_no_compression_gets_the_plain_bundle(tmp_path, monkeypatch):
    c = client(tmp_path, monkeypatch)
    _bundle(tmp_path)
    r = c.get("/assets/app.js", headers={"Accept-Encoding": "identity"})
    assert r.status_code == 200 and "content-encoding" not in r.headers and r.text == BIG_JS
    assert r.headers["cache-control"] == "no-cache"


def test_api_answers_over_the_size_floor_are_gzipped_and_small_ones_are_not(tmp_path, monkeypatch):
    c = client(tmp_path, monkeypatch)
    small = c.get("/health", headers={"Accept-Encoding": "gzip"})
    assert small.status_code == 200 and "content-encoding" not in small.headers
    (tmp_path / "static" / "index.html").write_text("<!doctype html><div id=root></div>" + "<!-- pad -->" * 200)
    page = c.get("/", headers={"Accept-Encoding": "gzip"})
    assert page.headers["content-encoding"] == "gzip" and page.headers["cache-control"] == "no-cache"
    assert "id=root" in page.text
