import json
import os
import pathlib
import shutil
import subprocess
import sys
import time

ENV = "INSPIRE_RC_SETTINGS"
HERE = pathlib.Path(__file__).resolve().parent


def load():
    value = os.environ.get(ENV, "").strip()
    if not value:
        raise SystemExit(f"set {ENV} to the JSON settings file of the release tools: the workspace profile, warehouse, catalog, "
                         f"scratch App and the folders they write to")
    path = pathlib.Path(value)
    if not path.is_file():
        raise SystemExit(f"{ENV} names {path}, which is not a file")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit(f"{path} does not hold a JSON object")
    return data


def need(settings, key):
    value = settings
    for part in key.split("."):
        if not isinstance(value, dict) or part not in value or value[part] in (None, "", [], {}):
            raise SystemExit(f"{os.environ.get(ENV)} has no {key}")
        value = value[part]
    return value


def path(settings, key):
    return pathlib.Path(need(settings, key))


def require_tools(settings, files=(), commands=()):
    missing = [f"{key} {need(settings, key)}" for key in files if not path(settings, key).is_file()]
    for key in commands:
        command = settings.get(key)
        if not command:
            continue
        parts = [command] if isinstance(command, str) else [str(p) for p in command]
        if not shutil.which(parts[0]):
            missing.append(f"{key} program {parts[0]}")
        missing += [f"{key} file {p}" for p in parts[1:] if (p.startswith("/") or p.endswith(".py")) and not pathlib.Path(p).is_file()]
    if missing:
        raise SystemExit(f"{os.environ.get(ENV)} names helper files that are not there: {'; '.join(missing)}; "
                         f"restore them or point the settings at their copies")


def wait_for_network(settings):
    command = settings.get("net_wait")
    if command:
        subprocess.run(command)
    else:
        time.sleep(30)


def main():
    if len(sys.argv) != 3 or sys.argv[1] != "get":
        raise SystemExit("usage: rc_settings.py get <key>")
    value = need(load(), sys.argv[2])
    print(" ".join(map(str, value)) if isinstance(value, list) else value)


if __name__ == "__main__":
    main()
