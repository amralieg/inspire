# Databricks notebook source
# MAGIC %md
# MAGIC # Inspire installer
# MAGIC
# MAGIC **Run All.** The installer gets the latest Inspire release from GitHub, checks the size and sha256 of every file, and installs the Inspire App in this workspace.
# MAGIC
# MAGIC - When this workspace cannot reach GitHub, it uses the release files imported next to this notebook.
# MAGIC - When those are missing too, it shows the commands that download them on your computer and the folder to import them into.
# MAGIC
# MAGIC After the first run, pick or type the **SQL warehouse** and the **Inspire catalog** in the widgets at the top, then run it again.
# MAGIC
# MAGIC **SCAN_CATALOGS** in the next cell picks the catalogs the Inspire App may read besides the Inspire catalog, with USE CATALOG, USE SCHEMA, SELECT and BROWSE, because builds run as the App and read their source tables: `"all"` grants it every catalog you can see and grant on (you own it, hold MANAGE on it, or are a metastore admin) and names the catalogs it skips (the first ten, then a count), and a list such as `["main", "sales"]` grants only those and stops before any change if you cannot grant on one. The installer gives the App the warehouse and the Inspire catalog first, then runs one grant per catalog, several at a time, and prints how far it got.
# MAGIC
# MAGIC **NEW_APPS_CATALOG_ACCESS** lets the Apps that Implement builds read their results: `"account users"` grants account users USE CATALOG on the Inspire catalog when nothing below it is granted to them, so it opens no data by itself, and `"off"` grants nothing and prints the statement for a catalog owner.
# MAGIC
# MAGIC **INSPIRE_SCHEMA** (empty by default) is schema mode for a catalog where you hold CREATE SCHEMA but not MANAGE, such as `"my_catalog.inspire"`: the installer creates that schema if it is missing, keeps Inspire inside it, puts the assets and the App under your own folder, and makes no catalog-level grant. It stops before any change if the App's service principal cannot use the catalog, and prints the one GRANT the catalog owner must run.

# COMMAND ----------

import contextlib
import hashlib
import html
import io
import importlib.util
import json
import os
import re
import socket
import ssl
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile

STARTER_VERSION = 1
RELEASE_REPO = "amralieg/inspire"
INTERNET_BLOCKED = False
SCAN_CATALOGS = "all"
NEW_APPS_CATALOG_ACCESS = "account users"
INSPIRE_SCHEMA = ""
LATEST_BASE = f"https://github.com/{RELEASE_REPO}/releases/latest/download"
TEST_BASE = re.compile(re.escape(f"https://github.com/{RELEASE_REPO}/releases/download/") + r"[A-Za-z0-9][A-Za-z0-9._-]{0,80}")
DOWNLOAD_HOSTS = ("github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com")
INSTALLER = "inspire_installer.py"
MANIFEST = "manifest.json"
WHOLE_FILES = ("inspire-app.zip", "inspire-assets.tar")
RELEASE_FILES = (MANIFEST, INSTALLER) + WHOLE_FILES
SETTINGS = "inspire_installer_test.json"
SETTING_KEYS = ("release", "app_name", "warehouse_id", "catalog", "test_tag")
REACH_TIMEOUT_S = 10
READ_TIMEOUT_S = 120
MANIFEST_LIMIT_BYTES = 1 << 20
STAGE = os.path.join(tempfile.gettempdir(), "inspire_release")
SHA256 = re.compile(r"[0-9a-f]{64}")
SAFE_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,120}")
VERSION = re.compile(r"v[0-9]\.[0-9]\.[0-9]")
NOT_REACHED = "I am not able to connect to GitHub to download the Inspire code"
CUT_SHORT = "I reached GitHub, but could not download every Inspire file"
RUN_AGAIN = "Run this installer again first: it keeps the files it already checked and downloads only the rest."


SECRET_HEADER_RE = re.compile(r"""(["']?)\b(authorization|proxy-authorization|cookie|set-cookie|x-forwarded-access-token|x-databricks-[a-z0-9-]+)\1"""
                              r"""(\s*[:=]\s*)(?:\[[^\]\r\n]*\]|(["'`])[^\r\n"'`]*\4|[^\r\n]*)""", re.IGNORECASE)
