"""Free content blocks on an App page: text, images and styled HTML placed anywhere on the page. The server's page check refuses
what a block must never hold, so a bad block fails the build and never reaches a browser; Inspire reads each image from its
workspace or volume path, never from the internet, knows it by its bytes, and copies it into the App so the App never hot-links; an
image it cannot use leaves its alt text and a note and the build goes on; the dashboard draws text and image blocks as text
widgets; and the vibe judge sees each block as a person sees it, with the image bytes at hand, offline."""
import base64
import hashlib
import json
import os
import re
import sys
import types

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
TESTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for folder in (SERVER, TESTS):
    if folder not in sys.path:
        sys.path.insert(0, folder)

import shell_core  # noqa: E402
import shell_sql  # noqa: E402
from _agentload import fresh_agent_namespace  # noqa: E402
from v120_artifacts_support import FakeSpark  # noqa: E402
from v140_implement_test import SHELL_FILES, _app_flow, _churn_page, _deploy_inspire, _inspire, sdk_stub  # noqa: E402,F401
from v141_app_shell_test import PAGE, SETTINGS, call, shell  # noqa: E402
from v142_dash_test import RESULT, _canvas, _page, _shell, _widgets  # noqa: E402

WEB_SRC = os.path.join(ROOT, "agent", "app_shell", "web", "src")
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 16
GIF = b"GIF89a" + b"\x00" * 16
WEBP = b"RIFF\x10\x00\x00\x00WEBPVP8 " + b"\x00" * 8
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
URL = "https://images.example.org/mascot.png"
VOLUME = "/Volumes/main/brand/assets/mascot.png"
FILE = f"blocks/{hashlib.sha256(PNG).hexdigest()}.png"
CONTENT = {"text": "## A note\nRead **this** first, then [the guide](https://docs.example.org/guide).",
           "html": '<div class="card" style="color:#123;background:url(data:image/png;base64,AAAA)"><b>Hello</b></div>',
           "image": {"url": URL, "alt": "The mascot waving", "caption": "Our mascot", "height": 240}}


def block(ident="note", kind="text", where="top", of=None, **changes):
    place = {"where": where} if of is None else {"where": where, "of": of}
    return dict({"id": ident, "kind": kind, "place": place, "width": "full", "align": "left",
                 "content": json.loads(json.dumps(CONTENT[kind]))}, **changes)


def with_blocks(*blocks, page=None):
    return dict(json.loads(json.dumps(page or PAGE)), blocks=list(blocks))


@pytest.fixture(scope="module")
def blocks_ns():
    return fresh_agent_namespace()


PLACES = [("top", None), ("bottom", None), ("before", "filters"), ("after", "kpis"), ("beside", "records"), ("after", "charts"),
          ("before", "total_loss"), ("beside", "loss_trend"), ("after", "pareto")]


@pytest.mark.parametrize("kind", ["text", "image", "html"])
@pytest.mark.parametrize("where,of", PLACES)
def test_each_kind_of_block_sits_at_each_place_passes_the_page_check_and_reaches_the_browser_there(kind, where, of):
    shape = {"width": "narrow", "align": "right"} if where == "beside" else {"width": "half", "align": "center"}
    page = with_blocks(block("b1", kind, where, of, **shape))
    assert shell_sql.spec_problems(page) == []
    served = shell_core.public_page(page)["blocks"]
    assert [(b["id"], b["kind"], b["place"], b["width"], b["align"]) for b in served] == [("b1", kind, page["blocks"][0]["place"],
                                                                                         shape["width"], shape["align"])]
    side = {"top": "after", "bottom": "after", "beside": "right"}.get(where, where)
    assert [b["id"] for b in shell_sql.block_plan(page)[of or f"@{where}"][side]] == ["b1"]


def test_blocks_placed_by_other_blocks_line_up_in_the_order_they_name():
    page = with_blocks(block("b1", "text", "after", "kpis"), block("b2", "image", "after", "b1"), block("b3", "text", "before", "b1"),
                       block("b4", "html", "beside", "records", width="narrow", align="right"), block("b5", "text", "bottom"))
    assert shell_sql.spec_problems(page) == []
    plan = shell_sql.block_plan(page)
    assert [b["id"] for b in plan["kpis"]["after"]] == ["b3", "b1", "b2"]
    assert [b["id"] for b in plan["records"]["right"]] == ["b4"] and plan["records"]["left"] == []
    assert [b["id"] for b in plan["@bottom"]["after"]] == ["b5"]


def test_styled_html_with_a_style_sheet_tables_data_images_and_aria_passes_the_check():
    html = ('<style>.card{border:1px solid #ccd;border-radius:8px;padding:12px}.card h2{font:600 16px/1.2 serif}</style>'
            '<section class="card" aria-label="Note" data-tone="calm"><h2>Read me</h2><p>Plain <em>text</em> and a '
            '<a href="https://docs.example.org" target="_blank" rel="noopener">link</a> or <a href="mailto:team@example.org">mail</a>.'
            '</p><table><tr><th scope="col">A</th></tr><tr><td colspan="2">1</td></tr></table>'
            '<img src="data:image/png;base64,iVBORw0KGgo=" alt="dot" width="8" height="8"></section>')
    assert shell_sql.html_problems("block b1", html) == []


