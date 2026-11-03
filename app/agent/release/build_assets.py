import argparse
import ast
import hashlib
import importlib.util
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NOTEBOOK = os.path.join(ROOT, "agent", "dbx_inspire_ai_agent.ipynb")
RELEASE = os.path.join(os.path.dirname(ROOT), "installer", "release.py")
LICENSE = os.path.join(os.path.dirname(os.path.dirname(ROOT)), "LICENSE")
PYPI = os.environ.get("INSPIRE_ASSETS_PYPI", "https://pypi.org").rstrip("/")
ATTEMPTS = 8
FONT_LICENSE_COMMIT = "6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec"
FONT_FILES = {
    ("Inter", 400): "inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfMZg.ttf",
    ("Inter", 600): "inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuGKYMZg.ttf",
    ("Inter", 700): "inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZg.ttf",
    ("Fraunces", 600): "fraunces/v38/6NUh8FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0K7iN7hzFUPJH58nib1603gg7S2nfgRYIcaRyjDg.ttf",
    ("Fraunces", 700): "fraunces/v38/6NUh8FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0K7iN7hzFUPJH58nib1603gg7S2nfgRYIcUByjDg.ttf",
    ("Noto Sans Arabic", 400): "notosansarabic/v33/nwpxtLGrOAZMl5nJ_wfgRg3DrWFZWsnVBJ_sS6tlqHHFlhQ5l3sQWIHPqzCfyGyvuw.ttf",
    ("Noto Sans Arabic", 700): "notosansarabic/v33/nwpxtLGrOAZMl5nJ_wfgRg3DrWFZWsnVBJ_sS6tlqHHFlhQ5l3sQWIHPqzCfL2uvuw.ttf",
    ("Noto Sans Devanagari", 400): "notosansdevanagari/v33/TuGoUUFzXI5FBtUq5a8bjKYTZjtRU6Sgv3NaV_SNmI0b8QQCQmHn6B2OHjbL_08AlXQly-A.ttf",
    ("Noto Sans Devanagari", 700): "notosansdevanagari/v33/TuGoUUFzXI5FBtUq5a8bjKYTZjtRU6Sgv3NaV_SNmI0b8QQCQmHn6B2OHjbL_08AlZMiy-A.ttf",
    ("Noto Sans Tamil", 400): "notosanstamil/v31/ieVc2YdFI3GCY6SyQy1KfStzYKZgzN1z4LKDbeZce-0429tBManUktuex7vGo70R.ttf",
    ("Noto Sans Tamil", 700): "notosanstamil/v31/ieVc2YdFI3GCY6SyQy1KfStzYKZgzN1z4LKDbeZce-0429tBManUktuex7shpL0R.ttf",
    ("Noto Sans Thai", 400): "notosansthai/v29/iJWnBXeUZi_OHPqn4wq6hQ2_hbJ1xyN9wd43SofNWcd1MKVQt_So_9CdU5RtpzE.ttf",
    ("Noto Sans Thai", 700): "notosansthai/v29/iJWnBXeUZi_OHPqn4wq6hQ2_hbJ1xyN9wd43SofNWcd1MKVQt_So_9CdU3NqpzE.ttf",
    ("Noto Sans KR", 400): "notosanskr/v40/PbyxFmXiEBPT4ITbgNA5Cgms3VYcOA-vvnIzzuoyeLQ.ttf",
    ("Noto Sans KR", 700): "notosanskr/v40/PbyxFmXiEBPT4ITbgNA5Cgms3VYcOA-vvnIzzg01eLQ.ttf",
    ("Noto Sans JP", 400): "notosansjp/v57/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFBEj75s.ttf",
    ("Noto Sans JP", 700): "notosansjp/v57/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFPYk75s.ttf",
    ("Noto Sans SC", 400): "notosanssc/v41/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG9_FnYw.ttf",
    ("Noto Sans SC", 700): "notosanssc/v41/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaGzjCnYw.ttf",
}
FONT_SHA256 = {
    ("Fraunces", 600): "ff7cf63717c27756df857ca12045a83522569f7b561bedaff813a25274eb263f",
    ("Fraunces", 700): "f0a9d39b9f14079c55070189562da36c794f824cbcf514b50a0ad0ef20c69379",
    ("Inter", 400): "1b08e7fc267a5c7e1d614100f604b83e7e8a0be241f0f288faa2b3ac93a683ba",
    ("Inter", 600): "e7a1aaf7eda9f2fad4131725fa556265ec75ca7b2d756260173a040363e8d4f7",
    ("Inter", 700): "b37284b5701b6b168dfc770aa1a4ac492106422fd3ba76bc7641e37434e8019c",
    ("Noto Sans Arabic", 400): "146b2193f4aee343a8da5e2295255b04db547d74339a12be51763b3a0081868d",
    ("Noto Sans Arabic", 700): "195e8d8e1e723630e46c1d19fe7ec118a73e5825baa198737d6a96df8c4063b1",
    ("Noto Sans Devanagari", 400): "1ec0511798a17f5a137aa83671fded50120f79cecafa7189ad76cc55803bc4ee",
    ("Noto Sans Devanagari", 700): "824deb102aa98a0940ec625b3cc8b0196afc42f4124feac5abfd3537ad5d3444",
    ("Noto Sans JP", 400): "f037d714109f22d57ce75fd9a6b9d23439c903061fb11106c070b2dcc03f2021",
    ("Noto Sans JP", 700): "59bb5d2915bba3a256950116e7a48a810bd8cde63793d5111b9e5726eec1e799",
    ("Noto Sans KR", 400): "84e2b8acadd0a01af9f0de6b0a2d29117fb5b0eabd7c2f8353d9d2da0461d5fa",
    ("Noto Sans KR", 700): "7c81aeacbc15d1a18de6928dddf66cf272fa1dcc401715cfd8325def9390533f",
    ("Noto Sans SC", 400): "450625c8d46ab3df97b7904ded955ec2746d17ec76740cb1e91d1ba63a0f89af",
    ("Noto Sans SC", 700): "0066a522a1ac007c1d72bc4fccb114f80ff7294641c78cead9715bd14d43b9ea",
    ("Noto Sans Tamil", 400): "0d36491d4b3b945d1b4d1258755e79b67cc6fffd9614531bf17fbfe532bd55f8",
    ("Noto Sans Tamil", 700): "abecad237d6cf136b8d72012e435a3bcbab48c8232f57a65ed353024486ce3f9",
    ("Noto Sans Thai", 400): "6c5e4ca047263ed8f07b174be2f7c396d245504ce0f77adc1d26b0978bc95426",
    ("Noto Sans Thai", 700): "fd475b89dca5b9b2ad5f294944c6c82a1641c29b0a30bc1b771227250fb826a8",
}
FONT_HOST = "https://fonts.gstatic.com/s/"
FONT_LICENSE = "https://raw.githubusercontent.com/google/fonts/{commit}/ofl/{folder}/OFL.txt"
CLI_LICENSE = "https://raw.githubusercontent.com/{repo}/v{version}/{name}"
LICENSE_NAMES = re.compile(r"(^|/)(LICEN[CS]E|COPYING|NOTICE|AUTHORS)[^/]*$", re.I)
PROBE_SOURCE = """# Databricks notebook source
import json, platform, sys
dbutils.notebook.exit(json.dumps({"machine": platform.machine(), "version": sys.version,
                                  "python": "%d.%d" % sys.version_info[:2]}))
"""
NAMES = ("__AGENT_VERSION__", "GENIE_NOTEBOOK_ENV_VERSION", "GENIE_CODE_CLI_VERSION", "GENIE_DATABRICKS_CLI_VERSION",
         "INSPIRE_ASSETS_FORMAT", "INSPIRE_ASSETS_MANIFEST", "INSPIRE_ASSETS_PYTHON", "INSPIRE_APP_ASSETS_PYTHON",
         "INSPIRE_ASSET_MACHINES", "INSPIRE_ASSET_WHEELS", "INSPIRE_ASSET_MODULES", "INSPIRE_APP_ASSET_WHEELS", "INSPIRE_ASSET_CLIS",
         "INSPIRE_ASSET_CLI_SOURCES", "INSPIRE_ASSET_RELEASE_PATH", "INSPIRE_ASSET_CLI_RELEASE", "INSPIRE_NOTEBOOK_ASSETS")
