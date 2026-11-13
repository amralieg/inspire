import argparse
import ast
import base64
import hashlib
import io
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tarfile
import time
import zipfile
import zlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import rc_settings

S = rc_settings.load()
W22 = rc_settings.path(S, "work")
LEAK_SCAN = rc_settings.path(S, "leak_scan")
REPO = "amralieg/inspire"
AGENT_NOTEBOOK = "app/agent/agent/dbx_inspire_ai_agent.ipynb"
PUBLISHED = ("inspire_installer.py", "manifest.json", "inspire-app.zip", "inspire-assets.tar")
LEFT_OUT = ("SHA256SUMS", "inspire-app.part01", "inspire-assets.part01")
TAG = re.compile(r"v[0-9]\.[0-9]\.[0-9](-rc\.[0-9])?")
EXTRA = re.compile(rc_settings.need(S, "extra_leak_pattern"))
REVIEWED = tuple(S.get("reviewed_leak_lines") or ())
LONG_REVIEWED = dict(S.get("reviewed_long_numbers") or {})
TRIES = 6
NETWORK_ERROR = re.compile(r"timed? ?out|connection|resolve|temporar|reset|unreachable|502|503|504|TLS|EOF", re.I)


def say(text):
    print(f"[{time.strftime('%H:%M:%S', time.gmtime())}Z] {text}", flush=True)


def run(cmd, cwd=None, env=None, network=False, capture=True):
    for attempt in range(1, (TRIES if network else 1) + 1):
        done = subprocess.run(cmd, cwd=cwd, env=env, capture_output=capture, text=True)
        if done.returncode == 0:
            return done.stdout if capture else ""
        detail = (done.stderr or done.stdout or "")[-600:] if capture else f"exit {done.returncode}"
        if not network or attempt == TRIES or not NETWORK_ERROR.search(detail):
            raise SystemExit(f"rc_release: {' '.join(cmd[:4])} failed: {detail}")
        say(f"network step failed (attempt {attempt} of {TRIES}): {detail.strip()[:200]}; waiting for the network")
        rc_settings.wait_for_network(S)


def leak_rules():
    tree = ast.parse(LEAK_SCAN.read_text(encoding="utf-8"))
    keep = [n for n in tree.body if (isinstance(n, ast.Assign) and any(getattr(t, "id", "") in ("LEAK", "BENIGN", "LONG") for t in n.targets))
            or (isinstance(n, ast.FunctionDef) and n.name == "synthetic")]
    ns = {"re": re}
    exec(compile(ast.Module(body=keep, type_ignores=[]), str(LEAK_SCAN), "exec"), ns)
    return ns


BLOB = re.compile(r"[A-Za-z0-9+/=]{10000,}")


def json_texts(value):
    if isinstance(value, dict):
        for key, item in value.items():
            yield from json_texts(key)
            yield from json_texts(item)
    elif isinstance(value, list):
        for item in value:
            yield from json_texts(item)
    elif isinstance(value, str) and BLOB.fullmatch(value):
        yield from blob_texts(value)
    elif value is not None:
        yield str(value)


def blob_texts(text):
    for blob in BLOB.findall(text):
        try:
            data = base64.b64decode(blob)
        except ValueError:
            continue
        try:
            data = zlib.decompress(data)
        except zlib.error:
            pass
        if b"\0" in data[:8192]:
            continue
        decoded = data.decode("utf-8", "replace")
        try:
            yield "\n".join(json_texts(json.loads(decoded)))
        except ValueError:
            yield decoded


def texts_of(release):
    for name in ("inspire_installer.py", "manifest.json"):
        yield name, (release / name).read_text(encoding="utf-8")
    with zipfile.ZipFile(release / "inspire-app.zip") as archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            data = archive.read(info)
            if b"\0" in data[:8192]:
                continue
            text = data.decode("utf-8", "replace")
            yield f"inspire-app.zip:{info.filename}", text
            for decoded in blob_texts(text):
                yield f"inspire-app.zip:{info.filename} (decoded)", decoded
    with tarfile.open(release / "inspire-assets.tar") as tar:
        for member in tar.getmembers():
            if member.isfile() and (member.name.endswith((".json", ".txt", ".md")) or member.name.startswith("licenses/")):
                yield f"inspire-assets.tar:{member.name}", tar.extractfile(member).read().decode("utf-8", "replace")