def _html(content):
    return block("b1", "html", content=content)


REFUSED = [
    ("script", _html("<p>Hi</p><script>alert(1)</script>"), "block b1 uses <script>, which a block cannot hold, since it runs code"),
    ("onerror", _html('<img src="data:image/png;base64,AAAA" alt="x" onerror="alert(1)">'),
     "block b1 <img> has the event handler onerror, which a block cannot hold"),
    ("onclick upper case", _html('<div ONCLICK="alert(1)">x</div>'), "block b1 <div> has the event handler onclick"),
    ("javascript link", _html('<a href="java&#x09;script:alert(1)">go</a>'), "block b1 <a> links to 'java\\tscript:alert(1)'"),
    ("data link", _html('<a href="data:text/html;base64,PHNjcmlwdD4=">go</a>'), "a link goes to an http, https or mailto address"),
    ("iframe", _html('<iframe title="x"></iframe>'), "block b1 uses <iframe>, which a block cannot hold, since it runs code"),
    ("object", _html("<object></object>"), "block b1 uses <object>, which a block cannot hold"),
    ("embed", _html("<embed>"), "block b1 uses <embed>, which a block cannot hold"),
    ("form", _html("<form><input name=q></form>"), "block b1 uses <form>, which a block cannot hold"),
    ("svg", _html("<svg><circle r=4></circle></svg>"), "block b1 uses <svg>, which a block cannot hold"),
    ("outside image", _html('<img src="https://x.example.org/a.png" alt="a">'),
     "block b1 <img> loads 'https://x.example.org/a.png'; an image inside html is a data:image URL"),
    ("src on a div", _html('<div src="x">x</div>'), "block b1 <div> has the attribute src, which only an <img> takes"),
    ("srcset", _html('<img srcset="https://x.example.org/a.png 2x" alt="a">'), "block b1 <img> has the attribute srcset"),
    ("css import", _html('<style>@import "https://x.example.org/a.css";</style>'), "block b1 <style> styles use '@import'"),
    ("css url", _html('<div style="background:url(https://x.example.org/t.gif)">x</div>'),
     "block b1 <div> styles load 'https://x.example.org/t.gif'; a style loads only a data:image URL"),
    ("css expression", _html('<div style="width:expression(alert(1))">x</div>'), "styles use 'expression('"),
    ("css escape", _html('<div style="background:\\75 rl(x)">x</div>'), "write the character itself, not a CSS escape"),
    ("document", _html("<!DOCTYPE html><p>x</p>"), "a block holds a piece of HTML, not a whole document"),
    ("empty html", _html("  "), "block b1 is an html block, so its content is the HTML and CSS it shows"),
    ("oversized html", _html("<p>" + "x" * 20000 + "</p>"), "block b1 html is longer than 20,000 characters"),
    ("text image", block("b1", "text", content="![cat](https://x.example.org/cat.png)"), "put an image in an image block"),
    ("text javascript link", block("b1", "text", content="[go](javascript:alert(1))"), "block b1 links to 'javascript:alert(1"),
    ("text with html", block("b1", "text", content="Hello <b>there</b>"), "block b1 text holds HTML tags"),
    ("oversized text", block("b1", "text", content="x" * 4001), "block b1 text is longer than 4,000 characters"),
    ("text not text", block("b1", "text", content={"text": "x"}), "block b1 is a text block, so its content is the Markdown text"),
    ("image without alt", block("b1", "image", content={"url": URL}), "block b1 has no alt"),
    ("image not a path", block("b1", "image", content={"url": "ftp://x.example.org/a.png", "alt": "a"}),
     "block b1 url must be the /Workspace/... or /Volumes/... path of the image"),
    ("image short volume", block("b1", "image", content={"url": "/Volumes/main/a.png", "alt": "a"}),
     "block b1 url must be the /Workspace/... or /Volumes/... path of the image"),
    ("image height", block("b1", "image", content={"url": URL, "alt": "a", "height": 5000}),
     "block b1 height must be a whole number of pixels from 40 to 1200"),
    ("image file genie set", block("b1", "image", content={"url": URL, "alt": "a", "file": "../../app.py"}),
     "block b1 file '../../app.py' is not an image Inspire copied into the App"),
    ("image extra field", block("b1", "image", content={"url": URL, "alt": "a", "srcset": "x"}), "block b1 content has srcset"),
    ("unknown kind", dict(block("b1"), kind="video"), "block b1 kind must be one of text, image, html"),
    ("unknown field", block("b1", style="x"), "block b1 has style; a block takes id, kind, place, width, align, content"),
    ("unknown element", block("b1", "text", "after", "nope"),
     "block b1 sits after nope, which the page does not have; name one of: filters, kpis, charts, records, total_loss"),
    ("no element", block("b1", "text", "before", ""), "block b1 sits before an element, so its place needs of, one of: filters"),
    ("itself", block("b1", "text", "after", "b1"), "block b1 cannot sit after itself"),
    ("place not an object", block("b1", place="top"), "block b1 place must be"),
    ("unknown where", block("b1", "text", "middle"), "block b1 place must be"),
    ("top with of", block("b1", "text", "top", "kpis"), "block b1 sits at the page top, so its place takes no of"),
    ("beside full width", block("b1", "text", "beside", "records"),
     "block b1 sits beside records, so its width is wide, half or narrow, not full"),
    ("beside center", block("b1", "text", "beside", "records", width="narrow", align="center"),
     "block b1 sits beside records: its align says the side, left or right, not center"),
    ("width", block("b1", width="huge"), "block b1 width must be one of full, wide, half, narrow"),
    ("align", block("b1", align="middle"), "block b1 align must be one of left, center, right"),
    ("id of a KPI", block("total_loss"), "block total_loss has the id of a KPI; give the block an id of its own"),
    ("id of the KPI row", block("kpis"), "block kpis has the id of the KPI row"),
    ("bad id", block("b 1"), "block 'b 1' needs an id of letters, digits and underscores"),
]


