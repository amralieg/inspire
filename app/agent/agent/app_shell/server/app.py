import html
import os
import re
import time

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from shell_core import Shell

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")
ASSET_TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
               ".json": "application/json", ".map": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
               ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2"}
NO_ASSET = "the App serves no file of that type"
COMPRESS_MIN_BYTES = 1024
shell = Shell(ROOT)
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(GZipMiddleware, minimum_size=COMPRESS_MIN_BYTES)


@app.middleware("http")
async def nosniff(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    return response


class Assets(StaticFiles):
    def file_response(self, full_path, stat_result, scope, status_code=200):
        kind = ASSET_TYPES.get(os.path.splitext(str(full_path))[1].lower())
        if kind is None:
            return JSONResponse({"error": NO_ASSET}, status_code=404)
        response = super().file_response(full_path, stat_result, scope, status_code)
        response.headers["content-type"] = kind
        response.headers["cache-control"] = "no-cache"
        return response


@app.get("/health")
def health():
    return {"ok": True, "pages": len(shell.pages)}


@app.api_route("/api/{path:path}", methods=["GET", "POST"])
async def api(path: str, request: Request):
    started = time.perf_counter()
    body = await request.body()
    status, payload = await run_in_threadpool(shell.handle, request.method, path, dict(request.query_params),
                                              {k.lower(): v for k, v in request.headers.items()}, body)
    spent = (time.perf_counter() - started) * 1000
    return JSONResponse(payload, status_code=status, headers={"Cache-Control": "no-store", "Server-Timing": f"app;dur={spent:.1f}"})


TITLE_TAG = re.compile(r"<title>.*?</title>", re.IGNORECASE | re.DOTALL)


def titled_index(text: str, title: str) -> str:
    tag = f"<title>{html.escape(title)}</title>"
    if TITLE_TAG.search(text):
        return TITLE_TAG.sub(lambda _m: tag, text, count=1)
    return re.sub(r"(<head[^>]*>)", lambda m: m.group(1) + tag, text, count=1, flags=re.IGNORECASE) if "<head" in text.lower() else tag + text


@app.get("/")
@app.get("/index.html")
def index():
    with open(os.path.join(STATIC, "index.html"), encoding="utf-8") as f:
        text = f.read()
    return HTMLResponse(titled_index(text, shell.tab_title()), media_type=ASSET_TYPES[".html"], headers={"Cache-Control": "no-cache"})


app.mount("/", Assets(directory=STATIC), name="static")