FUNCTIONS = ("inspire_asset_slug", "inspire_asset_file", "inspire_cli_release_file", "inspire_cli_release_url")


def log(text: str):
    print(f"{time.strftime('%H:%M:%S', time.gmtime())} {text}", flush=True)


def notebook_pins(path: str = NOTEBOOK) -> dict:
    with open(path, encoding="utf-8") as handle:
        source = "".join(json.load(handle)["cells"][1]["source"])
    tree = ast.parse("\n".join("" if l.startswith(("%", "!")) and not l.startswith("!=") else l for l in source.split("\n")))
    pins, defs = {"re": re}, {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and getattr(node.targets[0], "id", None) in NAMES:
            pins[node.targets[0].id] = eval(compile(ast.Expression(node.value), path, "eval"), {"__builtins__": {}}, pins)
        elif isinstance(node, ast.FunctionDef) and node.name in FUNCTIONS:
            defs[node.name] = ast.get_source_segment(source, node)
        elif isinstance(node, ast.ClassDef) and node.name == "DatabricksInspire":
            for item in node.body:
                if isinstance(item, ast.Assign) and getattr(item.targets[0], "id", None) == "_DOC_FONT_FAMILIES":
                    pins["_DOC_FONT_FAMILIES"] = ast.literal_eval(item.value)
    missing = [n for n in NAMES + ("_DOC_FONT_FAMILIES",) if n not in pins] + [n for n in FUNCTIONS if n not in defs]
    if missing:
        raise SystemExit(f"the notebook does not define {', '.join(missing)}")
    for name in FUNCTIONS:
        exec(defs[name], pins)
    return pins


CACHE = []


def fetch(url: str, accept: str = "", sha: str = "") -> bytes:
    cached = os.path.join(CACHE[0], sha) if CACHE and sha else ""
    if cached and os.path.exists(cached):
        with open(cached, "rb") as handle:
            data = handle.read()
        if hashlib.sha256(data).hexdigest() == sha:
            return data
    data = _download(url, accept)
    if cached and hashlib.sha256(data).hexdigest() == sha:
        with open(cached, "wb") as handle:
            handle.write(data)
    return data


def _download(url: str, accept: str = "") -> bytes:
    last = None
    for attempt in range(ATTEMPTS):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "inspire-assets-build/1", **({"Accept": accept} if accept else {})})
            with urllib.request.urlopen(request, timeout=300) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code in (400, 401, 403, 404, 410):
                raise SystemExit(f"{url} answered HTTP {error.code}")
            last = error
        except (OSError, ValueError) as error:
            last = error
        log(f"retrying {url} after {type(last).__name__}: {str(last)[:120]}")
        time.sleep(min(60, 5 * (attempt + 1)))
    raise SystemExit(f"{url} could not be fetched after {ATTEMPTS} attempts: {last}")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def cli(*args) -> str:
    done = subprocess.run(["databricks", *args], capture_output=True, text=True)
    if done.returncode:
        raise SystemExit(f"databricks {' '.join(args[:3])} failed: {(done.stderr or done.stdout).strip()[:600]}")
    return done.stdout