@pytest.mark.parametrize("case,given,needle", REFUSED, ids=[c[0] for c in REFUSED])
def test_the_page_check_refuses_what_a_block_must_never_hold(case, given, needle):
    problems = shell_sql.spec_problems(with_blocks(given))
    assert any(needle in p for p in problems), problems


@pytest.mark.parametrize("blocks,needle", [
    ([block("b1"), block("b1")], "block b1 appears twice"),
    ([block("b1", "text", "after", "kpis"), block("b2", "text", "beside", "b1", width="narrow", align="right")],
     "block b2 sits beside the block b1"),
    ([block("b1", "text", "after", "b2"), block("b2", "text", "after", "b1")], "blocks b1 then b2 then b1 place each other in a circle"),
    ([block(f"b{i}") for i in range(9)], "the page has 9 blocks; it needs 0 to 8"),
], ids=["duplicate", "beside a block", "circle", "too many"])
def test_blocks_that_clash_with_each_other_are_refused(blocks, needle):
    problems = shell_sql.spec_problems(with_blocks(*blocks))
    assert any(needle in p for p in problems), problems


def test_a_block_by_an_id_two_elements_share_is_refused_and_a_page_with_no_list_of_blocks_too():
    page = with_blocks(block("b1", "text", "after", "total_loss"))
    page["charts"][0]["id"] = "total_loss"
    assert any("block b1 sits after total_loss, which is both a KPI and a chart; give them different ids" in p
               for p in shell_sql.spec_problems(page))
    assert shell_sql.blocks_problems(dict(PAGE, blocks="mascot")) == [
        "the page blocks must be a list of block objects, each {id, kind, place, width, align, content}"]


def test_a_page_without_blocks_checks_plans_and_serves_exactly_as_before():
    assert "blocks" not in PAGE
    assert shell_sql.spec_problems(PAGE) == shell_sql.spec_problems(with_blocks()) == []
    assert shell_sql.blocks_problems(PAGE) == [] and shell_sql.block_plan(PAGE) == {} and shell_sql.image_blocks(PAGE) == []
    served = shell_core.public_page(PAGE)
    assert served["blocks"] == []
    assert {k: v for k, v in shell_core.public_page(with_blocks(block("b1"))).items() if k != "blocks"} == \
        {k: v for k, v in served.items() if k != "blocks"}


def test_the_app_refuses_to_start_on_a_page_whose_block_holds_a_script():
    problems = shell_core.settings_problems(SETTINGS, [with_blocks(_html("<script>alert(1)</script>"))])
    assert any(p.startswith("page n01_u05: block b1 uses <script>") for p in problems), problems


def test_the_app_serves_an_image_block_by_its_copied_file_never_its_web_address(tmp_path):
    image = block("mascot", "image", "after", "kpis", width="narrow", align="center")
    image["content"]["file"] = FILE
    s, *_rest = shell(tmp_path, pages=[with_blocks(image, block("intro"))])
    status, out = call(s, "GET", "app")
    assert status == 200
    served = {b["id"]: b for b in out["pages"][0]["blocks"]}
    assert served["mascot"] == {"id": "mascot", "kind": "image", "place": {"where": "after", "of": "kpis"}, "width": "narrow",
                                "align": "center", "content": {"file": FILE, "alt": "The mascot waving", "caption": "Our mascot",
                                                               "height": 240}}
    assert URL not in json.dumps(out), "the App never hands the browser the image's web address"
    assert served["intro"]["content"] == CONTENT["text"]


def _js_list(path, name):
    with open(path, encoding="utf-8") as handle:
        text = handle.read()
    return set(re.findall(r"'([a-z0-9-]+)'", re.search(rf"export const {name} = \[(.*?)\];", text, re.S).group(1)))