SECRET_PATTERNS = (
    re.compile(r"\bBearer\s+\S+", re.IGNORECASE),
    re.compile(r"\bdapi[0-9a-f]{16,}\b", re.IGNORECASE),
    re.compile(r"\bdose[0-9a-f]{16,}\b", re.IGNORECASE),
    re.compile(r"\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{20,}"),
)
SECRET_VALUE_RE = re.compile(r"""\b(token|secret|password|client_secret|access_token)(["']?\s*[:=]\s*["']?)[^\s"',}]+""", re.IGNORECASE)


def redact_secrets(text):
    out = SECRET_HEADER_RE.sub(lambda m: f"{m.group(1)}{m.group(2)}{m.group(1)}{m.group(3)}[redacted]", str(text))
    for pattern in SECRET_PATTERNS:
        out = pattern.sub("[redacted]", out)
    return SECRET_VALUE_RE.sub(lambda m: f"{m.group(1)}{m.group(2)}[redacted]", out)


class RedactedOutput(io.TextIOBase):
    def __init__(self, target):
        self.target = target

    def write(self, text):
        self.target.write(redact_secrets(text))
        return len(text)

    def flush(self):
        self.target.flush()


@contextlib.contextmanager
def redacted_output():
    with contextlib.redirect_stdout(RedactedOutput(sys.stdout)), contextlib.redirect_stderr(RedactedOutput(sys.stderr)):
        yield


def redacted_display(page_html):
    displayHTML(redact_secrets(page_html))


def redact_failure(exc):
    exc.args = tuple(redact_secrets(a) if isinstance(a, str) else a for a in exc.args)
    for name in ("msg", "reason"):
        value = getattr(exc, name, None)
        if isinstance(value, str):
            with contextlib.suppress(AttributeError, TypeError):
                setattr(exc, name, redact_secrets(value))
    return exc


class InspireReleaseError(RuntimeError):
    pass


class InspireTrustError(InspireReleaseError):
    pass


class InspireMixedRelease(InspireReleaseError):
    pass


class InspireStarterTooOld(InspireReleaseError):
    pass


class InspireIncomplete(InspireReleaseError):
    def __init__(self, message, manifest=None):
        super().__init__(message)
        self.manifest = manifest


class InspireDownloadCut(InspireReleaseError):
    def __init__(self, message, manifest):
        super().__init__(message)
        self.manifest = manifest


class InspireNotInstalled(RuntimeError):
    pass


def release_source(settings):
    base = str(settings.get("release") or "").rstrip("/")
    if not base:
        return LATEST_BASE, RELEASE_REPO
    if not TEST_BASE.fullmatch(base):
        raise InspireTrustError(f"The test setting release {base[:200]!r} is not a release of {RELEASE_REPO} on github.com, so it is refused.")
    return base, RELEASE_REPO


def release_page(base):
    return base.replace("/releases/latest/download", "/releases/latest").replace("/releases/download/", "/releases/tag/")


def trusted_url(url, repo):
    text = str(url)
    parts = urllib.parse.urlsplit(text)
    host = (parts.hostname or "").lower()
    if parts.scheme != "https":
        raise InspireTrustError(f"{text[:200]} is not HTTPS, so it is refused.")
    try:
        port = parts.port
    except ValueError:
        port = -1
    if host not in DOWNLOAD_HOSTS or parts.username or parts.password or port not in (None, 443):
        raise InspireTrustError(f"{text[:200]} is not on github.com or its release download host, so it is refused.")
    if host == "github.com" and not parts.path.startswith(f"/{repo}/releases/"):
        raise InspireTrustError(f"{text[:200]} is not a release file of {repo}, so it is refused.")
    return text


