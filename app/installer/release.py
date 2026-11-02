import argparse
import ast
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile

APP = pathlib.Path(__file__).resolve().parents[1]
REPO = APP.parent
STARTER = REPO / "inspire_installer.py"
APP_ZIP = "inspire-app.zip"
ASSETS_TAR = "inspire-assets.tar"
ASSETS_MANIFEST = "manifest.json"
MODULE = "installer/inspire_setup.py"
AGENT = "dbx_inspire_ai_agent.ipynb"
UNZIP_FOLDER = "inspire-app"
DEV_ONLY = ("installer/test/", "installer/release.py")
PART_BYTES = 9 * 1024 * 1024
PART_LIMIT = 10 * 1000 * 1000
STARTER_MIN_VERSION = 1
SUMS_LINE = re.compile(r"([0-9a-f]{64})  ([A-Za-z0-9][A-Za-z0-9._-]*)")


class ReleaseFailure(SystemExit):
    def __init__(self, message):
        super().__init__(f"release: {message}")


def entry_cell(node):
    if isinstance(node, (ast.Expr, ast.Assign)) and isinstance(node.value, ast.Call):
        return getattr(node.value.func, "id", "") == "inspire_install_main"
    return isinstance(node, ast.If) and [name.id for name in ast.walk(node.test) if isinstance(name, ast.Name)] == ["failure"]


def load_starter(path=STARTER):
    source = pathlib.Path(path).read_text(encoding="utf-8")
    body = [node for node in ast.parse(source).body if not entry_cell(node)]
    namespace = {"__name__": "inspire_installer"}
    exec(compile(ast.Module(body=body, type_ignores=[]), str(path), "exec"), namespace)
    return namespace


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def agent_version(archive):
    names = [name for name in archive.namelist() if name.rsplit("/", 1)[-1] == AGENT]
    if len(names) != 1:
        raise ReleaseFailure(f"{APP_ZIP} must hold one {AGENT}, it holds {len(names)}")
    cells = json.loads(archive.read(names[0]).decode("utf-8")).get("cells") or []
    source = "\n".join("".join(c.get("source") or []) if isinstance(c.get("source"), list) else str(c.get("source") or "") for c in cells)
    found = re.search(r'^__AGENT_VERSION__ = "(v[0-9]\.[0-9]\.[0-9])"$', source, re.M)
    if not found:
        raise ReleaseFailure(f"{AGENT} in {APP_ZIP} names no single-digit __AGENT_VERSION__")
    return found.group(1)


def dev_only(name):
    return name.startswith(DEV_ONLY) or "__pycache__/" in name or name.rsplit("/", 1)[-1] == ".DS_Store"


def without_dev_files(source, target):
    with zipfile.ZipFile(source) as archive, zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as out:
        for info in archive.infolist():
            if not dev_only(info.filename):
                out.writestr(info, b"" if info.is_dir() else archive.read(info), compress_type=zipfile.ZIP_DEFLATED)


def module_member(archive):
    names = [name for name in archive.namelist() if name == MODULE or name.endswith("/" + MODULE)]
    if len(names) != 1:
        raise ReleaseFailure(f"{APP_ZIP} must hold one {MODULE}, it holds {len(names)}")
    return names[0]


def zip_contents(archive, starter):
    items = []
    for info in sorted(archive.infolist(), key=lambda i: i.filename):
        if info.is_dir():
            continue
        if not starter["safe_path"](info.filename):
            raise ReleaseFailure(f"{APP_ZIP} holds a path the installer refuses: {info.filename[:120]!r}")
        data = archive.read(info)
        kind = "jupyter" if info.filename.endswith(".ipynb") else \
            "source" if info.filename.endswith(".py") and data.startswith(b"# Databricks notebook source") else None
        item = {"path": info.filename, "size": len(data), "sha256": sha256_bytes(data), "notebook": kind}
        if kind:
            item["code_sha256"] = starter["notebook_code_sha256"](kind, data)
        items.append(item)
    return items