def _js_regex(path, name):
    with open(path, encoding="utf-8") as handle:
        return re.search(rf"const {name} = /(.*)/[a-z]*;", handle.read()).group(1)


def test_the_web_sanitizer_and_the_server_check_allow_exactly_the_same_html_links_and_styles():
    blocks_js, markdown_js = os.path.join(WEB_SRC, "blocks.js"), os.path.join(WEB_SRC, "markdown.js")
    assert _js_list(blocks_js, "HTML_TAGS") == set(shell_sql.HTML_TAGS)
    assert _js_list(blocks_js, "HTML_ATTRS") == set(shell_sql.HTML_ATTRS)
    assert _js_regex(blocks_js, "CSS_BANNED") == shell_sql._CSS_BANNED.pattern
    assert _js_regex(blocks_js, "DATA_IMAGE").replace("\\/", "/") == shell_sql._DATA_IMAGE.pattern
    assert _js_regex(blocks_js, "BLOCK_FILE").replace("\\/", "/") == shell_sql.BLOCK_FILE.pattern
    assert _js_regex(markdown_js, "SAFE_LINK") == shell_sql._SAFE_LINK.pattern
    assert not set(shell_sql.HTML_CODE_TAGS) & set(shell_sql.HTML_TAGS)


@pytest.mark.parametrize("data,kind", [(PNG, "png"), (JPG, "jpg"), (GIF, "gif"), (WEBP, "webp"), (SVG, ""), (b"<html></html>", "")])
def test_an_image_is_known_by_its_bytes_never_by_its_name(agent_ns, data, kind):
    assert agent_ns["implement_image_kind"](data) == kind


@pytest.mark.parametrize("data,media,needle", [
    (SVG, "image/svg+xml", "is an SVG image, which can carry code, so the App does not take it"),
    (b'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>', "", "is an SVG image"),
    (b"<html><body>Not found</body></html>", "text/html", "is not a PNG, JPEG, GIF or WebP image (its server calls it text/html)"),
    (b"", "image/png", "is empty"),
    (PNG + b"\x00" * (2 * 1024 * 1024), "image/png", "is larger than 2 MB"),
], ids=["svg with script", "plain svg", "html page", "empty", "oversized"])
def test_an_svg_a_page_that_is_not_an_image_an_empty_and_an_oversized_download_are_refused(agent_ns, data, media, needle):
    assert needle in agent_ns["implement_image_problem"](data, shell_sql.CAPS["image_bytes"], media)


def test_a_real_image_passes_the_image_check(agent_ns):
    assert [agent_ns["implement_image_problem"](d, shell_sql.CAPS["image_bytes"], "") for d in (PNG, JPG, GIF, WEBP)] == ["", "", "", ""]


@pytest.mark.parametrize("url,kind", [
    ("/Volumes/main/brand/assets/mascot.png", "volume"),
    ("/Workspace/Users/someone/brand/mascot.png", "workspace"),
    ("https://images.example.org/mascot.png", "internet"),
    ("http://93.184.216.34/mascot.png", "internet"),
    ("/Volumes/main/brand/mascot.png", ""),
    ("/Workspace/Users/../../etc/passwd", ""),
    ("file:///etc/passwd", ""),
    ("ftp://93.184.216.34/a.png", ""),
    ("", ""),
])
def test_one_helper_names_where_an_image_lives_and_only_a_workspace_or_volume_path_is_read(agent_ns, url, kind):
    assert agent_ns["implement_image_source"](url, shell_sql) == (kind, url)


@pytest.fixture
def no_network(blocks_ns, monkeypatch):
    import socket
    import urllib.request
    calls = []

    def refuse(*args, **kwargs):
        calls.append(args[:2])
        raise AssertionError("no network call may be made for an image")

    monkeypatch.setattr(socket, "getaddrinfo", refuse)
    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(urllib.request, "urlopen", refuse)
    monkeypatch.setitem(blocks_ns, "read_user_file_bytes", refuse)
    return calls


def test_an_internet_image_is_never_fetched_and_says_why(blocks_ns, no_network):
    for url in (URL, "http://93.184.216.34/mascot.png"):
        data, problem = blocks_ns["implement_checked_image"](url, shell_sql)
        assert data is None and problem == "is an internet address, which Inspire never reads at run time"
    assert no_network == []


def test_a_volume_image_is_read_from_its_path_with_the_size_cap(blocks_ns, monkeypatch):
    asked = []
    monkeypatch.setitem(blocks_ns, "read_user_file_bytes", lambda path, w_client=None, limit=None: asked.append((path, limit)) or PNG)
    assert blocks_ns["implement_checked_image"](VOLUME, shell_sql) == (PNG, "")
    assert asked == [(VOLUME, shell_sql.CAPS["image_bytes"])]
    monkeypatch.setitem(blocks_ns, "read_user_file_bytes", lambda path, w_client=None, limit=None: PNG + b"\x00" * (limit + 1))
    assert blocks_ns["implement_checked_image"](VOLUME, shell_sql) == (None, "is larger than 2 MB")


