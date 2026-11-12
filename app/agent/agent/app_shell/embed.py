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
EXAMPLES = os.path.join(HERE, "examples")
PALETTES = os.path.join(WEB, "src", "palettes.json")
KINDS = os.path.join(HERE, "kinds.json")
TRANSLATIONS = os.path.join(HERE, "translations.json")
SHELL = os.path.join(HERE, "app_shell.b64")
CELL = 1
VERSION = 1
SERVER_FILES = ("app.py", "app.yaml", "shell_agent.py", "shell_alerts.py", "shell_core.py", "shell_db.py", "shell_facts.py", "shell_pg.py",
                "shell_redact.py", "shell_sql.py")
WEB_INPUTS = ("index.html", "package.json", "package-lock.json", "vite.config.js", "src")
BINARY_SUFFIXES = (".woff2",)
CONSTANT = "INSPIRE_NOTEBOOK_ASSETS = "
LEGACY_CONSTANTS = ("_INSPIRE_APP_SHELL = ", "_INSPIRE_KINDS = ")
ASSETS = {"app_shell": ("notebook/app_shell.b64", SHELL), "kinds": ("notebook/kinds.json", KINDS),
          "translations": ("notebook/translations.json", TRANSLATIONS)}


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


def examples(folder: str = EXAMPLES) -> dict:
    if not os.path.isdir(folder):
        return {}
    return {name[:-5]: _load(os.path.join(folder, name)) for name in sorted(os.listdir(folder)) if name.endswith(".json")}


def payload(server: str = SERVER, dist: str = DIST, web: str = WEB, static: bool = True, example: str = EXAMPLE,
            palettes: str = PALETTES, layouts: str = EXAMPLES) -> dict:
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
    return {"version": VERSION, "web_source": web_source_sha(web), "example": _load(example), "examples": examples(layouts),
            "palettes": _load(palettes), "files": files, **({"binary": binary} if binary else {})}


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


def embedded(path: str = SHELL) -> dict:
    with open(path, encoding="ascii") as handle:
        text = handle.read()
    return decode(text) if text else {}


def kinds(path: str = KINDS) -> dict:
    return _load(path)


def write(data: dict, path: str = SHELL) -> bool:
    text = encode(data)
    if os.path.isfile(path) and _text(path) == text:
        return False
    with open(path, "w", encoding="ascii") as handle:
        handle.write(text)
    return True


def digest(path: str) -> dict:
    with open(path, "rb") as handle:
        data = handle.read()
    return {"sha256": hashlib.sha256(data).hexdigest(), "size": len(data)}


def pins(assets: dict = None) -> dict:
    return {name: dict({"file": file, "repo": os.path.relpath(path, ROOT).replace(os.sep, "/")}, **digest(path))
            for name, (file, path) in sorted((assets or ASSETS).items())}


def pin_line(found: dict) -> str:
    return CONSTANT + json.dumps(found, sort_keys=True, separators=(", ", ": ")) + "\n"


def notebook_pins(path: str = NOTEBOOK) -> dict:
    lines = _load(path)["cells"][CELL]["source"]
    return json.loads(lines[_line_index(lines)][len(CONSTANT):])


def legacy_lines(path: str = NOTEBOOK) -> list:
    return [line.split(" = ", 1)[0] for line in _load(path)["cells"][CELL]["source"] if line.startswith(LEGACY_CONSTANTS)]


def write_pins(path: str = NOTEBOOK, assets: dict = None) -> bool:
    nb = _load(path)
    lines = nb["cells"][CELL]["source"]
    index = _line_index(lines)
    line = pin_line(pins(assets))
    if lines[index] == line:
        return False
    lines[index] = line
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(nb, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    return True


REGISTRY_CONSTANTS = (("TECHNIQUE_EXECUTION_FAMILY", "execution_family"), ("GENIE_READINESS_THRESHOLDS", "readiness_thresholds"),
                      ("TECHNIQUE_MIN_ROWS", "technique_min_rows"))


def _constant_lines(name: str, value: dict) -> list:
    return [f"{name} = {{\n"] + [f"    {json.dumps(key)}: {json.dumps(item)},\n" for key, item in value.items()] + ["}\n"]


def _registry_block(lines: list, name: str) -> tuple:
    starts = [i for i, line in enumerate(lines) if line.startswith(f"{name} = {{")]
    if len(starts) != 1:
        raise SystemExit(f"cells[{CELL}] must hold exactly one {name} literal; found {len(starts)}")
    stop = next(j for j in range(starts[0] + 1, len(lines)) if lines[j].rstrip("\n") == "}")
    return starts[0], stop + 1


def registry_differences(lines: list, registry: dict) -> list:
    out = []
    for name, key in REGISTRY_CONSTANTS:
        start, stop = _registry_block(lines, name)
        if lines[start:stop] != _constant_lines(name, registry[key]):
            out.append(f"{name} in the notebook differs from kinds.json {key}")
    return out


def write_registry_constants(path: str = NOTEBOOK, registry: dict = None) -> bool:
    registry = kinds() if registry is None else registry
    nb = _load(path)
    lines = nb["cells"][CELL]["source"]
    if not registry_differences(lines, registry):
        return False
    for name, key in REGISTRY_CONSTANTS:
        start, stop = _registry_block(lines, name)
        lines[start:stop] = _constant_lines(name, registry[key])
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
    if (actual.get("examples") or {}) != expected.get("examples", {}):
        out.append("the layout examples differ")
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
        changed = write(data)
        print(f"{'wrote' if changed else 'already current'}: {SHELL} with {len(data['files'])} files, web source {data['web_source'][:12]}")
        registry = kinds()
        print(f"kinds.json: {len(registry['kinds'])} kinds, {len(registry['layouts'])} layouts")
        changed = write_pins(args.notebook)
        named = ", ".join(f"{name} {spec['sha256'][:12]}" for name, spec in pins().items())
        print(f"{'pinned' if changed else 'already pinned'} in the notebook: {named}")
        changed = write_registry_constants(args.notebook, registry)
        print(f"{'rewrote' if changed else 'already current'} the notebook registry constants from kinds.json")
        return 0
    problems = differences(data, embedded())
    problems += [f"{name} is still embedded in the notebook" for name in legacy_lines(args.notebook)]
    problems += registry_differences(_load(args.notebook)["cells"][CELL]["source"], kinds())
    held = notebook_pins(args.notebook)
    problems += [f"the notebook pins {name} at another build than {spec['repo']}" for name, spec in pins().items() if held.get(name) != spec]
    for problem in problems:
        print(problem, file=sys.stderr)
    print("app_shell.b64 and the notebook pins match the repo" if not problems else f"differences from the repo: {len(problems)}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
