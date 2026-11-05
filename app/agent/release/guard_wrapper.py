# Databricks notebook source
import base64
import collections
import ipaddress
import json
import shutil
import socket
import tempfile
import os
import urllib.parse

from databricks.sdk import WorkspaceClient
from databricks.sdk.service.workspace import ExportFormat

dbutils.widgets.text("guard_mode", "offline")
GUARD_MODE = dbutils.widgets.get("guard_mode")
client = WorkspaceClient()
WORKSPACE = {urllib.parse.urlsplit(client.config.host).hostname}
context = dbutils.notebook.entry_point.getDbutils().notebook().getContext()
for getter in ("apiUrl", "browserHostName"):
    try:
        value = getattr(context, getter)().get()
        WORKSPACE.add(urllib.parse.urlsplit(value).hostname or value)
    except Exception:
        pass
GITHUB = {"github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"}
notebook_path = context.notebookPath().get()
source = base64.b64decode(client.workspace.export(notebook_path.rsplit("/", 1)[0] + "/inspire_installer", format=ExportFormat.SOURCE).content).decode()
shutil.rmtree(os.path.join(tempfile.gettempdir(), "inspire_release"), ignore_errors=True)

calls = collections.Counter()
names = {}
original = (socket.getaddrinfo, socket.socket.connect, socket.socket.connect_ex)


def guarded_getaddrinfo(host, *args, **kwargs):
    found = original[0](host, *args, **kwargs)
    for item in found:
        names[item[4][0]] = str(host)
    return found


def classify(address):
    if not isinstance(address, tuple):
        return "local", str(address)
    ip = str(address[0])
    name = names.get(ip, ip)
    try:
        if ipaddress.ip_address(ip).is_loopback:
            return "local", name
    except ValueError:
        pass
    if name in WORKSPACE:
        return "workspace", name
    if name in GITHUB and GUARD_MODE == "online":
        return "github", name
    return "refused", f"{name}:{address[1]}"


def check(address):
    kind, name = classify(address)
    calls[(kind, name)] += 1
    if kind == "refused":
        raise ConnectionRefusedError(f"socket guard refused {name}")


def guarded_connect(self, address):
    check(address)
    return original[1](self, address)


def guarded_connect_ex(self, address):
    check(address)
    return original[2](self, address)


socket.getaddrinfo, socket.socket.connect, socket.socket.connect_ex = guarded_getaddrinfo, guarded_connect, guarded_connect_ex

# COMMAND ----------

failure = None
try:
    exec(compile(source, "inspire_installer", "exec"), globals())
except BaseException as exc:
    failure = exc
socket.getaddrinfo, socket.socket.connect, socket.socket.connect_ex = original
kinds = collections.Counter()
for (kind, name), count in calls.items():
    kinds[kind] += count
print("SOCKET GUARD " + json.dumps({"mode": GUARD_MODE, "by_kind": dict(kinds), "refused": kinds.get("refused", 0),
                                    "github": kinds.get("github", 0),
                                    "hosts": sorted(f"{kind} {name} x{count}" for (kind, name), count in calls.items()),
                                    "failure": f"{type(failure).__name__}: {str(failure)[:300]}" if failure else None}))

# COMMAND ----------

if failure:
    raise failure