def test_the_user_file_reader_reads_a_volume_image_as_bytes_within_its_cap(blocks_ns):
    class Download:
        def __init__(self, data):
            self.contents = __import__("io").BytesIO(data)

    class Client:
        files = types.SimpleNamespace(download=lambda file_path: Download(PNG + b"tail"))

    assert blocks_ns["read_user_file_bytes"](VOLUME, Client()) == PNG + b"tail"
    assert blocks_ns["read_user_file_bytes"](VOLUME, Client(), limit=3) == PNG[:4]
    assert blocks_ns["read_user_text_file"]("/Volumes/main/brand/assets/note.txt", types.SimpleNamespace(
        files=types.SimpleNamespace(download=lambda file_path: Download("na\u00efve".encode("utf-8"))))) == "na\u00efve"


def _fetching(ns, monkeypatch, answers):
    asked = []

    def read(path, limit):
        asked.append(path)
        answer = answers[path] if isinstance(answers, dict) else answers
        if isinstance(answer, Exception):
            raise answer
        return answer

    monkeypatch.setitem(ns, "implement_read_image", read)
    return asked


def _image_page(ns, *extra, url=VOLUME):
    image = block("mascot", "image", "after", "kpis", width="narrow", align="center")
    image["content"]["url"] = url
    return _churn_page(ns, blocks=[image, *extra])


def test_genie_round_copies_the_image_into_the_app_and_the_page_names_the_copy(blocks_ns, monkeypatch, tmp_path):
    asked = _fetching(blocks_ns, monkeypatch, PNG)
    page = _image_page(blocks_ns, block("intro"))
    page["blocks"][0]["content"]["file"] = "blocks/" + "0" * 64 + ".png"
    inst, context, seen = _app_flow(blocks_ns, tmp_path, page=page, assets={"genie_space": "g1"})
    inst._implement_app(context, None)
    assert seen["errors"] == [] and asked == [VOLUME]
    _name, files, _reads, _space = seen["deployed"][0]
    built = json.loads(files["pages/n01_u01.json"])
    assert built["blocks"][0]["content"] == dict(CONTENT["image"], url=VOLUME, file=FILE), "Inspire sets the file from the bytes, never Genie"
    assert built["blocks"][1] == block("intro")
    stored = tmp_path / "implement" / "_app_blocks" / FILE
    assert stored.read_bytes() == PNG
    assert inst._implement_app_block_files(files, "/W/src/churn-desk") == {f"static/{FILE}": PNG}
    assert context["artifacts"]["app"]["blocks"][0]["content"]["file"] == FILE


@pytest.mark.parametrize("url,answer,needle", [
    (VOLUME, b"<html>Not found</html>", "is not a PNG, JPEG, GIF or WebP image"),
    (VOLUME, SVG, "is an SVG image, which can carry code"),
    (VOLUME, RuntimeError("RESOURCE_DOES_NOT_EXIST: no such file"), "could not be read: RESOURCE_DOES_NOT_EXIST: no such file"),
    (URL, AssertionError("an internet image is never read"), "is an internet address, which Inspire never reads at run time"),
], ids=["not an image", "svg with script", "read fails", "internet address"])
def test_an_image_inspire_cannot_use_is_left_out_and_the_page_still_deploys_with_a_build_note(blocks_ns, monkeypatch, tmp_path, url,
                                                                                               answer, needle):
    asked = _fetching(blocks_ns, monkeypatch, answer)
    inst, context, seen = _app_flow(blocks_ns, tmp_path, page=_image_page(blocks_ns, url=url), assets={"genie_space": "g1"})
    fields = inst._implement_app(context, None)
    assert seen["errors"] == [] and len(seen["deployed"]) == 1, "an image never fails the build"
    assert asked == ([] if url == URL else [VOLUME])
    built = json.loads(seen["deployed"][0][1]["pages/n01_u01.json"])
    assert "file" not in built["blocks"][0]["content"] and built["blocks"][0]["content"]["alt"] == "The mascot waving"
    notes = [w for w in fields.get("_warnings") or [] if "block mascot" in w]
    assert len(notes) == 1 and notes[0].startswith("App: block mascot shows its alt text and a note in place of its image, because ")
    assert needle in notes[0] and notes[0].endswith("put the image in the workspace or a Unity Catalog volume and name that path in the block")
    assert not (tmp_path / "implement" / "_app_blocks").exists()


def test_a_page_without_image_blocks_downloads_nothing_and_deploys_no_image(blocks_ns, monkeypatch, tmp_path):
    asked = _fetching(blocks_ns, monkeypatch, RuntimeError("no download expected"))
    inst, context, seen = _app_flow(blocks_ns, tmp_path, page=_churn_page(blocks_ns), assets={"genie_space": "g1"})
    inst._implement_app(context, None)
    assert seen["errors"] == [] and asked == []
    files = seen["deployed"][0][1]
    assert inst._implement_app_block_files(files, "/W/src/churn-desk") == {}
    assert not any(name.startswith("static/blocks/") for name in files)