def leak_scan(release, notes):
    rules = leak_rules()
    hits, numbers = [], {}
    for label, text in [("release notes", notes)] + list(texts_of(release)):
        for pattern in (rules["LEAK"], EXTRA):
            for m in pattern.finditer(text):
                line = text[max(0, m.start() - 60):m.end() + 60].replace("\n", " ")
                if not any(b in line for b in (*rules["BENIGN"], *REVIEWED)):
                    hits.append(f"{label}: {line}")
        for m in rules["LONG"].finditer(text):
            if not rules["synthetic"](m.group(0)) and m.group(0) not in LONG_REVIEWED:
                numbers.setdefault(m.group(0), label)
                hits.append(f"{label}: unreviewed number {m.group(0)}")
    say(f"leak scan: {len(hits)} hit(s) in the public files, {len(LONG_REVIEWED)} reviewed numbers allowed; "
        f"{len(numbers)} unreviewed 15-19 digit numbers")
    for hit in hits[:20]:
        print("   ", hit[:240])
    (W22 / f"{release.parent.name}_long_numbers.json").write_text(json.dumps(numbers, indent=1), encoding="utf-8")
    return hits


def export_head(repo_dir, target, wanted=""):
    sha = run(["git", "-C", str(repo_dir), "rev-parse", f"{wanted or 'HEAD'}^{{commit}}"]).strip()
    data = subprocess.run(["git", "-C", str(repo_dir), "archive", "--format=tar", sha], capture_output=True, check=True).stdout
    target.mkdir(parents=True)
    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        tar.extractall(target, filter="data")
    return sha


def build(args, work):
    if work.exists():
        shutil.rmtree(work)
    src, release, assets = work / "src", work / "release", work / "assets"
    app_sha = export_head(args.app_dir, src, args.app_sha)
    agent_sha = run(["git", "-C", str(args.agent_dir), "rev-parse", f"{args.agent_sha or 'HEAD'}^{{commit}}"]).strip()
    notebook = subprocess.run(["git", "-C", str(args.agent_dir), "show", f"{agent_sha}:{AGENT_NOTEBOOK}"],
                              capture_output=True, check=True).stdout
    target = src / "app" / "dbx_inspire_ai_agent.ipynb"
    say(f"App {app_sha[:7]} from {args.app_dir}; agent notebook {agent_sha[:7]} from {args.agent_dir} "
        f"({'changed' if target.read_bytes() != notebook else 'same as the App copy'}, {len(notebook)} bytes)")
    target.write_bytes(notebook)
    shutil.copytree(args.assets, assets)
    say(f"assets copied from {args.assets}: {sum(1 for p in assets.rglob('*') if p.is_file())} files")
    run([sys.executable, str(src / "app" / "installer" / "release.py"), "build", "--assets", str(assets), "--out", str(release), "--tag", args.tag],
        cwd=src / "app", capture=False)
    held = sorted(p.name for p in release.iterdir())
    if held != sorted(PUBLISHED):
        raise SystemExit(f"rc_release: the build holds {held}, a release holds exactly {sorted(PUBLISHED)}")
    manifest = json.loads((release / "manifest.json").read_text(encoding="utf-8"))
    if any("parts" in entry for entry in manifest["files"]):
        raise SystemExit("rc_release: the built manifest.json lists parts, a release carries whole files only")
    if args.tag.split("-rc.")[0] != manifest["version"]:
        raise SystemExit(f"rc_release: tag {args.tag} does not name the version the release carries, {manifest['version']}")
    sources = {"tag": args.tag, "app_sha": app_sha, "agent_sha": agent_sha, "version": manifest["version"],
               "assets_dir": str(args.assets), "assets_manifest_sha256": sha256_file(args.assets / "manifest.json"),
               "files": sorted((p.name, p.stat().st_size) for p in release.iterdir())}
    (work / "sources.json").write_text(json.dumps(sources, indent=1), encoding="utf-8")
    return sources


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def remote_digests(tag, env):
    data = json.loads(run(["gh", "api", f"repos/{REPO}/releases/tags/{tag}"], env=env, network=True))
    return {a["name"]: a.get("digest") for a in data.get("assets") or [] if a.get("state") == "uploaded"}


def notes_of(sources):
    built = f"built from App {sources['app_sha'][:10]} and agent {sources['agent_sha'][:10]}"
    if "-rc." not in sources["tag"]:
        return (f"Inspire {sources['version']}, {built}. Download inspire_installer.py, import it into a workspace folder "
                f"and run it; it installs this release and its assets.")
    return (f"Release candidate {sources['tag']} of Inspire {sources['version']}, {built}. It is a pre-release for testing; "
            f"install the latest release.")


def title_of(tag):
    return f"Inspire {tag}" if "-rc." not in tag else f"Inspire {tag} (release candidate)"