def assets_entries(assets, version, starter):
    manifest_path = assets / ASSETS_MANIFEST
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ReleaseFailure(f"the assets folder {assets} has no readable {ASSETS_MANIFEST}: {exc}")
    if not isinstance(data, dict) or data.get("format") != 1 or not isinstance(data.get("files"), list):
        raise ReleaseFailure(f"{manifest_path} is not an assets manifest of format 1")
    if data.get("inspire_version") != version:
        raise ReleaseFailure(f"{manifest_path} is for Inspire {data.get('inspire_version')}, the agent in {APP_ZIP} is {version}")
    for entry in data["files"]:
        file = str((entry or {}).get("file") or "")
        if not starter["safe_path"](file) or file == ASSETS_MANIFEST:
            raise ReleaseFailure(f"{manifest_path} lists a file the installer refuses: {file[:120]!r}")
        path = assets / file
        if not path.is_file() or starter["file_digest"](str(path)) != (entry.get("sha256"), entry.get("size")):
            raise ReleaseFailure(f"{path} does not match its size and sha256 in {manifest_path}")
    return manifest_path, data["files"]


def write_assets_tar(assets, version, target, starter):
    manifest_path, files = assets_entries(assets, version, starter)

    def add(tar, name, path):
        info = tarfile.TarInfo(name)
        info.size, info.mtime, info.mode, info.uid, info.gid, info.uname, info.gname = path.stat().st_size, 0, 0o644, 0, 0, "", ""
        with open(path, "rb") as handle:
            tar.addfile(info, handle)

    with tarfile.open(target, "w", format=tarfile.PAX_FORMAT) as tar:
        add(tar, ASSETS_MANIFEST, manifest_path)
        for entry in sorted(files, key=lambda e: e["file"]):
            add(tar, entry["file"], assets / entry["file"])
    return len(files)


def split(path, out, part_bytes):
    if not 0 < part_bytes < PART_LIMIT:
        raise ReleaseFailure(f"a part must be under {PART_LIMIT} bytes, {part_bytes} was asked")
    stem = path.name.split(".", 1)[0]
    parts = []
    with open(path, "rb") as handle:
        while True:
            chunk = handle.read(part_bytes)
            if not chunk and parts:
                break
            if len(parts) == 99:
                raise ReleaseFailure(f"{path.name} needs more than 99 parts of {part_bytes} bytes")
            name = f"{stem}.part{len(parts) + 1:02d}"
            (out / name).write_bytes(chunk)
            parts.append({"name": name, "size": len(chunk), "sha256": sha256_bytes(chunk)})
            if len(chunk) < part_bytes:
                break
    return parts


def build(app_zip, assets, out, part_bytes=PART_BYTES, starter_path=STARTER):
    starter = load_starter(starter_path)
    if STARTER_MIN_VERSION > starter["STARTER_VERSION"]:
        raise ReleaseFailure(f"the installer is version {starter['STARTER_VERSION']}, the release needs {STARTER_MIN_VERSION}")
    out = pathlib.Path(out)
    out.mkdir(parents=True, exist_ok=True)
    if any(out.iterdir()):
        raise ReleaseFailure(f"{out} is not empty")
    zip_path = out / APP_ZIP
    with tempfile.TemporaryDirectory(prefix="inspire_app_zip_") as work:
        packed = pathlib.Path(app_zip) if app_zip else pathlib.Path(work) / APP_ZIP
        if not app_zip:
            subprocess.run(["bash", str(APP / "scripts" / "package-for-workspace.sh")], check=True,
                           env={**os.environ, "ARTIFACT_ZIP": str(packed)})
        without_dev_files(packed, zip_path)
    with zipfile.ZipFile(zip_path) as archive:
        version = agent_version(archive)
        module = module_member(archive)
        contents = zip_contents(archive, starter)
    tar_path = out / ASSETS_TAR
    asset_count = write_assets_tar(pathlib.Path(assets), version, tar_path, starter)
    files = []
    for path, extra in ((zip_path, {"unzip_folder": UNZIP_FOLDER, "unzip_marker": module, "contents": contents}), (tar_path, {})):
        digest, size = starter["file_digest"](str(path))
        files.append({"name": path.name, "size": size, "sha256": digest, "parts": split(path, out, part_bytes), **extra})
    installer = out / starter["INSTALLER"]
    shutil.copyfile(starter_path, installer)
    digest, size = starter["file_digest"](str(installer))
    manifest = {"format": 1, "version": version, "starter_min_version": STARTER_MIN_VERSION,
                "installer": {"name": installer.name, "size": size, "sha256": digest},
                "entry": {"file": APP_ZIP, "module": module, "function": "run"}, "files": files}
    starter["check_manifest"](manifest)
    (out / starter["MANIFEST"]).write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8")
    lines = [f"{starter['file_digest'](str(path))[0]}  {path.name}" for path in sorted(out.iterdir()) if path.name != starter["SUMS"]]
    (out / starter["SUMS"]).write_text("\n".join(lines) + "\n", encoding="utf-8")
    summary = {"version": version, "assets": asset_count, "files": [
        {"name": e["name"], "size": e["size"], "parts": len(e["parts"]), "largest_part": max(p["size"] for p in e["parts"])} for e in files]}
    print(json.dumps(summary, indent=1))
    return manifest