def _block_files_inst(ns, tmp_path, present=()):
    inst = _inspire(ns, FakeSpark())
    inst.local_log_output_dir = str(tmp_path)
    calls = []

    def api(method, path, body=None, query=None):
        calls.append((method, path, (query or {}).get("path")))
        if path == "/api/2.0/workspace/get-status" and query["path"] not in present:
            raise RuntimeError("RESOURCE_DOES_NOT_EXIST: no such path")
        return {}

    inst._implement_api = api
    return inst, calls


def _page_files(ns, page):
    return {"pages/n01_u01.json": json.dumps(page) + "\n", "inspire_app.json": "{}\n"}


def test_a_later_deploy_keeps_the_copy_the_app_folder_holds_and_downloads_only_what_it_lacks(blocks_ns, monkeypatch, tmp_path):
    page = _image_page(blocks_ns)
    page["blocks"][0]["content"]["file"] = FILE
    asked = _fetching(blocks_ns, monkeypatch, PNG)
    inst, calls = _block_files_inst(blocks_ns, tmp_path, present={f"/W/src/static/{FILE}"})
    assert inst._implement_app_block_files(_page_files(blocks_ns, page), "/W/src") == {}
    assert asked == [] and calls == [("GET", "/api/2.0/workspace/get-status", f"/W/src/static/{FILE}")]
    inst, _calls = _block_files_inst(blocks_ns, tmp_path)
    assert inst._implement_app_block_files(_page_files(blocks_ns, page), "/W/src") == {f"static/{FILE}": PNG} and asked == [VOLUME]


@pytest.mark.parametrize("url,answer", [(VOLUME, GIF), (URL, AssertionError("an internet image is never read"))],
                         ids=["changed at its path", "internet address"])
def test_an_image_the_app_folder_lacks_and_inspire_cannot_read_again_is_left_out_and_the_deploy_goes_on(blocks_ns, monkeypatch, tmp_path,
                                                                                                        url, answer):
    page = _image_page(blocks_ns, url=url)
    page["blocks"][0]["content"]["file"] = FILE
    asked = _fetching(blocks_ns, monkeypatch, answer)
    inst, _calls = _block_files_inst(blocks_ns, tmp_path)
    files = _page_files(blocks_ns, page)
    assert inst._implement_app_block_files(files, "/W/src") == {}
    assert asked == ([] if url == URL else [VOLUME])
    kept = json.loads(files["pages/n01_u01.json"])["blocks"][0]["content"]
    assert "file" not in kept and kept["alt"] == "The mascot waving", "the page the App gets shows the alt text, never a broken image"
    kept_page = json.loads(files["pages/n01_u01.json"])
    assert inst._implement_app_block_files(_page_files(blocks_ns, kept_page), "/W/src") == {}, "a block without a copy needs no file"


def test_the_deploy_writes_the_image_bytes_into_the_app_source_next_to_the_page(blocks_ns, sdk_stub, tmp_path):
    page = _image_page(blocks_ns)
    page["blocks"][0]["content"]["file"] = FILE
    stored = tmp_path / "implement" / "_app_blocks" / FILE
    stored.parent.mkdir(parents=True)
    stored.write_bytes(PNG)
    inst, context, _calls, _imported = _deploy_inspire(blocks_ns, [
        RuntimeError("RESOURCE_DOES_NOT_EXIST: app churn-desk"),
        {"compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-1"},
        {"deployment_id": "dep1", "status": {"state": "SUCCEEDED"}}, {"url": "https://churn-desk.example/"}])
    inst.local_log_output_dir = str(tmp_path)
    written = []
    inst._implement_write_app_files = lambda source, files: written.append((source, files))
    files = dict(SHELL_FILES, **{"pages/n01_u01.json": json.dumps(page) + "\n"})
    inst._implement_deploy_app(context, "churn-desk", files, ["main.inspire.churn_out"], poll_s=0)
    source, sent = written[0]
    assert sent[f"static/{FILE}"] == PNG and set(sent) == set(files) | {f"static/{FILE}"}