def probe(profile: str, env_version: str) -> dict:
    me = json.loads(cli("current-user", "me", "--profile", profile, "-o", "json"))["userName"]
    path = f"/Users/{me}/.inspire_assets_probe_{int(time.time())}"
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as handle:
        handle.write(PROBE_SOURCE)
    try:
        cli("workspace", "import", path, "--file", handle.name, "--language", "PYTHON", "--format", "SOURCE", "--overwrite",
            "--profile", profile)
        spec = {"run_name": "inspire assets probe", "tasks": [{"task_key": "probe", "notebook_task": {"notebook_path": path},
                                                                "environment_key": "inspire"}],
                "environments": [{"environment_key": "inspire", "spec": {"environment_version": env_version}}]}
        run = json.loads(cli("jobs", "submit", "--json", json.dumps(spec), "--profile", profile, "-o", "json"))
        task = json.loads(cli("jobs", "get-run", str(run["run_id"]), "--profile", profile, "-o", "json"))["tasks"][0]["run_id"]
        result = json.loads(cli("jobs", "get-run-output", str(task), "--profile", profile, "-o", "json"))
        found = json.loads(result["notebook_output"]["result"])
    finally:
        os.remove(handle.name)
        subprocess.run(["databricks", "workspace", "delete", path, "--profile", profile], capture_output=True, text=True)
    log(f"serverless environment {env_version} probe: machine {found['machine']}, Python {found['version'].split()[0]}")
    return found