class TrustedRedirects(urllib.request.HTTPRedirectHandler):
    def __init__(self, repo):
        super().__init__()
        self.repo = repo

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        trusted_url(urllib.parse.urljoin(req.full_url, newurl), self.repo)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def open_trusted(url, repo, timeout):
    opener = urllib.request.build_opener(TrustedRedirects(repo), urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    return opener.open(urllib.request.Request(url, headers={"User-Agent": "inspire-installer"}), timeout=timeout)


def file_digest(path):
    digest, size = hashlib.sha256(), 0
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
            size += len(block)
    return digest.hexdigest(), size


def matches(path, entry):
    return os.path.isfile(path) and file_digest(path) == (entry["sha256"], entry["size"])


def download(url, dest, repo, size=None, sha256=None, timeout=READ_TIMEOUT_S, opener=open_trusted, limit=None):
    name = os.path.basename(dest)
    cap = size if size is not None else limit
    partial = dest + ".partial"
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    digest, count = hashlib.sha256(), 0
    try:
        with opener(trusted_url(url, repo), repo, timeout) as response, open(partial, "wb") as handle:
            trusted_url(response.geturl(), repo)
            for block in iter(lambda: response.read(1 << 20), b""):
                count += len(block)
                if cap is not None and count > cap:
                    raise InspireReleaseError(f"{name} is larger than the {cap} bytes the release lists, so it is refused.")
                digest.update(block)
                handle.write(block)
        if size is not None and count != size:
            raise InspireReleaseError(f"{name} stopped at {count} of {size} bytes: the download is cut short, so it is refused.")
        if sha256 is not None and digest.hexdigest() != sha256:
            raise InspireReleaseError(f"{name} does not match its sha256 in {MANIFEST}: it is damaged or changed, so it is refused.")
        os.replace(partial, dest)
        return dest
    except (socket.timeout, TimeoutError):
        raise InspireReleaseError(f"no answer for {name} in {timeout} seconds") from None
    finally:
        if os.path.exists(partial):
            os.remove(partial)


def read_json(path, what):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError) as exc:
        raise InspireReleaseError(f"{what} cannot be read ({str(exc)[:160]}). Download it again.") from None


def safe_path(path):
    path = str(path or "")
    return bool(path) and not path.startswith("/") and "\\" not in path and all(p not in ("", ".", "..") for p in path.split("/"))


def check_manifest(manifest):
    def bad(why):
        return InspireReleaseError(f"{MANIFEST} is not an Inspire release manifest this installer reads ({why}). Download it again.")

    if not isinstance(manifest, dict) or manifest.get("format") != 1:
        raise bad("format")
    if not VERSION.fullmatch(str(manifest.get("version") or "")):
        raise bad("version")
    if not isinstance(manifest.get("starter_min_version"), int):
        raise bad("starter_min_version")
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise bad("files")
    names = []
    for entry in files:
        if not isinstance(entry, dict) or not SAFE_NAME.fullmatch(str(entry.get("name") or "")) \
                or entry["name"] in (MANIFEST, INSTALLER) or entry["name"] in names:
            raise bad("a file name")
        if not isinstance(entry.get("size"), int) or entry["size"] < 0 or not SHA256.fullmatch(str(entry.get("sha256") or "")):
            raise bad(f"the size or sha256 of {entry['name']}")
        for item in entry.get("contents") or []:
            if not isinstance(item, dict) or not safe_path(item.get("path")) or not isinstance(item.get("size"), int) \
                    or not SHA256.fullmatch(str(item.get("sha256") or "")) or item.get("notebook") not in (None, "jupyter", "source") \
                    or (item.get("notebook") and not SHA256.fullmatch(str(item.get("code_sha256") or ""))):
                raise bad(f"the contents of {entry['name']}")
        if entry.get("unzip_folder") is not None and not SAFE_NAME.fullmatch(str(entry["unzip_folder"])):
            raise bad(f"the folder of {entry['name']}")
        if entry.get("unzip_marker") is not None and not safe_path(entry["unzip_marker"]):
            raise bad(f"the marker of {entry['name']}")
        names.append(entry["name"])
    entry = manifest.get("entry")
    if not isinstance(entry, dict) or entry.get("file") not in names or not safe_path(entry.get("module")) \
            or not re.fullmatch(r"[a-z_][a-z0-9_]*", str(entry.get("function") or "")):
        raise bad("entry")
    return manifest


def check_starter(manifest, base=LATEST_BASE):
    if manifest["starter_min_version"] > STARTER_VERSION:
        raise InspireStarterTooOld(
            f"Inspire {manifest['version']} needs a newer installer than this one (installer {STARTER_VERSION}, needed "
            f"{manifest['starter_min_version']}). Download the latest installer from {base}/{INSTALLER}, import it in place "
            "of this notebook, and run it.")


def mixed(name, version):
    return InspireMixedRelease(
        f"The files next to this installer are not one Inspire release: {name} does not match {MANIFEST} of Inspire {version}. "
        "It comes from another release or it was changed. Download every file of one release again and import them here.")


