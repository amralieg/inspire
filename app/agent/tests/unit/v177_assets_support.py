import gzip
import hashlib
import io
import json
import os
import tarfile
import zipfile

MACHINE = "aarch64"


def wheel(files: dict) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, body in files.items():
            archive.writestr(zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0)), body)
    return buffer.getvalue()


def genie_package() -> bytes:
    buffer = io.BytesIO()
    with gzip.GzipFile(fileobj=buffer, mode="wb", mtime=0) as packed:
        with tarfile.open(fileobj=packed, mode="w") as archive:
            body = b"#!/bin/sh\n"
            info = tarfile.TarInfo("genie-package/bin/genie")
            info.size, info.mode = len(body), 0o755
            archive.addfile(info, io.BytesIO(body))
    return buffer.getvalue()


def databricks_cli() -> bytes:
    return wheel({"databricks": "#!/bin/sh\n", "LICENSE": "Databricks License"})


def cli_entries(ns, machine: str = MACHINE) -> list:
    return [{"kind": "cli", "name": "genie-code-cli", "version": ns["GENIE_CODE_CLI_VERSION"], "data": genie_package(), "machine": machine},
            {"kind": "cli", "name": "databricks-cli", "version": ns["GENIE_DATABRICKS_CLI_VERSION"], "data": databricks_cli(),
             "machine": machine}]


def make_assets(ns, root, entries, inspire_version: str = "", machine: str = MACHINE, local: str = ""):
    root = str(root)
    os.makedirs(root, exist_ok=True)
    listed = []
    for item in entries:
        machine_of, python = item.get("machine", "any"), item.get("python", "any")
        file = ns["inspire_asset_file"](item["kind"], item["name"], machine_of, python, item.get("weight"))
        license_file = ns["inspire_asset_file"]("license", item["name"])
        for path, body in ((file, item["data"]), (license_file, f"license of {item['name']}".encode())):
            os.makedirs(os.path.dirname(os.path.join(root, path)), exist_ok=True)
            with open(os.path.join(root, path), "wb") as handle:
                handle.write(body)
        data = item["data"]
        listed.append(dict({"name": item["name"], "version": item["version"], "kind": item["kind"], "file": file, "size": len(data),
                            "sha256": hashlib.sha256(data).hexdigest(), "license": license_file, "machine": machine_of, "python": python},
                           **({"weight": item["weight"]} if item.get("weight") is not None else {})))
    manifest = {"format": ns["INSPIRE_ASSETS_FORMAT"], "inspire_version": inspire_version or ns["__AGENT_VERSION__"], "files": listed}
    with open(os.path.join(root, ns["INSPIRE_ASSETS_MANIFEST"]), "w", encoding="utf-8") as handle:
        json.dump(manifest, handle)
    return ns["InspireAssets"](root, local=local or f"{root}_local", machine=machine)