def publish(args, work, sources):
    release = work / "release"
    files = sorted(str(release / name) for name in PUBLISHED)
    active = run(["gh", "api", "user", "--jq", ".login"], network=True).strip()
    token = run(["gh", "auth", "token", "--user", "amralieg"]).strip()
    if not token:
        raise SystemExit("rc_release: gh holds no token for amralieg")
    env = {**os.environ, "GH_TOKEN": token}
    writer = run(["gh", "api", "user", "--jq", ".login"], env=env, network=True).strip()
    if writer != "amralieg":
        raise SystemExit(f"rc_release: the amralieg token signs in as {writer or 'nobody'}")
    say(f"gh writes as {writer} for this process only; the active gh account stays {active or 'unset'}")
    listed = run(["gh", "release", "list", "--repo", REPO, "--limit", "100", "--json", "tagName,isPrerelease,isLatest"], env=env, network=True)
    existing = {r["tagName"]: r for r in json.loads(listed or "[]")}
    if args.tag not in existing:
        run(["gh", "release", "create", args.tag, "--repo", REPO, "--target", args.target or "main", "--prerelease", "--latest=false",
             "--title", title_of(args.tag), "--notes", notes_of(sources)], env=env, network=True)
        say(f"pre-release {args.tag} created on {REPO}")
    elif not existing[args.tag]["isPrerelease"] or existing[args.tag]["isLatest"]:
        raise SystemExit(f"rc_release: {args.tag} exists and is not a pre-release that is not latest; refusing to touch it")
    local = {pathlib.Path(f).name: f"sha256:{sha256_file(f)}" for f in files}
    remote = remote_digests(args.tag, env)
    for name in sorted(set(remote) - set(local)):
        run(["gh", "release", "delete-asset", args.tag, name, "--repo", REPO, "--yes"], env=env, network=True)
        say(f"removed {name}, which this build does not hold")
    todo = sorted((f for f in files if remote.get(pathlib.Path(f).name) != local[pathlib.Path(f).name]),
                  key=lambda f: (pathlib.Path(f).stat().st_size, f))
    say(f"{len(files) - len(todo)} of {len(files)} files are already on the release with the same sha256; {len(todo)} to go")
    deferred = []
    if args.defer_from:
        earlier = set(remote_digests(args.defer_from, env).values())
        deferred = [f for f in todo if local[pathlib.Path(f).name] in earlier]
        todo = [f for f in todo if f not in deferred]
        say(f"deferring {len(deferred)} files whose sha256 is on {args.defer_from}: {[pathlib.Path(f).name for f in deferred]}")
    for number, path in enumerate(todo, 1):
        started = time.time()
        run(["gh", "release", "upload", args.tag, "--repo", REPO, "--clobber", path], env=env, network=True)
        size = pathlib.Path(path).stat().st_size
        say(f"uploaded {number} of {len(todo)}: {pathlib.Path(path).name} ({size:,} bytes, "
            f"{size / max(time.time() - started, 0.001) / 1e6:.2f} MB/s)")
    remote = remote_digests(args.tag, env)
    if deferred:
        on = sum(remote.get(n) == d for n, d in local.items())
        say(f"{on} of {len(local)} files are on {args.tag} with the build's sha256; {len(deferred)} deferred to a fill from {args.defer_from}")
        return None
    if remote != local:
        raise SystemExit(f"rc_release: the release and the build differ in {sorted(set(remote.items()) ^ set(local.items()))[:6]}")
    view = json.loads(run(["gh", "release", "view", args.tag, "--repo", REPO, "--json", "url,isPrerelease"], env=env, network=True))
    listed = run(["gh", "release", "list", "--repo", REPO, "--limit", "100", "--json", "tagName,isPrerelease,isLatest"], env=env, network=True)
    state = {r["tagName"]: r for r in json.loads(listed or "[]")}[args.tag]
    if not state["isPrerelease"] or state["isLatest"]:
        raise SystemExit(f"rc_release: {args.tag} is not a pre-release that is not latest after the upload")
    say(f"release {view['url']}: {len(remote)} files, each with the sha256 of the build; pre-release {state['isPrerelease']}, "
        f"latest {state['isLatest']}")
    return view["url"]


CHECK_LINE = re.compile(r"^release check \S+: ([0-9]+) of ([0-9]+) checks OK, ([0-9]+) failures?$", re.M)


def check_verdict(text):
    """True when the last release check line says every check it counted is OK and none failed."""
    found = CHECK_LINE.findall(text)
    if not found:
        return False
    ok, total, failures = (int(number) for number in found[-1])
    return total > 0 and ok == total and failures == 0