def notebook_code_sha256(kind, data):
    if kind == "jupyter":
        cells = json.loads(data.decode("utf-8")).get("cells") or []
        code = json.dumps([[cell.get("cell_type"), "".join(cell.get("source") or []) if isinstance(cell.get("source"), list)
                            else str(cell.get("source") or "")] for cell in cells], ensure_ascii=False)
    else:
        code = data.decode("utf-8").rstrip("\n")
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def cli_import(name, folder):
    path = folder[len("/Workspace"):] if folder.startswith("/Workspace/") else folder
    return f'databricks workspace import "{path}/{name}" --file {name} --format RAW --overwrite'


def import_as_file(name, folder):
    return f"from the folder that holds the download, run: {cli_import(name, folder)} (format RAW keeps {name} as one file)"


def check_unzipped(entry, root, folder, exporter, version, stage):
    contents = entry.get("contents") or []
    absent, changed, found = [], [], {}
    for item in contents:
        path = os.path.join(root, item["path"])
        if os.path.isfile(path):
            with open(path, "rb") as handle:
                data = handle.read()
            if (hashlib.sha256(data).hexdigest(), len(data)) != (item["sha256"], item["size"]):
                changed.append(item["path"])
            found[item["path"]] = data
            continue
        data = exporter(os.path.splitext(path)[0], item["notebook"]) if item.get("notebook") and exporter else None
        if data is None:
            absent.append(item["path"])
        elif notebook_code_sha256(item["notebook"], data) != item["code_sha256"]:
            changed.append(item["path"])
        else:
            found[item["path"]] = data
    if changed:
        raise mixed(f"{changed[0]} in the folder {root}", version)
    if not contents or absent:
        kept = len(contents) - len(absent)
        raise InspireIncomplete(
            f"The workspace unzipped {entry['name']} into {root} and kept {kept} of {len(contents)} files (missing "
            f"{', '.join(absent[:5]) or 'its file list'}). Delete what it unzipped, then {import_as_file(entry['name'], folder)}.")
    target = os.path.join(stage, "unzipped", entry["name"])
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for item in contents:
            archive.writestr(item["path"], found[item["path"]])
    return target


def local_entry(entry, folder, stage, version, exporter=None):
    whole = os.path.join(folder, entry["name"])
    if os.path.isfile(whole):
        if matches(whole, entry):
            return "file", whole
        raise mixed(entry["name"], version)
    unzipped = os.path.join(folder, str(entry.get("unzip_folder") or ""))
    if entry.get("unzip_folder") and os.path.isdir(unzipped):
        return "folder", check_unzipped(entry, unzipped, folder, exporter, version, stage)
    if entry.get("unzip_marker") and os.path.isfile(os.path.join(folder, entry["unzip_marker"])):
        return "folder", check_unzipped(entry, folder, folder, exporter, version, stage)
    return "missing", [entry["name"]]


def github_reachable(base, repo, incoming, opener=open_trusted):
    if INTERNET_BLOCKED:
        return False
    download(f"{base}/{MANIFEST}", incoming, repo, timeout=REACH_TIMEOUT_S, opener=opener, limit=MANIFEST_LIMIT_BYTES)
    return True


def acquire_online(base, repo, folder, opener=open_trusted):
    incoming = os.path.join(STAGE, "incoming", MANIFEST)
    if not github_reachable(base, repo, incoming, opener):
        raise InspireReleaseError("not tried, because INTERNET_BLOCKED is True in this installer.")
    manifest = check_manifest(read_json(incoming, MANIFEST))
    check_starter(manifest, base)
    version = manifest["version"]
    stage = os.path.join(STAGE, version)
    files = {}
    for entry in manifest["files"]:
        target = os.path.join(stage, entry["name"])
        try:
            kind, found = local_entry(entry, folder, stage, version)
        except InspireReleaseError:
            kind, found = "missing", None
        if kind == "file":
            print(f"  {entry['name']}: ✅ next to this installer, {entry['size']} bytes, sha256 checked")
            files[entry["name"]] = found
            continue
        if matches(target, entry):
            print(f"  {entry['name']}: ✅ downloaded before, {entry['size']} bytes, sha256 checked")
        else:
            print(f"  {entry['name']}: downloading {entry['size']} bytes from {base}")
            try:
                download(f"{base}/{entry['name']}", target, repo, entry["size"], entry["sha256"], opener=opener)
            except Exception as exc:
                raise InspireDownloadCut(describe(exc), manifest) from None
            print(f"  {entry['name']}: ✅ downloaded, sha256 checked")
        files[entry["name"]] = target
    return {"source": "online", "manifest": manifest, "files": files, "stage": stage}


