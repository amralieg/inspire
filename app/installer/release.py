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
import urllib.error
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
STARTER_MIN_VERSION = 1
LEFT_OUT = ("SHA256SUMS", "inspire-app.part01", "inspire-assets.part01")
GENIE_WALK = APP / "agent" / "agent" / "app_shell" / "web" / "test" / "genieWalk.mjs"


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
        for info in sorted(archive.infolist(), key=lambda i: i.filename):
            if not dev_only(info.filename):
                entry = zipfile.ZipInfo(info.filename, date_time=(1980, 1, 1, 0, 0, 0))
                entry.external_attr, entry.create_system = info.external_attr, info.create_system
                out.writestr(entry, b"" if info.is_dir() else archive.read(info), compress_type=zipfile.ZIP_DEFLATED)


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


def write_tar(target, names, open_member):
    with tarfile.open(target, "w", format=tarfile.PAX_FORMAT) as tar:
        for name in [ASSETS_MANIFEST] + sorted(set(names) - {ASSETS_MANIFEST}):
            with open_member(name) as handle:
                size = handle.seek(0, os.SEEK_END)
                handle.seek(0)
                info = tarfile.TarInfo(name)
                info.size, info.mtime, info.mode, info.uid, info.gid, info.uname, info.gname = size, 0, 0o644, 0, 0, "", ""
                tar.addfile(info, handle)


def write_assets_tar(assets, version, target, starter):
    files = assets_entries(assets, version, starter)[1]
    write_tar(target, [entry["file"] for entry in files], lambda name: open(assets / name, "rb"))
    return len(files)


def four_files(manifest, starter):
    names = [entry.get("name") for entry in manifest.get("files") or []]
    if sorted(names) != sorted(starter["WHOLE_FILES"]):
        raise ReleaseFailure(f"{starter['MANIFEST']} lists {names}, a release lists exactly {list(starter['WHOLE_FILES'])}")
    split = [entry["name"] for entry in manifest["files"] if "parts" in entry]
    if split:
        raise ReleaseFailure(f"{starter['MANIFEST']} lists parts of {split}, a release carries whole files only")
    if (manifest.get("installer") or {}).get("name") != starter["INSTALLER"]:
        raise ReleaseFailure(f"{starter['MANIFEST']} names no {starter['INSTALLER']}")
    return manifest


def build(app_zip, assets, out, starter_path=STARTER):
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
        files.append({"name": path.name, "size": size, "sha256": digest, **extra})
    installer = out / starter["INSTALLER"]
    shutil.copyfile(starter_path, installer)
    digest, size = starter["file_digest"](str(installer))
    manifest = {"format": 1, "version": version, "starter_min_version": STARTER_MIN_VERSION,
                "installer": {"name": installer.name, "size": size, "sha256": digest},
                "entry": {"file": APP_ZIP, "module": module, "function": "run"}, "files": files}
    four_files(starter["check_manifest"](manifest), starter)
    (out / starter["MANIFEST"]).write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8")
    written = sorted(path.name for path in out.iterdir())
    if written != sorted(starter["RELEASE_FILES"]):
        raise ReleaseFailure(f"{out} holds {written}, a release holds exactly {sorted(starter['RELEASE_FILES'])}")
    summary = {"version": version, "assets": asset_count, "files": [
        {"name": name, "size": (out / name).stat().st_size} for name in starter["RELEASE_FILES"]]}
    print(json.dumps(summary, indent=1))
    return manifest


def genie_walk(genie, run=subprocess.run):
    if not genie:
        print("NOT RUN  live Genie walk: pass --genie-app, --genie-inspire and --genie-profile to ask Genie on every page of a built test App")
        return []
    app, inspire, profile = genie
    done = run(["node", str(GENIE_WALK), "--app", app, "--inspire", inspire, "--profile", profile], cwd=str(GENIE_WALK.parent.parent))
    return [f"live Genie walk on {app}: exit {done.returncode}, see its FAIL lines above"] if done.returncode else []


def check(base, opener=None, work=None, genie=None, run=subprocess.run):
    starter = load_starter()
    opener = opener or starter["open_trusted"]
    base, repo = starter["release_source"]({} if base.rstrip("/") == starter["LATEST_BASE"] else {"release": base})
    work = pathlib.Path(work or tempfile.mkdtemp(prefix="inspire_release_check_"))
    download = starter["download"]
    rows, failures = [], []
    manifest_path = work / starter["MANIFEST"]
    download(f"{base}/{starter['MANIFEST']}", str(manifest_path), repo, opener=opener, limit=1 << 20)
    manifest = starter["check_manifest"](starter["read_json"](str(manifest_path), starter["MANIFEST"]))
    try:
        four_files(manifest, starter)
    except ReleaseFailure as exc:
        failures.append(str(exc).removeprefix("release: "))
    listed = [manifest.get("installer") or {}] + manifest["files"]
    sizes = {entry["name"]: (entry["size"], entry["sha256"]) for entry in listed if entry.get("name")}
    rows.append(f"OK    {starter['MANIFEST']}  {manifest_path.stat().st_size} bytes  read through its link")
    for name in sorted(sizes):
        size, digest = sizes[name]
        try:
            download(f"{base}/{name}", str(work / name), repo, size, digest, opener=opener)
            rows.append(f"OK    {name}  {size} bytes  {digest[:16]}")
        except Exception as exc:
            failures.append(f"{name}: {exc}")
            rows.append(f"FAIL  {name}  {exc}")
    for name in LEFT_OUT:
        carried = f"the release carries {name}, a release carries exactly {', '.join(starter['RELEASE_FILES'])}"
        unknown = f"{name}: %s, so the check cannot tell whether the release carries it"
        try:
            download(f"{base}/{name}", str(work / "left_out" / name), repo, opener=opener, limit=1 << 24)
            failures.append(carried)
        except urllib.error.HTTPError as exc:
            if exc.code != 404:
                failures.append(unknown % f"HTTP {exc.code}")
        except starter["InspireTrustError"] as exc:
            failures.append(unknown % exc)
        except starter["InspireReleaseError"]:
            failures.append(carried)
        except Exception as exc:
            failures.append(unknown % exc)
    print("\n".join(rows))
    failures += genie_walk(genie, run)
    print(f"release check {base}: {len([r for r in rows if r.startswith('OK')])} of {len(starter['RELEASE_FILES'])} files OK, "
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
    verify = commands.add_parser("check")
    verify.add_argument("--base", default=load_starter()["LATEST_BASE"])
    for name in ("app", "inspire", "profile"):
        verify.add_argument(f"--genie-{name}", default="")
    args = parser.parse_args(argv)
    if args.command == "build":
        build(args.app_zip, args.assets, args.out)
        return 0
    genie = (args.genie_app, args.genie_inspire, args.genie_profile)
    if any(genie) and not all(genie):
        parser.error("the live Genie walk needs --genie-app, --genie-inspire and --genie-profile together")
    return 1 if check(args.base, genie=genie if all(genie) else None) else 0


if __name__ == "__main__":
    sys.exit(main())
