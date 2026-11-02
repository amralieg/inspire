import os

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from shell_core import Shell

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")
ASSET_TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
               ".json": "application/json", ".map": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
               ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2"}
NO_ASSET = "the App serves no file of that type"
shell = Shell(ROOT)
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


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
        return response


@app.get("/health")
def health():
    return {"ok": True, "pages": len(shell.pages)}


@app.api_route("/api/{path:path}", methods=["GET", "POST"])
async def api(path: str, request: Request):
    body = await request.body()
    status, payload = await run_in_threadpool(shell.handle, request.method, path, dict(request.query_params),
                                              {k.lower(): v for k, v in request.headers.items()}, body)
    return JSONResponse(payload, status_code=status, headers={"Cache-Control": "no-store"})


@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC, "index.html"), media_type=ASSET_TYPES[".html"], headers={"Cache-Control": "no-cache"})


app.mount("/", Assets(directory=STATIC), name="static")