def acquire_local(folder, exporter=None, base=LATEST_BASE):
    path = os.path.join(folder, MANIFEST)
    if not os.path.isfile(path):
        raise InspireIncomplete(f"No {MANIFEST} is next to this installer in {folder}.")
    manifest = check_manifest(read_json(path, f"{MANIFEST} next to this installer"))
    check_starter(manifest, base)
    version = manifest["version"]
    stage = os.path.join(STAGE, version)
    files, absent, notes = {}, [], {}
    for entry in manifest["files"]:
        kind, found = local_entry(entry, folder, stage, version, exporter)
        if kind == "missing":
            absent.extend(found)
            continue
        files[entry["name"]] = found
        notes[entry["name"]] = "unzipped by the workspace, every file checked" if kind == "folder" else "sha256 checked"
    if absent:
        raise InspireIncomplete(f"The release files next to this installer are incomplete: {', '.join(absent[:8])} "
                                f"{'is' if len(absent) == 1 else 'are'} missing.", manifest)
    for name, note in notes.items():
        print(f"  {name}: ✅ next to this installer, {note}")
    return {"source": "local", "manifest": manifest, "files": files, "stage": stage}


def describe(exc):
    if isinstance(exc, urllib.error.HTTPError):
        return f"HTTP {exc.code} {exc.reason}"
    if isinstance(exc, urllib.error.URLError):
        return f"no connection ({exc.reason})"
    return str(exc)[:300]


def download_commands(base):
    unix = ["mkdir -p inspire-release && cd inspire-release", f'base="{base}"',
            f'for f in {" ".join(RELEASE_FILES)}; do curl -fL --retry 3 -O "$base/$f"; done']
    mac = unix + [
        f'field() {{ plutil -extract "$1" raw -o - {MANIFEST}; }}',
        '{ echo "$(field installer.sha256)  $(field installer.name)"; i=0; while [ "$i" -lt "$(field files)" ]; do '
        'echo "$(field files.$i.sha256)  $(field files.$i.name)"; i=$((i + 1)); done; } | shasum -a 256 -c',
    ]
    linux = unix + [
        f"python3 -c 'import json; m = json.load(open(\"{MANIFEST}\")); "
        "print(\"\\n\".join(e[\"sha256\"] + \"  \" + e[\"name\"] for e in [m[\"installer\"]] + m[\"files\"]))' | sha256sum -c -",
    ]
    listed = ", ".join(f'"{name}"' for name in RELEASE_FILES)
    windows = [
        '$ProgressPreference = "SilentlyContinue"',
        "New-Item -ItemType Directory -Force -Path inspire-release | Out-Null; Set-Location inspire-release",
        f'$base = "{base}"',
        f'foreach ($f in @({listed})) {{ Invoke-WebRequest -UseBasicParsing -Uri "$base/$f" -OutFile $f }}',
        f"$m = Get-Content {MANIFEST} -Raw | ConvertFrom-Json",
        'foreach ($e in @($m.installer) + @($m.files)) { if ((Get-FileHash -Algorithm SHA256 $e.name).Hash -eq $e.sha256) '
        f'{{ "OK $($e.name)" }} else {{ Write-Error "$($e.name) does not match {MANIFEST}" }} }}',
    ]
    return [("macOS", mac), ("Linux", linux), ("Windows PowerShell", windows)]


def direct_links(base, manifest=None):
    listed = [manifest.get("installer") or {}] + manifest["files"] if manifest else []
    sizes = {entry.get("name"): entry.get("size") for entry in listed}
    return [(name, f"{base}/{name}", sizes.get(name)) for name in RELEASE_FILES]


def size_text(size):
    if size is None:
        return "size on the release page"
    return f"{size / 1000000:.1f} MB ({size} bytes)"


