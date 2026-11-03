import argparse
import base64
import hashlib
import json
import os
import subprocess
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
NOTEBOOK = os.path.join(ROOT, "agent", "dbx_inspire_ai_agent.ipynb")
SERVER = os.path.join(HERE, "server")
WEB = os.path.join(HERE, "web")
DIST = os.path.join(WEB, "dist")
EXAMPLE = os.path.join(HERE, "example_page.json")
PALETTES = os.path.join(WEB, "src", "palettes.json")
KINDS = os.path.join(HERE, "kinds.json")
CELL = 1
VERSION = 1
SERVER_FILES = ("app.py", "app.yaml", "shell_alerts.py", "shell_core.py", "shell_db.py", "shell_facts.py", "shell_pg.py",
                "shell_redact.py", "shell_sql.py")
WEB_INPUTS = ("index.html", "package.json", "package-lock.json", "vite.config.js", "src")
BINARY_SUFFIXES = (".woff2",)
CONSTANT = "_INSPIRE_APP_SHELL = "
KINDS_CONSTANT = "_INSPIRE_KINDS = "


def _walk(base: str, relative: str) -> list:
    full = os.path.join(base, relative)
    if os.path.isfile(full):
        return [relative]
    out = []
    for folder, dirs, names in os.walk(full):
        dirs.sort()
        for name in sorted(names):
            out.append(os.path.relpath(os.path.join(folder, name), base).replace(os.sep, "/"))
    return out


def web_source_sha(web: str = WEB) -> str:
    digest = hashlib.sha256()
    for relative in sorted(p for item in WEB_INPUTS for p in _walk(web, item)):
        with open(os.path.join(web, relative), "rb") as handle:
            data = handle.read()
        digest.update(f"{relative}\0{len(data)}\0".encode())
        digest.update(data)
    return digest.hexdigest()


def _text(path: str) -> str:
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def _base64(path: str) -> str:
    with open(path, "rb") as handle:
        return base64.b64encode(handle.read()).decode("ascii")


def payload(server: str = SERVER, dist: str = DIST, web: str = WEB, static: bool = True, example: str = EXAMPLE,
            palettes: str = PALETTES) -> dict:
    files = {name: _text(os.path.join(server, name)) for name in SERVER_FILES}
    binary = {}
    if static:
        if not os.path.isfile(os.path.join(dist, "index.html")):
            raise SystemExit(f"{dist} has no build; run `python3 agent/app_shell/embed.py check --build`")
        for relative in _walk(dist, "."):
            if relative.endswith(BINARY_SUFFIXES):
                binary[f"static/{relative}"] = _base64(os.path.join(dist, relative))
            else:
                files[f"static/{relative}"] = _text(os.path.join(dist, relative))
    return {"version": VERSION, "web_source": web_source_sha(web), "example": _load(example), "palettes": _load(palettes),
            "files": files, **({"binary": binary} if binary else {})}


def encode(data: dict) -> str:
    raw = json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return base64.b64encode(zlib.compress(raw, 9)).decode("ascii")


def decode(text: str) -> dict:
    return json.loads(zlib.decompress(base64.b64decode(text)).decode("utf-8"))


def _load(path: str) -> dict:
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def _line_index(lines: list, constant: str = CONSTANT) -> int:
    hits = [i for i, line in enumerate(lines) if line.startswith(constant)]
    if len(hits) != 1:
        raise SystemExit(f"cells[{CELL}] must hold exactly one line starting with {constant!r}; found {len(hits)}")
    return hits[0]


def embedded(path: str = NOTEBOOK, constant: str = CONSTANT) -> dict:
    lines = _load(path)["cells"][CELL]["source"]
    line = lines[_line_index(lines, constant)]
    value = line[len(constant):].strip()
    if not (value.startswith('"') and value.endswith('"')):
        raise SystemExit(f"{constant.strip()} must be one double-quoted string")
    return decode(value[1:-1]) if len(value) > 2 else {}


def kinds(path: str = KINDS) -> dict:
    return _load(path)


def write(data: dict, path: str = NOTEBOOK, constant: str = CONSTANT) -> bool:
    nb = _load(path)
    lines = nb["cells"][CELL]["source"]
    index = _line_index(lines, constant)
    line = f'{constant}"{encode(data)}"' + ("\n" if lines[index].endswith("\n") else "")
    if lines[index] == line:
        return False
    lines[index] = line
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(nb, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    return True


def differences(expected: dict, actual: dict, static: bool = True) -> list:
    out = []
    if actual.get("version") != expected["version"]:
        out.append(f"version {actual.get('version')} != {expected['version']}")
    if actual.get("web_source") != expected["web_source"]:
        out.append("the web sources changed since the bundle was embedded")
    if actual.get("example") != expected["example"]:
        out.append("example_page.json differs")
    if actual.get("palettes") != expected["palettes"]:
        out.append("palettes.json differs")
    have = dict(actual.get("files") or {}, **(actual.get("binary") or {}))
    want = dict(expected["files"], **(expected.get("binary") or {}))
    if not static:
        have = {name: text for name, text in have.items() if not name.startswith("static/")}
        out += [f"static/{name} is missing" for name in ("index.html", "assets/app.js") if f"static/{name}" not in (actual.get("files") or {})]
    out += [f"{name} is missing" for name in sorted(set(want) - set(have))]
    out += [f"{name} is no longer part of the shell" for name in sorted(set(have) - set(want))]
    out += [f"{name} differs" for name in sorted(set(want) & set(have)) if want[name] != have[name]]
    return out


def build(web: str = WEB) -> None:
    subprocess.run(["npm", "run", "-s", "build"], cwd=web, check=True)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="embed.py")
    parser.add_argument("action", choices=["write", "check"])
    parser.add_argument("--build", action="store_true", help="rebuild the web bundle before a check; write always rebuilds")
    parser.add_argument("--notebook", default=NOTEBOOK)
    args = parser.parse_args(argv)
    if args.build or args.action == "write":
        build()
    data = payload()
    if args.action == "write":
        changed = write(data, args.notebook)
        print(f"{'embedded' if changed else 'already embedded'}: {len(data['files'])} files, web source {data['web_source'][:12]}")
        registry = kinds()
        changed = write(registry, args.notebook, KINDS_CONSTANT)
        print(f"{'embedded' if changed else 'already embedded'}: {len(registry['kinds'])} kinds, {len(registry['layouts'])} layouts")
        return 0
    problems = differences(data, embedded(args.notebook))
    if embedded(args.notebook, KINDS_CONSTANT) != kinds():
        problems.append("kinds.json differs")
    for problem in problems:
        print(problem, file=sys.stderr)
    print("the embedded App shell matches the repo" if not problems else f"differences from the repo: {len(problems)}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