def check(args, work):
    base = f"https://github.com/{REPO}/releases/download/{args.tag}"
    downloaded = work / "downloaded"
    if downloaded.exists():
        shutil.rmtree(downloaded)
    downloaded.mkdir()
    built = json.loads((work / "release" / "manifest.json").read_text(encoding="utf-8"))
    wanted = {built["installer"]["name"]: (built["installer"]["size"], built["installer"]["sha256"])}
    wanted.update({e["name"]: (e["size"], e["sha256"]) for e in built["files"]})
    wanted["manifest.json"] = ((work / "release" / "manifest.json").stat().st_size, sha256_file(work / "release" / "manifest.json"))
    lines, failures = [], 0
    for name in PUBLISHED:
        run(["curl", "-fsSL", "--retry", "3", "-o", str(downloaded / name), f"{base}/{name}"], network=True)
        size, digest = (downloaded / name).stat().st_size, sha256_file(downloaded / name)
        ok = (size, digest) == wanted[name]
        failures += not ok
        lines.append(f"{'OK  ' if ok else 'FAIL'}  {name}  {size} bytes  {digest[:16]}")
    for name in LEFT_OUT:
        probe = downloaded / f"probe_{name}"
        status = run(["curl", "-sSL", "--retry", "3", "-o", str(probe), "-w", "%{http_code}", f"{base}/{name}"], network=True).strip()
        probe.unlink(missing_ok=True)
        failures += status != "404"
        lines.append(f"{'OK  ' if status == '404' else 'FAIL'}  {name}  HTTP {status}, a release carries no {name}")
    installer = downloaded / built["installer"]["name"]
    stamped = re.search(r'^RELEASE_TAG = "([^"]*)"$', installer.read_text(encoding="utf-8"), re.M) if installer.is_file() else None
    stamp_ok = bool(stamped) and stamped.group(1) == args.tag
    failures += not stamp_ok
    lines.append(f"{'OK  ' if stamp_ok else 'FAIL'}  installer stamped {stamped.group(1) if stamped else 'with no tag'}, the release is {args.tag}")
    lines.append(f"release check {base}: {len(PUBLISHED) + len(LEFT_OUT) + 1 - failures} of {len(PUBLISHED) + len(LEFT_OUT) + 1} checks OK, {failures} failures")
    out = "\n".join(lines)
    (work / "check.log").write_text(out, encoding="utf-8")
    print(out)
    if failures:
        raise SystemExit("rc_release: the release check failed")
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("tag")
    parser.add_argument("app_dir", type=pathlib.Path)
    parser.add_argument("agent_dir", type=pathlib.Path)
    parser.add_argument("--assets", type=pathlib.Path, default=None)
    parser.add_argument("--skip-build", action="store_true")
    parser.add_argument("--app-sha", default="", help="build this App commit instead of the App worktree's HEAD")
    parser.add_argument("--agent-sha", default="", help="take the notebook from this agent commit instead of HEAD")
    parser.add_argument("--work", default="", help="the scratch folder under the work setting for this build; defaults to the tag")
    parser.add_argument("--dry-run", action="store_true", help="build and leak-scan only, and compare with --compare-to")
    parser.add_argument("--compare-to", default="", help="a release tag whose files the build is compared with by sha256")
    parser.add_argument("--defer-from", default="", help="a release tag; files with a sha256 on it wait for a server-side fill")
    parser.add_argument("--target", default="", help="the full commit SHA the new tag points at; defaults to main")
    args = parser.parse_args()
    rc_settings.require_tools(S, files=("leak_scan",), commands=("net_wait",))
    if args.target and not re.fullmatch(r"[0-9a-f]{40}", args.target):
        raise SystemExit(f"rc_release: --target {args.target} is not a full commit SHA")
    for tag in (args.tag, args.compare_to, args.defer_from):
        if tag and not TAG.fullmatch(tag):
            raise SystemExit(f"rc_release: {tag} is not vN.N.N-rc.N with single digits")
    work = W22 / (args.work or (f"{args.tag}-dry" if args.dry_run else args.tag))
    if args.skip_build:
        sources = json.loads((work / "sources.json").read_text(encoding="utf-8"))
    elif args.assets is None:
        raise SystemExit("rc_release: --assets names the assets folder a build copies; only --skip-build runs without it")
    else:
        sources = build(args, work)
    hits = leak_scan(work / "release", notes_of(sources))
    if hits:
        raise SystemExit(f"rc_release: {len(hits)} leak hit(s); nothing published")
    if args.compare_to:
        earlier = remote_digests(args.compare_to, None)
        local = {p.name: f"sha256:{sha256_file(p)}" for p in sorted((work / "release").iterdir())}
        same = sorted(n for n, d in local.items() if earlier.get(n) == d)
        say(f"{len(same)} of {len(local)} files equal {args.compare_to} by sha256; differ: {sorted(set(local) - set(same))}")
    if args.dry_run:
        say(f"dry run done in {work}; nothing published")
        return
    url = publish(args, work, sources)
    if url is None:
        say("small files published; run again without --defer-from after the fill to verify and check")
        return
    check(args, work)
    say(f"done: {url}")


if __name__ == "__main__":
    main()