def wheel_for(name: str, version: str, python: str, machine: str) -> tuple:
    data = json.loads(fetch(f"{PYPI}/pypi/{name}/{version}/json"))
    wheels = [u for u in data["urls"] if u["filename"].endswith(".whl")]
    pure = [u for u in wheels if u["filename"].endswith("-py3-none-any.whl")]
    if pure:
        return pure[0], "any", "any"
    tag = f"cp{python.replace('.', '')}"
    arch = {"x86_64": "x86_64", "aarch64": "aarch64"}[machine]
    fits = [u for u in wheels if f"-{tag}-{tag}-" in u["filename"] and "musllinux" not in u["filename"]
            and re.search(rf"manylinux[^-]*_{arch}", u["filename"])]
    if not fits:
        raise SystemExit(f"{name} {version} has no manylinux wheel for {tag} on {machine}")

    def glibc(url):
        found = [tuple(map(int, m)) for m in re.findall(r"manylinux_(\d+)_(\d+)", url["filename"])]
        return min(found) if found else (2, 17)

    return sorted(fits, key=glibc)[0], machine, python


def wheel_license(wheel: bytes, name: str) -> str:
    with zipfile.ZipFile(io.BytesIO(wheel)) as archive:
        found = sorted(n for n in archive.namelist() if ".dist-info/" in n and LICENSE_NAMES.search(n))
        texts = [f"{n.split('.dist-info/', 1)[1]}\n\n{archive.read(n).decode('utf-8', 'replace').strip()}\n" for n in found]
    if not texts:
        raise SystemExit(f"the {name} wheel carries no license file")
    return "\n\n".join(texts)


class Bundle:
    def __init__(self, pins: dict):
        self.pins, self.files, self.entries = pins, {}, []

    def add(self, kind: str, name: str, version: str, file: str, data: bytes, license_file: str, **extra):
        if file in self.files and self.files[file] != data:
            raise SystemExit(f"{file} would hold two different files")
        self.files[file] = data
        self.entries.append(dict({"name": name, "version": version, "kind": kind, "file": file, "size": len(data),
                                  "sha256": sha256(data), "license": license_file}, **extra))

    def license(self, name: str, version: str, text: str) -> str:
        file = self.pins["inspire_asset_file"]("license", name)
        if file not in self.files:
            self.add("license", name, version, file, text.encode("utf-8"), file)
        return file


def add_python(bundle: Bundle, pins: dict, python: str, machines: list, names) -> None:
    for name in names:
        version = pins["INSPIRE_ASSET_WHEELS"][name]
        for machine in machines:
            url, wheel_machine, wheel_python = wheel_for(name, version, python, machine)
            file = pins["inspire_asset_file"]("python", name, wheel_machine, wheel_python)
            if any(e["file"] == file for e in bundle.entries):
                continue
            data = fetch(url["url"], sha=url["digests"]["sha256"])
            if sha256(data) != url["digests"]["sha256"]:
                raise SystemExit(f"{url['filename']} does not match the sha256 PyPI publishes")
            license_file = bundle.license(name, version, wheel_license(data, name))
            bundle.add("python", name, version, file, data, license_file, machine=wheel_machine, python=wheel_python,
                       source=url["filename"])
            log(f"python {name} {version} {wheel_machine} {wheel_python}: {len(data):,} bytes")