def parse_sums(text):
    sums = {}
    for line in text.splitlines():
        found = SUMS_LINE.fullmatch(line)
        if not found or found.group(2) in sums:
            raise ReleaseFailure(f"SHA256SUMS holds a line it should not: {line[:160]!r}")
        sums[found.group(2)] = found.group(1)
    return sums


def check(base, opener=None, work=None):
    starter = load_starter()
    opener = opener or starter["open_trusted"]
    base, repo = starter["release_source"]({} if base.rstrip("/") == starter["LATEST_BASE"] else {"release": base})
    work = pathlib.Path(work or tempfile.mkdtemp(prefix="inspire_release_check_"))
    download = starter["download"]
    rows, failures = [], []
    sums_path, manifest_path = work / starter["SUMS"], work / starter["MANIFEST"]
    download(f"{base}/{starter['SUMS']}", str(sums_path), repo, opener=opener, limit=1 << 20)
    download(f"{base}/{starter['MANIFEST']}", str(manifest_path), repo, opener=opener, limit=1 << 20)
    sums = parse_sums(sums_path.read_text(encoding="utf-8"))
    manifest = starter["check_manifest"](starter["read_json"](str(manifest_path), starter["MANIFEST"]))
    sizes = {manifest["installer"]["name"]: (manifest["installer"]["size"], manifest["installer"]["sha256"])}
    for entry in manifest["files"]:
        sizes[entry["name"]] = (entry["size"], entry["sha256"])
        sizes.update({part["name"]: (part["size"], part["sha256"]) for part in entry["parts"]})
    expected = set(sizes) | {starter["MANIFEST"]}
    if set(sums) != expected:
        failures.append(f"SHA256SUMS and manifest.json list different files: {sorted(set(sums) ^ expected)}")
    if starter["file_digest"](str(manifest_path))[0] != sums.get(starter["MANIFEST"]):
        failures.append("manifest.json does not match its line in SHA256SUMS")
    for name in sorted(sizes):
        size, digest = sizes[name]
        if sums.get(name) != digest:
            failures.append(f"{name}: manifest.json and SHA256SUMS name different sha256")
        try:
            download(f"{base}/{name}", str(work / name), repo, size, sums.get(name), opener=opener)
            rows.append(f"OK    {name}  {size} bytes  {digest[:16]}")
        except Exception as exc:
            failures.append(f"{name}: {exc}")
            rows.append(f"FAIL  {name}  {exc}")
    for entry in manifest["files"]:
        joined = hashlib.sha256()
        for part in entry["parts"]:
            path = work / part["name"]
            if path.is_file():
                joined.update(path.read_bytes())
        if joined.hexdigest() != entry["sha256"]:
            failures.append(f"the parts of {entry['name']} do not join into its sha256")
    print("\n".join(rows))
    print(f"release check {base}: {len(rows) - len([r for r in rows if r.startswith('FAIL')])} of {len(sizes)} files OK, "
          f"{len(failures)} failure{'s' if len(failures) != 1 else ''}")
    for failure in failures:
        print(f"  FAIL {failure}")
    return failures


def main(argv=None):
    parser = argparse.ArgumentParser(prog="release.py")
    commands = parser.add_subparsers(dest="command", required=True)
    make = commands.add_parser("build")
    make.add_argument("--assets", required=True)
    make.add_argument("--out", required=True)
    make.add_argument("--app-zip")
    make.add_argument("--part-bytes", type=int, default=PART_BYTES)
    verify = commands.add_parser("check")
    verify.add_argument("--base", default=load_starter()["LATEST_BASE"])
    args = parser.parse_args(argv)
    if args.command == "build":
        build(args.app_zip, args.assets, args.out, args.part_bytes)
        return 0
    return 1 if check(args.base) else 0


if __name__ == "__main__":
    sys.exit(main())