def offline_page(base, folder, notebook, reasons, manifest=None, reached=False):
    title = CUT_SHORT if reached else NOT_REACHED
    commands = download_commands(base)
    links = direct_links(base, manifest)
    page = release_page(base)
    step1 = (f"Run the commands for your system. They download the {len(RELEASE_FILES)} release files "
             f"({', '.join(RELEASE_FILES)}) and check the sha256 of each against {MANIFEST}.")
    step2 = [f"Import {', '.join((MANIFEST,) + WHOLE_FILES)} into this workspace folder, next to this installer.",
             f"The workspace import unpacks {WHOLE_FILES[0]}: its files (app.yaml, start.sh, the backend, frontend and installer folders "
             "and the Inspire notebooks) appear next to this installer. Leave them as they are: the installer checks every file in them.",
             "To import every file whole instead, run these Databricks CLI commands from the folder that holds the download:",
             f"You already have {INSTALLER} here. Import the downloaded one in place of this notebook only when this installer says it is too old."]
    text = [title, ""] + [f"  {reason}" for reason in reasons] + [""] + ([RUN_AGAIN, ""] if reached else []) + [
            f"1. On a computer that can reach GitHub: {step1}", ""]
    for system, lines in commands:
        text += [f"   {system}:"] + [f"     {line}" for line in lines] + [""]
    cli = [cli_import(name, folder) for name in (MANIFEST,) + WHOLE_FILES]
    text += [f"2. {step2[0]} The folder: {folder}", f"   {step2[1]}", f"   {step2[2]}"] + [f"     {line}" for line in cli] + [f"   {step2[3]}"]
    text += [f"3. Then run this installer again: {notebook}", "",
             f"If the commands fail, download each file from these links (release page: {page}):"]
    text += [f"   {name}  {size_text(size)}  {url}" for name, url, size in links]
    esc = html.escape
    block = lambda lines: "<pre style=\"background:#f4f6f8;border:1px solid #d0d7de;border-radius:6px;padding:10px;overflow-x:auto;font-size:12px\">" \
        + esc("\n".join(lines)) + "</pre>"
    parts = [
        '<div style="font-family:sans-serif;max-width:980px;padding:18px 22px;border:1px solid #f5c26b;border-radius:12px;background:#fffaf0;color:#2b2b2b">',
        f'<h2 style="margin:0 0 10px 0;color:#7a4b00">{esc(title)}</h2>',
        "<ul>" + "".join(f"<li>{esc(reason)}</li>" for reason in reasons) + "</ul>",
        f"<p><b>{esc(RUN_AGAIN)}</b></p>" if reached else "",
        "<h3>1. Download the release on a computer that can reach GitHub</h3>",
        f"<p>{esc(step1)}</p>",
    ]
    for system, lines in commands:
        parts += [f"<p><b>{esc(system)}</b></p>", block(lines)]
    parts += [
        "<h3>2. Import the files into this workspace folder, next to this installer</h3>",
        f"<p>{esc(step2[0])}</p>",
        block([folder]),
        f"<p>{esc(step2[1])}</p><p>{esc(step2[2])}</p>",
        block(cli),
        f"<p>{esc(step2[3])}</p>",
        f"<h3>3. Then run this installer again</h3><p><code>{esc(notebook)}</code></p>",
        f'<h3>If the commands fail, download each file from these links</h3><p>Release page: <a href="{esc(page)}" target="_blank">{esc(page)}</a></p>',
        "<table style=\"border-collapse:collapse;font-size:13px\">"
        + "".join(f'<tr><td style="padding:3px 12px 3px 0"><a href="{esc(url)}" target="_blank">{esc(name)}</a></td>'
                  f'<td style="padding:3px 0">{esc(size_text(size))}</td></tr>' for name, url, size in links)
        + "</table></div>",
    ]
    return "".join(parts), "\n".join(text)


def stop_page(title, message):
    esc = html.escape
    return (f'<div style="font-family:sans-serif;max-width:980px;padding:18px 22px;border:1px solid #f5c26b;border-radius:12px;'
            f'background:#fffaf0;color:#2b2b2b"><h2 style="margin:0 0 10px 0;color:#7a4b00">{esc(title)}</h2>'
            f'<p>{esc(message)}</p></div>'), f"{title}\n{message}"


def show(page_html, text):
    print(text)
    try:
        redacted_display(page_html)
    except NameError:
        pass


def read_settings(folder):
    path = os.path.join(folder, SETTINGS)
    if not os.path.isfile(path):
        return {}
    settings = read_json(path, SETTINGS)
    if not isinstance(settings, dict) or set(settings) - set(SETTING_KEYS):
        raise InspireReleaseError(f"{SETTINGS} holds settings this installer does not know; it reads only {', '.join(SETTING_KEYS)}.")
    for key in SETTING_KEYS:
        if key in settings and not isinstance(settings[key], str):
            raise InspireReleaseError(f"{key} in {SETTINGS} must be text.")
    return settings