def test_the_app_source_writer_sends_bytes_as_they_are_and_text_as_utf8(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    sent = []
    inst.w_client = types.SimpleNamespace(workspace=types.SimpleNamespace(mkdirs=lambda path: None))
    inst._implement_api = lambda method, path, body=None, query=None: sent.append(body)
    inst._implement_write_app_files("/W/src", {f"static/{FILE}": PNG, "pages/p.json": "{\"title\": \"Caf\u00e9\"}\n"})
    assert [(b["path"], base64.b64decode(b["content"])) for b in sent] == [
        (f"/W/src/static/{FILE}", PNG), ("/W/src/pages/p.json", "{\"title\": \"Caf\u00e9\"}\n".encode("utf-8"))]


def test_the_vibe_judge_sees_each_block_as_a_person_sees_it(agent_ns):
    html = block("banner", "html", "beside", "records", width="narrow", align="right",
                 content='<style>.x{color:red}</style><div class="x"><h2>Welcome</h2><p>Mickey <b>waves</b></p>'
                         '<img src="data:image/png;base64,AAAA" alt="a small ear"></div>')
    page = _image_page(agent_ns, block("intro", content="## Hello\n- first\n- second"), html)
    seen = agent_ns["implement_page_blocks_seen"](page)
    assert list(seen) == ["mascot", "intro", "banner"]
    assert seen["mascot"]["node"] == {"kind": "image", "place": "after kpis", "align": "center", "width": "narrow", "text": "",
                                      "alt": "The mascot waving", "caption": "Our mascot"}
    assert seen["mascot"]["lines"] == ["image block mascot, after kpis, narrow width, aligned center", "image: The mascot waving",
                                       "caption: Our mascot"]
    assert seen["intro"]["lines"] == ["text block intro, at the page top, full width, aligned left", "## Hello", "- first", "- second"]
    assert seen["banner"]["node"]["text"] == "Welcome Mickey waves [image: a small ear]"
    assert "color:red" not in json.dumps(seen["banner"]), "the judge reads what a person sees, never the style sheet"
    assert seen["banner"]["lines"][0] == "html block banner, beside records, narrow width, aligned right"
    assert agent_ns["implement_page_blocks_seen"](_churn_page(agent_ns)) == {}


def test_the_judge_reads_the_blocks_in_the_app_and_dashboard_seen_text_it_judges(agent_ns):
    page = agent_ns["implement_app_page"](_image_page(agent_ns, block("page", content="A block named page")), "N01-U01", {})
    seen = agent_ns["implement_vibes_seen"](f"app:page:{page['id']}", page)
    assert {"mascot", "block page", "page", "records"} <= set(seen), "a block never hides the page itself"
    text = agent_ns["implement_vibes_seen_text"](seen)
    assert "[mascot] mascot image block:\n- image block mascot, after kpis, narrow width, aligned center\n- image: The mascot waving\n" \
           "- caption: Our mascot" in text
    assert "- A block named page" in text and URL not in text, "the judge reads what a person sees, never the image's web address"
    assert agent_ns["implement_vibes_target"]("dashboard:mascot", page) == (page["blocks"][0], "")
    widget = agent_ns["implement_vibes_seen"]("dashboard:mascot", page)
    assert list(widget) == ["mascot"] and widget["mascot"]["node"]["alt"] == "The mascot waving"


def test_the_judge_gets_each_image_blocks_bytes_from_the_built_app(blocks_ns, tmp_path):
    page = _image_page(blocks_ns, block("intro"))
    page["blocks"][0]["content"]["file"] = FILE
    inst = _inspire(blocks_ns, FakeSpark())
    inst.local_log_output_dir = str(tmp_path)
    held = {f"/W/src/static/{FILE}": PNG}
    inst._implement_api = lambda method, path, body=None, query=None: {"content": base64.b64encode(held[query["path"]]).decode()}
    context = {"artifacts": {"app": page}, "app_host": {"source": "/W/src"}}
    found = inst._implement_app_block_images(context)
    assert found == [{"block": "mascot", "file": FILE, "alt": "The mascot waving", "caption": "Our mascot", "url": VOLUME,
                      "media_type": "image/png", "bytes": PNG, "error": ""}]
    held[f"/W/src/static/{FILE}"] = GIF
    assert inst._implement_app_block_images(context)[0]["error"] == "the App's copy is not the image Inspire checked"
    stored = tmp_path / "implement" / "_app_blocks" / FILE
    stored.parent.mkdir(parents=True)
    stored.write_bytes(PNG)
    held.clear()
    assert inst._implement_app_block_images(context)[0]["bytes"] == PNG, "the run's own copy stands in when the App folder is unreadable"
    assert inst._implement_app_block_images({"artifacts": {"app": _churn_page(blocks_ns)}}) == []


def _dash_page(ns, *blocks):
    return _page(ns, blocks=list(blocks))


def test_the_dashboard_draws_text_and_image_blocks_as_text_widgets_at_their_places(agent_ns, tmp_path):
    shell_module = _shell(agent_ns, tmp_path)
    page = _dash_page(agent_ns, block("intro"), block("mascot", "image", "after", "kpis", width="narrow", align="center"),
                      block("note", "text", "beside", "records", width="narrow", align="right"), block("raw", "html", "bottom"),
                      block("outro", "text", "bottom", content="Thanks"))
    assert shell_module.spec_problems(page) == []
    layout = _canvas(agent_ns["implement_dashboard_from_page"](page, shell_module, RESULT, {}))[0]["layout"]
    named = {item["widget"]["name"]: item for item in layout}
    join = agent_ns["implement_join_lines"]
    assert named["block_intro"]["position"] == {"x": 0, "y": named["header"]["position"]["height"], "width": 12, "height": 2}
    assert named["block_intro"]["widget"]["multilineTextboxSpec"]["lines"] == join(CONTENT["text"].splitlines())
    counters = _widgets(_canvas(agent_ns["implement_dashboard_from_page"](page, shell_module, RESULT, {}))[0], "counter")
    below = counters[0]["position"]["y"] + counters[0]["position"]["height"]
    assert named["block_mascot"]["position"] == {"x": 4, "y": below, "width": 4, "height": 5}
    assert named["block_mascot"]["widget"]["multilineTextboxSpec"]["lines"] == join(
        ["The mascot waving", "", "*A dashboard draws no image file, so this block shows what the image shows.*", "", "*Our mascot*"])
    assert not any(URL in line for item in layout for line in item["widget"].get("multilineTextboxSpec", {}).get("lines", [])), \
        "the dashboard never names an internet image for a browser to load"
    charts = [item for item in layout if item["widget"]["name"].startswith("chart_")]
    assert min(c["position"]["y"] for c in charts) == below + 5, "the charts move down under the image"
    records = named["records"]
    assert (records["position"]["x"], records["position"]["width"]) == (0, 8)
    assert named["block_note"]["position"] == {"x": 8, "y": records["position"]["y"], "width": 4, "height": records["position"]["height"]}
    assert "block_raw" not in named and named["block_outro"]["position"]["y"] == records["position"]["y"] + records["position"]["height"]
    assert "implement_html_markdown" not in agent_ns, "a dashboard page never holds html, so nothing converts it"
    assert agent_ns["implement_dashboard_html_problems"](page) == [
        "block raw is html, which a dashboard text widget cannot draw: write it as a text block in Markdown (headings, bold, italics, "
        "lists, links and tables) or as an image block"]
    assert "implement_dashboard_block_warnings" not in agent_ns, "the dashboard never warns about an html block"


def test_a_page_without_blocks_builds_the_same_dashboard_as_an_empty_block_list_and_no_block_widget(agent_ns, tmp_path):
    shell_module = _shell(agent_ns, tmp_path)
    plain = agent_ns["implement_dashboard_from_page"](_page(agent_ns), shell_module, RESULT, {})
    empty = agent_ns["implement_dashboard_from_page"](_dash_page(agent_ns), shell_module, RESULT, {})
    assert plain == empty
    assert not any(item["widget"]["name"].startswith("block_") for item in _canvas(plain)[0]["layout"])
    assert agent_ns["implement_dashboard_html_problems"](_page(agent_ns)) == []


def _app_prompt(ns, tmp_path, **outputs):
    inst, context, seen = _app_flow(ns, tmp_path, outputs=outputs or None)
    inst._implement_app(context, None)
    return seen["prompt"]


def test_genie_is_told_to_put_an_ask_the_page_cannot_show_into_a_block_where_the_ask_says(agent_ns, tmp_path):
    prompt = _app_prompt(agent_ns, tmp_path, dashboard=False)
    rule = next(line for line in prompt.splitlines() if line.startswith("- When the user asks for something the KPIs, charts"))
    for words in ("add it as a block in the top-level \"blocks\" list, placed exactly where the ask says",
                  "The user's ask always wins: build what they asked, as they asked it",
                  "the /Workspace/... or /Volumes/... path of a PNG, JPEG, GIF or WebP image of exactly what was asked",
                  "Inspire reads each image from that path to check it and copies it into the App",
                  "never reads an internet address: a block whose url is a web address, or is not such an image, shows its alt text "
                  "and a note, and the build notes name it", "the middle of the page is after kpis",
                  "no script, event handler, iframe, object, embed, stylesheet import or outside image",
                  f"At most {shell_sql.CAPS['blocks'][1]} blocks"):
        assert words in rule, words
    assert "dashboard" not in rule
    both = _app_prompt(agent_ns, tmp_path / "dash", dashboard=True)
    assert ("the dashboard draws each text block as a text widget at its place and each image block as its alt text and a note, "
            "because a dashboard draws no image file, and draws no html block, so a dashboard ask takes a text or image block.\n") in both


def test_the_page_check_genie_runs_refuses_a_script_block_with_the_shell_this_notebook_carries(agent_ns, tmp_path):
    import subprocess
    source = agent_ns["implement_app_shell_payload"](agent_ns["_INSPIRE_APP_SHELL"])["files"]["shell_sql.py"]
    work = tmp_path / "work"
    agent_ns["implement_write_files"](str(work), agent_ns["implement_app_check_files"](source, False, []))
    for name, page, code in (("bad", with_blocks(_html("<script>alert(1)</script>")), 1), ("good", with_blocks(block("b1")), 0)):
        (work / "page.json").write_text(json.dumps(page))
        done = subprocess.run([sys.executable, str(work / ".inspire_check" / "check_page.py")], cwd=str(tmp_path), capture_output=True,
                              text=True, timeout=60)
        assert done.returncode == code, (name, done.stdout, done.stderr)
        assert ("block b1 uses <script>" in done.stdout) is (name == "bad")
