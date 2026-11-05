# Databricks notebook source
import hashlib
import json
import time
import urllib.parse
import urllib.request

import requests
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.workspace import ImportFormat

dbutils.widgets.text("tag", "")
dbutils.widgets.text("folder", "")
dbutils.widgets.text("mode", "whole")
dbutils.widgets.text("files", "manifest.json,inspire-app.zip,inspire-assets.tar")
TAG, FOLDER, MODE, FILES = (dbutils.widgets.get(k).strip() for k in ("tag", "folder", "mode", "files"))
FILES = [name for name in FILES.split(",") if name]
assert FILES and set(FILES) <= {"manifest.json", "inspire-app.zip", "inspire-assets.tar"}, FILES
assert TAG and FOLDER.startswith("/Users/") and MODE in ("whole", "ui"), (TAG, FOLDER, MODE)
BASE = f"https://github.com/amralieg/inspire/releases/download/{TAG}"
w = WorkspaceClient()
stage = "/local_disk0/tmp/rc_stage" if __import__("os").path.isdir("/local_disk0") else "/tmp/rc_stage"
__import__("os").makedirs(stage, exist_ok=True)


def fetch(name):
    target = f"{stage}/{name}"
    with urllib.request.urlopen(f"{BASE}/{name}", timeout=600) as response, open(target, "wb") as handle:
        for block in iter(lambda: response.read(1 << 20), b""):
            handle.write(block)
    return target


def digest(path):
    h, n = hashlib.sha256(), 0
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            h.update(block)
            n += len(block)
    return h.hexdigest(), n


manifest_path = fetch("manifest.json")
manifest = json.load(open(manifest_path))
listed = {e["name"]: e for e in manifest["files"]}
report = {"tag": TAG, "folder": FOLDER, "mode": MODE, "version": manifest["version"], "files": {}}
for name in [n for n in FILES if n != "manifest.json"]:
    path = fetch(name)
    got = digest(path)
    assert got == (listed[name]["sha256"], listed[name]["size"]), (name, got)
headers = w.config.authenticate()
for name in FILES:
    path, started = f"{stage}/{name}", time.time()
    if MODE == "whole":
        with open(path, "rb") as handle:
            w.workspace.upload(f"{FOLDER}/{name}", handle, format=ImportFormat.RAW, overwrite=True)
        how = "workspace/import format RAW (databricks workspace import --format RAW)"
    else:
        with open(path, "rb") as handle:
            reply = requests.post(f"{w.config.host}/api/2.0/workspace-files/import-file/{urllib.parse.quote(FOLDER.lstrip('/') + '/' + name)}",
                                  params={"overwrite": "true"}, data=handle, headers={**headers, "Content-Type": "application/octet-stream"},
                                  timeout=1800)
        assert reply.status_code == 200, (name, reply.status_code, reply.text[:300])
        how = "workspace-files/import-file (the workspace UI import)"
    report["files"][name] = {"how": how, "seconds": round(time.time() - started, 1), "bytes": digest(path)[1]}
report["listing"] = sorted((o.path.rsplit("/", 1)[1], str(o.object_type).split(".")[-1], o.size) for o in w.workspace.list(FOLDER))
print(json.dumps(report, indent=1))
dbutils.notebook.exit(json.dumps(report))
