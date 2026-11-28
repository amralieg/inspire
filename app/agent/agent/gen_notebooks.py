"""Generate every notebook from agent/inspire_lib.py, the one hand-edited copy of the agent code (REQ-586).

- dbx_inspire_ai_agent.ipynb: code cell 1 is the library, byte for byte, so the single notebook and the library cannot drift.
- inspire_discover.ipynb and inspire_generate.ipynb: thin notebooks that pin the library's sha256, check it before any of its
  code runs, load it into the notebook namespace and run only the operations they own.
Run by c20_regen.sh after `embed.py write --notebook agent/inspire_lib.py`; `check` exits 1 when anything is stale.
"""
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LIB = os.path.join(HERE, "inspire_lib.py")
FULL_NOTEBOOK = os.path.join(HERE, "dbx_inspire_ai_agent.ipynb")
CELL = 1

LOADER = '''import hashlib
import os

INSPIRE_LIB_SHA256 = "{sha}"
INSPIRE_NOTEBOOK_OPERATIONS = {operations!r}


def load_inspire_lib(pin=INSPIRE_LIB_SHA256, name="inspire_lib.py"):
    """Read inspire_lib.py next to this notebook, check its sha256 against the pin, then (and only then) run it here."""
    here = [os.path.dirname(os.path.abspath(globals()["__file__"]))] if "__file__" in globals() else []
    for folder in here + [os.getcwd()]:
        path = os.path.join(folder, name)
        if os.path.isfile(path):
            break
    else:
        raise FileNotFoundError(f"{{name}} must sit next to this notebook")
    with open(path, "rb") as handle:
        data = handle.read()
    found = hashlib.sha256(data).hexdigest()
    if found != pin:
        raise RuntimeError(f"{{name}} sha256 mismatch: the notebook pins {{pin}} but the file is {{found}}; integrity check failed")
    exec(compile(data.decode("utf-8"), path, "exec"), globals())


load_inspire_lib()
'''
MAIN = '''if __name__ == "__main__":
    inspire_require_owned_operation()
    logging.getLogger("py4j").setLevel(logging.ERROR)
    main()'''
NOTEBOOKS = {
    "inspire_discover": (("Discover Use Cases", "Match Use Cases"),
                         "# Inspire Discover\n\nDiscover and Match use cases. The agent code is `inspire_lib.py` (next to this notebook), "
                         "loaded after its sha256 matches the pin below. Implement Use Cases is `inspire_generate`."),
    "inspire_generate": (("Implement Use Cases",),
                         "# Inspire Generate\n\nImplement the accepted use cases. The agent code is `inspire_lib.py` (next to this notebook), "
                         "loaded after its sha256 matches the pin below. Discover and Match are `inspire_discover`."),
}


def _lines(text):
    return text.splitlines(True)


def lib_sha():
    with open(LIB, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def _dump(nb):
    return json.dumps(nb, indent=2, ensure_ascii=False) + "\n"


def thin(name, sha):
    operations, intro = NOTEBOOKS[name]
    code = lambda src: {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": _lines(src)}
    with open(FULL_NOTEBOOK, encoding="utf-8") as handle:
        old = json.load(handle)
    meta = {"application/vnd.databricks.v1+notebook": {
        "computePreferences": old["metadata"]["application/vnd.databricks.v1+notebook"]["computePreferences"],
        "dashboards": [], "environmentMetadata": old["metadata"]["application/vnd.databricks.v1+notebook"]["environmentMetadata"],
        "inputWidgetPreferences": {"autoRunOnWidgetChange": "no-auto-run"}, "language": "python", "notebookName": name, "widgets": {}},
        "kernelspec": old["metadata"]["kernelspec"], "language_info": old["metadata"]["language_info"]}
    return {"cells": [{"cell_type": "markdown", "metadata": {}, "source": _lines(intro)},
                      code(LOADER.format(sha=sha, operations=operations)), code(MAIN)],
            "metadata": meta, "nbformat": old["nbformat"], "nbformat_minor": old["nbformat_minor"]}


def expected():
    """path -> expected text of every generated file."""
    with open(LIB, encoding="utf-8", newline="") as handle:
        lib_lines = handle.read().splitlines(True)
    with open(FULL_NOTEBOOK, encoding="utf-8") as handle:
        full = json.load(handle)
    full["cells"][CELL]["source"] = lib_lines
    out = {FULL_NOTEBOOK: _dump(full)}
    sha = lib_sha()
    for name in NOTEBOOKS:
        out[os.path.join(HERE, name + ".ipynb")] = _dump(thin(name, sha))
    return out


def main(argv):
    write = bool(argv) and argv[0] == "write"
    stale = []
    for path, text in expected().items():
        have = ""
        if os.path.isfile(path):
            with open(path, encoding="utf-8", newline="") as handle:
                have = handle.read()
        if have != text:
            stale.append(path)
            if write:
                with open(path, "w", encoding="utf-8", newline="") as out:
                    out.write(text)
    for path in stale:
        print(("wrote " if write else "stale: ") + os.path.relpath(path, HERE))
    print("generated notebooks " + ("written" if write else "current" if not stale else "stale"))
    return 0 if write or not stale else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