def add_fonts(bundle: Bundle, pins: dict) -> None:
    families = {}
    for family, weights in pins["_DOC_FONT_FAMILIES"].values():
        families.setdefault(family, set()).update(weights)
    for family, weights in sorted(families.items()):
        folder = FONT_FILES[(family, min(weights))].split("/", 1)[0]
        version = FONT_FILES[(family, min(weights))].split("/")[1]
        license_file = bundle.license(family, version, fetch(FONT_LICENSE.format(commit=FONT_LICENSE_COMMIT, folder=folder)).decode("utf-8"))
        for weight in sorted(weights):
            if (family, weight) not in FONT_FILES:
                raise SystemExit(f"no pinned font file for {family} {weight}; add it to FONT_FILES")
            data = fetch(FONT_HOST + FONT_FILES[(family, weight)], sha=FONT_SHA256[(family, weight)])
            if sha256(data) != FONT_SHA256[(family, weight)]:
                raise SystemExit(f"{family} {weight} does not match its pinned sha256; Google Fonts changed the file")
            if data[:4] not in (b"\x00\x01\x00\x00", b"true", b"OTTO"):
                raise SystemExit(f"{family} {weight} is not a TrueType or OpenType font")
            bundle.add("font", family, version, pins["inspire_asset_file"]("font", family, weight=weight), data, license_file, weight=weight)
            log(f"font {family} {weight} {version}: {len(data):,} bytes")


def add_notebook(bundle: Bundle, pins: dict, root: str = ROOT) -> None:
    version = pins["__AGENT_VERSION__"]
    with open(LICENSE, encoding="utf-8") as handle:
        license_file = bundle.license("inspire", version, handle.read())
    for name, pin in sorted(pins["INSPIRE_NOTEBOOK_ASSETS"].items()):
        with open(os.path.join(root, pin["repo"]), "rb") as handle:
            data = handle.read()
        if (sha256(data), len(data)) != (pin["sha256"], pin["size"]):
            raise SystemExit(f"{pin['repo']} is not the build the notebook pins; run `python3 agent/app_shell/embed.py write`")
        bundle.add("notebook", name, version, pin["file"], data, license_file)
        log(f"notebook {name} {version}: {len(data):,} bytes")


def release_sha256(pins: dict, name: str, version: str, asset: str) -> str:
    source = pins["INSPIRE_ASSET_CLI_SOURCES"][name]
    sums = source["sums"].format(asset=asset, version=version)
    text = fetch(pins["inspire_cli_release_url"](name, sums, version)).decode("utf-8", "replace")
    lines = [line.split() for line in text.splitlines() if line.strip()]
    found = [parts[0] for parts in lines if len(parts) == 1 or parts[-1].lstrip("*") == asset]
    if len(found) != 1 or not re.fullmatch(r"[0-9a-f]{64}", found[0].lower()):
        raise SystemExit(f"{sums} of {source['repo']} v{version} names no single sha256 for {asset}")
    return found[0].lower()


def add_clis(bundle: Bundle, pins: dict, machines: list) -> None:
    for name, (version, _suffix) in pins["INSPIRE_ASSET_CLIS"].items():
        source = pins["INSPIRE_ASSET_CLI_SOURCES"][name]
        text = "\n\n".join(fetch(CLI_LICENSE.format(repo=source["repo"], version=version, name=part)).decode("utf-8").strip()
                           for part in ("LICENSE", "NOTICE")) + "\n"
        license_file = bundle.license(name, version, text)
        for machine in machines:
            asset = pins["inspire_cli_release_file"](name, version, machine)
            digest = release_sha256(pins, name, version, asset)
            data = fetch(pins["inspire_cli_release_url"](name, asset, version), sha=digest)
            if sha256(data) != digest:
                raise SystemExit(f"{asset} does not match the sha256 the release publishes")
            bundle.add("cli", name, version, pins["inspire_asset_file"]("cli", name, machine), data, license_file, machine=machine,
                       source=asset)
            log(f"cli {name} {version} {machine}: {len(data):,} bytes")