def installer_folder():
    path = dbutils.notebook.entry_point.getDbutils().notebook().getContext().notebookPath().get()
    path = path if path.startswith("/Workspace/") else "/Workspace" + path
    return path.rsplit("/", 1)[0], path


def workspace_exporter(stem, kind):
    import base64
    from databricks.sdk import WorkspaceClient
    from databricks.sdk.service.workspace import ExportFormat
    api_path = stem[len("/Workspace"):] if stem.startswith("/Workspace/") else stem
    try:
        exported = WorkspaceClient().workspace.export(api_path, format=ExportFormat.JUPYTER if kind == "jupyter" else ExportFormat.SOURCE)
    except Exception:
        return None
    return base64.b64decode(exported.content or "")


def load_entry(release):
    manifest, entry = release["manifest"], release["manifest"]["entry"]
    listed = {item["path"]: item for e in manifest["files"] if e["name"] == entry["file"] for item in e.get("contents") or []}
    with zipfile.ZipFile(release["files"][entry["file"]]) as archive:
        try:
            data = archive.read(entry["module"])
        except KeyError:
            raise InspireReleaseError(f"{entry['file']} holds no {entry['module']}. Download the release again.") from None
    item = listed.get(entry["module"])
    if item is None or (hashlib.sha256(data).hexdigest(), len(data)) != (item["sha256"], item["size"]):
        raise mixed(entry["module"], manifest["version"])
    target = os.path.join(release["stage"], "module", os.path.basename(entry["module"]))
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "wb") as handle:
        handle.write(data)
    spec = importlib.util.spec_from_file_location(f"inspire_setup_{manifest['version'].replace('.', '_')}", target)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return getattr(module, entry["function"])


def acquire(folder, notebook, settings, opener=None, exporter=None):
    opener, exporter = opener or open_trusted, exporter or workspace_exporter
    base, repo = release_source(settings)
    reasons, known, reached = [], None, False
    print(f"Inspire installer {STARTER_VERSION}: release {base}")
    try:
        return acquire_online(base, repo, folder, opener)
    except InspireStarterTooOld as exc:
        show(*stop_page("This installer is too old for the latest Inspire", str(exc)))
        raise InspireNotInstalled(str(exc)) from None
    except InspireDownloadCut as exc:
        reasons.append(f"GitHub: {exc}")
        known, reached = exc.manifest, True
    except Exception as exc:
        reasons.append(f"GitHub: {describe(exc)}")
    print(f"  {reasons[-1].rstrip('.')}. Looking for the release files next to this installer in {folder}")
    try:
        return acquire_local(folder, exporter, base)
    except InspireMixedRelease as exc:
        show(*stop_page("The files next to this installer are not one Inspire release", str(exc)))
        raise InspireNotInstalled(str(exc)) from None
    except InspireStarterTooOld as exc:
        show(*stop_page("This installer is too old for the Inspire files next to it", str(exc)))
        raise InspireNotInstalled(str(exc)) from None
    except InspireIncomplete as exc:
        reasons.append(str(exc))
        known = known or exc.manifest
    except InspireReleaseError as exc:
        reasons.append(str(exc))
    show(*offline_page(base, folder, notebook, reasons, known, reached))
    raise InspireNotInstalled(f"{CUT_SHORT if reached else NOT_REACHED}, and no complete release is next to this installer. "
                              f"{RUN_AGAIN + ' ' if reached else ''}The steps above show how to get it.")


def inspire_install_main():
    with redacted_output():
        return install_redacted()


def install_redacted():
    try:
        folder, notebook = installer_folder()
        settings = read_settings(folder)
        release = acquire(folder, notebook, settings)
        print(f"Inspire {release['manifest']['version']}: every file checked ({release['source']}), starting the install")
        run = load_entry(release)
        return run({
            "dbutils": dbutils,
            "displayHTML": redacted_display,
            "starter_version": STARTER_VERSION,
            "manifest": release["manifest"],
            "files": release["files"],
            "source": release["source"],
            "installer_folder": folder,
            "settings": settings,
            "scan_catalogs": SCAN_CATALOGS,
            "new_apps_catalog_access": NEW_APPS_CATALOG_ACCESS,
            "inspire_schema": INSPIRE_SCHEMA,
        }), None
    except Exception as exc:
        return None, redact_failure(exc)

# COMMAND ----------

installed, failure = inspire_install_main()

# COMMAND ----------

if failure is not None:
    raise failure