def release_module():
    spec = importlib.util.spec_from_file_location("inspire_release", RELEASE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write(bundle: Bundle, pins: dict, out: str, found: dict, machines: list, app_machines: list) -> dict:
    release = release_module()
    os.makedirs(out, exist_ok=True)
    manifest = {"format": pins["INSPIRE_ASSETS_FORMAT"], "inspire_version": pins["__AGENT_VERSION__"],
                "environment_version": pins["GENIE_NOTEBOOK_ENV_VERSION"], "python": pins["INSPIRE_ASSETS_PYTHON"],
                "app_python": pins["INSPIRE_APP_ASSETS_PYTHON"], "machines": machines, "app_machines": app_machines,
                "probe": {"machine": found["machine"], "python": found["version"].split()[0]},
                "files": sorted(bundle.entries, key=lambda e: e["file"])}
    body = json.dumps(manifest, indent=1, sort_keys=True).encode("utf-8")
    members = dict(bundle.files, **{release.ASSETS_MANIFEST: body})
    archive = os.path.join(out, release.ASSETS_TAR)
    release.write_tar(archive, list(members), lambda name: io.BytesIO(members[name]))
    with open(os.path.join(out, release.ASSETS_MANIFEST), "wb") as handle:
        handle.write(body)
    digest, size = release.load_starter()["file_digest"](archive)
    return {"path": archive, "archive": size, "sha256": digest, "files": len(bundle.entries),
            "payload": sum(len(d) for d in bundle.files.values())}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="build_assets.py", description="Build the Inspire assets download on a machine with internet.")
    parser.add_argument("--out", required=True, help="folder for inspire-assets.tar and a copy of the manifest.json it holds")
    parser.add_argument("--profile", help="Databricks CLI profile of a workspace to probe the serverless machine and Python")
    parser.add_argument("--probe", help="a saved probe JSON with machine and version, instead of a live probe")
    parser.add_argument("--machines", default="x86_64,aarch64",
                        help="comma list of CPU architectures for the agent; serverless runs on either and can change between runs")
    parser.add_argument("--cache", default="", help="a folder that keeps downloads by sha256 so a rebuild fetches only what changed")
    parser.add_argument("--app-machines", default="x86_64,aarch64", help="comma list of CPU architectures for built Apps")
    args = parser.parse_args(argv)
    if args.cache:
        os.makedirs(args.cache, exist_ok=True)
        CACHE[:] = [args.cache]
    pins = notebook_pins()
    if args.probe:
        with open(args.probe, encoding="utf-8") as handle:
            found = json.load(handle)
    elif args.profile:
        found = probe(args.profile, pins["GENIE_NOTEBOOK_ENV_VERSION"])
    else:
        parser.error("pass --profile for a live serverless probe, or --probe with a saved one")
    probed = pins["INSPIRE_ASSET_MACHINES"].get(found["machine"].lower(), found["machine"].lower())
    python = ".".join(found["version"].split()[0].split(".")[:2])
    if python != pins["INSPIRE_ASSETS_PYTHON"]:
        raise SystemExit(f"serverless environment {pins['GENIE_NOTEBOOK_ENV_VERSION']} runs Python {python}, and the notebook pins "
                         f"INSPIRE_ASSETS_PYTHON {pins['INSPIRE_ASSETS_PYTHON']}; update the pin and the wheels")
    machines = [m.strip() for m in args.machines.split(",") if m.strip()]
    app_machines = [m.strip() for m in args.app_machines.split(",") if m.strip()]
    if probed not in machines:
        raise SystemExit(f"the probe ran on {probed}, which --machines {','.join(machines)} leaves out")
    bundle = Bundle(pins)
    agent = sorted({d for dists in pins["INSPIRE_ASSET_MODULES"].values() for d in dists})
    add_python(bundle, pins, pins["INSPIRE_ASSETS_PYTHON"], machines, agent)
    add_python(bundle, pins, pins["INSPIRE_APP_ASSETS_PYTHON"], app_machines, pins["INSPIRE_APP_ASSET_WHEELS"])
    add_fonts(bundle, pins)
    add_notebook(bundle, pins)
    add_clis(bundle, pins, machines)
    sizes = write(bundle, pins, args.out, found, machines, app_machines)
    for entry in sorted(bundle.entries, key=lambda e: -e["size"]):
        print(f"{entry['size']:>13,}  {entry['file']}  {entry['name']} {entry['version']}")
    print(f"{sizes['payload']:>13,}  payload in {sizes['files']} files")
    print(f"{sizes['archive']:>13,}  {sizes['path']}, sha256 {sizes['sha256']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
